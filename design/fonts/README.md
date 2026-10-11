# M114 F font contract

Editors use their own UI/code fonts and sizes. This optional pack is for
standalone surfaces: the companion page, node web UI, Muse Desktop and its
installer. It adds no VS Code setting and no font or font installer to the VSIX.
No rendering or activation path downloads anything.

`manifest.json` is the version-1 runtime contract. Each WOFF2 and exact
OFL-1.1 text has a byte size, SHA-256 and immutable repository URL. The assets
are pinned to commit `52af8cef94b221a3dc5ec1319d32b4c3e5f8ff30`; the lead
must make that commit reachable in the public repository before advertising
the online command. Local seeds already work without network access.

`pack/` contains only upright variable WOFF2 subsets and their licences.
`sources.json` records official release/archive/member digests, source commits,
Unicode ranges, subsetter versions, CSS names and weight ranges. Unsupported
characters use system fallback fonts. These fonts do not replace M111's Noto
CJK/emoji coverage work.

The modified subsets have distinct internal/CSS names: Muse Code JB, Muse
Code FC, Muse Code CC and Muse UI. Copyright/licence records remain intact.
The user's selected original installed family comes first, then its subset
alias, then the token source's existing fallback stack. No reserved upstream
font name is used as the subset's internal name.

## Installation

The runtime command is:

```sh
muse-spark-code-acp fonts install --from /path/to/design/fonts/pack
```

Omit `--from` to fetch only the manifest's pinned repository assets. Downloads
use HTTPS, refuse redirects, send no credentials, have a 30-second overall
deadline and stop at each asset's exact byte bound. A local seed is held to the
same digests. Installation never starts a backend, accesses a credential store
or runs a child process. The command itself is the explicit opt-in.

All eight assets are verified before publication. WOFF2 magic/length and the
OFL header are checked too. A private staging directory is renamed to a
manifest-hash version directory under the runtime's application data `fonts/`
folder. A verified existing installation is reused; a corrupt destination
fails explicitly. Symlink sources/destinations are refused. Failed stages are
removed. There is no OS font registration or editor preference change.

`fonts.css` contains local font faces, variable weight ranges, Unicode ranges
and `font-display: swap`; `manifest.json` accompanies it. The returned directory
is the integration binding. Serve only its declared assets and generated CSS;
keep existing CSP and local-resource rules. No remote stylesheet or CDN is used.

## Standalone appearance port

`src/runtime/fonts/preferences.ts` has no Node or editor import. It validates
`{ ui, code, ligatures }`, exposes translated control labels/choices through
`fontAppearanceSettings(FontPreferencesPort)`, and saves through the injected
host user-settings port. Defaults are Inter, JetBrains Mono and ligatures off.
The user can choose the system UI/code stack instead. Invalid choices or
non-boolean ligatures never reach persistence.

`applyFontPreferences(preferences, host, FontTokenPort)` receives the fallback
stacks from D94's generated token consumer JSON. It sets `--ms-font-ui` and
`--ms-font-code` on standalone surfaces. For code, consume both
`font-variant-ligatures: var(--ms-code-ligatures)` and
`font-feature-settings: var(--ms-code-font-features)`: coding ligatures commonly
use `calt`, which must also turn off. Passing `editor` makes no writes.

`dist/fontsInstall.js` is a runtime-only lazy bundle. Its factory installs the
caller's language before use. It also exports the two appearance functions for
runtime consumers. Browser hosts import the portable preference source into
their standalone settings chunk; native hosts bind the same validated data to
their own appearance controls.

## Image and surface handoffs

| Binding        | Owner                     | Concrete integration                                                                                                                                                                                                                |
| -------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-DISTRIBUTION | Integration lead          | Publish/reach asset commit `52af8cef9`; verify all pinned URLs/digests before advertising online installation. The lane never pushes.                                                                                               |
| F-COMPANION    | M104 / M114 C             | Persist the validated appearance fields in user settings; mount the three labelled controls; apply the injected token writer; serve the verified installed pack as local resources. No pack means existing installed/system stacks. |
| F-NODE         | M110 / M114 N             | Place the same `pack/` and manifest in the image's asset stage; install with the local-seed port into app data; mount the same appearance controls and tokens. No second font pack or font registry.                                |
| F-DESKTOP      | M111 / M114 D / TH        | Stage the same assets in the desktop/installer image, pass a local seed to the installer, and bind the appearance preferences to the Qt/Electron surfaces alongside TH's typography tokens.                                         |
| F-CYCLES       | Integration lead / lane 0 | Add `src/runtime/fonts/fontsEntry.ts` to `package.json`'s `cycles` entry list; F runs that entry directly. The script region stays with its owner.                                                                                  |
| F-DOCS         | M114 S                    | Add the README design/runtime font note and CHANGELOG text below; these files remain S-owned.                                                                                                                                       |
| F-HOST-API     | M114 S                    | Regenerate the host API record: F adds one use each of Node crypto, fs/promises and path (47, 48, 85); retain lane 0's separate theme-inventory repair.                                                                             |
| F-HELP         | Integration lead          | Add featureCatalog/reference rows below when that file joins this base. It is absent here.                                                                                                                                          |

No missing host implementation is replaced with a production fake. Ports are
implemented by their owning surfaces. The test-only fakes and real WOFF2 decode
checks certify this lane's contracts, without claiming those surfaces are bound.

S's CHANGELOG addition under `[Unreleased]`: “Add a pinned optional OFL font
pack for standalone surfaces, explicit verified `fonts install` with offline
seeds, portable UI/code font and ligature preferences, and font notice/package
guards. Editor fonts remain controlled by their host.”

Help/reference rows to integrate: runtime `fonts install [--from <directory>]`
(explicit free install, four pinned OFL subsets, no backend/credential access);
standalone Appearance's UI font (Inter/system), code font (JetBrains Mono/Fira
Code/Cascadia Code/system), and code ligatures (including contextual alternates).
They are not VS Code settings. There are no new `package.nls` manifest keys;
all new runtime/control text and CLI help are translated in the 14 UI tables.

## Rebuilding and gates

Supply the pinned release archives and the two external notice seeds named in
`sources.json`, then run the pinned FontTools/Brotli environment:

```sh
temp/fonttools/bin/python design/fonts/build-pack.py temp/font-sources --out design/fonts/pack
```

The builder makes no network request and rejects any wrong archive/member/notice
digest. The lane ran it twice and reproduced all eight files byte-exact.
Rebuilds require review of the manifest, licences, distribution pin and budget.
`npm run build` verifies notices and every pack byte, the runtime split and its
25 KiB budget. Packaging rejects any font/pack metadata/installer in the VSIX,
including Windows-style member paths. The installed pack's budget is 675 KiB,
measured plus 15%, rounded up to 25 KiB. Existing package/startup caps hold.

See [the certification](../../docs/certification/m114-f-fonts-and-licences.md)
for successful commands, deliberate failures, restore digests and limits.
