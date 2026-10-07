# Home preview and composed-state verification

Home conversation rows can open a second pane on a fine-pointer desktop with at least 1200 px width and 501 px height. The Home toggle is stored per account. Close keeps the draft; Expand keeps the same composer and restores the visible older message's offset. Smaller/touch layouts use the existing full conversation. Normal authenticated startup opens Home; invitation links still open their conversation.

The Home/preview/expand/toggle interaction follows [Google's documented split-pane flow](https://workspaceupdates.googleblog.com/2024/11/reply-in-google-chat-home.html). Exact pixel parity is not claimed. Pane eligibility, equal fixed columns and supported composer actions are app choices. There is no draggable divider or Google Workspace tool integration.

Run against an HTTP loopback development server with `APP_URL` set appropriately:

- `npx playwright test --config playwright.home-split.config.ts`: Chrome/WebKit, sparse/populated preview, light/dark captures, draft switching, send, close, expand, width/height boundaries, retained attachments, preference reload and thread reopening.
- `npx playwright test --config playwright.composed-dm.config.ts`: long legal sender names, edited/starred metadata, reactions, media, toast click-through and toolbar geometry.
- `npx playwright test --config playwright.media-composition.config.ts`: real native decoding with synthetic permission/recorder fixtures, preparation/cancellation, mutual playback, removed preview cleanup and undecodable image fallback.
- `npx playwright test --config playwright.mini-composition.config.ts`: compact pop-up composer, files and error/offline guidance, all skin-tone choices in short desktop/phone layouts.
- `npx playwright test --config playwright.send-lifecycle.config.ts`: held/lost acknowledgements, reload/durable draft recovery, newer drafts and preview close/reopen ownership with a local authenticated server fixture.
- `npx playwright test --config playwright.geometry.config.ts`: existing full conversation/short-window geometry across desktop and mobile-sized viewports.

These gates are regression evidence for specified cases. Synthetic credentials never contact a hosted service. Own-app screenshots are not a Google screenshot oracle. Local browser tests do not prove real microphone capture, a physical iPhone keyboard, every network race or current hosted behavior. Release/device acceptance and server/database verification must be recorded separately.
