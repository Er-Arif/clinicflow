# Stage 6 / M4 — Appointment Engine

Implemented in this milestone:

- `Appointment` persistence and state fields
- immutable `AppointmentFeeAdjustment` history
- lazy `SessionOccurrence` materialization on booking
- occurrence row locking with `SELECT ... FOR UPDATE`
- normal capacity enforcement across every non-cancelled appointment
- occupied-slot enforcement across normal and override appointments
- explicit Owner/Admin capacity/double-book override with mandatory reason and audit metadata
- PostgreSQL trigger protecting normal slot uniqueness as a second line of defense
- server-derived booking source
- booking-time fee snapshots
- authorized fee adjustment with immutable history
- idempotent appointment creation
- cancellation / no-show
- transactional rescheduling with history-preserving replacement appointment
- same-session rescheduling that excludes the original appointment from its own capacity check
- occupancy-aware availability without introducing a Scheduling → Appointment dependency
- M4 Android booking, review, booked, list, detail, cancellation and rescheduling flows

## Lazy occurrence API clarification

Stage 4 requires `SessionOccurrence` to remain unmaterialized during read-only availability browsing, but the original request sketch used `session_occurrence_id` as the booking input. Those two rules cannot both be true for a never-before-used session.

M4 therefore resolves the frozen semantics by accepting:

- `session_definition_id`
- `appointment_date`
- `appointment_time`

on booking/rescheduling. The backend materializes the occurrence inside the booking transaction and returns the authoritative `session_occurrence_id` in the Appointment response. This preserves the Stage 4 lazy-materialization rule without adding a pre-booking mutation.

## Slot integrity

Every booking transaction locks the target occurrence before it reads capacity or slot occupancy. Normal booking is rejected if any non-cancelled appointment already occupies the requested time. An explicit authorized override is the only bypass.

A PostgreSQL trigger independently rejects normal inserts/updates that collide with any non-cancelled appointment at the same occurrence/time. This includes an existing override appointment, preventing the subtle case where a normal booking could otherwise enter a slot after an earlier normal booking was cancelled.

## Deferred to M5/M6/M8

- Check-in and Walk-in state transitions: M5
- Payment-aware fee-adjustment gating: M6
- Checked-in rescheduling with pending-payment cancellation: M5/M6
- Persisted appointment reminders and WhatsApp workflows: M8

M4 exposes `reminder_eligible` only as a hook/read-model signal; it does not create Messaging-domain rows early.
