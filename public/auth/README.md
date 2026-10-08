# Google sign-in artwork

The sign-in mark is from Google's current approved asset bundle, obtained
2026-10-08 through the download linked from its
[Sign in with Google branding guidelines](https://developers.google.com/identity/branding-guidelines).

- Official bundle: https://developers.google.com/static/identity/images/signin-assets.zip
- Bundle bytes: 855303
- Bundle SHA-256: `ba884069e12093b06bcfd776915081254a7c95094b80d50be2c5dc6bac1c1da1`
- Original entry: `Android + Web/SVG/Light/Theme=Light, Show text=No, Shape=Square, Platform=Android+Web.svg`
- Original SVG bytes: 10791
- Original SVG SHA-256: `6587b180203a99da15c0a041018e15c94ffd9556c4b9855bdc69806081a93791`
- Bundled cropped SVG: `google-g.svg`
- Bundled bytes: 10461
- Bundled SHA-256: `a6b7524174e5143f771c3ad2923e24a19aa86e7a5823dd1be0e1494fea05b6a4`

The original SVG contains a 20px mark at coordinates (10, 10) within a 40px
button. The app retains the original mask, artwork group and gradient definitions
byte for byte, removes the surrounding button paths and sets the outer viewport
to `10 10 20 20`. It does not redraw, recolor or stretch the mark.

The mark identifies Google sign-in. It remains a Google brand asset, separate
from the project's MIT license and the Apache-2.0 Material icons. Google's
branding rules govern its use; it is not the app's logo or evidence of endorsement.
