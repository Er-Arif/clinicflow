# Reusable form keyboard visibility

The Block a Date keyboard implementation passed physical Android UAT before this
extraction. The shared implementation preserves its measured Android overlap,
native input measurements, layout retries, nonanimated scroll correction, and
iOS `KeyboardAvoidingView` padding. This extraction and the other migrated forms
still require physical regression testing.

## Inventory before extraction

There were 25 routes with keyboard-editable inputs. Twenty-three used `AppScreen`,
which added the whole keyboard height to content padding and used timed scrolling
with a fixed clearance. Its focus context was used only by `FormField`; raw
`TextInput` instances, including Reset Password, never registered a focused input.
All of these forms were potentially obstructed. Reset Password was confirmed on
device. Block a Date was the only form with a direct ScrollView, route-specific
keyboard listeners, and pinned Save/Cancel actions. Login used a non-scrolling
SafeAreaView. No input route was inside another scrolling layout wrapper.

Paths below are relative to `mobile/app`. All listed editable branches now use
`KeyboardSafeFormScreen` and registered inputs. Existing loading, error, and
completed branches without inputs keep `AppScreen`.

| Routes | Existing input/container | Migration |
| --- | --- | --- |
| `(auth)/login.tsx` | Raw inputs; SafeAreaView | Scrollable form; centered content retained |
| `(auth)/change-password.tsx` | Raw inputs; AppScreen | Current/new/confirm password |
| `doctor/more/users/new.tsx`, `doctor/more/users/[userId].tsx` | Raw inputs; AppScreen | Create/edit user and Reset Password |
| `assistant/patients/new.tsx`, `assistant/patients/edit.tsx` | PatientForm → FormField; AppScreen | Shared patient fields register automatically |
| `assistant/patients/index.tsx`, `doctor/patients/index.tsx` | Raw search inputs; AppScreen | Search forms, including assistant autofocus |
| `assistant/appointments/new.tsx` | Raw override reason; AppScreen | Booking form; input-free slot modal unchanged |
| `assistant/appointments/review.tsx` | Raw fee/reason inputs; AppScreen | Review and fee adjustment |
| `assistant/appointments/[appointmentId].tsx` | Conditional raw cancellation reason; AppScreen | Appointment action form |
| `assistant/appointments/reschedule.tsx` | Raw reason; AppScreen | Rescheduling; input-free slot modal unchanged |
| `assistant/appointments/availability.tsx` | Raw date input; AppScreen | Availability date form |
| `assistant/appointments/complete.tsx` | Conditional raw interval input; AppScreen | Follow-up interval form |
| `assistant/walk-in.tsx` | Raw patient search, override and fee inputs; AppScreen | Walk-in form |
| `assistant/followups/book.tsx`, `assistant/followups/[followupId].tsx` | Raw date/override/closure inputs; AppScreen | Follow-up forms |
| `assistant/payments/[paymentId].tsx` | Conditional raw void reason; AppScreen | Payment correction form |
| `doctor/more/messages.tsx` | Repeated multiline raw inputs; AppScreen | Message-template editors |
| `doctor/more/clinic.tsx`, `doctor/more/doctor.tsx` | Raw single/multiline inputs; AppScreen | Clinic and doctor details |
| `doctor/more/upi.tsx` | Raw UPI/payee inputs; AppScreen | UPI settings |
| `doctor/more/fees.tsx` | FormField; AppScreen | Fee settings |
| `doctor/more/audit/index.tsx` | Raw action/entity filters; AppScreen | Audit filter form |
| `doctor/more/schedule/exceptions/new.tsx` | FormField; dedicated measured viewport and pinned footer | Same hierarchy and actions through shared container |

Weekly Working Hours, the schedule hub, exceptions list, read-only details,
dashboards, date-picker-only screens, and navigation shells were not migrated.
The nested ScrollViews in the two Settings navigation menus contain no editable
inputs and were left untouched. Bottom-tab keyboard hiding remains unchanged.

## Boundaries and usage

- `KeyboardSafeFormScreen` owns one scrollable viewport, keyboard listeners,
  Android overlap padding, optional `footer`, pull-to-refresh, and iOS avoidance.
  Use it as the screen container, not inside AppScreen or another ScrollView.
- `KeyboardSafeTextInput` forwards native props/ref and composes focus, blur,
  layout, content-size, and selection handlers. It supplies no visual defaults.
- `FormField` uses that input adapter, preserving its labels, errors, multiline
  styles, optional `inputRef`, and consumer callbacks (including form validation).
- `components/keyboard/visibility.ts` is the canonical geometry/controller.
  Native measurements and frame scheduling are injected for deterministic tests.
- `AppScreen` remains a plain container for read-only content. It has no keyboard
  subscriptions or duplicate visibility implementation. No root-level behavior or
  native configuration was added.

```tsx
<KeyboardSafeFormScreen footer={<ExistingActionFooter />}>
  <FormField label="Reason" multiline value={reason} onChangeText={setReason} />
  <KeyboardSafeTextInput style={existingStyle} value={name} onChangeText={setName} />
</KeyboardSafeFormScreen>
```

Android reserves only `max(0, viewportBottom - keyboardTop)`, capped to viewport
height. A root that already resized needs no additional inset. The measured native
ScrollView bounds exclude the pinned footer, so the focused input is scrolled only
by its actual overflow. Layout events retry after keyboard, footer, tab-bar, or
content-size changes; no fixed timers or device-specific keyboard heights exist.

Only the focused input can request scrolling. Blur/ref detachment unregister it;
stale measurement callbacks are ignored. Manual scroll events update position
without scheduling a correction. Keyboard dismissal restores the inset. Long
multiline editors are capped to the measured viewport and retain native internal
scrolling; smaller existing caps, including Reason's 110px cap, are preserved.

## Verification and device regression

Node tests exercise geometry, keyboard/layout event sequencing, footer-reduced
viewports, multiline growth, focus switching, stale measurements, cleanup, iOS
inset ownership, and manual scrolling. Route integration checks cover all 25
editable routes, Reset Password, and Block a Date. Scheduling business assertions
remain in place. These tests do not simulate Android IME rendering.

Verification on 2026-10-14: Ruff passed; TypeScript passed; mobile tests passed
38/38; lint passed with 0 errors and 21 existing warnings; full local RC verification
passed, including migrations and 135 backend tests. Expo Doctor passed 19/21 checks:
the existing native-config synchronization warning and version mismatches for
datetimepicker, Expo, expo-constants, expo-linking, and expo-router remain outside
this change. No dependencies or native configuration were changed. No commit or
APK build was made.

Physical Android priorities:

1. Block a Date: single/multiple sessions, existing-booking warning, Reason to 300
   characters, Save/Cancel, keyboard close/reopen, and hidden bottom tabs.
2. Reset Password: focus the temporary password then reason; type without manual
   scrolling and verify existing password masking and action availability.
3. New/edit patient: phone, WhatsApp, approximate age, switching fields and keyboard types.
4. Message templates: later templates, long multiline text, selection/caret movement.
5. Appointment create/review/reschedule, walk-in fee adjustment/override, follow-up,
   and payment-void reason: exercise conditional fields near the bottom.
6. Clinic/doctor multiline details, fee/UPI settings, user creation, login/password
   change, patient search autofocus, and audit filters.

For each, also check manual scrolling, Android Back dismissal, keyboard-height
changes, and navigation away/back. Smoke-test iOS focus and dismissal separately.
