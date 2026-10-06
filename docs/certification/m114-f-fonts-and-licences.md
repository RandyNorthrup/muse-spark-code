# M114 F — fonts and licences (Kubuntu, 2026-10-06)

Lane F only, based on `m114/p1` at `28ffc2def`. Read D94 and M114 in full,
the shared rig rules, token contracts, lane A/P1 certification and the font
coverage notes in the Muse Desktop research. No credentials, paid/live model
calls, new project npm dependency, push, merge or rebase. Hooks are present
at `.husky/_/pre-commit`.

The common rules' later explicit preapproval for installing required tools
and system dependencies covers the font sources and subsetter. Official
release archives and two exact upstream licence texts were downloaded into
this worktree's ignored `temp/font-sources/`. FontTools 4.60.1, Brotli 1.1.0
and its Zopfli 0.4.3 dependency were installed in the ignored
`temp/fonttools/` virtual environment; no shared node_modules was changed.
No font or third-party executable was installed into OS/editor settings.

## Pinned assets

`design/fonts/sources.json` records official release URLs, immutable source
commits, full archive/member/notice SHA-256 digests and subset instructions.
The pack holds only the four variable, upright WOFF2 subsets and their exact
OFL-1.1 texts. Latin, Greek, Cyrillic and the declared programming/symbol
ranges are retained, with all existing OpenType layout features. CJK and
other unsupported glyphs use the system fallback; M111's separate Noto
coverage work remains with its owner.

| Font           | Release | WOFF2 bytes | WOFF2 SHA-256                                                      |
| -------------- | ------- | ----------: | ------------------------------------------------------------------ |
| JetBrains Mono | 2.304   |      91,968 | `572125c5c74010505722369c082491a0baa1b82a9a0ef9fb7cebc93fa382fc33` |
| Fira Code      | 6.2     |      87,344 | `ba5a486c9a54657c78b7e68d7364ae8b7d14ee9b13d10a928ce6f9a0898b5a4e` |
| Cascadia Code  | 2407.24 |      98,916 | `53e34c6fa96b01406dc6bedf96c064fb282ffa5fe27ad4b5a0347be1cf2a2fb6` |
| Inter          | 4.1     |     291,232 | `3d5e422cc2d389412e7f282d9636f3f6106f1b420ba4933993d77180cf9de138` |

Modified fonts use `Muse Code JB`, `Muse Code FC`, `Muse Code CC` and `Muse
UI` as internal/CSS names. Original copyright and licensing records remain.
All four variable weight axes retain the upstream ranges; Inter also retains
its optical-size axis. Installed original families stay first in the
standalone preference stack, followed by these aliases and system fallbacks.

## Source/build verification

- `temp/fonttools/bin/python design/fonts/build-pack.py temp/font-sources
--out design/fonts/pack`: passed. The builder never downloads anything.
- A second run into `temp/font-pack-repeat` reproduced all eight assets
  byte-exact; result JSON and individual asset bytes compare equal.
- FontTools reopened every WOFF2 and verified renamed family/full/PostScript
  records and retained variable axes.
- Source-digest red drill: flipping the first byte of the JetBrains release
  archive in a scratch seed made the builder exit 1 with **Source digest
  mismatch**. Restored archive SHA-256:
  `6f6376c6ed2960ea8a963cd7387ec9d76e3f629125bc33d1fdcd7eb7012f7bbf`.
- `.gitattributes` preserves exact licence line endings and WOFF2 bytes on
  Windows as well as POSIX.

Runtime, appearance-port, notice, package and final verification receipts are
recorded in the follow-up below after the asset commit pins distribution URLs.
The full quality run is delegated to the lead by the shared rig brief.
