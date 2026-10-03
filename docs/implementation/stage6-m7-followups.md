# Stage 6 M7 — Visit Completion & Follow-ups

M7 completes the clinic lifecycle after attendance.

## Backend delivered

- `POST /api/v1/visits/{visit_id}/complete`
  - idempotent
  - requires ACTIVE Visit + CHECKED_IN Appointment
  - permits PENDING or CONFIRMED payment
  - marks Visit and Appointment COMPLETED atomically
  - optionally creates one OPEN Follow-up Recommendation
  - closes the previous BOOKED recommendation when completing a linked follow-up appointment
- `followup_recommendations` table
  - OPEN / BOOKED / CLOSED state constraints
  - one recommendation per source Visit
  - at most one linked Appointment per recommendation
  - due date and optional interval snapshot
- `GET /api/v1/followups`
  - Due Today / Upcoming / Overdue / Booked / explicit status filters
- `GET /api/v1/followups/{id}`
- `POST /api/v1/followups/{id}/book`
  - idempotent
  - books a `FOLLOW_UP` Appointment using the source Visit doctor
  - uses the current follow-up fee snapshot
  - reuses normal slot/capacity locking and Owner override rules
- `POST /api/v1/followups/{id}/close`
  - manual OPEN → CLOSED only
  - audited closure reason
- Appointment lifecycle integration
  - cancellation/no-show of linked appointment: BOOKED → OPEN
  - reschedule: remains BOOKED and link moves to replacement
  - completion of linked appointment: BOOKED → CLOSED
  - a completed follow-up Visit may create the next OPEN recommendation, forming a chain

## Mobile delivered

- Complete Visit screen
  - payment may remain pending
  - no follow-up / after N days / explicit due date
  - completion commits before optional follow-up booking
- Follow-ups worklist
  - Due Today
  - Overdue
  - Upcoming
  - Booked
- Follow-up detail
  - Book Appointment
  - Open linked Appointment
  - Close Follow-up
- Follow-up booking
  - backend-authoritative availability
  - slot selection
  - normal capacity rules
  - Owner/Admin override with reason
- Assistant Home now links to Follow-ups.
- Appointment Details exposes Complete Visit for CHECKED_IN patients.

## Important invariants

1. Follow-up recommendation and follow-up appointment are different records.
2. Visit completion never fails merely because a future follow-up slot is unavailable.
3. The Follow-up Recommendation is created OPEN during completion. Booking is a second transaction.
4. Cancelling/no-showing a linked follow-up appointment reopens the recommendation.
5. Rescheduling a linked follow-up appointment does not reopen it; the link moves to the replacement.
6. A follow-up Visit can close the previous recommendation and create a new recommendation in the same completion transaction.
7. Overdue is derived from `status = OPEN` and `due_date < clinic_date`; it is not persisted as a fourth state.

## Validation in this environment

- Python compilation succeeds.
- Backend test suite: 42 tests pass.
- Alembic SQL renders cleanly through revision `0007` for PostgreSQL.
- M7 FastAPI routes register successfully.
- TypeScript/TSX syntax transpilation succeeds without diagnostics.

Live PostgreSQL locking/concurrency validation still requires the local Docker/PostgreSQL environment. Full Expo typecheck/device testing requires the mobile dependencies to be installed locally.
