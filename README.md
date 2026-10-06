# Chat

An independent team messenger with Google Chat-inspired desktop and iPhone layouts. The app has its own conversations; it does not import Google Chat messages.

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

## iPhone Home Screen

Open the deployed link in Safari, tap **Share**, choose **Add to Home Screen**, enable **Open as Web App** if offered, and tap **Add**. The app uses a standalone manifest, original PNG icons, safe-area padding and a composer sized for the visible viewport. The app remains available as an ordinary website.

## Product and verification

The interface includes direct/group conversations, spaces, message threads, reactions, image/file uploads, voice messages, message editing/deletion, stars, search, unread filters, conversation preferences, member invitations, drafts and account settings. Google Meet opens in its own service where offered. The app does not replace Google Workspace services such as Calendar or Drive.

Run `npm run typecheck`, `npm run build`, and the Playwright UX suite. Desktop and mobile viewport screenshots are generated during verification. Physical iPhone installation, hardware keyboard behavior and standalone Google account switching require device acceptance; desktop emulation cannot establish those results.

Reference design sources: [Google Chat interface](https://support.google.com/chat/answer/7652236?co=GENIE.Platform%3DDesktop&hl=en), [Google Chat iPhone navigation](https://support.google.com/chat/answer/14170781?co=GENIE.Platform%3DiOS&hl=en), [official desktop screenshot](https://workspace.google.com/blog/product-announcements/welcome-new-google-chat), [current Google Chat product page](https://workspace.google.com/products/chat/), [Apple Home Screen instructions](https://support.apple.com/en-lamr/guide/iphone/iphea86e5236/ios).
