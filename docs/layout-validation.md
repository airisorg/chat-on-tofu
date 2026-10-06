# Conversation layout validation

## Reference and decision

On 6 October 2026, rendered Google Chat DOM measurements in a signed-in desktop direct message showed both the history and composer outer envelope capped at **896 CSS pixels**, with matching left coordinates at 1440, 1920 and 3440 px browser widths. The composer had 24 px horizontal inner padding, leaving 848 px for controls. At a 1024 px viewport both envelopes narrowed to 698 px. Centering the history is therefore intentional; the previous app defect was a full-pane composer below a capped history column.

The application now gives the main history and composer the same available width, native scrollbar gutters and maximum width. Thread replies and desktop pop-ups keep their own layout. Compact touch layouts retain their phone sizing and keyboard behavior. In short desktop windows, draft previews scroll independently so input and delivery guidance remain reachable. Long draft filenames truncate within their row instead of displacing Remove. Below 401 px desktop height, a 56 px textarea growth cap leaves space for error guidance; longer text scrolls within the input.

Google's observed unread count used a 28 px padded slot, 18 px high, with 6 px horizontal padding. The app applies that treatment to its Home unread count, including multi-digit counts. The observed Google Home shortcut itself indicated unread state with bold text/accessibility rather than the same numeric badge; this is a deliberate adaptation, not exact Home parity.

The reference account supplied an own-message direct conversation, not a populated space or incoming/media example. Narrow desktop web measurements do not establish native iPhone behavior. Private account captures remain outside this public repository.

## Regression contract

Run the app locally, then:

```sh
APP_URL=http://127.0.0.1:3001 npm run test:geometry
APP_URL=http://127.0.0.1:3001 npm run test:spacing
APP_URL=http://127.0.0.1:3001 npm run test:platform -- tests/keyboard.spec.ts tests/popovers.spec.ts --workers=1
APP_URL=http://127.0.0.1:3001 npm run test:visual -- --workers=1
```

The geometry suite uses Chrome and WebKit with local synthetic conversations. It checks 375, 390, 768, 1024, 1440, 1920 and 3440 px widths, both themes, collapsed navigation, threads, pop-ups, unbroken message text, decoded images/audio and long file names. It asserts actual coordinates and fixed reference dimensions, not merely the absence of page overflow. Home counts of 1 and 123 must have a visible inset and remain unclipped. Short desktop cases also exercise draft removal, retained send-failure guidance and overlays.

`CHAT_EVIDENCE_DIR` optionally saves full viewport screenshots, component crops and geometry JSON. Composer crops use the current viewport pixels: an element screenshot can scroll hidden ancestors and conceal the clipping being tested.

Before the runtime fix, the 3440 px case reproduced the old 3168 px composer beside 896 px history. Expanding the matrix also exposed a 1024 × 400 px attachment draft whose Send button extended to y=435. These failing baselines distinguish a reproduced repair from an assertion that only passes new code. The existing spacing oracle was corrected to include the left scrollbar gutter in its content-center calculation; its one-pixel tolerance was retained.

The suites establish the stated synthetic browser contracts. Unchanged visual baselines detect app drift, not Google pixel identity. Hosted UI checks and physical-device acceptance must be reported separately with their source revision; these tests do not certify all possible flows or devices.
