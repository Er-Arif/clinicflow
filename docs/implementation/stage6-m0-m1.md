# Stage 6 implementation checkpoint: M0 + M1

Completed:

- repository / backend / mobile / infrastructure scaffold
- FastAPI health endpoints
- request-ID middleware and stable error envelope
- backend-authoritative `Asia/Kolkata` Clock abstraction
- PostgreSQL/Alembic foundation
- first migration for Clinic, Doctor, User, Role, Permission, UserRole, RolePermission, AuthSession, AuditEvent, and IdempotencyRecord
- database append-only protection for audit events
- seeded ASSISTANT / DOCTOR / OWNER_ADMIN roles and permission mappings
- Argon2id password hashing
- short-lived signed access tokens
- opaque rotating refresh tokens stored only as SHA-256 hashes server-side
- login / refresh / logout / me API contracts
- permission-fresh auth context lookup
- secure mobile refresh-token storage
- single-flight token refresh
- login UI, session restore and role-based landing routes
- bootstrap script for first Clinic + Owner/Doctor account
- CI baseline

Next: M2 Patient Management vertical slice.
