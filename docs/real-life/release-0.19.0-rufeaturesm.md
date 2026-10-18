# Real use: 0.19.0 features group (RUFEATURESM, macOS)

Version 0.19.0, branch `realuse/0190-features-m`, group merges
#219 #221 #224 #226 #206 #243 #231 #232 (plus base #230 #203 #199 #190 #189
#185). Platform: MacBook Pro (darwin/arm64), owner's laptop. Product: the
repository's own build run directly in the worktree
(`/Users/user/lanes/RUFEATURESM`), driven as `node dist/acp.js` — the same
bytes the ACP tarball ships (precedent: lane REALUSE176; full tarballs and
the .vsix do not complete on this rig because the Linux helpers
`native/linux/*/muse-created` build only on Linux and the lead packs there).

Build: `npm ci` clean. `npm run build` stops at the What's New bound
(CHANGELOG 0.19.0 decodes to 147,798 bytes over the 76,800 bound; the join
trims the notes), so every build below ran with a LOCAL-ONLY trim that was
never committed: 0.19.0 kept to Highlights + Pending, backup at
`temp/CHANGELOG.full.md`, full file restored before each commit (verified by
`git status`/`git show`). Say it plainly: the packed bytes below carry the
trimmed What's New notes, everything else untrimmed.

Model calls: 4 turns, all on `--model muse-spark-1.3-contributor`
(never the default; the CLI's session index holds 0 rows, so there are no
provider lines to contradict this). Two raw-CLI probes and two product
turns, each a one-word reply. Spend per the product's own tally:
`requests 0; settled $0.000000` on every product turn (Muse Code backend
turns are not metered in the run ledger). Against 40 / $2.00: 4 / ~$0.00.

## Build repairs found and fixed (FAILs, all committed)

1. `npm run build` failed the size gate three ways plus the split gate with
   55 problems. Root causes, all dropped lines in the group's own merges:
   PR #226's merge dropped the `productionMediaEntry →
`dist/productionMedia.js`` externalization from `DEFERRED_OUTFILES`
   (PR side line 1096, gone at the merge), so every dynamic import of the
   production media bundle compiled inline: `modelApi.js` 572.3/525 KiB,
   `productionAudio.js` 141.2/75 KiB, 55 split problems. PR #243's merge
   dropped the `reportInputs` / `playbookSchedulesInputs` production builds
   (PR side, gone at the merge): size gate listed both as not built.
   Restored both to their PR-side positions (commit `0b8fd9b7b`).
   After: modelApi/productionAudio back under budget, split gate 55 → 1.
   The last split problem was PR #206's picked-text template reader list
   omitting the runtime's ACP/exec media port (`src/acp/media.ts` always
   formatted picked files; the list predates the use): declared the
   legitimate reader with its reason (same commit). Split gate now green.
2. `exec --model muse-spark-1.3-contributor` was refused as unknown despite
   `--allow-contributor-models`: the CLI's 1.4.10 catalogue lists four
   models even in contributor mode (`muse serve --contributor-mode on`
   verified to not expand `model/list`, and the flag's server-side training
   scope is undocumented, so it was NOT adopted). With the opt-in, a
   contributor-tier id is now attempted (`session/setModel`) and the CLI's
   answer stands; anything else is still refused before dispatch (commit
   `07a29194c`, CHANGELOG under [0.19.0]). Proven live: the contributor
   turn answers through the packed agent. A typo'd contributor id
   (`muse-spark-9-contributor`) reaches the CLI and fails with the CLI's own
   words, zero requests dispatched. A non-contributor unknown id is still
   refused locally (`usage_error`, exit 2).
3. Still red (reported, not fixed): `dist/conversation.js` 254.9/250 KiB.
   Organic cumulative growth, no dropped line, no misplaced module (split
   gate green): per-merge source deltas on the bundle's inputs are
   #219 +29, #221 +275/-37, #224 +166/-27, #226 +290/-35, #206 +271/-17,
   #243 +299/-15 (largest single file: conversationController.ts, #221
   playback turn handling +243/-37). Needs a diet lane (a coherent chunk
   moved behind a lazy seam with its gate rows); raising the cap is not an
   option. This blocks `npm run package` (the .vsix) on top of the
   Linux-helper limitation above.

## Behaviour proofs

- Contributor turn (group prerequisite): `exec --backend museCode --model
muse-spark-1.3-contributor --allow-contributor-models --cwd <scratch>
"Reply with exactly this word: quince"` → `quince`, exit 0. PASS.
  Repeated once as control: PASS.
- `/playback` (#221) on Muse Code: FAIL against the [0.19.0] CHANGELOG,
  fixed docs-side. The product refuses before dispatch (exit 8,
  `incomplete`, requests 0): "Invalid request: A playback needs the Model
  API backend: Muse Code offers no turn without tools, so no playback can
  start there." The refusal is the deliberate, PLAN-recorded design
  (commit `a1c516f17` inside the #221 line: a Plan-held ordinary turn
  cannot guarantee no tool use); the CHANGELOG still claimed Plan-mode
  playback on Muse Code and `docs/acp.md` claimed "a model turn, on both
  backends". Corrected both to the refusal (this change). The turn itself
  needs a Model API key: NOT PROVEN here (no key is read or stored).
- Attach on Muse Code (#226 media): `exec --attach note.txt` /
  `--attach flag.png` (a real 96x64 PNG I generated and verified with
  `file`) → refused before dispatch (exit 3, sessionId null, requests
  null, 479 ms): "This session has no file upload service, so video and
  audio cannot be sent. Use the Model API backend with a Meta key."
  PASS as designed (the media port is Model API-only; no call spent).
  Note: the human-readable output prints only "message withheld: the
  response did not complete / Backend Unavailable" and hides the reason
  (the JSON envelope carries it). Pre-existing presentation gap, out of
  group scope, noted for the lead. Media turns, transcription, codec
  refusals and production composition need a key: NOT PROVEN here.
- `ACP /uploads` (#226): answered locally, no model turn: "Invalid
  params: No uploaded files." PASS with a note (empty ledger and
  no-upload-port share one sentence; committed behavior, no test pins it).
- Reports (#243 + REPORTJOIN): `report --help` lists all thirteen working
  kinds (`milestone <id>`, `estimate <milestone>`, accounts, security,
  playbook, schedules…): PASS. `report milestone` / `report estimate` with
  no scope print the usage naming the missing argument (RVMSM113): PASS.
  `report problem` generates (real facts: 0.19.0, darwin, node 24.21.0,
  "cli: found; signed in: no" — file-structure scoped, turns still run via
  the CLI's own sign-in) and `report problem --out r1.json` writes the
  file: PASS. `report problem --out` does not record history
  (`report history` → "No report history yet."): by design (panel-side
  keep). Every source-reading kind (`project`, `changes`, `quality`,
  `usage`, `session`, `keybindings`, `accounts`, `security`, `estimate`,
  `playbook`, `schedules`, `release`) fails identically in scratch and the
  worktree: exit 1, "The report could not be generated." (+ a resource
  warn). NOT PROVEN, not a product FAIL on this evidence: old untouched
  kinds fail exactly like new kinds; PR-side certifications generated
  reports pre-merge and the #243 merge diff in the reporting tree is one
  line; this rig has two broken inputs (git exits 71 without DEVELOPER_DIR
  set — the product's children don't set it — and the data home is a
  symlink with unsafe-root warnings plus resource-init warns). The lead's
  Windows run settles it in seconds.
- Providers (#219, keyless): `providers list` → "No providers are
  configured." PASS (read-only; the owner's file was never written).
  `providers test ghost` / `providers remove ghost` → "Unknown provider:
  ghost." exit 1, pre-dispatch: PASS. `providers usage <id>` (any id) and
  `auth status` → silent exit 1, zero bytes on both streams. Cause: the
  crashed-Connect recovery wrapper returns 1 with no notices when the
  secret store is unreachable in this sandbox, and neither wrapper prints
  (compare `connect`, which does). Pre-existing machinery (CM952R5), but
  it bites #219's new `providers usage` command on its most basic input:
  recorded as OBSERVATION for the lead (fixing credential-transaction
  error paths needs its own milestone and a reachable keychain; the
  store was deliberately never touched here). Provider add/scan,
  manual context windows, Azure entries, rate-limit headers, Models table:
  need keys/servers/panel: NOT PROVEN here, never stood in for.
- #206 (CLI/SDK 1.4.10): every turn above ran against CLI 1.4.10
  ("Connected to muse 1.4.10", schema v1
  sha256:5d3b43e5ccdb7dc4f5a32c380f5f2cde0f10e3059b93610afb2e73f73b1d914c,
  sessions durable): PASS. `dist/museCode.js` ships and the backend lazy
  loads (serve spawns per session): PASS. Machine settings and the
  permission-profile pick are panel-side: inventory only (keys present in
  `package.json`).
- #224 (voice/dictation): `dist/dictation.js`, `dist/voice.js` and the
  Darwin helper (built here with `native/darwin/build.sh`, Swift 6.2.1)
  ship: PASS as artifacts. Recording needs a microphone, Linux voice needs
  Linux, transcription needs a key with paid consent: NOT PROVEN here.
  The no-behaviour-change bundle move is regression-covered by every
  backend start above.
- #231 (other-CI) / #232 (real-use workflow): no in-product behaviour;
  `ci/`, `ci-templates/`, `.github/workflows/real-use.yml`
  (workflow_dispatch only) present as designed. Vendor runs need vendor CI:
  NOT PROVEN here by construction.
- Panel-only (Models table, quick pick, What's New page, /uploads panel
  side, playback panel, Tab): no browser/GUI on this rig: NOT PROVEN
  here by construction.

## Gates (this lane's code changes)

- `npx prettier --check` on every changed file: clean.
- `npx eslint` on every changed file: zero warnings (one boolean-name and
  two structure findings fixed in the edit, not suppressed).
- `npm run typecheck` (all projects): exit 0.
- Touched suites with the repo timeout (never raised): `sandbox` 25/25,
  `execArgs` 55/55. `vitest related` for `agent.ts`/`runExec.ts`: no
  files (their proof is the live runs above, recorded here).
- New-behaviour calibration: the contributor-selection allowance was
  verified by breaking it (bogus id refused locally; typo id refused by
  the CLI with zero dispatch).
- `npm run build`: green except the two documented bounds (What's New
  notes await the join's trim; conversation budget needs a diet lane).
  Size gate otherwise green, split gate green, `exec-schema --check`
  green ("Exec schemas match.").

## Commits

- `0b8fd9b7b` build-line restoration + reader declaration (+ CHANGELOG).
- `07a29194c` contributor-tier attempt (+ CHANGELOG).
- This commit: this record + playback doc fix (+ CHANGELOG).

---

# Round 2 (2026-10-18, rig `macmini`, lane RUFEATURESM2)

Branch `realuse/0190-features-m2` (Intel Mac, x86_64: this platform's
target is `darwin-x64`). Model on every packed-product request:
`muse-spark-1.3-contributor` (`exec --model`, ACP `session/set_config_option`;
the 4-model serve catalogue still defaults to `muse-wonder-1.0`, never let
through). Provider-line audit: this lane's CLI journal for its own ACP
session (`01a150e2-…`, `~/.local/share/muse/sessions/.msp-view-g6/`) holds
4 model lines, all `muse-spark-1.3-contributor`, zero for any other model;
the packed exec turn's session (`01a1512d-…`) holds 2, both contributor.
(A neighbouring lane's `acp-r2-*` sessions share the same store; none of
its lines are counted here.) Model calls through the product: **3 / 40** —
2 ACP turns + 1 packed-`exec` turn, every product ledger line
`settled $0.000000` (Muse Code backend turns are unmetered). A fourth
`exec` spawned behind `| head` was SIGPIPE-cut before dispatch (its
session holds 0 model lines) and is disclosed, not counted. No API key
needed or read; HOME and all sign-in variables untouched.

## ACP two-turn conversation + every keyless error path, in-session

Packed agent over stdio (`node dist/acp.js --allow-contributor-models`,
fresh `temp/r2scratch`, session `01a150e2-…`; driver `temp/acp-drive.mjs`):

- `session/set_config_option` model → `muse-spark-1.3-contributor`:
  accepted (`currentValue` contributor; round 1's agent.ts allowance live).
- Turn 1 (`Reply with exactly this word: quince`) → `quince`, `end_turn`.
- Turn 2 (create `r2marker.txt`, exact line + newline) → `end_turn`;
  bytes on disk byte-exact (`MARKER-r2-bytes-0123456789\n`).
- `/playback` → `Invalid request: A playback needs the Model API
backend: Muse Code offers no turn without tools, so no playback can
start there.` (zero requests).
- `/playback with extra words here` → usage (`playback takes no
arguments: send it bare`), `end_turn`, no model turn.
- `/uploads` → `Invalid params: No uploaded files.`

First-attempt `session/new` failed `ENOENT native/darwin/muse-dictate`
(the helper is a git-ignored build artifact, absent in a fresh worktree):
built with `bash native/darwin/build.sh` (exit 0; universal binary +
`dist/native/darwin/muse-vault`), then green. A worktree without the
helper cannot open any session — worth one line in Setup docs (lead's
call; not changed here).

## Per-platform packaging ported so darwin packs (fix, commit `c547954f7`)

#246 is not on this branch and the brief lists no merge, so the
mechanism is ported, not merged: vsix side follows the platform join
(`isVsixTargetFile`, targeted artifact names, multi-artifact size gate),
minus the vault lane's `check-packaged-bundles` assert and `VaultPipe.cs`
(absent here; win32 requires only `dictate.ps1`, each noted in code).
The join dropped #246's ACP half without mention, so it is restored and
adapted (`acpNativeFiles`, `--target` through `package-acp.mjs`, targeted
`.tgz` names; win32 keeps this branch's `VOICE_WINDOWS_HELPERS`).
`test/unit/vsixTargets.test.mjs` (8 tests) and
`test/unit/acpNativeFiles.test.mjs` (3 tests) kept with the port; each
was seen to fail on a planted break and pass reverted. CHANGELOG
`[Unreleased]` Packaging, README rows, `docs/RELEASING.md` note included.

- `node scripts/package-vsix.mjs --target darwin-x64` (direct script run;
  `npm run package` still stops at the two build budgets below):
  `muse-spark-code-darwin-x64-0.19.0.vsix`, 3,852,534 bytes,
  `TargetPlatform="darwin-x64"`, zero `native/linux/` or
  `native/windows/` entries (only `native/dictation-linux/*LICENSE.txt`
  match a naive `linux/` grep).
- `node scripts/package-acp.mjs --target darwin-x64`: exit 0,
  `dist/muse-spark-code-acp-0.19.0-darwin-x64.tgz`, 3,206,136 bytes (help
  checks + module-exports gate inside); zero linux/windows entries;
  darwin helper + screen app + vault + runner present.
- FAIL (recorded, not raised): the darwin-x64 `.vsix` is 63,734 bytes
  over the unchanged 3,788,800-byte budget. First real darwin
  measurement anywhere (upstream's table leaves darwin to CI): the
  required darwin binaries (~432 KB compressed: two 506 KB dictate
  copies + 292 KB vault) were never in the universal baseline the
  budget was measured from. No legitimate cut exists (both dictate
  copies and the vault helper ship by design); the budget call stays
  with the lead (PLAN.md D6).
- Still red from round 1: `dist/conversation.js` 254.9/250 KiB (diet
  lane) and now `dist/headless.js` 102,415/102,400 bytes (15 bytes;
  plausibly round 1's own exec allowance — no golfing; needs the same
  diet/remeasure lane). `npm run build` otherwise runs clean; split
  gate green.

## Packed panel drive over CDP (text reads, no screenshots)

Isolated profile/extensions in `temp/vscode`, packed darwin-x64 `.vsix`
installed (`code --install-extension`, success), second editor instance
launched from its own binary with `--remote-debugging-port=9333`
(`open -a` and the `code` shim both reuse the running instance; direct
binary launch is what works). Renderer lessons: default flags crash the
renderer (`CodeWindow: renderer process gone, code 6`, sandbox/GPU
errors); `--no-sandbox` (+ or - `--disable-gpu`) keeps it up and CDP
answers. Driver: `temp/cdp-drive.mjs` (+ `cdp-webview.mjs`,
`cdp-probe2.mjs`, `cdp-panel.mjs`).

- Palette lists the packed commands (`Add Model Provider`, `MCP
Servers`, `Models & Agents`, `New Conversation`, …). PASS.
- `Muse Spark: Open in Sidebar` creates viewlet
  `workbench.view.extension.museSpark` and a webview iframe. The chat
  React app never boots here: 8 nodes, no `#root`, empty text, zero
  resource loads — under default, no-sandbox, and trusted-folder runs
  alike, with zero errors in exthost/renderer logs and the extension
  activated. Same wall as the limits and platform lanes (their
  bootstrap-only finding reproduced exactly). Consequence: no panel
  turn, no model picker, no retry words, no `/playback` panel path on
  this rig — all recorded below, none stood in for.
- `Muse Spark: Models & Agents` opens the editor surface; its webview
  is bootstrap-only too.
- `Muse Spark: Attach Latest Screen Recording` → toast, word for word:
  `No recent screen recording was found.` PASS.
- `Muse Spark: Report a Problem` runs silent: with no live surface it
  takes the pending path (`isReportPending`, opens a conversation that
  cannot go live here) by design — no toast, no dialog. The CLI
  `report problem` from the packed tarball prints a real report
  (0.19.0, darwin, node 24.21.0, `cli: found`). PASS each side.
- `Muse Spark: Diagnostics` renders the support report in the Output
  panel (network posture, `muse config status` generation + sha). PASS.
- Editor and port verified down afterwards; all processes stopped.

## Packed-tarball behaviour (extracted `…-darwin-x64.tgz`, no model named twice)

- `exec … --model muse-spark-1.3-contributor … "Reply with exactly this
word: quince"` → `completed`, exit 0, model
  `muse-spark-1.3-contributor`, `quince`, settled `$0.000000`. PASS.
- `exec … --attach flag.png` (inside the workspace) → exit 3,
  `backend_unavailable`: `This session has no file upload service, so
video and audio cannot be sent. Use the Model API backend with a Meta
key.` (envelope only; human text still withholds it — round 1's
  observation stands). PASS, $0.
- `--attach` of a file outside `--cwd` → `This private file cannot be
attached.` (workspace confinement, M105, by design). Noted from my
  own misplaced probe, not a FAIL.
- `--model muse-spark-9-contributor` (typo) → the CLI's own refusal,
  zero dispatch. `--model bogus-model-zzz` → local `usage_error`,
  exit 2, `This model is not available for this run.` PASS both.

## Gates on the final tree

- `prettier --check` (all changed files): clean.
- `eslint --max-warnings=0` (7 changed script/test files): clean (one
  `no-nested-ternary` vs `prefer-ternary` + prettier tug resolved by
  restructuring, not suppression).
- `npm run typecheck` (all projects): exit 0.
- `npx vitest run` (repo timeout, `--maxWorkers=3`): `vsixTargets` 8/8
  - `acpNativeFiles` 3/3 (plus the deliberate-break red seen mid-work).
- `npm run build`: red only on the two budgets above (conversation
  diet + headless 15 B); everything else green incl. split gate.
- `node scripts/check-bundle-size.mjs`: the two OVERs above, unchanged.
- Coverage gates, final tree: `check:l10n` 0 problems; `check:reference`
  current (76 features, 65 commands, 93 settings, 30 slash, 259 CLI);
  `check:host-api` 0 problems; `check:plan` FAILS pre-existing (PLAN.md
  3,588,891 bytes over 85% of the reader bound; untouched by this lane);
  `deadcode` exit 0; `cycles` none; duplication 0 clones;
  `security:audit` exit 0 (2 advisories, 1 exception);
  `security:sast` exit 2 environmental (semgrep binary dies at startup:
  `Failure: ca-certs: empty trust anchors`, macOS sandbox cert store;
  exact log kept in `temp/sast.log`, gitignored).
- `npx vitest related --run` (5 changed script files): 2 files, 11/11
  pass. The packagers' own gates ran inside the packs (vsix l10n +
  badges + 89 moduleExports; ACP help checks + moduleExports).

## Commits (this round)

- `c547954f7` packaging port + tests + docs (+ CHANGELOG).
- This commit: this Round 2 section (docs only).

## Still open (for the lead / join)

1. Conversation diet + headless 15 B (build budgets; lead's item 1).
2. darwin-x64 `.vsix` 63,734 B over the universal-measured budget
   (first real darwin number; budget call is the lead's).
3. Panel turn, model picker (+ rate-limit headers), panel retry words,
   panel `/playback`, media/transcription/voice turns: need a key, a
   GUI host whose webviews boot, or both.
4. `providers usage` / `auth status` silent-1 with unreachable store;
   attach reason withheld from human output (both round-1 items,
   unchanged by this round).
5. `check:catches` left red per the brief (join + catch lanes).

## Open for the lead / join

1. Conversation diet (+4.9 KiB over 250; attribution above).
2. Report generation re-run on a healthy host (evidence above).
3. `providers usage` / `auth status` silent-1 when the store is
   unreachable (exact repro above).
4. Attach refusal reason hidden in human output (envelope only).
5. /playback turn, media turns, transcription, provider/Azure/scan/voice
   behaviours need key-holders, other OSs, or the panel.
6. Panel-side opt-in surface for contributor models (the runtime flag
   exists; the panel has none, so panel serve stays non-contributor).
