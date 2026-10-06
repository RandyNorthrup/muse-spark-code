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

## Runtime and appearance contracts

Asset commit `52af8cef94b221a3dc5ec1319d32b4c3e5f8ff30` pins the public
repository paths in `design/fonts/manifest.json`. The lane cannot push: online
installation must wait for the lead to publish that commit and verify the URLs.
The real command and the extracted ACP tarball's command both successfully
installed the committed local seed with isolated `XDG_DATA_HOME`:

```sh
XDG_DATA_HOME="$PWD/temp/font-cli-data" node dist/acp.js fonts install --from design/fonts/pack
XDG_DATA_HOME="$PWD/temp/font-package-data" node temp/font-package-proof/package/dist/acp.js fonts install --from "$PWD/design/fonts/pack"
```

Both produced the same manifest-hash version directory
`muse-fonts-1-8fe67381cfd022e54ef9f533ce40cb3b68db308395339aafd27dd9c2260a51cf`.
No backend, credential store, OS font registration or child process is used.
Local-install tests inject a fetch function that throws if called. The tarball
was extracted locally with Python's data filter; no global/npm installation
or online-install success is claimed.

The runtime installer verifies all eight files before atomic publication,
bounds local and streamed reads, rejects symlink files/destinations, and reuses
only an exact existing pack. Fonts, CSS and the manifest are installed together.
A cancelled, corrupt or malformed install returns an explicit failure.

`FontPreferencesPort` and `FontTokenPort` are portable injected interfaces for
standalone settings and token application. Three controls default to Inter,
JetBrains Mono and ligatures off. Validated preferences preserve host fonts in
editor mode; standalone mode uses the chosen installed font, renamed subset,
and existing fallback stack. Ligature-off also disables contextual alternates.
Labels are read after language installation. Eight keys and canonical CLI help
are translated in all 14 UI tables. No new VS Code manifest key is needed.
The compiled-entry test exercises shared zod-mini and shared English fallback;
the manifest uses the namespace import required by that shared validation ABI.

## Deliberate guard failures

All 31 code mutations below exited 1 with the named test failing. Each used
`npx vitest run test/unit/<owning-file> --maxWorkers=3`, repository default
per-test timeouts, then restored the original bytes in `finally` and compared
SHA-256. The source-archive digest drill above is the 32nd drill. The strict
manifest drill initially changed only the unchained calls and did not fail;
it was corrected to cover every `strictObject` call, and nested strictness
assertions were added before the final successful red run. No mutation remains.

The named failure is the last segment after the test's describe path. Each
row identifies the guard intentionally removed or weakened.

| Guard weakened          | Owning test file                    | Named failing test                                                                            |
| ----------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `explicit-command`      | `test/unit/fontsInstall.test.ts`    | accepts only an explicit install, with an optional local seed                                 |
| `asset-path`            | `test/unit/fontsInstall.test.ts`    | rejects duplicate families, traversal, unpinned URLs and wrong asset kinds before any read    |
| `pinned-url`            | `test/unit/fontsInstall.test.ts`    | rejects duplicate families, traversal, unpinned URLs and wrong asset kinds before any read    |
| `distinct-family`       | `test/unit/fontsInstall.test.ts`    | rejects duplicate families, traversal, unpinned URLs and wrong asset kinds before any read    |
| `distinct-assets`       | `test/unit/fontsInstall.test.ts`    | rejects duplicate families, traversal, unpinned URLs and wrong asset kinds before any read    |
| `pack-budget`           | `test/unit/fontsInstall.test.ts`    | rejects duplicate families, traversal, unpinned URLs and wrong asset kinds before any read    |
| `css-family`            | `test/unit/fontsInstall.test.ts`    | rejects duplicate families, traversal, unpinned URLs and wrong asset kinds before any read    |
| `digest`                | `test/unit/fontsInstall.test.ts`    | rejects digest, length, WOFF2 header and OFL tampering without publication                    |
| `asset-length`          | `test/unit/fontsInstall.test.ts`    | rejects digest, length, WOFF2 header and OFL tampering without publication                    |
| `woff-magic`            | `test/unit/fontsInstall.test.ts`    | rejects digest, length, WOFF2 header and OFL tampering without publication                    |
| `woff-length`           | `test/unit/fontsInstall.test.ts`    | rejects digest, length, WOFF2 header and OFL tampering without publication                    |
| `ofl-text`              | `test/unit/fontsInstall.test.ts`    | rejects digest, length, WOFF2 header and OFL tampering without publication                    |
| `cancel`                | `test/unit/fontsInstall.test.ts`    | aborts before publication and never reads after cancellation                                  |
| `stream-bound`          | `test/unit/fontsInstall.test.ts`    | uses pinned URLs with redirects and credentials disabled and bounds streaming bytes           |
| `source-symlink`        | `test/unit/fontsInstall.test.ts`    | rejects a local source symlink before opening its target on every platform                    |
| `destination-symlink`   | `test/unit/fontsInstall.test.ts`    | refuses symlink destinations and local seed files                                             |
| `lazy-module`           | `test/unit/fontsInstall.test.ts`    | refuses an invalid lazy module and retries after it is repaired                               |
| `editor-fonts`          | `test/unit/fontPreferences.test.ts` | leaves every editor host font under its own settings                                          |
| `ligatures`             | `test/unit/fontPreferences.test.ts` | applies user choices, system fallback and optional ligatures to standalone tokens             |
| `contextual-alternates` | `test/unit/fontPreferences.test.ts` | applies user choices, system fallback and optional ligatures to standalone tokens             |
| `preferences-boundary`  | `test/unit/fontPreferences.test.ts` | defaults to the chosen standalone stacks and validates saved choices                          |
| `vsix-font`             | `test/unit/fontsPack.test.mjs`      | rejects a font or its runtime installer anywhere in a VSIX listing, including Windows paths   |
| `notices-assets`        | `test/unit/fontsPack.test.mjs`      | rejects altered font and licence assets in the notices gate                                   |
| `runtime-split`         | `test/unit/fontsPack.test.mjs`      | guards the font implementation split from ACP startup, normalizing Windows inputs             |
| `lazy-members`          | `test/unit/fontsPack.test.mjs`      | guards the font implementation split from ACP startup, normalizing Windows inputs             |
| `runtime-labels`        | `test/unit/fontPreferences.test.ts` | reads labels after the host installs its language table                                       |
| `missing-settings`      | `test/unit/fontPreferences.test.ts` | defaults to the chosen standalone stacks and validates saved choices                          |
| `boolean-ligatures`     | `test/unit/fontPreferences.test.ts` | defaults to the chosen standalone stacks and validates saved choices                          |
| `strict-preferences`    | `test/unit/fontPreferences.test.ts` | defaults to the chosen standalone stacks and validates saved choices                          |
| `strict-manifest`       | `test/unit/fontsInstall.test.ts`    | validates the manifest as a strict local contract                                             |
| `installed-alias`       | `test/unit/fontsPack.test.mjs`      | binds every selected family to its installed alias while keeping original/system stacks first |

Byte-exact original/restore digests from the red run:

| Mutated file                       | Restored SHA-256                                                   |
| ---------------------------------- | ------------------------------------------------------------------ |
| `src/runtime/cliArgs.ts`           | `09eafeb587c6613c2b9bb6c41dd40bf3976370afa56394d1013fa202c49e260a` |
| `src/runtime/fonts/manifest.ts`    | `41395dead1a54388ba082e0875bd0f602a1b3aa98f27a82c4b9d31251ec3ca1f` |
| `src/runtime/fonts/install.ts`     | `66318c42ceb40cb32fcc76006894379ba4843404810b7fb6cf49ff8b2c36b864` |
| `src/runtime/fonts/nodeInstall.ts` | `e2a237abe4583d4c2b447ec887e93686e1b90435b21811ffdaabc1375407300b` |
| `src/runtime/fonts/bundle.ts`      | `e352fc477d56fdd6e2eb2143b3d5e7da775f1c8e429c78e7ef706d3e21ebf9a8` |
| `src/runtime/fonts/preferences.ts` | `2189c69872a8c173c3617ab0f41eaf5d37780015db718491ef832ce5ea3c1222` |
| `scripts/notices-fonts.mjs`        | `578df03eb59554d729792ad2483423e1ddf86ca20df084e807c345815ea2d99c` |
| `src/shared/constants.ts`          | `4af32e43e39f2c32fd71ce7315f7ffe26164a8932d4edfb44725018f31ada3d9` |

A subsequent comment in `nodeInstall.ts` explains its existing invalid-pack
catch; it changes no guard. The final green run verifies the restored code.
Browser checks decoded all four real WOFF2 subsets at weights 400 and 700 in
Chromium. No PNG/screenshot was created or committed.

## Verification and budgets

- Final owning font run: `npx vitest run test/unit/fontsInstall.test.ts
test/unit/fontPreferences.test.ts test/unit/fontsPack.test.mjs --maxWorkers=3`:
  **23 passed**, no raised timeout. Expensive compiled-bundle/browser setup is
  shared, and each test stays under the repository default.
- Existing runtime/help coverage: `npx vitest run test/unit/acpRuntime.test.ts
test/e2e/acpStdio.e2e.test.ts --maxWorkers=3`: **48 passed**, default timeouts.
  Total distinct scoped tests: **71**.
- `npm run typecheck`: all five projects passed. Changed-file ESLint and
  Prettier passed. `node scripts/check-l10n.mjs`: **0 problems**, 14 tables.
  Plain `npm run deadcode` passed; `npx jscpd` passed with **0 clones** after
  deduplicating the new test seed helper. Scoped `dpdm` on
  `src/runtime/fonts/fontsEntry.ts` passed (10 files, no cycles).
- `npm run build`: passed tokens, production compilation, sizes, bundle split,
  host globals and notices. **87 notices**, including every optional font and
  its exact OFL text. Font bytes/digests are checked on every build.
- Local VSIX/ACP packagers passed using the existing named local badge skip,
  `BADGE_CHECK_SKIP_NETWORK='M114F shared rig rules prohibit public badge requests'`.
  This is a rig-only exception; CI still verifies real badge responses.
- Actual VSIX ZIP member inspection: no font file, pack metadata or font
  installer; all four font notices remain. ACP tar inspection: lazy installer
  and manifest present, no WOFF2 payload; all four notices remain.

| Artifact                         |        Measured |            Unchanged/new separate cap |
| -------------------------------- | --------------: | ------------------------------------: |
| Extension JS                     |       438.4 KiB |                     600 KiB unchanged |
| Model API JS                     |       446.9 KiB |                     475 KiB unchanged |
| Webview startup JS               |       793.2 KiB |                     900 KiB unchanged |
| Webview deferred JS              |        49.7 KiB |                      50 KiB unchanged |
| ACP startup JS                   |       819.3 KiB |                     850 KiB unchanged |
| Fonts lazy installer             |        11.4 KiB |            25 KiB new separate budget |
| Eight pack assets                |   587,117 bytes |           675 KiB new separate budget |
| Installed pack, CSS and manifest |   591,645 bytes |                               675 KiB |
| VSIX                             | 2,172,528 bytes | 2,252,800 bytes (2,200 KiB) unchanged |
| ACP tarball                      | 1,306,957 bytes |                 No package cap raised |

The new budgets use measured size plus 15%, rounded upward to 25 KiB. The
existing VSIX cap is stricter than the brief's 2,400 KiB ceiling and is retained.
A same-build comparison against `28ffc2def` measured ACP startup at 837,807
bytes before and 838,969 after: **1,162 bytes growth**, within D94's 2 KiB
startup-loader target. The separate lazy installer/manifest add package bytes
beyond that target; no claim of total ACP-package growth below 2 KiB is made.
Webview startup grows approximately 0.4 KiB for translated fallback text,
within the brief's 4 KiB target. CSS/panel font mappings remain unchanged.

Package SHA-256 receipts:

- `muse-spark-code-0.14.1.vsix`:
  `a7fe10ffd39a97abb76a7f69be293f34f7d86314ee93897f2303523471e6306e`.
- `muse-spark-code-acp-0.14.1.tgz`:
  `1da989180e53b5f89688e83f7b9e9e28762287b430f17c1561b3be410a8ab5e4`.

## Named integration limits

The complete binding instructions, proposed Unreleased changelog paragraph,
README addition and help-reference rows are in `design/fonts/README.md`.
`F-COMPANION` (M104/C), `F-NODE` (M110/N) and `F-DESKTOP` (M111/D/TH) own
mounting their real settings controls and local assets/image stages. Those
hosts are absent on this base; this lane supplies injected ports and the real
install/pack implementation, without a production fake or an integration claim.
`F-DISTRIBUTION` publishes the pinned asset commit before online installation.
`F-CYCLES` adds the lazy entry to lane 0's owned package.json cycle list.
`F-DOCS` and `F-HELP` integrate S-owned docs and the absent feature catalog.

`node scripts/check-host-api.mjs` reports **one stale-record problem**:
S must regenerate the record for F's Node use counts (crypto 46→47,
fs/promises 47→48, path 84→85), alongside lane 0's already-deferred theme
inventory (now styles/tokens/What's New, 49 theme variables). No VS Code API
was added. This is recorded in PLAN §7 and `F-HOST-API`; S owns the file.
The check itself was run and its failure is not represented as green.

Per the shared rig brief, aggregate `npm run quality`, full coverage,
a11y/visual screenshots, cross-platform/hosted checks and universal packaging
remain the integration lead/S gate. The Kubuntu VSIX lacks the compiled macOS
helper as on the base. No gate, ignore, threshold or existing cap was relaxed;
no paid/live model calls, credentials, push, merge or rebase occurred.
