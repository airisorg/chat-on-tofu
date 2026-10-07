# Security

Report a suspected vulnerability using [GitHub private vulnerability reporting](https://github.com/airisorg/chat-on-tofu/security/advisories/new).
Do not post session tokens, database URLs, real private conversations or provider
secrets in public issues. If private reporting is unavailable, contact a
maintainer privately before sharing exploit details.

Security fixes target the latest `main` revision. Older snapshots and forks do
not receive an independent backport guarantee. Include the affected revision,
minimal synthetic reproduction, impact and any suggested mitigation in a report.

The authenticated application server verifies sessions with the configured Supabase identity service. The browser cannot authorize an operation by supplying a user ID. Private database tables deny browser access; the event table has a narrowly scoped authenticated read policy. Membership and author checks also run inside server transactions. New email-addressed invitations are claimed only by a recipient request with the currently provider-verified email; cached profile email is display metadata, not admission authority. Existing account-ID memberships are preserved across email changes. Recycled addresses that conflict with a stale unique profile email require operator verification; the app does not silently transfer another account's profile or memberships.

The production page uses a fresh CSP nonce and blocks framing. The sign-in callback must match a recent same-tab request. Uploads have byte, MIME, signature, ownership, expiration and staging bounds. Verified-account API quotas are durable across instances. Dependencies and source should be reviewed on every release; a clean vulnerability database scan is only one check.

Known boundaries: persistent sessions use SDK browser storage; an origin-wide script compromise can still expose them. Provider authentication abuse, hosting denial-of-service controls, database backup/export and physical iPhone behavior need independent operational validation. The app does not claim to eliminate every possible attack.

For local verification see README and CONTRIBUTING. Synthetic fixtures and fault injection require loopback hosts. Do not run automated attack or load suites against a deployed production account.

Run `npm audit` for dependency advisories and Gitleaks against both the working
tree and all reachable refs before publishing. These scanners do not inspect
every secret format or prove the absence of private data in images. Review
asset provenance, generated evidence and commit metadata separately. If a real
credential is ever exposed, revoke or rotate it first; deleting the current
file alone does not remove it from Git history or existing clones.
