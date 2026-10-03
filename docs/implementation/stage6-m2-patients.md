# Stage 6 implementation checkpoint: M2 Patient Management

Implemented:

- `patients` PostgreSQL table and `number_counters`
- governed, never-reset patient codes (`PT-000001`, `PT-000002`, ...)
- clinic-scoped patient reads and writes
- Indian mobile normalization to E.164 (`+91XXXXXXXXXX`)
- shared-family/caregiver mobile numbers with explicit duplicate warning override
- DOB or approximate-age invariant with age reference date
- WhatsApp same-as-mobile consistency rules
- English/Hindi reminder preference
- optimistic `version` checks on patient edits
- patient create/update audit events
- patient search by mobile, patient code or name
- patient profile and timeline API foundation
- Patient Search Android screen
- New Patient Android screen
- duplicate-patient warning / open-existing / register-another flow
- Patient Profile Android screen
- Edit Patient Android screen
- React Hook Form + Zod form validation foundation

## M2 API

```text
GET   /api/v1/patients?q=...
POST  /api/v1/patients
GET   /api/v1/patients/{patient_id}
PATCH /api/v1/patients/{patient_id}
GET   /api/v1/patients/{patient_id}/timeline
```

## Important behavior

A mobile number is not unique. When a matching number already exists, normal registration returns `POTENTIAL_DUPLICATE_PATIENT`. The UI shows the matching patient(s) first. The Assistant can deliberately continue with `allow_shared_mobile=true` when another real patient uses the same family/caregiver number.

Patient edit requests include `expected_version`; stale edits return `STALE_VERSION` rather than silently overwriting another user's update.

## Validation performed in the build environment

- Python test suite: 9 passed
- Python source compilation: passed
- Alembic PostgreSQL offline SQL generation through revision `0002`: passed
- TypeScript/TSX syntax transpilation: passed

A live PostgreSQL integration run and full Expo TypeScript dependency check still require the local development environment because Docker/PostgreSQL and npm dependencies are not available in this execution runtime.

Next milestone: M3 Scheduling / Fees / Availability.
