# ClinicFlow Stage 6 — M10 Settings, Users & Audit

## Scope

M10 completes the V1 administration surface without introducing arbitrary per-user permissions or a second authorization model.

Implemented backend capabilities:

- Clinic settings read/update with optimistic version checks
- Doctor display settings read/update with optimistic version checks
- fixed seeded role presets: `ASSISTANT`, `DOCTOR`, `OWNER_ADMIN`
- staff user listing, creation and editing
- account enable/disable
- role assignment using seeded role presets only
- secure temporary-password reset
- immediate session revocation on account disable and credential reset
- self-service password change
- enforced `must_change_password` gate before normal business operations
- last-active-Owner/Admin lockout protection
- immutable Audit History list/detail queries with actor/action/entity/date filters
- audit redaction remains inherited from the M0 audit service

Implemented Android views:

- Settings Hub
- Clinic Settings
- Doctor Settings
- Users
- Add User
- Edit User / disable / role assignment
- Reset Password
- Change Password
- Audit History
- Audit Event Detail

## User-management rules

V1 does not expose a generic permission editor. The UI assigns one or more of the three server-defined roles. Effective permissions are derived server-side from `role_permissions` every authenticated request.

This means a role change becomes effective immediately even if the user's access token has not expired.

Account disabling and administrator credential reset additionally revoke all active refresh sessions for the target account.

ClinicFlow prevents an administrator from disabling their own account, and it prevents removing/disabling the last active `OWNER_ADMIN` in the clinic.

## Temporary-password lifecycle

An administrator creates or resets a user with a temporary password.

The target account has:

```text
must_change_password = true
```

After login, the Android app routes directly to Change Password. Permission-protected business endpoints return `PASSWORD_CHANGE_REQUIRED` until the password has been changed.

The password-change operation:

1. verifies the current password
2. enforces the V1 minimum password length
3. prevents reusing the same password
4. writes a new Argon2id hash
5. clears `must_change_password`
6. revokes the user's other active sessions
7. records a redacted audit event

No password, password hash, access token or refresh token is written to the audit log.

## Clinic and Doctor settings

Clinic settings contain only:

- clinic name
- address
- contact number

Doctor settings contain only:

- doctor display name
- professional display details

Both use `expected_version` optimistic locking so a stale mobile form cannot silently overwrite a newer administrator change.

## Audit History

Audit History remains read-only and backed by the append-only `audit_events` table created in M0.

M10 supports filters for:

- clinic-local date range
- actor user
- action type
- entity type

Detail view exposes:

- actor
- timestamp
- action
- entity/reference
- reason
- previous values
- new values
- redacted metadata
- request/correlation ID

The PostgreSQL append-only trigger still blocks `UPDATE` and `DELETE` against audit rows.

## M10 migration

Alembic revision `0010` adds:

- `users.version`
- `(clinic_id, active, display_name)` user-management index

No duplicate account, role, permission or audit tables were introduced.

## API additions

```text
POST  /api/v1/auth/change-password

GET   /api/v1/clinic/settings
PATCH /api/v1/clinic/settings
GET   /api/v1/doctors/{doctor_id}/settings
PATCH /api/v1/doctors/{doctor_id}/settings

GET   /api/v1/roles
GET   /api/v1/users
POST  /api/v1/users
GET   /api/v1/users/{user_id}
PATCH /api/v1/users/{user_id}
POST  /api/v1/users/{user_id}/reset-password

GET   /api/v1/audit-events/{audit_id}
```

The existing `GET /api/v1/audit-events` query now also accepts `entity_type` and exposes request ID / redacted metadata.

## Validation

- backend test suite: 59 tests passing
- Python compilation: passing
- OpenAPI generation: passing with all M10 routes
- Alembic offline PostgreSQL render: `0001 → 0010` passing
- mobile TS/TSX syntax transpilation: 67 implementation files, zero syntax diagnostics

Live PostgreSQL integration, session-revocation behavior against real concurrent clients, Android dependency-aware typechecking, and device UAT remain part of M11 hardening/local validation.
