# CF-12 / CF-13 operational worklists

Follow-up sections and the Reminders screen load 50 records at a time using the
existing `limit`, `offset`, and `total` API contract. Each section has its own
Load more control. Backend ordering retains its existing priority keys and adds
the record UUID as a final tie-breaker.

RTK Query owns the pages in one infinite-query cache entry per filter. There is
no component-managed appended array. `refetchCachedPages: false` resets refreshes
and tag invalidations to the first page; subsequent pages can be loaded again.
Filter-specific `currentData` prevents rendering another filter's records, and
mount/argument changes refetch from page one. Pull-to-refresh uses the same path.
Rows are deduplicated by ID. Failed requests show Retry; page-N failures preserve
loaded rows, and failed refreshes explicitly label retained data as potentially
out of date. An error is never presented as an empty worklist.

## Cache dependencies

Both regular list queries and infinite worklists provide their domain LIST tag
plus IDs of returned records. Follow-up details provide their entity tag.

| Mutation | Follow-up invalidation | Reminder invalidation |
| --- | --- | --- |
| Book / close follow-up | LIST + supplied ID | LIST |
| Cancel / reschedule appointment | Entire FollowUp tag, including details | LIST |
| Complete visit | LIST + returned closed recommendation ID | LIST |
| Create / check in appointment | Existing follow-up tags unchanged | LIST |
| Block / unblock session or exception | None | LIST (sendability changes) |
| Prepare reminder | None | Reminder ID |
| Mark sent / skip reminder | None | Reminder ID + LIST |
| Create appointment message | None | LIST |

Cancellation can clear the follow-up link before building its response, so it
uses domain-wide FollowUp invalidation instead of guessing an ID. Active details
refetch; invalidated inactive entries are removed and fetched again on return.
There is no separate reminder-detail query; filtered reminder lists share LIST
and entity tags. Existing appointment, schedule, payment, visit and report tags
are retained.

The installed RTK Query 2.13 implementation does not include infinite requests
in its delayed-invalidation pending counter. A shared mutation lifecycle helper
reapplies worklist LIST tags after overlapping page requests settle. This prevents
a skipped refetch from attaching a late page after a mutation. It does not poll
or put mutation-specific refetch logic in screens.

## Verification and limits

Node tests execute real RTK Query endpoints, reducers and middleware against a
controlled HTTP transport. Screen tests render the actual TSX through the
existing native-host adapter, bridging hook results to those real selectors and
dispatchers. They cover multi-page reachability, retries, filter separation,
refresh, lifecycle invalidation, active/inactive details and stale-tail removal.
PostgreSQL tests traverse 55 matching records with tied timestamps and verify
filtering and deterministic page boundaries.

Offset pagination is not a database snapshot across requests. Changes from other
clients may shift page boundaries; refresh/reopening reloads the first page.
This batch adds no SSE or polling. Physical Android interaction remains a UAT
check; automated rendering does not substitute for a device test.
