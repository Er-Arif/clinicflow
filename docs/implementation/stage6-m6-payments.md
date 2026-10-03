# Stage 6 — M6 Payments, UPI & Receipts

M6 completes ClinicFlow's V1 financial workflow on top of the PENDING payment obligation created at check-in.

## Implemented backend

- Payment worklist/detail APIs with clinic scoping and status/date/patient filters.
- CASH and UPI confirmation through one idempotent financial command.
- Payment confirmation accepts Visits in `ACTIVE` or `COMPLETED` state and rejects `ABORTED` Visits.
- The client never supplies the confirmation amount. The backend confirms the authoritative `payments.amount_due`.
- Confirmation records `confirmation_source = ASSISTANT`, actor and timestamp.
- Governed annual receipt numbering:

```text
RCT-2026-000001
RCT-2026-000002
...
```

- Receipt counters use the shared `number_counters` table with key `RECEIPT:YYYY` and PostgreSQL row locking.
- Receipt creation occurs inside the same transaction as Payment `PENDING → CONFIRMED`.
- Digital Receipt snapshots clinic, doctor, patient, visit date, appointment type, amount and method at issue time.
- Receipt numbers are never reused.
- UPI configuration is clinic-scoped, versioned and Owner/Admin controlled.
- Dynamic UPI intent generation uses the authoritative amount and a neutral `Clinic Consultation` note without patient/clinical information.
- UPI remains manually confirmed. Generating/scanning a QR never changes payment state.
- Controlled financial correction:
  - only `CONFIRMED` may become `VOID`
  - original confirmation and Receipt remain historical
  - mandatory reason and audit event
  - optional replacement `PENDING` Payment points to the voided payment through `correction_of_payment_id`
  - replacement receives a new Receipt only if/when confirmed
- Idempotency is required for Payment confirmation and void.
- One current `PENDING`/`CONFIRMED` settlement per Visit remains database-enforced.

## Financial lifecycle

```text
PENDING ─────► CONFIRMED ─────► VOID
   │                │
   │                └── immutable Receipt remains
   └─────────► CANCELLED
```

`CANCELLED` means money was never collected. `VOID` means a previously confirmed entry was corrected/reversed in ClinicFlow history.

## Implemented APIs

- `GET /api/v1/payments`
- `GET /api/v1/payments/{payment_id}`
- `POST /api/v1/payments/{payment_id}/confirm`
- `POST /api/v1/payments/{payment_id}/void`
- `GET /api/v1/payments/{payment_id}/receipt`
- `GET /api/v1/payments/{payment_id}/upi-intent`
- `GET /api/v1/upi-configuration`
- `PATCH /api/v1/upi-configuration`

## Mobile implemented

- Payments worklist with Pending / Confirmed / Today filters.
- Payment Details screen.
- CASH confirmation using the backend authoritative amount.
- UPI QR screen with payee, amount and explicit manual-confirmation warning.
- Digital Receipt screen.
- Owner-only controlled Void workflow with optional replacement payment.
- Owner UPI Settings screen.
- Appointment Details links directly to Collect Payment / View Payment & Receipt.
- Assistant Home links to Payments.
- Doctor/Owner setup area links to UPI Settings.

The UPI QR is rendered locally from the backend-generated `upi://pay` URI. The Android client does not construct a different amount or transaction reference.

## Migration

Revision `0006` adds:

- `receipts`
- `upi_configurations`
- payment confirmation index
- final M6 payment-state check constraint

## Validation completed in this environment

- Backend Python compilation passes.
- 35 backend tests pass.
- Alembic chain renders through revision `0006` as PostgreSQL SQL.
- All payment/UPI API routes register successfully.
- 40 TypeScript/TSX files transpile with zero syntax diagnostics.

The environment does not provide a running Docker/PostgreSQL instance, so live row-lock/concurrent-confirmation tests still need to run locally. The full Expo dependency-aware typecheck/device build also requires `npm install`.

## Next milestone

M7 — Visit Completion & Follow-ups:

- Visit `ACTIVE → COMPLETED`
- completion while Payment may remain PENDING
- Follow-up Recommendation creation
- OPEN / BOOKED / CLOSED transitions
- Book Now / Book Later
- due-date calculation
- cancellation/no-show reopening
- chained follow-ups
