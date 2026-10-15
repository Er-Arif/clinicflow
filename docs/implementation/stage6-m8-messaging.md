# Stage 6 — M8 Messaging / WhatsApp / Reminders

## Scope

M8 implements ClinicFlow V1 operational messaging without introducing WhatsApp Business/Cloud API automation. ClinicFlow prepares the message and opens WhatsApp; the Assistant remains responsible for tapping Send and then recording whether the message was sent.

## Backend

- `MessageTemplate` persistence for the five frozen template types in English and Hindi.
- `Reminder` persistence with one-shot uniqueness per appointment/follow-up and reminder type.
- Appointment reminder creation only when the scheduled appointment is more than 24 hours away.
- Follow-up reminder creation when an OPEN follow-up is created.
- Lifecycle hooks:
  - appointment cancellation skips obsolete due confirmation/appointment reminders;
  - reschedule skips old reminders and creates a qualifying replacement reminder;
  - follow-up booking/closure skips its due follow-up reminder;
  - cancelling a linked booking reopens only a reminder skipped for `FOLLOWUP_BOOKED`, clearing skip metadata and requiring a fresh preview; sent reminders and manual skips retain their history;
  - blocked sessions suppress sending of normal appointment reminders without destroying reminder history.
- Message rendering from current template and patient language, with temporary EN/HI override.
- Rendered `message_snapshot` is retained on the Reminder.
- WhatsApp click-to-chat URL generation using the patient's normalized international number and URL-encoded message.
- `SENT` remains an Assistant assertion only. ClinicFlow does not claim delivery/read verification.
- Template placeholder allowlist prevents accidental unsupported/clinical variables.
  - Bootstrap creation, template updates, and runtime preparation share validation using the renderer's brace grammar. Only the seven advertised named variables are accepted; attribute/index access, positional fields, conversions, and format specifiers are rejected. `{{` and `}}` escape literal braces.
  - Missing optional/context-specific values remain empty strings. All built-in EN/HI templates remain valid. Persisted unsupported templates are left intact and return a controlled validation error during preparation so an administrator can correct them; no template content is silently rewritten.
- Audit events for sent/skipped reminder actions and template edits.

## API

- `GET /api/v1/reminders`
- `POST /api/v1/reminders/{reminder_id}/prepare`
- `POST /api/v1/reminders/{reminder_id}/mark-sent`
- `POST /api/v1/reminders/{reminder_id}/skip`
- `POST /api/v1/appointments/{appointment_id}/messages`
- `GET /api/v1/message-templates`
- `PATCH /api/v1/message-templates/{template_id}`

## Mobile

- Assistant Reminders worklist, including overdue due follow-up reminders.
- Message Preview with patient number, rendered message, EN/HI temporary switch, Open WhatsApp, and Copy Message fallback.
- Return confirmation: Mark Sent / Not Sent.
- Appointment Booked can prepare/send the immediate confirmation.
- Appointment Details exposes cancellation/reschedule/confirmation messages according to state.
- Follow-up Details exposes the one due follow-up reminder.
- Owner Message Templates screen supports editing both languages and warns against sensitive clinical content.
- `expo-clipboard` is used only for the Copy Message fallback.

## Database

Alembic revision `0008` creates `message_templates` and `reminders`, their state/reference constraints, due indexes, and partial unique indexes preventing duplicate one-shot reminder tasks. Default templates are seeded with migration-safe `INSERT ... SELECT` SQL so offline Alembic SQL generation remains supported.

## Validation

- Backend suite: 46 tests passing.
- Python source compilation: passing.
- Alembic offline PostgreSQL render: revisions `0001` through `0008` passing.
- Messaging routes registered.
- 49 implementation `.ts/.tsx` files transpile with zero syntax diagnostics.
- Full dependency-aware Expo typecheck/device run remains a local-environment step after `npm install`.
- Live PostgreSQL concurrency/integration execution remains a local Docker step.

## Preserved V1 Boundaries

M8 does not add WhatsApp API automation, Accessibility-driven sending, delivery/read receipts, SMS, diagnosis/medicine content, push notifications, or repeated daily reminder spam.
