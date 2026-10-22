# Stage 6 implementation checkpoint: M2 Patient Management

Implemented:

- `patients` PostgreSQL table and `number_counters`
- governed, never-reset patient numbers (`0001`, `0002`, ...), with a four-digit minimum that expands naturally after `9999`
- immutable UUID `patient_id` retained as the internal relational identity; human-facing `patient_code` remains a clinic-scoped display/search number
- clinic-scoped patient reads and writes
- Indian mobile normalization to E.164 (`+91XXXXXXXXXX`)
- shared-family/caregiver mobile numbers with explicit duplicate warning override
- DOB or approximate-age invariant with age reference date
- WhatsApp same-as-mobile consistency rules
- English/Hindi reminder preference
- optimistic `version` checks on patient edits
- patient create/update audit events
- patient search by mobile, patient number or name
- numeric patient-number shorthand (`1` → `0001`, `23` → `0023`)
- legacy patient-number search compatibility (`PT-000001` → `0001`)
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

Patient numbers are clinic-scoped, sequential, never reset, and allocated by a locked PostgreSQL counter. The first number is `0001`; after `9999`, numbering continues as `10000`, `10001`, and so on. Leading zeroes are presentation only and are not required when searching.

`patient_id` remains an immutable UUID and continues to be used by appointments, visits, payments, follow-ups, and API resource routes. The human-facing `patient_code` field is intentionally kept as a string so leading zeroes can be displayed without changing relational identity.

A mobile number is not unique. When a matching number already exists, normal registration returns `POTENTIAL_DUPLICATE_PATIENT`. The UI shows the matching patient(s) first. The Assistant can deliberately continue with `allow_shared_mobile=true` when another real patient uses the same family/caregiver number.

Patient edit requests include `expected_version`; stale edits return `STALE_VERSION` rather than silently overwriting another user's update.

## Validation

Patient-number behavior is covered by unit, PostgreSQL integration, migration, mobile lint/typecheck, and mobile source regression checks in the repository CI. The current CI run is authoritative for release readiness.

Next milestone: M3 Scheduling / Fees / Availability.
