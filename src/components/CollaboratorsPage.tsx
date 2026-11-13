import React, { useMemo, useState } from 'react';
import {
  Employee,
  EscalaProState,
  NATIVE_HOSPITAL_ROLES,
  NavigationContext,
  REGIME_LABELS,
  ShiftStatus,
} from '../types';
import {
  calculateLeaveAndNextShift,
  computeRegimeShiftForDay,
  getDaysInMonth,
  getYearMonthKey,
} from '../services/storageService';
import {
  Building2,
  CalendarCheck,
  Clock,
  FileUp,
  FileWarning,
  Plane,
  Search,
  Sparkles,
  UserPlus,
  Users,
  UserX,
} from 'lucide-react';

interface CollaboratorsPageProps {
  state: EscalaProState;
  navContext: NavigationContext;
  onUpdateNav: (updates: Partial<NavigationContext>) => void;
  onOpenEmployeeModal: (employeeId: string | null) => void;
  onOpenQuickLeaveWizard: (
    employeeId?: string | null,
    initialType?: 'FOLGA' | 'ATESTADO' | 'DECLARACAO_HORAS' | 'FALTA' | 'FERIAS'
  ) => void;
}

export const CollaboratorsPage: React.FC<CollaboratorsPageProps> = ({
  state,
  navContext,
  onUpdateNav,
  onOpenEmployeeModal,
  onOpenQuickLeaveWizard,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const now = new Date();
  const year = now.getFullYear();
  const month0 = now.getMonth();
  const todayDay = now.getDate();
  const ymKey = getYearMonthKey(year, month0);
  const daysInMonth = getDaysInMonth(year, month0);

  const allRoles = useMemo(() => {
    return Array.from(new Set([...NATIVE_HOSPITAL_ROLES, ...state.customRoles]));
  }, [state.customRoles]);

  // Analisa status de ausências de cada colaborador no mês atual
  const employeeStatusSummary = useMemo(() => {
    const map: Record<
      string,
      {
        hasActiveCertificate: boolean;
        absencesCountInMonth: number;
        isOnVacation: boolean;
        todayStatus: ShiftStatus;
      }
    > = {};

    for (const emp of state.employees) {
      let hasActiveCertificate = false;
      let absencesCountInMonth = 0;
      let isOnVacation = false;

      const getStatus = (d: number): ShiftStatus => {
        return (
          state.schedules[ymKey]?.[emp.id]?.[d]?.status ||
          computeRegimeShiftForDay(emp, year, month0, d)
        );
      };

      const todaySt = getStatus(todayDay);
      if (todaySt === 'AT') hasActiveCertificate = true;
      if (todaySt === 'FE') isOnVacation = true;

      for (let d = 1; d <= daysInMonth; d++) {
        const st = getStatus(d);
        if (st === 'FA') absencesCountInMonth++;
        if (st === 'AT' && d >= todayDay) hasActiveCertificate = true;
        if (st === 'FE' && d >= todayDay) isOnVacation = true;
      }

      if (emp.history.some((h) => h.type === 'ATESTADO')) {
        // Verifica também se há atestado recente no histórico
        const latestCert = emp.history.find((h) => h.type === 'ATESTADO');
        if (latestCert) {
          const calc = calculateLeaveAndNextShift(
            emp,
            state.schedules,
            latestCert.startDate,
            latestCert.daysCount
          );
          const todayIso = `${year}-${String(month0 + 1).padStart(2, '0')}-${String(
            todayDay
          ).padStart(2, '0')}`;
          if (calc.endDateIso >= todayIso) {
            hasActiveCertificate = true;
          }
        }
      }

      map[emp.id] = {
        hasActiveCertificate,
        absencesCountInMonth,
        isOnVacation,
        todayStatus: todaySt,
      };
    }

    return map;
  }, [state.employees, state.schedules, ymKey, year, month0, todayDay, daysInMonth]);

  const filteredEmployees = useMemo(() => {
    return state.employees.filter((emp) => {
      if (!emp.active) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const unitName =
          state.units.find((u) => u.id === emp.unitId)?.name.toLowerCase() || '';
        const matches =
          emp.name.toLowerCase().includes(q) ||
          emp.role.toLowerCase().includes(q) ||
          emp.registrationNumber.toLowerCase().includes(q) ||
          unitName.includes(q);
        if (!matches) return false;
      }

      if (
        navContext.selectedUnitFilter !== 'TODAS' &&
        emp.unitId !== navContext.selectedUnitFilter
      ) {
        return false;
      }

      if (
        navContext.selectedRoleFilter !== 'TODAS' &&
        emp.role !== navContext.selectedRoleFilter
      ) {
        return false;
      }

      const summary = employeeStatusSummary[emp.id];
      if (navContext.collaboratorStatusFilter === 'EM_ATESTADO') {
        return !!summary?.hasActiveCertificate;
      }
      if (navContext.collaboratorStatusFilter === 'COM_FALTAS') {
        return (summary?.absencesCountInMonth || 0) > 0;
      }
      if (navContext.collaboratorStatusFilter === 'FERIAS') {
        return !!summary?.isOnVacation;
      }

      return true;
    });
  }, [
    state.employees,
    state.units,
    searchQuery,
    navContext.selectedUnitFilter,
    navContext.selectedRoleFilter,
    navContext.collaboratorStatusFilter,
    employeeStatusSummary,
  ]);

  const getInitials = (fullName: string) =>
    fullName
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((n) => n[0]?.toUpperCase())
      .join('');

  return (
    <div className="space-y-5">
      {/* Cabeçalho e Botões Principais */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Quadro de Colaboradores, Atestados e Cálculo de Retorno
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Lance atestados manualmente (sem precisar de arquivo), horas ou faltas e veja
            automaticamente que dia acaba e qual é o próximo plantão da pessoa
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => onOpenQuickLeaveWizard(null, 'ATESTADO')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shadow-xs"
          >
            <Sparkles className="w-4 h-4" />
            <span>Lançar Atestado / Horas (Manual)</span>
          </button>

          <button
            type="button"
            onClick={() => onUpdateNav({ activePage: 'importar' })}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
          >
            <FileUp className="w-4 h-4 text-teal-600" />
            <span>Importar (PDF, Word, Excel)</span>
          </button>

          <button
            type="button"
            onClick={() => onOpenEmployeeModal(null)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0d9488] hover:bg-teal-700 text-white text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
          >
            <UserPlus className="w-4 h-4" />
            <span>+ Novo Colaborador</span>
          </button>
        </div>
      </section>

      {/* Barra de Busca e Filtros de Status / Unidade / Função */}
      <section className="bg-white rounded-2xl border border-slate-200 p-4 md:p-5 space-y-4">
        {/* Abas de Status Rápidas */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200">
          {(
            [
              { id: 'TODOS', label: 'Todos' },
              { id: 'ATIVOS', label: 'Ativos' },
              { id: 'EM_ATESTADO', label: 'Em Atestado Médico' },
              { id: 'COM_FALTAS', label: 'Com Faltas no Mês' },
              { id: 'FERIAS', label: 'Em Férias' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() =>
                onUpdateNav({
                  collaboratorStatusFilter: tab.id,
                  highlightAbsencesReport: tab.id === 'COM_FALTAS',
                })
              }
              className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                navContext.collaboratorStatusFilter === tab.id
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por nome, cargo, CRF/COREN ou unidade..."
              className="w-full pl-10 pr-3.5 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
            />
          </div>

          <select
            value={navContext.selectedUnitFilter}
            onChange={(e) => onUpdateNav({ selectedUnitFilter: e.target.value })}
            className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
          >
            <option value="TODAS">Todas as Unidades</option>
            {state.units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>

          <select
            value={navContext.selectedRoleFilter}
            onChange={(e) => onUpdateNav({ selectedRoleFilter: e.target.value })}
            className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
          >
            <option value="TODAS">Todas as Funções</option>
            {allRoles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Grid de Colaboradores */}
      {filteredEmployees.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-3">
          <Users className="w-10 h-10 text-slate-400 mx-auto" />
          <p className="text-base font-bold text-slate-800">
            Nenhum colaborador encontrado com os filtros atuais.
          </p>
          <div className="flex flex-wrap justify-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                onUpdateNav({
                  collaboratorStatusFilter: 'TODOS',
                  selectedUnitFilter: 'TODAS',
                  selectedRoleFilter: 'TODAS',
                });
              }}
              className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold cursor-pointer"
            >
              Mostrar Todos os Colaboradores
            </button>

            <button
              type="button"
              onClick={() => onOpenQuickLeaveWizard(null, 'ATESTADO')}
              className="px-4 py-2 rounded-xl bg-amber-500 text-white text-xs font-bold cursor-pointer"
            >
              + Lançar Atestado Manualmente
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredEmployees.map((emp: Employee) => {
            const unitName =
              state.units.find((u) => u.id === emp.unitId)?.name || 'Unidade';
            const summary = employeeStatusSummary[emp.id];

            // Verifica o último atestado ou férias para exibir o cálculo automático de fim e próximo plantão
            const latestLeaveRecord = emp.history.find(
              (h) => h.type === 'ATESTADO' || h.type === 'FERIAS'
            );
            const leaveCalc = latestLeaveRecord
              ? calculateLeaveAndNextShift(
                  emp,
                  state.schedules,
                  latestLeaveRecord.startDate,
                  latestLeaveRecord.daysCount
                )
              : null;

            return (
              <div
                key={emp.id}
                className="bg-white hover:bg-slate-50/70 rounded-2xl border border-slate-200 hover:border-teal-600 p-5 transition-all flex flex-col justify-between gap-4"
              >
                <div
                  onClick={() => onOpenEmployeeModal(emp.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') onOpenEmployeeModal(emp.id);
                  }}
                  className="space-y-3 cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-full bg-slate-900 text-white font-bold text-sm flex items-center justify-center overflow-hidden shrink-0">
                        {emp.avatarBase64 ? (
                          <img
                            src={emp.avatarBase64}
                            alt={emp.name}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span>{getInitials(emp.name)}</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-slate-900 truncate">
                          {emp.name}
                        </h3>
                        <p className="text-xs text-teal-700 font-semibold truncate">
                          {emp.role}
                          {emp.registrationNumber ? ` · ${emp.registrationNumber}` : ''}
                        </p>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="block text-[10px] text-slate-400 font-semibold">
                        Banco Horas
                      </span>
                      <span
                        className={`text-xs font-bold tabular-nums ${
                          emp.hourBankBalance > 0
                            ? 'text-emerald-700'
                            : emp.hourBankBalance < 0
                            ? 'text-red-600'
                            : 'text-slate-700'
                        }`}
                      >
                        {emp.hourBankBalance > 0
                          ? `+${emp.hourBankBalance}h`
                          : `${emp.hourBankBalance}h`}
                      </span>
                    </div>
                  </div>

                  {/* Metadados limpos com separadores tipográficos */}
                  <div className="text-xs text-slate-600 space-y-1 pt-2 border-t border-slate-100">
                    <div className="flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="font-semibold text-slate-800">{unitName}</span>
                      <span aria-hidden="true">·</span>
                      <span>Turno {emp.defaultShift}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{emp.workHours}</span>
                      <span aria-hidden="true">·</span>
                      <span>{REGIME_LABELS[emp.regime]}</span>
                    </div>
                  </div>

                  {/* Card Automático de Fim do Atestado/Férias e Próximo Plantão */}
                  {leaveCalc && (summary?.hasActiveCertificate || summary?.isOnVacation) && (
                    <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200 space-y-1 text-xs">
                      <div className="flex items-center justify-between font-bold text-amber-900">
                        <span>
                          {latestLeaveRecord?.type === 'FERIAS' ? 'Férias' : 'Atestado'}:{' '}
                          {leaveCalc.daysCount}{' '}
                          {leaveCalc.daysCount === 1 ? 'dia' : 'dias'}
                        </span>
                        <span className="text-[11px]">
                          Início: {leaveCalc.startDateIso.split('-').reverse().join('/')}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-700">
                        Acaba em: <strong>{leaveCalc.endDateFormatted}</strong>
                      </p>
                      <p className="text-[11px] text-teal-900 font-semibold flex items-center gap-1 pt-0.5">
                        <CalendarCheck className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                        <span>
                          Próximo Plantão: <strong>{leaveCalc.nextShiftDateFormatted}</strong>
                        </span>
                      </p>
                    </div>
                  )}
                </div>

                {/* Rodapé do Card: Ações Rápidas */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                    {summary?.hasActiveCertificate && (
                      <span className="inline-flex items-center gap-1 text-amber-700">
                        <FileWarning className="w-3.5 h-3.5" />
                        Em Atestado
                      </span>
                    )}
                    {(summary?.absencesCountInMonth || 0) > 0 && (
                      <span className="inline-flex items-center gap-1 text-red-600">
                        <UserX className="w-3.5 h-3.5" />
                        {summary.absencesCountInMonth}{' '}
                        {summary.absencesCountInMonth === 1 ? 'Falta' : 'Faltas'}
                      </span>
                    )}
                    {summary?.isOnVacation && (
                      <span className="inline-flex items-center gap-1 text-cyan-700">
                        <Plane className="w-3.5 h-3.5" />
                        Férias
                      </span>
                    )}
                    {!summary?.hasActiveCertificate &&
                      !summary?.absencesCountInMonth &&
                      !summary?.isOnVacation && (
                        <span className="text-emerald-700 font-medium">
                          Regular na Escala
                        </span>
                      )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenQuickLeaveWizard(emp.id, 'ATESTADO')}
                      className="px-2.5 py-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-950 text-[11px] font-bold transition-colors cursor-pointer whitespace-nowrap"
                    >
                      + Atestado / Horas
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenEmployeeModal(emp.id)}
                      className="text-xs font-bold text-teal-700 hover:underline whitespace-nowrap cursor-pointer"
                    >
                      Prontuário →
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
