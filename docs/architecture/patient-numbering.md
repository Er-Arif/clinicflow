# Patient Numbering Architecture

## Status

Frozen for ClinicFlow V1.

## Purpose

ClinicFlow separates the patient's internal database identity from the number staff see and type at reception.

- `patient_id`: immutable UUID used for database relationships and API resource identity.
- `patient_code`: human-facing patient number used for display and search.

Changing the patient-number format must never change `patient_id` values or foreign-key relationships.

## V1 patient-number format

Patient numbers are:

- numeric only
- clinic-scoped
- sequential
- never reset
- allocated from the existing PostgreSQL `number_counters` row keyed by `PATIENT`
- displayed with a minimum width of four digits

Examples:

```text
0001
0002
0099
0100
0999
1000
9999
10000
10001
```

`0000` is never issued.

The four-digit width is a minimum, not a maximum. When the counter exceeds `9999`, the value expands naturally instead of rolling over or resetting.

## Concurrency

Allocation continues to use a row-level lock on the clinic's `PATIENT` counter. Concurrent registrations therefore cannot legitimately receive the same patient number.

The database uniqueness constraint on `(clinic_id, patient_code)` remains as a secondary integrity safeguard.

## Search behavior

Reception staff do not need to type leading zeroes.

Examples:

```text
1     -> 0001
23    -> 0023
427   -> 0427
9999  -> 9999
10000 -> 10000
```

For transition compatibility, the backend also accepts the former format as a search alias:

```text
PT-000001 -> 0001
PT-000023 -> 0023
```

The legacy prefix is not displayed or issued for new patients.

Name and mobile-number search behavior remains unchanged.

## Migration rules

Alembic revision `0014` converts existing legacy patient codes to the new format.

The migration:

1. accepts canonical legacy `PT-<digits>` values and already-numeric values;
2. rejects malformed or non-positive patient codes instead of guessing;
3. rejects normalized collisions inside the same clinic;
4. converts legacy codes without changing `patient_id`;
5. preserves the existing `number_counters` value and raises it to the highest migrated patient number if required;
6. never resets a clinic's patient counter.

Historical audit events are not rewritten. They remain an immutable record of the values that existed when those events occurred.

## API compatibility

The API field remains named `patient_code` and remains a string.

This avoids a broad contract migration while still allowing the UI to call it "patient number." Appointments, visits, payments, follow-ups, and resource routes continue to use UUID identifiers internally.
