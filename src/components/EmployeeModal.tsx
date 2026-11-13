import React, { useState } from 'react';
import {
  AbsenceRecord,
  Employee,
  EscalaProState,
  HospitalUnit,
  NATIVE_HOSPITAL_ROLES,
  REGIME_LABELS,
  ScheduleRegime,
  UnitShiftMode,
  WORK_HOURS_PRESETS,
} from '../types';
import {
  calculateLeaveAndNextShift,
  formatDateWithWeekdayPtBr,
  formatIsoDate,
} from '../services/storageService';
import {
  Calendar,
  Camera,
  Check,
  Clock,
  Download,
  Eye,
  FileText,
  FileWarning,
  Minus,
  Paperclip,
  Plane,
  Plus,
  Save,
  Trash2,
  UserX,
  X,
} from 'lucide-react';

interface EmployeeModalProps {
  state: EscalaProState;
  employee: Employee | null; // null = Novo Colaborador
  initialUnitId?: string | null;
  onClose: () => void;
  onSaveEmployee: (
    emp: Employee,
    newCustomRole?: string,
    newUnitToCreate?: HospitalUnit
  ) => void;
  onDeleteEmployee?: (employeeId: string) => void;
  onRegisterAbsenceOrLeave: (
    employeeId: string,
    record: AbsenceRecord,
    statusToApply: 'F' | 'FA' | 'AT' | 'FE'
  ) => void;
}

export const EmployeeModal: React.FC<EmployeeModalProps> = ({
  state,
  employee,
  initialUnitId,
  onClose,
  onSaveEmployee,
  onDeleteEmployee,
  onRegisterAbsenceOrLeave,
}) => {
  const isNew = !employee;
  const now = new Date();
  const todayIso = formatIsoDate(now.getFullYear(), now.getMonth(), now.getDate());

  const allRoles = Array.from(new Set([...NATIVE_HOSPITAL_ROLES, ...state.customRoles]));
  const hasAlmoxarifadoUnit = state.units.some(
    (u) => u.name.trim().toLowerCase() === 'almoxarifado'
  );
  const hasRecebimentoUnit = state.units.some(
    (u) => u.name.trim().toLowerCase() === 'recebimento'
  );

  const [activeSubModal, setActiveSubModal] = useState<
    'NONE' | 'FOLGA' | 'FALTA' | 'ATESTADO' | 'FERIAS' | 'PREVIEW_ANEXO'
  >('NONE');

  // Dados cadastrais editáveis (sem valores de exemplo pré-preenchidos para novos cadastros)
  const [name, setName] = useState(employee?.name || '');
  const [registrationNumber, setRegistrationNumber] = useState(
    employee?.registrationNumber || ''
  );
  const [role, setRole] = useState(employee?.role || '');
  const [customRoleInput, setCustomRoleInput] = useState('');
  const [unitId, setUnitId] = useState(
    employee?.unitId || initialUnitId || state.units[0]?.id || ''
  );
  const [newUnitNameInput, setNewUnitNameInput] = useState('');
  const [newUnitShiftMode, setNewUnitShiftMode] = useState<UnitShiftMode>('24H');
  const [defaultShift, setDefaultShift] = useState<'Diurno' | 'Noturno'>(
    employee?.defaultShift || 'Diurno'
  );
  const [workHours, setWorkHours] = useState(
    employee?.workHours || WORK_HOURS_PRESETS[0]
  );
  const [regime, setRegime] = useState<ScheduleRegime>(
    employee?.regime || '12x36_ODD'
  );
  const [hourBankBalance, setHourBankBalance] = useState<number>(
    employee?.hourBankBalance ?? 0
  );
  const [avatarBase64, setAvatarBase64] = useState<string>(
    employee?.avatarBase64 || ''
  );

  // Estado para Marcar Folga
  const [folgaDate, setFolgaDate] = useState(todayIso);
  const [folgaDays, setFolgaDays] = useState<number>(1);
  const [folgaReason, setFolgaReason] = useState('');

  // Estado para Registrar Falta
  const [faltaDate, setFaltaDate] = useState(todayIso);
  const [faltaShift, setFaltaShift] = useState<'Diurno' | 'Noturno'>(
    employee?.defaultShift || 'Diurno'
  );
  const [faltaReason, setFaltaReason] = useState('');

  // Estado para Anexar Atestado Médico
  const [atestadoStartDate, setAtestadoStartDate] = useState(todayIso);
  const [atestadoDays, setAtestadoDays] = useState<number>(3);
  const [atestadoCid, setAtestadoCid] = useState('');
  const [atestadoReason, setAtestadoReason] = useState('');
  const [attachmentName, setAttachmentName] = useState('');
  const [attachmentBase64, setAttachmentBase64] = useState('');
  const [attachmentMimeType, setAttachmentMimeType] = useState('');

  // Estado para Programar Férias
  const [feriasStartDate, setFeriasStartDate] = useState(todayIso);
  const [feriasEndDate, setFeriasEndDate] = useState(
    formatIsoDate(now.getFullYear(), now.getMonth(), Math.min(28, now.getDate() + 14))
  );
  const [feriasReason, setFeriasReason] = useState('Férias regulamentares anuais');

  // Estado para visualização de anexo salvo
  const [previewRecord, setPreviewRecord] = useState<AbsenceRecord | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (typeof ev.target?.result === 'string') {
        setAvatarBase64(ev.target.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCertificateFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
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

  const handleRoleChange = (selectedRole: string) => {
    setRole(selectedRole);
    if (!isNew) return;
    if (selectedRole === 'Auxiliar de Almoxarifado') {
      const existingAlmox = state.units.find(
        (u) => u.name.trim().toLowerCase() === 'almoxarifado'
      );
      if (existingAlmox) {
        setUnitId(existingAlmox.id);
      } else if (!initialUnitId) {
        setUnitId('__CREATE_ALMOXARIFADO__');
      }
    } else if (selectedRole === 'Auxiliar de Recebimento') {
      const existingRec = state.units.find(
        (u) => u.name.trim().toLowerCase() === 'recebimento'
      );
      if (existingRec) {
        setUnitId(existingRec.id);
      } else if (!initialUnitId) {
        setUnitId('__CREATE_RECEBIMENTO__');
      }
    }
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const finalRole =
      role === 'NOVA_FUNCAO'
        ? customRoleInput.trim() || 'Profissional de Saúde'
        : role;

    let finalUnitId = unitId;
    let newUnitToCreate: HospitalUnit | undefined;

    if (
      unitId === '__CREATE_ALMOXARIFADO__' ||
      unitId === '__CREATE_RECEBIMENTO__' ||
      unitId === '__CREATE_CUSTOM_UNIT__'
    ) {
      const desiredUnitName =
        unitId === '__CREATE_ALMOXARIFADO__'
          ? 'Almoxarifado'
          : unitId === '__CREATE_RECEBIMENTO__'
          ? 'Recebimento'
          : newUnitNameInput.trim();

      if (!desiredUnitName) return;

      const alreadyExisting = state.units.find(
        (u) => u.name.trim().toLowerCase() === desiredUnitName.toLowerCase()
      );
      if (alreadyExisting) {
        finalUnitId = alreadyExisting.id;
      } else {
        const createdId = `unit-${Date.now()}`;
        finalUnitId = createdId;
        newUnitToCreate = {
          id: createdId,
          name: desiredUnitName,
          shiftMode: newUnitShiftMode,
          minStaffDay: newUnitShiftMode === 'NOTURNO' ? 0 : 1,
          minStaffNight: newUnitShiftMode === 'DIURNO' ? 0 : 1,
        };
      }
    }

    const updatedEmp: Employee = {
      id: employee?.id || `emp-${Date.now()}`,
      name: name.trim(),
      registrationNumber: registrationNumber.trim(),
      role: finalRole,
      unitId: finalUnitId || state.units[0]?.id || 'unit-1',
      defaultShift,
      workHours: workHours.trim() || '07:00 às 19:00',
      regime,
      hourBankBalance,
      avatarBase64: avatarBase64 || undefined,
      active: true,
      history: employee?.history || [],
    };

    onSaveEmployee(
      updatedEmp,
      role === 'NOVA_FUNCAO' && customRoleInput.trim()
        ? customRoleInput.trim()
        : undefined,
      newUnitToCreate
    );
    setFeedbackMsg('Dados cadastrais salvos e sincronizados com a escala!');
    setTimeout(() => {
      setFeedbackMsg(null);
      if (isNew) onClose();
    }, 1200);
  };

  const handleConfirmFolga = (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee) return;

    const days = Math.max(1, Math.min(30, Number(folgaDays) || 1));
    const calc = calculateLeaveAndNextShift(
      employee,
      state.schedules,
      folgaDate,
      days
    );

    const newRec: AbsenceRecord = {
      id: `folga-${Date.now()}`,
      employeeId: employee.id,
      type: 'FOLGA',
      startDate: calc.startDateIso,
      endDate: calc.endDateIso,
      nextShiftDate: calc.nextShiftDateIso,
      daysCount: days,
      shift: employee.defaultShift,
      reason:
        folgaReason.trim() ||
        `Folga marcada na escala (${days} ${days === 1 ? 'dia' : 'dias'} · Próximo plantão: ${
          calc.nextShiftDateFormatted
        }).`,
      createdAt: new Date().toISOString(),
    };

    onRegisterAbsenceOrLeave(employee.id, newRec, 'F');
    setActiveSubModal('NONE');
    setFolgaReason('');
    setFolgaDays(1);
    setFeedbackMsg(
      `Folga (F) salva na escala! Próximo plantão será em ${calc.nextShiftDateFormatted}.`
    );
    setTimeout(() => setFeedbackMsg(null), 4000);
  };

  const handleConfirmFalta = (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee) return;

    const newRec: AbsenceRecord = {
      id: `falta-${Date.now()}`,
      employeeId: employee.id,
      type: 'FALTA',
      startDate: faltaDate,
      daysCount: 1,
      shift: faltaShift,
      reason: faltaReason.trim() || 'Falta registrada no prontuário do colaborador.',
      createdAt: new Date().toISOString(),
    };

    onRegisterAbsenceOrLeave(employee.id, newRec, 'FA');
    setActiveSubModal('NONE');
    setFaltaReason('');
    setFeedbackMsg('Falta (FA) registrada e refletida automaticamente na escala!');
    setTimeout(() => setFeedbackMsg(null), 3500);
  };

  const handleConfirmAtestado = (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee) return;

    const days = Math.max(1, Math.min(120, Number(atestadoDays) || 1));
    const calc = calculateLeaveAndNextShift(
      employee,
      state.schedules,
      atestadoStartDate,
      days
    );

    const newRec: AbsenceRecord = {
      id: `atestado-${Date.now()}`,
      employeeId: employee.id,
      type: 'ATESTADO',
      startDate: calc.startDateIso,
      endDate: calc.endDateIso,
      nextShiftDate: calc.nextShiftDateIso,
      daysCount: days,
      shift: employee.defaultShift,
      cid: atestadoCid.trim() || undefined,
      reason:
        atestadoReason.trim() ||
        `Atestado Médico (${days} ${days === 1 ? 'dia' : 'dias'} · Acaba em ${
          calc.endDateFormatted
        } · Próximo plantão: ${calc.nextShiftDateFormatted})${
          atestadoCid ? ` · CID ${atestadoCid}` : ''
        }`,
      attachmentName: attachmentName || undefined,
      attachmentBase64: attachmentBase64 || undefined,
      attachmentMimeType: attachmentMimeType || undefined,
      createdAt: new Date().toISOString(),
    };

    onRegisterAbsenceOrLeave(employee.id, newRec, 'AT');
    setActiveSubModal('NONE');
    setAtestadoCid('');
    setAtestadoReason('');
    setAttachmentName('');
    setAttachmentBase64('');
    setFeedbackMsg(
      `Atestado salvo! Acaba em ${calc.endDateFormatted} e o próximo plantão será em ${calc.nextShiftDateFormatted}.`
    );
    setTimeout(() => setFeedbackMsg(null), 5000);
  };

  const handleConfirmFerias = (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee) return;

    const startObj = new Date(feriasStartDate + 'T00:00:00');
    const endObj = new Date(feriasEndDate + 'T00:00:00');
    const diffDays = Math.max(
      1,
      Math.round((endObj.getTime() - startObj.getTime()) / (1000 * 60 * 60 * 24)) + 1
    );
    const calc = calculateLeaveAndNextShift(
      employee,
      state.schedules,
      feriasStartDate,
      diffDays
    );

    const newRec: AbsenceRecord = {
      id: `ferias-${Date.now()}`,
      employeeId: employee.id,
      type: 'FERIAS',
      startDate: calc.startDateIso,
      endDate: calc.endDateIso,
      nextShiftDate: calc.nextShiftDateIso,
      daysCount: diffDays,
      reason:
        feriasReason.trim() ||
        `Férias programadas (${diffDays} dias · Acaba em ${calc.endDateFormatted} · Retorno ao plantão: ${calc.nextShiftDateFormatted}).`,
      createdAt: new Date().toISOString(),
    };

    onRegisterAbsenceOrLeave(employee.id, newRec, 'FE');
    setActiveSubModal('NONE');
    setFeedbackMsg(
      `Férias programadas! Acaba em ${calc.endDateFormatted} e o retorno ao plantão será em ${calc.nextShiftDateFormatted}.`
    );
    setTimeout(() => setFeedbackMsg(null), 5000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 md:p-6 overflow-y-auto no-print">
      <div className="bg-white rounded-3xl max-w-3xl w-full border border-slate-200 shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Cabeçalho do Prontuário */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between shrink-0">
          <div>
            <span className="text-xs font-semibold text-teal-400">
              {isNew
                ? 'Cadastro de Profissional Hospitalar'
                : 'Prontuário Individual e Gestão de Ausências'}
            </span>
            <h2 className="text-lg font-bold text-white">
              {isNew ? 'Novo Colaborador' : employee.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corpo rolável */}
        <div className="p-5 md:p-6 overflow-y-auto space-y-6">
          {feedbackMsg && (
            <div className="p-3.5 rounded-xl bg-teal-50 border border-teal-200 text-teal-900 text-xs font-bold flex items-center gap-2">
              <Check className="w-4 h-4 text-teal-600 shrink-0" />
              <span>{feedbackMsg}</span>
            </div>
          )}

          {/* Barra Rápida de Ações de Ausência (Apenas para colaborador já cadastrado) */}
          {!isNew && (
            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-700">
                  Lançamento Rápido na Escala (Reflete Imediatamente)
                </h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                <button
                  type="button"
                  onClick={() => setActiveSubModal('FOLGA')}
                  className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  <Calendar className="w-4 h-4" />
                  <span>Marcar Folga</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveSubModal('FALTA')}
                  className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  <UserX className="w-4 h-4" />
                  <span>Registrar Falta</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveSubModal('ATESTADO')}
                  className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  <FileWarning className="w-4 h-4" />
                  <span>Anexar Atestado Médico</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveSubModal('FERIAS')}
                  className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  <Plane className="w-4 h-4" />
                  <span>Programar Férias</span>
                </button>
              </div>

              {/* Sub-formulário de Marcar Folga */}
              {activeSubModal === 'FOLGA' && (
                <form
                  onSubmit={handleConfirmFolga}
                  className="mt-3 p-4 rounded-xl bg-white border border-emerald-200 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-emerald-900">
                      Marcar Folga na Escala (Marca F e grava no histórico)
                    </h4>
                    <button
                      type="button"
                      onClick={() => setActiveSubModal('NONE')}
                      className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                    >
                      Fechar
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Data da Folga
                      </label>
                      <input
                        type="date"
                        required
                        value={folgaDate}
                        onChange={(e) => setFolgaDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Quantidade de Dias de Folga
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={30}
                          required
                          value={folgaDays}
                          onChange={(e) =>
                            setFolgaDays(Math.max(1, Number(e.target.value) || 1))
                          }
                          className="w-24 px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900 tabular-nums"
                        />
                        <div className="flex items-center gap-1">
                          {[1, 2, 3].map((dNum) => (
                            <button
                              key={dNum}
                              type="button"
                              onClick={() => setFolgaDays(dNum)}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border cursor-pointer ${
                                folgaDays === dNum
                                  ? 'bg-emerald-600 text-white border-emerald-700'
                                  : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                              }`}
                            >
                              {dNum}d
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {employee && (() => {
                    const liveCalc = calculateLeaveAndNextShift(
                      employee,
                      state.schedules,
                      folgaDate,
                      folgaDays
                    );
                    return (
                      <div className="p-3 rounded-xl bg-emerald-50/80 border border-emerald-200 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-[11px] font-bold text-emerald-800 block">
                            Dia(s) de Folga:
                          </span>
                          <span className="font-bold text-slate-900">
                            {liveCalc.startDateFormatted}
                            {liveCalc.daysCount > 1 ? ` até ${liveCalc.endDateFormatted}` : ''}
                          </span>
                        </div>
                        <div>
                          <span className="text-[11px] font-bold text-teal-800 block">
                            Próximo Plantão de Retorno:
                          </span>
                          <span className="font-bold text-teal-950">
                            {liveCalc.nextShiftDateFormatted} · {liveCalc.nextShiftLabel}
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Observação / Motivo da Folga (opcional)
                    </label>
                    <input
                      type="text"
                      value={folgaReason}
                      onChange={(e) => setFolgaReason(e.target.value)}
                      placeholder="Ex: Folga concedida pela supervisão, compensação de plantão..."
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                    >
                      Confirmar Folga na Escala
                    </button>
                  </div>
                </form>
              )}

              {/* Sub-formulário de Registrar Falta */}
              {activeSubModal === 'FALTA' && (
                <form
                  onSubmit={handleConfirmFalta}
                  className="mt-3 p-4 rounded-xl bg-white border border-red-200 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-red-800">
                      Registrar Falta ao Plantão (Marca FA na Escala)
                    </h4>
                    <button
                      type="button"
                      onClick={() => setActiveSubModal('NONE')}
                      className="text-xs text-slate-500 hover:text-slate-800"
                    >
                      Fechar
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Data da Falta
                      </label>
                      <input
                        type="date"
                        required
                        value={faltaDate}
                        onChange={(e) => setFaltaDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Turno
                      </label>
                      <select
                        value={faltaShift}
                        onChange={(e) =>
                          setFaltaShift(e.target.value as 'Diurno' | 'Noturno')
                        }
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                      >
                        <option value="Diurno">Diurno</option>
                        <option value="Noturno">Noturno</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Justificativa / Observação da Supervisão
                    </label>
                    <input
                      type="text"
                      value={faltaReason}
                      onChange={(e) => setFaltaReason(e.target.value)}
                      placeholder="Ex: Não compareceu ao plantão e comunicou atraso..."
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer"
                    >
                      Confirmar Falta na Escala
                    </button>
                  </div>
                </form>
              )}

              {/* Sub-formulário de Anexar Atestado Médico */}
              {activeSubModal === 'ATESTADO' && (
                <form
                  onSubmit={handleConfirmAtestado}
                  className="mt-3 p-4 rounded-xl bg-white border border-amber-300 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-amber-900">
                      Anexar Atestado Médico (Marca todos os dias como AT)
                    </h4>
                    <button
                      type="button"
                      onClick={() => setActiveSubModal('NONE')}
                      className="text-xs text-slate-500 hover:text-slate-800"
                    >
                      Fechar
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Data de Início
                      </label>
                      <input
                        type="date"
                        required
                        value={atestadoStartDate}
                        onChange={(e) => setAtestadoStartDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Dias de Afastamento
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={60}
                        required
                        value={atestadoDays}
                        onChange={(e) => setAtestadoDays(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900 tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        CID / Código (opcional)
                      </label>
                      <input
                        type="text"
                        value={atestadoCid}
                        onChange={(e) => setAtestadoCid(e.target.value)}
                        placeholder="Ex: J06.9 ou M54.5"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                      />
                    </div>
                  </div>

                  {/* Resumo Automático: Que dia acaba e Qual é o Próximo Plantão */}
                  {employee && (() => {
                    const liveCalc = calculateLeaveAndNextShift(
                      employee,
                      state.schedules,
                      atestadoStartDate,
                      atestadoDays
                    );
                    return (
                      <div className="p-3.5 rounded-xl bg-teal-50/90 border border-teal-300 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div>
                          <span className="text-[11px] font-bold text-amber-800 block">
                            Que dia o atestado acaba (Último dia):
                          </span>
                          <span className="font-bold text-slate-900">
                            {liveCalc.endDateFormatted} ({liveCalc.daysCount}{' '}
                            {liveCalc.daysCount === 1 ? 'dia' : 'dias'})
                          </span>
                        </div>
                        <div>
                          <span className="text-[11px] font-bold text-teal-800 block">
                            Próximo Plantão de Retorno (pela Escala):
                          </span>
                          <span className="font-bold text-teal-950">
                            {liveCalc.nextShiftDateFormatted} · {liveCalc.nextShiftLabel}
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Motivo / Observação Clínica
                    </label>
                    <input
                      type="text"
                      value={atestadoReason}
                      onChange={(e) => setAtestadoReason(e.target.value)}
                      placeholder="Ex: Atestado entregue via WhatsApp e validado pelo RH"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                    />
                  </div>

                  {/* Upload para tirar foto pelo celular ou anexar PDF/Word/Excel/Imagem */}
                  <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="text-xs text-amber-900">
                      <p className="font-bold">Anexo do Atestado (Foto, PDF, Word ou Excel)</p>
                      <p className="text-[11px] text-amber-800">
                        {attachmentName
                          ? `Anexo carregado: ${attachmentName}`
                          : 'Tire uma foto pelo celular ou anexe arquivo PDF, Word, Excel ou Imagem'}
                      </p>
                    </div>
                    <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-amber-300 hover:bg-amber-100 text-amber-900 text-xs font-bold cursor-pointer shrink-0">
                      <Paperclip className="w-3.5 h-3.5" />
                      <span>Anexar Arquivo / Foto</span>
                      <input
                        type="file"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        onChange={handleCertificateFileUpload}
                        className="hidden"
                      />
                    </label>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold cursor-pointer"
                    >
                      Salvar Atestado e Marcar {atestadoDays} Dias na Escala
                    </button>
                  </div>
                </form>
              )}

              {/* Sub-formulário de Programar Férias */}
              {activeSubModal === 'FERIAS' && (
                <form
                  onSubmit={handleConfirmFerias}
                  className="mt-3 p-4 rounded-xl bg-white border border-cyan-300 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-cyan-900">
                      Programar Período de Férias (Marca FE na Escala)
                    </h4>
                    <button
                      type="button"
                      onClick={() => setActiveSubModal('NONE')}
                      className="text-xs text-slate-500 hover:text-slate-800"
                    >
                      Fechar
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Data de Início
                      </label>
                      <input
                        type="date"
                        required
                        value={feriasStartDate}
                        onChange={(e) => setFeriasStartDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Data de Término
                      </label>
                      <input
                        type="date"
                        required
                        value={feriasEndDate}
                        onChange={(e) => setFeriasEndDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Observação
                    </label>
                    <input
                      type="text"
                      value={feriasReason}
                      onChange={(e) => setFeriasReason(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-bold cursor-pointer"
                    >
                      Programar Férias na Escala
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Formulário Principal de Dados Cadastrais e Banco de Horas */}
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-200">
              <div className="flex items-center gap-3.5">
                <div className="w-14 h-14 rounded-full bg-teal-700 text-white font-bold flex items-center justify-center overflow-hidden shrink-0">
                  {avatarBase64 ? (
                    <img
                      src={avatarBase64}
                      alt={name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Camera className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-xs font-semibold text-slate-800 cursor-pointer">
                    <Camera className="w-3.5 h-3.5 text-teal-600" />
                    <span>Foto do Colaborador</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarUpload}
                      className="hidden"
                    />
                  </label>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Opcional · Exibido nos cards de plantão
                  </p>
                </div>
              </div>

              {/* Controle de Saldo do Banco de Horas (+/-) */}
              <div className="bg-white px-4 py-2.5 rounded-xl border border-slate-200 flex items-center justify-between sm:justify-end gap-4">
                <div>
                  <span className="block text-[11px] font-bold text-slate-500">
                    Saldo Banco de Horas
                  </span>
                  <span
                    className={`text-base font-bold tabular-nums ${
                      hourBankBalance > 0
                        ? 'text-emerald-700'
                        : hourBankBalance < 0
                        ? 'text-red-600'
                        : 'text-slate-800'
                    }`}
                  >
                    {hourBankBalance > 0 ? `+${hourBankBalance}h` : `${hourBankBalance}h`}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setHourBankBalance((b) => b - 1)}
                    className="w-8 h-8 rounded-lg border border-slate-300 hover:bg-slate-100 flex items-center justify-center text-slate-700 cursor-pointer"
                    title="Subtrair 1 hora"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setHourBankBalance((b) => b + 1)}
                    className="w-8 h-8 rounded-lg border border-slate-300 hover:bg-slate-100 flex items-center justify-center text-slate-700 cursor-pointer"
                    title="Somar 1 hora"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nome Completo do Colaborador *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Digite o nome completo do colaborador"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Matrícula / Registro Profissional (opcional)
                </label>
                <input
                  type="text"
                  value={registrationNumber}
                  onChange={(e) => setRegistrationNumber(e.target.value)}
                  placeholder="Digite o registro ou matrícula"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Função / Cargo *
                  </label>
                  <select
                    required
                    value={role}
                    onChange={(e) => handleRoleChange(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                  >
                    <option value="" disabled>
                      Escolha a função...
                    </option>
                    {allRoles.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                    <option value="NOVA_FUNCAO">+ Digitar outra função...</option>
                  </select>
                </div>

                {role === 'NOVA_FUNCAO' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Nome da Nova Função *
                    </label>
                    <input
                      type="text"
                      required
                      value={customRoleInput}
                      onChange={(e) => setCustomRoleInput(e.target.value)}
                      placeholder="Digite o nome da função"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Setor / Unidade de Lotação *
                  </label>
                  <select
                    required
                    value={unitId}
                    onChange={(e) => setUnitId(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                  >
                    {state.units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                    {!hasAlmoxarifadoUnit && (
                      <option value="__CREATE_ALMOXARIFADO__">
                        + Adicionar setor: Almoxarifado
                      </option>
                    )}
                    {!hasRecebimentoUnit && (
                      <option value="__CREATE_RECEBIMENTO__">
                        + Adicionar setor: Recebimento
                      </option>
                    )}
                    <option value="__CREATE_CUSTOM_UNIT__">
                      + Cadastrar novo setor / unidade...
                    </option>
                  </select>
                </div>

                {(unitId === '__CREATE_ALMOXARIFADO__' ||
                  unitId === '__CREATE_RECEBIMENTO__' ||
                  unitId === '__CREATE_CUSTOM_UNIT__') && (
                  <div className="p-3 rounded-xl bg-teal-50/70 border border-teal-200 space-y-2.5">
                    {unitId === '__CREATE_CUSTOM_UNIT__' ? (
                      <div>
                        <label className="block text-xs font-bold text-teal-900 mb-1">
                          Nome do Novo Setor / Unidade *
                        </label>
                        <input
                          type="text"
                          required
                          value={newUnitNameInput}
                          onChange={(e) => setNewUnitNameInput(e.target.value)}
                          placeholder="Ex: Recebimento, Almoxarifado..."
                          className="w-full px-3 py-2 rounded-xl border border-teal-300 bg-white text-base text-slate-900"
                        />
                      </div>
                    ) : (
                      <p className="text-xs font-bold text-teal-900">
                        O setor{' '}
                        <span className="underline">
                          {unitId === '__CREATE_ALMOXARIFADO__'
                            ? 'Almoxarifado'
                            : 'Recebimento'}
                        </span>{' '}
                        será criado automaticamente e exibido na tela de Início!
                      </p>
                    )}

                    <div>
                      <label className="block text-[11px] font-bold text-teal-800 mb-1">
                        Funcionamento do Setor
                      </label>
                      <select
                        value={newUnitShiftMode}
                        onChange={(e) =>
                          setNewUnitShiftMode(e.target.value as UnitShiftMode)
                        }
                        className="w-full px-3 py-2 rounded-xl border border-teal-300 bg-white text-base text-slate-900"
                      >
                        <option value="24H">24h (Diurno + Noturno)</option>
                        <option value="DIURNO">Apenas Diurno</option>
                        <option value="NOTURNO">Apenas Noturno</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Turno Padrão
                </label>
                <select
                  value={defaultShift}
                  onChange={(e) => {
                    const sh = e.target.value as 'Diurno' | 'Noturno';
                    setDefaultShift(sh);
                    if (sh === 'Noturno' && workHours === '07:00 às 19:00') {
                      setWorkHours('19:00 às 07:00');
                    } else if (sh === 'Diurno' && workHours === '19:00 às 07:00') {
                      setWorkHours('07:00 às 19:00');
                    }
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                >
                  <option value="Diurno">Diurno</option>
                  <option value="Noturno">Noturno</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Horário Padrão
                </label>
                <input
                  type="text"
                  list="work-hours-list"
                  value={workHours}
                  onChange={(e) => setWorkHours(e.target.value)}
                  placeholder="Ex: 07:00 às 19:00"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                />
                <datalist id="work-hours-list">
                  {WORK_HOURS_PRESETS.map((wh) => (
                    <option key={wh} value={wh} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Regime de Escala
                </label>
                <select
                  value={regime}
                  onChange={(e) => setRegime(e.target.value as ScheduleRegime)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                >
                  {Object.entries(REGIME_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200">
              {!isNew && onDeleteEmployee ? (
                <button
                  type="button"
                  onClick={() => {
                    onDeleteEmployee(employee.id);
                    onClose();
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-red-600 hover:bg-red-50 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Desativar Colaborador</span>
                </button>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 cursor-pointer"
                >
                  Fechar
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0d9488] hover:bg-teal-700 text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  <span>{isNew ? 'Cadastrar na Equipe' : 'Salvar Alterações'}</span>
                </button>
              </div>
            </div>
          </form>

          {/* Histórico Cronológico Completo do Colaborador */}
          {!isNew && (
            <div className="pt-4 border-t border-slate-200 space-y-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-teal-600" />
                <span>
                  Histórico de Folgas, Faltas, Atestados, Férias, Trocas e Horas Extras (
                  {employee.history.length})
                </span>
              </h3>

              {employee.history.length === 0 ? (
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-500 text-center">
                  Nenhuma ocorrência de folga, falta, atestado ou permuta registrada para este
                  profissional.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {employee.history.map((rec) => {
                    const badgeStyle =
                      rec.type === 'FOLGA'
                        ? 'bg-emerald-600 text-white'
                        : rec.type === 'FALTA'
                        ? 'bg-red-600 text-white'
                        : rec.type === 'ATESTADO'
                        ? 'bg-amber-500 text-white'
                        : rec.type === 'FERIAS'
                        ? 'bg-cyan-600 text-white'
                        : rec.type === 'TROCA'
                        ? 'bg-violet-600 text-white'
                        : 'bg-teal-600 text-white';

                    return (
                      <div
                        key={rec.id}
                        className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${badgeStyle}`}
                            >
                              {rec.type}
                            </span>
                            <span className="text-xs font-bold text-slate-900 tabular-nums">
                              Início: {formatDateWithWeekdayPtBr(rec.startDate)} ({rec.daysCount}{' '}
                              {rec.daysCount === 1 ? 'dia' : 'dias'})
                            </span>
                            {rec.cid && (
                              <span className="text-xs font-mono-num text-amber-800">
                                · CID: {rec.cid}
                              </span>
                            )}
                          </div>
                          {(rec.type === 'ATESTADO' || rec.type === 'FERIAS') && employee && (() => {
                            const recCalc = calculateLeaveAndNextShift(
                              employee,
                              state.schedules,
                              rec.startDate,
                              rec.daysCount
                            );
                            return (
                              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-teal-800 bg-teal-50/70 px-2.5 py-1 rounded-lg border border-teal-200">
                                <span>Acaba em: <strong>{recCalc.endDateFormatted}</strong></span>
                                <span aria-hidden="true">·</span>
                                <span>Próximo Plantão: <strong>{recCalc.nextShiftDateFormatted}</strong></span>
                              </div>
                            );
                          })()}
                          <p className="text-xs text-slate-700">{rec.reason}</p>
                        </div>

                        {rec.attachmentBase64 && (
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setPreviewRecord(rec);
                                setActiveSubModal('PREVIEW_ANEXO');
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-xs font-bold text-slate-800 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5 text-teal-600" />
                              <span>Ver Atestado</span>
                            </button>

                            <a
                              href={rec.attachmentBase64}
                              download={rec.attachmentName || `atestado_${rec.startDate}.png`}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Visualizador de Anexo de Atestado Médico */}
          {activeSubModal === 'PREVIEW_ANEXO' && previewRecord?.attachmentBase64 && (
            <div className="p-4 rounded-2xl bg-slate-900 text-white space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-teal-400" />
                  <span className="text-xs font-bold">
                    Anexo: {previewRecord.attachmentName || 'Documento Digitalizado'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveSubModal('NONE')}
                  className="text-xs text-slate-300 hover:text-white cursor-pointer"
                >
                  Fechar Visualização
                </button>
              </div>
              <div className="bg-white rounded-xl p-2 max-h-[320px] overflow-auto flex justify-center">
                {previewRecord.attachmentMimeType === 'application/pdf' ? (
                  <iframe
                    src={previewRecord.attachmentBase64}
                    title="Visualização de Atestado PDF"
                    className="w-full h-64 border-0"
                  />
                ) : (
                  <img
                    src={previewRecord.attachmentBase64}
                    alt="Atestado Médico Anexado"
                    referrerPolicy="no-referrer"
                    className="max-h-[290px] w-auto object-contain rounded"
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
