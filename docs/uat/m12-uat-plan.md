# ClinicFlow V1 — M12 UAT / Release Candidate Plan

M12 is the final evidence gate. It does not add clinic workflow features. A release candidate is not approved merely because source code compiles.

## Gate 0 — Reproducible dependencies

Before RC testing:

- generate and commit `backend/uv.lock` using the approved dependency set;
- generate and commit `mobile/package-lock.json`;
- use `uv sync --frozen --dev` and `npm ci` for RC verification.

These lockfiles cannot be generated in the current execution sandbox because package registries are unavailable. Missing lockfiles are therefore a **release blocker**, not something to silently ignore.

## Gate 1 — Automated local verification

Run either:

```text
scripts/rc_local_verify.sh
```

or on Windows PowerShell:

```text
.\scripts\rc_local_verify.ps1
```

It creates a temporary PostgreSQL database, applies all Alembic migrations, runs Ruff, all unit tests and real concurrency/integrity tests, then runs mobile lint and TypeScript checks using the lockfiles.

Expected concurrency evidence:

- one winner for the final normal slot/capacity;
- one Visit for two simultaneous check-ins;
- one Receipt for two simultaneous payment confirmations;
- failed reschedule leaves original untouched;
- same idempotency key creates one resource;
- audit UPDATE rejected by PostgreSQL.

## Gate 2 — Staging deployed smoke

Deploy a clean staging database with fake data and run:

```text
python scripts/uat_smoke.py --base-url https://staging.example.com --login <owner-login>
```

This is deliberately read-only except for authentication session creation/logout.

## Gate 3 — Real Android device

Install the intended internal-test APK on at least one representative Android device and verify:

- cold launch and session restore;
- login/logout and temporary-password change;
- SecureStore session survives app restart;
- session expiry returns to Login cleanly;
- mobile-data/Wi-Fi loss shows retryable errors without false success;
- unknown/dead deep link opens the safe recovery screen;
- background → foreground refresh behavior;
- app version/build visible under About ClinicFlow.

## Clinic scenario A — Returning scheduled patient

1. Search existing patient by mobile.
2. Book an available regular appointment.
3. Review appointment fee snapshot.
4. Open WhatsApp confirmation and manually send.
5. Process the normal reminder when due.
6. Check in on the appointment date.
7. Confirm Cash payment.
8. Verify unique digital receipt.
9. Complete Visit without follow-up.
10. Verify dashboard/report/audit results.

Expected: one Appointment, one Visit, one confirmed Payment, one Receipt, correct audit trail.

## Clinic scenario B — New walk-in + override + follow-up

1. Register a new patient.
2. Fill the current session to capacity in staging.
3. Attempt normal walk-in and verify it is rejected.
4. Owner explicitly overrides with a reason.
5. Generate UPI QR and verify payee/amount in a UPI-capable scanner/app.
6. Manually confirm payment only after verification.
7. Complete Visit with 7-day follow-up.
8. Save Follow-up only, then later book it.

Expected: override metadata/audit preserved; no fake walk-in slot; UPI is never auto-confirmed; follow-up moves OPEN → BOOKED.

## Clinic scenario C — Doctor unavailable

1. Create multiple future appointments in one session.
2. Block that date/session.
3. Verify affected appointments remain unchanged.
4. Verify their unsent reminders are suppressed while blocked.
5. Reschedule one and cancel one with Doctor Unavailable.
6. Verify reschedule history and WhatsApp update/cancellation preparation.

Expected: no automatic bulk moves; blocked occurrence remains explicit; old reschedule reminder becomes obsolete.

## Clinic scenario D — Checked-in patient cannot wait

1. Book and check in patient.
2. Leave Payment PENDING.
3. Reschedule to a future slot.

Expected atomically: old Appointment CANCELLED/RESCHEDULED, Visit ABORTED, old PENDING Payment CANCELLED, replacement BOOKED.

Repeat with a CONFIRMED payment. Expected: reschedule rejected until authorized financial correction/VOID occurs.

## Clinic scenario E — Financial correction

1. Check in patient and confirm payment.
2. Verify receipt.
3. Owner VOID payment with reason and create replacement.
4. Confirm replacement.
5. Verify original Payment/Receipt remain visible historically and replacement receives a different receipt number.
6. Verify reports include only current confirmed revenue and preserve void count.

## Gate 4 — WhatsApp

On a real device with WhatsApp installed:

- correct unsaved patient number opens;
- message is prefilled in correct EN/HI language;
- temporary language switch does not change patient preference;
- ClinicFlow never presses Send itself;
- return confirmation records SENT only after Assistant assertion;
- invalid/unavailable WhatsApp path offers Copy Message;
- no diagnosis/medicine/clinical detail appears.

## Gate 5 — UPI

With staging/test-safe configuration:

- QR encodes configured UPI ID/payee;
- amount exactly equals authoritative Payment amount;
- neutral note only;
- QR opens/scans in a real UPI-capable app where feasible;
- no patient/medical content in UPI URI;
- payment remains PENDING until explicit Assistant confirmation.

## Gate 6 — Backup/restore drill

1. Run `scripts/backup_postgres.sh`.
2. Verify generated checksum.
3. Copy backup to separate protected storage.
4. Run `scripts/verify_restore.sh <backup>`.
5. Record restored Alembic revision and critical row counts.

The release fails this gate if restore has not actually been demonstrated.

## Gate 7 — Signed production APK

Build the exact production APK intended for clinic use. Verify:

- application ID `com.clinicflow.app`;
- version/versionCode match release notes;
- correct production HTTPS API URL;
- no development credentials or secrets embedded;
- signing key is backed up separately and not in Git;
- install/upgrade succeeds on the target device;
- APK SHA-256 is recorded using `scripts/create_release_manifest.py`.

## Final RC decision

A ClinicFlow V1 release candidate is acceptable only after all above gates have recorded evidence and no critical/high defect remains. Current source preparation does **not** by itself certify these external/device gates.
