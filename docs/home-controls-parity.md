# Home navigation and motion review — October 6, 2026

The prior Home design presented All, Direct messages, Spaces and Pinned as filter chips. Direct messages and Spaces actually changed pages with `navigate()`, so the controls disappeared after selection. A regression reproduced the loss of the Home heading on release `28f477f` before the correction.

## Google reference and resulting contract

Google's [current desktop navigation guide](https://support.google.com/chat/answer/14170781?co=GENIE.Platform%3DDesktop&hl=en), read October 6, places Unread, Thread and Split pane mode at the top right of Home. Direct messages and spaces live in the sidebar. The same-day captured Google Home screenshots show this arrangement, including an Unread switch, compact Thread control and a view dropdown. They do not contain the app's invented All / Direct messages / Spaces / Pinned chip row.

The corrected default Home header follows that arrangement. A direct Split pane toggle sits beside a separate chevron menu containing exactly Split pane and Single pane, confirmed in the live Google UI. Supported additional filtering and mark-all-read remain in a separate More Home actions overflow. Those additional actions are app functionality. Choosing a conversation type filters within Home; the heading, primary controls and menu remain available. Direct messages includes both one-to-one and group chats. Active type and Pinned filters appear as a plain text summary with Clear filters, not a permanent chip row.

Unread, type and Pinned apply to both conversation rows and thread roots. Thread shows roots with a non-deleted reply. All conversations and Clear filters reset all four filters. Opening the menu does not mark conversations read; the explicit mark-all-read action covers unread conversations even when a filter hides them. Preview drafts remain associated with their conversation as list filters change.

When split mode is enabled on a sufficiently wide fine-pointer desktop, Home reserves equal list and preview panes even before a conversation is selected. The empty pane has an accessible close control and a no-selection explanation. Close and menu-driven split changes return focus to a connected control. The simple empty-pane illustration and the additional actions overflow are application adaptations. The no-selection supporting copy follows the captured Google state.

The view glyph uses Google's Apache-2.0 [Material vertical_split SVG](https://github.com/google/material-design-icons/blob/master/symbols/web/vertical_split/materialsymbolsoutlined/vertical_split_20px.svg). The off switch uses a filled gray track and white thumb following the fresh light reference. Google's Thread spool glyph has not been identified from an official asset; the current hourglass remains an approximation. Dark and phone layouts are accessible adaptations, not directly measured Google copies.

## What the evidence can establish

The supplied sidebar screenshot establishes a rounded group background, a darker hovered row and a preserved selected row. It does not establish an animation duration or easing curve. Local motion choices must be labelled adaptations until compared with a live Google transition. Exact font rendering also depends on the environment.

Screenshot baselines protect the reviewed application states. They are supplemented with geometry, readable typography, control-state, keyboard, populated-result and motion assertions. Updating a golden alone does not establish Google parity. Desktop, narrow preview, small phone, coarse pointer and reduced-motion cases require separate checks.

## Ongoing audit

The broader audit covers every UI component and stylesheet, their nested controls, actual user flows and animation states. Evidence is classified as current local, current hosted, saved Google reference, official documented behavior or unverified comparison. A source review or a passing local fixture does not certify every production account/device combination.

## Flow and CSS repairs from the source review

- Direct-message saved availability is distinguished from live connectivity; custom/unknown/invited states have no misleading green dot. Failed avatar images fall back to initials and retry when identity or URL changes.
- Recipient suggestions scroll to the keyboard-active option; long recipient chips preserve the Remove hit area. Search options use stable identity keys when names repeat.
- Generic action feedback is guarded by initiating account and generation. Mark-all-read preserves partial confirmed success and retries remaining unread conversations with the original action identity.
- Home Thread state cannot open an unrelated empty thread from Search. Mini close/minimize/expand preserve a meaningful keyboard focus destination.
- Message jumps respect reduced motion and take precedence over automatic bottom pinning. Desktop compact actions and Home controls share the 799px boundary with the surrounding layout. Media fallback controls preserve 44px hit targets.

The full browser runner discovers every configured spec, rejects missing suites, binds source/tests/assets before and after execution, and does not forward screenshot-update flags. The release audit records the actual run rather than treating baseline creation as acceptance.

## Final view-control review

The direct toggle changes mode immediately; the chevron opens only the two explicit mode choices. Selecting the current mode is idempotent. Switching between view and actions menus closes the other menu. Preview close and mode changes restore focus to the initiating connected button; compact resizing dismisses the desktop-only view menu and focuses the persistent actions button. Tests retain the same draft and conversation filter across these transitions.

The captured two-mode menu is approximately 200px wide with 40px rows. It has a tonal background and a visible selected row. Those dimensions and the selected-row distinction now have geometry/style assertions separate from the screenshot.

## A screenshot false negative found during review

The original empty-preview screenshot covered a large blank pane. Its 0.1% pixel-difference allowance could accept changed caption text at 3440px, so updating screenshots did not necessarily replace the old caption. The test now asserts the exact supporting text and compares a tightly cropped content screenshot with no pixel-difference allowance. Pane widths, gap and close-button reachability are checked separately. This avoids using empty background area to dilute a meaningful text regression.

## Settings control stability

The final screenshot gate caught a 4px intrinsic-width shift in the native Appearance select on compact Chrome. The select now has a 92px fixed width and cannot flex-shrink; the 44px mobile target remains. Tests cycle all three options and assert that its position and dimensions stay fixed, then compare refreshed light/dark screenshots. The source of the native intrinsic metric change was not established; no screenshot masks or looser tolerances were introduced.
