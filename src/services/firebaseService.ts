import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
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
} from '../types';
import {
  computeRegimeShiftForDay,
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
  try {
    await sendEmailVerification(credential.user);
  } catch (err) {
    console.warn('Aviso ao enviar e-mail de verificação inicial:', err);
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

export function subscribeToFirebaseAuth(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

/**
 * Carrega o espaço de trabalho completo do usuário autenticado no Firestore.
 * Retorna null caso o usuário ainda não possua um documento em `/workspaces/{userId}` ou ainda não tenha confirmado o e-mail.
 */
export async function loadWorkspaceFromFirestore(userId: string): Promise<EscalaProState | null> {
  if (!auth.currentUser || auth.currentUser.uid !== userId || !auth.currentUser.emailVerified) {
    return null;
  }

  const safeUid = sanitizeId(userId);
  const workspacePath = `workspaces/${safeUid}`;
  let workspaceSnap;
  try {
    workspaceSnap = await getDoc(doc(db, 'workspaces', safeUid));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, workspacePath);
  }

  if (!workspaceSnap || !workspaceSnap.exists()) {
    return null;
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
          ? 'HORA_EXTRA'
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
        extraHours: d.extraHours ? Number(d.extraHours) : undefined,
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

  return {
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
  };
}

/**
 * Sincroniza o estado completo do usuário para o Firestore respeitando rigorosamente o schema e regras.
 * Retorna true se a gravação na nuvem foi realizada, ou false se foi ignorada (ex: e-mail não verificado ou onboarding pendente).
 */
export async function syncWorkspaceToFirestore(userId: string, state: EscalaProState): Promise<boolean> {
  if (
    !auth.currentUser ||
    auth.currentUser.uid !== userId ||
    !auth.currentUser.emailVerified ||
    !state.manager.onboardingCompleted
  ) {
    return false;
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

  // Sincroniza Unidades
  for (const unit of state.units) {
    const unitId = sanitizeId(unit.id);
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

  // Sincroniza Colaboradores e seus Afastamentos
  const fallbackUnitId = sanitizeId(state.units[0]?.id || 'unit-1');
  for (const emp of state.employees) {
    const empId = sanitizeId(emp.id);
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
