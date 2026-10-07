# Third-party materials

The project's MIT license applies to its original code. Third-party materials
retain their own licenses; the project is independent of Google.

| Material                          | Source and license                                                                                             | Bundled notice                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Google Sans Latin variable font   | [Google Fonts](https://github.com/google/fonts/tree/main/ofl/googlesans), SIL Open Font License 1.1            | `public/fonts/google-sans-OFL.txt`              |
| Roboto Latin variable font        | [Google Fonts](https://github.com/google/fonts/tree/main/ofl/roboto), SIL Open Font License 1.1                | `public/fonts/roboto-OFL.txt`                   |
| Material vertical-split icon path | [Material Design Icons](https://github.com/google/material-design-icons), Apache-2.0; adapted into a React SVG | `public/licenses/material-icons-APACHE-2.0.txt` |
| Emoji search data                 | [Emoji Mart](https://github.com/missive/emoji-mart), MIT                                                       | `public/licenses/emoji-mart-data-MIT.txt`       |

[Font provenance](public/fonts/README.md) records source URLs, exact sizes and
SHA-256 hashes. Emoji glyphs are rendered by the operating system; the repository
does not redistribute a proprietary emoji font. The app icon in `public/icons/`
is an original project asset, separate from Google's sign-in branding.

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
