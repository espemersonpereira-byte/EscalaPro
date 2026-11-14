import React, { useMemo, useState } from 'react';
import {
  AbsenceRecord,
  Employee,
  EscalaProState,
  HospitalUnit,
  NavigationContext,
  ScheduleCellData,
  SHIFT_STATUS_META,
  ShiftStatus,
} from '../types';
import {
  computeRegimeShiftForDay,
  formatIsoDate,
  getDaysInMonth,
  getYearMonthKey,
  parseIsoDateParts,
} from '../services/storageService';
import {
  AlertTriangle,
  ArrowLeftRight,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FileWarning,
  Moon,
  RotateCcw,
  Sun,
  UserCheck,
  UserPlus,
  Users,
  UserX,
  X,
} from 'lucide-react';

interface DashboardPageProps {
  state: EscalaProState;
  onNavigate: (updates: Partial<NavigationContext>) => void;
  onOpenEmployeeModal: (employeeId: string) => void;
  onOpenNewEmployeeForUnit?: (unitId: string) => void;
  onOpenQuickLeaveWizard?: (
    employeeId?: string | null,
    initialType?: 'FOLGA' | 'ATESTADO' | 'DECLARACAO_HORAS' | 'FALTA' | 'FERIAS'
  ) => void;
  onUpdateScheduleCell?: (
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
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  state,
  onNavigate,
  onOpenEmployeeModal,
  onOpenNewEmployeeForUnit,
  onOpenQuickLeaveWizard,
  onUpdateScheduleCell,
}) => {
  const now = new Date();
  const todayIso = formatIsoDate(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowObj = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const tomorrowIso = formatIsoDate(
    tomorrowObj.getFullYear(),
    tomorrowObj.getMonth(),
    tomorrowObj.getDate()
  );

  const [selectedDateIso, setSelectedDateIso] = useState<string>(todayIso);
  const [expandedOffUnits, setExpandedOffUnits] = useState<Record<string, boolean>>({});
  const [redirectModal, setRedirectModal] = useState<{
    employeeId: string;
    targetUnitId: string;
    shiftStatus: ShiftStatus;
    note: string;
  } | null>(null);
  const [redirectToast, setRedirectToast] = useState<string | null>(null);

  const { year, monthIndex0, day } = parseIsoDateParts(selectedDateIso);
  const ymKey = getYearMonthKey(year, monthIndex0);
  const shortSelectedDate = `${String(day).padStart(2, '0')}/${String(monthIndex0 + 1).padStart(2, '0')}`;

  // Obtém o status efetivo de um colaborador na data selecionada
  const getEmployeeStatusOnDate = (emp: Employee, y: number, m0: number, d: number): ShiftStatus => {
    const k = getYearMonthKey(y, m0);
    const saved = state.schedules[k]?.[emp.id]?.[d]?.status;
    if (saved) return saved;
    return computeRegimeShiftForDay(emp, y, m0, d);
  };

  // Obtém a unidade efetiva de um colaborador somente na data selecionada (respeitando direcionamento pontual)
  const getEmployeeUnitOnDate = (emp: Employee, y: number, m0: number, d: number): string => {
    const k = getYearMonthKey(y, m0);
    const overrideId = state.schedules[k]?.[emp.id]?.[d]?.unitOverrideId;
    if (overrideId && state.units.some((u) => u.id === overrideId)) {
      return overrideId;
    }
    return emp.unitId;
  };

  const getUnitName = (unitId: string): string => {
    return state.units.find((u) => u.id === unitId)?.name || 'Setor';
  };

  // Cálculo dos KPIs do mês e do dia selecionado
  const kpiStats = useMemo(() => {
    const activeEmployees = state.employees.filter((e) => e.active);
    let shiftsOnSelectedDate = 0;
    let absencesInMonth = 0;
    const employeesWithActiveCertificate = new Set<string>();
    const daysCount = getDaysInMonth(year, monthIndex0);

    for (const emp of activeEmployees) {
      const stToday = getEmployeeStatusOnDate(emp, year, monthIndex0, day);
      if (stToday === 'D' || stToday === 'N' || stToday === 'TR') {
        shiftsOnSelectedDate++;
      }
      if (stToday === 'AT') {
        employeesWithActiveCertificate.add(emp.id);
      }

      for (let d = 1; d <= daysCount; d++) {
        const st = getEmployeeStatusOnDate(emp, year, monthIndex0, d);
        if (st === 'FA') {
          absencesInMonth++;
        }
        if (st === 'AT' && d >= day) {
          employeesWithActiveCertificate.add(emp.id);
        }
      }
    }

    // Verifica postos descobertos no dia selecionado (considerando direcionamento pontual de setor)
    let uncoveredUnitsCount = 0;
    for (const unit of state.units) {
      const unitEmployees = activeEmployees.filter(
        (e) => getEmployeeUnitOnDate(e, year, monthIndex0, day) === unit.id
      );
      const dayStaff = unitEmployees.filter((e) => {
        const s = getEmployeeStatusOnDate(e, year, monthIndex0, day);
        return s === 'D' || (s === 'TR' && e.defaultShift === 'Diurno');
      }).length;
      const nightStaff = unitEmployees.filter((e) => {
        const s = getEmployeeStatusOnDate(e, year, monthIndex0, day);
        return s === 'N' || (s === 'TR' && e.defaultShift === 'Noturno');
      }).length;

      const dayDeficit = unit.shiftMode !== 'NOTURNO' && dayStaff < unit.minStaffDay;
      const nightDeficit = unit.shiftMode !== 'DIURNO' && nightStaff < unit.minStaffNight;
      if (dayDeficit || nightDeficit) {
        uncoveredUnitsCount++;
      }
    }

    return {
      activeCount: activeEmployees.length,
      shiftsOnSelectedDate,
      absencesInMonth,
      activeCertificatesCount: employeesWithActiveCertificate.size,
      uncoveredUnitsCount,
    };
  }, [state.employees, state.schedules, state.units, year, monthIndex0, day]);

  const toggleOffList = (unitId: string) => {
    setExpandedOffUnits((prev) => ({ ...prev, [unitId]: !prev[unitId] }));
  };

  const formattedSelectedDate = useMemo(() => {
    const dObj = new Date(year, monthIndex0, day);
    return dObj.toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  }, [year, monthIndex0, day]);

  const getInitials = (fullName: string) => {
    return fullName
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((n) => n[0]?.toUpperCase())
      .join('');
  };

  const openRedirectModal = (emp?: Employee) => {
    const activeEmployees = state.employees.filter((e) => e.active);
    const chosen =
      emp ||
      activeEmployees.find((e) => {
        const st = getEmployeeStatusOnDate(e, year, monthIndex0, day);
        return st === 'D' || st === 'N' || st === 'TR';
      }) ||
      activeEmployees[0];

    if (!chosen) return;
    const currentUnitId = getEmployeeUnitOnDate(chosen, year, monthIndex0, day);
    const currentStatus = getEmployeeStatusOnDate(chosen, year, monthIndex0, day);
    const savedCell = state.schedules[ymKey]?.[chosen.id]?.[day];
    setRedirectModal({
      employeeId: chosen.id,
      targetUnitId: currentUnitId,
      shiftStatus: currentStatus,
      note: savedCell?.note || '',
    });
  };

  const handleSelectRedirectEmployee = (newEmpId: string) => {
    const chosen = state.employees.find((e) => e.id === newEmpId);
    if (!chosen) return;
    const currentUnitId = getEmployeeUnitOnDate(chosen, year, monthIndex0, day);
    const currentStatus = getEmployeeStatusOnDate(chosen, year, monthIndex0, day);
    const savedCell = state.schedules[ymKey]?.[chosen.id]?.[day];
    setRedirectModal({
      employeeId: chosen.id,
      targetUnitId: currentUnitId,
      shiftStatus: currentStatus,
      note: savedCell?.note || '',
    });
  };

  const handleSaveRedirectForDay = (e: React.FormEvent) => {
    e.preventDefault();
    if (!redirectModal || !onUpdateScheduleCell) return;
    const targetEmp = state.employees.find((emp) => emp.id === redirectModal.employeeId);
    if (!targetEmp) return;

    const existingCell = state.schedules[ymKey]?.[targetEmp.id]?.[day];
    const isBackToOriginal = redirectModal.targetUnitId === targetEmp.unitId;
    const targetUnitName = getUnitName(redirectModal.targetUnitId);
    const originalUnitName = getUnitName(targetEmp.unitId);

    const updatedCell: ScheduleCellData = {
      ...(existingCell || {}),
      status: redirectModal.shiftStatus,
      unitOverrideId: isBackToOriginal ? '' : redirectModal.targetUnitId,
      note: redirectModal.note.trim()
        ? redirectModal.note.trim()
        : isBackToOriginal
        ? existingCell?.note
        : `Direcionado para ${targetUnitName} apenas em ${shortSelectedDate}`,
    };

    onUpdateScheduleCell(year, monthIndex0, targetEmp.id, day, updatedCell);
    setRedirectModal(null);
    setRedirectToast(
      isBackToOriginal
        ? `${targetEmp.name} retornou para ${originalUnitName} no dia ${shortSelectedDate}.`
        : `${targetEmp.name} direcionado(a) para ${targetUnitName} apenas em ${shortSelectedDate}. Os outros dias permanecem em ${originalUnitName}.`
    );
    window.setTimeout(() => setRedirectToast(null), 5000);
  };

  const handleRestoreOriginalUnitForDay = () => {
    if (!redirectModal || !onUpdateScheduleCell) return;
    const targetEmp = state.employees.find((emp) => emp.id === redirectModal.employeeId);
    if (!targetEmp) return;

    const existingCell = state.schedules[ymKey]?.[targetEmp.id]?.[day];
    onUpdateScheduleCell(year, monthIndex0, targetEmp.id, day, {
      ...(existingCell || {}),
      status: redirectModal.shiftStatus,
      unitOverrideId: '',
      note: undefined,
    });
    setRedirectModal(null);
    setRedirectToast(
      `${targetEmp.name} restaurado(a) para ${getUnitName(targetEmp.unitId)} no dia ${shortSelectedDate}.`
    );
    window.setTimeout(() => setRedirectToast(null), 4500);
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho de Boas-vindas e Seletor Rápido de Data */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5 md:p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => onNavigate({ activePage: 'configuracoes' })}
            className="w-14 h-14 rounded-full bg-slate-900 text-white border-2 border-[#0d9488] flex items-center justify-center font-bold text-lg overflow-hidden shrink-0 cursor-pointer"
            title="Editar perfil do gestor"
          >
            {state.manager.avatarBase64 ? (
              <img
                src={state.manager.avatarBase64}
                alt={state.manager.name}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            ) : (
              <span>{getInitials(state.manager.name || 'Gestor')}</span>
            )}
          </button>

          <div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 font-medium">
              <span>{state.manager.hospitalName || 'Hospital'}</span>
              <span aria-hidden="true">·</span>
              <span>{state.manager.role}</span>
              <span aria-hidden="true">·</span>
              <span>Setor {state.manager.sectorName}</span>
            </div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight mt-0.5">
              Olá, {state.manager.name || 'Gestor(a)'}
            </h1>
            <p className="text-xs md:text-sm text-slate-600 capitalize mt-0.5">
              Painel Vivo do Plantão — {formattedSelectedDate}
            </p>
          </div>
        </div>

        {/* Seletor rápido de data (Hoje, Amanhã ou escolher dia) + Lançamento Rápido de Atestado/Horas */}
        <div className="flex flex-wrap items-center gap-2.5">
          {onOpenQuickLeaveWizard && (
            <button
              type="button"
              onClick={() => onOpenQuickLeaveWizard(null, 'ATESTADO')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition-colors cursor-pointer shadow-xs"
            >
              <FileWarning className="w-4 h-4" />
              <span>Lançar Atestado / Horas</span>
            </button>
          )}
          <div className="flex flex-wrap items-center gap-2 bg-slate-100 p-1.5 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => setSelectedDateIso(todayIso)}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                selectedDateIso === todayIso
                  ? 'bg-[#0f172a] text-white shadow-xs'
                  : 'text-slate-700 hover:bg-white'
              }`}
            >
              Hoje
            </button>
            <button
              type="button"
              onClick={() => setSelectedDateIso(tomorrowIso)}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                selectedDateIso === tomorrowIso
                  ? 'bg-[#0f172a] text-white shadow-xs'
                  : 'text-slate-700 hover:bg-white'
              }`}
            >
              Amanhã
            </button>
            <div className="relative flex items-center">
              <Calendar className="w-4 h-4 text-teal-700 absolute left-3 pointer-events-none" />
              <input
                type="date"
                value={selectedDateIso}
                onChange={(e) => {
                  if (e.target.value) setSelectedDateIso(e.target.value);
                }}
                aria-label="Escolher data do plantão"
                className="pl-9 pr-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-900 font-medium text-base focus:outline-none focus:ring-2 focus:ring-teal-600 cursor-pointer"
              />
            </div>
          </div>
        </div>
      </section>

      {/* 4 Cards KPI 100% Interativos */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 md:gap-4">
        <button
          type="button"
          onClick={() =>
            onNavigate({
              activePage: 'colaboradores',
              collaboratorStatusFilter: 'ATIVOS',
              selectedUnitFilter: 'TODAS',
              highlightAbsencesReport: false,
            })
          }
          className="text-left bg-white hover:bg-slate-50/80 rounded-2xl border border-slate-200 p-4 md:p-5 transition-colors cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Colaboradores Ativos</span>
            <div className="w-9 h-9 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center group-hover:bg-teal-600 group-hover:text-white transition-colors">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl md:text-3xl font-bold text-slate-900 tabular-nums mt-2">
            {kpiStats.activeCount}
          </p>
          <p className="text-xs text-teal-700 font-medium mt-1">
            Ver quadro completo da equipe →
          </p>
        </button>

        <button
          type="button"
          onClick={() =>
            onNavigate({
              activePage: 'escala',
              selectedUnitFilter: 'TODAS',
              onlyUncoveredDaysInSchedule: false,
            })
          }
          className="text-left bg-white hover:bg-slate-50/80 rounded-2xl border border-slate-200 p-4 md:p-5 transition-colors cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Plantões no Dia</span>
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors">
              <UserCheck className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl md:text-3xl font-bold text-slate-900 tabular-nums mt-2">
            {kpiStats.shiftsOnSelectedDate}
          </p>
          <p className="text-xs text-indigo-700 font-medium mt-1">
            Abrir grade mensal de plantões →
          </p>
        </button>

        <button
          type="button"
          onClick={() =>
            onNavigate({
              activePage: 'colaboradores',
              collaboratorStatusFilter: 'COM_FALTAS',
              selectedUnitFilter: 'TODAS',
              highlightAbsencesReport: true,
            })
          }
          className="text-left bg-white hover:bg-slate-50/80 rounded-2xl border border-slate-200 p-4 md:p-5 transition-colors cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Faltas no Mês</span>
            <div className="w-9 h-9 rounded-xl bg-red-50 text-red-600 flex items-center justify-center group-hover:bg-red-600 group-hover:text-white transition-colors">
              <UserX className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl md:text-3xl font-bold text-slate-900 tabular-nums mt-2">
            {kpiStats.absencesInMonth}
          </p>
          <p className="text-xs text-red-600 font-medium mt-1">
            Abrir relatório de faltas do mês →
          </p>
        </button>

        <button
          type="button"
          onClick={() =>
            onNavigate({
              activePage: 'colaboradores',
              collaboratorStatusFilter: 'EM_ATESTADO',
              selectedUnitFilter: 'TODAS',
              highlightAbsencesReport: false,
            })
          }
          className="text-left bg-white hover:bg-slate-50/80 rounded-2xl border border-slate-200 p-4 md:p-5 transition-colors cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Atestados Ativos</span>
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center group-hover:bg-amber-500 group-hover:text-white transition-colors">
              <FileWarning className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl md:text-3xl font-bold text-slate-900 tabular-nums mt-2">
            {kpiStats.activeCertificatesCount}
          </p>
          <p className="text-xs text-amber-700 font-medium mt-1">
            Ver colaboradores afastados →
          </p>
        </button>
      </section>

      {/* Banner Interativo de Postos Descobertos (caso haja déficit no dia) */}
      {kpiStats.uncoveredUnitsCount > 0 && (
        <button
          type="button"
          onClick={() =>
            onNavigate({
              activePage: 'escala',
              onlyUncoveredDaysInSchedule: true,
            })
          }
          className="w-full text-left bg-red-50 hover:bg-red-100/80 border border-red-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-600 text-white flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-red-900">
                Atenção: {kpiStats.uncoveredUnitsCount}{' '}
                {kpiStats.uncoveredUnitsCount === 1
                  ? 'unidade está com posto descoberto'
                  : 'unidades estão com postos descobertos'}{' '}
                nesta data
              </h2>
              <p className="text-xs text-red-700 mt-0.5">
                Toque aqui para abrir a Escala filtrada nos dias com déficit e convocar folguistas.
              </p>
            </div>
          </div>
          <span className="text-xs font-bold text-red-800 underline whitespace-nowrap">
            Resolver Déficit na Escala →
          </span>
        </button>
      )}

      {/* Blocos Separados por Unidade / Sub-setor */}
      <section className="space-y-4">
        {redirectToast && (
          <div className="p-3.5 rounded-2xl bg-teal-50 border border-teal-200 text-teal-900 text-xs font-semibold flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
            <span>{redirectToast}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Quem Está de Plantão por Unidade
            </h2>
            <p className="text-xs text-slate-500">
              Toque no profissional para ver o prontuário ou em <strong>Setor</strong> para direcioná-lo apenas no dia {shortSelectedDate}
            </p>
          </div>
          {onUpdateScheduleCell &&
            state.units.length > 1 &&
            state.employees.some((e) => e.active) && (
              <button
                type="button"
                onClick={() => openRedirectModal()}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors cursor-pointer shrink-0"
              >
                <ArrowLeftRight className="w-3.5 h-3.5 text-teal-400" />
                <span>Direcionar Setor ({shortSelectedDate})</span>
              </button>
            )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {state.units.map((unit: HospitalUnit) => {
            const unitEmployees = state.employees.filter(
              (e) => e.active && getEmployeeUnitOnDate(e, year, monthIndex0, day) === unit.id
            );

            const dayShiftTeam = unitEmployees.filter((e) => {
              const st = getEmployeeStatusOnDate(e, year, monthIndex0, day);
              return st === 'D' || (st === 'TR' && e.defaultShift === 'Diurno');
            });

            const nightShiftTeam = unitEmployees.filter((e) => {
              const st = getEmployeeStatusOnDate(e, year, monthIndex0, day);
              return st === 'N' || (st === 'TR' && e.defaultShift === 'Noturno');
            });

            const offOrAwayTeam = unitEmployees
              .map((e) => ({
                employee: e,
                status: getEmployeeStatusOnDate(e, year, monthIndex0, day),
              }))
              .filter(
                (item) =>
                  item.status === 'F' ||
                  item.status === 'BH' ||
                  item.status === 'AT' ||
                  item.status === 'FA' ||
                  item.status === 'FE'
              );

            const dayNeeded = unit.shiftMode !== 'NOTURNO' ? unit.minStaffDay : 0;
            const nightNeeded = unit.shiftMode !== 'DIURNO' ? unit.minStaffNight : 0;
            const dayDeficit = Math.max(0, dayNeeded - dayShiftTeam.length);
            const nightDeficit = Math.max(0, nightNeeded - nightShiftTeam.length);
            const isUnitComplete = dayDeficit === 0 && nightDeficit === 0;
            const isOffExpanded =
              expandedOffUnits[unit.id] !== undefined
                ? expandedOffUnits[unit.id]
                : dayShiftTeam.length === 0 &&
                  nightShiftTeam.length === 0 &&
                  offOrAwayTeam.length > 0;

            return (
              <div
                key={unit.id}
                className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col justify-between"
              >
                {/* Cabeçalho da Unidade */}
                <div>
                  <div className="p-4 md:p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50/60">
                    <button
                      type="button"
                      onClick={() =>
                        onNavigate({
                          activePage: 'escala',
                          selectedUnitFilter: unit.id,
                          onlyUncoveredDaysInSchedule: false,
                        })
                      }
                      className="flex items-center gap-2.5 text-left group cursor-pointer"
                    >
                      <div className="w-9 h-9 rounded-xl bg-slate-900 text-teal-400 flex items-center justify-center shrink-0">
                        <Building2 className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-slate-900 group-hover:text-teal-700 transition-colors">
                          {unit.name}
                        </h3>
                        <p className="text-xs text-slate-500">
                          Funcionamento {unit.shiftMode} · {unitEmployees.length}{' '}
                          {unitEmployees.length === 1 ? 'funcionário' : 'funcionários'} · Mín.:{' '}
                          {dayNeeded}D / {nightNeeded}N
                        </p>
                      </div>
                    </button>

                    <div className="flex flex-wrap items-center gap-2">
                      {onOpenNewEmployeeForUnit && (
                        <button
                          type="button"
                          onClick={() => onOpenNewEmployeeForUnit(unit.id)}
                          title={`Cadastrar funcionário no setor ${unit.name}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white hover:bg-teal-50 text-teal-700 border border-slate-200 hover:border-teal-300 text-xs font-bold transition-colors cursor-pointer"
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                          <span>+ Funcionário</span>
                        </button>
                      )}

                      {/* Indicador Visual de Cobertura */}
                      <button
                        type="button"
                        onClick={() =>
                          onNavigate({
                            activePage: 'escala',
                            selectedUnitFilter: unit.id,
                            onlyUncoveredDaysInSchedule: !isUnitComplete,
                          })
                        }
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer tabular-nums ${
                          isUnitComplete
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                            : 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100'
                        }`}
                      >
                        {isUnitComplete ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>
                              {dayShiftTeam.length + nightShiftTeam.length}/
                              {dayNeeded + nightNeeded} escalados · Completo
                            </span>
                          </>
                        ) : (
                          <>
                            <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                            <span>
                              {dayShiftTeam.length + nightShiftTeam.length}/
                              {dayNeeded + nightNeeded} escalados · Falta{' '}
                              {dayDeficit + nightDeficit} profissional
                            </span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Corpo com Turno Diurno e Turno Noturno */}
                  <div className="p-4 md:p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Coluna Turno Diurno */}
                    {unit.shiftMode !== 'NOTURNO' && (
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between text-xs font-bold text-slate-700 pb-1 border-b border-slate-100">
                          <span className="inline-flex items-center gap-1.5 text-teal-800">
                            <Sun className="w-3.5 h-3.5 text-teal-600" />
                            Turno Diurno
                          </span>
                          <span
                            className={`tabular-nums ${
                              dayDeficit > 0 ? 'text-red-600' : 'text-slate-500'
                            }`}
                          >
                            {dayShiftTeam.length}/{dayNeeded} escalados
                          </span>
                        </div>

                        {dayShiftTeam.length === 0 ? (
                          <button
                            type="button"
                            onClick={() =>
                              onNavigate({
                                activePage: 'escala',
                                selectedUnitFilter: unit.id,
                                selectedShiftFilter: 'Diurno',
                              })
                            }
                            className="w-full p-3 rounded-xl border border-dashed border-red-300 bg-red-50/50 text-xs text-red-700 font-medium text-left hover:bg-red-50 cursor-pointer"
                          >
                            Nenhum profissional escalado no Diurno. Toque para escalar →
                          </button>
                        ) : (
                          <div className="space-y-2">
                            {dayShiftTeam.map((emp) => {
                              const cell = state.schedules[ymKey]?.[emp.id]?.[day];
                              const effectiveUnitId = getEmployeeUnitOnDate(emp, year, monthIndex0, day);
                              const isRedirectedToday = effectiveUnitId !== emp.unitId;
                              return (
                                <div
                                  key={emp.id}
                                  className={`w-full p-2.5 rounded-xl border transition-colors flex items-center justify-between gap-2 ${
                                    isRedirectedToday
                                      ? 'border-cyan-300 bg-cyan-50/40'
                                      : 'border-slate-200 hover:border-teal-600 hover:bg-teal-50/30'
                                  }`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => onOpenEmployeeModal(emp.id)}
                                    className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                                  >
                                    <div className="w-8 h-8 rounded-full bg-teal-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
                                      {getInitials(emp.name)}
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-xs font-bold text-slate-900 truncate">
                                        {emp.name}
                                      </p>
                                      <p className="text-[11px] text-slate-500 truncate">
                                        {emp.role} · {emp.workHours}
                                      </p>
                                      {isRedirectedToday && (
                                        <p className="text-[10px] font-bold text-cyan-800 truncate mt-0.5">
                                          Só em {shortSelectedDate} · origem: {getUnitName(emp.unitId)}
                                        </p>
                                      )}
                                    </div>
                                  </button>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {cell?.status === 'TR' && (
                                      <span className="text-[10px] font-bold text-violet-700">
                                        Permuta
                                      </span>
                                    )}
                                    {onUpdateScheduleCell && state.units.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() => openRedirectModal(emp)}
                                        title={`Direcionar ${emp.name} para outro setor apenas em ${shortSelectedDate}`}
                                        className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-teal-600 text-slate-700 hover:text-white border border-slate-200 hover:border-teal-600 text-[11px] font-bold transition-colors cursor-pointer"
                                      >
                                        <ArrowLeftRight className="w-3 h-3" />
                                        <span>Setor</span>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Coluna Turno Noturno */}
                    {unit.shiftMode !== 'DIURNO' && (
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between text-xs font-bold text-slate-700 pb-1 border-b border-slate-100">
                          <span className="inline-flex items-center gap-1.5 text-indigo-900">
                            <Moon className="w-3.5 h-3.5 text-indigo-600" />
                            Turno Noturno
                          </span>
                          <span
                            className={`tabular-nums ${
                              nightDeficit > 0 ? 'text-red-600' : 'text-slate-500'
                            }`}
                          >
                            {nightShiftTeam.length}/{nightNeeded} escalados
                          </span>
                        </div>

                        {nightShiftTeam.length === 0 ? (
                          <button
                            type="button"
                            onClick={() =>
                              onNavigate({
                                activePage: 'escala',
                                selectedUnitFilter: unit.id,
                                selectedShiftFilter: 'Noturno',
                              })
                            }
                            className="w-full p-3 rounded-xl border border-dashed border-red-300 bg-red-50/50 text-xs text-red-700 font-medium text-left hover:bg-red-50 cursor-pointer"
                          >
                            Nenhum profissional escalado no Noturno. Toque para escalar →
                          </button>
                        ) : (
                          <div className="space-y-2">
                            {nightShiftTeam.map((emp) => {
                              const cell = state.schedules[ymKey]?.[emp.id]?.[day];
                              const effectiveUnitId = getEmployeeUnitOnDate(emp, year, monthIndex0, day);
                              const isRedirectedToday = effectiveUnitId !== emp.unitId;
                              return (
                                <div
                                  key={emp.id}
                                  className={`w-full p-2.5 rounded-xl border transition-colors flex items-center justify-between gap-2 ${
                                    isRedirectedToday
                                      ? 'border-cyan-300 bg-cyan-50/40'
                                      : 'border-slate-200 hover:border-indigo-600 hover:bg-indigo-50/30'
                                  }`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => onOpenEmployeeModal(emp.id)}
                                    className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                                  >
                                    <div className="w-8 h-8 rounded-full bg-indigo-700 text-white text-xs font-bold flex items-center justify-center shrink-0">
                                      {getInitials(emp.name)}
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-xs font-bold text-slate-900 truncate">
                                        {emp.name}
                                      </p>
                                      <p className="text-[11px] text-slate-500 truncate">
                                        {emp.role} · {emp.workHours}
                                      </p>
                                      {isRedirectedToday && (
                                        <p className="text-[10px] font-bold text-cyan-800 truncate mt-0.5">
                                          Só em {shortSelectedDate} · origem: {getUnitName(emp.unitId)}
                                        </p>
                                      )}
                                    </div>
                                  </button>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {cell?.status === 'TR' && (
                                      <span className="text-[10px] font-bold text-violet-700">
                                        Permuta
                                      </span>
                                    )}
                                    {onUpdateScheduleCell && state.units.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() => openRedirectModal(emp)}
                                        title={`Direcionar ${emp.name} para outro setor apenas em ${shortSelectedDate}`}
                                        className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-indigo-700 text-slate-700 hover:text-white border border-slate-200 hover:border-indigo-700 text-[11px] font-bold transition-colors cursor-pointer"
                                      >
                                        <ArrowLeftRight className="w-3 h-3" />
                                        <span>Setor</span>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Rodapé Recolhível: Quem está de Folga, Férias, Atestado ou Falta no dia */}
                <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => toggleOffList(unit.id)}
                    className="w-full flex items-center justify-between text-xs font-semibold text-slate-600 hover:text-slate-900 py-1 cursor-pointer"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>
                        Folgas, Férias e Afastamentos no dia ({offOrAwayTeam.length})
                      </span>
                    </span>
                    {isOffExpanded ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>

                  {isOffExpanded && (
                    <div className="pt-2 pb-1 space-y-1.5">
                      {offOrAwayTeam.length === 0 ? (
                        <p className="text-xs text-slate-500 py-1">
                          Todos os colaboradores desta unidade estão escalados hoje.
                        </p>
                      ) : (
                        offOrAwayTeam.map(({ employee, status }) => {
                          const meta = SHIFT_STATUS_META[status];
                          return (
                            <button
                              key={employee.id}
                              type="button"
                              onClick={() => onOpenEmployeeModal(employee.id)}
                              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-slate-300 text-left cursor-pointer"
                            >
                              <div className="min-w-0">
                                <span className="text-xs font-semibold text-slate-800">
                                  {employee.name}
                                </span>
                                <span className="text-[11px] text-slate-500 ml-2">
                                  {employee.role}
                                </span>
                              </div>
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${meta.bgClass} ${meta.textClass}`}
                              >
                                {meta.shortLabel} ({meta.code})
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* MODAL DE DIRECIONAMENTO PONTUAL DE SETOR (SOMENTE NA DATA SELECIONADA) */}
      {redirectModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 no-print">
          <div className="bg-white rounded-3xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between shrink-0">
              <div>
                <p className="text-xs text-teal-400 font-bold uppercase tracking-wider">
                  Direcionamento Pontual · Só {shortSelectedDate}
                </p>
                <h3 className="text-base font-bold text-white mt-0.5">
                  Direcionar Colaborador para Outro Setor
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setRedirectModal(null)}
                className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveRedirectForDay} className="p-6 space-y-4 overflow-y-auto">
              {(() => {
                const selectedEmp = state.employees.find(
                  (e) => e.id === redirectModal.employeeId
                );
                if (!selectedEmp) return null;
                const currentEffectiveUnitId = getEmployeeUnitOnDate(
                  selectedEmp,
                  year,
                  monthIndex0,
                  day
                );
                const isAlreadyOverridden = currentEffectiveUnitId !== selectedEmp.unitId;

                return (
                  <>
                    <div className="p-3.5 rounded-2xl bg-teal-50 border border-teal-200 text-xs text-teal-950 leading-relaxed">
                      Esta mudança vale <strong>somente para {shortSelectedDate}</strong>. Todos os outros dias da escala de{' '}
                      <strong>{selectedEmp.name}</strong> permanecem normalmente em{' '}
                      <strong>{getUnitName(selectedEmp.unitId)}</strong>.
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Colaborador
                      </label>
                      <select
                        value={redirectModal.employeeId}
                        onChange={(e) => handleSelectRedirectEmployee(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                      >
                        {state.employees
                          .filter((e) => e.active)
                          .map((emp) => {
                            const effUnit = getEmployeeUnitOnDate(emp, year, monthIndex0, day);
                            const st = getEmployeeStatusOnDate(emp, year, monthIndex0, day);
                            return (
                              <option key={emp.id} value={emp.id}>
                                {emp.name} · {getUnitName(effUnit)} ({SHIFT_STATUS_META[st].shortLabel})
                              </option>
                            );
                          })}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-2">
                        Setor de Destino em {shortSelectedDate}
                      </label>
                      <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                        {state.units.map((u) => {
                          const isSelected = redirectModal.targetUnitId === u.id;
                          const isOriginal = selectedEmp.unitId === u.id;
                          const unitEmps = state.employees.filter(
                            (e) => e.active && getEmployeeUnitOnDate(e, year, monthIndex0, day) === u.id
                          );
                          const scheduledInUnit = unitEmps.filter((e) => {
                            const s = getEmployeeStatusOnDate(e, year, monthIndex0, day);
                            return s === 'D' || s === 'N' || s === 'TR';
                          }).length;
                          const minTotal =
                            (u.shiftMode !== 'NOTURNO' ? u.minStaffDay : 0) +
                            (u.shiftMode !== 'DIURNO' ? u.minStaffNight : 0);
                          const hasDeficit = scheduledInUnit < minTotal;

                          return (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() =>
                                setRedirectModal((prev) =>
                                  prev ? { ...prev, targetUnitId: u.id } : null
                                )
                              }
                              className={`w-full p-3 rounded-xl border text-left flex items-center justify-between gap-2 transition-all cursor-pointer ${
                                isSelected
                                  ? 'border-teal-600 bg-teal-50/70 ring-2 ring-teal-600/20'
                                  : 'border-slate-200 hover:bg-slate-50'
                              }`}
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-slate-900 truncate">
                                  {u.name}{' '}
                                  {isOriginal && (
                                    <span className="text-[10px] font-semibold text-slate-500">
                                      (Setor original)
                                    </span>
                                  )}
                                </p>
                                <p className="text-[11px] text-slate-500 mt-0.5">
                                  {scheduledInUnit}/{minTotal} escalados hoje
                                </p>
                              </div>
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded shrink-0 ${
                                  hasDeficit
                                    ? 'bg-red-100 text-red-700'
                                    : 'bg-emerald-100 text-emerald-700'
                                }`}
                              >
                                {hasDeficit ? 'Precisa de reforço' : 'Completo'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          Turno neste dia
                        </label>
                        <select
                          value={redirectModal.shiftStatus}
                          onChange={(e) =>
                            setRedirectModal((prev) =>
                              prev
                                ? { ...prev, shiftStatus: e.target.value as ShiftStatus }
                                : null
                            )
                          }
                          className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                        >
                          <option value="D">Plantão Diurno (D)</option>
                          <option value="N">Plantão Noturno (N)</option>
                          <option value="TR">Permuta (TR)</option>
                          {redirectModal.shiftStatus === 'F' && (
                            <option value="F">Folga (F)</option>
                          )}
                          {redirectModal.shiftStatus === 'BH' && (
                            <option value="BH">Banco de Horas (BH)</option>
                          )}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          Observação (opcional)
                        </label>
                        <input
                          type="text"
                          value={redirectModal.note}
                          onChange={(e) =>
                            setRedirectModal((prev) =>
                              prev ? { ...prev, note: e.target.value } : null
                            )
                          }
                          placeholder="Ex: Cobertura de déficit"
                          className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                        />
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                      {isAlreadyOverridden ? (
                        <button
                          type="button"
                          onClick={handleRestoreOriginalUnitForDay}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Restaurar setor original</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setRedirectModal(null)}
                          className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
                        >
                          Cancelar
                        </button>
                      )}

                      <button
                        type="submit"
                        className="px-5 py-2.5 rounded-xl bg-[#0d9488] hover:bg-teal-700 text-white text-xs font-bold cursor-pointer shadow-xs"
                      >
                        Salvar apenas para {shortSelectedDate}
                      </button>
                    </div>
                  </>
                );
              })()}
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
