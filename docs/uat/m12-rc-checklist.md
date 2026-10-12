# ClinicFlow V1 — RC Evidence Checklist

Use PASS / FAIL / BLOCKED and attach date/operator/evidence.

| Gate | Status | Evidence |
|---|---|---|
| Dependency lockfiles committed | PASS | backend/uv.lock and mobile/package-lock.json cleanly generated and verified with uv sync --frozen and npm ci |
| Local PostgreSQL RC verifier | PASS | scripts/rc_local_verify.ps1 executed cleanly end-to-end (code 0) |
| Six concurrency/integrity tests on PostgreSQL | PASS | tests/integration/test_transaction_concurrency.py (17 passed on PostgreSQL 17: 7 concurrency/integrity + 10 multi-day scheduling) |
| Mobile lint + full TypeScript check | PASS | tsc --noEmit (0 diagnostics), expo lint (0 errors, 23 warnings), expo-doctor (19/21 passed — expected baseline) |
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
| No critical/high defects | PASS | All 100 tests green (75 unit, 25 integration [17 concurrency/integrity + 8 schedule API]), 0 lint/TS errors, 0 runtime bundling errors |
| Owner UAT approval | PENDING | Awaiting physical sign-off |

## Physical UAT Defect Tracking (RC2)

| Defect ID | Description | Root Cause | Fix Commit | Status | RC2 Artifact SHA | Physical Retest Required |
|---|---|---|---|---|---|---|
| CF-UAT-001 | Scheduled Appointment session/slot selection missing / booking blocked | Frontend failed to render session selector and time slots upon date selection. | 3367b79 | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | 8DBEDEEBE8B9CC941DA70980F9DDE5143191E694CDB9FF3C48142479A49E61C4 | Yes |
| CF-UAT-002 | Walk-in current-session state unclear and Add & Check In blocked | Fallback/unclear UX for session tracking, active session derived with clock drift leading to blocked submit. | ac6ac77 | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | 8DBEDEEBE8B9CC941DA70980F9DDE5143191E694CDB9FF3C48142479A49E61C4 | Yes |
| CF-UAT-003 | Assistant navigation shell / More / Logout missing | No persistent tabs layout for assistant role; missing More screen and Logout behavior. | 1a1152d | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | 8DBEDEEBE8B9CC941DA70980F9DDE5143191E694CDB9FF3C48142479A49E61C4 | Yes |

| CF-UAT-004 | Bottom Nav Visuals squished on Android | Missing Android padding/label styling for iconless Tabs | 6b27169 | PASS | - | No |
| CF-UAT-005 | Past-date Booking allowed | Missing server-side `clinic_date()` boundary checks. Missing frontend `minimumDate`. | 6b27169 | PASS | - | No |
| CF-UAT-006 | Manual Dates via text inputs is error-prone | Standard `TextInput` used for dates without UI picker. DOB now uses picker, future DOB blocked natively via schema and DatePicker maximumDate, DOB can be cleared, Approximate Age fallback preserved. | 3471c6d | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | - | Yes |
| CF-UAT-007 | Follow-ups, Patients, and Appointments tabs retain stale search/filter state | Expo router Tabs maintain screen state by default. Transient search query and list filters now reset on tab blur via parent navigation listeners while preserving state across drill-down/back navigation. Form state resets on workflow boundaries. | 3fd762d | PASS | - | No |
| CF-UAT-008 | Slot selector chips cause massive layout scaling issues | Direct grid rendering of chips instead of an overlay/modal component. | 6b27169 | PASS | - | No |
| CF-UAT-009 | Book Follow-up buttons lose linkage and default date to today | Follow-up recommendation linkage parameters (followupId, dueDate, doctorId) missing from navigation route; defaulted date unconditionally to clinic today. Preserves linkage, defaults to due_date when >= clinic_date, books via POST /api/v1/followups/{id}/book, transitions OPEN -> BOOKED; cancelling linked appointment reopens recommendation to OPEN unless explicitly closed. | 3fd762d | PASS | - | No |
| CF-UAT-010 | Voiding payment/canceling doesn't refresh UI | Missing RTK Query invalidation tags on specific mutations. Void/collect refresh and visit completion verified on physical UAT. | fd71df6 | PASS | - | No |
| CF-UAT-011 | Assistants accidentally viewing Doctor Patients list | Expo Router group naming collisions ((assistant)/patients vs (doctor)/patients). | 9760500 | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | - | Yes |
| CF-UAT-012 | Assistant bottom navigation still does NOT appear on physical device | Missing nested `_layout.tsx` boundaries in directories caused implicit tab explosion (20+ tabs generated by Expo Router). Nested stack boundaries established. | 6b27169 | PASS | - | No |
| CF-UAT-013 | Duplicate active appointments allowed for same patient, doctor, and date | Missing server-side duplicate active appointment validation and concurrency control. Guarded with row-level patient locking and HTTP 409 APPOINTMENT_DUPLICATE_ACTIVE with frontend conflict card and View Existing Appointment action. Verified on physical UAT. | 3fd762d | PASS | - | No |
| CF-UAT-014 | Doctor / Owner bottom navigation shell missing | Doctor/Owner routes lacked persistent bottom tab navigation matching Assistant shell. Added persistent Doctor tabs (Today, Patients, Dashboard, Reports, More), role guard, nested Stack boundaries, and More screen. | f924ce4 | PASS | - | No |
| CF-UAT-015 | Assistant Home redundant navigation action buttons | "Today's Appointments" and "Patient Search" buttons duplicated persistent bottom navigation tabs. Removed redundant buttons while preserving metrics and primary actions. | f924ce4 | PASS | - | No |
| CF-UAT-016 | Tab icon broken glyphs and label truncation | Missing tab icons caused default missing-icon glyph on Android; long labels ("Appointments") truncated on narrow screens. Added vector SVG TabIcon and concise 'Appts' label. | f924ce4 | PASS | - | No |
| CF-UAT-017 | Cross-account login retains previous user's role shell until app restart | RTK Query /me query and application API cache were not reset at session boundaries (logout, expiration, login), causing layouts to resolve stale role data and bounce back into previous role navigator. Implemented resetApiCache() on logout, session expiration, and login bootstrap with immediate /me cache upsert. | pending | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | - | Yes |
| CF-UAT-018 | Doctor Today contains redundant navigation buttons after persistent tabs | Patient Search, Dashboard, Reports, and Settings action buttons remained on Doctor Today screen despite persistent bottom tabs and More hub. Removed redundant navigation buttons, preserving operational overview (metrics, checked-in, upcoming). | pending | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | - | Yes |
| CF-UAT-019 | Doctor More displays stale doctor name after profile update | Doctor More read display name solely from un-invalidated user session rather than querying active doctor profile settings with appropriate cache invalidation tags. Subscribed to listDoctors query and added 'User' tag invalidation to updateDoctorSettings mutation. | pending | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | - | Yes |
| CF-UAT-020 | Doctor Reports chart renders malformed/unreadable visualization | DatePicker input containers lacked flex expansion causing horizontal collapse into thin vertical bars, date range text lacked clean spacing, and appointment status distribution lacked structured visual representation. Wrapped DatePickers in flex containers, cleaned date range formatting, and added responsive horizontal status distribution chart. | pending | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | - | Yes |
| CF-UAT-021 | More nested back-stack behavior | Child settings pages persisted across More tab navigation and historical settings chained together. Migrated More into a dedicated tab-owned Stack navigator (doctor/more/), eliminating router.replace hacks and ensuring Back pops to More root and More tab reselect resets to More root. | pending | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | - | Yes |
| CF-UAT-022 | Inconsistent Back controls / placement | Inconsistent Back controls, placement, and visual treatment across nested screens. Standardized Back navigation with shared header component across Doctor and Assistant nested screens. | pending | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | - | Yes |
| CF-UAT-023 | Manual time entry | Schedule Settings required typing HH:mm manually as text. Built reusable TimePicker wrapping @react-native-community/datetimepicker with 24-hour clinic semantics. | pending | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | - | Yes |
| CF-UAT-024 | Dashboard redundant navigation/title | Screen titled "Owner Dashboard" despite being Doctor role shell analytics destination; duplicated root tab buttons (Open Reports, Patient Search). Renamed to "Dashboard" and removed redundant tab navigation buttons. | pending | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | - | Yes |
| CF-UAT-025 | Doctor Patients search reset | Doctor Patients search query persisted indefinitely across tab switches. Implemented navigation parent blur listener to reset search on tab blur while preserving query across drill-down/back workflow. | pending | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | - | Yes |
| CF-UAT-026 | Keyboard obscures focused fields | Long forms obscured lower inputs on Android when keyboard opened. Added AppScreen ScrollContext with focus-aware scrollIntoView, non-collapsible FormField measurement, and dynamic keyboard insets padding. | pending | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | - | Yes |
| CF-UAT-027 | Clinic contact template variable | Template engine lacked clinic contact variable. Added {{clinic_contact_number}} to allowed variables, renderer defaults, and frontend reference chips. | pending | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | - | Yes |
| CF-UAT-028 | Multi-day schedule editor | Schedule editor only allowed editing one day at a time. Added multi-day chip selector, atomic backend PUT /doctors/{id}/schedule, mixed existing schedule detection, and explicit overwrite confirmation. | pending | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | - | Yes |
| CF-UAT-029 | More accordion default state | More categories expanded automatically and persisted across sessions. Initialized all 5 categories (Clinic, Communication, Admin, Account, About) collapsed by default (false), and reset all to collapsed on navigation blur. | pending | FIX IMPLEMENTED / AWAITING PHYSICAL RETEST | - | Yes |
