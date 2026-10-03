# Stage 6 — M5 Check-in, Walk-ins & Visits

M5 adds the attendance boundary to ClinicFlow. A booked Appointment still represents intent; a Visit now represents actual patient attendance.

## Implemented backend

- `visits` persistence with `ACTIVE`, `COMPLETED`, and `ABORTED` states.
- Database-enforced one-Visit-per-Appointment invariant.
- Same-clinic, same-scheduled-date check-in validation using the backend `Asia/Kolkata` clock.
- Blocked SessionOccurrence check-in rejection.
- Idempotent `POST /api/v1/appointments/{appointment_id}/check-in`.
- Atomic check-in transaction:
  - Appointment `BOOKED → CHECKED_IN`
  - Visit created `ACTIVE`
  - Payment obligation created `PENDING`
  - audit event written
- Idempotent `POST /api/v1/walk-ins`.
- Walk-in semantics:
  - no artificial scheduled time
  - `booking_source = WALK_IN`
  - today’s SessionOccurrence is materialized transactionally
  - walk-in consumes session capacity
  - Owner/Admin can explicitly override full capacity with a required reason
  - Appointment is created directly as `CHECKED_IN`
  - Visit and PENDING Payment are created atomically
- `GET /api/v1/visits/{visit_id}` operational read model.
- Appointment responses now expose optional Visit/Payment state summaries.

## Pending Payment foundation

M5 creates the final-shaped `payments` table so check-in can create the financial obligation without delaying attendance until M6.

Current M5 behavior:

```text
CHECK IN
   ↓
Visit ACTIVE
   ↓
Payment PENDING
```

M6 adds CASH/UPI confirmation, UPI intent/QR, receipts, void/correction, and payment worklists.

The database already distinguishes:

```text
PENDING → CONFIRMED → VOID
   └────→ CANCELLED
```

and enforces at most one current `PENDING`/`CONFIRMED` settlement per Visit.

## Checked-in cancellation

A checked-in appointment may still be cancelled exceptionally.

If payment is still pending:

```text
Appointment CHECKED_IN → CANCELLED
Visit ACTIVE           → ABORTED
Payment PENDING        → CANCELLED
```

If a future M6 payment has already been confirmed, cancellation does not silently delete or void the financial history.

A checked-in patient cannot be marked `NO_SHOW`.

## Checked-in rescheduling

M5 implements the frozen Stage 4 rule:

- `BOOKED` appointments may reschedule normally.
- `CHECKED_IN` appointments may reschedule only while the related Payment is still `PENDING`.
- The original Visit becomes `ABORTED`.
- Its PENDING Payment becomes `CANCELLED`.
- The original Appointment becomes `CANCELLED / RESCHEDULED`.
- A replacement `BOOKED` Appointment is created in the same transaction.
- Once a payment is confirmed in M6, financial correction is required before this checked-in reschedule path can run.

## Fee adjustment after check-in

If the Visit payment is still `PENDING`, an authorized fee change updates both:

- `appointments.effective_fee_amount`
- `payments.amount_due`

in the same transaction.

Once the Payment is no longer pending, fee editing is rejected and the financial correction workflow owns the change.

## Mobile implemented

- Appointment Details now supports idempotent **Check In**.
- Checked-in appointments display Visit and Payment state.
- Exceptional checked-in cancellation and pending-payment reschedule are exposed.
- Today’s Appointments includes `CHECKED_IN` and `COMPLETED` filters.
- New **Walk-in** workflow:
  - search/select patient
  - choose doctor
  - choose today’s session
  - select Regular/Follow-up
  - display configured fee
  - optional authorized fee adjustment
  - capacity-full Owner override with reason
  - **Add & Check In**
- Patient Profile links directly to **Add Walk-in**.
- Doctor Today now displays real `CHECKED_IN` and `BOOKED` patients from the API.

## Validation completed in this environment

- Backend Python compile passes.
- 26 backend tests pass.
- Alembic chain renders through revision `0005` as PostgreSQL SQL.
- M5 API routes register successfully.
- TypeScript/TSX source transpilation reports zero syntax diagnostics.

Live PostgreSQL transaction/concurrency tests and a full Expo dependency-aware typecheck/device build still require the local development environment with Docker and installed npm dependencies.

## Next milestone

M6 — Payments & Receipts:

- payment list/detail
- CASH confirmation
- UPI configuration
- dynamic UPI URI/QR
- manual UPI confirmation
- governed annual receipt numbering
- digital receipt
- payment void/correction
- pending-payment worklist
- concurrency/idempotency tests for payment confirmation and receipt allocation
