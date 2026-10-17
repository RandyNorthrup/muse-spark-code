# Shared English fallback build change (2026-09-30)

The lead accepted this build-wide change separately from M71. It uses the
existing esbuild manual split: `dist/uiText.js` holds the English fallback;
each Node consumer retains its own mutable installed-language state. The
browser and development integration tests still bundle their fallback.
No further bundle or loader was added. Existing caps were not raised.

## Build-only before and after

Source is release candidate `1fd98aaf`, copied inside this lane's ignored
`dist/lane-m71/build-review/base`. The second build changes only the build
scripts; no M71 source or translations are in that comparison. Both ran
`node scripts/build.mjs --production`, exit 0, on Windows with Node
24.20.0 and npm 11.19.0. Sizes are minified, uncompressed KiB.

| Artifact           | Before | After |             Cap |
| ------------------ | -----: | ----: | --------------: |
| extension.js       |  591.6 | 519.4 |             600 |
| modelApi.js        |  398.4 | 326.2 |             400 |
| checkpointStore.js |  186.8 | 114.6 |             225 |
| acp.js             |  788.6 | 716.4 |             850 |
| uiText.js          | absent |  72.7 |             100 |
| planMarkdown.js    |  139.0 | 139.0 |             150 |
| searchWorker.js    |   15.2 |  15.2 |              50 |
| pageWorker.js      |  201.2 | 201.2 |             300 |
| webview/main.js    |  777.2 | 777.2 |             900 |
| webview/main.css   |   38.1 |  38.1 | no separate cap |

The recovered M71 working source also passed `npm run build`, exit 0:
extension 566.9, Model API 327.8, checkpoint store 115.8, ACP 719.3,
English table 82.1, plan reader 139.0, search worker 15.2, page worker
201.2, webview JavaScript 800.9 and CSS 39.7 KiB. This second measurement
belongs to the M71 source; it is not the first commit's build-only delta.

## Runtime and packaging

- `node scripts/package-acp.mjs` packed the build-only source, exit 0.
  An isolated consumer used a generated lock referencing that local tarball
  and the repository's pinned keyring entries. `npm ci --offline
--ignore-scripts --audit=false --fund=false` installed it, exit 0, without
  network access or a global install.
- `node scripts/check-ui-text.mjs <installed-package-root>` passed against
  both the build-only extension/Model API output and the recovered working
  output. It evaluates the actual bundles, observes their Node require of
  the table, and checks their runtime exports. The installed ACP process's
  `--help` output matches its packaged English template exactly. It uses an
  empty environment, no credential-store operation and no model call.
- `.vscodeignore` now includes the table. The VSIX and ACP lists in
  `.github/workflows/build.yml` require it with exact member matching.
  The local `vsce ls --no-dependencies` file list includes `dist/uiText.js`.
- CI's package job runs the same smoke on every push: it installs the ACP
  tarball it just packed (`npm install --ignore-scripts` into the runner's
  temp folder) and runs `scripts/check-ui-text.mjs` against it and the
  production bundles. Run locally on Windows 2026-10-01 after merging main:
  exit 0.
- Development builds already emit the table beside `extension.js`;
  integration-test bundles do not use the sharing plugin and retain their
  own fallback. `.vscode-test.mjs` therefore needs no change. Real editor
  activation and complete platform gates remain the lead's responsibility.

The isolated baseline's split check encountered dependency paths resolved
through its `node_modules` junction, rather than the gate's expected relative
paths. That fixture result is not a passing split receipt. The actual lane's
production build passed the complete size/split/host-global/notices checks.

## Gate-fire records

Each mutation used the actual lane output, normal check commands, and exact
byte restoration with SHA-256 comparison. Green and restored runs exited 0;
each intentional red exited 1. Raw output stays in ignored `dist/lane-m71`.

| Mutation                                       | Check                  | Intended failure                                      |
| ---------------------------------------------- | ---------------------- | ----------------------------------------------------- |
| Remove English input from table metafile       | check-bundle-split.mjs | table no longer carries en.ts                         |
| Add English input to activation metafile       | check-bundle-split.mjs | activation duplicates en.ts                           |
| Remove activation's external table import      | check-bundle-split.mjs | activation no longer loads shared table               |
| Grow table beyond 100 KiB                      | check-bundle-size.mjs  | OVER dist/uiText.js, 189.5 KiB                        |
| Replace compiled Untitled fallback with Broken | check-ui-text.mjs      | runtime assertion receives Broken instead of Untitled |

The first budget-drill harness expected the wrong diagnostic spelling;
the gate itself failed correctly and the artifact was restored. The corrected
diagnostic then completed green/red/restored-green proof. No gate was changed.

## Independent review RV67 (2026-10-01) and its fixes

A read-only Codex review of PR #67 found no shipped consumer broken and
three gaps, all fixed in this PR:

- **The smoke never loaded the installed agent's Model API bundle**
  (`--help` starts no backend). `check-ui-text.mjs` now loads
  `<installed package>/dist/modelApi.js` too. Drill on Windows: its
  `./uiText.js` require renamed to `./uiText-missing.js` in the installed
  copy, the check failed with `Cannot find module './uiText-missing.js'`;
  restored (SHA-256 `d6a7a124776271ae…` before and after), exit 0.
- **An empty environment did not force English**: with no locale variable
  the agent takes the runtime's locale, so a runner whose default is a
  supported language would fail the comparison against valid localized
  help. The child now gets `LC_ALL=en_US.UTF-8`. Shown on Windows: the same
  installed agent prints `Verwendung:` with `LC_ALL=de_DE.UTF-8` and
  `Usage:` with `LC_ALL=en_US.UTF-8`.
- **The plugin matched only the extensionless spelling** of the table's
  import; `en.js` (valid under the TypeScript module resolution) inlined the
  whole table. It now matches `en`, `en.js` and `en.ts`. Drill on Windows:
  `src/host/l10n.ts` importing `../shared/l10n/en.js`, check-bundle-split
  exit 0 with the fix and exit 1 with the previous plugin; both files
  restored byte for byte (SHA-256 `860bf5f082c9ab17…`,
  `e3e03fa0ee1edd9e…`), then a full production build and split check exit 0.
