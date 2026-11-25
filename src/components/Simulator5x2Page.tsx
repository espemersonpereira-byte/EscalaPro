import React, { useEffect, useMemo, useState } from 'react';
import {
  Employee,
  EscalaProState,
  ExtractedScheduleRow,
  ScheduleCycleSlot,
  SchedulePeriodViewMode,
  ScheduleRegime,
  ShiftStatus,
  WORK_HOURS_PRESETS,
} from '../types';
import {
  buildFortnightCycleSlots,
  getDaysInMonth,
  getNextYearMonth,
  getYearMonthKey,
} from '../services/storageService';
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck2,
  CalendarDays,
  CheckCircle2,
  Clock,
  Download,
  GripVertical,
  Printer,
  RefreshCw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';

interface Simulator5x2PageProps {
  state: EscalaProState;
  onApplySimulated5x2ToMainSchedule: (params: {
    rows: ExtractedScheduleRow[];
    unitId: string;
    convertSelectedTo5x2Regime: boolean;
    workHoursOverride: string;
  }) => void;
}

type LawStageId =
  | 'TRANSICAO_40H_FLEX'
  | 'NOVA_LEI_36H_CONSECUTIVAS'
  | 'COMERCIO_HOSPITALAR_DOMINGO_ALTERNADO';

interface LawStageRule {
  id: LawStageId;
  title: string;
  subtitle: string;
  maxWorkDaysPerWeek: number;
  minOffDaysPerWeek: number;
  maxConsecutiveWorkDays: number;
  requireConsecutiveOffDays: boolean;
  maxWeeklyHours: number;
  dailyShiftHours: number;
  sundayReliefEveryWeeks: number;
}

const LAW_STAGES: LawStageRule[] = [
  {
    id: 'TRANSICAO_40H_FLEX',
    title: 'Etapa 1 · Transição 6x1 → 5x2 (40h Semanais · Folgas Flexíveis)',
    subtitle:
      '5 dias trabalhados e 2 folgas por semana (consecutivas ou alternadas), máx. 6 dias seguidos e 1 domingo de folga a cada 2 semanas.',
    maxWorkDaysPerWeek: 5,
    minOffDaysPerWeek: 2,
    maxConsecutiveWorkDays: 6,
    requireConsecutiveOffDays: false,
    maxWeeklyHours: 40,
    dailyShiftHours: 8,
    sundayReliefEveryWeeks: 2,
  },
  {
    id: 'NOVA_LEI_36H_CONSECUTIVAS',
    title: 'Etapa 2 · Nova Lei 5x2 Plena (36h Semanais · 2 Folgas Consecutivas)',
    subtitle:
      'Máximo 5 dias seguidos de trabalho, 2 folgas preferencialmente juntas (ex: Sáb/Dom, Dom/Seg ou Ter/Qua) e teto de 36h semanais.',
    maxWorkDaysPerWeek: 5,
    minOffDaysPerWeek: 2,
    maxConsecutiveWorkDays: 5,
    requireConsecutiveOffDays: true,
    maxWeeklyHours: 36,
    dailyShiftHours: 7.2,
    sundayReliefEveryWeeks: 2,
  },
  {
    id: 'COMERCIO_HOSPITALAR_DOMINGO_ALTERNADO',
    title: 'Etapa 3 · Plantão 24h / 7 Dias (5x2 com Revezamento de Fim de Semana)',
    subtitle:
      'Mantém atendimento de Segunda a Domingo com 2 folgas semanais rodiziadas entre a equipe para nunca descobrir o setor.',
    maxWorkDaysPerWeek: 5,
    minOffDaysPerWeek: 2,
    maxConsecutiveWorkDays: 5,
    requireConsecutiveOffDays: false,
    maxWeeklyHours: 40,
    dailyShiftHours: 8,
    sundayReliefEveryWeeks: 2,
  },
];

// Duplas de dias de folga (0 = Dom, 1 = Seg, 2 = Ter, 3 = Qua, 4 = Qui, 5 = Sex, 6 = Sáb)
const CONSECUTIVE_OFF_PAIRS: [number, number][] = [
  [6, 0], // Sábado e Domingo
  [0, 1], // Domingo e Segunda
  [1, 2], // Segunda e Terça
  [2, 3], // Terça e Quarta
  [3, 4], // Quarta e Quinta
  [4, 5], // Quinta e Sexta
  [5, 6], // Sexta e Sábado
];

const FLEX_OFF_PAIRS: [number, number][] = [
  [6, 0], // Sáb e Dom
  [0, 3], // Dom e Qua
  [6, 2], // Sáb e Ter
  [0, 4], // Dom e Qui
  [5, 0], // Sex e Dom
  [1, 4], // Seg e Qui
  [2, 5], // Ter e Sex
];

const WEEKDAY_NAMES_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTH_NAMES_PT_BR = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

function getMonthNamePtBr(monthIndex0: number): string {
  return MONTH_NAMES_PT_BR[monthIndex0] || 'Mês';
}

function getWeekdayIndex(year: number, monthIndex0: number, day: number): number {
  return new Date(year, monthIndex0, day).getDay();
}

function inferCycleStartMonthAndYear(date: Date): { year: number; month0: number } {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  if (d <= 15) {
    if (m === 0) return { year: y - 1, month0: 11 };
    return { year: y, month0: m - 1 };
  }
  return { year: y, month0: m };
}

function formatCycleRangeTitle(year: number, month0: number): string {
  const totalInStart = getDaysInMonth(year, month0);
  const next = getNextYearMonth(year, month0);
  const m1 = String(month0 + 1).padStart(2, '0');
  const m2 = String(next.monthIndex0 + 1).padStart(2, '0');
  return `16/${m1} a ${totalInStart}/${m1} e 01/${m2} a 15/${m2} (${getMonthNamePtBr(
    month0
  )} / ${getMonthNamePtBr(next.monthIndex0)})`;
}

interface SimulatedEmployee {
  id: string;
  name: string;
  role: string;
  unitId: string;
  currentRegime: ScheduleRegime;
  defaultShift: 'Diurno' | 'Noturno';
  workHours: string;
  selected: boolean;
  isVirtual?: boolean;
}

interface ComplianceIssue {
  id: string;
  severity: 'ERROR' | 'WARNING';
  category: 'COBERTURA' | 'EXCESSO_DIAS_SEMANA' | 'DIAS_CONSECUTIVOS' | 'DOMINGO' | 'CARGA_HORARIA';
  title: string;
  detail: string;
  slotKey?: string;
  employeeId?: string;
}

export const Simulator5x2Page: React.FC<Simulator5x2PageProps> = ({
  state,
  onApplySimulated5x2ToMainSchedule,
}) => {
  const initialCycle = useMemo(() => inferCycleStartMonthAndYear(new Date()), []);
  const [selectedYear, setSelectedYear] = useState<number>(initialCycle.year);
  const [selectedMonth0, setSelectedMonth0] = useState<number>(initialCycle.month0);
  const [periodMode, setPeriodMode] = useState<SchedulePeriodViewMode>('CYCLE_16_15_FULL');

  // Passo 1: Descrição da Operação
  const [selectedUnitId, setSelectedUnitId] = useState<string>(
    () => state.units[0]?.id || 'unit-default-1'
  );
  const [lawStageId, setLawStageId] = useState<LawStageId>('NOVA_LEI_36H_CONSECUTIVAS');
  const [operationWorkHours, setOperationWorkHours] = useState<string>('08:00 às 17:00');
  const [shiftCodeToAssign, setShiftCodeToAssign] = useState<'D' | 'N'>('D');

  // Dias de atendimento da operação (0 = Dom .. 6 = Sáb) e Mínimo de pessoas por dia da semana
  const [operatingDays, setOperatingDays] = useState<Record<number, boolean>>({
    0: true, // Dom
    1: true, // Seg
    2: true, // Ter
    3: true, // Qua
    4: true, // Qui
    5: true, // Sex
    6: true, // Sáb
  });
  const [minStaffByWeekday, setMinStaffByWeekday] = useState<Record<number, number>>({
    0: 2, // Dom
    1: 3, // Seg
    2: 3, // Ter
    3: 3, // Qua
    4: 3, // Qui
    5: 3, // Sex
    6: 2, // Sáb
  });

  // Colaboradores incluídos na simulação (pré-seleciona 6x1 e 5x2 da unidade escolhida)
  const [simEmployees, setSimEmployees] = useState<SimulatedEmployee[]>([]);
  const [virtualCounter, setVirtualCounter] = useState<number>(1);

  // Grade simulada: employeeId -> slot.isoDate -> ShiftStatus ('D' | 'N' | 'F')
  const [simGrid, setSimGrid] = useState<Record<string, Record<string, ShiftStatus>>>({});

  // Estado de Drag-and-Drop (Arraste o que precisar)
  const [draggedCell, setDraggedCell] = useState<{
    employeeId: string;
    isoDate: string;
    status: ShiftStatus;
  } | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<{
    employeeId: string;
    isoDate: string;
  } | null>(null);

  // Feedback e confirmação de aplicação na escala oficial
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);
  const [convertRegimeTo5x2OnApply, setConvertRegimeTo5x2OnApply] = useState<boolean>(true);

  const activeLawRule = useMemo(
    () => LAW_STAGES.find((s) => s.id === lawStageId) || LAW_STAGES[1],
    [lawStageId]
  );

  // Slots do período selecionado (Ciclo Quinzenal 16..15 ou Mês Civil 01..30/31)
  const cycleSlots: ScheduleCycleSlot[] = useMemo(() => {
    if (periodMode === 'CALENDAR_MONTH') {
      const total = getDaysInMonth(selectedYear, selectedMonth0);
      const ymKey = getYearMonthKey(selectedYear, selectedMonth0);
      return Array.from({ length: total }, (_, idx) => {
        const d = idx + 1;
        const mm = String(selectedMonth0 + 1).padStart(2, '0');
        const dd = String(d).padStart(2, '0');
        return {
          year: selectedYear,
          monthIndex0: selectedMonth0,
          day: d,
          ymKey,
          isoDate: `${selectedYear}-${mm}-${dd}`,
          shortDateLabel: `${dd}/${mm}`,
          fortnightPart: (d <= 15 ? 2 : 1) as 1 | 2,
        };
      });
    }
    const allSlots = buildFortnightCycleSlots(selectedYear, selectedMonth0);
    if (periodMode === 'FORTNIGHT_16_END') {
      return allSlots.filter((s) => s.fortnightPart === 1);
    }
    if (periodMode === 'FORTNIGHT_01_15') {
      return allSlots.filter((s) => s.fortnightPart === 2);
    }
    return allSlots;
  }, [selectedYear, selectedMonth0, periodMode]);

  // Sincroniza lista de funcionários ao trocar de setor ou carregar a página
  useEffect(() => {
    const activeInSystem = state.employees.filter((e) => e.active);
    const unitEmps = activeInSystem.filter(
      (e) => selectedUnitId === 'TODAS' || e.unitId === selectedUnitId
    );
    const sourceList = unitEmps.length > 0 ? unitEmps : activeInSystem;

    // Prioriza quem é 6x1 ou 5x2; se todos forem 12x36, seleciona os primeiros da unidade para permitir simular
    const has6x1Or5x2 = sourceList.some(
      (e) => e.regime === '6x1' || e.regime === '5x2'
    );

    const mapped: SimulatedEmployee[] = sourceList.map((e) => ({
      id: e.id,
      name: e.name,
      role: e.role,
      unitId: e.unitId,
      currentRegime: e.regime,
      defaultShift: e.defaultShift,
      workHours: e.workHours || '08:00 às 17:00',
      selected: has6x1Or5x2
        ? e.regime === '6x1' || e.regime === '5x2'
        : true,
    }));

    setSimEmployees(mapped);
  }, [selectedUnitId, state.employees]);

  const selectedSimEmployees = useMemo(
    () => simEmployees.filter((e) => e.selected),
    [simEmployees]
  );

  // Calcula quantos colaboradores são recomendados matematicamente para cobrir a operação em 5x2
  const staffingMathSummary = useMemo(() => {
    let totalRequiredShiftsPerWeek = 0;
    let maxDailyMin = 0;
    for (let wd = 0; wd < 7; wd++) {
      if (operatingDays[wd]) {
        const minForDay = Number(minStaffByWeekday[wd]) || 0;
        totalRequiredShiftsPerWeek += minForDay;
        if (minForDay > maxDailyMin) maxDailyMin = minForDay;
      }
    }
    // Cada colaborador 5x2 entrega no máximo 5 plantões por semana
    const minEmployeesFor5x2 = Math.max(
      maxDailyMin,
      Math.ceil(totalRequiredShiftsPerWeek / activeLawRule.maxWorkDaysPerWeek)
    );
    // Comparativo com 6x1 (onde cada colaborador entregava 6 plantões por semana)
    const minEmployeesInOld6x1 = Math.max(
      maxDailyMin,
      Math.ceil(totalRequiredShiftsPerWeek / 6)
    );

    const deficit = Math.max(0, minEmployeesFor5x2 - selectedSimEmployees.length);

    return {
      totalRequiredShiftsPerWeek,
      minEmployeesFor5x2,
      minEmployeesInOld6x1,
      deficit,
      extraStaffNeededForTransition: Math.max(0, minEmployeesFor5x2 - minEmployeesInOld6x1),
    };
  }, [operatingDays, minStaffByWeekday, activeLawRule, selectedSimEmployees.length]);

  // Algoritmo de distribuição 5x2 inteligente:
  // Distribui 5 dias de trabalho e 2 folgas por semana equilibrando a cobertura diária e revezamento de domingos
  const generateSimulated5x2Grid = () => {
    if (selectedSimEmployees.length === 0 || cycleSlots.length === 0) return;

    const nextGrid: Record<string, Record<string, ShiftStatus>> = {};
    for (const emp of selectedSimEmployees) {
      nextGrid[emp.id] = {};
    }

    // Divide os slots em blocos semanais de 7 dias para garantir exatamente 5x2 por semana e revezamento de domingo
    const pairsPool = activeLawRule.requireConsecutiveOffDays
      ? CONSECUTIVE_OFF_PAIRS
      : FLEX_OFF_PAIRS;

    // Mapa auxiliar de cobertura acumulada por data
    const coverageCountByIso: Record<string, number> = {};
    for (const slot of cycleSlots) {
      coverageCountByIso[slot.isoDate] = 0;
    }

    // Agrupa os slots em semanas corridas (blocos iniciando na Segunda-feira ou fatias de 7 dias)
    const weekBlocks: typeof cycleSlots[] = [];
    let currentBlock: typeof cycleSlots = [];
    for (const slot of cycleSlots) {
      const wd = getWeekdayIndex(slot.year, slot.monthIndex0, slot.day);
      if (wd === 1 && currentBlock.length > 0) {
        weekBlocks.push(currentBlock);
        currentBlock = [];
      }
      currentBlock.push(slot);
    }
    if (currentBlock.length > 0) {
      weekBlocks.push(currentBlock);
    }

    // Para cada semana e cada colaborador, escolhe a melhor dupla de folgas que:
    // 1. Respeita dias em que a operação está fechada (folga automática nesses dias)
    // 2. Prioriza colocar o colaborador trabalhando nos dias com maior déficit em relação ao mínimo
    // 3. Alterna o domingo de folga a cada 2 semanas
    weekBlocks.forEach((weekSlots, weekIdx) => {
      selectedSimEmployees.forEach((emp, empIdx) => {
        // Verifica quais dias da semana existem neste bloco e estão com operação aberta
        const closedWeekdays = new Set<number>();
        for (let wd = 0; wd < 7; wd++) {
          if (!operatingDays[wd]) closedWeekdays.add(wd);
        }

        // Escolhe par de folgas candidatando todos os pares da etapa da lei
        let bestOffSet = new Set<number>(closedWeekdays);

        if (bestOffSet.size < activeLawRule.minOffDaysPerWeek) {
          // Pontua cada dupla de folga para maximizar cobertura nos dias mais carentes
          let bestScore = -999999;
          const rotatedOffset = (empIdx + weekIdx * 2) % pairsPool.length;

          for (let p = 0; p < pairsPool.length; p++) {
            const pairIdx = (rotatedOffset + p) % pairsPool.length;
            const candidatePair = pairsPool[pairIdx];
            const offSet = new Set<number>([...closedWeekdays, ...candidatePair]);

            // Se passou de 2 folgas por causa de dia fechado, mantém o dia fechado + 1 dia do par
            if (offSet.size > activeLawRule.minOffDaysPerWeek) {
              const trimmed = new Set<number>(closedWeekdays);
              for (const d of candidatePair) {
                if (trimmed.size < activeLawRule.minOffDaysPerWeek) trimmed.add(d);
              }
              offSet.clear();
              trimmed.forEach((d) => offSet.add(d));
            }

            let score = 0;
            // Bônus se dá domingo de folga na semana par/ímpar do colaborador (revezamento de domingo)
            const shouldHaveSundayOff = (empIdx + weekIdx) % activeLawRule.sundayReliefEveryWeeks === 0;
            if (shouldHaveSundayOff && offSet.has(0)) {
              score += 25;
            }

            // Avalia impacto na cobertura diária daquela semana
            for (const slot of weekSlots) {
              const wd = getWeekdayIndex(slot.year, slot.monthIndex0, slot.day);
              const minNeeded = operatingDays[wd] ? Number(minStaffByWeekday[wd]) || 0 : 0;
              const currentStaff = coverageCountByIso[slot.isoDate] || 0;
              const isOff = offSet.has(wd);

              if (!isOff && operatingDays[wd]) {
                // Trabalhar em dia abaixo do mínimo vale muito
                if (currentStaff < minNeeded) {
                  score += (minNeeded - currentStaff) * 40;
                } else {
                  score += 4;
                }
              } else if (isOff && operatingDays[wd]) {
                // Folgar em dia que já bateu o mínimo é ótimo
                if (currentStaff >= minNeeded) {
                  score += 15;
                } else {
                  score -= (minNeeded - currentStaff) * 20;
                }
              }
            }

            // Evita mais de maxConsecutiveWorkDays seguidos na transição com a semana anterior
            let streak = 0;
            // Olha últimos dias anteriores a esta semana
            const firstSlotIdx = cycleSlots.findIndex((s) => s.isoDate === weekSlots[0].isoDate);
            for (let back = firstSlotIdx - 1; back >= 0 && back >= firstSlotIdx - 6; back--) {
              const prevIso = cycleSlots[back].isoDate;
              if (nextGrid[emp.id][prevIso] === 'D' || nextGrid[emp.id][prevIso] === 'N') {
                streak++;
              } else {
                break;
              }
            }
            let maxStreakInCandidate = streak;
            for (const slot of weekSlots) {
              const wd = getWeekdayIndex(slot.year, slot.monthIndex0, slot.day);
              if (!offSet.has(wd) && operatingDays[wd]) {
                streak++;
                if (streak > maxStreakInCandidate) maxStreakInCandidate = streak;
              } else {
                streak = 0;
              }
            }
            if (maxStreakInCandidate > activeLawRule.maxConsecutiveWorkDays) {
              score -= (maxStreakInCandidate - activeLawRule.maxConsecutiveWorkDays) * 65;
            }

            if (score > bestScore) {
              bestScore = score;
              bestOffSet = offSet;
            }
          }
        }

        // Aplica os turnos da semana para o colaborador
        for (const slot of weekSlots) {
          const wd = getWeekdayIndex(slot.year, slot.monthIndex0, slot.day);
          const isOff = !operatingDays[wd] || bestOffSet.has(wd);
          const assignedCode: ShiftStatus = isOff
            ? 'F'
            : emp.defaultShift === 'Noturno' && shiftCodeToAssign === 'N'
            ? 'N'
            : shiftCodeToAssign;

          nextGrid[emp.id][slot.isoDate] = assignedCode;
          if (assignedCode === 'D' || assignedCode === 'N') {
            coverageCountByIso[slot.isoDate] = (coverageCountByIso[slot.isoDate] || 0) + 1;
          }
        }
      });
    });

    setSimGrid(nextGrid);
  };

  // Gera automaticamente na primeira montagem quando os funcionários são carregados
  useEffect(() => {
    if (selectedSimEmployees.length > 0 && Object.keys(simGrid).length === 0) {
      generateSimulated5x2Grid();
    }
  }, [selectedSimEmployees.length]);

  // Alternar célula com clique (Plantão <-> Folga)
  const handleToggleCell = (empId: string, isoDate: string) => {
    setSimGrid((prev) => {
      const current = prev[empId]?.[isoDate] || 'F';
      const nextStatus: ShiftStatus =
        current === 'F' ? shiftCodeToAssign : 'F';
      return {
        ...prev,
        [empId]: {
          ...(prev[empId] || {}),
          [isoDate]: nextStatus,
        },
      };
    });
  };

  // Arrastar e soltar (Drag & Drop) entre dias ou entre colaboradores para ajustar folgas e plantões
  const handleDropCell = (targetEmpId: string, targetIsoDate: string) => {
    if (!draggedCell) return;
    const { employeeId: srcEmpId, isoDate: srcIsoDate, status: srcStatus } = draggedCell;
    if (srcEmpId === targetEmpId && srcIsoDate === targetIsoDate) {
      setDraggedCell(null);
      setDragOverTarget(null);
      return;
    }

    setSimGrid((prev) => {
      const targetCurrentStatus = prev[targetEmpId]?.[targetIsoDate] || 'F';
      const next = { ...prev };
      next[srcEmpId] = { ...(next[srcEmpId] || {}), [srcIsoDate]: targetCurrentStatus };
      next[targetEmpId] = { ...(next[targetEmpId] || {}), [targetIsoDate]: srcStatus };
      return next;
    });

    setDraggedCell(null);
    setDragOverTarget(null);
  };

  // Adiciona um colaborador simulado ("Vaga Nova 5x2") para testar quantos funcionários extras seriam necessários
  const handleAddVirtualEmployee = () => {
    const newId = `sim-virtual-${Date.now()}-${virtualCounter}`;
    const newVirtual: SimulatedEmployee = {
      id: newId,
      name: `Nova Vaga 5x2 #${virtualCounter}`,
      role: state.employees[0]?.role || 'Auxiliar de Farmácia',
      unitId: selectedUnitId === 'TODAS' ? state.units[0]?.id || 'unit-default-1' : selectedUnitId,
      currentRegime: '5x2',
      defaultShift: shiftCodeToAssign === 'N' ? 'Noturno' : 'Diurno',
      workHours: operationWorkHours,
      selected: true,
      isVirtual: true,
    };
    setVirtualCounter((c) => c + 1);
    setSimEmployees((prev) => [...prev, newVirtual]);
    setTimeout(() => generateSimulated5x2Grid(), 40);
  };

  // Cobertura por dia e Painel de Conformidade da Nova Lei 5x2
  const { dailyCoverageMap, employeeStatsMap, complianceIssues } = useMemo(() => {
    const covMap: Record<
      string,
      { workingCount: number; minRequired: number; isOperating: boolean; isDeficit: boolean }
    > = {};
    const empStats: Record<
      string,
      {
        workDays: number;
        offDays: number;
        maxConsecutiveWorked: number;
        sundaysOff: number;
        totalSundays: number;
        estimatedWeeklyHours: number;
        hasViolation: boolean;
      }
    > = {};
    const issues: ComplianceIssue[] = [];

    // 1. Verifica cobertura dia a dia
    for (const slot of cycleSlots) {
      const wd = getWeekdayIndex(slot.year, slot.monthIndex0, slot.day);
      const isOp = Boolean(operatingDays[wd]);
      const minReq = isOp ? Number(minStaffByWeekday[wd]) || 0 : 0;
      let count = 0;

      for (const emp of selectedSimEmployees) {
        const st = simGrid[emp.id]?.[slot.isoDate] || 'F';
        if (st === 'D' || st === 'N') count++;
      }

      const isDeficit = isOp && count < minReq;
      covMap[slot.isoDate] = {
        workingCount: count,
        minRequired: minReq,
        isOperating: isOp,
        isDeficit,
      };

      if (isDeficit) {
        issues.push({
          id: `cov-${slot.isoDate}`,
          severity: 'ERROR',
          category: 'COBERTURA',
          title: `Cobertura abaixo do mínimo em ${slot.shortDateLabel} (${WEEKDAY_NAMES_SHORT[wd]})`,
          detail: `Escalados: ${count} · Mínimo exigido: ${minReq} pessoa(s). Arraste uma folga ou adicione colaborador.`,
          slotKey: slot.isoDate,
        });
      }
    }

    // 2. Verifica conformidade trabalhista 5x2 por colaborador
    const totalWeeksInPeriod = Math.max(1, cycleSlots.length / 7);

    for (const emp of selectedSimEmployees) {
      let workDays = 0;
      let offDays = 0;
      let currentStreak = 0;
      let maxStreak = 0;
      let sundaysOff = 0;
      let totalSundays = 0;
      let empHasViolation = false;

      // Verifica blocos de 7 dias (Seg a Dom) para checar se cada semana tem pelo menos 2 folgas e no máx 5 dias trabalhados
      let weekWorkCount = 0;
      let weekDaysSeen = 0;

      for (const slot of cycleSlots) {
        const wd = getWeekdayIndex(slot.year, slot.monthIndex0, slot.day);
        const st = simGrid[emp.id]?.[slot.isoDate] || 'F';
        const isWorking = st === 'D' || st === 'N';

        if (wd === 1 && weekDaysSeen > 0) {
          if (weekDaysSeen === 7 && weekWorkCount > activeLawRule.maxWorkDaysPerWeek) {
            empHasViolation = true;
            issues.push({
              id: `week-max-${emp.id}-${slot.isoDate}`,
              severity: 'ERROR',
              category: 'EXCESSO_DIAS_SEMANA',
              title: `${emp.name}: trabalhou ${weekWorkCount} dias na mesma semana`,
              detail: `A regra 5x2 permite no máximo ${activeLawRule.maxWorkDaysPerWeek} dias trabalhados e exige ${activeLawRule.minOffDaysPerWeek} folgas na semana.`,
              employeeId: emp.id,
            });
          }
          weekWorkCount = 0;
          weekDaysSeen = 0;
        }

        weekDaysSeen++;
        if (isWorking) {
          workDays++;
          weekWorkCount++;
          currentStreak++;
          if (currentStreak > maxStreak) maxStreak = currentStreak;
        } else {
          offDays++;
          currentStreak = 0;
        }

        if (wd === 0) {
          totalSundays++;
          if (!isWorking) sundaysOff++;
        }
      }

      if (weekDaysSeen === 7 && weekWorkCount > activeLawRule.maxWorkDaysPerWeek) {
        empHasViolation = true;
        issues.push({
          id: `week-max-end-${emp.id}`,
          severity: 'ERROR',
          category: 'EXCESSO_DIAS_SEMANA',
          title: `${emp.name}: trabalhou ${weekWorkCount} dias na última semana`,
          detail: `Conceda pelo menos ${activeLawRule.minOffDaysPerWeek} folgas na semana para cumprir a jornada 5x2.`,
          employeeId: emp.id,
        });
      }

      if (maxStreak > activeLawRule.maxConsecutiveWorkDays) {
        empHasViolation = true;
        issues.push({
          id: `streak-${emp.id}`,
          severity: 'ERROR',
          category: 'DIAS_CONSECUTIVOS',
          title: `${emp.name}: ${maxStreak} dias seguidos sem folga`,
          detail: `O limite desta etapa da lei é de no máximo ${activeLawRule.maxConsecutiveWorkDays} dias consecutivos de trabalho.`,
          employeeId: emp.id,
        });
      }

      if (totalSundays >= 2 && sundaysOff === 0) {
        empHasViolation = true;
        issues.push({
          id: `sunday-${emp.id}`,
          severity: 'WARNING',
          category: 'DOMINGO',
          title: `${emp.name}: nenhum domingo de folga no período`,
          detail: `Garanta pelo menos 1 domingo de folga a cada ${activeLawRule.sundayReliefEveryWeeks} semanas no revezamento.`,
          employeeId: emp.id,
        });
      }

      const avgWorkDaysPerWeek = workDays / totalWeeksInPeriod;
      const estimatedWeeklyHours =
        Math.round(avgWorkDaysPerWeek * activeLawRule.dailyShiftHours * 10) / 10;

      if (estimatedWeeklyHours > activeLawRule.maxWeeklyHours + 1) {
        issues.push({
          id: `hours-${emp.id}`,
          severity: 'WARNING',
          category: 'CARGA_HORARIA',
          title: `${emp.name}: média de ${estimatedWeeklyHours}h/semana`,
          detail: `Acima da referência de ${activeLawRule.maxWeeklyHours}h semanais da etapa selecionada.`,
          employeeId: emp.id,
        });
      }

      empStats[emp.id] = {
        workDays,
        offDays,
        maxConsecutiveWorked: maxStreak,
        sundaysOff,
        totalSundays,
        estimatedWeeklyHours,
        hasViolation: empHasViolation,
      };
    }

    return {
      dailyCoverageMap: covMap,
      employeeStatsMap: empStats,
      complianceIssues: issues,
    };
  }, [
    cycleSlots,
    operatingDays,
    minStaffByWeekday,
    selectedSimEmployees,
    simGrid,
    activeLawRule,
  ]);

  // Exporta a simulação 5x2 para CSV (compatível com Excel)
  const handleExportSimulatedCsv = () => {
    const dayHeaders = cycleSlots.map((slot) => {
      const wd = getWeekdayIndex(slot.year, slot.monthIndex0, slot.day);
      return `"${slot.shortDateLabel} (${WEEKDAY_NAMES_SHORT[wd]})"`;
    });

    const headers = [
      '"Colaborador"',
      '"Cargo"',
      '"Regime Atual"',
      '"Novo Regime Simulado"',
      '"Horário"',
      ...dayHeaders,
      '"Dias Trabalhados"',
      '"Folgas no Período"',
      '"Média Horas/Sem"',
    ];

    const rows = selectedSimEmployees.map((emp) => {
      const st = employeeStatsMap[emp.id];
      const dayCells = cycleSlots.map((slot) => {
        const code = simGrid[emp.id]?.[slot.isoDate] || 'F';
        return `"${code}"`;
      });

      return [
        `"${emp.name.replace(/"/g, '""')}"`,
        `"${emp.role.replace(/"/g, '""')}"`,
        `"${emp.currentRegime}"`,
        '"5x2 Nova Lei"',
        `"${operationWorkHours}"`,
        ...dayCells,
        String(st?.workDays || 0),
        String(st?.offDays || 0),
        String(st?.estimatedWeeklyHours || 0).replace('.', ','),
      ].join(';');
    });

    // Linha final com total de cobertura por dia
    const coverageRow = [
      '"TOTAL EM ATENDIMENTO NO DIA"',
      '""',
      '""',
      '""',
      '""',
      ...cycleSlots.map((slot) =>
        String(dailyCoverageMap[slot.isoDate]?.workingCount || 0)
      ),
      '""',
      '""',
      '""',
    ].join(';');

    const csvContent = `\uFEFF${headers.join(';')}\n${rows.join('\n')}\n${coverageRow}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `simulacao-escala-5x2-${selectedYear}-${String(selectedMonth0 + 1).padStart(2, '0')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Aplica a escala simulada 5x2 diretamente na Escala Mensal Oficial do aplicativo
  const handleApplyToOfficialSchedule = () => {
    const realEmployees = selectedSimEmployees.filter((e) => !e.isVirtual);
    if (realEmployees.length === 0) return;

    const extractedRows: ExtractedScheduleRow[] = realEmployees.map((emp) => {
      const dayShifts: Record<string, ShiftStatus> = {};
      for (const slot of cycleSlots) {
        dayShifts[slot.isoDate] = simGrid[emp.id]?.[slot.isoDate] || 'F';
      }
      return {
        name: emp.name,
        roleHint: emp.role,
        unitHint:
          state.units.find((u) => u.id === emp.unitId)?.name || 'Setor Principal',
        shiftHint: shiftCodeToAssign === 'N' ? 'Noturno' : 'Diurno',
        workHoursHint: operationWorkHours,
        scheduleRegimeHint: '5x2',
        dayShifts,
      };
    });

    const targetUnit =
      selectedUnitId === 'TODAS'
        ? state.units[0]?.id || 'unit-default-1'
        : selectedUnitId;

    onApplySimulated5x2ToMainSchedule({
      rows: extractedRows,
      unitId: targetUnit,
      convertSelectedTo5x2Regime: convertRegimeTo5x2OnApply,
      workHoursOverride: operationWorkHours,
    });

    setFeedbackBanner(
      `Simulação 5x2 aplicada com sucesso à Escala Oficial para ${realEmployees.length} colaborador(es)!`
    );
    setTimeout(() => setFeedbackBanner(null), 6000);
  };

  const periodTitle = useMemo(() => {
    if (periodMode === 'CALENDAR_MONTH') {
      return `${getMonthNamePtBr(selectedMonth0)} de ${selectedYear} (Mês Civil Completo)`;
    }
    return formatCycleRangeTitle(selectedYear, selectedMonth0);
  }, [selectedYear, selectedMonth0, periodMode]);

  return (
    <div className="space-y-6">
      {feedbackBanner && (
        <div className="no-print p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{feedbackBanner}</span>
        </div>
      )}

      {/* CABEÇALHO DO SIMULADOR 5x2 E FLUXO EM 4 ETAPAS */}
      <section className="no-print bg-white rounded-2xl border border-slate-200 p-5 md:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-[#0d9488] text-white flex items-center justify-center shrink-0">
              <Scale className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-bold text-slate-900 tracking-tight">
                Simulador de Transição 6x1 → 5x2 (Nova Lei Trabalhista)
              </h1>
              <p className="text-xs text-slate-600 mt-0.5 max-w-3xl">
                Simule a migração dos seus colaboradores do regime 6x1 para a nova escala 5x2 sem
                alterar a escala oficial até que tudo esteja conferido.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={generateSimulated5x2Grid}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0d9488] hover:bg-teal-700 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              <span>Gerar Escala 5x2 Agora</span>
            </button>

            <button
              type="button"
              onClick={handleExportSimulatedCsv}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4 text-teal-700" />
              <span>Baixar Excel (.CSV)</span>
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors cursor-pointer"
            >
              <Printer className="w-4 h-4 text-teal-400" />
              <span>Imprimir Grade</span>
            </button>
          </div>
        </div>

        {/* Os 4 Passos claros solicitados pelo usuário */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-xs font-extrabold text-teal-700 block">
              01. Descreva a operação
            </span>
            <p className="text-[11px] text-slate-600 mt-1">
              Funcionários, dias de atendimento, horário e o mínimo de pessoas em cada dia.
            </p>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-xs font-extrabold text-teal-700 block">
              02. Gere a escala
            </span>
            <p className="text-[11px] text-slate-600 mt-1">
              O simulador distribui os 5 dias de trabalho e as 2 folgas conforme a etapa da lei.
            </p>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-xs font-extrabold text-teal-700 block">
              03. Ajuste e confira
            </span>
            <p className="text-[11px] text-slate-600 mt-1">
              Arraste o que precisar. O painel de conformidade aponta o que ficou fora da regra.
            </p>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-xs font-extrabold text-teal-700 block">
              04. Exporte e aplique
            </span>
            <p className="text-[11px] text-slate-600 mt-1">
              Baixe em Excel ou imprima a grade do mês para entregar à equipe.
            </p>
          </div>
        </div>
      </section>

      {/* ETAPA 1: DESCREVA A OPERAÇÃO (FUNCIONÁRIOS, DIAS DE ATENDIMENTO, HORÁRIO E MÍNIMO POR DIA) */}
      <section className="no-print grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Coluna Esquerda (7 cols): Configuração da Operação, Etapa da Lei e Mínimo por Dia */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-5 space-y-5 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900">
                01. Descreva a Operação &amp; Etapa da Lei 5x2
              </h2>
              <p className="text-xs text-slate-500">
                Defina o setor, o horário de atendimento e quantas pessoas precisam estar presentes
                em cada dia da semana.
              </p>
            </div>

            {/* Setor, Período e Horário */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Setor / Unidade
                </label>
                <select
                  value={selectedUnitId}
                  onChange={(e) => setSelectedUnitId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-base font-semibold text-slate-900"
                >
                  <option value="TODAS">Todos os Setores</option>
                  {state.units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Horário da Equipe 5x2
                </label>
                <select
                  value={operationWorkHours}
                  onChange={(e) => setOperationWorkHours(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-base font-semibold text-slate-900"
                >
                  {WORK_HOURS_PRESETS.map((wh) => (
                    <option key={wh} value={wh}>
                      {wh}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Turno na Grade
                </label>
                <select
                  value={shiftCodeToAssign}
                  onChange={(e) => setShiftCodeToAssign(e.target.value as 'D' | 'N')}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-base font-semibold text-slate-900"
                >
                  <option value="D">Plantão Diurno (D)</option>
                  <option value="N">Plantão Noturno (N)</option>
                </select>
              </div>
            </div>

            {/* Seletor de Etapa da Lei 5x2 */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Etapa da Nova Lei 5x2 para Simulação
              </label>
              <div className="space-y-2">
                {LAW_STAGES.map((stage) => {
                  const active = stage.id === lawStageId;
                  return (
                    <button
                      key={stage.id}
                      type="button"
                      onClick={() => setLawStageId(stage.id)}
                      className={`w-full p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        active
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-extrabold">{stage.title}</span>
                        <span
                          className={`text-[11px] font-bold tabular-nums ${
                            active ? 'text-teal-300' : 'text-teal-700'
                          }`}
                        >
                          Máx. {stage.maxWorkDaysPerWeek}d / {stage.minOffDaysPerWeek} folgas ·{' '}
                          {stage.maxWeeklyHours}h/sem
                        </span>
                      </div>
                      <p
                        className={`text-[11px] mt-1 ${
                          active ? 'text-slate-300' : 'text-slate-500'
                        }`}
                      >
                        {stage.subtitle}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Dias de Atendimento e Mínimo de Pessoas em Cada Dia */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold text-slate-700">
                  Dias de Atendimento &amp; Mínimo de Pessoas por Dia
                </label>
                <span className="text-[11px] text-slate-500">
                  Desmarque os dias em que o setor fecha
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-7 gap-2">
                {[1, 2, 3, 4, 5, 6, 0].map((wd) => {
                  const isOpen = Boolean(operatingDays[wd]);
                  const minVal = Number(minStaffByWeekday[wd]) || 0;
                  return (
                    <div
                      key={wd}
                      className={`p-2.5 rounded-xl border text-center transition-colors ${
                        isOpen
                          ? 'bg-white border-slate-200'
                          : 'bg-slate-100 border-slate-200 opacity-60'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setOperatingDays((prev) => ({ ...prev, [wd]: !prev[wd] }))
                        }
                        className={`w-full py-1 rounded-lg text-xs font-extrabold cursor-pointer ${
                          isOpen
                            ? 'bg-teal-50 text-teal-800 border border-teal-200'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {WEEKDAY_NAMES_SHORT[wd]}
                      </button>

                      <span className="text-[10px] text-slate-500 block mt-1.5">
                        {isOpen ? 'Mín. pessoas' : 'Fechado'}
                      </span>

                      {isOpen ? (
                        <input
                          type="number"
                          min={0}
                          max={30}
                          value={minVal}
                          onChange={(e) =>
                            setMinStaffByWeekday((prev) => ({
                              ...prev,
                              [wd]: Math.max(0, Number(e.target.value) || 0),
                            }))
                          }
                          className="w-full mt-1 px-2 py-1 rounded-lg border border-slate-300 bg-slate-50 text-center text-base font-extrabold text-slate-900 tabular-nums"
                        />
                      ) : (
                        <span className="text-xs font-bold text-slate-400 block mt-2">
                          Folga
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Diagnóstico Matemático do Dimensionamento 6x1 vs 5x2 */}
          <div className="p-4 rounded-xl bg-slate-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className="text-xs font-bold text-teal-300 block">
                Dimensionamento da Equipe (6x1 → 5x2)
              </span>
              <p className="text-xs text-slate-300 mt-0.5">
                Sua operação exige{' '}
                <strong className="text-white tabular-nums">
                  {staffingMathSummary.totalRequiredShiftsPerWeek} plantões/semana
                </strong>
                . No 6x1 bastavam{' '}
                <strong className="text-white tabular-nums">
                  {staffingMathSummary.minEmployeesInOld6x1}
                </strong>{' '}
                pessoas; na lei 5x2 são necessárias pelo menos{' '}
                <strong className="text-teal-300 tabular-nums">
                  {staffingMathSummary.minEmployeesFor5x2} pessoas
                </strong>
                .
              </p>
            </div>

            <div className="shrink-0 text-right">
              {staffingMathSummary.deficit > 0 ? (
                <button
                  type="button"
                  onClick={handleAddVirtualEmployee}
                  className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold transition-colors cursor-pointer whitespace-nowrap"
                >
                  + Simular Nova Vaga ({staffingMathSummary.deficit} faltando)
                </button>
              ) : (
                <span className="text-xs font-extrabold text-emerald-300 block">
                  Equipe Suficiente ({selectedSimEmployees.length} selecionados)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Coluna Direita (5 cols): Seleção de Funcionários (Destaque para quem hoje é 6x1) */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Funcionários na Simulação ({selectedSimEmployees.length})
                </h2>
                <p className="text-xs text-slate-500">
                  Selecione quem vai entrar no rodízio 5x2 (colaboradores 6x1 destacados)
                </p>
              </div>

              <button
                type="button"
                onClick={handleAddVirtualEmployee}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 text-xs font-bold cursor-pointer shrink-0"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>+ Vaga Teste</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setSimEmployees((prev) =>
                    prev.map((e) => ({
                      ...e,
                      selected: e.currentRegime === '6x1' || e.currentRegime === '5x2',
                    }))
                  )
                }
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
              >
                Apenas 6x1 e 5x2
              </button>
              <button
                type="button"
                onClick={() =>
                  setSimEmployees((prev) => prev.map((e) => ({ ...e, selected: true })))
                }
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
              >
                Selecionar Todos
              </button>
            </div>

            <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
              {simEmployees.map((emp) => {
                const is6x1 = emp.currentRegime === '6x1';
                return (
                  <label
                    key={emp.id}
                    className={`p-3 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                      emp.selected
                        ? 'bg-teal-50/40 border-teal-300'
                        : 'bg-slate-50 border-slate-200 opacity-70'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={emp.selected}
                        onChange={(e) =>
                          setSimEmployees((prev) =>
                            prev.map((item) =>
                              item.id === emp.id
                                ? { ...item, selected: e.target.checked }
                                : item
                            )
                          )
                        }
                        className="w-4 h-4 accent-[#0d9488] rounded cursor-pointer shrink-0"
                      />
                      <div className="min-w-0">
                        <span className="text-xs font-bold text-slate-900 block truncate">
                          {emp.name}
                        </span>
                        <span className="text-[11px] text-slate-500 block truncate">
                          {emp.role} · Regime atual:{' '}
                          <strong
                            className={
                              is6x1
                                ? 'text-amber-700'
                                : emp.currentRegime === '5x2'
                                ? 'text-teal-700'
                                : 'text-slate-700'
                            }
                          >
                            {emp.currentRegime}
                          </strong>
                        </span>
                      </div>
                    </div>

                    <span className="text-[11px] font-bold text-teal-800 shrink-0">
                      {emp.isVirtual ? 'Vaga Simulada' : is6x1 ? 'Migrar 6x1 → 5x2' : '5x2'}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={generateSimulated5x2Grid}
            className="w-full py-3 px-4 rounded-xl bg-[#0d9488] hover:bg-teal-700 text-white text-xs md:text-sm font-bold shadow-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            <span>02. Gerar / Recalcular Distribuição 5x2</span>
          </button>
        </div>
      </section>

      {/* ETAPA 3: AJUSTE E CONFIRA (GRADE INTERATIVA COM ARRASTE + PAINEL DE CONFORMIDADE) */}
      <section className="no-print bg-white rounded-2xl border border-slate-200 p-5 md:p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base md:text-lg font-bold text-slate-900">
              03. Ajuste e Confira a Grade Simulada ({periodTitle})
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              <strong>Arraste qualquer célula</strong> para trocar plantões/folgas de lugar ou{' '}
              <strong>clique em um dia</strong> para alternar entre Trabalho ({shiftCodeToAssign}) e
              Folga (F).
            </p>
          </div>

          {/* Controles de Período (Quinzenal 16..15 ou Mês Civil) */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedMonth0}
              onChange={(e) => setSelectedMonth0(Number(e.target.value))}
              className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-base font-semibold text-slate-800"
            >
              {Array.from({ length: 12 }, (_, m) => (
                <option key={m} value={m}>
                  {getMonthNamePtBr(m)}
                </option>
              ))}
            </select>

            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-base font-semibold text-slate-800 tabular-nums"
            >
              {[2025, 2026, 2027, 2028].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>

            <select
              value={periodMode}
              onChange={(e) => setPeriodMode(e.target.value as SchedulePeriodViewMode)}
              className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-base font-semibold text-slate-800"
            >
              <option value="CYCLE_16_15_FULL">Ciclo Quinzenal (16 a 15)</option>
              <option value="CALENDAR_MONTH">Mês Civil (01 a 30/31)</option>
              <option value="FORTNIGHT_16_END">1ª Parte (16 ao fim do mês)</option>
              <option value="FORTNIGHT_01_15">2ª Parte (01 ao dia 15)</option>
            </select>
          </div>
        </div>

        {/* GRADE SIMULADA COM DRAG-AND-DROP */}
        <div className="overflow-x-auto border border-slate-200 rounded-2xl">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-slate-900 text-white text-[11px]">
                <th className="sticky left-0 z-10 bg-slate-900 px-3.5 py-3 min-w-[200px] font-bold border-r border-slate-800">
                  Colaborador (5x2)
                </th>
                {cycleSlots.map((slot) => {
                  const wd = getWeekdayIndex(slot.year, slot.monthIndex0, slot.day);
                  const isWeekend = wd === 0 || wd === 6;
                  return (
                    <th
                      key={slot.isoDate}
                      className={`px-1.5 py-2 text-center min-w-[42px] border-r border-slate-800 tabular-nums ${
                        isWeekend ? 'bg-slate-800 text-amber-300' : ''
                      }`}
                    >
                      <span className="block text-[10px] font-normal text-slate-400">
                        {WEEKDAY_NAMES_SHORT[wd]}
                      </span>
                      <span className="block text-xs font-extrabold">{slot.day}</span>
                    </th>
                  );
                })}
                <th className="px-3 py-2 text-center min-w-[95px] font-bold bg-slate-900">
                  Trab / Folgas
                </th>
                <th className="px-3 py-2 text-center min-w-[90px] font-bold bg-slate-900">
                  Dom. Folga
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {selectedSimEmployees.map((emp) => {
                const st = employeeStatsMap[emp.id];
                return (
                  <tr
                    key={emp.id}
                    className={`hover:bg-slate-50/80 ${
                      st?.hasViolation ? 'bg-red-50/20' : 'bg-white'
                    }`}
                  >
                    <td className="sticky left-0 z-10 bg-white px-3.5 py-2.5 border-r border-slate-200">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="font-bold text-slate-900 block truncate">
                            {emp.name}
                          </span>
                          <span className="text-[11px] text-slate-500 block truncate">
                            {emp.currentRegime} → 5x2 · {st?.estimatedWeeklyHours || 0}h/sem
                          </span>
                        </div>
                        {st?.hasViolation ? (
                          <span title="Colaborador com alerta de regra 5x2" className="shrink-0">
                            <AlertTriangle className="w-4 h-4 text-red-600" />
                          </span>
                        ) : (
                          <span title="Em conformidade com a regra 5x2" className="shrink-0">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          </span>
                        )}
                      </div>
                    </td>

                    {cycleSlots.map((slot) => {
                      const status = simGrid[emp.id]?.[slot.isoDate] || 'F';
                      const isWorking = status === 'D' || status === 'N';
                      const isDragOver =
                        dragOverTarget?.employeeId === emp.id &&
                        dragOverTarget?.isoDate === slot.isoDate;

                      return (
                        <td
                          key={slot.isoDate}
                          draggable
                          onDragStart={() =>
                            setDraggedCell({
                              employeeId: emp.id,
                              isoDate: slot.isoDate,
                              status,
                            })
                          }
                          onDragOver={(e) => {
                            e.preventDefault();
                            setDragOverTarget({
                              employeeId: emp.id,
                              isoDate: slot.isoDate,
                            });
                          }}
                          onDragLeave={() => setDragOverTarget(null)}
                          onDrop={(e) => {
                            e.preventDefault();
                            handleDropCell(emp.id, slot.isoDate);
                          }}
                          onClick={() => handleToggleCell(emp.id, slot.isoDate)}
                          title="Clique para alternar ou arraste para outro dia/colaborador"
                          className={`p-1 text-center border-r border-slate-100 select-none cursor-grab active:cursor-grabbing transition-all ${
                            isDragOver ? 'ring-2 ring-teal-500 bg-teal-50' : ''
                          }`}
                        >
                          <div
                            className={`w-8 h-8 mx-auto rounded-lg flex items-center justify-center font-extrabold text-xs tabular-nums ${
                              status === 'D'
                                ? 'bg-teal-600 text-white'
                                : status === 'N'
                                ? 'bg-indigo-700 text-white'
                                : 'bg-slate-100 text-slate-600 border border-slate-200'
                            }`}
                          >
                            {status}
                          </div>
                        </td>
                      );
                    })}

                    <td className="px-3 py-2 text-center font-bold tabular-nums border-l border-slate-200">
                      <span className="text-teal-700">{st?.workDays || 0}T</span>
                      <span className="text-slate-400 mx-1">/</span>
                      <span className="text-slate-700">{st?.offDays || 0}F</span>
                    </td>

                    <td className="px-3 py-2 text-center font-bold tabular-nums">
                      <span
                        className={
                          (st?.sundaysOff || 0) > 0 ? 'text-emerald-700' : 'text-amber-700'
                        }
                      >
                        {st?.sundaysOff || 0}/{st?.totalSundays || 0}
                      </span>
                    </td>
                  </tr>
                );
              })}

              {/* LINHA DE COBERTURA DIÁRIA VS MÍNIMO EXIGIDO */}
              <tr className="bg-slate-100 font-bold text-xs border-t-2 border-slate-300">
                <td className="sticky left-0 z-10 bg-slate-100 px-3.5 py-3 border-r border-slate-300 text-slate-900">
                  Pessoas no Dia / Mínimo
                </td>
                {cycleSlots.map((slot) => {
                  const cov = dailyCoverageMap[slot.isoDate];
                  return (
                    <td
                      key={slot.isoDate}
                      className={`px-1 py-2 text-center border-r border-slate-200 tabular-nums ${
                        !cov?.isOperating
                          ? 'text-slate-400'
                          : cov.isDeficit
                          ? 'bg-red-100 text-red-800'
                          : 'bg-emerald-50 text-emerald-800'
                      }`}
                    >
                      {cov?.isOperating ? (
                        <span>
                          {cov.workingCount}/{cov.minRequired}
                        </span>
                      ) : (
                        <span>-</span>
                      )}
                    </td>
                  );
                })}
                <td colSpan={2} className="px-3 py-2 text-center text-[11px] text-slate-600">
                  Cobertura Diária
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* PAINEL DE CONFORMIDADE DA LEI 5x2 */}
        <div className="p-4 md:p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              {complianceIssues.length === 0 ? (
                <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
              ) : (
                <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
              )}
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Painel de Conformidade 5x2 &amp; Cobertura do Setor
                </h3>
                <p className="text-xs text-slate-600">
                  {complianceIssues.length === 0
                    ? 'Tudo dentro da regra! Todos os dias atingiram o mínimo de pessoas e todas as semanas respeitam o 5x2.'
                    : `${complianceIssues.length} apontamento(s) encontrado(s) — ajuste clicando ou arrastando os dias acima.`}
                </p>
              </div>
            </div>
          </div>

          {complianceIssues.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-[260px] overflow-y-auto pr-1">
              {complianceIssues.map((issue) => (
                <div
                  key={issue.id}
                  className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${
                    issue.severity === 'ERROR'
                      ? 'bg-red-50/70 border-red-200 text-red-950'
                      : 'bg-amber-50/70 border-amber-200 text-amber-950'
                  }`}
                >
                  <AlertTriangle
                    className={`w-4 h-4 shrink-0 mt-0.5 ${
                      issue.severity === 'ERROR' ? 'text-red-600' : 'text-amber-600'
                    }`}
                  />
                  <div>
                    <span className="font-bold block">{issue.title}</span>
                    <span className="text-[11px] opacity-85 block mt-0.5">
                      {issue.detail}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ETAPA 4: EXPORTE E APLIQUE */}
      <section className="no-print bg-slate-900 text-white rounded-2xl p-5 md:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-base md:text-lg font-bold">
            04. Exporte em Excel, Imprima ou Aplique na Escala Oficial
          </h2>
          <p className="text-xs text-slate-300 max-w-2xl">
            Quando a simulação estiver pronta, você pode baixar a planilha, imprimir a grade A4 para
            o mural ou aplicar esta distribuição diretamente na Escala Mensal oficial da equipe.
          </p>

          <label className="inline-flex items-center gap-2 pt-2 text-xs text-teal-300 font-semibold cursor-pointer">
            <input
              type="checkbox"
              checked={convertRegimeTo5x2OnApply}
              onChange={(e) => setConvertRegimeTo5x2OnApply(e.target.checked)}
              className="w-4 h-4 accent-[#0d9488] rounded cursor-pointer"
            />
            <span>
              Atualizar também o cadastro desses funcionários de 6x1 para o regime 5x2 ao aplicar
            </span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleExportSimulatedCsv}
            className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4 text-teal-400" />
            <span>Baixar Excel (.CSV)</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            <Printer className="w-4 h-4 text-teal-400" />
            <span>Imprimir Grade A4</span>
          </button>

          <button
            type="button"
            onClick={handleApplyToOfficialSchedule}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#0d9488] hover:bg-teal-600 text-white text-xs md:text-sm font-extrabold shadow-sm transition-colors cursor-pointer"
          >
            <CalendarCheck2 className="w-4 h-4" />
            <span>Aplicar na Escala Oficial</span>
          </button>
        </div>
      </section>

      {/* VERSÃO PARA IMPRESSÃO A4 DA SIMULAÇÃO 5x2 */}
      <section className="hidden print-only print-container bg-white p-4">
        <div className="border-b-2 border-slate-900 pb-3 mb-4 flex justify-between items-end">
          <div>
            <h1 className="text-base font-extrabold uppercase">
              {state.manager.hospitalName || 'Instituição Hospitalar'} — Escala 5x2 ({periodTitle})
            </h1>
            <p className="text-xs text-slate-600">
              Regra Aplicada: {activeLawRule.title} · Horário: {operationWorkHours}
            </p>
          </div>
          <span className="text-xs font-semibold">
            Emitido em: {new Date().toLocaleDateString('pt-BR')}
          </span>
        </div>

        <table className="print-table text-[10px]">
          <thead>
            <tr className="bg-slate-100">
              <th className="text-left">Colaborador</th>
              {cycleSlots.map((slot) => (
                <th key={slot.isoDate} className="text-center">
                  {slot.day}
                </th>
              ))}
              <th className="text-center">T/F</th>
            </tr>
          </thead>
          <tbody>
            {selectedSimEmployees.map((emp) => {
              const st = employeeStatsMap[emp.id];
              return (
                <tr key={emp.id}>
                  <td className="font-bold">{emp.name}</td>
                  {cycleSlots.map((slot) => (
                    <td key={slot.isoDate} className="text-center font-bold">
                      {simGrid[emp.id]?.[slot.isoDate] || 'F'}
                    </td>
                  ))}
                  <td className="text-center font-bold">
                    {st?.workDays || 0}T / {st?.offDays || 0}F
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
};
