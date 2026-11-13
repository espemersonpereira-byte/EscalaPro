export type PageId =
  | 'inicio'
  | 'escala'
  | 'colaboradores'
  | 'banco_horas'
  | 'importar'
  | 'configuracoes';

export type ShiftStatus = 'D' | 'N' | 'F' | 'AT' | 'FA' | 'FE' | 'TR';

export type ScheduleRegime = '12x36_ODD' | '12x36_EVEN' | '5x2' | '6x1';

export type UnitShiftMode = 'DIURNO' | 'NOTURNO' | '24H';

export interface HospitalUnit {
  id: string;
  name: string;
  shiftMode: UnitShiftMode;
  minStaffDay: number;
  minStaffNight: number;
}

export interface ManagerProfile {
  name: string;
  hospitalName: string;
  role: string;
  sectorName: string;
  avatarBase64: string;
  onboardingCompleted: boolean;
}

export interface UserAccount {
  uid: string;
  name: string;
  email: string;
  photoURL?: string;
  authMode: 'firebase-google' | 'firebase-email' | 'account-credentials';
  emailVerified?: boolean;
  hospitalName?: string;
  sectorName?: string;
  role?: string;
  units?: HospitalUnit[];
  createdAt: string;
}

export interface LocalRegisteredAccount extends UserAccount {
  passwordHash: string;
}

export interface AbsenceRecord {
  id: string;
  employeeId: string;
  type: 'FOLGA' | 'FALTA' | 'ATESTADO' | 'FERIAS' | 'TROCA' | 'HORA_EXTRA' | 'DECLARACAO_HORAS';
  startDate: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  nextShiftDate?: string; // YYYY-MM-DD (próximo plantão calculado mediante a escala)
  daysCount: number;
  shift?: 'Diurno' | 'Noturno';
  reason: string;
  cid?: string;
  attachmentName?: string;
  attachmentBase64?: string;
  attachmentMimeType?: string;
  swapPartnerId?: string;
  swapPartnerName?: string;
  swapReturnDate?: string;
  extraHours?: number;
  createdAt: string;
}

export interface LeaveCalculationSummary {
  startDateIso: string;
  startDateFormatted: string;
  endDateIso: string;
  endDateFormatted: string;
  returnAvailableDateIso: string;
  returnAvailableDateFormatted: string;
  nextShiftDateIso: string;
  nextShiftDateFormatted: string;
  nextShiftCode: ShiftStatus;
  nextShiftLabel: string;
  daysCount: number;
  affectedWorkShiftsCount: number;
  coveredDaysDetails: {
    iso: string;
    shortDate: string;
    weekday: string;
    originalStatus: ShiftStatus;
  }[];
}

export interface Employee {
  id: string;
  name: string;
  registrationNumber: string; // COREN / CRF / CRM / Matrícula
  role: string;
  unitId: string;
  defaultShift: 'Diurno' | 'Noturno';
  workHours: string; // ex: "07:00 às 19:00"
  regime: ScheduleRegime;
  hourBankBalance: number; // em horas, ex: +12 ou -6
  avatarBase64?: string;
  active: boolean;
  history: AbsenceRecord[];
}

export interface ScheduleCellData {
  status: ShiftStatus;
  note?: string;
  swapWithEmployeeId?: string;
  swapWithEmployeeName?: string;
  swapReturnDate?: string;
  extraHours?: number;
  unitOverrideId?: string;
}

// Mapa: "YYYY-MM" -> employeeId -> dayNumber (1..31) -> ScheduleCellData
export type MonthlyScheduleMap = Record<string, Record<string, Record<number, ScheduleCellData>>>;

export interface PushNotificationConfig {
  enabled: boolean;
  alertUncoveredShift1hBefore: boolean;
  dailySummaryAt0630: boolean;
  instantCertificateAlert: boolean;
  webhookOrVapidKey: string;
}

export interface EscalaProState {
  manager: ManagerProfile;
  units: HospitalUnit[];
  customRoles: string[];
  employees: Employee[];
  schedules: MonthlyScheduleMap;
  pushConfig: PushNotificationConfig;
  lastUpdated: string;
}

export interface NavigationContext {
  activePage: PageId;
  collaboratorStatusFilter: 'TODOS' | 'ATIVOS' | 'EM_ATESTADO' | 'COM_FALTAS' | 'FERIAS';
  selectedUnitFilter: string; // 'TODAS' ou unitId
  selectedShiftFilter: 'TODOS' | 'Diurno' | 'Noturno';
  selectedRoleFilter: string; // 'TODAS' ou role
  onlyUncoveredDaysInSchedule: boolean;
  selectedEmployeeId: string | null;
  highlightAbsencesReport: boolean;
}

export interface ExtractedPdfEmployee {
  name: string;
  roleHint: string;
  unitHint: string;
  shiftHint: 'Diurno' | 'Noturno';
  workHoursHint: string;
  scheduleRegimeHint: ScheduleRegime;
  registrationNumber?: string;
  notes?: string;
}

export interface ExtractedHourBankEntry {
  name: string;
  hoursBalance: number;
  formattedOriginal?: string;
  unitHint?: string;
  roleHint?: string;
  registrationNumber?: string;
  notes?: string;
}

export const PRE_REGISTERED_MANAGER_ROLES: string[] = [
  'Supervisor de Farmácia',
  'Supervisor de Almoxarifado e Recebimento',
  'Supervisor de Enfermagem',
  'Coordenador Médico',
  'Líder de Recepção',
  'Encarregado de Higienização',
  'Coordenador de Diagnóstico',
  'Coordenador de Fisioterapia',
];

export const PRE_REGISTERED_SECTORS: string[] = [
  'Farmácia',
  'Almoxarifado',
  'Recebimento',
  'Enfermagem',
  'Medicina',
  'Radiologia',
  'Recepção',
  'Higienização',
  'Fisioterapia',
  'Nutrição',
  'Laboratório',
];

export const NATIVE_HOSPITAL_ROLES: string[] = [
  'Farmacêutico',
  'Auxiliar de Farmácia',
  'Auxiliar de Almoxarifado',
  'Auxiliar de Recebimento',
  'Jovem Aprendiz',
  'Enfermeiro',
  'Técnico de Enfermagem',
  'Auxiliar de Enfermagem',
  'Médico',
  'Maqueiro',
  'Técnico de Radiologia',
  'Biomédico',
  'Fisioterapeuta',
  'Recepcionista',
  'Auxiliar Administrativo',
  'Auxiliar de Higienização',
];

export const WORK_HOURS_PRESETS: string[] = [
  '07:00 às 19:00',
  '19:00 às 07:00',
  '08:00 às 17:00',
  '08:00 às 18:00',
  '07:00 às 13:00',
  '13:00 às 19:00',
  '08:00 às 12:00',
  '13:00 às 17:00',
  '08:00 às 14:00',
  '06:00 às 14:20',
  '14:00 às 22:20',
];

export const REGIME_LABELS: Record<ScheduleRegime, string> = {
  '12x36_ODD': '12x36 Dias Ímpares',
  '12x36_EVEN': '12x36 Dias Pares',
  '5x2': '5x2 Segunda a Sexta',
  '6x1': '6x1 Escala Semanal',
};

export const SHIFT_STATUS_META: Record<
  ShiftStatus,
  {
    code: ShiftStatus;
    label: string;
    shortLabel: string;
    bgClass: string;
    textClass: string;
    borderClass: string;
  }
> = {
  D: {
    code: 'D',
    label: 'Plantão Diurno',
    shortLabel: 'Diurno',
    bgClass: 'bg-teal-600',
    textClass: 'text-white',
    borderClass: 'border-teal-700',
  },
  N: {
    code: 'N',
    label: 'Plantão Noturno',
    shortLabel: 'Noturno',
    bgClass: 'bg-indigo-700',
    textClass: 'text-white',
    borderClass: 'border-indigo-800',
  },
  F: {
    code: 'F',
    label: 'Folga Escala',
    shortLabel: 'Folga',
    bgClass: 'bg-slate-100',
    textClass: 'text-slate-600',
    borderClass: 'border-slate-200',
  },
  AT: {
    code: 'AT',
    label: 'Atestado Médico',
    shortLabel: 'Atestado',
    bgClass: 'bg-amber-500',
    textClass: 'text-white',
    borderClass: 'border-amber-600',
  },
  FA: {
    code: 'FA',
    label: 'Falta Registrada',
    shortLabel: 'Falta',
    bgClass: 'bg-red-600',
    textClass: 'text-white',
    borderClass: 'border-red-700',
  },
  FE: {
    code: 'FE',
    label: 'Férias Programadas',
    shortLabel: 'Férias',
    bgClass: 'bg-cyan-600',
    textClass: 'text-white',
    borderClass: 'border-cyan-700',
  },
  TR: {
    code: 'TR',
    label: 'Troca / Permuta',
    shortLabel: 'Permuta',
    bgClass: 'bg-violet-600',
    textClass: 'text-white',
    borderClass: 'border-violet-700',
  },
};
