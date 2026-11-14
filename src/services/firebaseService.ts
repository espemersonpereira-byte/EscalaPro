import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  GoogleAuthProvider,
  linkWithPopup,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  AbsenceRecord,
  Employee,
  EscalaProState,
  HospitalUnit,
  MonthlyScheduleMap,
  ScheduleCellData,
  ShiftStatus,
  UserAccount,
} from '../types';
import {
  computeRegimeShiftForDay,
  deduplicateEscalaProState,
  reapplyEmployeeHistoryToSchedules,
} from './storageService';

const app = initializeApp(firebaseConfig);
export const db = getFirestoreInstance();
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn('Aviso ao configurar persistência local do Firebase Auth:', err);
});

import { getFirestore } from 'firebase/firestore';
function getFirestoreInstance() {
  return getFirestore(app, firebaseConfig.firestoreDatabaseId);
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate connection to Firestore on boot as required
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

function sanitizeId(rawId: string): string {
  const cleaned = String(rawId || 'item')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 128);
  return cleaned.length > 0 ? cleaned : 'item_1';
}

function clampString(val: string | undefined | null, minLen: number, maxLen: number, fallback: string): string {
  const trimmed = String(val ?? '').trim();
  const base = trimmed.length >= minLen ? trimmed : fallback;
  return base.slice(0, maxLen);
}

export async function signInWithGooglePopup(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function registerWithFirebaseEmail(params: {
  name: string;
  email: string;
  password: string;
}): Promise<User> {
  const credential = await createUserWithEmailAndPassword(
    auth,
    params.email.trim().toLowerCase(),
    params.password
  );
  if (params.name.trim()) {
    await updateProfile(credential.user, {
      displayName: params.name.trim(),
    }).catch((err) => console.warn('Aviso ao definir displayName:', err));
  }
  return credential.user;
}

export async function loginWithFirebaseEmail(email: string, password: string): Promise<User> {
  const credential = await signInWithEmailAndPassword(
    auth,
    email.trim().toLowerCase(),
    password
  );
  try {
    await credential.user.reload();
  } catch (err) {
    console.warn('Aviso ao atualizar status do usuário:', err);
  }
  return auth.currentUser || credential.user;
}

export async function resendVerificationEmail(): Promise<void> {
  if (!auth.currentUser) {
    throw new Error('Nenhuma conta autenticada no momento.');
  }
  await sendEmailVerification(auth.currentUser);
}

export async function refreshCurrentFirebaseUser(): Promise<User | null> {
  if (!auth.currentUser) return null;
  await auth.currentUser.reload();
  await auth.currentUser.getIdToken(true);
  return auth.currentUser;
}

export async function sendFirebasePasswordReset(email: string): Promise<void> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) {
    throw new Error('Digite seu e-mail para receber o link de redefinição de senha.');
  }
  await sendPasswordResetEmail(auth, cleanEmail);
}

export async function linkGoogleToCurrentAccount(): Promise<User> {
  if (!auth.currentUser) {
    throw new Error('Faça login primeiro para vincular sua conta Google.');
  }
  const result = await linkWithPopup(auth.currentUser, googleProvider);
  await result.user.reload();
  return auth.currentUser || result.user;
}

export async function signOutFirebase(): Promise<void> {
  try {
    await signOut(auth);
  } catch (err) {
    console.error('Erro ao encerrar sessão Firebase:', err);
  }
}

export async function deleteUserAccountFromCloud(
  userId: string,
  email?: string
): Promise<void> {
  const cleanEmail = (email || auth.currentUser?.email || '').trim().toLowerCase();

  // 1. Apaga do espelho de sincronização no servidor
  try {
    await fetch('/api/cloud-sync/delete-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: cleanEmail,
        uid: userId || auth.currentUser?.uid,
      }),
    });
  } catch (err) {
    console.warn('Aviso ao remover conta do espelho em nuvem:', err);
  }

  // 2. Apaga coleções do Firestore caso o usuário esteja autenticado no Firebase
  if (auth.currentUser) {
    const safeUid = sanitizeId(auth.currentUser.uid);
    const subcollections = ['units', 'employees', 'absences', 'scheduleCells'];
    for (const sub of subcollections) {
      try {
        const q = query(
          collection(db, 'workspaces', safeUid, sub),
          where('ownerId', '==', safeUid)
        );
        const snap = await getDocs(q);
        for (const d of snap.docs) {
          await deleteDoc(doc(db, 'workspaces', safeUid, sub, d.id));
        }
      } catch {
        // Continua limpeza
      }
    }
    try {
      await deleteDoc(doc(db, 'workspaces', safeUid));
    } catch {
      // Continua
    }
    try {
      await deleteDoc(doc(db, 'users', safeUid));
    } catch {
      // Continua
    }

    // 3. Remove o usuário do Firebase Auth (ou encerra a sessão caso exija reautenticação recente)
    try {
      await deleteUser(auth.currentUser);
    } catch {
      try {
        await signOut(auth);
      } catch {
        // Ignora
      }
    }
  }
}

export function subscribeToFirebaseAuth(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

export async function pushWorkspaceToCloudMirror(params: {
  email: string;
  uid: string;
  state: EscalaProState;
  account?: Partial<UserAccount>;
  passwordHash?: string;
}): Promise<EscalaProState | null> {
  const cleanEmail = (params.email || '').trim().toLowerCase();
  if (!cleanEmail) return null;
  try {
    const res = await fetch('/api/cloud-sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: cleanEmail,
        uid: params.uid,
        passwordHash: params.passwordHash,
        account: params.account,
        state: params.state,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok?: boolean;
      state?: EscalaProState;
    };
    return data.ok && data.state ? data.state : null;
  } catch {
    return null;
  }
}

export async function pullWorkspaceFromCloudMirror(
  email?: string,
  uid?: string
): Promise<{ account?: UserAccount; state?: EscalaProState } | null> {
  const cleanEmail = (email || auth.currentUser?.email || '').trim().toLowerCase();
  if (!cleanEmail && !uid) return null;
  try {
    const res = await fetch('/api/cloud-sync/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: cleanEmail,
        uid: uid || auth.currentUser?.uid,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok?: boolean;
      found?: boolean;
      account?: UserAccount;
      state?: EscalaProState;
    };
    if (data.ok && data.found && data.state) {
      return {
        account: data.account,
        state: data.state,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function loginViaCloudMirror(params: {
  email: string;
  passwordHash?: string;
  name?: string;
}): Promise<{ found: boolean; account: UserAccount; state: EscalaProState } | null> {
  const cleanEmail = (params.email || '').trim().toLowerCase();
  if (!cleanEmail) return null;
  try {
    const res = await fetch('/api/cloud-sync/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: cleanEmail,
        passwordHash: params.passwordHash || '',
        name: params.name || '',
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ok?: boolean;
      found?: boolean;
      account?: UserAccount;
      state?: EscalaProState;
    };
    if (data.ok && data.account && data.state) {
      return {
        found: Boolean(data.found),
        account: data.account,
        state: data.state,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function mergeTwoEscalaProStates(
  baseStateRaw: EscalaProState,
  otherStateRaw: EscalaProState
): EscalaProState {
  const baseState = deduplicateEscalaProState(baseStateRaw);
  const otherState = deduplicateEscalaProState(otherStateRaw);

  const baseEmpCount = Array.isArray(baseState.employees) ? baseState.employees.length : 0;
  const otherEmpCount = Array.isArray(otherState.employees) ? otherState.employees.length : 0;
  const baseTime = new Date(baseState.lastUpdated || 0).getTime();
  const otherTime = new Date(otherState.lastUpdated || 0).getTime();

  const preferOther =
    otherEmpCount > 0 && baseEmpCount === 0
      ? true
      : baseEmpCount > 0 && otherEmpCount === 0
      ? false
      : otherTime >= baseTime;

  const primary = preferOther ? otherState : baseState;
  const secondary = preferOther ? baseState : otherState;

  const isGenericHospital = (h?: string) =>
    !h || !h.trim() || h.trim() === 'Instituição' || h.trim() === 'Hospital / Instituição';

  const primaryOnlyHasDefaultPlaceholder =
    !primary.units ||
    primary.units.length === 0 ||
    (primary.units.length === 1 && primary.units[0].id === 'unit-default-1');

  // Respeita exclusões de setores feitas no estado mais recente (primary): só herda setores de secondary se primary estiver vazio/placeholder
  const chosenUnits =
    !primaryOnlyHasDefaultPlaceholder
      ? primary.units
      : secondary.units && secondary.units.length > 0
      ? secondary.units
      : primary.units;

  // Para colaboradores, se primary já possui colaboradores cadastrados, usa primary como base e mescla históricos pelo nome (via deduplicateEscalaProState)
  const combinedEmployees =
    primary.employees && primary.employees.length > 0
      ? [...primary.employees, ...(secondary.employees || [])]
      : [...(secondary.employees || []), ...(primary.employees || [])];

  const mergedSchedules: MonthlyScheduleMap = {};
  const allYmKeys = new Set([
    ...Object.keys(secondary.schedules || {}),
    ...Object.keys(primary.schedules || {}),
  ]);
  for (const ym of allYmKeys) {
    mergedSchedules[ym] = {};
    const secYm = secondary.schedules?.[ym] || {};
    const priYm = primary.schedules?.[ym] || {};
    const allEmpIds = new Set([...Object.keys(secYm), ...Object.keys(priYm)]);
    for (const empId of allEmpIds) {
      const secDays = secYm[empId] || {};
      const priDays = priYm[empId] || {};
      const mergedDays: Record<number, ScheduleCellData> = {
        ...secDays,
        ...priDays,
      };
      for (const [dKey, secCell] of Object.entries(secDays)) {
        const dNum = Number(dKey);
        const priCell = priDays[dNum];
        if (
          !priCell &&
          (secCell.note || secCell.unitOverrideId !== undefined || secCell.extraHours)
        ) {
          mergedDays[dNum] = secCell;
        }
      }
      mergedSchedules[ym][empId] = mergedDays;
    }
  }

  const customRolesSet = new Set<string>([
    ...(secondary.customRoles || []),
    ...(primary.customRoles || []),
  ]);

  return deduplicateEscalaProState({
    ...primary,
    manager: {
      ...secondary.manager,
      ...primary.manager,
      name: primary.manager.name || secondary.manager.name || '',
      hospitalName: !isGenericHospital(primary.manager.hospitalName)
        ? primary.manager.hospitalName
        : secondary.manager.hospitalName || primary.manager.hospitalName || '',
      role: primary.manager.role || secondary.manager.role || '',
      sectorName:
        primary.manager.sectorName && primary.manager.sectorName !== 'Geral'
          ? primary.manager.sectorName
          : secondary.manager.sectorName || primary.manager.sectorName || '',
      avatarBase64: primary.manager.avatarBase64 || secondary.manager.avatarBase64 || '',
      onboardingCompleted: Boolean(
        primary.manager.onboardingCompleted || secondary.manager.onboardingCompleted
      ),
    },
    units: chosenUnits,
    customRoles: Array.from(customRolesSet),
    employees: combinedEmployees,
    schedules: mergedSchedules,
    lastUpdated: new Date(Math.max(baseTime, otherTime, Date.now())).toISOString(),
  });
}

/**
 * Carrega o espaço de trabalho completo do usuário autenticado no Firestore e no espelho de nuvem por e-mail.
 */
export async function loadWorkspaceFromFirestore(
  userId: string,
  email?: string
): Promise<EscalaProState | null> {
  const mirrorResult = await pullWorkspaceFromCloudMirror(email, userId);
  const mirrorState = mirrorResult?.state
    ? deduplicateEscalaProState(mirrorResult.state)
    : null;

  if (!auth.currentUser || auth.currentUser.uid !== userId) {
    return mirrorState;
  }

  const safeUid = sanitizeId(userId);
  const workspacePath = `workspaces/${safeUid}`;
  let workspaceSnap;
  try {
    workspaceSnap = await getDoc(doc(db, 'workspaces', safeUid));
  } catch (error) {
    console.warn('Aviso ao consultar Firestore, usando espelho em nuvem:', error);
    return mirrorState;
  }

  if (!workspaceSnap || !workspaceSnap.exists()) {
    return mirrorState;
  }

  const wsData = workspaceSnap.data();

  // 1. Unidades
  const unitsPath = `workspaces/${safeUid}/units`;
  const units: HospitalUnit[] = [];
  try {
    const qUnits = query(collection(db, 'workspaces', safeUid, 'units'), where('ownerId', '==', safeUid));
    const unitsSnap = await getDocs(qUnits);
    unitsSnap.forEach((docSnap) => {
      const d = docSnap.data();
      units.push({
        id: docSnap.id,
        name: String(d.name || 'Unidade Principal'),
        shiftMode: (d.shiftMode as HospitalUnit['shiftMode']) || '24H',
        minStaffDay: Number(d.minStaffDay ?? 2),
        minStaffNight: Number(d.minStaffNight ?? 1),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, unitsPath);
  }

  // 2. Afastamentos / Atestados / Ocorrências
  const absencesPath = `workspaces/${safeUid}/absences`;
  const absencesByEmployee: Record<string, AbsenceRecord[]> = {};
  try {
    const qAbs = query(collection(db, 'workspaces', safeUid, 'absences'), where('ownerId', '==', safeUid));
    const absSnap = await getDocs(qAbs);
    absSnap.forEach((docSnap) => {
      const d = docSnap.data();
      const empId = String(d.employeeId || '');
      const mappedType: AbsenceRecord['type'] =
        d.type === 'PERMUTA'
          ? 'TROCA'
          : d.type === 'BANCO_HORAS'
          ? String(d.reason || '').toLowerCase().includes('folga bh') ||
            String(d.reason || '').toLowerCase().includes('descont')
            ? 'BANCO_HORAS'
            : 'HORA_EXTRA'
          : (d.type as AbsenceRecord['type']) || 'ATESTADO';

      const rec: AbsenceRecord = {
        id: docSnap.id,
        employeeId: empId,
        type: mappedType,
        startDate: String(d.startDate || ''),
        endDate: d.endDate ? String(d.endDate) : undefined,
        nextShiftDate: d.nextShiftDate ? String(d.nextShiftDate) : undefined,
        daysCount: Number(d.daysCount || 1),
        reason: String(d.reason || ''),
        cid: d.cid ? String(d.cid) : undefined,
        createdAt: new Date().toISOString(),
      };
      if (!absencesByEmployee[empId]) {
        absencesByEmployee[empId] = [];
      }
      absencesByEmployee[empId].push(rec);
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, absencesPath);
  }

  // 3. Colaboradores
  const employeesPath = `workspaces/${safeUid}/employees`;
  const employees: Employee[] = [];
  try {
    const qEmp = query(collection(db, 'workspaces', safeUid, 'employees'), where('ownerId', '==', safeUid));
    const empSnap = await getDocs(qEmp);
    empSnap.forEach((docSnap) => {
      const d = docSnap.data();
      employees.push({
        id: docSnap.id,
        name: String(d.name || 'Colaborador'),
        role: String(d.role || 'Farmacêutico'),
        registrationNumber: String(d.registrationId || ''),
        unitId: String(d.unitId || units[0]?.id || 'unit-1'),
        defaultShift: d.defaultShift === 'Noturno' ? 'Noturno' : 'Diurno',
        workHours: String(d.workHours || '07:00 às 19:00'),
        regime: (d.regime as Employee['regime']) || '12x36_ODD',
        hourBankBalance: Number(d.hourBankBalance || 0),
        active: d.active !== false,
        history: absencesByEmployee[docSnap.id] || [],
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, employeesPath);
  }

  // 4. Células da Escala Mensal
  const cellsPath = `workspaces/${safeUid}/scheduleCells`;
  const schedules: MonthlyScheduleMap = {};
  try {
    const qCells = query(
      collection(db, 'workspaces', safeUid, 'scheduleCells'),
      where('ownerId', '==', safeUid)
    );
    const cellsSnap = await getDocs(qCells);
    cellsSnap.forEach((docSnap) => {
      const d = docSnap.data();
      const ym = String(d.yearMonth || '');
      const empId = String(d.employeeId || '');
      const dayNum = Number(d.day || 1);
      if (!ym || !empId) return;
      if (!schedules[ym]) schedules[ym] = {};
      if (!schedules[ym][empId]) schedules[ym][empId] = {};
      const rawUnitOverride = d.unitOverrideId ? String(d.unitOverrideId).trim() : '';
      const cell: ScheduleCellData = {
        status: (d.status as ShiftStatus) || 'D',
        note: d.note ? String(d.note) : undefined,
        extraHours:
          d.extraHours !== undefined && d.extraHours !== null && Number(d.extraHours) !== 0
            ? Number(d.extraHours)
            : undefined,
        unitOverrideId: rawUnitOverride.length > 0 ? rawUnitOverride : undefined,
      };
      schedules[ym][empId][dayNum] = cell;
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, cellsPath);
  }

  const finalSchedules = reapplyEmployeeHistoryToSchedules(employees, schedules);
  const remoteUpdatedIso =
    wsData.updatedAt && typeof wsData.updatedAt.toDate === 'function'
      ? wsData.updatedAt.toDate().toISOString()
      : new Date(0).toISOString();

  const firestoreState = deduplicateEscalaProState({
    manager: {
      name: String(wsData.managerName || ''),
      hospitalName: String(wsData.hospitalName || ''),
      role: String(wsData.managerRole || ''),
      sectorName: String(wsData.sectorName || ''),
      avatarBase64: '',
      onboardingCompleted: Boolean(wsData.onboardingCompleted),
    },
    units,
    customRoles: [],
    employees,
    schedules: finalSchedules,
    pushConfig: {
      enabled: Boolean(wsData.pushEnabled),
      alertUncoveredShift1hBefore: true,
      dailySummaryAt0630: true,
      instantCertificateAlert: true,
      webhookOrVapidKey: '',
    },
    lastUpdated: remoteUpdatedIso,
  });

  if (mirrorState) {
    return mergeTwoEscalaProStates(firestoreState, mirrorState);
  }
  return firestoreState;
}

/**
 * Sincroniza o estado completo do usuário para o Firestore e para o espelho em nuvem por e-mail.
 */
export async function syncWorkspaceToFirestore(
  userId: string,
  rawState: EscalaProState,
  accountEmail?: string,
  accountObj?: Partial<UserAccount>
): Promise<boolean> {
  const state = deduplicateEscalaProState(rawState);
  const emailToSync = (accountEmail || accountObj?.email || auth.currentUser?.email || '')
    .trim()
    .toLowerCase();

  let syncedMirror = false;
  if (
    emailToSync &&
    (state.manager.onboardingCompleted ||
      state.employees.length > 0 ||
      state.units.length > 0)
  ) {
    const mirrorRes = await pushWorkspaceToCloudMirror({
      email: emailToSync,
      uid: userId,
      state,
      account: accountObj,
    });
    if (mirrorRes) {
      syncedMirror = true;
    }
  }

  if (
    !auth.currentUser ||
    auth.currentUser.uid !== userId ||
    !state.manager.onboardingCompleted
  ) {
    return syncedMirror;
  }

  const safeUid = sanitizeId(userId);
  const wsRef = doc(db, 'workspaces', safeUid);
  const wsPath = `workspaces/${safeUid}`;

  let existingWsSnap;
  try {
    existingWsSnap = await getDoc(wsRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, wsPath);
  }

  const wsPayload = {
    ownerId: safeUid,
    managerName: clampString(state.manager.name, 1, 120, 'Gestor(a)'),
    managerRole: clampString(state.manager.role, 1, 100, 'Gestor(a)'),
    sectorName: clampString(state.manager.sectorName, 1, 100, 'Geral'),
    hospitalName: clampString(state.manager.hospitalName, 1, 150, 'Instituição'),
    onboardingCompleted: Boolean(state.manager.onboardingCompleted),
    pushEnabled: Boolean(state.pushConfig.enabled),
    pushTime: '06:30',
    createdAt: existingWsSnap?.exists() ? existingWsSnap.data().createdAt : serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(wsRef, wsPayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, wsPath);
  }

  // 1. Sincroniza Unidades Atuais
  const activeUnitDocIds = new Set<string>();
  for (const unit of state.units) {
    const unitId = sanitizeId(unit.id);
    activeUnitDocIds.add(unitId);
    const unitRef = doc(db, 'workspaces', safeUid, 'units', unitId);
    const unitPath = `workspaces/${safeUid}/units/${unitId}`;
    let existingUnit;
    try {
      existingUnit = await getDoc(unitRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, unitPath);
    }

    const unitPayload = {
      ownerId: safeUid,
      name: clampString(unit.name, 1, 100, 'Unidade Hospitalar'),
      shiftMode:
        unit.shiftMode === 'DIURNO' || unit.shiftMode === 'NOTURNO' ? unit.shiftMode : '24H',
      minStaffDay: Math.max(0, Math.min(500, Math.round(Number(unit.minStaffDay) || 0))),
      minStaffNight: Math.max(0, Math.min(500, Math.round(Number(unit.minStaffNight) || 0))),
      createdAt: existingUnit?.exists() ? existingUnit.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      await setDoc(unitRef, unitPayload);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, unitPath);
    }
  }

  // 2. Sincroniza Colaboradores e seus Afastamentos
  const activeEmpDocIds = new Set<string>();
  const fallbackUnitId = sanitizeId(state.units[0]?.id || 'unit-1');
  for (const emp of state.employees) {
    const empId = sanitizeId(emp.id);
    activeEmpDocIds.add(empId);
    const empRef = doc(db, 'workspaces', safeUid, 'employees', empId);
    const empPath = `workspaces/${safeUid}/employees/${empId}`;
    let existingEmp;
    try {
      existingEmp = await getDoc(empRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, empPath);
    }

    const validUnitId = state.units.some((u) => sanitizeId(u.id) === sanitizeId(emp.unitId))
      ? sanitizeId(emp.unitId)
      : fallbackUnitId;

    const empPayload = {
      ownerId: safeUid,
      name: clampString(emp.name, 1, 140, 'Colaborador'),
      role: clampString(emp.role, 1, 100, 'Profissional'),
      registrationId: clampString(emp.registrationNumber, 0, 60, ''),
      unitId: validUnitId,
      defaultShift: emp.defaultShift === 'Noturno' ? 'Noturno' : 'Diurno',
      workHours: clampString(emp.workHours, 1, 40, '07:00 às 19:00'),
      regime: clampString(emp.regime, 1, 40, '12x36_ODD'),
      active: Boolean(emp.active),
      phone: '',
      preferredOffDay: 0,
      hourBankBalance: Math.max(-10000, Math.min(10000, Number(emp.hourBankBalance) || 0)),
      createdAt: existingEmp?.exists() ? existingEmp.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      await setDoc(empRef, empPayload);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, empPath);
    }

    for (const rec of emp.history || []) {
      const absId = sanitizeId(rec.id);
      const absRef = doc(db, 'workspaces', safeUid, 'absences', absId);
      const absPath = `workspaces/${safeUid}/absences/${absId}`;
      let existingAbs;
      try {
        existingAbs = await getDoc(absRef);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, absPath);
      }

      const mappedType =
        rec.type === 'TROCA'
          ? 'PERMUTA'
          : rec.type === 'HORA_EXTRA'
          ? 'BANCO_HORAS'
          : rec.type;

      const absPayload = {
        ownerId: safeUid,
        employeeId: empId,
        type: mappedType,
        startDate: clampString(rec.startDate, 8, 20, '2026-01-01'),
        endDate: clampString(rec.endDate || rec.startDate, 8, 20, rec.startDate || '2026-01-01'),
        daysCount: Math.max(1, Math.min(365, Math.round(Number(rec.daysCount) || 1))),
        nextShiftDate: clampString(rec.nextShiftDate || '', 0, 20, ''),
        reason: clampString(rec.reason, 1, 500, 'Registro lançado no sistema'),
        cid: clampString(rec.cid || '', 0, 30, ''),
        createdAt: existingAbs?.exists() ? existingAbs.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      try {
        await setDoc(absRef, absPayload);
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, absPath);
      }
    }
  }

  // 3. Remove do Firestore colaboradores e setores (unidades) que foram excluídos ou desduplicados pelo usuário
  try {
    const qExistingEmps = query(
      collection(db, 'workspaces', safeUid, 'employees'),
      where('ownerId', '==', safeUid)
    );
    const existingEmpsSnap = await getDocs(qExistingEmps);
    for (const docSnap of existingEmpsSnap.docs) {
      if (!activeEmpDocIds.has(docSnap.id)) {
        await deleteDoc(doc(db, 'workspaces', safeUid, 'employees', docSnap.id));
      }
    }
  } catch (err) {
    console.warn('Aviso ao limpar colaboradores duplicados/excluídos no Firestore:', err);
  }

  try {
    const qExistingUnits = query(
      collection(db, 'workspaces', safeUid, 'units'),
      where('ownerId', '==', safeUid)
    );
    const existingUnitsSnap = await getDocs(qExistingUnits);
    for (const docSnap of existingUnitsSnap.docs) {
      if (!activeUnitDocIds.has(docSnap.id)) {
        await deleteDoc(doc(db, 'workspaces', safeUid, 'units', docSnap.id));
      }
    }
  } catch (err) {
    console.warn('Aviso ao limpar setores duplicados/excluídos no Firestore:', err);
  }

  // Sincroniza células customizadas (qualquer alteração manual de Folga F, D, N, AT, FA, FE, TR, setor pontual, nota ou hora extra)
  for (const [ymKey, empScheduleMap] of Object.entries(state.schedules)) {
    const [yStr, mStr] = ymKey.split('-');
    const yNum = Number(yStr) || new Date().getFullYear();
    const m0 = (Number(mStr) || 1) - 1;

    for (const [rawEmpId, daysMap] of Object.entries(empScheduleMap)) {
      const empId = sanitizeId(rawEmpId);
      const empObj = state.employees.find((e) => sanitizeId(e.id) === empId);
      if (!empObj) continue;

      for (const [dayStr, cell] of Object.entries(daysMap)) {
        const dayNum = Number(dayStr);
        const defaultRegimeStatus = computeRegimeShiftForDay(empObj, yNum, m0, dayNum);
        if (
          cell.status !== defaultRegimeStatus ||
          cell.status === 'BH' ||
          cell.status === 'AT' ||
          cell.status === 'FA' ||
          cell.status === 'FE' ||
          cell.status === 'TR' ||
          cell.note ||
          cell.extraHours ||
          cell.unitOverrideId !== undefined
        ) {
          const cellId = sanitizeId(`${ymKey}_${empId}_${dayNum}`);
          const cellRef = doc(db, 'workspaces', safeUid, 'scheduleCells', cellId);
          const cellPath = `workspaces/${safeUid}/scheduleCells/${cellId}`;
          let existingCell;
          try {
            existingCell = await getDoc(cellRef);
          } catch (error) {
            handleFirestoreError(error, OperationType.GET, cellPath);
          }

          const cleanUnitOverride =
            cell.unitOverrideId && cell.unitOverrideId.trim().length > 0
              ? sanitizeId(cell.unitOverrideId)
              : '';

          const cellPayload = {
            ownerId: safeUid,
            yearMonth: clampString(ymKey, 7, 10, '2026-11'),
            employeeId: empId,
            day: Math.max(1, Math.min(31, dayNum)),
            status: cell.status,
            note: clampString(cell.note || '', 0, 300, ''),
            extraHours: Math.max(-24, Math.min(24, Number(cell.extraHours) || 0)),
            unitOverrideId: cleanUnitOverride,
            createdAt: existingCell?.exists() ? existingCell.data().createdAt : serverTimestamp(),
            updatedAt: serverTimestamp(),
          };

          try {
            await setDoc(cellRef, cellPayload);
          } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, cellPath);
          }
        }
      }
    }
  }
  return true;
}
