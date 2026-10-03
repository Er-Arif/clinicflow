# Stage 6 / M3 — Scheduling, Fees & Availability

Implemented in this milestone:

- effective-dated `ScheduleDefinition`
- child `SessionDefinition`
- lazily persisted `SessionOccurrence`
- session snapshot semantics
- PostgreSQL `btree_gist` exclusion constraints preventing overlapping schedule/fee periods
- generated appointment slots without a persistent slot table
- capacity validation (`maximum_capacity <= generated slots`)
- date-specific block/unblock
- effective-dated regular/follow-up fee configuration
- doctor lookup API
- backend-authoritative clinic date/time endpoint and availability query
- Owner schedule/fee screens and Assistant availability screen

## Important boundary

Reading availability does **not** materialize a `SessionOccurrence`. A row is created only by a business action such as session blocking in M3, and later booking/walk-in in M4/M5.

M3 has no Appointment table yet, so availability occupancy is currently zero. M4 plugs the appointment occupancy reader into the same response contract without changing its shape.

## Effective-date semantics

`effective_from` and `effective_to` are inclusive business dates. Creating a new version closes the previous version on `new_effective_from - 1 day`. Overlapping periods are rejected by PostgreSQL exclusion constraints.
