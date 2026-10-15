# V1 UI polish

Baseline: `main`, `beb4fc8`. This pass preserves the existing brand, routes,
permissions, keyboard containers, mutation contracts and domain lifecycles.

## Audit and decisions

| Area | Observed issue | Refinement |
| --- | --- | --- |
| Doctor Today | No live clock; counters derived from bounded lists | Clinic-synchronized clock, compact greeting, session summaries, accurate counts independent of display limits |
| Assistant Home | Attention actions below patient lists | Bring payment/reminder/follow-up work forward; disclose bounded previews |
| Navigation / Settings | Settings used More icon and a device-time greeting; nested scrolling | Settings icon and heading, supported accordion groups retained, one scroll container |
| Dashboard / Reports | No selected range state; range validation and partial-query errors unclear | Shared Today/Week/Month/Custom controls, labeled native calendars, explicit range, per-query Retry |
| Patient history | Doctor view has real but bounded completed-visit history | Label recent completed visits and show loaded versus total; retain Assistant's truthful visit summary |
| Worklists / details | Several fetch failures looked empty, missing, or silently unavailable | Small QueryState presentation component; errors and retained-data warnings; Retry without clearing existing results |
| Dates | Native picker parsed ISO dates as UTC; audit/receipt timestamps used device timezone | Calendar-field construction for pickers; readable calendar dates and explicit clinic timezone for timestamps |
| Forms / buttons | Loading buttons lost accessible names; fields did not inherit labels | Accessible names and busy/disabled states; preserve keyboard-safe architecture and existing save validation |

The route inventory included Doctor Today, Patients/history, Dashboard, Reports,
Settings and its subroutes, weekly scheduling and exceptions; Assistant Home,
Appointments and booking/check-in/completion, Patients, Follow-ups, Reminders,
Payments and More; authentication and shared layouts/components. Weekly-editor
review/apply behavior, booking decisions, mutation rules and form reset/navigation
flows were retained. The Reports screen already used structured sections: no
literal backslash-n formatting defect was present.

## Clock and summary

The clock starts from `/clinic/time`'s `clinic_now`, using `timezone` explicitly.
Elapsed time since the RTK response advances locally every second. Synchronization
and the Today read refresh occur once per minute while subscribed, with explicit
app-resume synchronization and pull-to-refresh. No per-second HTTP request or
whole-app polling was added. A failed sync leaves a visibly marked retained clock.

Appointment totals include all statuses for the clinic date. Checked In counts
only current CHECKED_IN appointments. Upcoming includes only timed future BOOKED
appointments; the client removes elapsed entries between read refreshes. The
existing 100-row preview limits remain and are disclosed. A small read-only
backend correction computes totals independently of those limits. The API shape,
database schema, Dashboard calculations and Reports calculations are unchanged.

## Verification and device review

Behavior tests cover clock rollover/ticking/resume/cleanup, summary filters,
rendered Today cards and navigation, preset/custom ranges, native calendar date
selection, timezone-safe formatting, partial report errors, truthful history,
Settings and both role tab labels, and error-versus-empty worklists. Existing
worklist tests retain their lifecycle/cache assertions with readable-date display
expectations. PostgreSQL verifies counts beyond 100 and exclusion of past,
completed, cancelled and untimed appointments from Upcoming.

Physical Android/iOS UAT remains required for narrow-screen tab labels, large
text, live clock/resume/day rollover, native date pickers, long lists, and keyboard
visibility. Automated native-host rendering does not validate device geometry.
No appointment numbering scheme exists in the inspected contracts; none was added.
No EMR timeline, SSE, signing, dependency upgrade or deployment hardening was added.

Existing limits remain: Today previews 100 rows per section, Assistant Home
previews five future and eight checked-in appointments, patient history defaults
to 30 completed visits, and other clients' changes require refresh. Production
networking, observability, dependency remediation and signing remain separate work.
