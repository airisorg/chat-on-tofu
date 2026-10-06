# Chat

An independent team messenger with Google Chat-inspired desktop and iPhone layouts. The app has its own conversations; it does not import Google Chat messages.

Open [Chat on Tofu](https://chat-84bee5accbbd.trytofu.app/) and sign in with Google. To chat with a friend, add their Google email using **New chat** or **Add people**, then share the conversation's invitation link. They sign in with that same email; the invitation is claimed automatically.

## Run locally

```sh
npm ci
npm run dev
```

Open http://localhost:3000. For local interface testing, choose **Explore demo** to try the interface without an account. This local preview is hidden in production. Preview conversations stay in this browser and are visibly labeled; they are separate from real account data.

For the production workspace, Tofu supplies `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and the corresponding public Supabase variables. Never commit a populated environment file.

## Production sign-in and data

Google sign-in uses Tofu's OAuth broker and the application's own Supabase identity service. The browser obtains its session through the supported redirect. Every chat API request verifies the bearer token with Supabase `getUser`; browser-provided account IDs do not authorize an operation. Only conversation members can access its messages, and only authors can edit or delete their own messages. A private PostgreSQL schema stores profiles, conversations, memberships, messages, reactions, starred state and per-user preferences. The server applies the idempotent schema on first authenticated use.

The public configuration endpoint exposes the Supabase URL and public anonymous key only. The database connection string never reaches the browser. The service worker caches a small public offline page and icons; it does not cache private conversations, API responses, sign-in callbacks or tokens. Offline writes are disabled.

Images and picked files can be up to 5 MiB (5,242,880 bytes), with three attachments per message. Authenticated uploads use `/api/uploads` to send 1 MiB binary chunks in JSON requests capped at 2 MiB, below the hosting platform's request limit. Private staging rows belong to the verified account and conversation, expire after 15 minutes, and reserve at most six files or 20 MiB of binary data per account (less than 27 MiB encoded). Each chunk is immutable; the final send validates and consumes the complete files in the message transaction. The stable message ID deduplicates retries after lost acknowledgements. Uploads and their final send share a 60-second deadline. The voice recorder keeps its separate one-minute, 1 MiB recording limit. Main drafts use browser storage and may retain text only when storage cannot hold the attachments.

Chat polling returns file metadata and protected references, not inline base64. Visible files download as streamed binary responses through `/api/attachments` using the bearer session; the server verifies current membership and rejects deleted files. A memory cache reuses object URLs across polls, allows two concurrent downloads, and holds up to 64 MiB or 128 files before evicting older entries. Failed or evicted files reload only through an explicit retry, preventing repeated downloads when visible files exceed the memory budget. Leaving a conversation, changing accounts or signing out clears inaccessible cached media; private binaries are never persisted by this cache. History returns at most 2,000 messages within a bounded 3 MiB metadata/text budget. Existing database attachments remain compatible without moving them to another storage service.

## iPhone Home Screen

Open the deployed link in Safari, tap **Share**, choose **Add to Home Screen**, enable **Open as Web App** if offered, and tap **Add**. The app uses a standalone manifest, original PNG icons, safe-area padding and a composer sized for the visible viewport. The app remains available as an ordinary website.

## Product and verification

The interface includes direct/group conversations, spaces, message threads, reactions, image/file uploads, voice messages, message editing/deletion, stars, search, unread filters, conversation preferences, member invitations, drafts and account settings. Google Meet opens in its own service where offered. The app does not replace Google Workspace services such as Calendar or Drive.

Licensed Google Sans and Roboto fonts are served by the app itself. Search supports people, conversations, dates, file types, links and mentions over the loaded history; relevance uses a local text rank. Known recipients are suggested from your own conversations. Desktop menus are anchored to their controls, while phone dialogs and composers follow the software keyboard's visible viewport.

Run `npm run typecheck` and `npm run build`. With the local app running, use `npm run test:backend`, `npm run test:ux`, `npm run test:platform` and `npm run test:reliability`. Set `APP_URL` if the dev server uses a port other than 3000. The platform suite covers Chromium and WebKit with portrait/landscape phones, tablets, desktop resizing, install guidance, short visual viewports and contrast. The reliability suite uses an isolated fake session and routed API fixtures to test failure recovery without real credentials.

Use `npx playwright test --config playwright.reference.config.ts` for bundled font rendering and availability/help menus, `npx playwright test --config playwright.search.config.ts` for structured search, and `npx tsx --test tests/search.test.ts` for search semantics. Search checks also verify avatar geometry and that phone actions cannot cover results.

Install test browsers with `npx playwright install chromium webkit` if needed. On macOS the Chromium suites use the installed Google Chrome; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to select a different Chromium installation. The suites require a local server and cannot accidentally crawl the hosted app.

Desktop and mobile viewport screenshots are generated during verification. Physical iPhone installation, hardware keyboard behavior and standalone Google account switching require device acceptance; desktop emulation cannot establish those results.

Reference design sources: [Google Chat interface](https://support.google.com/chat/answer/7652236?co=GENIE.Platform%3DDesktop&hl=en), [Google Chat iPhone navigation](https://support.google.com/chat/answer/14170781?co=GENIE.Platform%3DiOS&hl=en), [official desktop screenshot](https://workspace.google.com/blog/product-announcements/welcome-new-google-chat), [current Google Chat product page](https://workspace.google.com/products/chat/), [Apple Home Screen instructions](https://support.apple.com/en-lamr/guide/iphone/iphea86e5236/ios).
