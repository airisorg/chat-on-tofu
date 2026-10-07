# Home filters and dense navigation: October 6 review

Historical review of an intermediate release. The permanent filter-chip row
described below was subsequently replaced; see [current Home controls](home-controls-parity.md).

The reported tiny Home labels were real CSS choices: 11px on desktop, 10px on phones and 9px below 370px. The selected Mentions pill used a correctly centered 28px row, but its global keyboard outline painted 5px outside each edge and intruded into adjacent rows.

## Reference and judgment

Saved Google Chat DOM measurements from October 6 show a 28px shortcut row, 14px/16px regular Google Sans label, 16px radius and zero vertical row gap. These values stay unchanged. The new inset keyboard ring is an application accessibility correction; Google's selected dark/focused Mentions state has not been measured.

Google's current Home screenshot has Home at the left and an Unread switch, Thread chip and view control at the right. Our additional All, Direct messages, Spaces and Pinned controls are retained. This patch does not establish an exact copy of that Google layout.

The Home chip scale uses Google's public [Material filter-chip tokens](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-comp-filter-chip.scss) for 32px container height and 18px icons, and its [label-large type scale](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-typescale.scss) for 14px text with a 20px line box and medium weight. The app keeps its bundled Google Sans family and pill silhouette. These are explicit design choices, not newly measured Google Chat CSS.

## Implementation

- All Home labels use the same 14px/20px medium typography, symmetric padding and 18px icons.
- Phones retain 44px touch targets. Filters scroll horizontally instead of shrinking text or wrapping Direct messages onto two lines.
- Sidebar and filter keyboard rings stay inside their controls, preserving focus visibility in dense rows and clipped scroll containers.

## Regression checks

The Home suite combines screenshot comparisons with independent checks for readable type, equal control height, centered icons, target sizes, overlap and actual hits. It covers light/dark Chromium and WebKit, 320/390px phones, 1024/1440/3440px desktops, short desktop windows, coarse desktop input and narrow conversation preview. Native keyboard traversal must bring the initially offscreen final phone control into view without a scroll helper. Preview checks reach every control and exercise Threads and Direct messages.

The sidebar suite includes selected Mentions with and without keyboard focus, expanded/collapsed navigation in both themes, conversation rows and coarse touch input. A pre-fix run failed with 5px focus spill; the fix requires zero spill without changing the row or label centers. Screenshot goldens protect the reviewed application appearance; they are not a Google pixel-equivalence certificate.

Production-build test results, source binding and hosted release acceptance are recorded outside the public repository in this task's release report. Earlier broad test totals are not reused as proof for this candidate.
