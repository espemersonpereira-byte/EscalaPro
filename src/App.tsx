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
  MonthlyScheduleMap,
} from './types';
import {
  applyAbsenceToSchedules,
  createDemoEscalaProState,
  deduplicateEscalaProState,
  generateAutomaticScheduleForMonth,
  getYearMonthKey,
  parseIsoDateParts,
  reapplyEmployeeHistoryToSchedules,
  storageService,
} from './services/storageService';
import {
  deleteUserAccountFromCloud,
  loadWorkspaceFromFirestore,
  mergeTwoEscalaProStates,
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
import { HourBankPage } from './components/HourBankPage';
import { ImportExportPage } from './components/ImportExportPage';
import { SettingsPage } from './components/SettingsPage';
import { EmployeeModal } from './components/EmployeeModal';
import { QuickLeaveWizardModal } from './components/QuickLeaveWizardModal';
import { usePWAInstall } from './hooks/usePWAInstall';
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  Cloud,
  Download,
  FileUp,
  FileWarning,
  LayoutDashboard,
  LogOut,
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
  { id: 'banco_horas', label: 'Banco de Horas', shortLabel: 'Banco', icon: Clock },
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
  const isPushingRef = useRef<boolean>(false);
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
  const [newEmployeeUnitId, setNewEmployeeUnitId] = useState<string | null>(null);

  // Controle do Assistente Guiado de Folga / Atestado / Horas / Falta / Férias
  const [quickWizardConfig, setQuickWizardConfig] = useState<{
    open: boolean;
    employeeId: string | null;
    initialType: 'FOLGA' | 'ATESTADO' | 'DECLARACAO_HORAS' | 'FALTA' | 'FERIAS';
  }>({
    open: false,
    employeeId: null,
    initialType: 'ATESTADO',
  });

  const { isInstallable, isInstalled, installApp } = usePWAInstall();

  const hydrateCloudAccount = async (account: UserAccount, forceManualSync = false) => {
    if (isHydratingRef.current && !forceManualSync && hydratedUidRef.current === account.uid) {
      return;
    }
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
      } else if (orphaned && orphaned.state.employees.length > 0) {
        localUserState = mergeTwoEscalaProStates(localUserState, orphaned.state);
        storageService.saveStateForUser(account.uid, localUserState);
      }

      setState(localUserState);

      if (!localUserState.manager.onboardingCompleted) {
        setIsCloudHydrating(true);
      }
      setCloudSyncStatus('syncing');

      // 1. Consulta primeiro a nuvem para verificar se há dados mais novos vindos de outro aparelho (Celular ou PC)
      const remoteState = await loadWorkspaceFromFirestore(account.uid, account.email);

      if (remoteState) {
        const localTime = new Date(localUserState.lastUpdated || 0).getTime();
        const remoteTime = new Date(remoteState.lastUpdated || 0).getTime();
        const localEmpCount = localUserState.employees.length;
        const remoteEmpCount = remoteState.employees.length;

        // Se o estado na nuvem foi atualizado mais recentemente (ou se este aparelho está vazio e a nuvem tem dados), adota o estado da nuvem
        const finalState =
          localEmpCount === 0 && remoteEmpCount > 0
            ? deduplicateEscalaProState(remoteState)
            : remoteEmpCount === 0 && localEmpCount > 0
            ? deduplicateEscalaProState(localUserState)
            : remoteTime > localTime
            ? deduplicateEscalaProState(remoteState)
            : deduplicateEscalaProState(localUserState);

        storageService.saveStateForUser(account.uid, finalState);
        setState(finalState);

        if (orphaned) {
          try {
            localStorage.removeItem(orphaned.storageKey);
          } catch {
            // ignora
          }
        }

        const mergedAccount: UserAccount = {
          ...account,
          emailVerified: true,
          name: finalState.manager.name || account.name,
          hospitalName: finalState.manager.hospitalName || account.hospitalName,
          sectorName: finalState.manager.sectorName || account.sectorName,
          role: finalState.manager.role || account.role,
          units: finalState.units.length > 0 ? finalState.units : account.units,
        };
        storageService.saveRegisteredAccountMetadata(mergedAccount);
        storageService.setActiveSessionAccount(mergedAccount);
        setCurrentUser(mergedAccount);

        await syncWorkspaceToFirestore(
          mergedAccount.uid,
          finalState,
          mergedAccount.email,
          mergedAccount
        );
        setCloudSyncStatus('synced');
      } else if (localUserState.manager.onboardingCompleted) {
        const pushed = await syncWorkspaceToFirestore(
          account.uid,
          localUserState,
          account.email,
          account
        );
        setCloudSyncStatus(pushed ? 'synced' : 'idle');
      } else {
        setCloudSyncStatus('idle');
      }
    } catch (err) {
      console.error('Aviso na sincronização com a nuvem:', err);
      setCloudSyncStatus('idle');
    } finally {
      isHydratingRef.current = false;
      setIsCloudHydrating(false);
    }
  };

  // Hidrata e sincroniza automaticamente na abertura do App (mesmo para sessões já ativas no celular ou PC)
  useEffect(() => {
    const activeAcc = storageService.getActiveSessionAccount();
    if (activeAcc && hydratedUidRef.current !== activeAcc.uid) {
      hydrateCloudAccount(activeAcc);
    }
  }, []);

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
          emailVerified: true,
          hospitalName: activeAcc?.hospitalName || '',
          sectorName: activeAcc?.sectorName || '',
          role: activeAcc?.role || '',
          units: activeAcc?.units || [],
          createdAt: activeAcc?.createdAt || new Date().toISOString(),
        };
        if (activeAcc && activeAcc.uid !== fbUser.uid && activeAcc.uid.startsWith('usr_')) {
          const oldState = storageService.loadStateForUser(activeAcc);
          storageService.saveStateForUser(fbUser.uid, oldState);
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

  // Salva automaticamente no cache offline do usuário e envia para a nuvem (sem sobrescrever a tela com polling reverso)
  useEffect(() => {
    if (!currentUser) return;
    storageService.saveStateForUser(currentUser.uid, state);
    const updatedAccMeta: UserAccount = {
      ...currentUser,
      emailVerified: true,
      name: state.manager.name || currentUser.name,
      hospitalName: state.manager.hospitalName || currentUser.hospitalName,
      sectorName: state.manager.sectorName || currentUser.sectorName,
      role: state.manager.role || currentUser.role,
      units: state.units.length > 0 ? state.units : currentUser.units,
    };
    storageService.saveRegisteredAccountMetadata(updatedAccMeta);

    if (!isHydratingRef.current) {
      if (syncTimeoutRef.current) {
        window.clearTimeout(syncTimeoutRef.current);
      }
      isPushingRef.current = true;
      syncTimeoutRef.current = window.setTimeout(() => {
        syncTimeoutRef.current = null;
        const stampedState: EscalaProState = {
          ...state,
          lastUpdated: state.lastUpdated || new Date().toISOString(),
        };
        syncWorkspaceToFirestore(currentUser.uid, stampedState, currentUser.email, updatedAccMeta)
          .then((ok) => setCloudSyncStatus(ok ? 'synced' : 'idle'))
          .catch((err) => {
            console.error('Erro ao sincronizar estado com a nuvem:', err);
            setCloudSyncStatus('idle');
          })
          .finally(() => {
            isPushingRef.current = false;
          });
      }, 350);
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
      ['inicio', 'escala', 'colaboradores', 'banco_horas', 'importar', 'configuracoes'].includes(
        pageParam
      )
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

    await hydrateCloudAccount(account, true);
  };

  // Sincronização manual instantânea (botão Sincronizar no topo)
  const handleManualCloudSync = async () => {
    if (!currentUser) return;
    setIsCheckingVerification(true);
    setSyncNoticeMsg(null);
    try {
      await hydrateCloudAccount(currentUser, true);
      setSyncNoticeMsg(
        `Sincronização concluída! Sua conta (${currentUser.email}) está atualizada entre Celular e PC.`
      );
      setTimeout(() => setSyncNoticeMsg(null), 4500);
    } catch {
      setSyncNoticeMsg('Não foi possível sincronizar agora. Verifique sua conexão.');
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

  // Apaga completamente a conta do usuário (nuvem + local) para permitir novo cadastro do zero
  const handleDeleteAccount = async () => {
    if (!currentUser) return;
    if (syncTimeoutRef.current) {
      window.clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
    const uidToDelete = currentUser.uid;
    const emailToDelete = currentUser.email;
    hydratedUidRef.current = null;
    isHydratingRef.current = false;

    await deleteUserAccountFromCloud(uidToDelete, emailToDelete);
    const blankState = storageService.deleteUserAccountCompletely(uidToDelete, emailToDelete);
    setState(blankState);
    setCurrentUser(null);
    setCloudSyncStatus('idle');
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
      lastUpdated: new Date().toISOString(),
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
      lastUpdated: new Date().toISOString(),
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
        lastUpdated: new Date().toISOString(),
      };
    });
  };

  // Edição rápida de célula da escala (incluindo permuta dupla, remanejamento de setor do dia e banco de horas)
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
        lastUpdated: new Date().toISOString(),
      };
    });
  };

  // Salva novo colaborador ou atualiza colaborador existente
  const handleSaveEmployee = (
    emp: Employee,
    newCustomRole?: string,
    newUnitToCreate?: HospitalUnit
  ) => {
    setState((prev) => {
      const existingEmp = prev.employees.find((e) => e.id === emp.id);
      const exists = Boolean(existingEmp);
      const nextEmployees = exists
        ? prev.employees.map((e) => (e.id === emp.id ? emp : e))
        : [...prev.employees, emp];

      const nextCustomRoles =
        newCustomRole && !prev.customRoles.includes(newCustomRole)
          ? [...prev.customRoles, newCustomRole]
          : prev.customRoles;

      const nextUnits =
        newUnitToCreate && !prev.units.some((u) => u.id === newUnitToCreate.id)
          ? [...prev.units, newUnitToCreate]
          : prev.units;

      const now = new Date();
      // Só gera escala automática para o colaborador salvo se ele for novo ou se mudou de regime/turno, preservando todas as folgas e marcações dos demais colaboradores
      const shouldGenerateForTarget =
        !existingEmp ||
        existingEmp.regime !== emp.regime ||
        existingEmp.defaultShift !== emp.defaultShift;

      const nextSchedules = shouldGenerateForTarget
        ? generateAutomaticScheduleForMonth(
            [emp],
            prev.schedules,
            now.getFullYear(),
            now.getMonth(),
            true
          )
        : reapplyEmployeeHistoryToSchedules(nextEmployees, prev.schedules);

      return deduplicateEscalaProState({
        ...prev,
        units: nextUnits,
        customRoles: nextCustomRoles,
        employees: nextEmployees,
        schedules: nextSchedules,
        lastUpdated: new Date().toISOString(),
      });
    });
  };

  const handleDeleteEmployee = (employeeId: string) => {
    setState((prev) =>
      deduplicateEscalaProState({
        ...prev,
        employees: prev.employees.filter((e) => e.id !== employeeId),
        lastUpdated: new Date().toISOString(),
      })
    );
  };

  // Registra Folga (F), Falta (FA), Atestado Médico (AT) ou Férias (FE) a partir do Prontuário
  const handleRegisterAbsenceOrLeave = (
    employeeId: string,
    record: AbsenceRecord,
    statusToApply: 'F' | 'FA' | 'AT' | 'FE'
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
        lastUpdated: new Date().toISOString(),
      };
    });
  };

  const handleOpenQuickLeaveWizard = (
    employeeId: string | null = null,
    initialType: 'FOLGA' | 'ATESTADO' | 'DECLARACAO_HORAS' | 'FALTA' | 'FERIAS' = 'ATESTADO'
  ) => {
    setQuickWizardConfig({
      open: true,
      employeeId,
      initialType,
    });
  };

  // Aplica Folga, Atestado Médico, Declaração de Horas, Falta ou Férias via Assistente Manual
  const handleApplyLeaveOrOccurrence = (params: {
    employeeId: string;
    record: AbsenceRecord;
    scheduleStatusToApply?: 'F' | 'AT' | 'FA' | 'FE';
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
        lastUpdated: new Date().toISOString(),
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
      return deduplicateEscalaProState({
        ...prev,
        employees: combined,
        schedules: updatedSchedules,
        lastUpdated: new Date().toISOString(),
      });
    });
  };

  // Aplica lote de saldos do Importador Inteligente de Banco de Horas (vinculando pelo nome aos colaboradores existentes)
  const handleApplyHourBankBatch = (
    updates: {
      employeeId?: string;
      newEmployee?: Employee;
      hoursValue: number;
      mode: 'REPLACE' | 'ADD';
      reason: string;
    }[]
  ) => {
    setState((prev) => {
      const todayIso = new Date().toISOString().slice(0, 10);
      let nextEmployees = [...prev.employees];
      const newlyCreated: Employee[] = [];

      for (const item of updates) {
        if (item.employeeId) {
          nextEmployees = nextEmployees.map((emp) => {
            if (emp.id !== item.employeeId) return emp;
            const currentBal = Number(emp.hourBankBalance) || 0;
            const newBal =
              item.mode === 'ADD'
                ? Math.round((currentBal + item.hoursValue) * 100) / 100
                : Math.round(item.hoursValue * 100) / 100;
            const delta = Math.round((newBal - currentBal) * 100) / 100;

            const logRecord: AbsenceRecord = {
              id: `hb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              employeeId: emp.id,
              type: 'HORA_EXTRA',
              startDate: todayIso,
              daysCount: 1,
              reason: item.reason,
              extraHours: delta,
              createdAt: new Date().toISOString(),
            };

            return {
              ...emp,
              hourBankBalance: newBal,
              history: [logRecord, ...(emp.history || [])],
            };
          });
        } else if (item.newEmployee) {
          const logRecord: AbsenceRecord = {
            id: `hb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            employeeId: item.newEmployee.id,
            type: 'HORA_EXTRA',
            startDate: todayIso,
            daysCount: 1,
            reason: item.reason,
            extraHours: item.hoursValue,
            createdAt: new Date().toISOString(),
          };
          const empWithHistory: Employee = {
            ...item.newEmployee,
            history: [logRecord],
          };
          nextEmployees.push(empWithHistory);
          newlyCreated.push(empWithHistory);
        }
      }

      const now = new Date();
      const nextSchedules =
        newlyCreated.length > 0
          ? generateAutomaticScheduleForMonth(
              newlyCreated,
              prev.schedules,
              now.getFullYear(),
              now.getMonth(),
              true
            )
          : prev.schedules;

      return deduplicateEscalaProState({
        ...prev,
        employees: nextEmployees,
        schedules: nextSchedules,
        lastUpdated: new Date().toISOString(),
      });
    });
  };

  // Atualiza individualmente o saldo de Banco de Horas de um colaborador
  const handleUpdateSingleEmployeeHourBank = (
    employeeId: string,
    newBalance: number,
    deltaHours: number,
    reason: string
  ) => {
    setState((prev) => {
      const todayIso = new Date().toISOString().slice(0, 10);
      const nextEmployees = prev.employees.map((emp) => {
        if (emp.id !== employeeId) return emp;
        const logRecord: AbsenceRecord = {
          id: `hb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          employeeId: emp.id,
          type: 'HORA_EXTRA',
          startDate: todayIso,
          daysCount: 1,
          reason,
          extraHours: deltaHours,
          createdAt: new Date().toISOString(),
        };
        return {
          ...emp,
          hourBankBalance: Math.round(newBalance * 100) / 100,
          history: [logRecord, ...(emp.history || [])],
        };
      });

      return {
        ...prev,
        employees: nextEmployees,
        lastUpdated: new Date().toISOString(),
      };
    });
  };

  const handleUpdateManagerAndUnits = (
    manager: ManagerProfile,
    units: HospitalUnit[]
  ) => {
    setState((prev) => {
      const validIds = new Set(units.map((u) => u.id));
      const fallbackUnitId = units[0]?.id || 'unit-default-1';

      // Se uma unidade/setor foi removida, realoca seus colaboradores para uma unidade de mesmo nome ou para a primeira unidade restante
      const remappedEmployees = prev.employees.map((emp) => {
        if (validIds.has(emp.unitId)) return emp;
        const oldUnit = prev.units.find((u) => u.id === emp.unitId);
        const sameNameUnit = oldUnit
          ? units.find(
              (u) =>
                u.name.trim().toLowerCase() === oldUnit.name.trim().toLowerCase()
            )
          : undefined;
        return {
          ...emp,
          unitId: sameNameUnit?.id || fallbackUnitId,
        };
      });

      return deduplicateEscalaProState({
        ...prev,
        manager,
        units,
        employees: remappedEmployees,
        lastUpdated: new Date().toISOString(),
      });
    });
  };

  const handleUpdatePushConfig = (pushConfig: PushNotificationConfig) => {
    setState((prev) => ({
      ...prev,
      pushConfig,
      lastUpdated: new Date().toISOString(),
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
    <div className="min-h-screen w-full max-w-full overflow-x-clip bg-[#f8fafc] text-[#0f172a] flex flex-col md:flex-row">
      {/* MENU LATERAL FIXO À ESQUERDA (DESKTOP >= 768px) */}
      <aside className="no-print hidden md:flex md:w-60 md:flex-col md:fixed md:inset-y-0 bg-[#0f172a] text-white border-r border-slate-800 z-30">
        <div className="p-4 flex items-center gap-3 border-b border-slate-800">
          <Logo size={36} />
          <div className="min-w-0">
            <span className="text-lg font-bold tracking-tight text-white block truncate">
              Escala<span className="text-[#0d9488]">Pro</span>
            </span>
            <span className="text-[11px] text-slate-400 block truncate">
              {state.manager.sectorName} Hospitalar
            </span>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = navContext.activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => updateNav({ activePage: item.id })}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-[#0d9488] text-white shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3.5 border-t border-slate-800 space-y-2">
          <button
            type="button"
            onClick={() => handleOpenQuickLeaveWizard(null, 'ATESTADO')}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-xs font-bold transition-colors cursor-pointer"
          >
            <FileWarning className="w-4 h-4 shrink-0" />
            <span className="truncate">+ Atestado / Horas</span>
          </button>

          <button
            type="button"
            onClick={() => setModalEmployeeTarget('NEW')}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-teal-500/15 hover:bg-teal-500/25 text-teal-300 border border-teal-500/30 text-xs font-bold transition-colors cursor-pointer"
          >
            <UserPlus className="w-4 h-4 shrink-0" />
            <span className="truncate">+ Novo Colaborador</span>
          </button>

          {!isInstalled && isInstallable && (
            <button
              type="button"
              onClick={installApp}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-teal-400 shrink-0" />
              <span className="truncate">Instalar App</span>
            </button>
          )}

          {/* Conta Conectada & Botão Trocar de Usuário */}
          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-bold text-white truncate">
                {state.manager.name || currentUser.name}
              </p>
              <p className="text-[10px] text-slate-400 truncate flex items-center gap-1">
                <Cloud className="w-3 h-3 shrink-0 text-teal-400" />
                <span className="truncate">{currentUser.email}</span>
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

      {/* ÁREA PRINCIPAL (Desktop com margem esquerda w-60 e min-w-0 para nunca cortar na direita) */}
      <div className="flex-1 min-w-0 w-full max-w-full md:pl-60 flex flex-col min-h-screen overflow-x-clip">
        {/* TOP BAR (Com pt-safe externo e altura mínima garantida na linha interna para nunca cortar no topo do iPhone) */}
        <header className="no-print sticky top-0 z-20 bg-white/95 backdrop-blur-md border-b border-slate-200 pt-safe w-full max-w-full">
          <div className="px-3.5 sm:px-4 md:px-6 min-h-[56px] md:min-h-[64px] py-2 flex items-center justify-between gap-2 sm:gap-3 w-full max-w-full">
            {/* Zona 1: Brand / Hospital */}
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="md:hidden shrink-0">
                <Logo size={28} />
              </div>
              <div className="min-w-0">
                <span className="text-sm md:text-base font-bold text-slate-900 block truncate leading-tight">
                  {state.manager.hospitalName || 'EscalaPro Hospitalar'}
                </span>
                <span className="text-[11px] text-slate-500 hidden sm:block truncate leading-tight mt-0.5">
                  {state.manager.name || currentUser.name} · {currentUser.email}
                </span>
              </div>
            </div>

            {/* Zona 2: Links de navegação rápida em texto no desktop */}
            <nav className="hidden xl:flex items-center gap-4 text-xs font-semibold text-slate-600 shrink-0">
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
                  className="hover:text-teal-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer max-w-[130px] truncate"
                >
                  {u.name}
                </button>
              ))}
            </nav>

            {/* Zona 3: Sincronizar + Ação Primária Contextual */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {!isOnline && (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700">
                  <WifiOff className="w-3.5 h-3.5" />
                  Offline
                </span>
              )}
              <button
                type="button"
                onClick={handleManualCloudSync}
                disabled={isCheckingVerification}
                title="Atualizar dados entre Celular e PC"
                className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl bg-slate-100 hover:bg-teal-50 text-slate-700 hover:text-teal-800 border border-slate-200 text-xs font-bold transition-colors cursor-pointer disabled:opacity-60 shrink-0"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 text-teal-600 ${
                    isCheckingVerification ? 'animate-spin' : ''
                  }`}
                />
                <span className="hidden sm:inline">Sincronizar</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setNewEmployeeUnitId(null);
                  setModalEmployeeTarget('NEW');
                }}
                className="px-3 py-2 rounded-xl bg-[#0d9488] hover:bg-teal-700 text-white text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                + Colaborador
              </button>
              <button
                type="button"
                onClick={handleLogout}
                title="Trocar de Usuário / Sair"
                className="md:hidden p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer shrink-0"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        {/* CONTEÚDO DA TELA ATIVA */}
        <main className="flex-1 min-w-0 p-4 md:p-6 pb-24 md:pb-10 max-w-6xl w-full mx-auto space-y-5 overflow-x-clip">
          {syncNoticeMsg && (
            <div className="no-print p-3.5 rounded-2xl bg-teal-50 border border-teal-200 text-teal-900 text-xs font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
              <span>{syncNoticeMsg}</span>
            </div>
          )}

          {navContext.activePage === 'inicio' && (
            <DashboardPage
              state={state}
              onNavigate={updateNav}
              onOpenEmployeeModal={(empId) => {
                setNewEmployeeUnitId(null);
                setModalEmployeeTarget(empId);
              }}
              onOpenNewEmployeeForUnit={(unitId) => {
                setNewEmployeeUnitId(unitId);
                setModalEmployeeTarget('NEW');
              }}
              onOpenQuickLeaveWizard={handleOpenQuickLeaveWizard}
              onUpdateScheduleCell={handleUpdateScheduleCell}
            />
          )}

          {navContext.activePage === 'escala' && (
            <SchedulePage
              state={state}
              navContext={navContext}
              onUpdateNav={updateNav}
              onGenerateAutoSchedule={handleGenerateAutoSchedule}
              onUpdateScheduleCell={handleUpdateScheduleCell}
              onOpenEmployeeModal={(empId) => {
                setNewEmployeeUnitId(null);
                setModalEmployeeTarget(empId);
              }}
            />
          )}

          {navContext.activePage === 'colaboradores' && (
            <CollaboratorsPage
              state={state}
              navContext={navContext}
              onUpdateNav={updateNav}
              onOpenEmployeeModal={(empId) => {
                setNewEmployeeUnitId(
                  navContext.selectedUnitFilter !== 'TODAS' ? navContext.selectedUnitFilter : null
                );
                setModalEmployeeTarget(empId || 'NEW');
              }}
              onOpenQuickLeaveWizard={handleOpenQuickLeaveWizard}
            />
          )}

          {navContext.activePage === 'banco_horas' && (
            <HourBankPage
              state={state}
              onApplyHourBankBatch={handleApplyHourBankBatch}
              onUpdateSingleEmployeeHourBank={handleUpdateSingleEmployeeHourBank}
            />
          )}

          {navContext.activePage === 'importar' && (
            <ImportExportPage
              state={state}
              onImportEmployeesBatch={handleImportEmployeesBatch}
              onRestoreBackupState={(restored) =>
                setState({
                  ...deduplicateEscalaProState(restored),
                  lastUpdated: new Date().toISOString(),
                })
              }
              onNavigate={updateNav}
            />
          )}

          {navContext.activePage === 'configuracoes' && (
            <SettingsPage
              state={state}
              currentUser={currentUser}
              onLogout={handleLogout}
              onDeleteAccount={handleDeleteAccount}
              onUpdateManagerAndUnits={handleUpdateManagerAndUnits}
              onUpdatePushConfig={handleUpdatePushConfig}
              onLoadDemoData={handleLoadDemoData}
              onOpenNewEmployeeForUnit={(unitId) => {
                setNewEmployeeUnitId(unitId);
                setModalEmployeeTarget('NEW');
              }}
            />
          )}
        </main>
      </div>

      {/* BARRA DE NAVEGAÇÃO INFERIOR FIXA (BOTTOM TAB BAR COM 6 ABAS NO MOBILE < 768px) */}
      <nav className="no-print md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe">
        <div className="grid grid-cols-6 items-center h-16">
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
                <Icon className="w-4 h-4" />
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
          initialUnitId={newEmployeeUnitId}
          onClose={() => {
            setNewEmployeeUnitId(null);
            setModalEmployeeTarget(null);
          }}
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
