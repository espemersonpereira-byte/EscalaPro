import {
  AbsenceRecord,
  Employee,
  EscalaProState,
  HospitalUnit,
  LeaveCalculationSummary,
  LocalRegisteredAccount,
  MonthlyScheduleMap,
  ScheduleCellData,
  ShiftStatus,
  UserAccount,
} from '../types';

const STORAGE_KEY = 'escalapro_cloud_ready_state_v2';
const ACCOUNTS_LIST_KEY = 'escalapro_registered_accounts_v2';
const ACTIVE_SESSION_KEY = 'escalapro_active_session_v2';
const USER_STATE_PREFIX = 'escalapro_user_state_v2_';

export function getYearMonthKey(year: number, monthIndex0: number): string {
  const m = String(monthIndex0 + 1).padStart(2, '0');
  return `${year}-${m}`;
}

export function getDaysInMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

export function formatIsoDate(year: number, monthIndex0: number, day: number): string {
  const m = String(monthIndex0 + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

export function parseIsoDateParts(isoDate: string): { year: number; monthIndex0: number; day: number } {
  const [y, m, d] = isoDate.split('-').map(Number);
  return {
    year: y || new Date().getFullYear(),
    monthIndex0: (m || 1) - 1,
    day: d || 1,
  };
}

export function formatDateWithWeekdayPtBr(isoDate: string): string {
  const { year, monthIndex0, day } = parseIsoDateParts(isoDate);
  const dObj = new Date(year, monthIndex0, day);
  const datePart = dObj.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const weekdayPart = dObj.toLocaleDateString('pt-BR', { weekday: 'long' });
  return `${datePart} (${weekdayPart})`;
}

// Calcula o status padrão de escala de um colaborador para um dia específico
export function computeRegimeShiftForDay(
  employee: Employee,
  year: number,
  monthIndex0: number,
  day: number
): ShiftStatus {
  const workCode: ShiftStatus = employee.defaultShift === 'Noturno' ? 'N' : 'D';
  const dateObj = new Date(year, monthIndex0, day);
  const dayOfWeek = dateObj.getDay(); // 0 = Dom, 6 = Sáb

  switch (employee.regime) {
    case '12x36_ODD':
      return day % 2 === 1 ? workCode : 'F';
    case '12x36_EVEN':
      return day % 2 === 0 ? workCode : 'F';
    case '5x2':
      return dayOfWeek >= 1 && dayOfWeek <= 5 ? workCode : 'F';
    case '6x1': {
      // Folga rotativa determinística baseada no ID do colaborador
      const hash = employee.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
      const restDayOfWeek = hash % 7;
      return dayOfWeek === restDayOfWeek ? 'F' : workCode;
    }
    default:
      return day % 2 === 1 ? workCode : 'F';
  }
}

// Calcula automaticamente o fim do atestado/afastamento, dias cobertos e qual será o PRÓXIMO PLANTÃO da pessoa mediante a escala dela
export function calculateLeaveAndNextShift(
  employee: Employee,
  schedules: MonthlyScheduleMap,
  startDateIso: string,
  daysCount: number
): LeaveCalculationSummary {
  const safeDays = Math.max(1, Math.min(180, Number(daysCount) || 1));
  const { year, monthIndex0, day } = parseIsoDateParts(startDateIso);
  const startObj = new Date(year, monthIndex0, day);

  const coveredDaysDetails: LeaveCalculationSummary['coveredDaysDetails'] = [];
  let affectedWorkShiftsCount = 0;

  for (let i = 0; i < safeDays; i++) {
    const dObj = new Date(startObj);
    dObj.setDate(startObj.getDate() + i);
    const y = dObj.getFullYear();
    const m0 = dObj.getMonth();
    const dNum = dObj.getDate();
    const iso = formatIsoDate(y, m0, dNum);
    const origStatus = computeRegimeShiftForDay(employee, y, m0, dNum);

    if (origStatus === 'D' || origStatus === 'N') {
      affectedWorkShiftsCount++;
    }

    coveredDaysDetails.push({
      iso,
      shortDate: dObj.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      weekday: dObj.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''),
      originalStatus: origStatus,
    });
  }

  // Último dia do atestado (Acaba em)
  const endObj = new Date(startObj);
  endObj.setDate(startObj.getDate() + safeDays - 1);
  const endDateIso = formatIsoDate(endObj.getFullYear(), endObj.getMonth(), endObj.getDate());

  // Primeiro dia após o término do atestado (Apto ao retorno)
  const returnAvailableObj = new Date(startObj);
  returnAvailableObj.setDate(startObj.getDate() + safeDays);
  const returnAvailableDateIso = formatIsoDate(
    returnAvailableObj.getFullYear(),
    returnAvailableObj.getMonth(),
    returnAvailableObj.getDate()
  );

  // Procura o próximo dia em que o colaborador está escalado para trabalhar (D, N ou TR) a partir de returnAvailableObj
  let nextShiftDateIso = returnAvailableDateIso;
  let nextShiftCode: ShiftStatus = employee.defaultShift === 'Noturno' ? 'N' : 'D';

  for (let lookahead = 0; lookahead <= 45; lookahead++) {
    const candidateObj = new Date(returnAvailableObj);
    candidateObj.setDate(returnAvailableObj.getDate() + lookahead);
    const cy = candidateObj.getFullYear();
    const cm0 = candidateObj.getMonth();
    const cd = candidateObj.getDate();
    const ymKey = getYearMonthKey(cy, cm0);

    const savedCell = schedules[ymKey]?.[employee.id]?.[cd];
    const effectiveStatus: ShiftStatus =
      savedCell && savedCell.status !== 'AT' && savedCell.status !== 'FA'
        ? savedCell.status
        : computeRegimeShiftForDay(employee, cy, cm0, cd);

    if (effectiveStatus === 'D' || effectiveStatus === 'N' || effectiveStatus === 'TR') {
      nextShiftDateIso = formatIsoDate(cy, cm0, cd);
      nextShiftCode = effectiveStatus;
      break;
    }
  }

  const nextShiftLabel =
    nextShiftCode === 'N'
      ? `Plantão Noturno (${employee.workHours})`
      : `Plantão Diurno (${employee.workHours})`;

  return {
    startDateIso,
    startDateFormatted: formatDateWithWeekdayPtBr(startDateIso),
    endDateIso,
    endDateFormatted: formatDateWithWeekdayPtBr(endDateIso),
    returnAvailableDateIso,
    returnAvailableDateFormatted: formatDateWithWeekdayPtBr(returnAvailableDateIso),
    nextShiftDateIso,
    nextShiftDateFormatted: formatDateWithWeekdayPtBr(nextShiftDateIso),
    nextShiftCode,
    nextShiftLabel,
    daysCount: safeDays,
    affectedWorkShiftsCount,
    coveredDaysDetails,
  };
}

// Gera ou atualiza a escala automática de um mês preservando Férias (FE), Atestados (AT), Faltas (FA) e Trocas (TR)
export function generateAutomaticScheduleForMonth(
  employees: Employee[],
  existingSchedules: MonthlyScheduleMap,
  year: number,
  monthIndex0: number,
  preserveAbsences = true
): MonthlyScheduleMap {
  const ymKey = getYearMonthKey(year, monthIndex0);
  const daysCount = getDaysInMonth(year, monthIndex0);
  const currentMonthMap = { ...(existingSchedules[ymKey] || {}) };

  for (const emp of employees) {
    if (!emp.active) continue;
    const empExistingDays = { ...(currentMonthMap[emp.id] || {}) };

    for (let day = 1; day <= daysCount; day++) {
      const currentCell = empExistingDays[day];
      if (
        preserveAbsences &&
        currentCell &&
        (currentCell.status === 'AT' ||
          currentCell.status === 'FE' ||
          currentCell.status === 'FA' ||
          currentCell.status === 'TR')
      ) {
        continue;
      }

      const calculatedStatus = computeRegimeShiftForDay(emp, year, monthIndex0, day);
      empExistingDays[day] = {
        status: calculatedStatus,
        note: currentCell?.note,
        extraHours: currentCell?.extraHours,
      };
    }

    currentMonthMap[emp.id] = empExistingDays;
  }

  return {
    ...existingSchedules,
    [ymKey]: currentMonthMap,
  };
}

// Aplica um registro de ausência (Falta, Atestado, Férias) diretamente nas células da escala
export function applyAbsenceToSchedules(
  schedules: MonthlyScheduleMap,
  employeeId: string,
  startDateIso: string,
  daysCount: number,
  status: ShiftStatus,
  note: string
): MonthlyScheduleMap {
  const updated: MonthlyScheduleMap = { ...schedules };
  const { year, monthIndex0, day } = parseIsoDateParts(startDateIso);
  const startObj = new Date(year, monthIndex0, day);

  for (let i = 0; i < daysCount; i++) {
    const dObj = new Date(startObj);
    dObj.setDate(startObj.getDate() + i);
    const y = dObj.getFullYear();
    const m0 = dObj.getMonth();
    const dNum = dObj.getDate();
    const ymKey = getYearMonthKey(y, m0);

    const monthMap = { ...(updated[ymKey] || {}) };
    const empMap: Record<number, ScheduleCellData> = { ...(monthMap[employeeId] || {}) };

    empMap[dNum] = {
      ...(empMap[dNum] || {}),
      status,
      note,
    };

    monthMap[employeeId] = empMap;
    updated[ymKey] = monthMap;
  }

  return updated;
}

// Cria um anexo SVG em Base64 simulando um Atestado Médico digitalizado para os dados de demonstração
function createDemoMedicalCertificateDataUri(employeeName: string, dateStr: string, cid: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="420" viewBox="0 0 600 420">
    <rect width="600" height="420" fill="#ffffff" stroke="#cbd5e1" stroke-width="4" rx="12"/>
    <rect x="24" y="24" width="552" height="64" rx="8" fill="#f0fdfa"/>
    <text x="44" y="55" font-family="sans-serif" font-size="18" font-weight="bold" fill="#0d9488">ATESTADO MÉDICO HOSPITALAR</text>
    <text x="44" y="75" font-family="sans-serif" font-size="12" fill="#475569">Documento Digitalizado · EscalaPro Prontuário</text>
    <text x="44" y="130" font-family="sans-serif" font-size="14" fill="#0f172a">Atesto para os devidos fins trabalhistas que o(a) colaborador(a):</text>
    <text x="44" y="160" font-family="sans-serif" font-size="17" font-weight="bold" fill="#0f172a">${employeeName}</text>
    <text x="44" y="195" font-family="sans-serif" font-size="14" fill="#334155">Necessita de 03 (três) dias de afastamento de suas atividades laborais</text>
    <text x="44" y="220" font-family="sans-serif" font-size="14" fill="#334155">a partir de ${dateStr}, por motivo de tratamento de saúde.</text>
    <rect x="44" y="250" width="220" height="36" rx="6" fill="#fef3c7"/>
    <text x="58" y="273" font-family="monospace" font-size="14" font-weight="bold" fill="#b45309">CID-10: ${cid}</text>
    <line x1="320" y1="345" x2="540" y2="345" stroke="#64748b" stroke-width="1.5"/>
    <text x="355" y="365" font-family="sans-serif" font-size="12" fill="#475569">Dr. Henrique Vasconcelos · CRM 94821</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// Estado inicial limpo (sem nomes ou unidades de exemplo pré-preenchidos)
export function createBlankInitialState(): EscalaProState {
  return {
    manager: {
      name: '',
      hospitalName: '',
      role: '',
      sectorName: '',
      avatarBase64: '',
      onboardingCompleted: false,
    },
    units: [],
    customRoles: [],
    employees: [],
    schedules: {},
    pushConfig: {
      enabled: false,
      alertUncoveredShift1hBefore: true,
      dailySummaryAt0630: true,
      instantCertificateAlert: true,
      webhookOrVapidKey: '',
    },
    lastUpdated: new Date().toISOString(),
  };
}

// Estado populado de demonstração realista (para testar 100% das telas imediatamente)
export function createDemoEscalaProState(): EscalaProState {
  const now = new Date();
  const year = now.getFullYear();
  const month0 = now.getMonth();
  const todayDay = now.getDate();
  const todayIso = formatIsoDate(year, month0, todayDay);
  const yesterdayDay = Math.max(1, todayDay - 1);
  const yesterdayIso = formatIsoDate(year, month0, yesterdayDay);

  const units: HospitalUnit[] = [
    {
      id: 'unit-central',
      name: 'Farmácia Central',
      shiftMode: '24H',
      minStaffDay: 2,
      minStaffNight: 1,
    },
    {
      id: 'unit-ps',
      name: 'Farmácia Pronto-Socorro',
      shiftMode: '24H',
      minStaffDay: 2,
      minStaffNight: 1,
    },
    {
      id: 'unit-cc',
      name: 'Farmácia Centro Cirúrgico',
      shiftMode: 'DIURNO',
      minStaffDay: 2,
      minStaffNight: 0,
    },
  ];

  const certAttachment = createDemoMedicalCertificateDataUri(
    'Camila Rocha Mendes',
    todayIso,
    'J06.9 - Infecção Aguda VAS'
  );

  const certRecord: AbsenceRecord = {
    id: 'abs-cert-1',
    employeeId: 'emp-4',
    type: 'ATESTADO',
    startDate: todayIso,
    daysCount: 3,
    shift: 'Diurno',
    reason: 'Atestado médico de 3 dias entregue na supervisão.',
    cid: 'J06.9',
    attachmentName: 'atestado_camila_mendes.svg',
    attachmentBase64: certAttachment,
    attachmentMimeType: 'image/svg+xml',
    createdAt: new Date().toISOString(),
  };

  const absenceRecord1: AbsenceRecord = {
    id: 'abs-falta-1',
    employeeId: 'emp-8',
    type: 'FALTA',
    startDate: yesterdayIso,
    daysCount: 1,
    shift: 'Noturno',
    reason: 'Imprevisto no deslocamento interurbano sem cobertura prévia.',
    createdAt: new Date().toISOString(),
  };

  const vacationStartDay = Math.min(20, Math.max(1, todayDay));
  const vacationStartIso = formatIsoDate(year, month0, vacationStartDay);
  const vacationRecord: AbsenceRecord = {
    id: 'abs-ferias-1',
    employeeId: 'emp-12',
    type: 'FERIAS',
    startDate: vacationStartIso,
    daysCount: 7,
    reason: 'Férias regulamentares programadas no calendário anual.',
    createdAt: new Date().toISOString(),
  };

  const employees: Employee[] = [
    {
      id: 'emp-1',
      name: 'Dra. Beatriz Albuquerque',
      registrationNumber: 'CRF-SP 48219',
      role: 'Farmacêutico',
      unitId: 'unit-central',
      defaultShift: 'Diurno',
      workHours: '07:00 às 19:00',
      regime: '12x36_ODD',
      hourBankBalance: 6,
      active: true,
      history: [],
    },
    {
      id: 'emp-2',
      name: 'Dr. Lucas Cavalcanti',
      registrationNumber: 'CRF-SP 51902',
      role: 'Farmacêutico',
      unitId: 'unit-central',
      defaultShift: 'Diurno',
      workHours: '07:00 às 19:00',
      regime: '12x36_EVEN',
      hourBankBalance: 0,
      active: true,
      history: [],
    },
    {
      id: 'emp-3',
      name: 'Rafael Moreira Santos',
      registrationNumber: 'MAT-10492',
      role: 'Auxiliar de Farmácia',
      unitId: 'unit-central',
      defaultShift: 'Diurno',
      workHours: '07:00 às 19:00',
      regime: '12x36_ODD',
      hourBankBalance: 12,
      active: true,
      history: [],
    },
    {
      id: 'emp-4',
      name: 'Camila Rocha Mendes',
      registrationNumber: 'MAT-10518',
      role: 'Auxiliar de Farmácia',
      unitId: 'unit-central',
      defaultShift: 'Diurno',
      workHours: '07:00 às 19:00',
      regime: '12x36_EVEN',
      hourBankBalance: -4,
      active: true,
      history: [certRecord],
    },
    {
      id: 'emp-5',
      name: 'Dr. Gustavo Paiva',
      registrationNumber: 'CRF-SP 39811',
      role: 'Farmacêutico',
      unitId: 'unit-central',
      defaultShift: 'Noturno',
      workHours: '19:00 às 07:00',
      regime: '12x36_ODD',
      hourBankBalance: 4,
      active: true,
      history: [],
    },
    {
      id: 'emp-6',
      name: 'Patrícia Lima Nogueira',
      registrationNumber: 'MAT-10890',
      role: 'Auxiliar de Farmácia',
      unitId: 'unit-central',
      defaultShift: 'Noturno',
      workHours: '19:00 às 07:00',
      regime: '12x36_EVEN',
      hourBankBalance: 8,
      active: true,
      history: [],
    },
    {
      id: 'emp-7',
      name: 'Dra. Juliana Monteiro',
      registrationNumber: 'CRF-SP 60123',
      role: 'Farmacêutico',
      unitId: 'unit-ps',
      defaultShift: 'Diurno',
      workHours: '07:00 às 19:00',
      regime: '12x36_ODD',
      hourBankBalance: 2,
      active: true,
      history: [],
    },
    {
      id: 'emp-8',
      name: 'Diego Ferreira Costa',
      registrationNumber: 'MAT-11024',
      role: 'Auxiliar de Farmácia',
      unitId: 'unit-ps',
      defaultShift: 'Noturno',
      workHours: '19:00 às 07:00',
      regime: '12x36_ODD',
      hourBankBalance: -12,
      active: true,
      history: [absenceRecord1],
    },
    {
      id: 'emp-9',
      name: 'Larissa Teixeira Alves',
      registrationNumber: 'MAT-11290',
      role: 'Auxiliar de Farmácia',
      unitId: 'unit-ps',
      defaultShift: 'Diurno',
      workHours: '07:00 às 19:00',
      regime: '5x2',
      hourBankBalance: 0,
      active: true,
      history: [],
    },
    {
      id: 'emp-10',
      name: 'Bruno Henrique Dias',
      registrationNumber: 'MAT-11402',
      role: 'Auxiliar de Farmácia',
      unitId: 'unit-ps',
      defaultShift: 'Noturno',
      workHours: '19:00 às 07:00',
      regime: '12x36_EVEN',
      hourBankBalance: 6,
      active: true,
      history: [],
    },
    {
      id: 'emp-11',
      name: 'Dra. Renata Silveira',
      registrationNumber: 'CRF-SP 44109',
      role: 'Farmacêutico',
      unitId: 'unit-cc',
      defaultShift: 'Diurno',
      workHours: '08:00 às 17:00',
      regime: '5x2',
      hourBankBalance: 10,
      active: true,
      history: [],
    },
    {
      id: 'emp-12',
      name: 'Thiago Ribeiro Gomes',
      registrationNumber: 'MAT-11805',
      role: 'Auxiliar de Farmácia',
      unitId: 'unit-cc',
      defaultShift: 'Diurno',
      workHours: '07:00 às 19:00',
      regime: '6x1',
      hourBankBalance: 0,
      active: true,
      history: [vacationRecord],
    },
  ];

  let schedules: MonthlyScheduleMap = {};
  schedules = generateAutomaticScheduleForMonth(employees, schedules, year, month0, false);

  // Aplica o atestado de 3 dias da Camila
  schedules = applyAbsenceToSchedules(
    schedules,
    'emp-4',
    todayIso,
    3,
    'AT',
    'Atestado Médico (CID J06.9) - 3 dias'
  );

  // Aplica a falta do Diego ontem
  schedules = applyAbsenceToSchedules(
    schedules,
    'emp-8',
    yesterdayIso,
    1,
    'FA',
    'Falta injustificada no plantão noturno'
  );

  // Aplica as férias do Thiago
  schedules = applyAbsenceToSchedules(
    schedules,
    'emp-12',
    vacationStartIso,
    7,
    'FE',
    'Férias regulamentares'
  );

  return {
    manager: {
      name: 'Dr. Emerson Pereira',
      hospitalName: 'Hospital Santa Clara — Rede Integrada',
      role: 'Supervisor de Farmácia',
      sectorName: 'Farmácia',
      avatarBase64: '',
      onboardingCompleted: true,
    },
    units,
    customRoles: [],
    employees,
    schedules,
    pushConfig: {
      enabled: true,
      alertUncoveredShift1hBefore: true,
      dailySummaryAt0630: true,
      instantCertificateAlert: true,
      webhookOrVapidKey: '',
    },
    lastUpdated: new Date().toISOString(),
  };
}

function simpleHashPassword(password: string): string {
  let h = 2166136261;
  const str = `escalapro_salt_${password}`;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export const storageService = {
  loadState(): EscalaProState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return createBlankInitialState();
      }
      const parsed = JSON.parse(raw) as EscalaProState;
      if (!parsed || typeof parsed !== 'object' || !parsed.manager) {
        return createBlankInitialState();
      }
      return parsed;
    } catch (e) {
      console.error('Erro ao carregar estado do localStorage:', e);
      return createBlankInitialState();
    }
  },

  saveState(state: EscalaProState): void {
    try {
      const updated: EscalaProState = {
        ...state,
        lastUpdated: new Date().toISOString(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.error('Erro ao salvar estado no localStorage:', e);
    }
  },

  loadStateForUser(user: UserAccount): EscalaProState {
    try {
      const userKey = `${USER_STATE_PREFIX}${user.uid}`;
      const raw = localStorage.getItem(userKey);
      if (raw) {
        const parsed = JSON.parse(raw) as EscalaProState;
        if (parsed && typeof parsed === 'object' && parsed.manager) {
          return parsed;
        }
      }

      // Cria estado inicial exclusivamente com os dados escolhidos pelo usuário no cadastro
      const initial = createBlankInitialState();
      const userUnits =
        user.units && user.units.length > 0
          ? user.units
          : [];
      const hasCompleteSetup = Boolean(
        user.name &&
          user.hospitalName &&
          user.sectorName &&
          user.role &&
          userUnits.length > 0
      );

      const initializedState: EscalaProState = {
        ...initial,
        manager: {
          ...initial.manager,
          name: user.name || '',
          hospitalName: user.hospitalName || '',
          role: user.role || '',
          sectorName: user.sectorName || '',
          onboardingCompleted: hasCompleteSetup,
        },
        units: userUnits,
        lastUpdated: new Date().toISOString(),
      };
      localStorage.setItem(userKey, JSON.stringify(initializedState));
      return initializedState;
    } catch (e) {
      console.error('Erro ao carregar estado do usuário:', e);
      return createBlankInitialState();
    }
  },

  saveStateForUser(userId: string, state: EscalaProState): void {
    try {
      const updated: EscalaProState = {
        ...state,
        lastUpdated: new Date().toISOString(),
      };
      localStorage.setItem(`${USER_STATE_PREFIX}${userId}`, JSON.stringify(updated));
    } catch (e) {
      console.error('Erro ao salvar estado do usuário:', e);
    }
  },

  listRegisteredAccounts(): LocalRegisteredAccount[] {
    try {
      const raw = localStorage.getItem(ACCOUNTS_LIST_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // Garante zero contas duplicadas com o mesmo e-mail (prioriza contas Firebase)
      const byEmail = new Map<string, LocalRegisteredAccount>();
      for (const acc of parsed as LocalRegisteredAccount[]) {
        if (!acc || !acc.email) continue;
        const emailKey = acc.email.trim().toLowerCase();
        const prev = byEmail.get(emailKey);
        if (!prev || (!prev.authMode?.startsWith('firebase') && acc.authMode?.startsWith('firebase'))) {
          byEmail.set(emailKey, acc);
        }
      }
      return Array.from(byEmail.values());
    } catch {
      return [];
    }
  },

  saveRegisteredAccountMetadata(account: UserAccount): void {
    try {
      const cleanEmail = (account.email || '').trim().toLowerCase();
      const accounts = this.listRegisteredAccounts().filter(
        (a) => a.uid !== account.uid && a.email.trim().toLowerCase() !== cleanEmail
      );
      accounts.unshift({
        ...account,
        email: cleanEmail || account.email,
        passwordHash: '',
      });
      localStorage.setItem(ACCOUNTS_LIST_KEY, JSON.stringify(accounts));
    } catch (e) {
      console.error('Erro ao atualizar metadados da conta:', e);
    }
  },

  findLegacyLocalAccountByEmail(email: string, password: string): LocalRegisteredAccount | null {
    const cleanEmail = email.trim().toLowerCase();
    const accounts = this.listRegisteredAccounts();
    const found = accounts.find(
      (a) =>
        a.email.toLowerCase() === cleanEmail &&
        a.authMode === 'account-credentials' &&
        a.uid.startsWith('usr_')
    );
    if (!found) return null;
    if (found.passwordHash && found.passwordHash !== simpleHashPassword(password)) {
      return null;
    }
    return found;
  },

  /**
   * Procura dados salvos localmente em outra chave de conta no mesmo aparelho (ex: conta local usr_... anterior)
   * para evitar que o usuário precise configurar tudo de novo ou perca colaboradores ao unificar na nuvem.
   */
  findOrphanedLocalWorkspace(targetUid: string): { storageKey: string; state: EscalaProState } | null {
    try {
      let best: { storageKey: string; state: EscalaProState; score: number } | null = null;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(USER_STATE_PREFIX)) continue;
        const uidFromKey = key.slice(USER_STATE_PREFIX.length);
        if (uidFromKey === targetUid) continue;
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as EscalaProState;
        if (!parsed || !parsed.manager) continue;
        const empCount = Array.isArray(parsed.employees) ? parsed.employees.length : 0;
        const unitCount = Array.isArray(parsed.units) ? parsed.units.length : 0;
        if (!parsed.manager.onboardingCompleted && empCount === 0) continue;
        const score = empCount * 100 + unitCount * 10 + (parsed.manager.onboardingCompleted ? 5 : 0);
        if (!best || score > best.score) {
          best = { storageKey: key, state: parsed, score };
        }
      }
      return best ? { storageKey: best.storageKey, state: best.state } : null;
    } catch {
      return null;
    }
  },

  removeLocalAccountRecord(uid: string): void {
    try {
      const filtered = this.listRegisteredAccounts().filter((a) => a.uid !== uid);
      localStorage.setItem(ACCOUNTS_LIST_KEY, JSON.stringify(filtered));
    } catch (e) {
      console.error('Erro ao remover registro local migrado:', e);
    }
  },

  registerNewAccount(params: {
    name: string;
    email: string;
    password: string;
    hospitalName: string;
    sectorName: string;
    role: string;
    units: HospitalUnit[];
  }): UserAccount {
    const cleanEmail = params.email.trim().toLowerCase();
    if (!cleanEmail || !params.password) {
      throw new Error('Informe um e-mail e uma senha válidos.');
    }

    const accounts = this.listRegisteredAccounts();
    const existing = accounts.find((a) => a.email.toLowerCase() === cleanEmail);
    if (existing) {
      throw new Error('Já existe um usuário cadastrado com este e-mail. Use a aba "Entrar".');
    }

    const uid = `usr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const newAccount: LocalRegisteredAccount = {
      uid,
      name: params.name.trim(),
      email: cleanEmail,
      authMode: 'account-credentials',
      hospitalName: params.hospitalName.trim(),
      sectorName: params.sectorName.trim(),
      role: params.role.trim(),
      units: params.units,
      passwordHash: simpleHashPassword(params.password),
      createdAt: new Date().toISOString(),
    };

    accounts.push(newAccount);
    localStorage.setItem(ACCOUNTS_LIST_KEY, JSON.stringify(accounts));

    const { passwordHash: _, ...publicAccount } = newAccount;
    this.setActiveSessionAccount(publicAccount);
    return publicAccount;
  },

  loginWithCredentials(email: string, password: string): UserAccount {
    const cleanEmail = email.trim().toLowerCase();
    const accounts = this.listRegisteredAccounts();
    const found = accounts.find((a) => a.email.toLowerCase() === cleanEmail);
    if (!found) {
      throw new Error('E-mail não encontrado. Cadastre sua conta primeiro.');
    }
    if (found.passwordHash && found.passwordHash !== simpleHashPassword(password)) {
      throw new Error('Senha incorreta. Tente novamente.');
    }
    const { passwordHash: _, ...publicAccount } = found;
    this.setActiveSessionAccount(publicAccount);
    return publicAccount;
  },

  getActiveSessionAccount(): UserAccount | null {
    try {
      const raw = localStorage.getItem(ACTIVE_SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as UserAccount;
      if (!parsed || !parsed.uid) return null;
      return parsed;
    } catch {
      return null;
    }
  },

  setActiveSessionAccount(account: UserAccount | null): void {
    try {
      if (!account) {
        localStorage.removeItem(ACTIVE_SESSION_KEY);
      } else {
        localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(account));
      }
    } catch (e) {
      console.error('Erro ao salvar sessão ativa:', e);
    }
  },

  exportBackupJson(state: EscalaProState): void {
    const dataStr = JSON.stringify(state, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateTag = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `escalapro-backup-${dateTag}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  validateAndParseBackupJson(rawJson: string): EscalaProState {
    const parsed = JSON.parse(rawJson) as EscalaProState;
    if (!parsed.manager || !Array.isArray(parsed.units) || !Array.isArray(parsed.employees)) {
      throw new Error('Arquivo JSON inválido ou incompatível com a estrutura do EscalaPro.');
    }
    return parsed;
  },
};
