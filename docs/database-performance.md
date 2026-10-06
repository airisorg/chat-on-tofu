# Database performance, 2026-10-06

Ordinary history reads now execute five application SQL statements instead of eight. Empty histories use four instead of seven. Each request still verifies identity, enforces the database-backed quota, and reads current membership. These statement counts exclude BEGIN/COMMIT and the separate API quota queries; they are not a claim of 37.5% less database CPU or total service cost.

## Bounded history selection

The follow-up in `361b39ecfbd8eaf206c6e24d45d9b881a70cea51` selects indexed message IDs and ordering keys before fetching message payloads. After choosing the globally newest 2,000 IDs, a correlated `LATERAL ... LIMIT 1` reads each selected message. Selection and hydration remain in the same SQL statement and snapshot. This changes no schema, index, statement count, membership predicate, thread context, byte limit, pool setting, authentication check or mutation lock.

A simpler ordinary join was rejected: its native plan traversed 52,000–68,199 message rows, including unrelated history, and made a single busy conversation 12–20% slower. The accepted query used at most 2,000 one-row primary-key lookups in the large fixtures. Small tables can still use a sequential scan; planner choice is not a universal index guarantee.

Two measurement layers separate database behavior from the complete route:

- A paired native PostgreSQL 15.19 diagnostic used four fixtures, each with freshly inserted and explicitly vacuumed rows. Each phase alternated 24 baseline/candidate pairs after warmups. Ten conversations with 2,000 messages each improved full state assembly by 13–18%. The single 2,000-message control was unchanged fresh and 0.445 ms slower after vacuuming. Exact state objects, both global-ID selection oracles, thread roots and attachment metadata matched.
- The complete production Next route ran in an isolated local process with the actual Supabase SDK, a synthetic HTTPS identity provider and disposable native PostgreSQL. Baseline A1, candidate B and baseline A2 used separately bound production builds, identical deterministic fixtures and the same harness. Eight fixtures produced 480 measured sequential requests in total. The timer ends after consuming the entire HTTP body; it includes authentication handling, atomic quota writes, transactions, state assembly and final response serialization. Client-side JSON parsing and assertions are outside the timer.

Full-route sequential medians, milliseconds. The before column pools the raw A1 and A2 samples rather than choosing the slower baseline. Each candidate row contains 20 samples; each pooled baseline contains 40.

| Members | Owned history | Before | After | Change |
|---:|---|---:|---:|---:|
| 10 | One conversation, 50 messages | 3.380 | 4.047 | +0.667 ms / +19.7% |
| 10 | One conversation, 2,000 messages | 14.988 | 15.702 | +0.714 ms / +4.8% |
| 10 | Ten conversations × 2,000 short messages | 24.041 | 22.030 | −8.4% |
| 10 | Ten conversations × 2,000 long messages | 27.725 | 26.249 | −5.3% |
| 30 | One conversation, 50 messages | 2.881 | 2.893 | Within baseline variation |
| 30 | One conversation, 2,000 messages | 16.322 | 16.172 | Within baseline variation |
| 30 | Ten conversations × 2,000 short messages | 26.744 | 23.043 | −13.8% |
| 30 | Ten conversations × 2,000 long messages | 28.391 | 25.067 | −11.7% |

Large fixtures also include 50,000 inaccessible messages. The long full-route fixture uses compressible 6,000-character text and is distinct from the hash-block text in the native diagnostic. The complete responses retain their original exact content and byte counts, including the roughly 3 MiB long-history response bound. Identifiers, conversation associations, timestamps and message order are preserved in comparison digests; only naturally unordered roster/reaction arrays are canonicalized.

The production-sized three-connection pool also handled five measured waves of 10 and 30 distinct synthetic users, after a warmup wave, for both single-history and ten-history fixtures. Across A1/B/A2, **1,200 measured concurrent requests completed with zero errors**. Thirty simultaneous reads of the ten-history workspace improved request median from 225.219 to 219.637 ms and observed p95 from 411.157 to 397.261 ms; wave completion median improved from 413.552 to 400.071 ms. That is a modest 2.5% request-median improvement. The single-history 30-user request median falls inside the A1/A2 range, while its wave median worsened from 298.972 to 305.470 ms. Requests in a wave are correlated; five-wave p95 is an observed maximum, not a population tail estimate.

There are resource tradeoffs. In one native short-history plan, top-N sort memory fell from 933 to 331 KiB, but hot buffer accesses rose from 4,763 to 6,823 because of the extra payload lookups. Every sampled EXPLAIN had zero shared read blocks. This supports smaller sort memory and faster warm busy-history reads, not lower total I/O, hosting cost, response bandwidth or universal latency. Single-conversation overhead stays explicit. Cold storage, actual managed-provider contention, real identity-provider latency, WAN transfer and 30 physical/browser clients are not measured by these local results.

The added database regression independently computes the global 2,000-message cutoff across tied timestamps and multiple conversations, then verifies exact message associations, author/text/deletion state, protected metadata, stars/reactions and membership removal. Existing native concurrency/receipt/media/quota gates remain required. The candidate server SHA-256 is `4c6f7a0ca512c629a8bcdbe6a8a0362ee4c87736613d12aa194ab594cb426efa`; its measured local build is `xQt6-dShd0uHEuaGz9Q7n`. Only `src/lib/server.ts` differs between the two builds' runtime inputs.

Release gates passed: 90 default tests (two native suites explicitly skipped there), TypeScript, the production build, nine substantive native database scenarios, three actual-route native HTTP scenarios, and all 30 browser reliability cases. Two setup failures were investigated and preserved separately: a scrubbed native launcher needed `LC_ALL=C`/`LANG=C`, and the browser test server needed `SUPABASE_URL=https://reliability-test.invalid` so its restrictive production CSP allowed the routed synthetic identity provider. The same code and tests passed after those environment corrections; neither protection nor assertions were weakened.

## Earlier request-count changes

- Read the account profile and pending-invitation existence together. When no invitation exists, skip the empty claim write. Never cache this probe across requests.
- Reuse that freshly read profile for GET responses. Mutations and receipt replays still load the saved profile after their work.
- Fetch members and pending invitations in one query, retaining ownership filters on both branches.
- Repair an existing concurrent first-sign-in race: a same-account unique-email conflict now converges on the verified account ID. A different account ID using an already-linked email receives 409 and cannot reuse the existing profile or its data.

The schema remains version 6. The existing conversation/date/ID history index, metadata-only history, complete response-byte bound, transaction locks, idempotency receipts, three-connection per-process pool and disabled prepared statements retain their contracts. No production data migration is required.

## Native PostgreSQL comparison

Baseline commit: `0ceba6af7e876e034ef676fcd464bde849d7305b`.
Measured candidate `src/lib/server.ts` SHA-256: `9442d354438572573dc7828b4ce3eb47539c6c9f4bcb3cfb53eda0133fd20eba`.

The benchmark used native PostgreSQL 15.19 and postgres.js over trusted loopback TLS. Baseline A1, candidate B, then baseline A2 ran sequentially in fresh disposable clusters. Nine equivalent fixtures covered 2/10/30 members, small and 2,000-message histories, dense reactions, ten owned conversations and 50,000 inaccessible messages. Each ordinary row used two warmups and 20 measured samples; media rows used eight. Before medians below pool the raw samples from A1 and A2. Medians use nearest rank.

Thirty-member results, milliseconds:

| Action | Before median | After median | Application SQL statements |
|---|---:|---:|---:|
| Read 50-message history | 1.395 | 1.174 | 8 → 5 |
| Read 2,000 messages beside 50,000 foreign messages | 10.054 | 9.537 | 8 → 5 |
| Send text | 10.832 | 11.347 | 16 → 14 |
| Create a group | 11.956 | 11.585 | 20 → 18 |
| Stage 5 MiB and send | 190.289 | 181.115 | 69 → 62 |
| Download protected 5 MiB | 21.031 | 22.362 | 1 → 1 |
| Read dense reactions | 41.960 | 39.332 | 8 → 5 |
| Read ten owned conversations | 10.877 | 10.445 | 8 → 5 |

Timings are mixed. Small-history reads improved about 16% and dense reads about 6%, while local text-send and unchanged download-control medians were slower. Baseline A2 was generally faster than A1, showing shared-machine drift. The reliable result is fewer statements and preserved output, rather than every action being faster.

A separate uninstrumented test used the production-sized three-connection pool, 10 and 30 distinct users, two warmup waves and five measured waves per group. Across the three runs, 600 measured requests completed with zero errors (200 per run). At 30 concurrent reads, per-request median A1/B/A2 was 100.697/100.640/102.909 ms; wave completion median was 198.950/197.662/201.381 ms. This does not demonstrate a substantial concurrent-latency improvement. The fixture adds trusted local TLS and a 10-second SQL timeout; production has no equivalent app-level statement timeout.

The timed region includes native driver round trips, BEGIN/COMMIT, application SQL and internal state-budget serialization. It excludes auth-provider calls, API quota writes, final HTTP serialization, browser rendering, public internet transfer and hosted infrastructure. Media chunks are pre-encoded; server decode/storage work is timed. This is not a 30-browser production load test or latency SLA.

Checks compare fixture cardinality, schema, normalized read content, selected message counts, response bytes, event counts and exact protected-media bytes. Normalization omits timestamps and conversation IDs, including message-to-conversation associations, and sorts conversation/member/reaction lists; SQL and native tests separately cover ownership, ordering, invitation races, receipt replay, leave/send ordering, quotas and upload immutability. An independent reviewer recomputed all 51 sequential result rows and the concurrent summaries.

## Stability and deployment boundaries

Use `npm run test:unit`, `npm run typecheck` and `npm run build` for the default gates. The README documents opt-in native PostgreSQL/HTTP tests and their isolated fixture requirements. A build-bound native HTTP check exercises the actual route, identity SDK and database driver with synthetic accounts; it does not replace real hosted acceptance.

An invitation committed after a request's negative existence probe may first appear on the next request. This is explicit and tested; there is no persistent negative cache. Separate queries already use PostgreSQL Read Committed snapshots.

Managed database certificate verification remains an open provider-configuration requirement, as documented in the README. Do not infer certificate trust or a hosted performance guarantee from the verified local fixture.

## Primary references

- [PostgreSQL EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html): execution plans, rows and buffers; transmission and application costs need separate measurement.
- [PostgreSQL index ordering](https://www.postgresql.org/docs/current/indexes-ordering.html): matching indexed order and LIMIT can avoid scanning and sorting whole relations.
- [PostgreSQL index-only scans](https://www.postgresql.org/docs/current/indexes-index-only-scans.html): recently written pages can still require heap visibility checks; a covering index alone does not prove less physical I/O.
- [PostgreSQL LATERAL queries](https://www.postgresql.org/docs/15/queries-table-expressions.html#QUERIES-LATERAL): correlated lookups are evaluated using the selected outer row.
- [PostgreSQL Read Committed](https://www.postgresql.org/docs/current/transaction-iso.html): statements in one transaction can observe different committed snapshots.
- [Supabase postgres.js guidance](https://supabase.com/docs/guides/database/postgres-js): connection-mode and prepared-statement constraints, including the current shared transaction-pooler pipelining warning. This release does not change driver/pool behavior; local PostgreSQL does not emulate Supavisor.
