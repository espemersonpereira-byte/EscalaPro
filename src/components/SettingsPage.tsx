import React, { useState } from 'react';
import {
  EscalaProState,
  HospitalUnit,
  ManagerProfile,
  PRE_REGISTERED_MANAGER_ROLES,
  PRE_REGISTERED_SECTORS,
  PushNotificationConfig,
  UnitShiftMode,
  UserAccount,
} from '../types';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Logo } from './Logo';
import {
  Bell,
  Building2,
  CalendarCheck,
  Camera,
  CheckCircle2,
  Cloud,
  Download,
  FileSpreadsheet,
  Info,
  LogOut,
  Plus,
  Save,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';

interface SettingsPageProps {
  state: EscalaProState;
  currentUser?: UserAccount | null;
  onLogout?: () => void;
  onUpdateManagerAndUnits: (manager: ManagerProfile, units: HospitalUnit[]) => void;
  onUpdatePushConfig: (pushConfig: PushNotificationConfig) => void;
  onLoadDemoData: () => void;
  onOpenNewEmployeeForUnit?: (unitId: string) => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  state,
  currentUser,
  onLogout,
  onUpdateManagerAndUnits,
  onUpdatePushConfig,
  onOpenNewEmployeeForUnit,
}) => {
  const {
    isInstallable,
    isInstalled,
    isIOS,
    swActive,
    notificationPermission,
    installApp,
    requestPushPermission,
    triggerTestNotification,
  } = usePWAInstall();

  const [activeSettingsTab, setActiveSettingsTab] = useState<'PERFIL' | 'NOTIFICACOES' | 'SOBRE'>(
    'PERFIL'
  );

  const [name, setName] = useState(state.manager.name);
  const [hospitalName, setHospitalName] = useState(state.manager.hospitalName);
  const [role, setRole] = useState(state.manager.role);
  const [sectorName, setSectorName] = useState(state.manager.sectorName);
  const [avatarBase64, setAvatarBase64] = useState(state.manager.avatarBase64);
  const [units, setUnits] = useState<HospitalUnit[]>(state.units);

  const [pushConfig, setPushConfig] = useState<PushNotificationConfig>(state.pushConfig);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [pushFeedback, setPushFeedback] = useState<string | null>(null);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
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

  const syncValidUnitsToApp = (candidateUnits: HospitalUnit[]) => {
    const validUnits = candidateUnits
      .map((u) => ({ ...u, name: u.name.trim() }))
      .filter((u) => u.name.length > 0);
    if (validUnits.length === 0) return;
    onUpdateManagerAndUnits(
      {
        name: name.trim() || state.manager.name,
        hospitalName: hospitalName.trim() || state.manager.hospitalName,
        role: role.trim() || state.manager.role,
        sectorName: sectorName.trim() || state.manager.sectorName,
        avatarBase64,
        onboardingCompleted: true,
      },
      validUnits
    );
  };

  const handleAddUnit = () => {
    const newUnit: HospitalUnit = {
      id: `unit-${Date.now()}`,
      name: '',
      shiftMode: '24H',
      minStaffDay: 2,
      minStaffNight: 1,
    };
    setUnits((prev) => [...prev, newUnit]);
  };

  const handleQuickAddPresetUnit = (presetName: string, mode: UnitShiftMode = 'DIURNO') => {
    const exists = units.some(
      (u) => u.name.trim().toLowerCase() === presetName.trim().toLowerCase()
    );
    if (exists) return;
    const newUnit: HospitalUnit = {
      id: `unit-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      name: presetName,
      shiftMode: mode,
      minStaffDay: 1,
      minStaffNight: mode === '24H' ? 1 : 0,
    };
    const nextUnits = [...units, newUnit];
    setUnits(nextUnits);
    syncValidUnitsToApp(nextUnits);
    setSaveFeedback(
      `Setor "${presetName}" adicionado! Ele já aparece na tela de Início e no cadastro de colaboradores.`
    );
    setTimeout(() => setSaveFeedback(null), 4000);
  };

  const handleRemoveUnit = (unitId: string) => {
    if (units.length <= 1) return;
    const nextUnits = units.filter((u) => u.id !== unitId);
    setUnits(nextUnits);
    syncValidUnitsToApp(nextUnits);
  };

  const handleUnitChange = <K extends keyof HospitalUnit>(
    unitId: string,
    field: K,
    value: HospitalUnit[K]
  ) => {
    const nextUnits = units.map((u) => {
      if (u.id !== unitId) return u;
      const updated = { ...u, [field]: value };
      if (field === 'shiftMode') {
        if (value === 'DIURNO') updated.minStaffNight = 0;
        if (value === 'NOTURNO') updated.minStaffDay = 0;
      }
      return updated;
    });
    setUnits(nextUnits);
    syncValidUnitsToApp(nextUnits);
  };

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    const validUnits = units
      .map((u) => ({ ...u, name: u.name.trim() }))
      .filter((u) => u.name.length > 0);
    const finalUnits = validUnits.length > 0 ? validUnits : state.units;
    setUnits(finalUnits);
    onUpdateManagerAndUnits(
      {
        name: name.trim(),
        hospitalName: hospitalName.trim(),
        role: role.trim(),
        sectorName: sectorName.trim(),
        avatarBase64,
        onboardingCompleted: true,
      },
      finalUnits
    );
    onUpdatePushConfig(pushConfig);
    setSaveFeedback(
      'Configurações e setores atualizados e salvos na sua conta!'
    );
    setTimeout(() => setSaveFeedback(null), 4000);
  };

  const handleActivatePush = async () => {
    const result = await requestPushPermission();
    if (result === 'granted') {
      const next = { ...pushConfig, enabled: true };
      setPushConfig(next);
      onUpdatePushConfig(next);
      setPushFeedback(
        'Permissão concedida! Notificações na tela bloqueada ativadas neste dispositivo.'
      );
    } else {
      setPushFeedback(
        'A permissão de notificação foi bloqueada ou negada pelo navegador. Verifique as permissões do site.'
      );
    }
    setTimeout(() => setPushFeedback(null), 5000);
  };

  const handleTestLockScreenNotification = async (delayMs: number) => {
    const res = await triggerTestNotification(
      `EscalaPro · ${hospitalName || 'Alerta de Plantão'}`,
      `Atenção ${name || 'Gestor'}: Verificação de cobertura de turno do setor ${sectorName} concluída. Toque para abrir a escala.`,
      delayMs
    );
    setPushFeedback(res.message);
    setTimeout(() => setPushFeedback(null), 6500);
  };

  const permissionLabel =
    notificationPermission === 'granted'
      ? 'Concedida'
      : notificationPermission === 'denied'
      ? 'Bloqueada'
      : 'Pendente';

  return (
    <div className="space-y-6">
      {saveFeedback && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{saveFeedback}</span>
        </div>
      )}

      {/* CONTA DO USUÁRIO LOGADO & TROCAR DE CONTA */}
      {currentUser && (
        <section className="bg-[#0f172a] text-white rounded-2xl border border-slate-800 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-[#0d9488] text-white flex items-center justify-center font-bold text-sm shrink-0">
              {(currentUser.name || 'U').slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h2 className="text-sm md:text-base font-bold text-white">{currentUser.name}</h2>
              <p className="text-xs text-slate-400">{currentUser.email}</p>
            </div>
          </div>

          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-red-950/80 text-slate-200 hover:text-red-200 border border-slate-700 hover:border-red-800 text-xs font-bold transition-colors cursor-pointer shrink-0"
            >
              <LogOut className="w-4 h-4" />
              <span>Trocar de Conta / Sair</span>
            </button>
          )}
        </section>
      )}

      {/* NAVEGAÇÃO INTERNA DAS CONFIGURAÇÕES (3 ABAS, INCLUINDO SOBRE O APP) */}
      <div className="grid grid-cols-3 gap-2 bg-white p-1.5 rounded-2xl border border-slate-200">
        <button
          type="button"
          onClick={() => setActiveSettingsTab('PERFIL')}
          className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
            activeSettingsTab === 'PERFIL'
              ? 'bg-[#0f172a] text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <UserCheck className="w-4 h-4 shrink-0" />
          <span className="truncate">Perfil & Unidades</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSettingsTab('NOTIFICACOES')}
          className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
            activeSettingsTab === 'NOTIFICACOES'
              ? 'bg-[#0f172a] text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Bell className="w-4 h-4 shrink-0" />
          <span className="truncate">Notificações & App</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSettingsTab('SOBRE')}
          className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
            activeSettingsTab === 'SOBRE'
              ? 'bg-[#0d9488] text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Info className="w-4 h-4 shrink-0" />
          <span className="truncate">Sobre o App</span>
        </button>
      </div>

      {/* ABA 1: PERFIL DO GESTOR E UNIDADES */}
      {activeSettingsTab === 'PERFIL' && (
        <form onSubmit={handleSaveSettings} className="space-y-6">
          <section className="bg-white rounded-2xl border border-slate-200 p-5 md:p-6 space-y-5">
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
              <UserCheck className="w-5 h-5 text-teal-600" />
              <h2 className="text-lg font-bold text-slate-900">
                Perfil do Gestor e Dados da Instituição
              </h2>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-200">
              <div className="w-16 h-16 rounded-full bg-slate-900 text-white flex items-center justify-center overflow-hidden border-2 border-teal-600 shrink-0">
                {avatarBase64 ? (
                  <img
                    src={avatarBase64}
                    alt={name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Camera className="w-6 h-6 text-slate-400" />
                )}
              </div>
              <div>
                <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-xs font-bold text-slate-800 cursor-pointer">
                  <Camera className="w-4 h-4 text-teal-600" />
                  <span>Alterar Foto de Perfil</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Seu Nome
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Digite seu nome"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Hospital / Instituição
                </label>
                <input
                  type="text"
                  required
                  value={hospitalName}
                  onChange={(e) => setHospitalName(e.target.value)}
                  placeholder="Nome da instituição"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Seu Cargo
                </label>
                <input
                  type="text"
                  list="manager-roles-preset"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="Escolha ou digite seu cargo"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                />
                <datalist id="manager-roles-preset">
                  {PRE_REGISTERED_MANAGER_ROLES.map((r) => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Setor Principal
                </label>
                <input
                  type="text"
                  list="sectors-preset"
                  value={sectorName}
                  onChange={(e) => setSectorName(e.target.value)}
                  placeholder="Escolha ou digite seu setor"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                />
                <datalist id="sectors-preset">
                  {PRE_REGISTERED_SECTORS.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
            </div>
          </section>

          {/* GESTÃO DE UNIDADES E LOTAÇÃO MÍNIMA */}
          <section className="bg-white rounded-2xl border border-slate-200 p-5 md:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2.5">
                <Building2 className="w-5 h-5 text-teal-600" />
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    Unidades / Sub-setores Supervisionados ({units.length})
                  </h2>
                  <p className="text-xs text-slate-500">
                    Todos os setores abaixo aparecem na tela de Início com seus respectivos funcionários
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {!units.some((u) => u.name.trim().toLowerCase() === 'recebimento') && (
                  <button
                    type="button"
                    onClick={() => handleQuickAddPresetUnit('Recebimento', 'DIURNO')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 text-xs font-bold cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ Recebimento</span>
                  </button>
                )}
                {!units.some((u) => u.name.trim().toLowerCase() === 'almoxarifado') && (
                  <button
                    type="button"
                    onClick={() => handleQuickAddPresetUnit('Almoxarifado', 'DIURNO')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 text-xs font-bold cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ Almoxarifado</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleAddUnit}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Adicionar Setor / Unidade</span>
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {units.map((u, idx) => {
                const countInUnit = state.employees.filter(
                  (e) => e.active && e.unitId === u.id
                ).length;
                return (
                  <div
                    key={u.id}
                    className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                      <div className="md:col-span-5">
                        <label className="block text-xs font-semibold text-slate-600 mb-1">
                          Nome do Setor / Unidade #{idx + 1}
                        </label>
                        <input
                          type="text"
                          required
                          value={u.name}
                          onChange={(e) => handleUnitChange(u.id, 'name', e.target.value)}
                          placeholder="Ex: Recebimento, Almoxarifado, Farmácia..."
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                        />
                      </div>

                      <div className="md:col-span-3">
                        <label className="block text-xs font-semibold text-slate-600 mb-1">
                          Turnos Ativos
                        </label>
                        <select
                          value={u.shiftMode}
                          onChange={(e) =>
                            handleUnitChange(u.id, 'shiftMode', e.target.value as UnitShiftMode)
                          }
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                        >
                          <option value="24H">24h (Diurno + Noturno)</option>
                          <option value="DIURNO">Apenas Diurno</option>
                          <option value="NOTURNO">Apenas Noturno</option>
                        </select>
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-xs font-semibold text-slate-600 mb-1">
                          Mín. Diurno
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={50}
                          disabled={u.shiftMode === 'NOTURNO'}
                          value={u.minStaffDay}
                          onChange={(e) =>
                            handleUnitChange(u.id, 'minStaffDay', Number(e.target.value))
                          }
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900 tabular-nums disabled:bg-slate-100"
                        />
                      </div>

                      <div className="md:col-span-1">
                        <label className="block text-xs font-semibold text-slate-600 mb-1">
                          Mín. Not.
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={50}
                          disabled={u.shiftMode === 'DIURNO'}
                          value={u.minStaffNight}
                          onChange={(e) =>
                            handleUnitChange(u.id, 'minStaffNight', Number(e.target.value))
                          }
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900 tabular-nums disabled:bg-slate-100"
                        />
                      </div>

                      <div className="md:col-span-1 flex justify-end">
                        <button
                          type="button"
                          disabled={units.length <= 1}
                          onClick={() => handleRemoveUnit(u.id)}
                          className="p-2.5 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-30 cursor-pointer"
                          title="Remover unidade"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {u.name.trim().length > 0 && (
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/80 text-xs">
                        <span className="text-slate-600 font-medium">
                          Funcionários cadastrados em <strong>{u.name}</strong>:{' '}
                          <strong className="text-slate-900">{countInUnit}</strong>
                        </span>
                        {onOpenNewEmployeeForUnit && (
                          <button
                            type="button"
                            onClick={() => onOpenNewEmployeeForUnit(u.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-teal-50 text-teal-700 border border-teal-200 font-bold cursor-pointer"
                          >
                            <UserPlus className="w-3.5 h-3.5" />
                            <span>+ Cadastrar Funcionário em {u.name}</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-100">
              <button
                type="submit"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#0d9488] hover:bg-teal-700 text-white text-sm font-bold transition-colors cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>Salvar Configurações</span>
              </button>
            </div>
          </section>
        </form>
      )}

      {/* ABA 2: NOTIFICAÇÕES PUSH & INSTALAÇÃO PWA */}
      {activeSettingsTab === 'NOTIFICACOES' && (
        <section className="bg-white rounded-2xl border border-slate-200 p-5 md:p-6 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-slate-900 text-teal-400 flex items-center justify-center shrink-0">
                <Bell className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Central de Notificações Push e Aplicativo Nativo
                </h2>
                <p className="text-xs text-slate-500">
                  Alertas em tempo real via Service Worker mesmo com a tela do celular bloqueada
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs">
              <div className="px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200 font-semibold text-slate-700">
                Permissão:{' '}
                <span
                  className={`font-bold ${
                    notificationPermission === 'granted'
                      ? 'text-emerald-700'
                      : notificationPermission === 'denied'
                      ? 'text-red-600'
                      : 'text-amber-700'
                  }`}
                >
                  {permissionLabel}
                </span>
              </div>

              <div className="px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200 font-semibold text-slate-700">
                Service Worker:{' '}
                <span className="font-bold text-teal-700">
                  {swActive ? 'Ativo' : 'Registrando...'}
                </span>
              </div>
            </div>
          </div>

          {pushFeedback && (
            <div className="p-3.5 rounded-xl bg-teal-50 border border-teal-200 text-teal-950 text-xs font-bold">
              {pushFeedback}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <button
              type="button"
              onClick={handleActivatePush}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#0d9488] hover:bg-teal-700 text-white text-xs font-bold transition-colors cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Ativar Notificações neste Aparelho</span>
            </button>

            <button
              type="button"
              onClick={() => handleTestLockScreenNotification(0)}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors cursor-pointer"
            >
              <Bell className="w-4 h-4 text-teal-400" />
              <span>Testar Notificação Imediata</span>
            </button>

            <button
              type="button"
              onClick={() => handleTestLockScreenNotification(5000)}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold transition-colors cursor-pointer"
            >
              <Smartphone className="w-4 h-4 text-teal-600" />
              <span>Testar na Tela Bloqueada (5s)</span>
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 pt-2">
            <div className="space-y-2.5 bg-slate-50 p-4 rounded-2xl border border-slate-200">
              <h3 className="text-xs font-bold text-slate-800">
                Regras Automáticas de Alerta
              </h3>

              <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer py-1">
                <input
                  type="checkbox"
                  checked={pushConfig.alertUncoveredShift1hBefore}
                  onChange={(e) =>
                    setPushConfig((p) => ({
                      ...p,
                      alertUncoveredShift1hBefore: e.target.checked,
                    }))
                  }
                  className="w-4 h-4 accent-teal-600 rounded"
                />
                <span>
                  Avisar 1h antes da troca de turno se houver posto descoberto na unidade
                </span>
              </label>

              <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer py-1">
                <input
                  type="checkbox"
                  checked={pushConfig.dailySummaryAt0630}
                  onChange={(e) =>
                    setPushConfig((p) => ({
                      ...p,
                      dailySummaryAt0630: e.target.checked,
                    }))
                  }
                  className="w-4 h-4 accent-teal-600 rounded"
                />
                <span>Enviar resumo diário do plantão às 06:30</span>
              </label>

              <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer py-1">
                <input
                  type="checkbox"
                  checked={pushConfig.instantCertificateAlert}
                  onChange={(e) =>
                    setPushConfig((p) => ({
                      ...p,
                      instantCertificateAlert: e.target.checked,
                    }))
                  }
                  className="w-4 h-4 accent-teal-600 rounded"
                />
                <span>Notificar imediatamente ao lançar atestado médico ou falta</span>
              </label>
            </div>

            <div className="space-y-2 bg-slate-50 p-4 rounded-2xl border border-slate-200">
              <label className="block text-xs font-bold text-slate-800">
                URL de Webhook / Chave VAPID Pública (Opcional)
              </label>
              <input
                type="text"
                value={pushConfig.webhookOrVapidKey}
                onChange={(e) =>
                  setPushConfig((p) => ({ ...p, webhookOrVapidKey: e.target.value }))
                }
                placeholder="Cole sua chave VAPID ou endpoint Webhook"
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
              />
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <Smartphone className="w-5 h-5 text-teal-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-xs font-bold text-white">
                  Instalação como Aplicativo no Dispositivo
                </h4>
                {isInstalled ? (
                  <p className="text-xs text-emerald-400 mt-0.5">
                    O EscalaPro já está instalado e rodando em modo aplicativo!
                  </p>
                ) : isIOS ? (
                  <p className="text-xs text-slate-300 mt-0.5">
                    No iPhone / iOS: Toque em Compartilhar no Safari e escolha "Adicionar à Tela de Início".
                  </p>
                ) : (
                  <p className="text-xs text-slate-300 mt-0.5">
                    Instale na tela inicial para acesso rápido e funcionamento mesmo sem sinal de internet.
                  </p>
                )}
              </div>
            </div>

            {!isInstalled && isInstallable && (
              <button
                type="button"
                onClick={installApp}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0d9488] hover:bg-teal-700 text-white text-xs font-bold cursor-pointer shrink-0"
              >
                <Download className="w-4 h-4" />
                <span>Instalar Aplicativo</span>
              </button>
            )}
          </div>
        </section>
      )}

      {/* ABA 3: TELA EXCLUSIVA "SOBRE O APP" */}
      {activeSettingsTab === 'SOBRE' && (
        <section className="bg-white rounded-2xl border border-slate-200 p-6 md:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-6">
            <div className="flex items-center gap-4">
              <Logo size={54} />
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-slate-900">
                    Escala<span className="text-[#0d9488]">Pro</span> Hospitalar
                  </h2>
                  <span className="px-2.5 py-0.5 rounded-md bg-teal-50 text-teal-800 border border-teal-200 text-xs font-bold">
                    v2.0 Cloud & PWA
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Plataforma Inteligente de Dimensionamento, Escalas Mensais e Controle de Ausências Hospitalares
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="w-10 h-10 rounded-xl bg-teal-600 text-white flex items-center justify-center">
                <Cloud className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">
                Sincronização Automática & Modo Offline
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Sua conta salva automaticamente todas as suas unidades, colaboradores, escalas e
                atestados. Ao abrir o aplicativo novamente, você entra direto no seu painel sem
                precisar reconfigurar, funcionando inclusive em locais do hospital sem sinal de
                internet.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="w-10 h-10 rounded-xl bg-slate-900 text-teal-400 flex items-center justify-center">
                <Users className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">
                Múltiplos Usuários Independentes
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Cada gestor ou coordenador pode criar seu próprio cadastro. Os dados, setores e
                escalas de cada usuário ficam 100% isolados em sua respectiva conta.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center">
                <CalendarCheck className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">
                Cálculo Automático de Atestados e Próximo Plantão
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Ao lançar manualmente um atestado médico, declaração de horas, falta ou férias, o
                sistema calcula automaticamente o dia em que o afastamento termina e qual será o
                próximo dia de plantão do colaborador mediante o regime de escala dele (12x36, 5x2
                ou 6x1).
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">
                Importação Universal de Arquivos
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Compatível com leitura inteligente de arquivos PDF, documentos Word (.docx/.doc),
                planilhas Excel (.xlsx/.xls/.csv), textos e imagens de escalas hospitalares, além
                de backup completo em JSON.
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
