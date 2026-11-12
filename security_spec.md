# EscalaPro Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Workspace Isolation**: Every `/workspaces/{userId}` document can only be created, read, or updated by an authenticated user with `request.auth.uid == userId`, `request.auth.token.email_verified == true`, and `data.ownerId == request.auth.uid`.
2. **Master Gate Relational Sync**: Every subcollection document (`units`, `employees`, `absences`, `scheduleCells`) under `/workspaces/{userId}` requires that the parent `/workspaces/{userId}` document exists and its `ownerId == request.auth.uid`.
3. **Immutable Ownership & Creation Timestamp**: `ownerId` and `createdAt` can never be modified during `update` operations (`incoming().ownerId == existing().ownerId && incoming().createdAt == existing().createdAt`).
4. **Server-Authoritative Timestamps**: On `create`, `createdAt == request.time && updatedAt == request.time`. On `update`, `updatedAt == request.time`.
5. **Strict Key Allowlisting & Size Bounds**: Every `create` enforces `hasAll` and `hasOnly` for allowed keys, and every `update` enforces `affectedKeys().hasOnly(...)` wrapped by `isValid[Entity](incoming())`. Every string is strictly bounded by `.size()` and IDs match `^[a-zA-Z0-9_\-]+$`.
6. **Secure List Queries**: Every `allow list` rule validates `resource.data.ownerId == request.auth.uid` without calling `get()` or `exists()` inside `allow list`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Payload 1 (Identity Spoofing on Workspace Create)**: Authenticated user `user_A` attempts to create `/workspaces/user_A` with `ownerId: "user_B"`. -> `PERMISSION_DENIED`
2. **Payload 2 (Unverified Email Write)**: Authenticated user with `email_verified: false` attempts to create `/workspaces/user_A`. -> `PERMISSION_DENIED`
3. **Payload 3 (Shadow Field Injection on Update)**: Owner updates `/workspaces/user_A` adding undeclared field `isAdmin: true`. -> `PERMISSION_DENIED`
4. **Payload 4 (Path Poisoning / Overlong Document ID)**: Owner attempts to create `/workspaces/user_A/units/invalid$$id!!` with invalid characters. -> `PERMISSION_DENIED`
5. **Payload 5 (Orphaned Subcollection Write)**: User attempts to create `/workspaces/user_A/employees/emp_1` when `/workspaces/user_A` does not exist. -> `PERMISSION_DENIED`
6. **Payload 6 (Cross-Tenant Subcollection Read)**: Authenticated user `user_B` attempts `get` on `/workspaces/user_A/employees/emp_1`. -> `PERMISSION_DENIED`
7. **Payload 7 (Unauthorized List Scraping)**: Authenticated user `user_B` attempts `list` on `/workspaces/user_A/absences` without matching `resource.data.ownerId == request.auth.uid`. -> `PERMISSION_DENIED`
8. **Payload 8 (Value Poisoning / Oversized String)**: Owner attempts to update `managerName` in `/workspaces/user_A` with a 10,000-character string (`> 120`). -> `PERMISSION_DENIED`
9. **Payload 9 (Timestamp Forgery on Create)**: Owner attempts to create `/workspaces/user_A/absences/abs_1` with a past client timestamp (`createdAt != request.time`). -> `PERMISSION_DENIED`
10. **Payload 10 (Immutable Field Mutation on Update)**: Owner attempts to mutate `createdAt` or `ownerId` on an existing `/workspaces/user_A/employees/emp_1` document. -> `PERMISSION_DENIED`
11. **Payload 11 (Invalid Enum State Injection)**: Owner attempts to create `/workspaces/user_A/scheduleCells/cell_1` with `status: "HACKED"` (not in `['D','N','F','AT','FA','FE','TR']`). -> `PERMISSION_DENIED`
12. **Payload 12 (Orphaned Absence Without Existing Employee)**: Owner attempts to create `/workspaces/user_A/absences/abs_1` referencing a non-existent `employeeId`. -> `PERMISSION_DENIED`
