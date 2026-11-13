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
  auth,
  linkGoogleToCurrentAccount,
  loadWorkspaceFromFirestore,
  refreshCurrentFirebaseUser,
  resendVerificationEmail,
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
  CheckCircle2,
  Cloud,
  Download,
  FileUp,
  FileWarning,
  LayoutDashboard,
  LogOut,
  MailCheck,
  RefreshCw,
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
  const [isCloudHydrating, setIsCloudHydrating] = useState<boolean>(false);
  const [syncNoticeMsg, setSyncNoticeMsg] = useState<string | null>(null);
  const [isCheckingVerification, setIsCheckingVerification] = useState<boolean>(false);
  const syncTimeoutRef = useRef<number | null>(null);
  const isHydratingRef = useRef<boolean>(false);
  const hydratedUidRef = useRef<string | null>(null);

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

  const hydrateCloudAccount = async (account: UserAccount) => {
    if (isHydratingRef.current && hydratedUidRef.current === account.uid) return;
    isHydratingRef.current = true;
    hydratedUidRef.current = account.uid;

    try {
      let localUserState = storageService.loadStateForUser(account);
      const orphaned = storageService.findOrphanedLocalWorkspace(account.uid);

      if (
        !localUserState.manager.onboardingCompleted &&
        localUserState.employees.length === 0 &&
        orphaned
      ) {
        localUserState = orphaned.state;
        storageService.saveStateForUser(account.uid, localUserState);
        try {
          localStorage.removeItem(orphaned.storageKey);
        } catch {
          // ignora erro ao limpar chave legada
        }
      }

      setState(localUserState);

      if (account.emailVerified && auth.currentUser?.uid === account.uid) {
        if (!localUserState.manager.onboardingCompleted) {
          setIsCloudHydrating(true);
        }
        setCloudSyncStatus('syncing');
        const remoteState = await loadWorkspaceFromFirestore(account.uid);

        if (remoteState) {
          let finalState = remoteState;
          let shouldPushMerged = false;

          // Se a nuvem ainda não tem colaboradores, mas o aparelho local (ou workspace órfão) já possui, preserva e sobe para a nuvem
          const richerLocal =
            localUserState.employees.length > 0
              ? localUserState
              : orphaned && orphaned.state.employees.length > 0
              ? orphaned.state
              : null;

          if (remoteState.employees.length === 0 && richerLocal) {
            finalState = {
              ...remoteState,
              manager: {
                ...remoteState.manager,
                name: remoteState.manager.name || richerLocal.manager.name,
                hospitalName:
                  remoteState.manager.hospitalName || richerLocal.manager.hospitalName,
                sectorName: remoteState.manager.sectorName || richerLocal.manager.sectorName,
                role: remoteState.manager.role || richerLocal.manager.role,
                onboardingCompleted:
                  remoteState.manager.onboardingCompleted ||
                  richerLocal.manager.onboardingCompleted,
              },
              units:
                remoteState.units.length > 0 ? remoteState.units : richerLocal.units,
              employees: richerLocal.employees,
              schedules:
                Object.keys(richerLocal.schedules || {}).length > 0
                  ? richerLocal.schedules
                  : remoteState.schedules,
            };
            shouldPushMerged = true;
          }

          storageService.saveStateForUser(account.uid, finalState);
          setState(finalState);
          if (orphaned) {
            try {
              localStorage.removeItem(orphaned.storageKey);
            } catch {
              // ignora
            }
          }

          if (shouldPushMerged) {
            await syncWorkspaceToFirestore(account.uid, finalState);
          }

          const mergedAccount: UserAccount = {
            ...account,
            name: finalState.manager.name || account.name,
            hospitalName: finalState.manager.hospitalName || account.hospitalName,
            sectorName: finalState.manager.sectorName || account.sectorName,
            role: finalState.manager.role || account.role,
            units: finalState.units.length > 0 ? finalState.units : account.units,
          };
          storageService.saveRegisteredAccountMetadata(mergedAccount);
          storageService.setActiveSessionAccount(mergedAccount);
          setCurrentUser(mergedAccount);
          setCloudSyncStatus('synced');
        } else if (localUserState.manager.onboardingCompleted) {
          const pushed = await syncWorkspaceToFirestore(account.uid, localUserState);
          setCloudSyncStatus(pushed ? 'synced' : 'idle');
        } else {
          setCloudSyncStatus('idle');
        }
      } else {
        setCloudSyncStatus('idle');
      }
    } catch (err) {
      console.error('Aviso na sincronização com Firestore:', err);
      setCloudSyncStatus('idle');
    } finally {
      isHydratingRef.current = false;
      setIsCloudHydrating(false);
    }
  };

  // Escuta autenticação Firebase (Google ou E-mail/Senha) em qualquer dispositivo
  useEffect(() => {
    const unsubscribe = subscribeToFirebaseAuth(async (fbUser) => {
      if (!fbUser) return;
      const activeAcc = storageService.getActiveSessionAccount();
      const fbEmailClean = (fbUser.email || '').trim().toLowerCase();
      const activeEmailClean = (activeAcc?.email || '').trim().toLowerCase();

      // Só mantém sessão local legada se for de OUTRO e-mail; se for o mesmo e-mail, unifica na conta Firebase
      if (
        activeAcc &&
        activeAcc.authMode === 'account-credentials' &&
        activeAcc.uid.startsWith('usr_') &&
        activeEmailClean !== fbEmailClean
      ) {
        return;
      }

      if (!activeAcc || activeAcc.uid === fbUser.uid || activeEmailClean === fbEmailClean) {
        const isGoogle = fbUser.providerData.some((p) => p.providerId === 'google.com');
        const fbAcc: UserAccount = {
          uid: fbUser.uid,
          name: fbUser.displayName || activeAcc?.name || '',
          email: fbUser.email || activeAcc?.email || '',
          photoURL: fbUser.photoURL || undefined,
          authMode: isGoogle ? 'firebase-google' : 'firebase-email',
          emailVerified: fbUser.emailVerified,
          hospitalName: activeAcc?.hospitalName || '',
          sectorName: activeAcc?.sectorName || '',
          role: activeAcc?.role || '',
          units: activeAcc?.units || [],
          createdAt: activeAcc?.createdAt || new Date().toISOString(),
        };
        if (activeAcc && activeAcc.uid !== fbUser.uid && activeAcc.uid.startsWith('usr_')) {
          storageService.removeLocalAccountRecord(activeAcc.uid);
        }
        storageService.saveRegisteredAccountMetadata(fbAcc);
        storageService.setActiveSessionAccount(fbAcc);
        setCurrentUser(fbAcc);

        if (hydratedUidRef.current !== fbUser.uid) {
          await hydrateCloudAccount(fbAcc);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Salva automaticamente no cache offline do usuário e sincroniza na nuvem (Firestore)
  useEffect(() => {
    if (!currentUser) return;
    storageService.saveStateForUser(currentUser.uid, state);
    storageService.saveRegisteredAccountMetadata({
      ...currentUser,
      name: state.manager.name || currentUser.name,
      hospitalName: state.manager.hospitalName || currentUser.hospitalName,
      sectorName: state.manager.sectorName || currentUser.sectorName,
      role: state.manager.role || currentUser.role,
      units: state.units.length > 0 ? state.units : currentUser.units,
    });

    if (
      (currentUser.authMode === 'firebase-google' || currentUser.authMode === 'firebase-email') &&
      currentUser.emailVerified &&
      !isHydratingRef.current
    ) {
      if (syncTimeoutRef.current) {
        window.clearTimeout(syncTimeoutRef.current);
      }
      setCloudSyncStatus('syncing');
      syncTimeoutRef.current = window.setTimeout(() => {
        syncWorkspaceToFirestore(currentUser.uid, state)
          .then((ok) => setCloudSyncStatus(ok ? 'synced' : 'idle'))
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
    hydratedUidRef.current = null;
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

    await hydrateCloudAccount(account);
  };

  // Verifica confirmação de e-mail ou vincula Google para sincronização imediata entre App e Site
  const handleConfirmEmailAndSync = async () => {
    if (!currentUser) return;
    setIsCheckingVerification(true);
    setSyncNoticeMsg(null);
    try {
      const refreshed = await refreshCurrentFirebaseUser();
      if (refreshed && refreshed.emailVerified) {
        const updatedAcc: UserAccount = {
          ...currentUser,
          emailVerified: true,
        };
        storageService.saveRegisteredAccountMetadata(updatedAcc);
        storageService.setActiveSessionAccount(updatedAcc);
        setCurrentUser(updatedAcc);

        setCloudSyncStatus('syncing');
        const remote = await loadWorkspaceFromFirestore(refreshed.uid);
        if (
          remote &&
          (!state.manager.onboardingCompleted ||
            (remote.employees.length > 0 && state.employees.length === 0))
        ) {
          storageService.saveStateForUser(refreshed.uid, remote);
          setState(remote);
        } else {
          await syncWorkspaceToFirestore(refreshed.uid, state);
        }
        setCloudSyncStatus('synced');
        setSyncNoticeMsg('E-mail confirmado! Sua conta está 100% sincronizada entre App e Site.');
        setTimeout(() => setSyncNoticeMsg(null), 5000);
      } else {
        setSyncNoticeMsg(
          `Ainda aguardando a confirmação do link enviado para ${currentUser.email}. Verifique sua caixa de entrada ou Spam.`
        );
      }
    } catch (err) {
      setSyncNoticeMsg(err instanceof Error ? err.message : 'Erro ao verificar confirmação.');
    } finally {
      setIsCheckingVerification(false);
    }
  };

  const handleResendVerification = async () => {
    setSyncNoticeMsg(null);
    try {
      await resendVerificationEmail();
      setSyncNoticeMsg(
        `Novo link de confirmação enviado para ${currentUser?.email}. Abra o link e toque em "Já confirmei".`
      );
    } catch (err) {
      setSyncNoticeMsg(
        err instanceof Error ? err.message : 'Aguarde alguns segundos antes de reenviar o e-mail.'
      );
    }
  };

  const handleLinkGoogleForInstantSync = async () => {
    if (!currentUser) return;
    setIsCheckingVerification(true);
    setSyncNoticeMsg(null);
    try {
      const linkedUser = await linkGoogleToCurrentAccount();
      const updatedAcc: UserAccount = {
        ...currentUser,
        authMode: 'firebase-google',
        emailVerified: true,
        photoURL: linkedUser.photoURL || currentUser.photoURL,
      };
      storageService.saveRegisteredAccountMetadata(updatedAcc);
      storageService.setActiveSessionAccount(updatedAcc);
      setCurrentUser(updatedAcc);
      setCloudSyncStatus('syncing');
      await syncWorkspaceToFirestore(linkedUser.uid, state);
      setCloudSyncStatus('synced');
      setSyncNoticeMsg('Conta Google vinculada! Sincronização imediata ativada.');
      setTimeout(() => setSyncNoticeMsg(null), 5000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('popup-closed-by-user')) {
        setSyncNoticeMsg('Não foi possível vincular com o Google agora. Use a confirmação por e-mail.');
      }
    } finally {
      setIsCheckingVerification(false);
    }
  };

  // Encerra a sessão atual para permitir entrada ou cadastro de outro usuário
  const handleLogout = async () => {
    hydratedUidRef.current = null;
    isHydratingRef.current = false;
    storageService.setActiveSessionAccount(null);
    setCurrentUser(null);
    setCloudSyncStatus('idle');
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

  if (isCloudHydrating) {
    return (
      <div className="min-h-screen bg-[#0f172a] text-white flex flex-col items-center justify-center p-6 text-center">
        <Logo size={54} />
        <p className="mt-4 text-sm font-bold tracking-tight">
          Sincronizando sua conta na nuvem...
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Carregando suas unidades, colaboradores e escalas
        </p>
      </div>
    );
  }

  if (!state.manager.onboardingCompleted) {
    return (
      <OnboardingModal
        initialManager={{
          ...state.manager,
          name: state.manager.name || currentUser.name,
          hospitalName: state.manager.hospitalName || currentUser.hospitalName || '',
          sectorName: state.manager.sectorName || currentUser.sectorName || '',
          role: state.manager.role || currentUser.role || '',
        }}
        initialUnits={state.units}
        onCompleteOnboarding={handleCompleteOnboarding}
        onBackToAuth={handleLogout}
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
                {(currentUser.authMode === 'firebase-google' ||
                  currentUser.authMode === 'firebase-email') && (
                  <Cloud
                    className={`w-3 h-3 shrink-0 ${
                      currentUser.emailVerified ? 'text-teal-400' : 'text-amber-400'
                    }`}
                  />
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
                {cloudSyncStatus === 'synced'
                  ? ' · Sincronizado na nuvem'
                  : cloudSyncStatus === 'syncing'
                  ? ' · Sincronizando...'
                  : currentUser.authMode === 'firebase-email' && !currentUser.emailVerified
                  ? ' · Confirme seu e-mail para sincronizar'
                  : ' · Salvo localmente'}
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
        <main className="flex-1 p-4 md:p-8 pb-24 md:pb-10 max-w-7xl w-full mx-auto space-y-5">
          {syncNoticeMsg && (
            <div className="no-print p-3.5 rounded-2xl bg-teal-50 border border-teal-200 text-teal-900 text-xs font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
              <span>{syncNoticeMsg}</span>
            </div>
          )}

          {currentUser.authMode === 'firebase-email' && !currentUser.emailVerified && (
            <div className="no-print p-4 rounded-2xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <MailCheck className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-950">
                  <p className="font-bold">
                    Confirme seu e-mail para sincronizar entre o App e o Site
                  </p>
                  <p className="text-amber-800 mt-0.5">
                    Enviamos um link para <strong>{currentUser.email}</strong>. Após clicar no link (ou vincular com Google), suas unidades e escalas ficarão acessíveis de qualquer celular ou computador.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={isCheckingVerification}
                  onClick={handleConfirmEmailAndSync}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isCheckingVerification ? 'animate-spin' : ''}`} />
                  <span>Já confirmei · Sincronizar</span>
                </button>
                <button
                  type="button"
                  onClick={handleResendVerification}
                  className="px-3 py-2 rounded-xl bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-semibold cursor-pointer"
                >
                  Reenviar e-mail
                </button>
                <button
                  type="button"
                  disabled={isCheckingVerification}
                  onClick={handleLinkGoogleForInstantSync}
                  className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer"
                >
                  Vincular Google
                </button>
              </div>
            </div>
          )}

          {currentUser.authMode === 'account-credentials' && currentUser.uid.startsWith('usr_') && (
            <div className="no-print p-4 rounded-2xl bg-slate-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <Cloud className="w-5 h-5 text-teal-400 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-bold">Conta salva apenas neste dispositivo</p>
                  <p className="text-slate-300 mt-0.5">
                    Saia e entre novamente com seu e-mail e senha (ou Google) para enviar seus dados atuais para a nuvem e acessar de qualquer site ou celular.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="px-3.5 py-2 rounded-xl bg-[#0d9488] hover:bg-teal-700 text-white text-xs font-bold cursor-pointer shrink-0"
              >
                Conectar à Nuvem
              </button>
            </div>
          )}

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
