# Real-use fix review for the 0.19.0 join (REVREALUSE)

Review of every fix commit on the fourteen `cand/REVREALUSE/<n>` branches,
for the join that merges them in order onto `release/0.19.0`. Method: each
branch's own commits were read as diffs (`git show`) against its group base;
every code claim below was checked against the changed source, every test
claim against the changed suite. Branches were also compared pairwise for
duplicate fixes of the same defect. No code was changed here; the duplicate
map (§2) is the deliverable the join works from.

Group-completion commits shared verbatim across sibling branches need no join
action: trains `9483a6b8d`/`d689677aa`, truth `b7537ba6f`/`dc6603be6`,
platform `ba5d53370`/`b839a4afa`/`fe6622b67`/`4cb910cc8`/`62f25e032`/`c61dfa546`,
features `749fb4c8c`/`a83e7691a`/`628d8e3cc`/`e6a604e6e`, and the PATHGUARD
round commits shared by branches 12/13 are identical SHAs on each branch that
carries them.

## 1. Every fix commit, branch by branch

### Branch 1 — RUTRAINSM (`a88d633c87`)

- `3dfc933ec` — three terminal-surface defects, fixed and covered. (a) `exec
--effort none` died in the help-table enum gate although `parseExec` takes
  it: the `effort` fact now carries `[...EFFORT_LEVELS,
THINKING_OFF_EFFORT]` (`src/runtime/cliHelp.ts`). Correct at the cause
  (gate and parser disagreed; the per-model record still refuses untaken
  values downstream). Test drives the real parser (`parseCommandLine`) and
  asserts both the pass and the refusal list — real, and the stronger of the
  two effort tests (see D1). (b) `providers accounts` misuse exited 1 while
  every sibling misuse exits 2: `exitCode: 2` added in `src/runtime/cliArgs.ts`.
  Correct at the cause (missing code on one branch). Test drives the real
  parser over `[]` and `['list']` — real. (c) Parsed-but-unmapped
  `--max-tool-output-bytes` failed the `shows or maps every parsed option`
  guard: mapped in `CLI_NON_TOPIC_OPTIONS.exec`, keeping the one-screen
  `exec --help` short while the full reference documents it. Correct at the
  cause and consistent with the TOOLCAP design (setting text carries the
  guard/spill description). Covered by the pre-existing guard test (red
  before, green after — see D2).
- `a88d633c8` — real-life record only, no code.

### Branch 2 — RUTRAINSL (`35c30a5bc`)

- `85838cb3d` — build fix, no behaviour change. The trains merges carried 23
  shipped entries into `[0.19.0]` twice; the newest notes decoded to 91779
  bytes over the 76800-byte What's New bound, failing `npm run build`.
  Deleted the newer copies only (each removed phrase verified still present
  under its shipped version), condensed the M101 block, and added the
  never-repeat-shipped-entries rule to `docs/RELEASING.md`. Correct (bound
  never raised). Proof is the build itself.
- `81054ed9f` — three fixes. (a) Panel notices cut long unbroken tokens (the
  F91 sandbox notice): `.notice { overflow-wrap: anywhere }`
  (`src/webview/styles.css`). Correct at the cause; proved live in VS Code
  with a window reload (no unit test — visual). (b) `--effort none`: the same
  fact change as branch 1's, plus the `effort` enum in
  `scripts/lib/reference.mjs` and regenerated reference files. Test drives
  the real parser but asserts only the pass — weaker than branch 1's (see
  D1). (c) `--max-tool-output-bytes`: added to the on-screen exec help topic
  instead of the off-screen map — conflicts with branch 1's approach (see
  D2).
- `35c30a5bc` — record only, no code.

### Branch 3 — RUTRUTHM (`c825b6fcd8`)

- `9346a4b2a` — refused `providers add`/`test` fell back to the fixed "could
  not be reached" sentence: the spend lane's endpoint pin answers the refusal
  before the probe's reader runs. `probeProvider` now unwraps the pin's coded
  refusal (`pinRefusedCause`) through `providerFailureReader.sendFailure`;
  codeless refusals keep the fixed sentence. Correct at the cause (matches
  the proven error shape rather than string-matching). Test
  (`test/unit/providersProbeRefused.test.ts`) binds a real loopback port,
  closes it, and runs the probe through the real resolver, pin and transport
  — real, seen failing before. Byte-identical `src` to branch 5's fix (see
  D3).
- `47fb8eef0`, `c825b6fcd` — real-life record only, no code.

### Branch 4 — RUTRUTHL2 (`380edcfb90`)

- `a01315514` — `feat(packaging)`: one package per platform target (new PLAN
  decision D123). `package`/`package:acp` take `--target <platform>-<arch>`;
  targeted packages stage only their platform's natives and carry the target
  in the filename; the universal keeps everything and still refuses when a
  helper is missing. Correct at the cause (explicit artifacts instead of a
  machine-dependent default). Tests drive the real lib functions
  (`vsixTargets.test.mjs`, `acpNativeFiles` cases) — real; plus a real
  Linux pack inventoried with zero foreign natives. The ACP half overlaps
  branch 7's fix with contradictory default behaviour (see D8).
- `788cb2454`, `6c90dadd8`, `380edcfb90` — records only, no code.

### Branch 5 — REVMERGE truth (`7493861f9bb`)

- `7493861f9b` — the same refused-probe fix as branch 3's: `src` is
  byte-identical; the test differs only in the refused-port helper's error
  plumbing (`on('error')` wrap vs `once`+`removeListener`), functionally
  equivalent. See D3.

### Branch 6 — RUPLATFORML (`ffed4b642f`)

- `ffed4b642` — the merged vault CLI resolved its command port lazily, so an
  unstartable broker's `brokerBlocked` sentence fell through the refusal-only
  lookup as bare "No access", and a `brokerDisabled` open failure was masked
  as `brokerBlocked`. `vaultCommandFailure` now keeps both broker sentences
  and the open-failure branch keeps a named sentence, defaulting to
  `brokerBlocked` only for unnamed failures. Correct at the cause (lookup
  covered refusals but not the client's own sentences). Test drives the real
  function (4/4, new cases failed before) — real. Proved on the packed
  Linux `.vsix` in real VS Code.

### Branch 7 — RUPLATFORMM2 (`3642985a46`)

- `c77e5bd7c` — `package-acp` on macOS stopped at the Linux-helper gate.
  `acpHelperPlan` requires only the helpers the running machine builds
  (darwin helper on macOS, current-arch Linux helpers on Linux, none on
  Windows) and warns-and-skips absent foreign ones; CI still composes all
  and its content check still requires them. Test drives the real planner
  (4/4 incl. unknown-platform/architecture refusals) plus a red drill and a
  real macOS pack — real. Contradicts branch 4's D123 on the no-flag path
  (warn-and-skip vs refuse): same defect, different contract (see D8).
- `e8ae5191e`, `3642985a46` — records only, no code.

### Branch 8 — RULIMITSL2 (`4164901379`)

- `3bd3f54a5` — regenerated the headless v2 schemas to the then-current
  1–500 bound after PR #239 reinstated it. No behaviour change; superseded
  on this same branch by the next commit (linear, no join action).
- `036961608` — removes the invented 500 maximum on a set `--max-requests`:
  any positive safe integer is accepted, 0/negatives stay refused. The 500
  was ours — no provider documents a request-count maximum — so this follows
  the standing Limits rule. Applied across CLI parser, run ledger, protocol
  schemas, regenerated exec v2 schemas, reference builder, Action input and
  result validation, docs, README and CHANGELOG. Correct at the cause and the
  most thorough propagation of the set. Tests drive the real parser/ledger/
  Action libs (updated `execArgs`, `runLedger`, `actionMaxRequests` suites) —
  real. Self-correction worth keeping: round 1 had recorded `--max-requests
501` exiting 2 as PASS; round 2 marks that a FAIL of ours and fixes it.
- `99765460f`, `40a5d2a3c`, `416490137` — records only, no code.

### Branch 9 — RUFEATURESM (`30a9b8cce2`)

- `0b8fd9b7b` — restores three build lines the group merges dropped: the
  `productionMediaEntry` externalization in `DEFERRED_OUTFILES`, the
  `reportInputs`/`playbookSchedulesInputs` production builds, and the
  `TEXT_ATTACHMENT_MODEL_TEXT` reader for the runtime media port
  (`dist/runtimeMedia.js`). Correct (restores PR-side lines to their
  positions; split gate 55→green, both importer bundles back in budget).
  Proof is `npm run build` + gates; no unit test. Same lines as branch 10
  fixes again (see D4/D5).
- `07a29194c` — the CLI's 1.4.10 catalogue lists four models even in
  contributor mode, so `--model muse-spark-1.3-contributor` was refused as
  unknown despite `--allow-contributor-models`. With the opt-in, a
  `-contributor`-suffixed id is attempted (`session/setModel`) and the CLI's
  answer stands; anything else is still refused before dispatch (both
  predicates are the same `-contributor` suffix check). Correct at the cause
  (our own pre-check was stricter than the CLI). Proved live (contributor
  turn answers; typo'd id fails in the CLI's words with zero dispatch;
  non-contributor unknown still refused locally). No unit test — the proof
  is the live turns. Complements (not duplicates) branch 14 (see D9).
- `30a9b8cce` — record plus the /playback claim reword (CHANGELOG +
  `docs/acp.md`): same defect branch 10 fixes more broadly (see D6).

### Branch 10 — RUFEATURESL (`40dbb99315`)

- `4c1e42f05` — four fixes. (a) `reportInputs`/`playbookSchedulesInputs`
  built in the bounded production pool (break-and-revert proven: without the
  file the report refuses with the bundle-load error); the existing
  `packagedBundles.test.mjs` ("builds every registry bundle") covers it —
  real. Same two lines as branch 9 and branch 11 (see D4). (b) The
  `productionMediaEntry` deferred-map row (registry `--check` green, split
  gate green) — same as branch 9 (see D5). (c) The `TEXT_ATTACHMENT` reader
  listing — same as branch 9 (see D5). (d) /playback claims reworded and the
  catalog backends + capability pair scoped to Model API with regenerated
  reference — broader than branch 9's docs-only reword (see D6). All correct
  at their causes; (d) is enforced in code (catalog), the rest restore
  dropped lines.
- `40dbb9931` — record only, no code.

### Branch 11 — REVMERGE2 features (`ec322932f7`)

- `ec322932f7` — the same two `reportInputs`/`playbookSchedulesInputs`
  production-build lines again (resulting `scripts/build.mjs` hunk is
  byte-identical to branch 10's). CHANGELOG entry sits under `[Unreleased]`
  rather than `[0.19.0]`. See D4.

### Branch 12 — RUNEWPRS (`2d13a8f508`)

- `0e72511a9` — records the release branch's `bwrap` probe
  (`probeLinuxSandboxShell`'s `execFile` in
  `src/core/backends/musecode/sandbox.ts`) in the PATHGUARD spawn inventory
  as `guarded`/anchor `resolveExecutable`, no code change. The probe does
  resolve through the absolute-PATH-only `resolveExecutable` and refuses
  workspace-inside binaries, but it sets no guarded child env — see D7 for
  the kind question. Test is the self-scanning inventory — real.
- `5d19b71f5` — empty-composer placeholder (F67): per-platform shortcut in a
  vscode-free pure module (`src/host/views/composerPlaceholder.ts`), all 14
  tables translated. Correct at the cause. Test drives the real module for
  all three platforms — real (though it pins the exact English copy).
- `2d13a8f50` — record only, no code. (The PR #249/#250/#251 merges on this
  branch are the release PRs themselves, not real-use fixes.)

### Branch 13 — RUNEWPRSM (`32bb723afc`)

- `ce51182a6` — the same sandbox-probe inventory row, but as
  `reviewed`/anchor `resolveExecutable` with a tighter reason. Same anchor,
  different kind — see D7.
- `f480fb459` — refused ACP `session/delete` released the held conversation
  before checking `canDeleteSessions`, so the next prompt answered
  "Resource not found" on Muse Code (no `session/delete` since 1.4.4). The
  capability is checked first now; refusal leaves the held session and
  remembered choice usable. Correct at the cause (ordering). No unit test —
  the record states why (a stub host is forbidden) and the live re-drill
  transcript is the proof, which the project rules accept.
- `bc6e618dc` — one-line merge-cleanup dedup, trivial.
- `32bb723af` — record only, no code.

### Branch 14 — CONTRIBMODE (`3ff85ad940`)

- `8c403d2c2` — honours Muse Code contributor mode on the Muse Code backend:
  `serve` starts with `--contributor-mode` when the person's own settings
  enable it, and the host catalogue carries each served model's
  `-contributor` counterpart; picker, `exec --model`, ACP
  `session/set_config_option` and the panel list and accept them through the
  existing contributor confirmation, with nothing defaulted on and the
  provider's own refusal for the non-entitled. Correct at the cause (the
  tier gate is the provider's; the product was not forwarding the mode).
  Tests use a recorded 1.4.10 `model/list` fixture with provenance plus
  derivation and serve-args suites, break-on-purpose fired (1 + 2 failures,
  reverted) — real. Complements branch 9's attempt (see D9).
- `3ff85ad94` — record plus CHANGELOG/PLAN scope, no behaviour change.

## 2. Duplicate map — one fix per defect

- **D1. `exec --effort none` enum gate — branches 1 (`3dfc933ec`) and 2
  (`81054ed9f`).** The `cliHelp.ts` fact change is identical
  (`[...EFFORT_LEVELS, THINKING_OFF_EFFORT]`). The tests differ: branch 1
  asserts the pass _and_ that a bad value's refusal lists `none`; branch 2
  asserts only the pass. Only branch 2 updates `scripts/lib/reference.mjs`
  (effort enum) and regenerates the reference. **Keep:** branch 1's fact +
  branch 1's stronger test + branch 2's `reference.mjs` change with its
  regen. Drop branch 2's weaker test hunk (same file, nearby lines — the
  join keeps one test for this behaviour).
- **D2. `--max-tool-output-bytes` help mapping — branches 1 and 2.**
  Branch 1 maps the flag in `CLI_NON_TOPIC_OPTIONS.exec` (off the one
  screen, like the other off-screen exec options); branch 2 adds it to the
  on-screen exec help topic. Same guard satisfied two ways with different
  screen budgets. **Keep branch 1's mapping:** the TOOLCAP design documents
  this flag in the setting text and `help --all`, and branch 1's record (B2)
  shows the one-screen `exec --help` deliberately omits it. Drop branch 2's
  topic entry.
- **D3. Refused probe names its codes — branches 3 (`9346a4b2a`) and 5
  (`7493861f9b`).** `src/runtime/providersCommands.ts` is byte-identical;
  the tests are functionally equivalent (only the refused-port helper's
  error plumbing differs). **Keep one.** At the join, branch 3 lands first
  (order 3 before 5): keep the landed test, discard branch 5's redundant
  hunk at its merge. One CHANGELOG line.
- **D4. `reportInputs`/`playbookSchedulesInputs` production builds —
  branches 9 (`0b8fd9b7b`), 10 (`4c1e42f05`) and 11 (`ec322932f7`).**
  All three add the same two `scripts/build.mjs` lines (10 and 11 produce a
  byte-identical hunk; 9 differs only in placement beside `reportingPanel`).
  **Keep branch 10's** (it also carries D5/D6 and the break-and-revert
  proof); branch 9's and branch 11's build hunks are redundant at their
  merges. Keep the `[0.19.0]` CHANGELOG line (branch 11's sits under
  `[Unreleased]` — move it, don't duplicate it).
- **D5. `productionMediaEntry` deferred row + `TEXT_ATTACHMENT` reader —
  branches 9 and 10.** Same row, same reader (cosmetic placement differs).
  **Keep branch 10's** alongside D4 (one coherent build-fix commit).
- **D6. /playback Plan-mode claim — branch 9's record commit (`30a9b8cce`)
  and branch 10 (`4c1e42f05`).** Both reword the same CHANGELOG paragraph
  and `docs/acp.md` passage with different wording; branch 10 additionally
  scopes the feature catalog and capability pair to Model API and
  regenerates the reference. **Keep branch 10's whole set** (docs + catalog
  enforcement); the two hunks conflict line-for-line, so take 10's wording
  on both files.
- **D7. Sandbox-probe PATHGUARD row — branches 12 (`0e72511a9`,
  kind `guarded`) and 13 (`ce51182a6`, kind `reviewed`).** Same file, same
  anchor (`resolveExecutable` — the only thing the suite enforces), different
  kind and reason. The probe resolves through the absolute-PATH-only
  resolver and refuses workspace binaries, but spawns with the default
  environment (no guarded child env), while the file's header defines
  `guarded` as lookup _plus_ child env. **Keep branch 13's `reviewed`
  row** (honest under the file's own definition; the suite passes either
  way). One CHANGELOG line. Note: both branches also carry
  `docs/real-life/release-0.19.0-newprs.md` with _different_ content (Linux
  vs macOS rounds) — the join must concatenate the two records, not let the
  later merge overwrite the earlier.
- **D8. ACP packager without foreign helpers — branch 4 D123 (`a01315514`)
  vs branch 7 (`c77e5bd7c`).** Same defect, contradictory contracts. D123
  adds an explicit `--target` flag with per-platform artifacts (target in
  the filename) and keeps the universal strict (refuses when a helper is
  missing). Branch 7 keys off the running machine and warns-and-skips absent
  foreign helpers in the default pack. Both rewrite the same
  `package-acp.mjs` gates; they do not compose (branch 7 removes exactly
  the strictness D123 specifies for the no-flag path). **Keep D123:**
  decision-recorded in PLAN, explicit artifacts, universal guarantee kept,
  proved with an inventoried Linux pack — and the macOS need branch 7
  proves is already met by `package-acp --target darwin-<arch>`. Drop
  branch 7's packager change and its `acpHelperPlan` test (it tests dropped
  code). The join must re-prove the macOS pack via the D123 flag
  (`--target darwin-arm64` on a GUI Mac), since D123 was proved on Linux
  only and branch 7's macOS proof covers the dropped path.
- **D9 (semantic overlap, no textual conflict). Contributor-tier reachability
  — branch 9 (`07a29194c`) vs branch 14 (`8c403d2c2`).** Branch 9 attempts
  an opted-in `-contributor` id past our own pre-check and lets the CLI
  answer stand (ACP + exec); branch 14 forwards contributor mode to `serve`
  and derives catalogue counterparts (serve/picker/panel/exec/ACP).
  Different layers, no shared files. **Keep both**, and the join re-drills
  the combination live: a contributor id via `exec --model` and ACP
  `session/set_config_option` must be accepted once (not refused twice or
  accepted-then-refused), while an unknown non-contributor id is still
  refused locally before dispatch. This also closes branch 10's F1 and the
  limits round-2 contributor finding, and answers branch 9's open item 6
  (panel-side opt-in) — verify the panel serves the counterparts.

## 3. Found but not fixed — open for the lead/join

1. **What's New bound overrun.** The combined `[0.19.0]` notes decode to
   91779 bytes over the 76800-byte bound; `npm run build` fails before any
   bundle is written. No lane trims another group's entries
   (`docs/real-life/release-0.19.0-rutrainsm.md:17`, F0; branch 10's record
   leaves "the What's New trim" for the join). Release prep trims; the bound
   is never raised (branch 2's `docs/RELEASING.md` rule).
2. **`dist/conversation.js` 254.9/250 KiB.** Diffuse combined-group growth,
   no dropped line (split gate green); blocks `npm run package`.
   (`docs/real-life/release-0.19.0-rufeaturesm.md:56`, item 3; branch 10's
   F3; `4c1e42f05` message.) Needs a diet lane; caps are never raised from a
   lane.
3. **`check:catches` baseline drift (exit 1, 86 unmatched sites).** The
   inventory postdates the fork point; the drift rides in with the group
   merges. Re-baselining here would bless unclassified handlers — belongs to
   the staffed catch lanes. (`release-0.19.0-rutruthl.md`, "Finding:
   `check:catches` is red"; `release-0.19.0-rutruthm.md` gates.)
4. **Headless museCode `exec` turns leave no usage records** (Cached
   Input/Reasoning/Plan read `Unknown`). Honest rendering on this evidence;
   NOT PROVEN either way without a Model API turn — if intended, the usage
   wording overpromises. (`release-0.19.0-rutrainsm.md`, B7.)
5. **`providers usage`/`auth status` exit silent 1 when the store is
   unreachable.** Needs its own milestone (credential-transaction error
   paths) and a reachable keychain. (`release-0.19.0-rufeaturesm.md`, open
   item 3.)
6. **Attach refusal reason hidden in human output** (envelope only).
   (`release-0.19.0-rufeaturesm.md`, open item 4.)
7. **Report generation NOT PROVEN on the macOS rig** (product children miss
   `DEVELOPER_DIR` so `git` exits 71; symlinked data home). The lead's
   Windows run settles it. (`release-0.19.0-rufeaturesm.md`, Behaviour
   proofs.)
8. **Stale `dist/*-package` stage dirs break the gates** (258/505 phantom
   lazy-registry problems on branches 12, 7, 6). Package should clean its
   stage, or the gate should ignore it.
   (`release-0.19.0-newprs.md` branch 12; `release-0.19.0-ruplatformm.md`
   round-2 gates; `release-0.19.0-ruplatforml.md` gates.)
9. **First cold start answered bare "No access" once**, unreproduced.
   (`release-0.19.0-ruplatformm.md:88`.) For the join to watch; no code
   touched.
10. **Panel `Lock Vault Now` → "The vault operation failed. Try again."**
    (9×, headless without keychain) and the headless chat webview stays
    bootstrap-only. For the lead on a GUI Mac.
    (`release-0.19.0-ruplatformm.md`, panel section.)
11. **`brokerSession`/`brokerSocketDirectory` 7 failed on Linux** (no Secret
    Service) and **macOS `fileLease` birth 4 failed in the sandbox** (same
    on the pre-#220 base) — environmental, outside what the product fixes.
    (`release-0.19.0-ruplatforml.md`; `release-0.19.0-ruplatformm.md:156`.)
12. **`pathGuard.test.ts` planted-git case fails where `/usr/bin/git` is
    broken** (no Xcode) — measured identical on the untouched candidate.
    (`release-0.19.0-newprs.md` branch 13, gates.)
13. **`chatGptLocalFailures` 2 timeouts at 5 s** — measured identical on the
    untouched base (cold session-client setup). Pre-existing/environmental.
    (`release-0.19.0-rutruthm.md`, gates.)
14. **`check:plan` 85% bound fails on the untouched PLAN.md** (3,588,891 >
    3,565,158) — pre-existing; the join archives.
    (`release-0.19.0-rufeaturesl.md`, gates.)
15. **SAST not run in the sandboxes** (semgrep `ca-certs: empty trust
anchors`, exit 2; or not installed). Lead/CI runs it outside.
    (Branches 3, 7, 13 records.)
16. **Teardown warnings on every headless run** (`task/stopAll failed`,
    `session/statusChanged for unknown session`) predate the groups; exit 0,
    answer delivered — observation only.
    (`release-0.19.0-rutrainsl.md`, "Not reached live".)
17. **VS Code died once mid-turn under CPU pressure**, no crash dump, cause
    UNMEASURED; state survived. (`release-0.19.0-newprs.md` branch 12.)
18. **No retry control for a finished turn** (only `Try Again` for failed
    lazy-surface loads) — noted, not forced. (Branch 8 record, panel
    addendum.)

## Join mechanics noted while reviewing

- Branches 12 and 13 merge the same release PRs (#249/#250/#251) from
  differently named candidate branches (`cand/RUNEWPRS/*` vs
  `cand/RUNEWPRSM/*`); the join should confirm the two sets agree and keep
  one.
- Every branch adds CHANGELOG lines; several edit the same paragraphs
  (/playback, report inputs). Keep one line per fix under `[0.19.0]`.
- Branch 8's `036961608` supersedes its own `3bd3f54a5` on-branch (tip
  state is unbounded) — no action, just do not resurrect the 1–500 schemas.
- The contributor finding recorded on branches 8 (round 2) and 10 (F1) is
  the defect branches 9 and 14 fix — the join's re-drill (D9) closes it.
