# Database performance, 2026-10-06

Ordinary history reads now execute five application SQL statements instead of eight. Empty histories use four instead of seven. Each request still verifies identity, enforces the database-backed quota, and reads current membership. These statement counts exclude BEGIN/COMMIT and the separate API quota queries; they are not a claim of 37.5% less database CPU or total service cost.

## Changes

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
- [PostgreSQL Read Committed](https://www.postgresql.org/docs/current/transaction-iso.html): statements in one transaction can observe different committed snapshots.
- [Supabase postgres.js guidance](https://supabase.com/docs/guides/database/postgres-js): connection-mode and prepared-statement constraints, including the current shared transaction-pooler pipelining warning. This release does not change driver/pool behavior; local PostgreSQL does not emulate Supavisor.
