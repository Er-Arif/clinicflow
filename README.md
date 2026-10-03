# ClinicFlow

ClinicFlow V1 is an Android-first clinic practice-management application for appointments, payments and follow-ups.

This repository begins Stage 6 implementation against the frozen Stage 1–5 baselines.

## Stack

- Mobile: React Native + Expo + TypeScript
- Backend: FastAPI + SQLAlchemy 2 + Alembic
- Database: PostgreSQL
- Infrastructure: Docker Compose

## Repository

```text
clinicflow/
├── backend/
├── mobile/
├── infra/
├── docs/
├── scripts/
└── .github/
```

## Stage 6 foundation quick start

1. Copy `backend/.env.example` to `backend/.env`.
2. Start PostgreSQL and backend:

```bash
docker compose -f infra/docker-compose.yml up --build
```

3. Run the first migration and bootstrap the Owner/Doctor account:

```bash
docker compose -f infra/docker-compose.yml run --rm backend alembic upgrade head
docker compose -f infra/docker-compose.yml run --rm backend python -m scripts.bootstrap_owner --clinic-name "Clinic Name" --owner-name "Doctor Name" --login owner
```

4. Check:

```text
GET http://localhost:8000/health/live
GET http://localhost:8000/health/ready
```

5. Mobile dependencies are installed separately from `mobile/` using Node 22+.

## Engineering rules

- PostgreSQL is the source of truth.
- Business dates come from the backend clinic clock, not device time.
- Every state-changing operation will be server-authorized.
- Audit and idempotency are cross-cutting foundations, not retrofit features.
- No clinical/EMR fields belong in V1.

## Implemented checkpoint

M0/M1 foundation includes health checks, request IDs, backend clinic clock, PostgreSQL/Alembic, append-only audit foundation, idempotency foundation, Clinic/User/Doctor/RBAC schema, Argon2id passwords, access + rotating refresh sessions, `/api/v1/auth/*`, secure mobile refresh-token storage, single-flight refresh handling, login/session restore routes, and role-based landing placeholders.

M2 Patient Management adds governed patient codes, E.164 Indian mobile normalization, shared-family-number duplicate warnings, DOB/approximate-age rules, optimistic edits, patient audit events, `/api/v1/patients`, and the Patient Search / New Patient / Patient Profile / Edit Patient Android screens.

M3 Scheduling / Fees / Availability adds effective-dated weekly schedules, session definitions, lazy `SessionOccurrence` materialization, slot generation and capacity validation, date-specific session blocking, effective-dated regular/follow-up fees, doctor lookup, availability APIs, Owner schedule/fee screens, and the Assistant availability browser.

M4 Appointment Engine adds transactional appointment booking, occurrence locking, occupancy-aware availability, capacity/double-book override, booking-time fee snapshots, immutable fee-adjustment history, idempotent create/reschedule, cancellation/no-show, history-preserving rescheduling, PostgreSQL slot-guard protection, and the New Appointment / Review / Booked / Appointments / Details / Reschedule Android flows.

M5 Check-in / Walk-ins / Visits adds the Visit entity, same-day idempotent check-in, walk-in Add & Check In without fake slots, one-Visit-per-Appointment enforcement, ACTIVE/ABORTED attendance states, PENDING payment-obligation creation, checked-in cancellation/rescheduling semantics, fee-to-pending-payment synchronization, real Doctor Today lists, and the Android Walk-in workflow.

M6 Payments / UPI / Receipts completes the financial workflow with payment worklists, idempotent CASH/UPI confirmation, clinic UPI configuration, backend-generated dynamic UPI intents, governed annual `RCT-YYYY-NNNNNN` receipt numbering, immutable digital receipt snapshots, controlled VOID/correction history, and the Android Payment / UPI QR / Receipt / UPI Settings screens.

M7 Visit Completion / Follow-ups adds atomic Visit/Appointment completion, completion with payment still pending, OPEN/BOOKED/CLOSED Follow-up Recommendations, due-date/interval tracking, dedicated follow-up booking, cancellation/no-show reopening, reschedule relinking, follow-up chains, and the Android Complete Visit / Follow-ups / Follow-up Details / Book Follow-up workflows.

M8 Messaging / WhatsApp / Reminders adds bilingual English/Hindi operational templates, one-shot appointment and follow-up reminders, the >24-hour appointment-reminder rule, lifecycle-driven reminder invalidation, blocked-session suppression, server-rendered WhatsApp click-to-chat payloads, Assistant Mark Sent / Skip tracking, temporary per-message language switching, Owner message-template editing, and the Android Reminders / Message Preview flows.


M9 Operational Views / Reporting replaces the remaining dashboard placeholders with read-only projections derived from transactional facts: live Assistant Home metrics/attention counts, Doctor Today, Doctor patient operational summaries and completed visit history, Owner Dashboard, appointment/patient/follow-up/payment reports, audit-query foundation, reporting-cache invalidation, and dedicated PostgreSQL reporting indexes. No duplicate reporting ledger or cached revenue source was introduced.


M10 Settings / Users / Audit completes the Owner administration surface with optimistic Clinic/Doctor settings, fixed role-preset user management, account disable/session revocation, secure temporary-password reset, enforced first-login password change, last-Owner lockout protection, consolidated Settings Hub, and read-only Audit History/detail filters.

M11 Security / Concurrency / Recovery hardening adds stable mobile retry keys, request/session failure recovery, uniform safe API errors, security headers, production secret validation, structured request logs, audit UUID/redaction fixes, PostgreSQL concurrency/integrity tests wired into CI, a non-public production PostgreSQL topology, explicit migration deployment, rotating backups, restore verification, and production/release runbooks.

M12 Release Candidate preparation adds backend/mobile build visibility, an About screen, a deployed read-only smoke test, a disposable-PostgreSQL local RC verifier, APK release-manifest/checksum generation, and the complete UAT evidence plan/checklist. M12 is **not yet certified complete**: dependency lockfiles must be generated online and committed, real PostgreSQL concurrency tests must run, and staging/physical-device/WhatsApp/UPI/backup/signed-APK UAT evidence must be recorded.

See `docs/implementation/stage6-m7-followups.md`, `docs/implementation/stage6-m8-messaging.md`, `docs/implementation/stage6-m9-reporting.md`, `docs/implementation/stage6-m10-admin.md`, `docs/implementation/stage6-m11-hardening.md`, and `docs/implementation/stage6-m12-rc-preparation.md`.

Next gate: execute the M12 RC/UAT evidence plan on an online Docker/PostgreSQL + Android-device environment. No new V1 feature milestone should begin before that gate.
