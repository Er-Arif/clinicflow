# Doctor Clinic App

## V1 Product Requirements & Workflow Baseline

**Document Version:** 1.0 Draft for Owner Review\
**Product Stage:** Product Requirements and Workflow Definition\
**Status:** Based on frozen V1 MVP scope\
**Primary Users:** Doctor/Owner, Clinic Assistant\
**Platform:** Android mobile application with centralized backend

---

# 1. Purpose

The Doctor Clinic App will replace the clinic's manual appointment, attendance, payment, reminder, and follow-up workflow with a simple Android-based digital system.

The product is intentionally designed as a **clinic practice-management application**, not a Hospital Information System or Electronic Medical Record.

V1 focuses on administrative workflow only.

The core operational model is:

**Patient → Appointment → Visit → Payment → Follow-up**

The app must reduce repetitive work for the assistant while giving the doctor/owner clear visibility into appointments, attendance, payments, follow-ups, and clinic activity.

---

# 2. Product Principles

The following principles govern V1.

1. The assistant operates the clinic workflow.
2. The doctor should not be required to manage queue states or consultation states.
3. Patient registration must be fast.
4. Existing patients should rarely require re-entry of demographic information.
5. Appointment capacity should prevent routine overbooking.
6. Rescheduling should exist for exceptional situations but should not become part of the normal workflow.
7. Follow-up recommendation and follow-up appointment are separate concepts.
8. Payments remain manually confirmed by the assistant.
9. WhatsApp messaging remains assistant-assisted in V1.
10. Medical records, diagnosis, prescription, and clinical documentation remain outside V1.
11. Every important business action should remain traceable.
12. The architecture must permit future WhatsApp automation, online booking, additional doctors, and richer clinic functionality without redesigning the core appointment system.

---

# 3. V1 Actors

## 3.1 Assistant

The Assistant is the primary operational user.

The Assistant can:

- Search patients
- Register patients
- Edit permitted patient information
- Create appointments
- Create walk-in appointments
- Check patients in
- Mark visits completed
- Cancel appointments
- Reschedule appointments
- Record cancellation reasons
- Record payments
- Confirm UPI payments manually
- Generate dynamic UPI QR codes
- Record follow-up recommendations
- Book follow-up appointments
- View due follow-ups
- Send WhatsApp-assisted messages
- Mark reminders sent or skipped
- View daily operational information

The Assistant cannot modify protected Owner/Admin configuration unless specifically granted permission.

---

## 3.2 Doctor

The Doctor primarily consumes information.

The Doctor can:

- View today's appointments
- View checked-in patients
- View upcoming appointments
- View basic patient details
- View previous visit history
- View follow-up history
- View basic payment information where permitted

The Doctor is not required to:

- Call patients
- Start consultation
- End consultation
- Change queue states
- Maintain consultation workflow states

---

## 3.3 Owner/Admin

In the initial clinic, the Doctor is also the Owner/Admin.

These capabilities remain architecturally separate.

Owner/Admin can:

- Configure doctor profile
- Configure clinic profile
- Configure appointment sessions
- Configure booking capacity
- Configure appointment duration/slot interval
- Override session capacity
- Configure consultation fees
- Configure follow-up fees
- Configure UPI payment details
- Configure WhatsApp message templates
- Manage Assistant accounts
- View operational and financial reports
- Correct permitted administrative data
- Review audit history

Future doctors may receive Doctor privileges without receiving Owner/Admin privileges.

---

# 4. Explicit V1 Scope

V1 includes:

- User authentication
- Patient registration
- Patient search
- Patient basic profile
- Appointment scheduling
- Doctor availability
- Session configuration
- Booking-capacity enforcement
- Walk-in registration
- Check-in
- Completion
- Cancellation
- Rescheduling
- Cancellation reasons
- Follow-up tracking
- Follow-up appointment booking
- Cash payments
- UPI payments
- Dynamic UPI QR generation
- Manual payment confirmation
- Payment history
- Receipt record
- WhatsApp-assisted confirmation messages
- WhatsApp-assisted appointment reminders
- WhatsApp-assisted cancellation messages
- WhatsApp-assisted rescheduling messages
- WhatsApp-assisted follow-up reminders
- English message templates
- Hindi message templates
- Patient preferred message language
- Daily operational dashboard
- Owner reports
- Role-based access control
- Basic audit history

---

# 5. Explicitly Out of Scope

V1 will not include:

- Diagnosis
- Symptoms
- Clinical notes
- Vitals
- Prescription
- Medicines database
- Laboratory functionality
- Radiology functionality
- Medical reports
- Medical-document upload
- Electronic Medical Record
- Queue-number system
- Waiting-state tracking
- Called-state tracking
- In-consultation state
- Consultation-start/end tracking
- Patient mobile application
- Patient web portal
- Online patient self-booking
- WhatsApp Business Platform
- WhatsApp Cloud API
- WhatsApp chatbot
- WhatsApp Flows
- Automated WhatsApp sending
- WhatsApp delivery/read verification
- SMS reading
- Bank SMS parsing
- Android notification payment detection
- Automatic UPI verification
- Payment gateway integration
- Payment webhooks
- Teleconsultation
- Multi-branch functionality

---

# 6. Patient Model

## 6.1 Minimum Patient Information

A patient record should contain:

- Internal patient ID
- Full name
- Mobile number
- WhatsApp number
- Whether WhatsApp number is the same as mobile number
- Date of birth or age
- Gender
- Preferred reminder language
- Reminder consent/preference
- Created date/time
- Created by
- Last modified date/time

Preferred reminder language:

- English
- Hindi

The app may default to English when no preference has been recorded, but the Assistant should be prompted to confirm the preferred language during registration.

---

# 7. Patient Search

The primary search mechanism should be mobile number.

The system should additionally support:

- Patient name
- Patient ID

When an Assistant enters a known mobile number, the existing patient should appear immediately.

Example:

**Rahman Ali**\
Age: 42\
Mobile: 98XXXXXXXX\
Last visit: 12 September 2026\
Previous visits: 3

The Assistant should be able to continue directly to appointment creation.

The system should discourage duplicate patient creation when the same mobile number already exists.

---

# 8. New vs Returning vs Follow-up

These concepts must remain separate.

## New Patient

A patient with no previous completed visit.

## Returning Patient

A patient with one or more previous completed visits.

## Follow-up Appointment

An appointment associated with a previous follow-up recommendation.

A Returning Patient is not automatically a Follow-up Patient.

Example:

A patient who visited six months earlier for another problem may be a Returning Patient but still be booked as a Regular Consultation.

The software may suggest Follow-up when an active follow-up recommendation exists, but the Assistant makes the final classification.

---

# 9. Appointment Core Model

Every appointment should contain at minimum:

- Appointment ID
- Patient
- Doctor
- Date
- Time
- Session
- Appointment type
- Booking source
- Status
- Created by
- Created at
- Cancellation reason where applicable
- Reschedule linkage where applicable

Appointment types:

- Regular Consultation
- Follow-up

Booking sources:

- Assistant
- Walk-in
- Admin

Future sources may include:

- WhatsApp
- Web
- Patient App

---

# 10. Appointment Status Model

V1 uses only four visible appointment states:

**BOOKED**

**CHECKED_IN**

**COMPLETED**

**CANCELLED**

Normal path:

**BOOKED → CHECKED_IN → COMPLETED**

Alternative path:

**BOOKED → CANCELLED**

A checked-in appointment may also be cancelled in exceptional circumstances if consultation does not occur.

The system must not introduce:

- Waiting
- Called
- In Consultation
- Consultation Started
- Consultation Finished

---

# 11. Visit Model

Appointment and Visit are separate concepts.

An Appointment represents a planned booking.

A Visit represents actual patient attendance.

When the Assistant checks the patient in, a Visit is created or activated for that appointment.

Example:

Appointment:

**4 October 2026, 10:20 AM**

After arrival:

**Visit: 4 October 2026**

The Visit may contain:

- Visit ID
- Appointment ID
- Patient ID
- Doctor ID
- Check-in time
- Completion time
- Visit type
- Payment reference
- Follow-up reference

A cancelled appointment that was never attended should not create a completed Visit.

---

# 12. Doctor Schedule

Owner/Admin configures clinic sessions.

Example:

**Monday**

Morning Session\
10:00 AM to 1:00 PM

Evening Session\
5:00 PM to 8:00 PM

Each session should support:

- Start time
- End time
- Appointment slot interval
- Maximum appointment capacity
- Enabled/disabled status

Example:

Start: 10:00 AM\
End: 1:00 PM\
Slot interval: 15 minutes\
Maximum capacity: 12

The time grid helps organize bookings.

Maximum capacity remains the authoritative booking limit.

---

# 13. Booking Capacity

The system must count active bookings in the relevant session.

Cancelled appointments do not consume capacity.

Example:

Maximum capacity: 15\
Booked appointments: 15

Result:

**SESSION FULL**

The Assistant should not normally be able to add appointment number 16.

Owner/Admin may override the limit.

When overriding, the system should display:

**This session is already full. Add an additional appointment anyway?**

The override must be audit logged.

---

# 14. Walk-ins

Walk-in patients are supported.

Workflow:

**Search Patient → Register if required → Add Walk-in → Select session/doctor → Create appointment → Check In**

Walk-in is a Booking Source, not a separate patient category.

If session capacity is already full, normal capacity rules apply.

Owner/Admin may override if the doctor chooses to accept the patient.

---

# 15. Appointment Creation Workflow

## Existing Patient

**New Appointment → Search Mobile → Select Existing Patient → Select Date → Select Session/Time → Select Appointment Type → Review Fee → Save**

## New Patient

**New Appointment → Search Mobile → No Patient Found → Register Patient → Select Date → Select Session/Time → Select Appointment Type → Review Fee → Save**

After successful booking, the system should offer:

**Send WhatsApp Confirmation**

---

# 16. Check-in Workflow

When a patient arrives, the Assistant opens the appointment and selects:

**Check In**

System actions:

- Appointment becomes CHECKED_IN
- Check-in time is stored
- Visit is created/activated
- Patient appears in Doctor's checked-in list

No additional queue state is required.

---

# 17. Completion Workflow

When consultation has finished, the Assistant selects:

**Complete Visit**

Before final completion, the app should show a compact completion panel containing:

- Payment status
- Follow-up required?
- Follow-up timing

The Assistant can then complete the visit.

A completed visit stores completion timestamp and completing user.

---

# 18. Payment Timing

The application should support payment before or after consultation because clinic workflow may vary.

Recommended normal workflow:

**Check-in → Payment → Consultation → Complete**

However, the software must not require payment confirmation before consultation.

Payment may remain:

**PENDING**

A Visit may be completed with payment pending when necessary.

This prevents the software from blocking real clinic operations.

---

# 19. Cancellation

Cancellation should not delete the appointment.

The appointment becomes:

**CANCELLED**

A reason is required.

V1 reasons:

- Patient Cancelled
- No Show
- Doctor Unavailable
- Rescheduled
- Other

If Other is selected, an optional short note may be entered.

Cancellation stores:

- Cancellation reason
- Cancelled at
- Cancelled by

---

# 20. No-show Handling

No-show is treated as:

**Appointment Status: CANCELLED**

**Cancellation Reason: NO_SHOW**

It is not a separate top-level appointment status.

This keeps the workflow simple while preserving analytics.

---

# 21. Rescheduling

Rescheduling is an action, not an appointment status.

When an appointment is rescheduled:

1. Original appointment becomes CANCELLED.
2. Cancellation reason becomes RESCHEDULED.
3. A new appointment is created.
4. Original and replacement appointments are linked.

Example:

Original:

3 October, 11:30 AM\
CANCELLED\
Reason: Rescheduled

Replacement:

4 October, 10:30 AM\
BOOKED

This preserves appointment history and reporting accuracy.

The Assistant normally performs rescheduling.

Owner/Admin may also perform it.

---

# 22. Doctor Unavailability

If the doctor cannot complete the remaining appointments for a session, Owner/Admin or Assistant with permission should be able to mark the session unavailable.

The system should display affected booked appointments.

The Assistant then handles cancellation or rescheduling individually.

V1 does not automatically move patients to another date.

This avoids accidental bookings into unsuitable times.

---

# 23. Follow-up Recommendation

A Follow-up Recommendation represents:

**The doctor asked the patient to return around a specific future date.**

It does not automatically mean an appointment has been booked.

The Assistant records it after consultation.

Example:

Doctor advises:

**Come after 7 days.**

Assistant records:

Follow-up required: Yes\
Interval: 7 days

System calculates:

**Follow-up due: 10 October 2026**

The Assistant may also directly select a due date where appropriate.

---

# 24. Follow-up Appointment

After recording a Follow-up Recommendation, two paths are supported.

## Book Now

Patient chooses a date/time immediately.

System creates a Follow-up Appointment linked to the recommendation.

## Book Later

Recommendation remains open with:

**Follow-up Due: 10 October**\
**Appointment: Not Booked**

When the patient later calls or arrives, the Assistant can open the pending follow-up and create the appointment.

---

# 25. Follow-up Status

The internal Follow-up Recommendation should support:

- OPEN
- BOOKED
- CLOSED

OPEN means follow-up is recommended but not booked.

BOOKED means a follow-up appointment has been linked.

CLOSED means the recommendation has been manually closed because it is no longer required or applicable.

An overdue follow-up should be calculated from due date rather than stored as another status.

Example:

Due date passed + status OPEN = Overdue.

---

# 26. Follow-up Screen

Assistant should have:

**Follow-ups**

Filters:

- Due Today
- Upcoming
- Overdue
- Booked

Example:

Rahman Ali\
Due: Today\
Appointment: Not booked

Actions:

**Book Appointment**\
**WhatsApp Reminder**\
**Close Follow-up**

---

# 27. Payment Methods

V1 supports:

- Cash
- UPI
- Pending

Card may be added later if the clinic actually requires it.

Payment record should contain:

- Payment ID
- Visit ID
- Patient ID
- Amount
- Payment method
- Payment status
- Confirmed by
- Confirmed at
- Receipt number

Payment statuses:

- PENDING
- CONFIRMED
- CANCELLED/VOID where correction is required

Payments should not be physically deleted after confirmation.

---

# 28. Consultation and Follow-up Fees

Owner/Admin configures:

- Regular Consultation Fee
- Follow-up Fee

When appointment type is selected, the system suggests the corresponding fee.

Assistant should not manually type the normal fee every time.

If fee adjustment is permitted, the change should require a reason and be audit logged.

---

# 29. UPI Configuration

Owner/Admin configures:

- UPI ID
- Payee Name

The application must generate a dynamic UPI payment QR for the specific payment amount.

Example:

Consultation Fee: ₹500

Generated QR should prefill:

- Payee
- UPI ID
- ₹500 amount
- Generic transaction reference where supported

Medical details must not be embedded into the UPI payment description.

A neutral description such as:

**Clinic Consultation**

is sufficient.

---

# 30. UPI Confirmation

V1 uses manual Assistant confirmation.

Workflow:

**Generate QR → Patient Scans → Patient Pays → Assistant Verifies → Assistant Selects Confirm Payment**

V1 explicitly does not use:

- Bank SMS
- SMS reading
- Payment notification reading
- PhonePe notification parsing
- Paytm notification parsing
- Automatic verification
- Payment gateway webhooks

The application must not display a payment as confirmed until the Assistant confirms it.

---

# 31. Cash Payment

Cash workflow:

**Select Cash → Confirm Amount Received → Payment CONFIRMED**

The confirmation stores:

- Amount
- Assistant user
- Date/time

---

# 32. Receipt

Every confirmed payment receives a unique receipt reference.

Receipt information:

- Receipt number
- Clinic name
- Doctor name
- Patient name
- Visit date
- Appointment type
- Amount
- Payment method
- Payment date/time

V1 requires the receipt record to exist digitally.

Dedicated printer integration is not required for the initial MVP.

A future version may add:

- Bluetooth printing
- Network printing
- PDF receipt sharing

---

# 33. WhatsApp V1 Strategy

V1 does not send WhatsApp messages programmatically.

Instead:

**Clinic App → Prepare Message → Open Patient Chat in Installed WhatsApp → Assistant Taps Send**

The application uses the patient's configured WhatsApp number.

The number does not need to be saved as a phone contact.

Our application never claims that WhatsApp confirmed delivery.

---

# 34. Patient Message Preference

Patient profile contains:

**Preferred Message Language**

Options:

- English
- Hindi

Also:

**Receive appointment/reminder messages: Yes/No**

If WhatsApp is on a different number:

Mobile: 98XXXXXXXX\
WhatsApp: 97XXXXXXXX

The preferred language becomes the default for all generated messages.

Assistant may temporarily change language before sending without changing the patient's saved preference.

---

# 35. V1 Message Templates

Owner/Admin can maintain reusable English and Hindi templates for:

1. Appointment Confirmation
2. Appointment Reminder
3. Appointment Cancelled
4. Appointment Rescheduled
5. Follow-up Reminder

Supported template variables should include:

- Patient name
- Doctor name
- Clinic name
- Appointment date
- Appointment time
- Follow-up due date

No diagnosis, disease, medicine, or other clinical information should be included.

---

# 36. Example English Reminder

Hello {patient_name},

This is a reminder for your appointment with {doctor_name}.

Date: {appointment_date}\
Time: {appointment_time}

Please contact the clinic if you are unable to attend.

---

# 37. Example Hindi Reminder

नमस्ते {patient_name},

यह आपके {doctor_name} के साथ अपॉइंटमेंट की याद दिलाने के लिए संदेश है।

दिनांक: {appointment_date}\
समय: {appointment_time}

यदि आप नहीं आ पाएंगे, तो कृपया क्लिनिक से संपर्क करें।

---

# 38. Reminder Tracking

Reminder records should contain:

- Reminder ID
- Patient ID
- Appointment/follow-up reference
- Reminder type
- Language
- Due date
- Status
- Sent at
- Sent by

Statuses:

- DUE
- SENT
- SKIPPED

SENT means:

**The Assistant indicated that the message was sent.**

It does not mean delivery was technically verified.

---

# 39. Appointment Confirmation Message Workflow

After appointment creation:

**Appointment Booked**

Actions:

**Send WhatsApp Confirmation**\
**Done**

If Send WhatsApp Confirmation is selected:

1. Generate message using patient language.
2. Open WhatsApp.
3. Open patient chat.
4. Prefill message.
5. Assistant taps Send.
6. Assistant returns to clinic app.
7. App asks whether message was sent.
8. Assistant marks Sent or Not Sent.

---

# 40. Reminder Dashboard

Assistant should have a dedicated Reminder screen.

Example:

**Tomorrow's Appointments: 12**\
**Sent: 7**\
**Remaining: 5**

Each due reminder displays:

Patient\
Appointment date/time\
Language\
Reminder status

Actions:

**Send WhatsApp**\
**Skip**

A batch workflow may guide the Assistant through reminders one patient at a time, but V1 should not automatically operate the WhatsApp interface.

---

# 41. Follow-up Reminder Workflow

When an OPEN follow-up reaches its due date:

Assistant sees:

**Rahman Ali**\
Follow-up due today

Actions:

**Book Appointment**\
**Send WhatsApp Reminder**\
**Close Follow-up**

WhatsApp uses the same assistant-assisted mechanism.

---

# 42. Assistant Home Screen

The Assistant home screen should prioritize current work.

Suggested layout:

**TODAY**

Appointments: 22\
Checked In: 4\
Completed: 13\
Cancelled: 2

Primary actions:

**New Appointment**\
**Walk-in**\
**Patient Search**\
**Today's Appointments**\
**Payments**\
**Follow-ups**\
**Reminders**

No large analytical dashboard is required for the Assistant.

---

# 43. Today's Appointments Screen

The screen should support useful sections or filters:

- All
- Booked
- Checked In
- Completed
- Cancelled

Each appointment card should show:

- Time
- Patient
- Appointment type
- Payment indicator where appropriate
- Reminder indicator where appropriate
- Appointment status

Assistant actions depend on status.

For BOOKED:

- Check In
- Reschedule
- Cancel
- Send Message

For CHECKED_IN:

- Payment
- Complete
- Cancel where exceptional

For COMPLETED:

- View
- Payment
- Follow-up

For CANCELLED:

- View history
- Rebook

---

# 44. Doctor Home Screen

The Doctor screen should remain low-friction.

Example:

**Today**

Appointments: 22\
Checked In: 4

Sections:

**Checked In**

10:20 Rahman Ali\
10:40 Saba Khan\
11:00 Imran Ahmed

**Upcoming**

11:20 Ayesha Khan\
11:40 Zubair Alam

The Doctor may open a patient to view:

- Name
- Age
- Mobile
- Previous visit dates
- Appointment history
- Follow-up history

No clinical notes are stored.

---

# 45. Owner/Admin Dashboard

Owner/Admin receives clinic-level information.

Today:

- Total appointments
- Checked-in count
- Completed count
- Cancelled count
- No-shows
- New patients
- Returning patients
- Follow-up appointments
- Cash received
- UPI received
- Pending amount
- Total confirmed revenue

Date filters:

- Today
- Custom date
- Week
- Month

---

# 46. Reports

V1 reports should include:

## Appointment Report

- Total booked
- Completed
- Cancelled
- No-show
- Rescheduled

## Patient Report

- New patients
- Returning patients
- Total unique patients

## Follow-up Report

- Follow-ups created
- Follow-ups booked
- Open follow-ups
- Overdue follow-ups

## Payment Report

- Confirmed revenue
- Cash
- UPI
- Pending
- Transaction count

Reports should derive from transactional data rather than manually entered totals.

---

# 47. Settings

Owner/Admin Settings should include:

## Clinic

- Clinic name
- Address
- Contact number

## Doctor

- Doctor name
- Professional display details

## Schedule

- Working days
- Sessions
- Start/end times
- Slot intervals
- Maximum capacity

## Fees

- Consultation fee
- Follow-up fee

## Payments

- UPI ID
- Payee name

## Messaging

- English templates
- Hindi templates

## Users

- Assistant accounts
- Roles
- Account status

---

# 48. Authentication

Each staff member should use their own account.

Shared generic accounts such as:

**clinic123**

for everyone should be avoided.

Minimum authentication requirements:

- Username/mobile/email identifier
- Password or secure PIN/password combination as decided during UX
- Secure backend authentication
- Ability for Owner/Admin to disable Assistant accounts
- Session logout
- Server-side authorization

Passwords must not be stored in plaintext.

---

# 49. Authorization

The backend must enforce permissions.

The frontend hiding a button is not sufficient security.

Examples:

Assistant may:

- Create appointment
- Record payment
- Send reminder

Doctor may:

- View daily patient list

Owner/Admin may:

- Change fee
- Change UPI ID
- Change schedule
- Override capacity
- Manage users

Every protected operation must be validated server-side.

---

# 50. Auditability

V1 should audit important administrative and financial actions.

At minimum:

- Patient created
- Important patient information changed
- Appointment created
- Appointment cancelled
- Appointment rescheduled
- Capacity override
- Check-in
- Completion
- Payment confirmation
- Payment correction/void
- Follow-up created
- Follow-up closed
- Fee configuration changed
- UPI details changed
- User account changed

Audit record should include:

- Action
- Entity
- User
- Date/time
- Relevant previous/new value where useful

---

# 51. Financial Corrections

A confirmed payment should not simply disappear.

If a payment was entered incorrectly, V1 should support a controlled correction such as:

**Void/Cancel Payment**

with:

- Reason
- User
- Timestamp

A corrected payment may then be entered.

This keeps financial reports traceable.

---

# 52. Duplicate Submission Protection

Mobile networks can be unreliable.

The system should protect important operations from accidental duplicate taps.

Examples:

- Appointment creation
- Payment confirmation
- Completion
- Rescheduling

Double tapping **Confirm Payment** must not create two ₹500 payments.

---

# 53. Concurrency

Two users must not be able to unknowingly book the final available appointment simultaneously.

Example:

Capacity remaining: 1

Assistant A books.

Assistant B tries immediately afterward.

Backend must reject the second booking unless an authorized override is used.

Capacity enforcement belongs in the backend/database transaction, not only on the Android screen.

---

# 54. Network Failure Behaviour

V1 is not defined as a fully offline application.

If connection is lost during a write operation:

- App must show a clear error or retry state
- App must not falsely show success
- User must be able to safely retry
- Duplicate protection must prevent duplicate records

The system may cache read-only information such as today's schedule for convenience, but full offline synchronization is outside V1 unless separately approved.

---

# 55. Error Handling

Errors shown to clinic users should be understandable.

Bad:

**HTTP 409**

Good:

**This appointment slot was just booked by another user. Please select another time.**

Bad:

**IntegrityError**

Good:

**Payment has already been confirmed for this transaction.**

Technical details may be logged separately.

---

# 56. Privacy Principles

V1 deliberately minimizes medical information.

The app should collect only information required for clinic administration.

WhatsApp messages must avoid:

- Diagnosis
- Disease names
- Medicines
- Sensitive clinical information

Lock-screen notifications from our application should also avoid unnecessary patient-sensitive content.

Access to patient and payment information should require an authenticated clinic account.

---

# 57. Proposed Screen Inventory

## Authentication

1. Login

## Assistant

2. Assistant Home
3. Patient Search
4. New Patient
5. Patient Profile
6. New Appointment
7. Date/Session Selection
8. Appointment Details
9. Today's Appointments
10. Walk-in
11. Check-in
12. Payment
13. UPI QR
14. Complete Visit
15. Cancel Appointment
16. Reschedule Appointment
17. Follow-ups
18. Follow-up Details
19. Reminders
20. WhatsApp Message Preview
21. Receipt

## Doctor

22. Doctor Today
23. Patient Summary
24. Visit History

## Owner/Admin

25. Owner Dashboard
26. Reports
27. Clinic Settings
28. Doctor Settings
29. Schedule Settings
30. Fee Settings
31. UPI Settings
32. Message Templates
33. User Management
34. Audit History

This inventory may be consolidated during UX design.

---

# 58. Primary End-to-End Workflow

## Appointment Patient

**Patient Calls**

↓

**Assistant Searches Mobile**

↓

Existing patient or register new patient

↓

**Create Appointment**

↓

Capacity validation

↓

**BOOKED**

↓

Optional WhatsApp confirmation

↓

Reminder becomes due

↓

Assistant sends WhatsApp reminder

↓

Patient arrives

↓

**CHECKED_IN**

↓

Assistant collects/confirms payment

↓

Doctor consults normally

↓

Patient comes out

↓

Assistant selects **Complete Visit**

↓

If required, record Follow-up

↓

**COMPLETED**

---

# 59. Walk-in End-to-End Workflow

**Patient Arrives Without Booking**

↓

Search/register patient

↓

**Add Walk-in**

↓

Capacity validation/override where required

↓

Appointment created with Booking Source = WALK_IN

↓

**CHECKED_IN**

↓

Payment

↓

Consultation

↓

Completion

↓

Optional Follow-up

---

# 60. Rescheduling End-to-End Workflow

**Open Appointment**

↓

**Reschedule**

↓

Select new date/session/time

↓

Validate new capacity

↓

Create replacement appointment

↓

Cancel old appointment with reason RESCHEDULED

↓

Link old and new appointments

↓

Offer WhatsApp reschedule message

---

# 61. Follow-up End-to-End Workflow

**Consultation Finished**

↓

Doctor verbally advises return after N days

↓

Assistant records Follow-up Recommendation

↓

System calculates due date

↓

Choose:

**Book Now**

or

**Book Later**

If Book Now:

↓

Create FOLLOW_UP appointment

If Book Later:

↓

Follow-up remains OPEN

↓

Due date arrives

↓

Assistant sees reminder

↓

Book appointment or send WhatsApp reminder

---

# 62. Payment End-to-End Workflow

## Cash

Visit

↓

Select **Cash**

↓

Suggested amount displayed

↓

Assistant confirms amount received

↓

Payment CONFIRMED

↓

Receipt generated

## UPI

Visit

↓

Select **UPI**

↓

Suggested amount displayed

↓

Dynamic QR generated

↓

Patient scans and pays

↓

Assistant verifies payment externally

↓

Assistant selects **Confirm Payment**

↓

Payment CONFIRMED

↓

Receipt generated

---

# 63. Message Language Workflow

During registration:

**Preferred Reminder Language**

English / Hindi

For every future message:

Patient preference

↓

Load correct language template

↓

Insert patient/date/time variables

↓

Show message preview

↓

Assistant may temporarily switch language if required

↓

Open WhatsApp

↓

Assistant sends

---

# 64. Key Acceptance Criteria

V1 will be considered functionally successful when all of the following are true:

1. Assistant can find an existing patient by mobile number.
2. Assistant can register a new patient.
3. Assistant can create an appointment.
4. Backend prevents bookings above session capacity.
5. Authorized Owner can override capacity.
6. Assistant can register a walk-in.
7. Assistant can check in a booked patient.
8. Doctor can see checked-in patients without changing queue state.
9. Assistant can mark a visit completed.
10. Assistant can cancel an appointment with a reason.
11. No-show can be recorded without introducing another top-level status.
12. Rescheduling creates a new appointment and preserves the original.
13. Assistant can record an N-day follow-up.
14. Follow-up due date is calculated correctly.
15. Follow-up may exist without an appointment.
16. Follow-up can later be converted into an appointment.
17. Cash payment can be confirmed.
18. Dynamic UPI QR can be generated using configured UPI information and amount.
19. UPI payment remains unconfirmed until Assistant confirms it.
20. Payment cannot accidentally be confirmed twice.
21. Receipt reference is generated for confirmed payments.
22. Patient can have English or Hindi messaging preference.
23. Correct message-language template is selected automatically.
24. Assistant can open patient's WhatsApp with prefilled message.
25. App does not claim WhatsApp delivery verification.
26. Reminder can be recorded as Sent or Skipped.
27. Owner can see daily financial totals.
28. Owner can see appointment/cancellation/no-show counts.
29. Each staff user has an individual account.
30. Protected Owner settings cannot be changed by an unauthorized Assistant.
31. Important administrative and financial actions are audit logged.
32. Concurrent booking cannot accidentally exceed configured capacity.

---

# 65. Architecture Boundary for Future Versions

Future booking channels must not create independent appointment systems.

The future architecture should remain:

**Android Assistant App**

**Future WhatsApp Booking**

**Future Web Booking**

**Future Patient App**

↓

**Single Appointment Service**

↓

**Single Capacity Engine**

↓

**Single Database**

This ensures that if the final appointment is booked through WhatsApp in the future, it immediately becomes unavailable everywhere else.

---

# 66. Future-Compatible Fields Worth Designing Now

Without exposing future features in V1 UI, architecture should allow:

Booking source:

- ASSISTANT
- WALK_IN
- ADMIN
- WHATSAPP
- WEB
- PATIENT_APP

Message channel:

- WHATSAPP_APP
- WHATSAPP_API
- SMS

Payment confirmation source:

- ASSISTANT
- PROVIDER_API

This prevents future migrations from becoming unnecessarily disruptive.

---

# 67. Open Product Decisions Before UX Freeze

Only a few decisions remain genuinely open.

### OD-01 Appointment Slot Interval

Recommended: configurable per session.

Examples:

10 minutes\
15 minutes\
20 minutes\
30 minutes

### OD-02 Physical Receipt Printing

Recommended V1 baseline:

Digital receipt record only.

Printer integration can be introduced after the actual clinic printer/hardware requirement is known.

### OD-03 Card Payments

Recommended V1 baseline:

Exclude unless the clinic currently accepts card payments.

Cash + UPI + Pending are sufficient initially.

### OD-04 Patient Age Entry

Recommended:

Allow either Date of Birth or approximate Age.

If DOB is known, calculate age automatically.

### OD-05 Fee Modification by Assistant

Recommended:

Assistant may change the suggested fee only with a reason, and the change is audit logged.

Owner may configure whether Assistant fee adjustment is permitted.

---

# 68. V1 Exit Gate

The Product Requirements stage may be considered frozen when the Owner approves:

- User roles
- Patient fields
- Appointment states
- Appointment scheduling model
- Capacity rules
- Walk-in rules
- Cancellation rules
- Rescheduling rules
- Follow-up model
- Payment model
- UPI workflow
- Receipt policy
- WhatsApp-assisted messaging
- English/Hindi messaging
- Reports
- Settings
- Permission model
- Audit requirements
- Remaining open decisions

After this gate, requirements should change only through explicit versioned changes rather than casual implementation-time decisions.

---

# 69. Recommended Next Engineering Stage

After approval of this baseline, proceed in this order:

**Stage 2: UX and Screen Flow Specification**

Define every screen, field, button, validation, navigation path, empty state, confirmation dialog, and error state.

Then:

**Stage 3: Domain and Data Architecture**

Define Patient, Appointment, Visit, Payment, Follow-up, Reminder, Schedule, User, Role, Audit entities and their relationships.

Then:

**Stage 4: API Contract**

Define backend endpoints, request/response models, authorization rules, idempotency, and errors.

Then:

**Stage 5: Implementation Plan**

Split backend, Android, testing, deployment, and release work into implementation milestones.

---

# 70. V1 Product Definition

**Doctor Clinic App V1 is a mobile practice-management system in which the Assistant manages patient registration, appointments, attendance, payments, follow-ups, and bilingual WhatsApp-assisted reminders, while the Doctor/Owner receives a simple operational and business view without requiring digital clinical documentation or queue-state management.**

This definition is the boundary against which future feature requests should be evaluated.
