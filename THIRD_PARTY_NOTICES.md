# Third-party materials

The project's MIT license applies to its original code. Third-party materials
retain their own licenses; the project is independent of Google.

| Material                        | Source and license                                                                                            | Bundled notice                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Google Sans Latin variable font | [Google Fonts](https://github.com/google/fonts/tree/main/ofl/googlesans), SIL Open Font License 1.1           | `public/fonts/google-sans-OFL.txt`              |
| Roboto Latin variable font      | [Google Fonts](https://github.com/google/fonts/tree/main/ofl/roboto), SIL Open Font License 1.1               | `public/fonts/roboto-OFL.txt`                   |
| Four Material icon paths        | [Material Design Icons](https://github.com/google/material-design-icons), Apache-2.0; adapted into React SVGs | `public/licenses/material-icons-APACHE-2.0.txt` |
| Emoji search data               | [Emoji Mart](https://github.com/missive/emoji-mart), MIT                                                      | `public/licenses/emoji-mart-data-MIT.txt`       |

`src/components/MaterialIcons.tsx` adapts these upstream Google icon paths:

- Settings: [Material Symbols outlined, 24px](https://github.com/google/material-design-icons/blob/master/symbols/web/settings/materialsymbolsoutlined/settings_24px.svg).
- Help: [Material Icons help_outline, 24px](https://github.com/google/material-design-icons/blob/master/src/action/help_outline/materialicons/24px.svg).
- New chat: [Material Symbols chat_add_on, 24px](https://github.com/google/material-design-icons/blob/master/symbols/web/chat_add_on/materialsymbolsoutlined/chat_add_on_24px.svg), adapted to a 24-unit viewBox.
- Split pane: [Material Symbols vertical_split, 20px](https://github.com/google/material-design-icons/blob/master/symbols/web/vertical_split/materialsymbolsoutlined/vertical_split_20px.svg).

The wrapper adaptations add React sizing, current-color fills and decorative
accessibility attributes. Apache-2.0 covers these icon assets; it does not grant
rights to use Google's trademarks as the project's brand.

[Font provenance](public/fonts/README.md) records source URLs, exact sizes and
SHA-256 hashes. Emoji glyphs are rendered by the operating system; the repository
does not redistribute a proprietary emoji font. The app icon in `public/icons/`
is an original project asset, separate from Google's sign-in branding.

## Google sign-in mark

`public/auth/google-g.svg` retains the unchanged logo artwork, mask and gradient
definitions from Google's approved sign-in SVG bundle. Only the outer viewport
crops the surrounding button to its 20px mark. [Its provenance](public/auth/README.md)
records the original asset and hashes.

This mark identifies the Google sign-in service under
[Google's sign-in branding guidelines](https://developers.google.com/identity/branding-guidelines).
It is a Google brand asset, not original project artwork and not relicensed under
this project's MIT license or the Material icons' Apache license. Its presence
does not imply Google's affiliation, endorsement or sponsorship. Reuse must
follow the applicable Google brand rules.

Other dependencies are installed through `package-lock.json`; their notices
remain in their npm packages. Generate the installed dependency inventory with:

```sh
npm ci
npm sbom --sbom-format cyclonedx > test-results/dependency-sbom.cdx.json
```

Create `test-results/` first if it does not exist. Keep the dependency licenses
when distributing a packaged application or its dependencies. In particular,
Sharp's platform packages include libvips under LGPL-3.0-or-later, and
`caniuse-lite` uses CC-BY-4.0; the project's MIT notice does not replace those
terms. Binary dependencies are not vendored in this source repository.

Committed screenshot baselines and media fixtures use synthetic local accounts
and content. New reference captures, personal screenshots, production chat
messages, browser profiles, recordings and authentication state do not belong
in the public repository.
