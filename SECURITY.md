# Security

Report a suspected vulnerability privately through the repository's Security tab if private reporting is enabled. Do not post session tokens, database URLs, real private conversations or provider secrets in public issues. If private reporting is unavailable, contact a maintainer privately before sharing exploit details.

The authenticated application server verifies sessions with the configured Supabase identity service. The browser cannot authorize an operation by supplying a user ID. Private database tables deny browser access; the event table has a narrowly scoped authenticated read policy. Membership and author checks also run inside server transactions.

The production page uses a fresh CSP nonce and blocks framing. The sign-in callback must match a recent same-tab request. Uploads have byte, MIME, signature, ownership, expiration and staging bounds. Verified-account API quotas are durable across instances. Dependencies and source should be reviewed on every release; a clean vulnerability database scan is only one check.

Known boundaries: persistent sessions use SDK browser storage; an origin-wide script compromise can still expose them. Provider authentication abuse, hosting denial-of-service controls, database backup/export and physical iPhone behavior need independent operational validation. The app does not claim to eliminate every possible attack.

For local verification see README and CONTRIBUTING. Synthetic fixtures and fault injection require loopback hosts. Do not run automated attack or load suites against a deployed production account.
