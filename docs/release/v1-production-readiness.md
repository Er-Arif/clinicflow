# ClinicFlow V1 production readiness

Baseline inspected: `main`, `0ee4d6c88ba48d136e5f8b58703b515275a4d926`, clean.
Date: 2026-10-15. This is evidence for the uncommitted production-hardening pass,
not a claim that a production deployment or signed Android release exists.

The PRD and approved scheduling-redesign-spec.md v1.2.2 remain authoritative.
No product lifecycle, scheduling occupancy/locking/token policy, payment rule,
follow-up/reminder transition, navigation or keyboard container is redesigned.
The historical M11/M12 reports retain their original counts; use this document
for current release evidence. Dependency locks now exist and PostgreSQL tests
run locally; those are no longer missing implementation prerequisites.

## Corrections

| Finding | Evidence and correction |
| --- | --- |
| CF-08 | Unlimited login attempts and an early disabled-account response. Atomic bounded process-local IP/identity budgets now gate credential checks; PostgreSQL normalization matches CITEXT (including Unicode aliases), failures are uniform, successful login clears only identity history, and 429 includes Retry-After. Refresh/password-change also consume the IP budget. |
| CF-09 | Main Android manifest allowed HTTP, API URL had an emulator fallback, release used debug signing. Production now requires an explicit HTTPS origin and user-owned release key; debug HTTP requires explicit opt-in. Native project is authoritative. See [Android production](android-production.md). |
| CF-15 | README and old milestone gates claimed missing locks/tests. README now points to this evidence and old reports are marked historical. PRD/specification content is unchanged. |
| CF-16 | Docker bypassed uv.lock; CI used mutable installs. Docker/CI/RC now use frozen uv installs/runs and npm ci. CI also runs mobile tests. No package versions or lockfiles changed. uv Docker tooling is pinned to the installed 0.12.17 version; base-image patch/digest and native Gradle artifact locking remain separate reproducibility considerations. |
| CF-17 | Appointment, follow-up and reminder serializers performed per-row SQL. List-only request-scoped FK batches now preserve response semantics and clinic scope; command serializers retain their live reads. PostgreSQL tests compare one-row and 50-row query counts and compare all serialized values with individual responses. |
| CF-21 | Copied backup sidecars referenced the original absolute daily path, and restore ignored checksums. Portable basename sidecars are now verified before any restore database is created. Direct PostgreSQL mode supports Railway-connected operators; credentials stay outside scripts. |

Production configuration also validates environment names/token lifetimes,
placeholder database passwords, explicit host/CORS/proxy settings and pool bounds.
Application startup and CLI database access validate settings. One-worker launcher
honors PORT, avoids query-string access logs, and supplies only explicit trusted
proxy addresses. JSON request logs use route templates and request IDs; lifecycle
events are emitted. Readiness returns safe 503 on database errors. Pool pre-ping,
bounded sizing/waits, connection timeout and recycle are configured; sessions close
normally and the engine is disposed on shutdown.

Authentication remains Bearer access tokens plus rotating refresh-token bodies;
it does not use cookies. No cookie or CSRF mechanism was invented. The initial
Owner bootstrap already prompts or accepts a supplied secret; no default Owner
password or new production credential was added. Existing secret ignore rules
cover env files, keystores and JKS files. Two existing import-order issues in release
utility scripts were corrected so root-level Ruff passes too.

## CF-17 read-path review

- Appointments: list + count + batched patient/doctor/occurrence/visit/latest-payment/follow-up reads; at most eight queries per nonempty page, independent of row count.
- Follow-ups: list + count + four FK batches; linked and source appointments share a batch.
- Reminders: list + count + four FK batches, retaining the existing sendability rules.
- Patient searches: page/count queries, scalar-only serialization; no N+1 found.
- Payments: joined page/count with receipt projection; no N+1 found.
- Assistant/Owner dashboards, Doctor Today, patient summaries and reports: bounded joined/aggregate queries, no per-row SQL in the reviewed projections.
- Audit lists/details: joined actor names with bounded pagination/count; no N+1 found.

No speculative indexes, schema rewrite or caching layer were introduced. Low-volume
administrative user-role lookups and scheduling definition/exception projections
are deferred to a measured follow-up; scheduling command queries/locks remain untouched.

## Verification

- Focused backend runtime/auth/read-model suite: 41 passed, including PostgreSQL.
- Full backend: 355 passed, zero skipped; one existing Starlette/httpx deprecation warning.
- Full mobile: 120 passed. TypeScript passed. Mobile lint: zero errors, 18 existing warnings.
- Ruff: backend and repository root passed.
- Docker production image: frozen install/build passed; non-root read-only startup,
  PORT binding, live/ready, rejected Host, request IDs, DB-loss 503, pool recovery,
  restart and secret-free lifecycle logs passed. Disposable role/container removed.
- Gradle configuration guard: refuses missing signing inputs as intended. No
  signed positive-path build, merged release artifact, APK or AAB was produced.
- Checksum regression covers relocation, corruption and missing sidecars.
- RC verification passed: frozen installs, disposable database/migration chain,
  355 backend tests, Ruff, mobile lint and TypeScript. An initial Windows shared
  pytest-temp permission failure was resolved by selecting a fresh scoped temp
  directory; no product code was changed for that environment issue.
- Operational backup drill passed against the disposable PostgreSQL database:
  custom dump, sidecar, disposable restore, Alembic/core-table checks and rejection
  of a deliberately corrupted dump before restore. Test artifacts were removed.
- No migration/schema or dependency-version changes. Existing migrations were
  applied only to disposable verification databases.

## Remaining rollout gates

1. User-owned signing material, final artifact/certificate verification and physical
   Android UAT (HTTPS, authentication recovery, keyboard/forms, WhatsApp/UPI).
2. Actual Railway domain, private database/TLS configuration, strong secrets,
   allowed hosts, and verified narrow proxy trust; test spoofed headers and separate
   clients through the real ingress. This pass does not deploy Railway resources.
3. Exactly one worker and one replica for the in-memory limiter. Restarts reset
   budgets; deployment overlaps temporarily split them. Shared distributed limits
   and edge DDoS controls require a separate deployment decision before scaling.
4. Scheduled protected backups, encrypted off-host storage, alert ownership and a
   production restore drill with independently recorded business counts/receipts.
5. Continuous uptime/error/backup monitoring. Railway deploy healthchecks alone do
   not provide ongoing monitoring. SSE and external telemetry SDKs remain deferred.
6. Native build-host JDK/CMake portability remains to be addressed before moving
   Android builds to another machine. The npm audit review is complete: no critical
   findings were reported; automatic fixes were rejected because they proposed
   incompatible Expo/React Native downgrades. The meaningful externally reachable
   Android deep-link path was reduced by removing the unused `clinicflow://` scheme
   in commit `0118bcf`; package versions and lockfiles remain unchanged.

See the [production runbook](../operations/production-runbook.md) and
[backup/restore runbook](../operations/backup-restore.md). Approval for production
rollout depends on completing those operational gates, not just green unit tests.
