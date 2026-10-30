# RLF-TEAMGATE — Teams availability: off until a second model is set up

Branch `rec/rlf-teamgate`, worktree on macmini, 2026-10-23. Base:
`f53ef168f` (main at 0.19.0 plus 40 merged lanes, incl. RLM96, RLM96B,
RLM120, RLM116, RLM96D). The brief: record the owner's 2026-10-23
decision (teams cannot work with one agent, so they stay off until the
person sets up additional models) as the next free D number and in
M96b's open items as resolved; build the one availability rule every
surface uses; keep the change small and in one shared module
RLF-TEAMWIRE and RLF-TEAMCORE can call.

Live calls made by this lane: 0. No paid or live model calls; the brief
names none.

## What landed

- **D227 (PLAN.md §2).** Owner decision, verbatim: "the teams cant work
  with only one agent so by that logic it should be off until a user
  sets up additional models". Teams are available only while the person
  has at least two usable models configured — a lead plus at least one
  worker the team engine can really dispatch to, counted across backends
  and providers, never a raw settings count — and the person has not
  switched them off. Resolves M96b review finding 4 (the single
  availability gate across editor/ACP/CLI/webview); supersedes M96b/D208's
  silent single-model parity for explicit team entry points. M96b's
  section carries the resolving status and the supersession note.
- **One shared rule (`src/shared/teamAvailability.ts`).** Pure:
  `partitionTeamCandidates` (distinct from the lead; runnable =
  available, key-billed only while `teamWorkers` is on),
  `checkTeamAvailability` (switch + at least one runnable worker;
  usable-model count, lead included), `teamAvailabilityRefusal` (the
  words, read at call time), and `isSameTeamModelId` — lane R's
  comparison for callers that cannot import core (activation carries no
  team runtime module), kept identical by an equivalence test.
- **Editor host.** `isTeamAvailable` is the person's switch only
  (explicit `false` turns off; absent counts as on — the two-model rule
  gates instead). The release latch is gone
  (`OPTIONAL_RUNTIME_AVAILABILITY.team` deleted). `openTeamRoles` while
  off refuses with `teamSwitchedOff`, naming the way back; any other
  closed gate keeps its error. Dispatch and Try lost their latch checks;
  Try additionally refuses a draft with no second usable model in
  words. `decideTeamConversationMode` and `hasRunnableTeamEntry` (plus
  headless's pays-aware `canRunAgent`) delegate their counting to the
  shared partition; every reason is preserved.
- **Headless exec.** The certification flag is gone
  (`are/setHeadlessTeamsAvailable` deleted): `--team` parses on its own
  checks, shows on the exec help screen, and `prepare` refuses a run
  without a second runnable engine model in words instead of running on
  silently as single-model. Solo and subscription-only snapshots refuse
  the same way.
- **ACP agent.** `teamSessionAdmission` in `src/acp/teamAdmission.ts`
  applies the rule to a session model plus workspace entries and
  returns ok or the words. The ACP agent has no team session path on
  this base (RLF-TEAMWIRE builds the wiring now); the helper is what it
  calls, tested here against the real rule and the real comparison.
- **Webview / Roles draft.** `deriveTeamPanel` adds
  `teamNeedsSecondModel` to the draft's issues when the template
  delegates but the offers hold no second model beside the
  orchestrator's — the existing issues channel shows the words and
  blocks Save. Solo needs no second model. No protocol change, no new
  traffic (offers are already fetched on read), no new markup.
- **Strings.** `teamNotReleased` replaced by `teamNeedsSecondModel` and
  `teamSwitchedOff` in English plus all 14 tables
  (`node scripts/check-l10n.mjs`: 0 problems).
- **Docs.** README (`exec --team`, Team configuration), `docs/ci.md`
  (options table + snapshot section), CHANGELOG Highlights, PLAN.md D227
  - M96b status, ROADMAP regenerated and current. The `--team` table
    cell keeps the old 302 characters so the WB-171 restore anchor stays
    byte-exact.

## Proof

All suites run with the repository's own timeouts
(`npx vitest run <files> --maxWorkers=3`); counts are the final green
runs on this tree.

- `test/unit/teamAvailability.test.ts` (23 green): the switch table;
  the rule (lead alone refuses; lead plus worker offers; sameModel
  dedupe, unavailable, key gate, switched-off with the way back; the
  lane-R equivalence); the editor binding (setup opens while on,
  refuses in words while off; stored runnable team loads while on,
  nothing while off); stored-team forms incl. headless's
  subscription refusal; ACP admission (one model refuses, two admit,
  off refuses, malformed caller value rejected); headless runs over
  real temporary folders and the real state file (missing snapshot,
  Solo and subscription-only refuse; a second engine model offers the
  team endpoint, idempotent prepare); the Roles draft (pair with one
  offer carries the words and blocks Save; solo and two-offer pair do
  not).
- `test/unit/teamSingleModel.test.ts` (15 green, unchanged): the
  conversation-mode delegation preserves every reason.
- `test/unit/teamPanel.test.ts`, `teamRolesSection.test.tsx`
  (incl. 2 new render tests: the words show and Save disables with one
  model; nothing shows with two), `teamHostService.test.ts` —
  162 green in the final sweep batch.
- `test/unit/execTeamFlags.test.ts` (9 green): the flag parses without
  any switch; grammar denials unchanged.
- `test/unit/acpTeamContracts.test.ts`, `cliHelp.test.ts`,
  `cliHelpConsistency.test.ts` — 129 green.
- `test/unit/cliReference.test.mjs`, `planReader.test.ts`,
  `acpTeamPackage.test.mjs`: cliReference and acpTeamPackage green;
  planReader has 1 pre-existing failure (below).
- `teamStartup`, `teamChunkPackaging`, `teamModelsFirstPaint`,
  `browserEnglish`, `execTeamLedger`, `execTeamSweep`,
  `team/teamSameModel`, `teamEntries`, `teamOrchestratorSlot`,
  `teamAdmission`, `nodeTeamMode`, `modelsSections`, `teamPreview`,
  `modelsPanelSchemas`, `teamPanelBrowser`, `teamConfigParse`,
  `m96dCoordinatorEndpoint/Identity/Spike/Store` — all green
  (the 2 endpoint skips are Windows-only tests on macOS).
- `test/integration/teamPanelAvailability.test.ts` reworked to the new
  rule (off: no content, words on the command; on: the stored team
  loads and Roles opens). NOT RUN: macOS lanes cannot start Electron.
- Red drills, each broken on purpose, red, restored byte-exact
  (working tree clean after each), green:
  - the rule never refuses → exit 1, 6 failures (rule, ACP and panel
    proofs) → 23 green;
  - `prepare` silently returns → exit 1, the 2 headless refusal proofs
    fail → 23 green;
  - the panel reports a generic missing-entry issue → exit 1, the
    Roles-draft proof fails → green;
  - `openTeamRoles` reports task-unknown while off → exit 1, the
    binding proof fails → 23 green.

## Gates

- `npm run typecheck`: exit 0 (host, webview, unit, e2e, integration).
- `npm run lint:js`: exit 0 (after one mechanical integration fix,
  below).
- `npx prettier --check .`: exit 0.
- `node scripts/check-l10n.mjs`: exit 0 (0 problems).
- `npm run check:host-api`: exit 0. `npm run check:reference`: exit 0
  (after the WB-171 anchor fix, below). `npm run check:roadmap`:
  exit 0. `gen-lazy-registry --check`: exit 0.
  `check-host-globals`: exit 0. `cycles`: exit 0.
- `node scripts/check-ui-text.mjs` against the installed darwin-x64
  ACP tarball: exit 0 (extension, Model API, review and installed
  agent load the shared English fallback, EN + 14).
- `npm run test:a11y`: BLOCKED by the agent sandbox, not run to green.
  The full gate hung 45 minutes with no output (terminated); a scoped
  `node scripts/a11y.mjs models-errors models-configure` run fails in
  `launchWorker` with `TimeoutError: Timeout 120000ms exceeded` because
  Chrome's remote-debugging pipe never connects — stderr shows the
  sandbox denying `~/Library/Application Support/Google/Chrome/Crashpad/settings.dat`
  (`Operation not permitted`) plus a keychain trust-store error. No
  workaround attempted (rig sandbox rule); the lead runs this gate
  outside the sandbox. Note the lane adds no new markup: the words
  render through the existing `<p role="alert">` issues list and the
  existing disabled Save.
- Final full `npm run lint:js`: NOT RE-RUN on the resumed run
  (2026-10-30): common.md forbids whole-repo lint on the shared machines
  ("takes hours") and names hosted CI the full gate. Touched-files
  `eslint --max-warnings 0` is exit 0 on the final tree (see the resumed
  run below); the tree is byte-identical to the one the earlier full
  `lint:js` passed except this record.

Pre-existing reds on the int/recovery base, each measured, none caused
by this lane (my diff adds zero bytes to any of them):

- `npm run build` stops at bundle-size: 10 bundles over
  (reportingPanel, resourceGovernor, resourceAdmission, modelApi,
  modelsPanel, usageService, teamScheduler, vaultActions,
  estimateContracts, wire). A pristine `f53ef168f` worktree builds the
  identical 10 overs at identical sizes (exit 1 both). My bundles are
  green with headroom: extension 501.1/600, teamPanel 96.4/100, uiText
  119.9/125, headless 116.8/125 KiB (base: 500.4, 95.6, 120.0, 116.7).
- `check-bundle-split`: exit 1, 3 problems, all
  `chatgptRecord.ts` in providers bundles I never touched —
  byte-identical on base.
- `check:catches`: exit 1, counts risen across core/host/runtime/webview
  in files I never touched; my diff adds zero catch sites.
- `knip` (deadcode): exit 1, findings only in untouched files
  (judgeApprovalFixtures, redact, paidHost, judge lint, knip.jsonc
  ignores, four tag hints); my new module is used, my deleted exports
  leave nothing dangling.
- `jscpd` (duplication): 9 clones on my first run, 2 mine — both
  extracted (shared rig helper, `withTeamRun`) — leaving the 7
  pre-existing clones in untouched files.
- `check:plan`: exit 1, PLAN.md over the archive bound on base
  (3,769,703 bytes) before my +2,331; the format drift my first status
  line caused is fixed (reviewed `recovery (RLF-TEAMGATE)` phrase).
- `planReader.test.ts`: 1 failure (`Location: Escape hatch` risk) —
  the same assertion fails on base PLAN bytes via the same reader
  (probe in `/tmp`), with zero drift on both trees.

Integration fixes this lane carries (kept as separate commits):

- `src/core/team/coordinator/mode.ts`: pre-existing lint error
  (unparenthesized nested ternary; prettier strips the parens the rule
  wants, so the branches became an early return plus one ternary).
  Behavior-identical; m96d suites green.
- `docs/ci.md`: the `--team` cell shortened by my edit reflowed the
  options table and broke the byte-exact WB-171 restore anchor; the
  new cell is the same 302 characters, so only the edited rows differ
  from base and `check:reference` is green.

## Resumed run (2026-10-30, after the quota reset)

The lane resumed on the identical tree (HEAD `cc5a183b2` plus this
untracked record). Everything below was re-measured on the final tree
with the repository's own timeouts (no `--testTimeout` anywhere).

Gates, final tree: prettier on touched files exit 0; touched-files
`eslint --max-warnings 0` exit 0; `npm run typecheck` exit 0;
`check-l10n` exit 0 (0 problems); `check:reference` exit 0;
`check:host-api` exit 0; `check:roadmap` exit 0; `cycles` exit 0;
`check-host-globals` exit 0; `gen-lazy-registry --check` exit 0 after
removing the stale `dist/traffic-harness/` output the 2026-10-23 a11y
attempt left behind (gitignored build output; the check saw 3 phantom
"unreached" rows until it was removed). Still red, each re-confirmed
pre-existing: `check:plan` exit 1 (3,772,034 bytes, over on base before
my +2,331); `check:catches` exit 1 (zero catch sites in my diff: counts
identical to base in all 14 touched sources); `duplication` exit 1
(7 clones, 0 touching lane files, via the JSON report);
`deadcode` exit 1 (only untouched files; the `constants.ts` tag hint
is a line my diff never touches); `build` exit 1 (exactly the same 10
bundle overs; my bundles green: extension 501.1/600, teamPanel 96.4/100,
uiText 119.9/125, headless 116.8/125); `check-bundle-split` exit 1
(the same 3 `chatgptRecord.ts` rows); SAST exit 1 (5 findings, all
`replaceAll`-sanitization in untouched
`src/host/backend/deviceWorkerDarwin.ts`, byte-identical to base);
`security:audit` exit 1 (undici/msal-node/zod advisories plus stale
exceptions; the lane touches no dependency file).

Suites, final tree, `npx vitest run --maxWorkers=3` in ≤3-file batches:
teamAvailability 23, execTeamFlags 9, teamSingleModel 15, teamPanel +
teamRolesSection + teamHostService 162, acpTeamContracts + cliHelp +
cliHelpConsistency 129, cliReference + acpTeamPackage green,
teamStartup + teamChunkPackaging + teamModelsFirstPaint 19,
browserEnglish + execTeamLedger + execTeamSweep 9, teamSameModel +
teamEntries + teamOrchestratorSlot 43, teamAdmission + nodeTeamMode +
modelsSections 23, teamPreview + modelsPanelSchemas + teamPanelBrowser 32,
teamConfigParse + m96dCoordinatorEndpoint/Identity 9 + 2 Windows-only
skips, m96dCoordinatorSpike/Store 67 — all green. `vitest related`:
teamAvailability/teamConversation/teamAdmission → 86 files, 1129 passed
(failures: 3 judge, identical on a pristine `f53ef168f` worktree;
pluginDispatch 2 and the teamModelsFirstPaint hook timeout, each green
standalone on this tree — mega-run load); teamHostBinding/teamPanelViews/
execTeamEntry → 196 green; execArgs/runExec/cliHelp → 534 green plus the
same 3 base-measured judge failures; statusPhrases/coordinator mode →
1863 green plus estimator/planReader failures byte-identical on base
(the whole-plan "zero problems" diff is the same 3 M100 rows, only line
numbers shifted by my PLAN edit; history-suite timeouts and one tmp
cleanup race are rig-load effects failing on base too). `related` for
`constants.ts`, `en.ts` and `extension.ts` is the whole battery and was
not run locally (common.md; hosted CI gates). The e2e live file stays
skip-gated (no live calls; the brief names none); the integration proof
stays NOT RUN (Electron on macOS).

Red drill re-confirmed on the final tree: the rule never refuses →
exit 1, 8 failures; restored byte-exact (`git diff` empty) → 23 green.

Real use from the packed product: `node scripts/package-acp.mjs
--target darwin-arm64` exit 0 (112 packaging self-tests pass; the
universal package stays blocked pre-existing on the missing linux/x64
native helper). The packed `exec --help` lists `--team` with its
two-model sentence. Packed `exec --team --backend modelApi
--permission-mode acceptEdits --max-budget-usd 1` in an empty workspace
reaches the credential-store requirement first — the sandbox reports the
store unavailable — and stops with exit 3, 0 requests, $0.00 settled:
no model call, no credentials touched. A packed end-to-end team refusal
needs a working credential store, so the lead runs that outside the
sandbox; the refusal itself is proven by the real-code `prepare` tests
over real temporary folders and the real state file.

## Handoffs and notes

- RLF-TEAMWIRE / RLF-TEAMCORE: the rule is `checkTeamAvailability`
  (+ `partitionTeamCandidates`, `teamAvailabilityRefusal`,
  `isSameTeamModelId`) in `src/shared/teamAvailability.ts`; the ACP
  session entry is `teamSessionAdmission`. My hunks in shared/profile
  files avoid your regions (your 6 insertions in `teamHostBinding`,
  `execTeamEntry`, `constants`, `en` are untouched lines).
- Try (`dryRun`) is wired to the rule but has no unit proof: it runs
  inside extension activation. The rule it calls is the tested one.
- The switched-off state hides Roles; the command refuses in words.
  Setup (Roles) stays reachable while on: the draft carries the
  requirement, runs refuse.
