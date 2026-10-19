# Real use: 0.19.0 features group (RUFEATURESL, Linux)

Version: 0.19.0 (group branch `realuse/0190-features-l`).
Git SHA at drill time: `749fb4c8c5b1e666211c2ed7d9db2af16e859bce` (before this
lane's fixes; fix commits listed at the end).
Platform: Linux x64 rig `linuxlt` (VS Code + `xvfb-run` installed).
Backend: Muse Code (the signed-in CLI, 1.4.10) throughout.
Model: every request names `--model muse-spark-1.3`, except where noted.
The contributor model `muse-spark-1.3-contributor` is NOT servable to this
lane's product-side CLI session (see finding F1); no request is ever left to
the product default.

Group under test (merges on this branch): #219 (provider records, rate-limit
headers, media limits, Azure), #221 (/playback), #224 (dictation off the
activation path, Linux voice), #226 (codec refusals, production media
composition), #206 (Muse Code SDK/CLI 1.4.10), #243 (/report kinds:
accounts, security, estimate, playbook, schedules), #231 (other-CI suites),
#232 (real-use workflow).

## Build

`npm ci` clean. `npm run build` stops at the What's New bound, as briefed
(0.19.0 notes decode to 147,798 bytes over the 76,800-byte bound; the final
join trims the notes). For this lane only, `CHANGELOG.md`'s `[0.19.0]`
section was trimmed to Highlights plus a one-line stub (original saved at
`temp/CHANGELOG.orig.md`, never committed; restored before commit). With the
local trim the build emits every bundle — except for findings F2 (fixed in
this lane) and F3 (left for the join).

Neither packaged artifact can be staged on this rig: the universal VSIX
requires `native/linux/arm64/muse-created` (no cross-compiler here) and the
ACP tarball requires `native/darwin/muse-dictate` (macOS-only build); the
per-platform packager (PR #246) lands at the join, on another group branch.
All drills below drive the production build's own documented entries
(`node dist/acp.js …`, real ACP sessions against `dist/acp.js`) on the Muse
Code backend instead. Panel-only surfaces (Resources chip, Models table,
report picker, voice recording) are NOT RUN; the exact blocker is recorded
per behaviour.

## Behaviour log

Key: PASS = happened for real as documented. FAIL = defect (fixed or left).
NOT RUN = needs something this lane cannot reach; never stood in for.

- B1 `report --help` lists the thirteen working kinds (`milestone <id>`,
  `release <version|latest>`, `estimate <milestone>`, …). PASS (no model).
- B2 `report accounts|security|playbook|schedules|session|usage|keybindings`
  render in a fresh scratch workspace. PASS (no model). Session/usage ride
  `dist/reportInputs.js`, playbook/schedules ride
  `dist/playbookSchedulesInputs.js` — both missing from the production build
  before F2's fix; break-and-revert proven (without the file:
  "The report inputs bundle could not be loaded"; with it: renders).
- B3 `report estimate` without scope prints the kind usage (RVMSM113).
  PASS. `report estimate M95` with no `PLAN.md` records the typed refusal
  `missing-plan: PLAN.md` instead of invented rows. PASS.
- B4 `providers add --preset lmstudio --model qwen3-0.6b
--context-window 8192` with no server running: "Test failed: Could not
  reach lmstudio: the connection failed (fetch failed: ECONNREFUSED), so
  whether the request arrived is unknown; check the network and the provider
  address." PASS — names the network code and the arrived-unknown rule;
  nothing written (`providers.json` exists nowhere afterwards).
- B5 `providers test openrouter` / `providers usage openrouter` with nothing
  configured: "Unknown provider: openrouter." (exit 1) / silent exit 1.
  PASS (honest refusals; OpenRouter Connect itself needs an account: NOT RUN).
- B6 `providers accounts` usage names
  list|add|remove|order|thresholds and stdin-only keys. PASS.
- B7 Local servers: no llama-server, ollama, LM Studio, or vLLM on this rig,
  so preset scan/save/send paths are NOT RUN. Azure entries need an Azure
  account: NOT RUN. Rate-limit header semantics, wrong-key/unknown-model
  refusals, quota-vs-bare-limit retry, and the session-budget stop sentence
  all need the Model API backend with a key: NOT RUN.
- B8 Composer on ACP, `--model muse-spark-1.3`: "Reply with exactly: ACP-OK"
  → `ACP-OK`, `stop: end_turn`. PASS (1 model call). Headless exec with the
  same model: `RU-OK4`. PASS (1 model call).
- B9 Two-turn ACP session: goal ("write a haiku about a lighthouse") then
  `/playback`. FAIL → fixed in docs (F4): on the Muse Code backend the
  product answers `Invalid request: A playback needs the Model API backend:
Muse Code offers no turn without tools, so no playback can start there.`
  The code matches PLAN.md D203 (rule in force); the 0.19.0 notes, the ACP
  guide, and the reference catalog still promised a Plan-mode Muse Code turn.
  The Model API playback path itself needs a key: NOT RUN.
- B10 Audio attach on ACP (`audio/wav`, real 1 s 16 kHz tone) + "Transcribe
  this audio clip." on the Muse Code backend: `Invalid params: This media
needs the Model API backend.` PASS — translated refusal, whole prompt
  refused, nothing sent, no model call. Batch transcription consent and
  direct-audio paths need the Model API backend: NOT RUN.
- B11 ACP `/uploads` on a fresh session: "No uploaded files." PASS (honest
  empty state, no model call). Delete Uploaded Files panel/usage flows need
  the panel: NOT RUN.
- B12 SDK/CLI currency (#206): `muse 1.4.10` serves the pinned
  `@muse-code/sdk 1.4.10` with no fingerprint warning (probed over MSP
  `model/list`). PASS. `dist/museCode.js` (95.6 KiB ≤ 125) emitted and the
  backend starts through it. Machine-setting defaults read
  `hooksMaxStopContinuations` 8 (max 8), `hooksMaxRunningCommands` 0,
  `subagentMaxConcurrent` 8 (1–64). PASS.
- B13 Voice/dictation (#224): `dist/dictation.js` (13.6 KiB ≤ 25),
  `dist/voiceLinux.js` (37.0 KiB ≤ 50), `dist/voice.js` (42.8 KiB ≤ 50) all
  emitted; Linux dictation licences ship; helper pins accepted; the VSIX
  stager refuses any shipped Linux helper binary (code-read). Recording,
  consent cards, and helper/model downloads need a microphone, the panel,
  and release assets: NOT RUN.
- B14 Other-CI (#231): `ci-templates/` carries all four systems plus the
  bootstrap; `real-use.yml` is `workflow_dispatch`-only; the launcher keeps
  the `system` dimension; the Azure template carries no vendor time
  expression. PASS (static; no vendor runs).
- B15 Real-use workflow (#232): usage names `--expected-calls` and
  `--max-budget-usd` guards. PASS (static; the live run spends money and is
  CI's job).
- B16 Panel-only: Resources chip, Models table/wizard, report picker, voice
  recording, Delete Uploaded Files UI. NOT RUN — no stageable VSIX on this
  rig (see Build).

## Findings (FAILs)

- F1 Contributor model not servable through the product in this lane.
  `session/new` offers only
  `muse-wonder-1.0, muse-wonder-full-1.0, muse-spark-1.3, muse-spark-1.2`;
  `--model muse-spark-1.3-contributor` is refused before any backend contact
  (`execUnknownModel`: "This model is not available for this run."). Proven
  CLI-side, not product-side: `serve model/list` over MSP omits the id even
  with explicit `--contributor-mode on` (persisted flag is on in both CLI
  homes), while `muse exec` from a shell home runs the same id fine and the
  lane's own harness sessions record contributor turns. The product
  faithfully offers what `serve` lists. Needs a contributor-entitled session
  this lane cannot reach without touching credentials. All drill turns below
  ran on explicitly named `muse-spark-1.3` instead (records checked).
- F2 Production build never emitted `dist/reportInputs.js` /
  `dist/playbookSchedulesInputs.js` (FIXED). Both are budgeted, lazy-loaded
  on first use, shipped in both packages — but `scripts/build.mjs` built
  them only in `isWatch` dev mode, never in production, so the packed
  product could not run `/report session|usage|playbook|schedules`. Fix:
  two entries in the bounded production pool beside the other reporting
  bundles (both land inside budget: 98.2/100 and 56.2/59 KiB). Existing gate
  `packagedBundles.test.mjs` ("builds every registry bundle") covers it.
- F3 Bundle budgets over after the group merges (MOSTLY FIXED; one left).
  First measurement: `dist/conversation.js` 254.9/250, `dist/modelApi.js`
  572.3/525, `dist/productionAudio.js` 141.2/75 KiB, plus F2's two missing
  bundles. F2's fix and F5's fix brought modelApi and productionAudio back
  inside their unchanged budgets (the weight was inlined code that belongs
  lazy, not feature growth). Left for the join: `dist/conversation.js`
  254.9/250 (+4.9 KiB, diffuse combined-group growth, no single misplaced
  chunk). Caps are never raised from a lane. `npm run build` stays red on
  this branch on that one line until the join.
- F4 Playback claims out of date (FIXED in docs/reference). PLAN.md D203
  (rule in force) and the code refuse `/playback` on Muse Code, but the
  0.19.0 notes promised "on Muse Code it runs in Plan mode", `docs/acp.md`
  promised "a model turn, on both backends", and the reference catalog
  listed all four surface/backend pairs. Fix: catalog backends and
  capability pair to Model API only (regenerated reference), ACP guide and
  CHANGELOG reworded to the refusal. No string changes (no l10n impact).

- F5 `productionMediaEntry` missing from the deferred bundle map (FIXED).
  `DEFERRED_OUTFILES` (the esbuild split plugin's entry→bundle map) had no
  row for `src/host/backend/productionMediaEntry.ts`, although the filter
  regex already named it. Every dynamic import of the media entry was
  inlined into its importers instead of staying lazy in
  `dist/productionMedia.js` — the cause of most of F3's overage — and the
  lazy-registry command could not resolve the loads, failing two
  `packagedBundles` tests ("passes the registry command",
  "writes the registry"). One map row; registry `--check` green, split gate
  green, modelApi and productionAudio back inside budget.
- F6 Split gate reader list missing the runtime media port (FIXED).
  `dist/runtimeMedia.js` carries `TEXT_ATTACHMENT_MODEL_TEXT` through a live
  chain (entry → mediaPort → `acp/media.ts` → `AttachmentStore` →
  `textFileInput` for picked text files), but the gate listed only four
  readers. Added `dist/runtimeMedia.js` with a reason; no code moved.

## Model calls (product's own records)

Muse Code backend; spend is unsettled ($0.000000 metered per exec tally —
the backend does not bill through the product ledger). 6 calls total
against 40 / $2.00: 3 product turns on explicitly named `muse-spark-1.3`
(exec RU-OK4, ACP ACP-OK, ACP haiku), 1 product setup probe on the session
default (SHAPE-OK, disclosed), and 2 raw-CLI backend probes on
`muse-spark-1.3-contributor` (RU-OK, RU-OK2 — the only contributor turns
this lane could make; the product path cannot, F1). Refused turns
(`/playback`, audio attach, bare `/uploads` twice, three contributor execs)
spent nothing. Every drill session's `model_id` lines checked: turns ran on
the requested model; session scaffolding lines name the default
`muse-wonder-1.0` (a session opens on the default and switches on request —
no turn was sent to a model the request did not name).

## Commits and gates

Lane fix commit(s) on `realuse/0190-features-l` (trailer: `Co-Authored-By:
Muse Spark (contributor) via Muse Code`): see final message for SHAs.

Gates on the final tree (true exit codes, no pipes): prettier 0; eslint 0
(zero warnings); typecheck 0 (all five projects); knip 0; cycles 0;
duplication 0 (0 clones); check:l10n 0 (0 problems); check:reference 0;
check:host-api 0; check:roadmap 0; security:audit 0 (2 advisories, 1
exception); SAST 0 (533 rules, 0 findings); `gen-lazy-registry --check` 0;
`check-bundle-split` 0; `exec-schema --check` 0 ("Exec schemas match").
Suites (repo timeout, maxWorkers=3): playbackCommand + playbackPrompt +
featureCatalogDetails 19/19; paletteRegistry + chatReference + buildPool
57/57; packagedBundles 8/8. `npm run build`: red on one line only —
`dist/conversation.js` 254.9/250 (F3); `npm run package`/`package:acp`
cannot stage on this rig (cross-OS natives; #246 lands at join). `check:plan`
fails (exit 1) on the untouched PLAN.md (3,588,891 > 3,565,158-byte 85%
bound) — pre-existing, join archives.
