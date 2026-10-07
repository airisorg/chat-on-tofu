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

Run `npm run typecheck` and the Node layers separately. A successful build without `DATABASE_URL` does not establish hosted database connectivity.

## Test layers and measured coverage

`npm run test:catalog` prints the current file membership and entrypoints as JSON. Node discovery includes nested `tests/**/*.test.ts` files, rejects symlinks, and excludes browser specs, helpers and benchmark scripts. A catalog is an inventory, not a passing-test count.

| Command                     | Selected evidence                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `npm run test:unit`         | All non-native Node tests, including embedded SQL and mocked API boundaries        |
| `npm run test:unit:fast`    | Node files without a direct PGlite or native fixture import                        |
| `npm run test:sql`          | Files importing PGlite; real application SQL in an embedded engine                 |
| `npm run test:native`       | Explicit opt-in disposable native PostgreSQL and compiled HTTP bridge              |
| `npm run test:coverage`     | Non-native Node execution, all-source coverage report and narrow regression floors |
| `npm run test:browser:list` | Browser config/spec membership without browser execution                           |
| `npm run test:browser:all`  | All browser suites against isolated loopback servers                               |

The layer classification reads actual static imports. The fast layer includes mocked API tests and is not a claim that every file is a pure function test. PGlite cannot establish native PostgreSQL lock scheduling; its concurrent promises and the native multi-connection tests are distinct evidence.

Native tests are not selected by the ordinary Node command. `test:native` requires `CHAT_NATIVE_WORK_DIR`, PostgreSQL and OpenSSL; see the README for exact opt-in setup. The `test:native` acceptance entrypoint requires a readable `CHAT_NATIVE_BUILD_BINDING` from a fresh production build, matching `.next/BUILD_ID` and every recorded runtime source hash before any native fixture starts. `src/lib/server.ts` must be included. `CHAT_NATIVE_EXPECTED_BUILD_ID` can additionally assert the externally expected ID. Direct diagnostic invocation (`npx tsx --test tests/native-http.test.ts`) can run without that binding, but its evidence explicitly describes source alignment as unverified and must not be labeled candidate acceptance. Synthetic identity/TLS fixtures do not prove Google sign-in or managed-provider compatibility.

Coverage uses pinned c8 and `.c8rc.json`. Its `all` option includes unloaded files at zero: every TypeScript/TSX source, public JavaScript and the read-only database build gate remains in the denominator. Reports are in ignored `test-results/coverage/` (`index.html`, `coverage-final.json`, `coverage-summary.json`). `check-coverage.ts` fails if a source is omitted and applies evidence-based floors only to the heavily tested server, action-identity and login-callback modules. It does not impose an unsupported global percentage on UI code.

Node coverage does not instrument browser flows. A TSX component at zero Node lines can have browser assertions; those assertions still are not measured component code coverage. Type-only files are retained, and c8's placeholder function/branch counters for unloaded files make aggregate function/branch percentages less informative than the line total and zero-file list. Do not add Node and browser pass counts or describe a screenshot count as a coverage percentage.

## Native acceptance binding

Use an isolated checkout without production credentials. Keep source unchanged throughout this sequence. Capture input hashes before the build, then verify the same inputs and attach its generated ID afterward:

```sh
npx tsx -e 'import {captureBinding} from "./scripts/test-browser-suites"; import {mkdirSync,writeFileSync} from "node:fs"; const hashes=captureBinding(process.cwd()); delete hashes["next-env.d.ts"]; mkdirSync("test-results",{recursive:true}); writeFileSync("test-results/native-source-before.json",JSON.stringify(hashes,null,2));'
npm run build
npx tsx -e 'import {captureBinding,bindingChanges} from "./scripts/test-browser-suites"; import {readFileSync,writeFileSync} from "node:fs"; const before=JSON.parse(readFileSync("test-results/native-source-before.json","utf8")); const after=captureBinding(process.cwd()); delete after["next-env.d.ts"]; if(bindingChanges(before,after).length) throw new Error("Source changed during the native build"); writeFileSync("test-results/native-build-binding.json",JSON.stringify({buildId:readFileSync(".next/BUILD_ID","utf8").trim(),runtimeSourceHashes:after,scope:"Frozen checkout inputs before and after this local production build; generated next-env.d.ts excluded."},null,2));'
CHAT_NATIVE_WORK_DIR="$PWD/test-results/native" \
CHAT_NATIVE_BUILD_BINDING="$PWD/test-results/native-build-binding.json" \
npm run test:native
```

The hash inventory includes source, assets, tests and configuration; it is a frozen-input record, not a claim that every recorded file is compiled. `next-env.d.ts` is a generated Next file and is deliberately excluded from this comparison. Output directories and `.env` files are not read. Keep the original binding with the results; do not regenerate it after editing source to make a stale bundle appear current. The entrypoint checks the binding's ID and hashes again before any native fixture starts. The native HTTP test also checks the same proof before launching Next.

For an intentionally unbound diagnostic, invoke the selected native test directly with `npx tsx --test`. Its `prebuiltSourceVerification` field remains unverified without the external binding. A diagnostic cannot replace the acceptance sequence above.

## Continuous integration

Pull requests and pushes to `main` run the committed quality/security workflows. The repository also has GitHub-managed CodeQL default setup enabled:

| Job                          | What it verifies                                                                                                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quality / checks             | Locked install, formatting, lint, TypeScript, all non-native Node/SQL tests with all-source coverage floors, dependency advisories and production build                                       |
| Quality / native-integration | Fresh compiled API against disposable PostgreSQL 16 and synthetic HTTPS identities, verified TLS, concurrent writes, invitation ownership, quotas, private upload/download and retry receipts |
| Quality / browser            | Chromium and WebKit functional security, recovery and offline-shell flows against an isolated production server                                                                               |
| Security / secrets           | Reachable Git history and checked-out source with checksum-pinned Gitleaks                                                                                                                    |
| CodeQL default setup         | Existing GitHub-managed JavaScript/TypeScript analysis on changes and its weekly schedule                                                                                                     |

CodeQL uses the repository's existing default setup. Do not add an advanced CodeQL workflow alongside it: default setup blocks those analysis uploads. Fork owners must enable CodeQL for their own repository.

Native integration runs as the ordinary Ubuntu runner user. It creates only its
own temporary clusters on loopback ports, verifies the build's source hashes
before starting, and stops/removes those clusters afterward. It does not use a
shared service database or any production secret. Only sanitized JSON proof,
the test log and source/build binding are uploaded; private fixture keys and
database directories are excluded. Uploaded coverage and proof artifacts expire
after seven days; workflow logs follow the repository's retention setting.

Run the same unit/SQL gate locally with `npm run test:coverage`, or select
`npm run test:unit:fast` and `npm run test:sql` while iterating. The native command
above accepts `CHAT_NATIVE_PG_BIN` and `CHAT_NATIVE_OPENSSL` for Linux tool paths.
The complete macOS screenshot inventory remains a separate local release gate:
CI functional passes do not approve platform-specific pixels. Configure required
branch checks after their first successful run; a workflow file alone does not
enforce branch protection.

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

Performance scripts (`tests/benchmark-groups.ts`, `tests/benchmark-dense.ts`) are separate measurement entrypoints, not test assertions or coverage. Preserve raw samples, workload/source binding and correctness checks; a five-sample p95 is the observed maximum, not a stable population-tail estimate. Reports exclude costs outside their stated timer, and hosted results need their own acceptance record.
