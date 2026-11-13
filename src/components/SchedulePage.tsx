import React, { useMemo, useState } from 'react';
import {
  AbsenceRecord,
  Employee,
  EscalaProState,
  NATIVE_HOSPITAL_ROLES,
  NavigationContext,
  REGIME_LABELS,
  ScheduleCellData,
  ScheduleCycleSlot,
  SchedulePeriodViewMode,
  SHIFT_STATUS_META,
  ShiftStatus,
} from '../types';
import {
  buildFortnightCycleSlots,
  computeRegimeShiftForDay,
  formatIsoDate,
  getDaysInMonth,
  getNextYearMonth,
  getYearMonthKey,
} from '../services/storageService';
import {
  ArrowLeftRight,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Download,
  Filter,
  Printer,
  Sparkles,
  UserPlus,
  X,
} from 'lucide-react';

interface SchedulePageProps {
  state: EscalaProState;
  navContext: NavigationContext;
  onUpdateNav: (updates: Partial<NavigationContext>) => void;
  onGenerateAutoSchedule: (year: number, monthIndex0: number) => void;
  onUpdateScheduleCell: (
    year: number,
    monthIndex0: number,
    employeeId: string,
    day: number,
    cellData: ScheduleCellData,
    extraOptions?: {
      swapPartnerId?: string;
      swapReturnDate?: string;
      extraHoursDelta?: number;
      historyRecord?: AbsenceRecord;
    }
  ) => void;
  onOpenEmployeeModal: (employeeId: string) => void;
}

const MONTH_NAMES = [
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

const MONTH_SHORT = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
];

const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export const SchedulePage: React.FC<SchedulePageProps> = ({
  state,
  navContext,
  onUpdateNav,
  onGenerateAutoSchedule,
  onUpdateScheduleCell,
  onOpenEmployeeModal,
}) => {
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear());
  const [selectedMonth0, setSelectedMonth0] = useState<number>(now.getMonth());
  // Padrão: Escala Quinzenal Completa (16 do mês inicial até 15 do mês seguinte, ex: 16/11 a 30/11 e 01/12 a 15/12)
  const [periodViewMode, setPeriodViewMode] =
    useState<SchedulePeriodViewMode>('CYCLE_16_15_FULL');

  // Modal de edição rápida da célula da escala (agora ciente do ano, mês e dia exato do slot quinzenal)
  const [editingCell, setEditingCell] = useState<{
    employee: Employee;
    slot: ScheduleCycleSlot;
    currentCell: ScheduleCellData;
  } | null>(null);

  const [modalTab, setModalTab] = useState<'STATUS' | 'PERMUTA' | 'HORA_EXTRA'>('STATUS');
  const [cellStatus, setCellStatus] = useState<ShiftStatus>('D');
  const [cellUnitId, setCellUnitId] = useState<string>('');
  const [cellNote, setCellNote] = useState<string>('');
  const [swapPartnerId, setSwapPartnerId] = useState<string>('');
  const [swapReturnDate, setSwapReturnDate] = useState<string>('');
  const [extraHoursInput, setExtraHoursInput] = useState<number>(6);

  // Modal de Radar de Cobertura Mínima (sugere folguistas para cobrir um dia com déficit)
  const [coverageSlotModal, setCoverageSlotModal] = useState<ScheduleCycleSlot | null>(null);

  // Feedback de cópia do resumo para WhatsApp
  const [whatsappFeedback, setWhatsappFeedback] = useState<string | null>(null);
  const [autoGenBanner, setAutoGenBanner] = useState<string | null>(null);

  const nextYm = useMemo(
    () => getNextYearMonth(selectedYear, selectedMonth0),
    [selectedYear, selectedMonth0]
  );

  const startDaysInMonth = getDaysInMonth(selectedYear, selectedMonth0);
  const startMonthNumStr = String(selectedMonth0 + 1).padStart(2, '0');
  const nextMonthNumStr = String(nextYm.monthIndex0 + 1).padStart(2, '0');

  const fortnight1RangeLabel = `16/${startMonthNumStr} a ${startDaysInMonth}/${startMonthNumStr}`;
  const fortnight2RangeLabel = `01/${nextMonthNumStr} a 15/${nextMonthNumStr}`;
  const fullCycleRangeLabel = `${fortnight1RangeLabel} e ${fortnight2RangeLabel}`;

  const allCycleSlots = useMemo(
    () => buildFortnightCycleSlots(selectedYear, selectedMonth0, periodViewMode),
    [selectedYear, selectedMonth0, periodViewMode]
  );

  const allRoles = useMemo(() => {
    return Array.from(new Set([...NATIVE_HOSPITAL_ROLES, ...state.customRoles]));
  }, [state.customRoles]);

  // Obtém célula efetiva de um colaborador em um slot (dia/mês/ano)
  const getCellForEmployeeSlot = (
    emp: Employee,
    slot: ScheduleCycleSlot
  ): ScheduleCellData => {
    const saved = state.schedules[slot.ymKey]?.[emp.id]?.[slot.day];
    if (saved) return saved;
    return {
      status: computeRegimeShiftForDay(emp, slot.year, slot.monthIndex0, slot.day),
    };
  };

  // Colaboradores filtrados pelos seletores superiores
  const filteredEmployees = useMemo(() => {
    return state.employees.filter((emp) => {
      if (!emp.active) return false;
      if (
        navContext.selectedUnitFilter !== 'TODAS' &&
        emp.unitId !== navContext.selectedUnitFilter
      ) {
        return false;
      }
      if (
        navContext.selectedShiftFilter !== 'TODOS' &&
        emp.defaultShift !== navContext.selectedShiftFilter
      ) {
        return false;
      }
      if (
        navContext.selectedRoleFilter !== 'TODAS' &&
        emp.role !== navContext.selectedRoleFilter
      ) {
        return false;
      }
      return true;
    });
  }, [
    state.employees,
    navContext.selectedUnitFilter,
    navContext.selectedShiftFilter,
    navContext.selectedRoleFilter,
  ]);

  // Radar de Cobertura Mínima por data ISO do ciclo quinzenal
  const dailyCoverageMap = useMemo(() => {
    const relevantUnits =
      navContext.selectedUnitFilter === 'TODAS'
        ? state.units
        : state.units.filter((u) => u.id === navContext.selectedUnitFilter);

    const minRequiredTotal = relevantUnits.reduce((acc, u) => {
      let req = 0;
      if (navContext.selectedShiftFilter !== 'Noturno' && u.shiftMode !== 'NOTURNO') {
        req += u.minStaffDay;
      }
      if (navContext.selectedShiftFilter !== 'Diurno' && u.shiftMode !== 'DIURNO') {
        req += u.minStaffNight;
      }
      return acc + req;
    }, 0);

    const map: Record<
      string,
      { scheduledCount: number; minRequired: number; hasDeficit: boolean }
    > = {};

    for (const slot of allCycleSlots) {
      let scheduledCount = 0;
      const poolForCoverage =
        navContext.selectedUnitFilter === 'TODAS'
          ? filteredEmployees
          : state.employees.filter((emp) => {
              if (!emp.active) return false;
              if (
                navContext.selectedShiftFilter !== 'TODOS' &&
                emp.defaultShift !== navContext.selectedShiftFilter
              ) {
                return false;
              }
              if (
                navContext.selectedRoleFilter !== 'TODAS' &&
                emp.role !== navContext.selectedRoleFilter
              ) {
                return false;
              }
              const cell = getCellForEmployeeSlot(emp, slot);
              const effUnit =
                cell.unitOverrideId && state.units.some((u) => u.id === cell.unitOverrideId)
                  ? cell.unitOverrideId
                  : emp.unitId;
              return effUnit === navContext.selectedUnitFilter;
            });

      for (const emp of poolForCoverage) {
        const cell = getCellForEmployeeSlot(emp, slot);
        if (cell.status === 'D' || cell.status === 'N' || cell.status === 'TR') {
          scheduledCount++;
        }
      }
      map[slot.isoDate] = {
        scheduledCount,
        minRequired: minRequiredTotal,
        hasDeficit: scheduledCount < minRequiredTotal,
      };
    }

    return map;
  }, [
    allCycleSlots,
    filteredEmployees,
    state.employees,
    navContext.selectedUnitFilter,
    navContext.selectedShiftFilter,
    navContext.selectedRoleFilter,
    state.units,
    state.schedules,
  ]);

  const visibleSlots = useMemo(() => {
    if (!navContext.onlyUncoveredDaysInSchedule) return allCycleSlots;
    return allCycleSlots.filter((slot) => dailyCoverageMap[slot.isoDate]?.hasDeficit);
  }, [allCycleSlots, navContext.onlyUncoveredDaysInSchedule, dailyCoverageMap]);

  const part1VisibleCount = useMemo(
    () => visibleSlots.filter((s) => s.fortnightPart === 1).length,
    [visibleSlots]
  );
  const part2VisibleCount = useMemo(
    () => visibleSlots.filter((s) => s.fortnightPart === 2).length,
    [visibleSlots]
  );

  const handlePrevCycle = () => {
    if (selectedMonth0 === 0) {
      setSelectedMonth0(11);
      setSelectedYear((y) => y - 1);
    } else {
      setSelectedMonth0((m) => m - 1);
    }
  };

  const handleNextCycle = () => {
    if (selectedMonth0 === 11) {
      setSelectedMonth0(0);
      setSelectedYear((y) => y + 1);
    } else {
      setSelectedMonth0((m) => m + 1);
    }
  };

  const openCellEditor = (emp: Employee, slot: ScheduleCycleSlot) => {
    const cell = getCellForEmployeeSlot(emp, slot);
    setEditingCell({ employee: emp, slot, currentCell: cell });
    setModalTab('STATUS');
    setCellStatus(cell.status);
    setCellUnitId(
      cell.unitOverrideId && state.units.some((u) => u.id === cell.unitOverrideId)
        ? cell.unitOverrideId
        : emp.unitId
    );
    setCellNote(cell.note || '');
    const potentialPartners = state.employees.filter(
      (e) => e.active && e.id !== emp.id
    );
    setSwapPartnerId(cell.swapWithEmployeeId || potentialPartners[0]?.id || '');

    const nextDateObj = new Date(slot.year, slot.monthIndex0, slot.day + 1);
    setSwapReturnDate(
      cell.swapReturnDate ||
        formatIsoDate(
          nextDateObj.getFullYear(),
          nextDateObj.getMonth(),
          nextDateObj.getDate()
        )
    );
    setExtraHoursInput(cell.extraHours || 6);
  };

  const handleSaveCellAction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCell) return;

    const { employee, slot } = editingCell;
    const dateIso = slot.isoDate;

    if (modalTab === 'STATUS') {
      const defaultRegimeStatus = computeRegimeShiftForDay(
        employee,
        slot.year,
        slot.monthIndex0,
        slot.day
      );
      const isManualFolga = cellStatus === 'F' && defaultRegimeStatus !== 'F';
      const effectiveNote =
        cellNote.trim() ||
        `${SHIFT_STATUS_META[cellStatus].label} marcado manualmente na escala (${slot.shortDateLabel})`;

      const historyRecord: AbsenceRecord | undefined =
        isManualFolga || cellStatus === 'FA' || cellStatus === 'AT' || cellStatus === 'FE'
          ? {
              id: `abs-${Date.now()}`,
              employeeId: employee.id,
              type: isManualFolga
                ? 'FOLGA'
                : cellStatus === 'FA'
                ? 'FALTA'
                : cellStatus === 'AT'
                ? 'ATESTADO'
                : 'FERIAS',
              startDate: dateIso,
              endDate: dateIso,
              daysCount: 1,
              shift: employee.defaultShift,
              reason:
                cellNote.trim() ||
                `${SHIFT_STATUS_META[cellStatus].label} lançado diretamente na grade da escala (${slot.shortDateLabel}).`,
              createdAt: new Date().toISOString(),
            }
          : undefined;

      onUpdateScheduleCell(
        slot.year,
        slot.monthIndex0,
        employee.id,
        slot.day,
        {
          status: cellStatus,
          unitOverrideId: cellUnitId && cellUnitId !== employee.unitId ? cellUnitId : '',
          note: effectiveNote,
        },
        { historyRecord }
      );
    } else if (modalTab === 'PERMUTA') {
      const partner = state.employees.find((e) => e.id === swapPartnerId);
      if (!partner) return;

      const historyRecord: AbsenceRecord = {
        id: `swap-${Date.now()}`,
        employeeId: employee.id,
        type: 'TROCA',
        startDate: dateIso,
        daysCount: 1,
        shift: employee.defaultShift,
        reason: `Permuta de plantão com ${partner.name} (Devolução: ${swapReturnDate}).`,
        swapPartnerId: partner.id,
        swapPartnerName: partner.name,
        swapReturnDate,
        createdAt: new Date().toISOString(),
      };

      onUpdateScheduleCell(
        slot.year,
        slot.monthIndex0,
        employee.id,
        slot.day,
        {
          status: 'TR',
          swapWithEmployeeId: partner.id,
          swapWithEmployeeName: partner.name,
          swapReturnDate,
          note: `Coberto por ${partner.name} (Devolve em ${swapReturnDate})`,
        },
        {
          swapPartnerId: partner.id,
          swapReturnDate,
          historyRecord,
        }
      );
    } else if (modalTab === 'HORA_EXTRA') {
      const hours = Number(extraHoursInput) || 0;
      const historyRecord: AbsenceRecord = {
        id: `he-${Date.now()}`,
        employeeId: employee.id,
        type: 'HORA_EXTRA',
        startDate: dateIso,
        daysCount: 1,
        shift: employee.defaultShift,
        extraHours: hours,
        reason:
          cellNote.trim() || `Dobra / Hora Extra (+${hours}h) creditada no Banco de Horas.`,
        createdAt: new Date().toISOString(),
      };

      onUpdateScheduleCell(
        slot.year,
        slot.monthIndex0,
        employee.id,
        slot.day,
        {
          ...editingCell.currentCell,
          status: employee.defaultShift === 'Noturno' ? 'N' : 'D',
          extraHours: hours,
          note: `Dobra / +${hours}h no Banco de Horas`,
        },
        {
          extraHoursDelta: hours,
          historyRecord,
        }
      );
    }

    setEditingCell(null);
  };

  // Gera e copia para a área de transferência o resumo do dia seguinte para WhatsApp
  const handleCopyWhatsAppSummary = async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tYear = tomorrow.getFullYear();
    const tMonth0 = tomorrow.getMonth();
    const tDay = tomorrow.getDate();
    const tKey = getYearMonthKey(tYear, tMonth0);
    const formattedDate = tomorrow.toLocaleDateString('pt-BR');

    const lines: string[] = [
      `🏥 *${state.manager.hospitalName || 'EscalaPro Hospitalar'}*`,
      `📋 *Escala de Plantão — Amanhã (${formattedDate})*`,
      `Setor: ${state.manager.sectorName}`,
      `----------------------------------------`,
    ];

    for (const unit of state.units) {
      lines.push(`\n📍 *${unit.name.toUpperCase()}*`);
      const unitEmps = state.employees.filter((e) => {
        if (!e.active) return false;
        const overrideId = state.schedules[tKey]?.[e.id]?.[tDay]?.unitOverrideId;
        const effectiveUnit =
          overrideId && state.units.some((u) => u.id === overrideId) ? overrideId : e.unitId;
        return effectiveUnit === unit.id;
      });

      const dayEmps = unitEmps.filter((e) => {
        const st =
          state.schedules[tKey]?.[e.id]?.[tDay]?.status ||
          computeRegimeShiftForDay(e, tYear, tMonth0, tDay);
        return st === 'D' || (st === 'TR' && e.defaultShift === 'Diurno');
      });

      const nightEmps = unitEmps.filter((e) => {
        const st =
          state.schedules[tKey]?.[e.id]?.[tDay]?.status ||
          computeRegimeShiftForDay(e, tYear, tMonth0, tDay);
        return st === 'N' || (st === 'TR' && e.defaultShift === 'Noturno');
      });

      if (unit.shiftMode !== 'NOTURNO') {
        lines.push(`☀️ *Diurno:*`);
        if (dayEmps.length === 0) {
          lines.push(`  ⚠️ Sem profissional escalado`);
        } else {
          dayEmps.forEach((e) =>
            lines.push(`  • ${e.name} (${e.role} | ${e.workHours})`)
          );
        }
      }

      if (unit.shiftMode !== 'DIURNO') {
        lines.push(`🌙 *Noturno:*`);
        if (nightEmps.length === 0) {
          lines.push(`  ⚠️ Sem profissional escalado`);
        } else {
          nightEmps.forEach((e) =>
            lines.push(`  • ${e.name} (${e.role} | ${e.workHours})`)
          );
        }
      }
    }

    lines.push(`\n✅ _Gerado por EscalaPro · ${state.manager.name}_`);
    const textToCopy = lines.join('\n');

    try {
      await navigator.clipboard.writeText(textToCopy);
      setWhatsappFeedback('Resumo do plantão de amanhã copiado para o WhatsApp!');
      setTimeout(() => setWhatsappFeedback(null), 4000);
    } catch {
      setWhatsappFeedback('Resumo gerado! Use Ctrl+C para copiar.');
      setTimeout(() => setWhatsappFeedback(null), 4000);
    }
  };

  // Exporta CSV compatível com Excel exatamente com as datas do ciclo quinzenal ativo (ex: 16/11 a 30/11 e 01/12 a 15/12)
  const handleExportCsv = () => {
    const headers = [
      'Colaborador',
      'Funcao',
      'Unidade',
      'Turno_Padrao',
      'Regime',
      ...allCycleSlots.map((s) => s.shortDateLabel),
    ];

    const rows = filteredEmployees.map((emp) => {
      const unitName = state.units.find((u) => u.id === emp.unitId)?.name || '';
      const dayCells = allCycleSlots.map((s) => getCellForEmployeeSlot(emp, s).status);
      return [
        `"${emp.name}"`,
        `"${emp.role}"`,
        `"${unitName}"`,
        `"${emp.defaultShift}"`,
        `"${REGIME_LABELS[emp.regime]}"`,
        ...dayCells,
      ].join(';');
    });

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const fileTag =
      periodViewMode === 'CALENDAR_MONTH'
        ? `${selectedYear}-${startMonthNumStr}`
        : `quinzenal-16_${startMonthNumStr}-a-15_${nextMonthNumStr}-${selectedYear}`;
    link.download = `escala-${fileTag}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getUnitName = (unitId: string) =>
    state.units.find((u) => u.id === unitId)?.name || 'Unidade';

  const activePeriodTitle =
    periodViewMode === 'CALENDAR_MONTH'
      ? `${MONTH_NAMES[selectedMonth0]} de ${selectedYear} (01/${startMonthNumStr} a ${startDaysInMonth}/${startMonthNumStr})`
      : periodViewMode === 'FORTNIGHT_16_END'
      ? `2ª Quinzena de ${MONTH_NAMES[selectedMonth0]} (${fortnight1RangeLabel})`
      : periodViewMode === 'FORTNIGHT_01_15'
      ? `1ª Quinzena de ${MONTH_NAMES[nextYm.monthIndex0]} (${fortnight2RangeLabel})`
      : `Escala Quinzenal: ${fortnight1RangeLabel} (${MONTH_SHORT[selectedMonth0]}) e ${fortnight2RangeLabel} (${MONTH_SHORT[nextYm.monthIndex0]})`;

  return (
    <div className="space-y-5 print-container">
      {/* Cabeçalho exclusivo para Impressão A4 Paisagem */}
      <div className="hidden print-only mb-4 border-b-2 border-slate-800 pb-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              {state.manager.hospitalName || 'Instituição Hospitalar'} — Escala Oficial de Plantões
            </h1>
            <p className="text-sm text-slate-700">
              Setor: {state.manager.sectorName} · {activePeriodTitle} · Responsável:{' '}
              {state.manager.name} ({state.manager.role})
            </p>
          </div>
          <div className="text-right text-xs text-slate-600">
            <p>Emitido em: {new Date().toLocaleDateString('pt-BR')}</p>
            <p>Documento Oficial EscalaPro</p>
          </div>
        </div>
      </div>

      {/* Barra Superior de Ações e Período Quinzenal (16 a 15) */}
      <section className="no-print bg-white rounded-2xl border border-slate-200 p-4 md:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          {/* Seletor de Ciclo Quinzenal (ex: 16/Nov a 15/Dez) */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center bg-slate-100 rounded-xl p-1 border border-slate-200">
              <button
                type="button"
                onClick={handlePrevCycle}
                className="p-2 rounded-lg hover:bg-white text-slate-700 transition-colors cursor-pointer"
                title="Ciclo anterior"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="px-3.5 py-1 text-center min-w-[210px]">
                {periodViewMode === 'CALENDAR_MONTH' ? (
                  <div className="text-sm font-bold text-slate-900">
                    {MONTH_NAMES[selectedMonth0]} {selectedYear}
                  </div>
                ) : (
                  <>
                    <div className="text-xs sm:text-sm font-bold text-slate-900 leading-tight">
                      16/{MONTH_SHORT[selectedMonth0]} a 15/{MONTH_SHORT[nextYm.monthIndex0]}{' '}
                      {nextYm.year}
                    </div>
                    <div className="text-[10px] font-semibold text-teal-700 leading-tight mt-0.5">
                      {fortnight1RangeLabel} + {fortnight2RangeLabel}
                    </div>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={handleNextCycle}
                className="p-2 rounded-lg hover:bg-white text-slate-700 transition-colors cursor-pointer"
                title="Próximo ciclo"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <span className="hidden xl:inline-block text-xs text-slate-500">
              Toque em qualquer dia ({fortnight1RangeLabel} ou {fortnight2RangeLabel}) para ajustar plantão ou folga
            </span>
          </div>

          {/* Botões de Ação Principal */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onGenerateAutoSchedule(selectedYear, selectedMonth0);
                setAutoGenBanner(
                  `Escala Quinzenal (${fullCycleRangeLabel}) gerada automaticamente respeitando regimes (12x36, 5x2, 6x1) e preservando folgas, férias e atestados!`
                );
                setTimeout(() => setAutoGenBanner(null), 5000);
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0d9488] hover:bg-teal-700 text-white text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shadow-xs"
            >
              <Sparkles className="w-4 h-4" />
              <span>Gerar Escala Quinzenal</span>
            </button>

            <button
              type="button"
              onClick={handleCopyWhatsAppSummary}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
            >
              <Copy className="w-4 h-4 text-teal-400" />
              <span>Copiar Resumo WhatsApp</span>
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
            >
              <Download className="w-4 h-4 text-slate-600" />
              <span>CSV</span>
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
            >
              <Printer className="w-4 h-4 text-slate-600" />
              <span>Imprimir A4</span>
            </button>
          </div>
        </div>

        {/* Seletor Rápido das Quinzenas do Ciclo (16/11 a 30/11 | 01/12 a 15/12) */}
        <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-teal-600 shrink-0" />
            <span className="text-xs font-bold text-slate-700">
              Visualização Quinzenal da Escala:
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPeriodViewMode('CYCLE_16_15_FULL')}
              className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                periodViewMode === 'CYCLE_16_15_FULL'
                  ? 'bg-[#0f172a] text-white border-slate-900'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              Ciclo Completo ({fortnight1RangeLabel} + {fortnight2RangeLabel})
            </button>

            <button
              type="button"
              onClick={() => setPeriodViewMode('FORTNIGHT_16_END')}
              className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                periodViewMode === 'FORTNIGHT_16_END'
                  ? 'bg-[#0d9488] text-white border-teal-700'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              2ª Quinzena {MONTH_SHORT[selectedMonth0]} ({fortnight1RangeLabel})
            </button>

            <button
              type="button"
              onClick={() => setPeriodViewMode('FORTNIGHT_01_15')}
              className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                periodViewMode === 'FORTNIGHT_01_15'
                  ? 'bg-indigo-600 text-white border-indigo-700'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              1ª Quinzena {MONTH_SHORT[nextYm.monthIndex0]} ({fortnight2RangeLabel})
            </button>

            <button
              type="button"
              onClick={() => setPeriodViewMode('CALENDAR_MONTH')}
              className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                periodViewMode === 'CALENDAR_MONTH'
                  ? 'bg-slate-800 text-white border-slate-900'
                  : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Mês Civil (01/{startMonthNumStr} a {startDaysInMonth}/{startMonthNumStr})
            </button>
          </div>
        </div>

        {/* Banners de confirmação */}
        {autoGenBanner && (
          <div className="p-3 rounded-xl bg-teal-50 border border-teal-200 text-teal-900 text-xs font-semibold flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Check className="w-4 h-4 text-teal-600 shrink-0" />
              {autoGenBanner}
            </span>
            <button
              type="button"
              onClick={() => setAutoGenBanner(null)}
              className="text-teal-700 hover:text-teal-900"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {whatsappFeedback && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              {whatsappFeedback}
            </span>
            <button
              type="button"
              onClick={() => setWhatsappFeedback(null)}
              className="text-emerald-700 hover:text-emerald-900"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Filtros Interativos Superiores */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-slate-100">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">
              Unidade / Sub-setor
            </label>
            <select
              value={navContext.selectedUnitFilter}
              onChange={(e) => onUpdateNav({ selectedUnitFilter: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
            >
              <option value="TODAS">Todas as Unidades ({state.units.length})</option>
              {state.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">
              Turno Principal
            </label>
            <select
              value={navContext.selectedShiftFilter}
              onChange={(e) =>
                onUpdateNav({
                  selectedShiftFilter: e.target.value as 'TODOS' | 'Diurno' | 'Noturno',
                })
              }
              className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
            >
              <option value="TODOS">Todos os Turnos</option>
              <option value="Diurno">Apenas Diurno</option>
              <option value="Noturno">Apenas Noturno</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">
              Função Hospitalar
            </label>
            <select
              value={navContext.selectedRoleFilter}
              onChange={(e) => onUpdateNav({ selectedRoleFilter: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
            >
              <option value="TODAS">Todas as Funções</option>
              {allRoles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <button
              type="button"
              onClick={() =>
                onUpdateNav({
                  onlyUncoveredDaysInSchedule: !navContext.onlyUncoveredDaysInSchedule,
                })
              }
              className={`w-full px-3 py-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                navContext.onlyUncoveredDaysInSchedule
                  ? 'bg-red-600 text-white border-red-700'
                  : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>
                {navContext.onlyUncoveredDaysInSchedule
                  ? 'Mostrando Dias Descobertos'
                  : 'Filtrar Dias com Déficit'}
              </span>
            </button>
          </div>
        </div>

        {/* Legenda Didática de Siglas */}
        <div className="flex flex-wrap items-center gap-3 pt-2 text-xs">
          <span className="font-bold text-slate-500">Legenda:</span>
          {Object.values(SHIFT_STATUS_META).map((meta) => (
            <div key={meta.code} className="inline-flex items-center gap-1.5">
              <span
                className={`w-6 h-5 rounded text-[11px] font-bold inline-flex items-center justify-center ${meta.bgClass} ${meta.textClass}`}
              >
                {meta.code}
              </span>
              <span className="text-slate-600 font-medium">{meta.shortLabel}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Grade da Escala Quinzenal */}
      <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {filteredEmployees.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-base font-bold text-slate-800">
              Nenhum colaborador encontrado para os filtros selecionados.
            </p>
            <div className="flex justify-center gap-3">
              <button
                type="button"
                onClick={() =>
                  onUpdateNav({
                    selectedUnitFilter: 'TODAS',
                    selectedShiftFilter: 'TODOS',
                    selectedRoleFilter: 'TODAS',
                    onlyUncoveredDaysInSchedule: false,
                  })
                }
                className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold cursor-pointer"
              >
                Limpar Filtros
              </button>
              <button
                type="button"
                onClick={() => onUpdateNav({ activePage: 'colaboradores' })}
                className="px-4 py-2 rounded-xl bg-[#0d9488] text-white text-xs font-semibold cursor-pointer"
              >
                + Cadastrar Colaboradores
              </button>
            </div>
          </div>
        ) : visibleSlots.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-base font-bold text-emerald-800">
              Excelente! Nenhum dia deste período possui déficit de cobertura mínima.
            </p>
            <button
              type="button"
              onClick={() => onUpdateNav({ onlyUncoveredDaysInSchedule: false })}
              className="px-4 py-2 rounded-xl bg-[#0d9488] text-white text-xs font-semibold cursor-pointer"
            >
              Ver Todos os Dias da Quinzena
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left print-table">
              <thead>
                {/* Linha Superior Agrupada identificando claramente as 2 Quinzenas (16/11 a 30/11 e 01/12 a 15/12) */}
                {periodViewMode !== 'CALENDAR_MONTH' && (
                  <tr className="bg-slate-950 text-white border-b border-slate-800">
                    <th className="sticky left-0 z-20 bg-slate-950 px-3.5 py-2 text-[11px] font-bold text-teal-400 border-r border-slate-800">
                      Ciclo Quinzenal (16 a 15)
                    </th>
                    {part1VisibleCount > 0 && (
                      <th
                        colSpan={part1VisibleCount}
                        className="px-2 py-1.5 text-center text-[11px] font-bold tracking-wide text-teal-300 bg-teal-950/60 border-r-2 border-teal-500/60"
                      >
                        2ª Quinzena de {MONTH_NAMES[selectedMonth0]} ({fortnight1RangeLabel})
                      </th>
                    )}
                    {part2VisibleCount > 0 && (
                      <th
                        colSpan={part2VisibleCount}
                        className="px-2 py-1.5 text-center text-[11px] font-bold tracking-wide text-indigo-300 bg-indigo-950/60 border-r border-slate-800"
                      >
                        1ª Quinzena de {MONTH_NAMES[nextYm.monthIndex0]} ({fortnight2RangeLabel})
                      </th>
                    )}
                  </tr>
                )}

                <tr className="bg-slate-900 text-white border-b border-slate-800">
                  <th className="sticky left-0 z-20 bg-slate-900 px-3.5 py-3 min-w-[210px] max-w-[230px] text-xs font-bold tracking-tight border-r border-slate-800">
                    Colaborador / Função / Unidade
                  </th>
                  {visibleSlots.map((slot, idx) => {
                    const dateObj = new Date(slot.year, slot.monthIndex0, slot.day);
                    const dow = dateObj.getDay();
                    const isWeekend = dow === 0 || dow === 6;
                    const isToday =
                      slot.year === now.getFullYear() &&
                      slot.monthIndex0 === now.getMonth() &&
                      slot.day === now.getDate();
                    const isFirstOfSecondFortnight =
                      periodViewMode === 'CYCLE_16_15_FULL' &&
                      slot.fortnightPart === 2 &&
                      idx > 0 &&
                      visibleSlots[idx - 1]?.fortnightPart === 1;

                    return (
                      <th
                        key={slot.isoDate}
                        className={`px-1 py-2 text-center min-w-[40px] border-r border-slate-800 select-none ${
                          isFirstOfSecondFortnight ? 'border-l-2 border-l-teal-400' : ''
                        } ${
                          isToday
                            ? 'bg-teal-600 text-white'
                            : isWeekend
                            ? 'bg-slate-800 text-amber-300'
                            : slot.fortnightPart === 2 && periodViewMode !== 'CALENDAR_MONTH'
                            ? 'bg-slate-900/90 text-indigo-200'
                            : 'text-slate-200'
                        }`}
                      >
                        <div className="text-[10px] font-medium opacity-80">
                          {WEEKDAY_SHORT[dow]}
                        </div>
                        <div className="text-[11px] font-bold tabular-nums leading-tight mt-0.5">
                          {slot.shortDateLabel}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200">
                {filteredEmployees.map((emp) => {
                  const unitName = getUnitName(emp.unitId);
                  return (
                    <tr key={emp.id} className="hover:bg-slate-50/80 transition-colors">
                      {/* Coluna fixa à esquerda com nome clicável */}
                      <td className="sticky left-0 z-10 bg-white px-3.5 py-2.5 border-r border-slate-200">
                        <button
                          type="button"
                          onClick={() => onOpenEmployeeModal(emp.id)}
                          className="text-left group cursor-pointer block w-full"
                        >
                          <p className="text-xs font-bold text-slate-900 group-hover:text-teal-700 truncate">
                            {emp.name}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate">
                            {emp.role} · {unitName}
                          </p>
                          <p className="text-[10px] text-slate-400 truncate">
                            {REGIME_LABELS[emp.regime]} ({emp.workHours})
                          </p>
                        </button>
                      </td>

                      {/* Células dos dias do ciclo quinzenal */}
                      {visibleSlots.map((slot, idx) => {
                        const cell = getCellForEmployeeSlot(emp, slot);
                        const meta = SHIFT_STATUS_META[cell.status];
                        const dateObj = new Date(slot.year, slot.monthIndex0, slot.day);
                        const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
                        const hasUnitOverride =
                          Boolean(cell.unitOverrideId) && cell.unitOverrideId !== emp.unitId;
                        const isFirstOfSecondFortnight =
                          periodViewMode === 'CYCLE_16_15_FULL' &&
                          slot.fortnightPart === 2 &&
                          idx > 0 &&
                          visibleSlots[idx - 1]?.fortnightPart === 1;

                        return (
                          <td
                            key={slot.isoDate}
                            className={`p-1 text-center border-r border-slate-100 ${
                              isFirstOfSecondFortnight ? 'border-l-2 border-l-teal-500/40' : ''
                            } ${isWeekend ? 'bg-slate-50/70' : ''}`}
                          >
                            <button
                              type="button"
                              onClick={() => openCellEditor(emp, slot)}
                              title={`${emp.name} — Dia ${slot.shortDateLabel}: ${meta.label}${
                                hasUnitOverride && cell.unitOverrideId
                                  ? ` · Direcionado para ${getUnitName(cell.unitOverrideId)}`
                                  : ''
                              }${cell.note ? ` (${cell.note})` : ''}`}
                              className={`w-7 h-7 mx-auto rounded-lg text-[11px] font-bold flex items-center justify-center transition-transform active:scale-95 cursor-pointer relative ${meta.bgClass} ${meta.textClass}`}
                            >
                              <span>{meta.code}</span>
                              {cell.extraHours && cell.extraHours > 0 ? (
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-300 absolute top-0.5 right-0.5" />
                              ) : null}
                              {hasUnitOverride ? (
                                <span className="w-1.5 h-1.5 rounded-full bg-cyan-300 ring-1 ring-slate-900/40 absolute bottom-0.5 right-0.5" />
                              ) : null}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>

              {/* RADAR DE COBERTURA MÍNIMA NO RODAPÉ */}
              <tfoot>
                <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold">
                  <td className="sticky left-0 z-10 bg-slate-100 px-3.5 py-2.5 text-xs text-slate-800 border-r border-slate-300">
                    <div>Radar de Cobertura Mínima</div>
                    <div className="text-[10px] font-normal text-slate-500">
                      Toque no dia em vermelho para convocar folguista
                    </div>
                  </td>
                  {visibleSlots.map((slot, idx) => {
                    const cov = dailyCoverageMap[slot.isoDate];
                    const hasDeficit = cov?.hasDeficit;
                    const isFirstOfSecondFortnight =
                      periodViewMode === 'CYCLE_16_15_FULL' &&
                      slot.fortnightPart === 2 &&
                      idx > 0 &&
                      visibleSlots[idx - 1]?.fortnightPart === 1;

                    return (
                      <td
                        key={slot.isoDate}
                        className={`p-1 text-center border-r border-slate-200 ${
                          isFirstOfSecondFortnight ? 'border-l-2 border-l-teal-500/40' : ''
                        } ${hasDeficit ? 'bg-red-50' : 'bg-emerald-50/40'}`}
                      >
                        <button
                          type="button"
                          onClick={() => setCoverageSlotModal(slot)}
                          className={`w-full py-1 rounded text-[10px] font-bold tabular-nums cursor-pointer ${
                            hasDeficit
                              ? 'bg-red-600 text-white hover:bg-red-700'
                              : 'text-emerald-800 hover:bg-emerald-100'
                          }`}
                          title={
                            hasDeficit
                              ? `Déficit em ${slot.shortDateLabel}: ${cov.scheduledCount}/${cov.minRequired} escalados. Toque para ver quem está de folga.`
                              : `Cobertura atingida em ${slot.shortDateLabel}: ${cov.scheduledCount}/${cov.minRequired}`
                          }
                        >
                          {cov.scheduledCount}/{cov.minRequired}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {/* Rodapé de Assinatura e Carimbo para Impressão A4 */}
      <div className="hidden print-only mt-10 pt-6">
        <div className="grid grid-cols-3 gap-12 text-center text-xs text-slate-700">
          <div>
            <div className="border-t border-slate-800 pt-2 font-bold">
              {state.manager.name || 'Supervisor Responsável'}
            </div>
            <div>
              {state.manager.role} · Setor {state.manager.sectorName}
            </div>
          </div>
          <div>
            <div className="border-t border-slate-800 pt-2 font-bold">
              Coordenação / Diretoria Clínica
            </div>
            <div>{state.manager.hospitalName}</div>
          </div>
          <div>
            <div className="border-t border-slate-800 pt-2 font-bold">
              Recursos Humanos / Departamento Pessoal
            </div>
            <div>Visto e Carimbo Institucional</div>
          </div>
        </div>
      </div>

      {/* MODAL DE AÇÃO NA CÉLULA (Alterar Plantão, Permuta ou Hora Extra) */}
      {editingCell && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 no-print">
          <div className="bg-white rounded-3xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden">
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-teal-400 font-semibold">
                  Dia {String(editingCell.slot.day).padStart(2, '0')} de{' '}
                  {MONTH_NAMES[editingCell.slot.monthIndex0]} de {editingCell.slot.year} (
                  {editingCell.slot.shortDateLabel})
                </p>
                <h3 className="text-base font-bold text-white mt-0.5">
                  {editingCell.employee.name}
                </h3>
                <p className="text-xs text-slate-300">
                  {editingCell.employee.role} · {getUnitName(editingCell.employee.unitId)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingCell(null)}
                className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Abas do Modal */}
            <div className="grid grid-cols-3 gap-1 p-2 bg-slate-100 border-b border-slate-200">
              <button
                type="button"
                onClick={() => setModalTab('STATUS')}
                className={`py-2 px-3 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                  modalTab === 'STATUS'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Status do Dia
              </button>
              <button
                type="button"
                onClick={() => setModalTab('PERMUTA')}
                className={`py-2 px-3 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                  modalTab === 'PERMUTA'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Troca (Permuta)
              </button>
              <button
                type="button"
                onClick={() => setModalTab('HORA_EXTRA')}
                className={`py-2 px-3 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                  modalTab === 'HORA_EXTRA'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Hora Extra / Dobra
              </button>
            </div>

            <form onSubmit={handleSaveCellAction} className="p-6 space-y-4">
              {modalTab === 'STATUS' && (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-2">
                      Selecione o Status na Escala ({editingCell.slot.shortDateLabel})
                    </label>
                    <div className="grid grid-cols-2 gap-2.5">
                      {(['D', 'N', 'F', 'FA', 'AT', 'FE'] as ShiftStatus[]).map((st) => {
                        const meta = SHIFT_STATUS_META[st];
                        const isSelected = cellStatus === st;
                        return (
                          <button
                            key={st}
                            type="button"
                            onClick={() => setCellStatus(st)}
                            className={`p-3 rounded-xl border text-left flex items-center gap-2.5 transition-all cursor-pointer ${
                              isSelected
                                ? 'border-teal-600 bg-teal-50/70 ring-2 ring-teal-600/20'
                                : 'border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            <span
                              className={`w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center shrink-0 ${meta.bgClass} ${meta.textClass}`}
                            >
                              {meta.code}
                            </span>
                            <span className="text-xs font-bold text-slate-800">
                              {meta.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {state.units.length > 1 && (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Setor apenas neste dia ({editingCell.slot.shortDateLabel} — não altera os outros dias)
                      </label>
                      <select
                        value={cellUnitId || editingCell.employee.unitId}
                        onChange={(e) => setCellUnitId(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                      >
                        {state.units.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                            {u.id === editingCell.employee.unitId ? ' (Setor original)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Observação / Justificativa (opcional)
                    </label>
                    <input
                      type="text"
                      value={cellNote}
                      onChange={(e) => setCellNote(e.target.value)}
                      placeholder="Ex: Cobrindo setor de urgência, atestado entregue..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                    />
                  </div>
                </>
              )}

              {modalTab === 'PERMUTA' && (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-xl bg-violet-50 border border-violet-200 text-xs text-violet-900 flex items-start gap-2.5">
                    <ArrowLeftRight className="w-4 h-4 text-violet-700 shrink-0 mt-0.5" />
                    <span>
                      Ao registrar a permuta, ambos os colaboradores terão o dia atualizado como{' '}
                      <strong>TR (Permuta)</strong> e o registro ficará salvo no histórico.
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Qual colega vai cobrir este plantão?
                    </label>
                    <select
                      value={swapPartnerId}
                      onChange={(e) => setSwapPartnerId(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                    >
                      {state.employees
                        .filter((e) => e.active && e.id !== editingCell.employee.id)
                        .map((colleague) => (
                          <option key={colleague.id} value={colleague.id}>
                            {colleague.name} ({colleague.role})
                          </option>
                        ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Data de Devolução do Plantão
                    </label>
                    <input
                      type="date"
                      value={swapReturnDate}
                      onChange={(e) => setSwapReturnDate(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                    />
                  </div>
                </div>
              )}

              {modalTab === 'HORA_EXTRA' && (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-xl bg-teal-50 border border-teal-200 text-xs text-teal-900 flex items-start gap-2.5">
                    <Clock className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
                    <span>
                      As horas extras ou dobras registradas aqui são somadas automaticamente ao{' '}
                      <strong>Banco de Horas</strong> de {editingCell.employee.name} (Saldo
                      atual: {editingCell.employee.hourBankBalance >= 0 ? '+' : ''}
                      {editingCell.employee.hourBankBalance}h).
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Quantidade de Horas Extras a Somar (+)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={24}
                      value={extraHoursInput}
                      onChange={(e) => setExtraHoursInput(Number(e.target.value))}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900 tabular-nums"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Motivo da Dobra / Hora Extra
                    </label>
                    <input
                      type="text"
                      value={cellNote}
                      onChange={(e) => setCellNote(e.target.value)}
                      placeholder="Ex: Dobra para cobrir atestado na unidade"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    const empId = editingCell.employee.id;
                    setEditingCell(null);
                    onOpenEmployeeModal(empId);
                  }}
                  className="text-xs font-bold text-teal-700 hover:underline cursor-pointer"
                >
                  Abrir Prontuário Completo →
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingCell(null)}
                    className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2.5 rounded-xl bg-[#0d9488] hover:bg-teal-700 text-white text-xs font-bold transition-colors cursor-pointer"
                  >
                    Salvar na Escala
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DO RADAR DE COBERTURA (Sugere Folguistas do Dia para Cobrir Déficit) */}
      {coverageSlotModal !== null && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 no-print">
          <div className="bg-white rounded-3xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden">
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Calendar className="w-5 h-5 text-teal-400" />
                <div>
                  <h3 className="text-base font-bold text-white">
                    Radar de Cobertura — Dia {coverageSlotModal.shortDateLabel}/
                    {coverageSlotModal.year}
                  </h3>
                  <p className="text-xs text-slate-300">
                    Escalados: {dailyCoverageMap[coverageSlotModal.isoDate]?.scheduledCount} ·
                    Mínimo necessário: {dailyCoverageMap[coverageSlotModal.isoDate]?.minRequired}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCoverageSlotModal(null)}
                className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[420px] overflow-y-auto">
              <p className="text-xs text-slate-600">
                Profissionais que estão de <strong>Folga (F)</strong> neste dia (
                {coverageSlotModal.shortDateLabel}) e disponíveis para convocação ou cobertura
                rápida:
              </p>

              {(() => {
                const availableFolguistas = state.employees.filter((emp) => {
                  if (!emp.active) return false;
                  const cell = getCellForEmployeeSlot(emp, coverageSlotModal);
                  return cell.status === 'F';
                });

                if (availableFolguistas.length === 0) {
                  return (
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 text-center">
                      Nenhum colaborador está com status de Folga neste dia.
                    </div>
                  );
                }

                return (
                  <div className="space-y-2">
                    {availableFolguistas.map((emp) => (
                      <div
                        key={emp.id}
                        className="p-3 rounded-xl border border-slate-200 flex items-center justify-between gap-3 hover:bg-slate-50"
                      >
                        <div>
                          <p className="text-xs font-bold text-slate-900">{emp.name}</p>
                          <p className="text-[11px] text-slate-500">
                            {emp.role} · {getUnitName(emp.unitId)} · Saldo BH:{' '}
                            {emp.hourBankBalance >= 0 ? '+' : ''}
                            {emp.hourBankBalance}h
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const shiftCode: ShiftStatus =
                              emp.defaultShift === 'Noturno' ? 'N' : 'D';
                            onUpdateScheduleCell(
                              coverageSlotModal.year,
                              coverageSlotModal.monthIndex0,
                              emp.id,
                              coverageSlotModal.day,
                              {
                                status: shiftCode,
                                extraHours: 12,
                                note: `Convocado pelo Radar de Cobertura Mínima em ${coverageSlotModal.shortDateLabel} (+12h)`,
                              },
                              { extraHoursDelta: 12 }
                            );
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0d9488] hover:bg-teal-700 text-white text-xs font-bold cursor-pointer shrink-0"
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                          <span>Escalar no Dia</span>
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
