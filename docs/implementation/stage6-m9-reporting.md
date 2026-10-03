# ClinicFlow Stage 6 — M9 Operational Views & Reporting

## Scope

M9 adds read-only operational projections over the existing transactional model. It does not introduce reporting tables, cached financial totals, or a second source of truth.

Implemented backend read models:

- Assistant Home
- Doctor Today
- Patient operational summary / completed visit history
- Owner Dashboard
- Appointment report
- Patient report
- Follow-up report
- Payment report
- Audit-event query foundation for M10

Implemented Android views:

- live Assistant Home
- Doctor Today backed by dedicated read model
- Doctor patient search
- Doctor Patient Summary / Visit History
- Owner Dashboard
- Reports

## API

```text
GET /api/v1/home/assistant
GET /api/v1/doctor/today?date=YYYY-MM-DD
GET /api/v1/patients/{patient_id}/operational-summary
GET /api/v1/dashboard/owner?from=YYYY-MM-DD&to=YYYY-MM-DD
GET /api/v1/reports/appointments?from=...&to=...
GET /api/v1/reports/patients?from=...&to=...
GET /api/v1/reports/followups?from=...&to=...
GET /api/v1/reports/payments?from=...&to=...
GET /api/v1/audit-events
```

Owner dashboard/report endpoints require `reports.view`. Audit query requires `audit.view`.

## Date semantics

Business dates remain backend-authoritative in `Asia/Kolkata`.

Appointment and visit activity uses `SessionOccurrence.occurrence_date`.

Payment confirmed totals use `Payment.confirmed_at`, converted using clinic-local day boundaries.

Pending payment amount uses the associated Visit/Appointment occurrence date because a PENDING payment has no confirmation timestamp yet.

A report date range is inclusive and limited to 367 calendar days in V1.

## Appointment report semantics

- `total_appointments`: all Appointment records whose occurrence is in the selected range.
- `booked`: currently BOOKED records in the range.
- `checked_in`: currently CHECKED_IN records in the range.
- `completed`: COMPLETED records.
- `cancelled`: ordinary cancellation reasons only.
- `no_show`: CANCELLED + `NO_SHOW`.
- `rescheduled`: CANCELLED + system reason `RESCHEDULED`.

This intentionally prevents rescheduled originals from being presented as ordinary cancellations.

## Patient report semantics

Classification uses completed Visit sequence, never registration date.

- `new_patients`: first completed Visit occurs in the selected range.
- `returning_patient_visits`: completed Visits in the selected range whose patient had an earlier completed Visit.
- `unique_patients`: distinct patients with at least one completed Visit in the range.

A patient can contribute one new visit and a later returning visit inside the same date range. This is deliberate and matches the Stage 3 definition of returning patient activity.

## Follow-up report semantics

- `created`: Follow-up Recommendations created in the date range.
- `booked_events`: `FOLLOWUP_BOOKED` audit actions in the date range.
- `closed_events`: `FOLLOWUP_CLOSED` audit actions in the date range.
- `open_current`: current OPEN recommendations.
- `overdue_current`: current OPEN recommendations whose due date is before the clinic date.

The last two are intentionally labeled “current”; ClinicFlow does not reconstruct a historical point-in-time follow-up-state snapshot in V1.

## Payment report semantics

- Confirmed revenue includes only payments whose current state is `CONFIRMED` and whose `confirmed_at` falls in the selected clinic-local range.
- VOID payments do not contribute to confirmed revenue.
- Cash + UPI equals confirmed total.
- Pending amount is shown separately.
- Voided count is based on `voided_at` in the selected range.

## M9 migration

Alembic revision `0009` adds only read/query indexes:

- SessionOccurrence clinic/date
- completed Visit clinic/completion timestamp
- confirmed Payment clinic/confirmation timestamp
- void Payment clinic/void timestamp
- Audit clinic/action/timestamp

No new business-state table is introduced.

## Cache behavior

RTK Query reporting projections provide the general `Report` tag. State-changing mobile mutations that affect operational/report facts invalidate that tag so Dashboard/Home/Today reads do not silently retain stale counts.

Pull-to-refresh is also supported on the M9 operational screens.

## Validation

- backend test suite: 53 tests passing
- Python compilation: passing
- OpenAPI generated successfully with all M9 routes
- Alembic offline PostgreSQL render: `0001 → 0009` passing
- mobile TS/TSX syntax transpilation: 56 implementation files, zero syntax diagnostics

Live PostgreSQL query-plan/concurrency validation remains part of local Docker integration and M11 hardening.
