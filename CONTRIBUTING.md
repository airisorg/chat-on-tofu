# Contributing

Use Node.js 22 or newer, run `npm ci`, and start `npm run dev`. The local **Explore demo** preview needs no provider account. Production preview is disabled.

Run `npm run typecheck`, `npm run build`, and `npm run test:unit` for server/client changes. Browser tests require a separately running local server; install their engines with `npx playwright install chromium webkit`. All browser configurations default to `http://127.0.0.1:3000`; set `APP_URL` for another local port. Hosted URLs are rejected because these suites use synthetic accounts and fault fixtures. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` optionally selects your Chromium binary.

Use the relevant `test:*` script for the behavior changed. `test:voice` captures a real minute through Chromium's synthetic microphone and takes roughly a minute. The SQL benchmarks use disposable in-process PGlite databases; they do not contact the deployed database. Browser traces and captures default to ignored `test-results/`; `CHAT_EVIDENCE_DIR` optionally exports selected review captures elsewhere.

Visual regression baselines under `tests/visual-regression.spec.ts-snapshots/` show synthetic local conversations. Review rendered component differences before updating a baseline. Baseline approval is separate from comparisons with Google's actual interface and from device acceptance.

Keep changes focused, preserve account isolation and stable retry identities, and describe the checks run in your pull request. Do not include populated environment files, credentials, production messages, personal screenshots, or recordings. Bundled fonts, icons and emoji data retain their separate license notices. This project is independent of Google; new features must describe what this app actually supports.

For a suspected credential or private-data issue, use GitHub's private vulnerability reporting when available; do not post credentials or private account data in a public issue.
