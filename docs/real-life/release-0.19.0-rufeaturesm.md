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
