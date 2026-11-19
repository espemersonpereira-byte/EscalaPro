import React, { useEffect, useMemo, useState } from 'react';
import {
  AbsenceRecord,
  Employee,
  EscalaProState,
  REGIME_LABELS,
  SHIFT_STATUS_META,
  TimeTrackingSubType,
} from '../types';
import {
  calculateLeaveAndNextShift,
  computeHoursDiffBetweenTimes,
  formatDateWithWeekdayPtBr,
  formatDecimalHoursPtBr,
  formatIsoDate,
  parseEmployeeWorkHours,
} from '../services/storageService';
import {
  ArrowRight,
  Calendar,
  CalendarCheck,
  CheckCircle2,
  Clock,
  FileWarning,
  Paperclip,
  Plane,
  Sparkles,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';

interface QuickLeaveWizardModalProps {
  state: EscalaProState;
  initialEmployeeId?: string | null;
  initialType?: 'FOLGA' | 'ATESTADO' | 'DECLARACAO_HORAS' | 'FALTA' | 'FERIAS';
  onClose: () => void;
  onApplyLeaveOrOccurrence: (payload: {
    employeeId: string;
    record: AbsenceRecord;
    scheduleStatusToApply?: 'F' | 'AT' | 'FA' | 'FE';
    hourBankDelta?: number;
  }) => void;
}

export const QuickLeaveWizardModal: React.FC<QuickLeaveWizardModalProps> = ({
  state,
  initialEmployeeId,
  initialType = 'ATESTADO',
  onClose,
  onApplyLeaveOrOccurrence,
}) => {
  const activeEmployees = useMemo(
    () => state.employees.filter((e) => e.active),
    [state.employees]
  );

  const now = new Date();
  const todayIso = formatIsoDate(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayObj = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterdayIso = formatIsoDate(
    yesterdayObj.getFullYear(),
    yesterdayObj.getMonth(),
    yesterdayObj.getDate()
  );

  // 1. Escolha do Colaborador
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(
    initialEmployeeId && activeEmployees.some((e) => e.id === initialEmployeeId)
      ? initialEmployeeId
      : activeEmployees[0]?.id || ''
  );

  // 2. Escolha do Tipo de Lançamento (Folga, Atestado, Horas, Falta, Férias)
  const [occurrenceType, setOccurrenceType] = useState<
    'FOLGA' | 'ATESTADO' | 'DECLARACAO_HORAS' | 'FALTA' | 'FERIAS'
  >(initialType);

  // 3. Campos de Data de Início e Quantidade de Dias
  const [startDateIso, setStartDateIso] = useState<string>(todayIso);
  const [daysCount, setDaysCount] = useState<number>(
    initialType === 'FERIAS'
      ? 15
      : initialType === 'FALTA' || initialType === 'FOLGA'
      ? 1
      : 3
  );

  // Campos para Controle de Horários / Declaração de Horas / Hora Extra
  const [timeSubType, setTimeSubType] = useState<TimeTrackingSubType>(
    'ENTROU_MAIS_TARDE_DECLARACAO'
  );
  const [hoursMode, setHoursMode] = useState<'ABONO_COMPARECIMENTO' | 'CREDITO_EXTRA' | 'DEBITO_HORAS'>(
    'ABONO_COMPARECIMENTO'
  );
  const [hoursAmount, setHoursAmount] = useState<number>(2);
  const [plannedStartTime, setPlannedStartTime] = useState<string>('07:00');
  const [plannedEndTime, setPlannedEndTime] = useState<string>('19:00');
  const [actualStartTime, setActualStartTime] = useState<string>('09:00');
  const [actualEndTime, setActualEndTime] = useState<string>('19:00');
  const [declarationDelivered, setDeclarationDelivered] = useState<boolean>(true);

  // Campos complementares manuais (sem exigir arquivo)
  const [cidCode, setCidCode] = useState<string>('');
  const [reasonText, setReasonText] = useState<string>('');
  const [showOptionalAttachment, setShowOptionalAttachment] = useState<boolean>(false);
  const [attachmentName, setAttachmentName] = useState<string>('');
  const [attachmentBase64, setAttachmentBase64] = useState<string>('');
  const [attachmentMimeType, setAttachmentMimeType] = useState<string>('');

  const [savedSummary, setSavedSummary] = useState<{
    employeeName: string;
    title: string;
    endDateFormatted: string;
    nextShiftFormatted: string;
    nextShiftLabel: string;
  } | null>(null);

  const selectedEmployee: Employee | undefined = useMemo(
    () => activeEmployees.find((e) => e.id === selectedEmployeeId) || activeEmployees[0],
    [activeEmployees, selectedEmployeeId]
  );

  // Atualiza horários previstos ao trocar de colaborador ou modalidade de horário
  useEffect(() => {
    if (!selectedEmployee) return;
    const { plannedStart, plannedEnd } = parseEmployeeWorkHours(
      selectedEmployee.workHours,
      selectedEmployee.defaultShift
    );
    setPlannedStartTime(plannedStart);
    setPlannedEndTime(plannedEnd);

    const addHoursToTime = (base: string, deltaH: number) => {
      const [h, m] = base.split(':').map(Number);
      const totalM = ((h || 0) * 60 + (m || 0) + Math.round(deltaH * 60) + 24 * 60) % (24 * 60);
      const nh = String(Math.floor(totalM / 60)).padStart(2, '0');
      const nm = String(totalM % 60).padStart(2, '0');
      return `${nh}:${nm}`;
    };

    if (timeSubType === 'FICOU_MAIS_TARDE') {
      setActualStartTime(plannedStart);
      setActualEndTime(addHoursToTime(plannedEnd, 2));
      setHoursAmount(2);
      setHoursMode('CREDITO_EXTRA');
    } else if (timeSubType === 'ENTROU_MAIS_TARDE_DECLARACAO') {
      setActualStartTime(addHoursToTime(plannedStart, 2));
      setActualEndTime(plannedEnd);
      setHoursAmount(2);
      setHoursMode('ABONO_COMPARECIMENTO');
    } else if (timeSubType === 'SAIU_MAIS_CEDO_DECLARACAO') {
      setActualStartTime(plannedStart);
      setActualEndTime(addHoursToTime(plannedEnd, -2));
      setHoursAmount(2);
      setHoursMode('ABONO_COMPARECIMENTO');
    } else {
      setActualStartTime(addHoursToTime(plannedStart, 1.5));
      setActualEndTime(plannedEnd);
      setHoursAmount(1.5);
      setHoursMode('DEBITO_HORAS');
    }
  }, [selectedEmployee, timeSubType]);

  // Cálculo automático em tempo real do término do atestado e do próximo plantão mediante a escala
  const calculation = useMemo(() => {
    if (!selectedEmployee) return null;
    const effectiveDays =
      occurrenceType === 'FALTA' || occurrenceType === 'DECLARACAO_HORAS'
        ? 1
        : Math.max(1, Number(daysCount) || 1);
    return calculateLeaveAndNextShift(
      selectedEmployee,
      state.schedules,
      startDateIso,
      effectiveDays
    );
  }, [selectedEmployee, state.schedules, startDateIso, daysCount, occurrenceType]);

  const handleOptionalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachmentName(file.name);
    setAttachmentMimeType(file.type || 'application/octet-stream');
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (typeof ev.target?.result === 'string') {
        setAttachmentBase64(ev.target.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee || !calculation) return;

    if (occurrenceType === 'ATESTADO') {
      const autoReason =
        reasonText.trim() ||
        `Atestado Médico de ${calculation.daysCount} ${
          calculation.daysCount === 1 ? 'dia' : 'dias'
        } (Acaba em ${calculation.endDateFormatted} · Próximo plantão: ${
          calculation.nextShiftDateFormatted
        })`;

      const record: AbsenceRecord = {
        id: `atestado-${Date.now()}`,
        employeeId: selectedEmployee.id,
        type: 'ATESTADO',
        startDate: calculation.startDateIso,
        endDate: calculation.endDateIso,
        nextShiftDate: calculation.nextShiftDateIso,
        daysCount: calculation.daysCount,
        shift: selectedEmployee.defaultShift,
        cid: cidCode.trim() || undefined,
        reason: autoReason,
        attachmentName: attachmentName || undefined,
        attachmentBase64: attachmentBase64 || undefined,
        attachmentMimeType: attachmentMimeType || undefined,
        createdAt: new Date().toISOString(),
      };

      onApplyLeaveOrOccurrence({
        employeeId: selectedEmployee.id,
        record,
        scheduleStatusToApply: 'AT',
      });

      setSavedSummary({
        employeeName: selectedEmployee.name,
        title: `Atestado de ${calculation.daysCount} ${
          calculation.daysCount === 1 ? 'dia' : 'dias'
        } registrado`,
        endDateFormatted: calculation.endDateFormatted,
        nextShiftFormatted: calculation.nextShiftDateFormatted,
        nextShiftLabel: calculation.nextShiftLabel,
      });
    } else if (occurrenceType === 'DECLARACAO_HORAS') {
      const hrs = Math.max(0.25, Math.round((Number(hoursAmount) || 1) * 100) / 100);
      const formattedHrs = formatDecimalHoursPtBr(hrs, false);
      const delta =
        hoursMode === 'CREDITO_EXTRA'
          ? hrs
          : hoursMode === 'DEBITO_HORAS'
          ? -hrs
          : 0;

      const scheduleWindowDesc = `Previsto: ${plannedStartTime} às ${plannedEndTime} · Realizado: ${actualStartTime} às ${actualEndTime}`;
      const declarationTag =
        timeSubType === 'ENTROU_MAIS_TARDE_DECLARACAO' ||
        timeSubType === 'SAIU_MAIS_CEDO_DECLARACAO' ||
        hoursMode === 'ABONO_COMPARECIMENTO'
          ? declarationDelivered
            ? ' · Declaração Entregue'
            : ' · Pendente entregar declaração'
          : '';

      const subTypeLabel =
        timeSubType === 'FICOU_MAIS_TARDE'
          ? `Ficou até mais tarde (+${formattedHrs} no Banco de Horas · ${scheduleWindowDesc})`
          : timeSubType === 'ENTROU_MAIS_TARDE_DECLARACAO'
          ? `Entrou mais tarde às ${actualStartTime} com Declaração de Horas (${formattedHrs} abonadas · ${scheduleWindowDesc}${declarationTag})`
          : timeSubType === 'SAIU_MAIS_CEDO_DECLARACAO'
          ? `Saiu mais cedo às ${actualEndTime} com Declaração de Horas (${formattedHrs} abonadas · ${scheduleWindowDesc}${declarationTag})`
          : `Atraso / Saída antecipada sem declaração (-${formattedHrs} no Banco de Horas · ${scheduleWindowDesc})`;

      const record: AbsenceRecord = {
        id: `horas-${Date.now()}`,
        employeeId: selectedEmployee.id,
        type: timeSubType === 'FICOU_MAIS_TARDE' ? 'HORA_EXTRA' : 'DECLARACAO_HORAS',
        startDate: startDateIso,
        endDate: startDateIso,
        nextShiftDate: calculation.nextShiftDateIso,
        daysCount: 1,
        shift: selectedEmployee.defaultShift,
        extraHours: delta,
        hoursDuration: hrs,
        timeTrackingSubType: timeSubType,
        plannedStartTime,
        plannedEndTime,
        actualStartTime,
        actualEndTime,
        declarationDelivered:
          timeSubType === 'ENTROU_MAIS_TARDE_DECLARACAO' ||
          timeSubType === 'SAIU_MAIS_CEDO_DECLARACAO' ||
          hoursMode === 'ABONO_COMPARECIMENTO'
            ? declarationDelivered
            : undefined,
        reason: reasonText.trim() ? `${subTypeLabel} — ${reasonText.trim()}` : subTypeLabel,
        attachmentName: attachmentName || undefined,
        attachmentBase64: attachmentBase64 || undefined,
        attachmentMimeType: attachmentMimeType || undefined,
        createdAt: new Date().toISOString(),
      };

      onApplyLeaveOrOccurrence({
        employeeId: selectedEmployee.id,
        record,
        hourBankDelta: delta,
      });

      setSavedSummary({
        employeeName: selectedEmployee.name,
        title: subTypeLabel,
        endDateFormatted: formatDateWithWeekdayPtBr(startDateIso),
        nextShiftFormatted: calculation.nextShiftDateFormatted,
        nextShiftLabel: calculation.nextShiftLabel,
      });
    } else if (occurrenceType === 'FOLGA') {
      const record: AbsenceRecord = {
        id: `folga-${Date.now()}`,
        employeeId: selectedEmployee.id,
        type: 'FOLGA',
        startDate: calculation.startDateIso,
        endDate: calculation.endDateIso,
        nextShiftDate: calculation.nextShiftDateIso,
        daysCount: calculation.daysCount,
        shift: selectedEmployee.defaultShift,
        reason:
          reasonText.trim() ||
          `Folga marcada na escala (${calculation.daysCount} ${
            calculation.daysCount === 1 ? 'dia' : 'dias'
          } · Próximo plantão: ${calculation.nextShiftDateFormatted}).`,
        createdAt: new Date().toISOString(),
      };

      onApplyLeaveOrOccurrence({
        employeeId: selectedEmployee.id,
        record,
        scheduleStatusToApply: 'F',
      });

      setSavedSummary({
        employeeName: selectedEmployee.name,
        title: `Folga (F) de ${calculation.daysCount} ${
          calculation.daysCount === 1 ? 'dia' : 'dias'
        } marcada na escala`,
        endDateFormatted: calculation.endDateFormatted,
        nextShiftFormatted: calculation.nextShiftDateFormatted,
        nextShiftLabel: calculation.nextShiftLabel,
      });
    } else if (occurrenceType === 'FALTA') {
      const record: AbsenceRecord = {
        id: `falta-${Date.now()}`,
        employeeId: selectedEmployee.id,
        type: 'FALTA',
        startDate: calculation.startDateIso,
        endDate: calculation.endDateIso,
        nextShiftDate: calculation.nextShiftDateIso,
        daysCount: 1,
        shift: selectedEmployee.defaultShift,
        reason:
          reasonText.trim() ||
          `Falta ao plantão registrada em ${calculation.startDateFormatted}. Próximo plantão: ${calculation.nextShiftDateFormatted}.`,
        createdAt: new Date().toISOString(),
      };

      onApplyLeaveOrOccurrence({
        employeeId: selectedEmployee.id,
        record,
        scheduleStatusToApply: 'FA',
      });

      setSavedSummary({
        employeeName: selectedEmployee.name,
        title: 'Falta (FA) registrada na escala',
        endDateFormatted: calculation.endDateFormatted,
        nextShiftFormatted: calculation.nextShiftDateFormatted,
        nextShiftLabel: calculation.nextShiftLabel,
      });
    } else if (occurrenceType === 'FERIAS') {
      const record: AbsenceRecord = {
        id: `ferias-${Date.now()}`,
        employeeId: selectedEmployee.id,
        type: 'FERIAS',
        startDate: calculation.startDateIso,
        endDate: calculation.endDateIso,
        nextShiftDate: calculation.nextShiftDateIso,
        daysCount: calculation.daysCount,
        shift: selectedEmployee.defaultShift,
        reason:
          reasonText.trim() ||
          `Férias de ${calculation.daysCount} dias (Acaba em ${calculation.endDateFormatted} · Retorno ao plantão: ${calculation.nextShiftDateFormatted}).`,
        createdAt: new Date().toISOString(),
      };

      onApplyLeaveOrOccurrence({
        employeeId: selectedEmployee.id,
        record,
        scheduleStatusToApply: 'FE',
      });

      setSavedSummary({
        employeeName: selectedEmployee.name,
        title: `Férias de ${calculation.daysCount} dias programadas`,
        endDateFormatted: calculation.endDateFormatted,
        nextShiftFormatted: calculation.nextShiftDateFormatted,
        nextShiftLabel: calculation.nextShiftLabel,
      });
    }
  };

  const getUnitName = (unitId: string) =>
    state.units.find((u) => u.id === unitId)?.name || 'Unidade';

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 md:p-6 overflow-y-auto no-print">
      <div className="bg-white rounded-3xl max-w-2xl w-full border border-slate-200 shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Cabeçalho */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-teal-500/20 border border-teal-400/30 text-teal-300 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs font-bold text-teal-400">
                Lançamento Manual Inteligente · Sem exigir arquivo
              </span>
              <h2 className="text-base md:text-lg font-bold text-white">
                Central de Atestados, Horas e Cálculo de Retorno
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tela de Sucesso pós-lançamento */}
        {savedSummary ? (
          <div className="p-6 md:p-8 space-y-6 text-center overflow-y-auto">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-9 h-9" />
            </div>
            <div className="space-y-1">
              <span className="text-xs font-bold text-teal-700">
                Escala e Prontuário Atualizados em Todo o App!
              </span>
              <h3 className="text-xl font-bold text-slate-900">
                {savedSummary.employeeName}
              </h3>
              <p className="text-sm text-slate-600 font-medium">{savedSummary.title}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left bg-slate-50 p-5 rounded-2xl border border-slate-200">
              <div className="p-3.5 rounded-xl bg-white border border-slate-200">
                <span className="text-xs font-bold text-slate-500 block">
                  Último Dia do Afastamento (Acaba em):
                </span>
                <span className="text-sm font-bold text-slate-900 mt-1 block">
                  {savedSummary.endDateFormatted}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-teal-50 border border-teal-200">
                <span className="text-xs font-bold text-teal-800 block">
                  Próximo Plantão da Pessoa (Retorno):
                </span>
                <span className="text-sm font-bold text-teal-950 mt-1 block">
                  {savedSummary.nextShiftFormatted}
                </span>
                <span className="text-[11px] text-teal-700 font-semibold block mt-0.5">
                  {savedSummary.nextShiftLabel}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setSavedSummary(null);
                  setReasonText('');
                  setCidCode('');
                }}
                className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-bold cursor-pointer"
              >
                Lançar Outro Atestado / Ocorrência
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2.5 rounded-xl bg-[#0d9488] hover:bg-teal-700 text-white text-xs font-bold cursor-pointer"
              >
                Concluir e Ver Painel Atualizado
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 md:p-6 overflow-y-auto space-y-5">
            {/* PERGUNTA 1: ESCOLHA O COLABORADOR */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-800">
                1. Qual colaborador você deseja selecionar?
              </label>
              <select
                value={selectedEmployee?.id || ''}
                onChange={(e) => setSelectedEmployeeId(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base font-semibold text-slate-900"
              >
                {activeEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} — {emp.role} ({getUnitName(emp.unitId)} ·{' '}
                    {REGIME_LABELS[emp.regime]})
                  </option>
                ))}
              </select>

              {selectedEmployee && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-200">
                  <UserCheck className="w-4 h-4 text-teal-600 shrink-0" />
                  <span>
                    Escala atual: <strong>{REGIME_LABELS[selectedEmployee.regime]}</strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Turno: <strong>{selectedEmployee.defaultShift}</strong> (
                    {selectedEmployee.workHours})
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Saldo BH:{' '}
                    <strong>
                      {selectedEmployee.hourBankBalance >= 0
                        ? `+${selectedEmployee.hourBankBalance}h`
                        : `${selectedEmployee.hourBankBalance}h`}
                    </strong>
                  </span>
                </div>
              )}
            </div>

            {/* PERGUNTA 2: O QUE DESEJA COLOCAR? */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-800">
                2. O que você deseja lançar para {selectedEmployee?.name.split(' ')[0]}?
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setOccurrenceType('FOLGA');
                    setDaysCount(1);
                  }}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    occurrenceType === 'FOLGA'
                      ? 'border-emerald-600 bg-emerald-50/80 ring-2 ring-emerald-600/20'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Calendar className="w-5 h-5 text-emerald-600 mb-1" />
                  <div className="text-xs font-bold text-slate-900">Marcar Folga</div>
                  <div className="text-[10px] text-slate-500">Marca F na escala</div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOccurrenceType('ATESTADO');
                    if (daysCount === 1) setDaysCount(3);
                  }}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    occurrenceType === 'ATESTADO'
                      ? 'border-amber-500 bg-amber-50/80 ring-2 ring-amber-500/20'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <FileWarning className="w-5 h-5 text-amber-600 mb-1" />
                  <div className="text-xs font-bold text-slate-900">Atestado Médico</div>
                  <div className="text-[10px] text-slate-500">Calcula dias e retorno</div>
                </button>

                <button
                  type="button"
                  onClick={() => setOccurrenceType('DECLARACAO_HORAS')}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    occurrenceType === 'DECLARACAO_HORAS'
                      ? 'border-teal-600 bg-teal-50/80 ring-2 ring-teal-600/20'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Clock className="w-5 h-5 text-teal-600 mb-1" />
                  <div className="text-xs font-bold text-slate-900">Horas / Abono</div>
                  <div className="text-[10px] text-slate-500">Consulta ou Hora Extra</div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOccurrenceType('FALTA');
                    setDaysCount(1);
                  }}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    occurrenceType === 'FALTA'
                      ? 'border-red-600 bg-red-50/80 ring-2 ring-red-600/20'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <UserX className="w-5 h-5 text-red-600 mb-1" />
                  <div className="text-xs font-bold text-slate-900">Falta no Dia</div>
                  <div className="text-[10px] text-slate-500">Marca FA na escala</div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOccurrenceType('FERIAS');
                    setDaysCount(15);
                  }}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    occurrenceType === 'FERIAS'
                      ? 'border-cyan-600 bg-cyan-50/80 ring-2 ring-cyan-600/20'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Plane className="w-5 h-5 text-cyan-600 mb-1" />
                  <div className="text-xs font-bold text-slate-900">Férias</div>
                  <div className="text-[10px] text-slate-500">Marca FE e retorno</div>
                </button>
              </div>
            </div>

            {/* PERGUNTA 3: CONTROLE DE HORÁRIOS DO DIA OU PERÍODO DE AFASTAMENTO */}
            {occurrenceType === 'DECLARACAO_HORAS' ? (
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-2">
                    3. O que aconteceu no horário de {selectedEmployee?.name.split(' ')[0]}?
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setTimeSubType('FICOU_MAIS_TARDE')}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        timeSubType === 'FICOU_MAIS_TARDE'
                          ? 'bg-emerald-700 text-white border-emerald-800 shadow-xs'
                          : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      <div className="text-xs font-bold">
                        Ficou até mais tarde (Hora Extra +BH)
                      </div>
                      <div
                        className={`text-[11px] mt-0.5 ${
                          timeSubType === 'FICOU_MAIS_TARDE'
                            ? 'text-emerald-100'
                            : 'text-slate-500'
                        }`}
                      >
                        Passou do horário de saída e soma no Banco de Horas
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setTimeSubType('ENTROU_MAIS_TARDE_DECLARACAO')}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        timeSubType === 'ENTROU_MAIS_TARDE_DECLARACAO'
                          ? 'bg-teal-700 text-white border-teal-800 shadow-xs'
                          : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      <div className="text-xs font-bold">
                        Entrou mais tarde + Declaração de Horas
                      </div>
                      <div
                        className={`text-[11px] mt-0.5 ${
                          timeSubType === 'ENTROU_MAIS_TARDE_DECLARACAO'
                            ? 'text-teal-100'
                            : 'text-slate-500'
                        }`}
                      >
                        Chegou depois por consulta/exame e entregou declaração
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setTimeSubType('SAIU_MAIS_CEDO_DECLARACAO')}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        timeSubType === 'SAIU_MAIS_CEDO_DECLARACAO'
                          ? 'bg-teal-700 text-white border-teal-800 shadow-xs'
                          : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      <div className="text-xs font-bold">
                        Saiu mais cedo + Declaração de Horas
                      </div>
                      <div
                        className={`text-[11px] mt-0.5 ${
                          timeSubType === 'SAIU_MAIS_CEDO_DECLARACAO'
                            ? 'text-teal-100'
                            : 'text-slate-500'
                        }`}
                      >
                        Precisou sair antes com comprovante de comparecimento
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setTimeSubType('ATRASO_DESCONTO_BH')}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        timeSubType === 'ATRASO_DESCONTO_BH'
                          ? 'bg-red-600 text-white border-red-700 shadow-xs'
                          : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      <div className="text-xs font-bold">
                        Entrou mais tarde / Saiu cedo SEM Declaração (-BH)
                      </div>
                      <div
                        className={`text-[11px] mt-0.5 ${
                          timeSubType === 'ATRASO_DESCONTO_BH'
                            ? 'text-red-100'
                            : 'text-slate-500'
                        }`}
                      >
                        Desconta as horas de atraso ou saída do Banco de Horas
                      </div>
                    </button>
                  </div>
                </div>

                {/* Data e Horários Previsto x Realizado */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white p-3.5 rounded-xl border border-slate-200">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Data do Plantão
                    </label>
                    <input
                      type="date"
                      required
                      value={startDateIso}
                      onChange={(e) => setStartDateIso(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base font-semibold text-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      {timeSubType === 'FICOU_MAIS_TARDE' ||
                      timeSubType === 'SAIU_MAIS_CEDO_DECLARACAO'
                        ? 'Horário Previsto de Saída'
                        : 'Horário Previsto de Entrada'}
                    </label>
                    <input
                      type="time"
                      value={
                        timeSubType === 'FICOU_MAIS_TARDE' ||
                        timeSubType === 'SAIU_MAIS_CEDO_DECLARACAO'
                          ? plannedEndTime
                          : plannedStartTime
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        if (
                          timeSubType === 'FICOU_MAIS_TARDE' ||
                          timeSubType === 'SAIU_MAIS_CEDO_DECLARACAO'
                        ) {
                          setPlannedEndTime(val);
                          const diff =
                            timeSubType === 'FICOU_MAIS_TARDE'
                              ? computeHoursDiffBetweenTimes(val, actualEndTime)
                              : computeHoursDiffBetweenTimes(actualEndTime, val);
                          if (diff > 0) setHoursAmount(diff);
                        } else {
                          setPlannedStartTime(val);
                          const diff = computeHoursDiffBetweenTimes(val, actualStartTime);
                          if (diff > 0) setHoursAmount(diff);
                        }
                      }}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-base font-bold text-slate-900 tabular-nums"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-teal-800 mb-1">
                      {timeSubType === 'FICOU_MAIS_TARDE'
                        ? 'Horário que Saiu (Mais Tarde)'
                        : timeSubType === 'SAIU_MAIS_CEDO_DECLARACAO'
                        ? 'Horário que Saiu (Mais Cedo)'
                        : 'Horário Real que Entrou'}
                    </label>
                    <input
                      type="time"
                      value={
                        timeSubType === 'FICOU_MAIS_TARDE' ||
                        timeSubType === 'SAIU_MAIS_CEDO_DECLARACAO'
                          ? actualEndTime
                          : actualStartTime
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        if (timeSubType === 'FICOU_MAIS_TARDE') {
                          setActualEndTime(val);
                          const diff = computeHoursDiffBetweenTimes(plannedEndTime, val);
                          if (diff > 0) setHoursAmount(diff);
                        } else if (timeSubType === 'SAIU_MAIS_CEDO_DECLARACAO') {
                          setActualEndTime(val);
                          const diff = computeHoursDiffBetweenTimes(val, plannedEndTime);
                          if (diff > 0) setHoursAmount(diff);
                        } else {
                          setActualStartTime(val);
                          const diff = computeHoursDiffBetweenTimes(plannedStartTime, val);
                          if (diff > 0) setHoursAmount(diff);
                        }
                      }}
                      className="w-full px-3 py-2 rounded-xl border-2 border-teal-600 bg-white text-base font-bold text-slate-900 tabular-nums"
                    />
                  </div>
                </div>

                {/* Quantidade de Horas Calculada + Atalhos Rápidos */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200">
                  <div>
                    <label className="block text-xs font-bold text-slate-800">
                      Total de Horas Calculado ({formatDecimalHoursPtBr(hoursAmount, false)})
                    </label>
                    <p className="text-[11px] text-slate-500">
                      Calculado automaticamente pelos horários acima (ou ajuste ao lado):
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      type="number"
                      min={0.25}
                      max={24}
                      step={0.25}
                      value={hoursAmount}
                      onChange={(e) => setHoursAmount(Number(e.target.value))}
                      className="w-20 px-2.5 py-1.5 rounded-xl border border-slate-300 bg-white text-base font-bold text-slate-900 tabular-nums"
                    />
                    {[0.5, 1, 1.5, 2, 3, 4, 6].map((h) => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => setHoursAmount(h)}
                        className={`px-2 py-1.5 rounded-lg text-xs font-bold border cursor-pointer tabular-nums ${
                          hoursAmount === h
                            ? 'bg-teal-600 text-white border-teal-700'
                            : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        {formatDecimalHoursPtBr(h)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Controle de Entrega da Declaração de Horas (Quando aplicável) */}
                {(timeSubType === 'ENTROU_MAIS_TARDE_DECLARACAO' ||
                  timeSubType === 'SAIU_MAIS_CEDO_DECLARACAO') && (
                  <div className="bg-teal-50/80 border border-teal-200 rounded-xl p-3.5 space-y-2">
                    <span className="block text-xs font-bold text-teal-950">
                      Controle da Declaração de Horas / Comparecimento:
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setDeclarationDelivered(true)}
                        className={`p-2.5 rounded-xl border text-left text-xs font-bold cursor-pointer flex items-center gap-2 ${
                          declarationDelivered
                            ? 'bg-teal-700 text-white border-teal-800'
                            : 'bg-white text-slate-700 border-slate-300'
                        }`}
                      >
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>Já entregou a Declaração de Horas (Validada)</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setDeclarationDelivered(false)}
                        className={`p-2.5 rounded-xl border text-left text-xs font-bold cursor-pointer flex items-center gap-2 ${
                          !declarationDelivered
                            ? 'bg-amber-600 text-white border-amber-700'
                            : 'bg-white text-slate-700 border-slate-300'
                        }`}
                      >
                        <Clock className="w-4 h-4 shrink-0" />
                        <span>Avisou · Pendente entregar o papel depois</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Como aplicar no Banco de Horas */}
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1.5">
                    Reflexo no Banco de Horas de {selectedEmployee?.name.split(' ')[0]}:
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setHoursMode('ABONO_COMPARECIMENTO')}
                      className={`p-2.5 rounded-xl border text-left text-xs font-bold cursor-pointer ${
                        hoursMode === 'ABONO_COMPARECIMENTO'
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-700 border-slate-300'
                      }`}
                    >
                      Abonar com Declaração (0h · Não desconta do BH)
                    </button>
                    <button
                      type="button"
                      onClick={() => setHoursMode('CREDITO_EXTRA')}
                      className={`p-2.5 rounded-xl border text-left text-xs font-bold cursor-pointer ${
                        hoursMode === 'CREDITO_EXTRA'
                          ? 'bg-emerald-700 text-white border-emerald-800'
                          : 'bg-white text-slate-700 border-slate-300'
                      }`}
                    >
                      Somar (+{formatDecimalHoursPtBr(hoursAmount)}) no Banco de Horas
                    </button>
                    <button
                      type="button"
                      onClick={() => setHoursMode('DEBITO_HORAS')}
                      className={`p-2.5 rounded-xl border text-left text-xs font-bold cursor-pointer ${
                        hoursMode === 'DEBITO_HORAS'
                          ? 'bg-red-600 text-white border-red-700'
                          : 'bg-white text-slate-700 border-slate-300'
                      }`}
                    >
                      Descontar (-{formatDecimalHoursPtBr(hoursAmount)}) do Banco de Horas
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Dia em que começou */}
                  <div>
                    <label className="block text-xs font-bold text-slate-800 mb-1">
                      3. Que dia o {occurrenceType === 'FERIAS' ? 'período de férias' : occurrenceType === 'FALTA' ? 'plantão com falta' : 'atestado'} começou?
                    </label>
                    <input
                      type="date"
                      required
                      value={startDateIso}
                      onChange={(e) => setStartDateIso(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-base font-semibold text-slate-900"
                    />
                    <div className="flex items-center gap-1.5 mt-2">
                      <button
                        type="button"
                        onClick={() => setStartDateIso(todayIso)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${
                          startDateIso === todayIso
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-600 border-slate-300'
                        }`}
                      >
                        Hoje
                      </button>
                      <button
                        type="button"
                        onClick={() => setStartDateIso(yesterdayIso)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${
                          startDateIso === yesterdayIso
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-600 border-slate-300'
                        }`}
                      >
                        Ontem
                      </button>
                    </div>
                  </div>

                  {/* Quantos dias são */}
                  {occurrenceType !== 'FALTA' && (
                    <div>
                      <label className="block text-xs font-bold text-slate-800 mb-1">
                        4. Quantos dias de afastamento são?
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={120}
                        required
                        value={daysCount}
                        onChange={(e) =>
                          setDaysCount(Math.max(1, Number(e.target.value) || 1))
                        }
                        className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-base font-bold text-slate-900 tabular-nums"
                      />
                      <div className="flex flex-wrap items-center gap-1 mt-2">
                        {(occurrenceType === 'FERIAS'
                          ? [7, 10, 15, 20, 30]
                          : [1, 2, 3, 5, 7, 10, 14, 15]
                        ).map((dNum) => (
                          <button
                            key={dNum}
                            type="button"
                            onClick={() => setDaysCount(dNum)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer tabular-nums ${
                              daysCount === dNum
                                ? 'bg-[#0d9488] text-white border-teal-700'
                                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                            }`}
                          >
                            {dNum} {dNum === 1 ? 'dia' : 'dias'}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* RESULTADO DO CÁLCULO AUTOMÁTICO EM TEMPO REAL */}
                {calculation && (
                  <div className="rounded-2xl bg-white border-2 border-teal-600 p-4 space-y-3 shadow-xs">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                      <span className="text-xs font-bold text-teal-800 flex items-center gap-1.5">
                        <CalendarCheck className="w-4 h-4 text-teal-600" />
                        Cálculo Automático pela Escala ({selectedEmployee && REGIME_LABELS[selectedEmployee.regime]})
                      </span>
                      <span className="text-xs font-bold text-amber-700 tabular-nums">
                        {calculation.daysCount}{' '}
                        {calculation.daysCount === 1 ? 'dia corrido' : 'dias corridos'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                        <span className="text-[11px] font-semibold text-slate-500 block">
                          Início do Afastamento
                        </span>
                        <span className="text-xs font-bold text-slate-900 mt-0.5 block">
                          {calculation.startDateFormatted}
                        </span>
                      </div>

                      <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                        <span className="text-[11px] font-semibold text-amber-800 block">
                          Que Dia Ele Acaba (Último Dia)
                        </span>
                        <span className="text-xs font-bold text-amber-950 mt-0.5 block">
                          {calculation.endDateFormatted}
                        </span>
                      </div>

                      <div className="p-3 rounded-xl bg-teal-50 border border-teal-300">
                        <span className="text-[11px] font-bold text-teal-800 block">
                          Próximo Plantão da Pessoa
                        </span>
                        <span className="text-xs font-bold text-teal-950 mt-0.5 block">
                          {calculation.nextShiftDateFormatted}
                        </span>
                        <span className="text-[10px] font-semibold text-teal-700 block">
                          {calculation.nextShiftLabel}
                        </span>
                      </div>
                    </div>

                    {/* Detalhamento dos dias que serão marcados na grade */}
                    <div className="pt-1">
                      <p className="text-[11px] text-slate-600 mb-1.5">
                        Dias que serão atualizados automaticamente na Escala (afeta{' '}
                        <strong>
                          {calculation.affectedWorkShiftsCount}{' '}
                          {calculation.affectedWorkShiftsCount === 1
                            ? 'dia de plantão'
                            : 'dias de plantão'}
                        </strong>
                        ):
                      </p>
                      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                        {calculation.coveredDaysDetails.map((item) => {
                          const origMeta = SHIFT_STATUS_META[item.originalStatus];
                          return (
                            <span
                              key={item.iso}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 border border-slate-200 text-[11px] font-medium text-slate-800 tabular-nums"
                            >
                              <strong>{item.shortDate}</strong> ({item.weekday}) · era{' '}
                              <span className="font-bold">{origMeta.code}</span>
                              <ArrowRight className="w-3 h-3 text-slate-400" />
                              <span className="font-bold text-amber-700">
                                {occurrenceType === 'FERIAS'
                                  ? 'FE'
                                  : occurrenceType === 'FALTA'
                                  ? 'FA'
                                  : occurrenceType === 'FOLGA'
                                  ? 'F'
                                  : 'AT'}
                              </span>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* OBSERVAÇÕES MANUAIS E ANEXO TOTALMENTE OPCIONAL */}
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {occurrenceType === 'ATESTADO' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      CID / Código (Opcional)
                    </label>
                    <input
                      type="text"
                      value={cidCode}
                      onChange={(e) => setCidCode(e.target.value)}
                      placeholder="Ex: J06.9 (se souber)"
                      className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                    />
                  </div>
                )}

                <div className={occurrenceType === 'ATESTADO' ? 'sm:col-span-2' : 'sm:col-span-3'}>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Observação / Motivo (Opcional — não precisa de arquivo)
                  </label>
                  <input
                    type="text"
                    value={reasonText}
                    onChange={(e) => setReasonText(e.target.value)}
                    placeholder="Ex: Informado pelo colaborador, vai entregar o papel no retorno..."
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                  />
                </div>
              </div>

              {/* Opção recolhível caso tenha arquivo */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowOptionalAttachment((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-teal-700 cursor-pointer"
                >
                  <Paperclip className="w-3.5 h-3.5" />
                  <span>
                    {showOptionalAttachment
                      ? 'Ocultar campo de anexo'
                      : 'Tem foto ou arquivo do atestado agora? (Clique se quiser anexar — opcional)'}
                  </span>
                </button>

                {showOptionalAttachment && (
                  <div className="mt-2 p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <span className="text-xs text-slate-600">
                      {attachmentName
                        ? `Arquivo selecionado: ${attachmentName}`
                        : 'Nenhum arquivo selecionado (o lançamento manual funciona sem arquivo)'}
                    </span>
                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-xs font-bold text-slate-800 cursor-pointer shrink-0">
                      <Paperclip className="w-3.5 h-3.5 text-teal-600" />
                      <span>Escolher Foto / PDF / Word</span>
                      <input
                        type="file"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,image/*,application/pdf"
                        onChange={handleOptionalFileChange}
                        className="hidden"
                      />
                    </label>
                  </div>
                )}
              </div>
            </div>

            {/* Botões Finais */}
            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 cursor-pointer"
              >
                Cancelar
              </button>

              <button
                type="submit"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#0d9488] hover:bg-teal-700 text-white text-xs font-bold transition-colors cursor-pointer shadow-xs"
              >
                <Calendar className="w-4 h-4" />
                <span>Confirmar e Atualizar Escala Inteira</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
