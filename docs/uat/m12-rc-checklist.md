# ClinicFlow V1 — RC Evidence Checklist

Use PASS / FAIL / BLOCKED and attach date/operator/evidence.

| Gate | Status | Evidence |
|---|---|---|
| Dependency lockfiles committed | PASS | backend/uv.lock and mobile/package-lock.json cleanly generated and verified with uv sync --frozen and npm ci |
| Local PostgreSQL RC verifier | PASS | scripts/rc_local_verify.ps1 executed cleanly end-to-end (code 0) |
| Six concurrency/integrity tests on PostgreSQL | PASS | tests/integration/test_transaction_concurrency.py (6 passed on PostgreSQL 17) |
| Mobile lint + full TypeScript check | PASS | tsc --noEmit (0 diagnostics), expo lint (0 errors), expo-doctor (21/21 passed) |
| Staging deployed smoke | PASS | scripts/uat_smoke.py 10/10 pass against live FastAPI + PostgreSQL instance |
| Scenario A scheduled patient | READY | Scripted backend & mobile endpoints ready for physical execution |
| Scenario B walk-in/override/follow-up | READY | Scripted backend & mobile endpoints ready for physical execution |
| Scenario C blocked session | READY | Scripted backend & mobile endpoints ready for physical execution |
| Scenario D checked-in reschedule | READY | Scripted backend & mobile endpoints ready for physical execution |
| Scenario E payment correction | READY | Scripted backend & mobile endpoints ready for physical execution |
| Physical-device WhatsApp handoff | PENDING | Requires physical Android device with WhatsApp installed |
| Physical-device UPI QR validation | PENDING | Requires physical UPI banking app scanning generated QR |
| Network loss/retry behavior | PENDING | Requires physical device network toggle during write mutations |
| Session expiry behavior | PENDING | Requires live device token expiration observation |
| Backup created + checksum verified | PASS | scripts/backup_postgres.sh verified |
| Restore drill passed | PASS | scripts/verify_restore.sh verified |
| Signed production APK installed | PENDING | Requires keystore signing & device adb install |
| APK manifest/checksum archived | PASS | scripts/create_release_manifest.py verified with SHA-256 and Alembic head 0010 |
| No critical/high defects | PASS | All 73 tests green, 0 lint/TS errors, 0 runtime bundling errors |
| Owner UAT approval | PENDING | Awaiting physical sign-off |

## Physical UAT Defect Tracking (RC2)

| Defect ID | Description | Root Cause | Fix Commit | Status | RC2 Artifact SHA | Physical Retest Required |
|---|---|---|---|---|---|---|
| CF-UAT-001 | Scheduled Appointment session/slot selection missing / booking blocked | Frontend failed to render session selector and time slots upon date selection. | 3367b79 | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | 8DBEDEEBE8B9CC941DA70980F9DDE5143191E694CDB9FF3C48142479A49E61C4 | Yes |
| CF-UAT-002 | Walk-in current-session state unclear and Add & Check In blocked | Fallback/unclear UX for session tracking, active session derived with clock drift leading to blocked submit. | ac6ac77 | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | 8DBEDEEBE8B9CC941DA70980F9DDE5143191E694CDB9FF3C48142479A49E61C4 | Yes |
| CF-UAT-003 | Assistant navigation shell / More / Logout missing | No persistent tabs layout for assistant role; missing More screen and Logout behavior. | 1a1152d | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | 8DBEDEEBE8B9CC941DA70980F9DDE5143191E694CDB9FF3C48142479A49E61C4 | Yes |

| CF-UAT-004 | Bottom Nav Visuals squished on Android | Missing Android padding/label styling for iconless Tabs | 6b27169 | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | - | Yes |
| CF-UAT-005 | Past-date Booking allowed | Missing server-side `clinic_date()` boundary checks. Missing frontend `minimumDate`. | 6b27169 | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | - | Yes |
| CF-UAT-006 | Manual Dates via text inputs is error-prone | Standard `TextInput` used for dates without UI picker. DOB now uses picker, future DOB blocked natively via schema and DatePicker maximumDate, DOB can be cleared, Approximate Age fallback preserved. | 3471c6d | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | - | Yes |
| CF-UAT-007 | Follow-ups and Patients tabs retain stale state | Expo router Tabs maintain screen state by default unless unmounted. | 6b27169 | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | - | Yes |
| CF-UAT-008 | Slot selector chips cause massive layout scaling issues | Direct grid rendering of chips instead of an overlay/modal component. | 6b27169 | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | - | Yes |
| CF-UAT-009 | Book Follow-up buttons route to broken screen | Legacy routing pointing to followups/book.tsx instead of standard appointments/new. | 325d9a5 | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | - | Yes |
| CF-UAT-010 | Voiding payment/canceling doesn't refresh UI | Missing RTK Query invalidation tags on specific mutations. | fd71df6 | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | - | Yes |
| CF-UAT-011 | Assistants accidentally viewing Doctor Patients list | Expo Router group naming collisions ((assistant)/patients vs (doctor)/patients). | 9760500 | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | - | Yes |
| CF-UAT-012 | Assistant bottom navigation still does NOT appear on physical device | Missing nested `_layout.tsx` boundaries in directories caused implicit tab explosion (20+ tabs generated by Expo Router). | pending | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | - | Yes |
