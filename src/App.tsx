/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  AbsenceRecord,
  Employee,
  EscalaProState,
  HospitalUnit,
  ManagerProfile,
  NavigationContext,
  PageId,
  PushNotificationConfig,
  ScheduleCellData,
  UserAccount,
} from './types';
import {
  applyAbsenceToSchedules,
  createDemoEscalaProState,
  generateAutomaticScheduleForMonth,
  getYearMonthKey,
  parseIsoDateParts,
  storageService,
} from './services/storageService';
import {
  loadWorkspaceFromFirestore,
  signOutFirebase,
  subscribeToFirebaseAuth,
  syncWorkspaceToFirestore,
} from './services/firebaseService';
import { Logo } from './components/Logo';
import { SplashScreen } from './components/SplashScreen';
import { AuthScreen } from './components/AuthScreen';
import { OnboardingModal } from './components/OnboardingModal';
import { DashboardPage } from './components/DashboardPage';
import { SchedulePage } from './components/SchedulePage';
import { CollaboratorsPage } from './components/CollaboratorsPage';
import { ImportExportPage } from './components/ImportExportPage';
import { SettingsPage } from './components/SettingsPage';
import { EmployeeModal } from './components/EmployeeModal';
import { QuickLeaveWizardModal } from './components/QuickLeaveWizardModal';
import { usePWAInstall } from './hooks/usePWAInstall';
import {
  CalendarDays,
  Cloud,
  Download,
  FileUp,
  FileWarning,
  LayoutDashboard,
  LogOut,
  Settings,
  UserPlus,
  Users,
  WifiOff,
} from 'lucide-react';

const NAV_ITEMS: { id: PageId; label: string; shortLabel: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'inicio', label: 'Início · Plantão Hoje', shortLabel: 'Início', icon: LayoutDashboard },
  { id: 'escala', label: 'Escala Mensal', shortLabel: 'Escala', icon: CalendarDays },
  { id: 'colaboradores', label: 'Colaboradores', shortLabel: 'Equipe', icon: Users },
  { id: 'importar', label: 'Importar / Exportar', shortLabel: 'Arquivos', icon: FileUp },
  { id: 'configuracoes', label: 'Configurações & Push', shortLabel: 'Ajustes', icon: Settings },
];

export default function App() {
  const [showSplash, setShowSplash] = useState<boolean>(true);
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() =>
    storageService.getActiveSessionAccount()
  );
  const [state, setState] = useState<EscalaProState>(() => {
    const activeAcc = storageService.getActiveSessionAccount();
    return activeAcc
      ? storageService.loadStateForUser(activeAcc)
      : storageService.loadState();
  });
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [cloudSyncStatus, setCloudSyncStatus] = useState<'idle' | 'syncing' | 'synced'>('idle');
  const syncTimeoutRef = useRef<number | null>(null);

  const [navContext, setNavContext] = useState<NavigationContext>({
    activePage: 'inicio',
    collaboratorStatusFilter: 'TODOS',
    selectedUnitFilter: 'TODAS',
    selectedShiftFilter: 'TODOS',
    selectedRoleFilter: 'TODAS',
    onlyUncoveredDaysInSchedule: false,
    selectedEmployeeId: null,
    highlightAbsencesReport: false,
  });

  // Controle do modal de Prontuário Individual (null = fechado, 'NEW' = novo colaborador, ou employeeId)
  const [modalEmployeeTarget, setModalEmployeeTarget] = useState<string | 'NEW' | null>(
    null
  );

  // Controle do Assistente Guiado de Atestado / Horas / Falta / Férias
  const [quickWizardConfig, setQuickWizardConfig] = useState<{
    open: boolean;
    employeeId: string | null;
    initialType: 'ATESTADO' | 'DECLARACAO_HORAS' | 'FALTA' | 'FERIAS';
  }>({
    open: false,
    employeeId: null,
    initialType: 'ATESTADO',
  });

  const { isInstallable, isInstalled, installApp } = usePWAInstall();

  // Escuta autenticação Firebase (caso o usuário tenha logado com Google)
  useEffect(() => {
    const unsubscribe = subscribeToFirebaseAuth(async (fbUser) => {
      if (!fbUser) return;
      const activeAcc = storageService.getActiveSessionAccount();
      if (!activeAcc || activeAcc.uid === fbUser.uid) {
        const googleAcc: UserAccount = {
          uid: fbUser.uid,
          name: fbUser.displayName || activeAcc?.name || fbUser.email?.split('@')[0] || 'Gestor(a)',
          email: fbUser.email || activeAcc?.email || '',
          photoURL: fbUser.photoURL || undefined,
          authMode: 'firebase-google',
          hospitalName: activeAcc?.hospitalName || 'Hospital Central',
          sectorName: activeAcc?.sectorName || 'Farmácia',
          role: activeAcc?.role || 'Supervisor de Farmácia',
          createdAt: activeAcc?.createdAt || new Date().toISOString(),
        };
        storageService.saveRegisteredAccountMetadata(googleAcc);
        storageService.setActiveSessionAccount(googleAcc);
        setCurrentUser(googleAcc);

        try {
          setCloudSyncStatus('syncing');
          const remoteState = await loadWorkspaceFromFirestore(fbUser.uid);
          if (remoteState) {
            storageService.saveStateForUser(fbUser.uid, remoteState);
            setState(remoteState);
          } else {
            const localUserState = storageService.loadStateForUser(googleAcc);
            setState(localUserState);
            await syncWorkspaceToFirestore(fbUser.uid, localUserState);
          }
          setCloudSyncStatus('synced');
        } catch (err) {
          console.error('Aviso na sincronização inicial com Firestore:', err);
          setCloudSyncStatus('idle');
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Salva automaticamente no espaço isolado do usuário logado (e sincroniza com o Firestore se Google Auth)
  useEffect(() => {
    if (!currentUser) return;
    storageService.saveStateForUser(currentUser.uid, state);
    storageService.saveRegisteredAccountMetadata({
      ...currentUser,
      name: state.manager.name || currentUser.name,
      hospitalName: state.manager.hospitalName || currentUser.hospitalName,
      sectorName: state.manager.sectorName || currentUser.sectorName,
      role: state.manager.role || currentUser.role,
    });

    if (currentUser.authMode === 'firebase-google') {
      if (syncTimeoutRef.current) {
        window.clearTimeout(syncTimeoutRef.current);
      }
      setCloudSyncStatus('syncing');
      syncTimeoutRef.current = window.setTimeout(() => {
        syncWorkspaceToFirestore(currentUser.uid, state)
          .then(() => setCloudSyncStatus('synced'))
          .catch((err) => {
            console.error('Erro ao sincronizar estado com Firestore:', err);
            setCloudSyncStatus('idle');
          });
      }, 900);
    }
  }, [state, currentUser]);

  // Monitora status online/offline e cliques em notificações Push do Service Worker
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const params = new URLSearchParams(window.location.search);
    const pageParam = params.get('page') as PageId | null;
    if (
      pageParam &&
      ['inicio', 'escala', 'colaboradores', 'importar', 'configuracoes'].includes(pageParam)
    ) {
      setNavContext((prev) => ({ ...prev, activePage: pageParam }));
    }

    const handleSwMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'NOTIFICATION_CLICK') {
        setNavContext((prev) => ({ ...prev, activePage: 'escala' }));
      }
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSwMessage);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      }
    };
  }, []);

  const updateNav = (updates: Partial<NavigationContext>) => {
    setNavContext((prev) => ({ ...prev, ...updates }));
  };

  // Quando o usuário entra ou se cadastra na tela de acesso
  const handleUserAuthenticated = async (account: UserAccount, startWithDemo = false) => {
    setCurrentUser(account);
    if (startWithDemo) {
      const demo = createDemoEscalaProState();
      const customizedDemo: EscalaProState = {
        ...demo,
        manager: {
          ...demo.manager,
          name: account.name || demo.manager.name,
          hospitalName: account.hospitalName || demo.manager.hospitalName,
          sectorName: account.sectorName || demo.manager.sectorName,
          role: account.role || demo.manager.role,
          onboardingCompleted: true,
        },
      };
      storageService.saveStateForUser(account.uid, customizedDemo);
      setState(customizedDemo);
      return;
    }

    const userState = storageService.loadStateForUser(account);
    setState(userState);

    if (account.authMode === 'firebase-google') {
      try {
        setCloudSyncStatus('syncing');
        const remote = await loadWorkspaceFromFirestore(account.uid);
        if (remote) {
          storageService.saveStateForUser(account.uid, remote);
          setState(remote);
        } else {
          await syncWorkspaceToFirestore(account.uid, userState);
        }
        setCloudSyncStatus('synced');
      } catch (e) {
        console.error('Erro ao buscar dados da nuvem no login:', e);
        setCloudSyncStatus('idle');
      }
    }
  };

  // Encerra a sessão atual para permitir entrada ou cadastro de outro usuário
  const handleLogout = async () => {
    storageService.setActiveSessionAccount(null);
    setCurrentUser(null);
    await signOutFirebase();
  };

  // Conclusão do Onboarding
  const handleCompleteOnboarding = (manager: ManagerProfile, units: HospitalUnit[]) => {
    setState((prev) => ({
      ...prev,
      manager: {
        ...manager,
        onboardingCompleted: true,
      },
      units,
    }));
  };

  // Carrega dados hospitalares de demonstração
  const handleLoadDemoData = () => {
    const demo = createDemoEscalaProState();
    setState((prev) => ({
      ...demo,
      manager: {
        ...demo.manager,
        name: prev.manager.name || currentUser?.name || demo.manager.name,
        hospitalName: prev.manager.hospitalName || currentUser?.hospitalName || demo.manager.hospitalName,
        onboardingCompleted: true,
      },
    }));
    setNavContext((prev) => ({
      ...prev,
      activePage: 'inicio',
      selectedUnitFilter: 'TODAS',
    }));
  };

  // Geração automática de escala mensal
  const handleGenerateAutoSchedule = (year: number, monthIndex0: number) => {
    setState((prev) => {
      const updatedSchedules = generateAutomaticScheduleForMonth(
        prev.employees,
        prev.schedules,
        year,
        monthIndex0,
        true
      );
      return {
        ...prev,
        schedules: updatedSchedules,
      };
    });
  };

  // Edição rápida de célula da escala (incluindo permuta dupla e banco de horas)
  const handleUpdateScheduleCell = (
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
  ) => {
    setState((prev) => {
      const ymKey = getYearMonthKey(year, monthIndex0);
      const nextSchedules = { ...prev.schedules };
      const monthMap = { ...(nextSchedules[ymKey] || {}) };
      const empMap = { ...(monthMap[employeeId] || {}) };
      empMap[day] = cellData;
      monthMap[employeeId] = empMap;

      // Se for permuta, atualiza também o colega na mesma data e na data de devolução
      if (extraOptions?.swapPartnerId) {
        const partnerId = extraOptions.swapPartnerId;
        const primaryEmp = prev.employees.find((e) => e.id === employeeId);
        const partnerMap = { ...(monthMap[partnerId] || {}) };
        partnerMap[day] = {
          status: 'TR',
          swapWithEmployeeId: employeeId,
          swapWithEmployeeName: primaryEmp?.name,
          swapReturnDate: extraOptions.swapReturnDate,
          note: `Cobrindo plantão de ${primaryEmp?.name || 'colega'}`,
        };
        monthMap[partnerId] = partnerMap;

        if (extraOptions.swapReturnDate) {
          const ret = parseIsoDateParts(extraOptions.swapReturnDate);
          const retKey = getYearMonthKey(ret.year, ret.monthIndex0);
          const retMonthMap =
            retKey === ymKey ? monthMap : { ...(nextSchedules[retKey] || {}) };

          const empRetMap = { ...(retMonthMap[employeeId] || {}) };
          empRetMap[ret.day] = {
            status: 'TR',
            swapWithEmployeeId: partnerId,
            note: `Devolução de permuta do dia ${day}/${monthIndex0 + 1}`,
          };
          retMonthMap[employeeId] = empRetMap;
          nextSchedules[retKey] = retMonthMap;
        }
      }

      nextSchedules[ymKey] = monthMap;

      // Atualiza histórico e saldo de banco de horas do colaborador
      const nextEmployees = prev.employees.map((emp) => {
        if (emp.id !== employeeId) return emp;
        const newBalance = emp.hourBankBalance + (extraOptions?.extraHoursDelta || 0);
        const newHistory = extraOptions?.historyRecord
          ? [extraOptions.historyRecord, ...emp.history]
          : emp.history;
        return {
          ...emp,
          hourBankBalance: newBalance,
          history: newHistory,
        };
      });

      return {
        ...prev,
        employees: nextEmployees,
        schedules: nextSchedules,
      };
    });
  };

  // Salva novo colaborador ou atualiza colaborador existente
  const handleSaveEmployee = (emp: Employee, newCustomRole?: string) => {
    setState((prev) => {
      const exists = prev.employees.some((e) => e.id === emp.id);
      const nextEmployees = exists
        ? prev.employees.map((e) => (e.id === emp.id ? emp : e))
        : [...prev.employees, emp];

      const nextCustomRoles =
        newCustomRole && !prev.customRoles.includes(newCustomRole)
          ? [...prev.customRoles, newCustomRole]
          : prev.customRoles;

      const now = new Date();
      const nextSchedules = generateAutomaticScheduleForMonth(
        nextEmployees,
        prev.schedules,
        now.getFullYear(),
        now.getMonth(),
        true
      );

      return {
        ...prev,
        customRoles: nextCustomRoles,
        employees: nextEmployees,
        schedules: nextSchedules,
      };
    });
  };

  const handleDeleteEmployee = (employeeId: string) => {
    setState((prev) => ({
      ...prev,
      employees: prev.employees.map((e) =>
        e.id === employeeId ? { ...e, active: false } : e
      ),
    }));
  };

  // Registra Falta (FA), Atestado Médico (AT) ou Férias (FE) a partir do Prontuário
  const handleRegisterAbsenceOrLeave = (
    employeeId: string,
    record: AbsenceRecord,
    statusToApply: 'FA' | 'AT' | 'FE'
  ) => {
    setState((prev) => {
      const nextEmployees = prev.employees.map((emp) => {
        if (emp.id !== employeeId) return emp;
        return {
          ...emp,
          history: [record, ...emp.history],
        };
      });

      const nextSchedules = applyAbsenceToSchedules(
        prev.schedules,
        employeeId,
        record.startDate,
        record.daysCount,
        statusToApply,
        record.reason
      );

      return {
        ...prev,
        employees: nextEmployees,
        schedules: nextSchedules,
      };
    });
  };

  const handleOpenQuickLeaveWizard = (
    employeeId: string | null = null,
    initialType: 'ATESTADO' | 'DECLARACAO_HORAS' | 'FALTA' | 'FERIAS' = 'ATESTADO'
  ) => {
    setQuickWizardConfig({
      open: true,
      employeeId,
      initialType,
    });
  };

  // Aplica Atestado Médico, Declaração de Horas, Falta ou Férias via Assistente Manual
  const handleApplyLeaveOrOccurrence = (params: {
    employeeId: string;
    record: AbsenceRecord;
    scheduleStatusToApply?: 'AT' | 'FA' | 'FE';
    hourBankDelta?: number;
  }) => {
    setState((prev) => {
      const nextEmployees = prev.employees.map((emp) => {
        if (emp.id !== params.employeeId) return emp;
        return {
          ...emp,
          hourBankBalance: emp.hourBankBalance + (params.hourBankDelta || 0),
          history: [params.record, ...emp.history],
        };
      });

      const nextSchedules = params.scheduleStatusToApply
        ? applyAbsenceToSchedules(
            prev.schedules,
            params.employeeId,
            params.record.startDate,
            params.record.daysCount,
            params.scheduleStatusToApply,
            params.record.reason
          )
        : prev.schedules;

      return {
        ...prev,
        employees: nextEmployees,
        schedules: nextSchedules,
      };
    });
  };

  // Importa lote de colaboradores do Assistente de Arquivos e gera a escala deles
  const handleImportEmployeesBatch = (newEmployees: Employee[]) => {
    setState((prev) => {
      const combined = [...prev.employees, ...newEmployees];
      const now = new Date();
      const updatedSchedules = generateAutomaticScheduleForMonth(
        combined,
        prev.schedules,
        now.getFullYear(),
        now.getMonth(),
        true
      );
      return {
        ...prev,
        employees: combined,
        schedules: updatedSchedules,
      };
    });
  };

  const handleUpdateManagerAndUnits = (
    manager: ManagerProfile,
    units: HospitalUnit[]
  ) => {
    setState((prev) => ({
      ...prev,
      manager,
      units,
    }));
  };

  const handleUpdatePushConfig = (pushConfig: PushNotificationConfig) => {
    setState((prev) => ({
      ...prev,
      pushConfig,
    }));
  };

  if (showSplash) {
    return <SplashScreen onComplete={() => setShowSplash(false)} />;
  }

  if (!currentUser) {
    return <AuthScreen onAuthenticated={handleUserAuthenticated} />;
  }

  if (!state.manager.onboardingCompleted) {
    return (
      <OnboardingModal
        initialManager={{
          ...state.manager,
          name: state.manager.name || currentUser.name,
          hospitalName: state.manager.hospitalName || currentUser.hospitalName || '',
          sectorName: state.manager.sectorName || currentUser.sectorName || 'Farmácia',
          role: state.manager.role || currentUser.role || 'Supervisor de Farmácia',
        }}
        initialUnits={state.units}
        onCompleteOnboarding={handleCompleteOnboarding}
        onLoadDemoData={handleLoadDemoData}
      />
    );
  }

  const selectedModalEmployee: Employee | null =
    modalEmployeeTarget && modalEmployeeTarget !== 'NEW'
      ? state.employees.find((e) => e.id === modalEmployeeTarget) || null
      : null;

  return (
    <div className="min-h-screen bg-[#f8fafc] text-[#0f172a] flex flex-col md:flex-row">
      {/* MENU LATERAL FIXO À ESQUERDA (DESKTOP >= 768px) */}
      <aside className="no-print hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-[#0f172a] text-white border-r border-slate-800 z-30">
        <div className="p-5 flex items-center gap-3 border-b border-slate-800">
          <Logo size={38} />
          <div className="min-w-0">
            <span className="text-lg font-bold tracking-tight text-white block truncate">
              Escala<span className="text-[#0d9488]">Pro</span>
            </span>
            <span className="text-[11px] text-slate-400 block truncate">
              {state.manager.sectorName} Hospitalar
            </span>
          </div>
        </div>

        <nav className="flex-1 p-3.5 space-y-1.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = navContext.activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => updateNav({ activePage: item.id })}
                className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-[#0d9488] text-white shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800 space-y-2.5">
          <button
            type="button"
            onClick={() => handleOpenQuickLeaveWizard(null, 'ATESTADO')}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-xs font-bold transition-colors cursor-pointer"
          >
            <FileWarning className="w-4 h-4" />
            <span>+ Atestado / Horas</span>
          </button>

          <button
            type="button"
            onClick={() => setModalEmployeeTarget('NEW')}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-teal-500/15 hover:bg-teal-500/25 text-teal-300 border border-teal-500/30 text-xs font-bold transition-colors cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>+ Novo Colaborador</span>
          </button>

          {!isInstalled && isInstallable && (
            <button
              type="button"
              onClick={installApp}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-teal-400" />
              <span>Instalar App no Dispositivo</span>
            </button>
          )}

          {/* Conta Conectada & Botão Trocar de Usuário */}
          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-bold text-white truncate">
                {state.manager.name || currentUser.name}
              </p>
              <p className="text-[10px] text-slate-400 truncate flex items-center gap-1">
                {currentUser.authMode === 'firebase-google' && (
                  <Cloud className="w-3 h-3 text-teal-400 shrink-0" />
                )}
                <span>{currentUser.email}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              title="Trocar de Usuário / Sair"
              className="p-2 rounded-lg bg-slate-800 hover:bg-red-950/80 text-slate-300 hover:text-red-300 transition-colors cursor-pointer shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* ÁREA PRINCIPAL (Desktop com margem esquerda w-64 / Mobile estilo App Nativo) */}
      <div className="flex-1 md:pl-64 flex flex-col min-h-screen">
        {/* TOP BAR (Respeita Top Bar Contract de 3 zonas limpas) */}
        <header className="no-print sticky top-0 z-20 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 md:px-8 h-14 md:h-16 flex items-center justify-between gap-4 pt-safe">
          {/* Zona 1: Brand / Hospital no Mobile ou Título da Seção no Desktop */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="md:hidden">
              <Logo size={30} />
            </div>
            <div className="min-w-0">
              <span className="text-sm md:text-base font-bold text-slate-900 block truncate">
                {state.manager.hospitalName || 'EscalaPro Hospitalar'}
              </span>
              <span className="text-[11px] text-slate-500 hidden sm:block truncate">
                Conta: {state.manager.name || currentUser.name} ({currentUser.email})
                {cloudSyncStatus === 'synced' ? ' · Salvo na nuvem' : ' · Salvo na conta'}
              </span>
            </div>
          </div>

          {/* Zona 2: Links de navegação rápida em texto no desktop */}
          <nav className="hidden lg:flex items-center gap-6 text-xs font-semibold text-slate-600">
            {state.units.slice(0, 4).map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() =>
                  updateNav({
                    activePage: 'escala',
                    selectedUnitFilter: u.id,
                  })
                }
                className="hover:text-teal-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {u.name}
              </button>
            ))}
          </nav>

          {/* Zona 3: 1 Ação Primária Contextual */}
          <div className="flex items-center gap-2 shrink-0">
            {!isOnline && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700">
                <WifiOff className="w-3.5 h-3.5" />
                Offline
              </span>
            )}
            <button
              type="button"
              onClick={() => setModalEmployeeTarget('NEW')}
              className="px-3.5 py-2 rounded-xl bg-[#0d9488] hover:bg-teal-700 text-white text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              + Colaborador
            </button>
            <button
              type="button"
              onClick={handleLogout}
              title="Trocar de Usuário / Sair"
              className="md:hidden p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* CONTEÚDO DA TELA ATIVA */}
        <main className="flex-1 p-4 md:p-8 pb-24 md:pb-10 max-w-7xl w-full mx-auto">
          {navContext.activePage === 'inicio' && (
            <DashboardPage
              state={state}
              onNavigate={updateNav}
              onOpenEmployeeModal={(empId) => setModalEmployeeTarget(empId)}
              onOpenQuickLeaveWizard={handleOpenQuickLeaveWizard}
            />
          )}

          {navContext.activePage === 'escala' && (
            <SchedulePage
              state={state}
              navContext={navContext}
              onUpdateNav={updateNav}
              onGenerateAutoSchedule={handleGenerateAutoSchedule}
              onUpdateScheduleCell={handleUpdateScheduleCell}
              onOpenEmployeeModal={(empId) => setModalEmployeeTarget(empId)}
            />
          )}

          {navContext.activePage === 'colaboradores' && (
            <CollaboratorsPage
              state={state}
              navContext={navContext}
              onUpdateNav={updateNav}
              onOpenEmployeeModal={(empId) => setModalEmployeeTarget(empId || 'NEW')}
              onOpenQuickLeaveWizard={handleOpenQuickLeaveWizard}
            />
          )}

          {navContext.activePage === 'importar' && (
            <ImportExportPage
              state={state}
              onImportEmployeesBatch={handleImportEmployeesBatch}
              onRestoreBackupState={(restored) => setState(restored)}
              onNavigate={updateNav}
            />
          )}

          {navContext.activePage === 'configuracoes' && (
            <SettingsPage
              state={state}
              currentUser={currentUser}
              onLogout={handleLogout}
              onUpdateManagerAndUnits={handleUpdateManagerAndUnits}
              onUpdatePushConfig={handleUpdatePushConfig}
              onLoadDemoData={handleLoadDemoData}
            />
          )}
        </main>
      </div>

      {/* BARRA DE NAVEGAÇÃO INFERIOR FIXA (BOTTOM TAB BAR COM 5 ABAS NO MOBILE < 768px) */}
      <nav className="no-print md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe">
        <div className="grid grid-cols-5 items-center h-16">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = navContext.activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => updateNav({ activePage: item.id })}
                className={`flex flex-col items-center justify-center h-full min-h-[44px] transition-colors cursor-pointer ${
                  isActive ? 'text-[#0d9488]' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-bold tracking-tight mt-1 whitespace-nowrap">
                  {item.shortLabel}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* MODAL GLOBAL DE PRONTUÁRIO / FICHA DO COLABORADOR */}
      {modalEmployeeTarget !== null && (
        <EmployeeModal
          state={state}
          employee={selectedModalEmployee}
          onClose={() => setModalEmployeeTarget(null)}
          onSaveEmployee={handleSaveEmployee}
          onDeleteEmployee={handleDeleteEmployee}
          onRegisterAbsenceOrLeave={handleRegisterAbsenceOrLeave}
        />
      )}

      {/* ASSISTENTE GUIADO DE LANÇAMENTO MANUAL DE ATESTADO / HORAS / FALTA / FÉRIAS */}
      {quickWizardConfig.open && (
        <QuickLeaveWizardModal
          state={state}
          initialEmployeeId={quickWizardConfig.employeeId}
          initialType={quickWizardConfig.initialType}
          onClose={() =>
            setQuickWizardConfig((prev) => ({
              ...prev,
              open: false,
            }))
          }
          onApplyLeaveOrOccurrence={handleApplyLeaveOrOccurrence}
        />
      )}
    </div>
  );
}
