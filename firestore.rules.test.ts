/**
 * Adversarial Security Rules Specification Tests (Dirty Dozen Verification)
 */

export interface DirtyDozenTestCase {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'create' | 'update' | 'get' | 'list' | 'delete';
  authUid: string | null;
  emailVerified: boolean;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: DirtyDozenTestCase[] = [
  {
    id: 1,
    name: 'Identity Spoofing on Workspace Create',
    collectionPath: '/workspaces/user_A',
    operation: 'create',
    authUid: 'user_A',
    emailVerified: true,
    payload: { ownerId: 'user_B', managerName: 'Dr. Roberto' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified Email Write',
    collectionPath: '/workspaces/user_A',
    operation: 'create',
    authUid: 'user_A',
    emailVerified: false,
    payload: { ownerId: 'user_A', managerName: 'Dr. Roberto' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Shadow Field Injection on Update',
    collectionPath: '/workspaces/user_A',
    operation: 'update',
    authUid: 'user_A',
    emailVerified: true,
    payload: { ownerId: 'user_A', isAdmin: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Path Poisoning / Invalid Document ID',
    collectionPath: '/workspaces/user_A/units/invalid$$id',
    operation: 'create',
    authUid: 'user_A',
    emailVerified: true,
    payload: { ownerId: 'user_A', name: 'UTI Adulto' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Orphaned Subcollection Write Without Parent Workspace',
    collectionPath: '/workspaces/user_unprovisioned/employees/emp_1',
    operation: 'create',
    authUid: 'user_unprovisioned',
    emailVerified: true,
    payload: { ownerId: 'user_unprovisioned', name: 'Enf. Ana' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Cross-Tenant Subcollection Read',
    collectionPath: '/workspaces/user_A/employees/emp_1',
    operation: 'get',
    authUid: 'user_B',
    emailVerified: true,
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Unauthorized List Scraping',
    collectionPath: '/workspaces/user_A/absences',
    operation: 'list',
    authUid: 'user_B',
    emailVerified: true,
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Value Poisoning / Oversized String',
    collectionPath: '/workspaces/user_A',
    operation: 'update',
    authUid: 'user_A',
    emailVerified: true,
    payload: { managerName: 'A'.repeat(1000) },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Timestamp Forgery on Create',
    collectionPath: '/workspaces/user_A/absences/abs_1',
    operation: 'create',
    authUid: 'user_A',
    emailVerified: true,
    payload: { ownerId: 'user_A', createdAt: '1999-01-01T00:00:00Z' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Immutable Field Mutation on Update',
    collectionPath: '/workspaces/user_A/employees/emp_1',
    operation: 'update',
    authUid: 'user_A',
    emailVerified: true,
    payload: { ownerId: 'user_B' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Invalid Enum State Injection',
    collectionPath: '/workspaces/user_A/scheduleCells/cell_1',
    operation: 'create',
    authUid: 'user_A',
    emailVerified: true,
    payload: { ownerId: 'user_A', status: 'INVALID_STATUS' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Orphaned Absence Without Existing Employee',
    collectionPath: '/workspaces/user_A/absences/abs_1',
    operation: 'create',
    authUid: 'user_A',
    emailVerified: true,
    payload: { ownerId: 'user_A', employeeId: 'non_existent_emp' },
    expectedResult: 'PERMISSION_DENIED',
  },
];
