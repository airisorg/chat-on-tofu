# Populated result rows

Starred used the generic message-result layout: 17px vertical padding, 7px
stacked gaps, and a separate timestamp line. This produced 97px rows while the
desktop Home list used 60px rows with a 2px gap. Existing Starred checks covered
visibility, persistence, and navigation, but neither a populated screenshot nor
a comparison against Home. Reading the branch did not establish visual parity.

The shared result layout now has two lines. Sender/conversation and a compact
date occupy the first; message or filename preview occupies the second. Full
text, attachment names, and an unambiguous timestamp remain accessible and the
row opens the original message. Long previews truncate without growing the row.
This covers Starred, Mentions, message search, and Home Threads; conversation
search uses the adjacent two-line variant.

## Contract

- Match Home row height, avatar size, text inset, and row stride at the same
  viewport. Desktop fine-pointer widths of at least 800px use 60px rows, 40px
  avatars, and a 62px stride. Phone/touch and landscape use Home's existing
  larger or compact responsive density.
- Keep context and timestamp separate, use a one-line 14px/20px preview, and
  retain a minimum 44px target.
- Preserve full accessible names, date descriptions, attachment counts, and
  navigation to original messages, thread replies, and file-only messages.

## Verification

`playwright.result-density.config.ts` runs 28 cases: seven viewport sizes,
light/dark themes, and Chromium/WebKit. Each case checks numeric geometry and
content before five strict populated screenshot comparisons. Fixtures include
long names, a 6,000-character multiline message, cross-year dates, and long
attachment filenames. The aggregate runner discovers this configuration and
refuses snapshot-update arguments; it hashes source, tests, and baselines before
and after the run to detect drift.

Run against the local demo server:

```sh
APP_URL=http://127.0.0.1:3001 npx playwright test --config=playwright.result-density.config.ts
```

The initial regression failed on the old implementation with a 37px difference.
Baseline generation alone does not constitute regression validation; visually
review baselines, then run without updating them.

## Reference limits

Google's [Starred announcement](https://workspaceupdates.googleblog.com/2023/11/star-important-messages-in-google-chat.html)
and [help](https://support.google.com/chat/answer/14249633?co=GENIE.Platform%3DDesktop&hl=en-EN)
establish the feature/navigation semantics, not a current populated Starred
height token. This repair establishes consistency with the measured Home list.
It does not establish pixel identity with an authenticated current Google Chat
Starred list. These synthetic local fixtures also do not prove a deployed
signed-in session, peer synchronization, or every UI state.
