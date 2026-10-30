# RLF-M111ED — M111 lane ED, the editor group (D91.14)

Base `int/recovery` dfcb45936 (which carries lane 0). Dates 2026-10-30,
rig linuxlt. Commits: `37668b405` (the group, strings, node wiring) and
the follow-up commit carrying this record (keyboard registration,
TypeScript conversion, UI suite, generated records).

## What is done

- `src/webview/editor/**` replaces `src/webview/node/editor/**` as the one
  editor group for the node's web UI and Muse Desktop (D91.13/D91.14):
  - `groupState.ts` — the pure model: panes, tabs (pinned, the single
    ephemeral preview-editor slot per pane, dirty derived by the host),
    browser-preview tabs, split right/down, tab reorder within the
    pinned boundary, breadcrumbs for either path separator, and
    zod/mini-validated persisted state that refuses a corrupt save.
    No tab, pane or split cap (D121).
  - `languages.ts` — the path-to-language catalog (file names before
    extensions, otherwise honest plain text).
  - `codemirror.ts` — real CodeMirror 6: line numbers, folding,
    bracket matching and closing, multiple selections, find and
    replace (top panel, localized phrases), per-language lazy chunks
    (Lezer JavaScript/TypeScript/JSX/TSX + JSON; legacy stream modes
    for Python, HTML, CSS, YAML, XML, Rust, Go, shell, PowerShell,
    TOML, Docker, CMake, diff, properties), token-themed syntax
    colours (`--ms-syntax-*` with `--vscode-*` fallbacks), the
    in-tree minimap, and `@codemirror/merge` diffs. A language chunk
    that fails to load is reported to the host, which shows the
    localized plain-text notice; the file stays editable.
  - `EditorGroup.tsx` — tablists with roving focus (arrows/Home/End
    through the `editor.group` keybinding registry surface, added to
    `src/shared/keybindings.ts` with Ctrl/Cmd+PageUp/PageDown tab
    cycling and Ctrl/Cmd+1–9 group focus per D91.13), middle-click and
    button close with the host's dirty guard, drag reorder, split
    buttons, the more-actions menu (pin, keep open, close others,
    close unpinned, minimap), breadcrumbs, the status line (line and
    column, language picker, minimap toggle, language-failure
    notice), and the browser-preview slot: a preview tab renders the
    host's content in a frame sized by a `PREVIEW_DEVICES` preset,
    validated through lane 0's `previewViewportSchema`.
  - `editor.css` — token-only paint; the mounting entry imports it
    (the node files page today).
- The minimap is implemented in-tree, not `@replit/codemirror-minimap`:
  neither its tarball nor its repository ships any licence text to
  reproduce in `THIRD_PARTY_NOTICES.txt` (only `"license": "MIT"` in
  package.json; the repo root has no LICENSE), so under D91.14's fork
  clause the minimap is our own view plugin (syntax-coloured blocks
  from the Lezer tree, viewport overlay, click-or-drag scrolling,
  device-pixel scaling). PLAN D91.14 records the change and the pins.
- Node files page (`src/webview/node/files/main.tsx`): every open file
  keeps its own buffer and digest; the tree opens the preview slot,
  editing or double-clicking keeps the tab, the path form opens a kept
  tab and re-reads a clean buffer (never a dirty one); Save, discard,
  upload-over, download and the diff act on the active tab; closing a
  dirty tab is refused with `nodeWorkspace.unsaved` (reworded in all
  15 tables to "before closing this file").
- Lane 0's `src/shared/desktopContracts.ts` now reads `zod/mini`:
  classic zod measured +402 KiB in the node's startup graph the first
  time a browser bundle consumed the contracts (707.3/375 KiB before,
  334.6/375 after). Shapes unchanged; its suite uses `z.parse`.
- Strings: the `editorGroup` group (45 keys) in English and all 14
  tables, `referenceEditorGroupKeys` (English in every table, per the
  reference-strings convention, allowlisted), and the reworded
  `nodeWorkspace.unsaved`. `editorGroup` sits in the surfaces UI-text
  region and in the node bundle's English fallback filter.

## Dependencies not built yet, built against lane-0 contracts

- Lane WB (Electron shell) does not exist: the group is consumed by
  the node's web UI today and mounts unchanged in the desktop when WB
  lands its entry (which imports `editor.css` the same way). No
  stand-in shell was built.
- Lane WP / D91.23 browser views: ED provides the preview tab's slot
  (tab, frame, validated device sizes). The WebContentsView placement
  and process isolation are WP's, per the threat model (B2); nothing
  in ED renders remote or workspace content itself.
- Code intelligence (M110g LSP broker): no completion source is
  registered; `@codemirror/autocomplete` is pinned for bracket
  closing only, so nothing suggests completions that do not exist.

## Budget evidence (D6; no existing budget raised)

Node bundles (`node test/harness/build-node.mjs`), before → after:
workspace 325.8/375 → 335.5/375 KiB; editor 307.3/600 → 563.3/600 KiB;
terminal 343.9/400 unchanged. The editor growth is the group, search,
minimap and the language chunks, measured chunk by chunk from the
build metafile. Full `@codemirror/language-data` measured 1,657 KiB
across 124 chunks in a spike (since removed) — ~1.1 MiB of it
languages; `@codemirror/lang-markdown` alone measured a 99 KiB chunk
with its HTML and CSS parsers. The shipped catalog fits the existing
600 KiB editor budget; lane WB widens it under the desktop bundle's
own new-bundle budget. Production `npm run build`: every bundle
within budget (488 checks ok). `dist/uiText.js` measured 128,007
bytes against its 128,000-byte budget from the new reference string;
the string was shortened in all tables and the file is 127,959 bytes
(base 127,869, measured in a clean dfcb45936 worktree).

## Real-use evidence

- Real Chrome through the node harness (`temp/editor-look.mjs`,
  pictures `m111-editor-group.dark.png` / `.light.png` beside this
  record, inspected): two tabs (italic preview `example.ts`, dirty
  `tools.py`), breadcrumbs, Python highlighting, the minimap canvas
  with painted blocks and viewport overlay, split panes.
- Same session, measured: minimap canvas 2,752 non-transparent
  pixels; find highlighted 28 matches for `def`; minimap click moved
  `scrollTop` 0 → 1,158; split produced two editors; frame rate
  while typing and scrolling 59 fps (p95 frame 16.8 ms, worst
  33.4 ms, 180 frames).
- `test/unit/nodeBrowserWorkspace.test.mjs` (real Chrome, real
  CodeMirror): 5/5 — keyboard edit/undo/save with the original
  digest, stale-save refusal, read-only merge views, German
  screen-reader announcements, 320 px fit. Its first run here failed
  the 320 px check only because `dist/webview/main.css` had not been
  built (no body-margin reset); green after `npm run build:dev`,
  the documented precondition.

## Tests (real code only)

- `test/unit/editor/groupState.test.ts` — 15 tests over the model.
- `test/unit/editor/editorUi.test.tsx` — 11 tests over real React +
  real CodeMirror in jsdom: tab states and breadcrumbs, edit-promotes-
  preview, localized find/replace-all changing the document, the
  TypeScript pack loading and highlighting, line/column, minimap
  mount and toggle, split, dirty-close refusal, clean close and
  arrow-key tab movement, the preview slot with device sizes, a
  language that cannot load reported while staying editable, and a
  read-only highlighted diff. jsdom's missing layout primitives are
  completed by `test/unit/helpers/codemirrorDom.ts` (shared with the
  node workspace suite; environment completion, no product code).
- `test/unit/nodeWorkspaceUi.test.tsx` — 21 tests; H10 rewritten for
  the planned tabbed behaviour (edits kept per tab; the stale-save
  refusal unchanged) and the fixture reads as a faithful two-file
  store. `test/unit/nodeWorkspaceBuild.test.ts` notices now name the
  shipped `@codemirror/state` and `@codemirror/lang-javascript` pins.
- `test/unit/desktop/contracts.test.ts` — 5 tests, `z.parse` form.

## Red/green drills (break, watch it fail, restore, green)

- Preview slot: forced `ephemeralIndex = -1` in `groupState.ts` →
  groupState suite 2 failed / 13 passed; restored → 15 passed.
- Localization: deleted `editorGroup.minimap` from `l10n/ui.de.json`
  → `check-l10n` reported 2 problems; restored → 0 problems.
- Budget: added `sql` + `clike` legacy loaders (+58 KiB measured) →
  node editor 621.1/600 KiB and the builder threw `node browser
budget exceeded`; restored → 563.0/600 KiB, build completes.

## Gates (2026-10-30, this rig)

- prettier --check on touched files: pass. eslint --max-warnings 0
  on touched files: pass. stylelint on both stylesheets: pass.
- `npm run typecheck`: exit 0. (One earlier backgrounded run reported
  TS2724 in `nodeWorkspaceBuild.test.ts` while a dev build was
  rewriting generated files concurrently; the declaration and export
  are intact and every foreground run since — scoped and full — is
  exit 0.)
- `node scripts/check-l10n.mjs`: 0 problems.
- `npm run check:reference`: current after `reference:generate`.
- `npm run check:host-api`: 0 problems after the `--write` refresh
  (editor.css reads 95 theme variables now recorded).
- `npm run check:plan`: 0 drift. `npm run check:roadmap`: current
  after `roadmap:generate`. `npm run check:tokens`: 0 problems.
- `npm run check:catches`: all counts match the baseline (the two
  new catches are REPORTED through `onLanguageFailed`).
- `npm run duplication`: 0 clones. `npm run cycles`: none.
  `npm run deadcode`: no unused files, exports or dependencies.
- `npm run security:audit`: 7 advisories, all pre-existing at base
  (fast-uri, mocha, qs, serialize-javascript), 0 exceptions.
  `SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast` exits 1 with
  6 blocking findings, all in pre-existing crypto files
  (`ModelApiHost.ts`, `mcp/headers.ts`, `node/keyStore.ts` and
  siblings); zero findings in any file this lane touched.
- Suites: editor 31 + contracts 5 (in the same run), node workspace
  UI 21 + build 4, browser 5, keybindings 22 — all green with the
  repository's own timeouts. `npx vitest related` over the changed
  sources (27,832 tests through `constants.ts`'s blast radius):
  70 failed / 27,423 passed, every failure in untouched device,
  vault, connector, judge or native suites; three representative
  files (`acpServeHandshake`, `deviceJournal`, `nodeGitRunner`)
  re-run at the base commit in a clean worktree fail identically
  (8 failed there too), so the red is the recovery base's, not ED's.

## What remains for later lanes

- WB mounts the group in Electron and widens the language catalog
  under its own bundle budget; WP renders browser views into the
  preview slot; M110g's broker feeds completions and diagnostics.
- The desktop layout persistence (WBp) can persist `EditorGroupState`
  as-is; `parseEditorGroupState` is the boundary.
