# Test coverage and visual regressions

A passing test proves its assertions in its recorded environment. It does not certify every screen, Google Chat parity, real provider authentication, physical-device behavior or an attack-free service.

## Run the complete browser inventory

Keep a development server running for demo and routed identity fixtures:

```sh
npm run dev -- -p 3001
```

In a separate terminal, build and serve a production instance. The public identity settings below are deliberately synthetic; this unauthenticated security suite makes no database connection. Do not substitute production credentials:

```sh
npm run build
SUPABASE_URL=https://security-provider.test.invalid \
SUPABASE_ANON_KEY=sb_publishable_security_fixture \
DATABASE_URL=postgres://localhost/security-fixture \
npm run start -- -p 3008
```

Then run the inventory and tests:

```sh
npm run test:browser:list
APP_URL=http://127.0.0.1:3001 \
CHAT_PRODUCTION_APP_URL=http://127.0.0.1:3008 \
npm run test:browser:all
```

The runner discovers browser specs and their configs, rejects uncovered specs and hosted URLs, and runs each suite without updating screenshots. Production CSP tests use the production URL because development permits evaluation and exposes a demo entry. Per-suite logs and the aggregate result stay under ignored `test-results/all-suites`. Source drift during a run must not be reported as a pass for one immutable candidate.

Run `npm run typecheck` and `npm run test:unit` separately. The two native suites are opt-in: see the README for `CHAT_NATIVE_WORK_DIR`. Those fixtures use disposable native PostgreSQL, TLS and a synthetic identity provider; the ordinary unit suite explicitly skips them. A successful build without `DATABASE_URL` does not establish hosted database connectivity.

## Visual assertions before baselines

The Home toolbar and dialog suites use actual `toHaveScreenshot` assertions in Chrome and WebKit, with reviewed macOS goldens. Home covers both themes, view widths, unread/filter/split states, hover and keyboard focus. Dialogs cover Settings, the draft preference, Profile presets/focus and availability. Existing visual cases cover other selected app states. Run the relevant suite without `--update-snapshots` after review.

Before accepting a baseline:

1. Assert the expected controls and text exist. Check exact or nonzero cardinality before loops or min/max geometry; an empty node list must fail.
2. Check sibling bounds, clipping and real hit targets. Scroll controls into view only when testing scroll accessibility. For clipping tests, use coordinates in the existing viewport and verify that scroll offset did not change.
3. Exercise the composed state. A lone control or simplified Home without Split and Threads cannot catch adjacency defects involving those controls.
4. Freeze nondeterministic fixture time and use synthetic local data. Never commit private messages, personal screenshots, recordings or auth state.
5. Review before/after pixels in both themes and relevant widths. Preserve an initial failing assertion where a regression is repaired, then verify the same assertion passes.

Own-app goldens catch drift relative to reviewed app screenshots. Google parity requires a separate reference of the same state, viewport, content and input modality. Do not invent spacing requirements to eliminate an intentional floating overlay. A toolbar may cover text temporarily; the established usability contract is reachable actions and text restored when the overlay dismisses.

## Interaction and failure checks

New authenticated fixtures must navigate explicitly from Home to their intended conversation. Tests should fail on an incorrect state instead of proceeding with empty selectors or arbitrary sleeps. Keep these layers distinct:

- Unit/SQL: exact retry IDs, receipts, byte bounds, rejected mutations and state conservation.
- Browser fixtures: response loss, late acknowledgements, account changes, drafts, partial uploads, media cleanup, keyboard and layout.
- Native integration: actual compiled HTTP handlers and PostgreSQL concurrency with synthetic identities.
- Hosted acceptance: release-bound real sign-in, separate accounts, physical devices, file upload/playback/download and network recovery.

For media, distinguish successful playback from a decoded waveform, complete playback from metadata duration, synthetic microphone input from real speech, and image decode from downloaded-byte equality. For synchronization, sender persistence is not peer arrival. For performance, record workload, group size, sample count and raw timings; local fixture timings are not hosted latency.

## Known coverage boundaries

This repository has a runnable local inventory, not a claim that every possible flow is covered. Physical iPhone installation/OAuth/keyboard behavior, a fresh pair of independently controlled hosted users, matched Google screenshots for every component/state, and hosted 30-user capacity remain separate acceptance work. Screenshot baselines are platform-specific. A CI runner on another OS requires separately reviewed font/emoji baselines; it must not silently approve new images.
