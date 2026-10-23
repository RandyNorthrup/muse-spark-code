# RLF-JUDGEFIX (2026-10-23): RLM98P2's judge gate and suite failures on int/recovery

Recovery lane fixing what M98 phase 2 brought into int/recovery. Base
int/recovery `3198954c91` (main 0.19.0 plus 24 merged lanes). Rig
`linuxlt`, worktree `/home/randy/lanes/RLF-JUDGEFIX`, branch
`rec/rlf-judgefix`. Commits below, hooks on, no push, no rebase. RLM125
(fast judge, `~/lanes/RLM125`) was read before editing shared judge
files; it works in `judgeSetup*` and `l10n`, no overlap with the files
below except `src/runtime/main.ts` (its setup-CLI row vs this lane's
exact-money budget flag) and `src/shared/l10n/en.ts` (adjacent blocks).

Nothing was loosened: no gate weakened, no baseline raised, no budget
raised. The catch baseline is untouched; the money and PATHGUARD
allow-lists only gained the sanctioned RATE entries (M121 clause 1).

## 1. check:catches — 64 new sites narrowed or reported (exit 0)

Every new judge catch is NARROW (brand/code/instanceof check plus
rethrow of everything else) or REPORTED (log through the redacting
`errorNameForLog` plus a typed failure carrying the cause's kind).
`errorNameForLog` factored into `src/core/logging.ts` so the judge
bundles stop importing the backend's `logText` (a bundle-split leak the
delivery suite caught; the leak drill fires and restores).

Drill: `src/core/judge/local/posixPeer.ts` NARROW catch replaced with
bare `catch { continue }` → `check:catches` exit 1 (`new SWALLOW catch
site ... SWALLOW rose from 72 to 73`); restored → exit 0.

## 2. check:usable-reply — hook preflight allow-listed (exit 0)

The 4 `.status === 'completed'` reads in `src/runtime/judge/hook.ts`
are hook-protocol answer statuses over the hook's own synthesized
caution/neutral outputs, never a turn status; the guard's allow-list
carries that reason (`hook.ts:<top>`).

Drill: raw `reply.status === 'completed'` added to
`src/runtime/judge/assembly.ts` → exit 1 (`raw completed-terminal
reads outside usableReply: assembly.ts:86`); removed → exit 0.

## 3. deadcode — fixture and orphans resolved (exit 0)

- `test/unit/helpers/judgeApprovalFixtures.ts` (unused file): deleted.
- `MAY_HOLD_SECRET`, `JudgeLintOptions`: wired where RLM98P2 intended
  (share the shipped judge-bundle loader; lint options threaded).
- `paidAvailability`: deleted, not wired — a value import dragged the
  lazy paid host into the activation bundle, which `check-bundle-split`
  forbids; the inline availability stands as the base.

Drill: `DRILL_UNUSED_PROBE` export added to
`src/core/judge/local/guardedExec.ts` → exit 1 (`Unused exports (1)`);
removed → exit 0.

## 4. duplication — 0 clones (exit 0)

- `judgeP2RedesignSides` vs `judgeWiringAssembly`: share the shipped
  judge-bundle loader.
- `src/shared/judgePanelSchema.ts`: the five exact-money liability
  figures spelled out in both facts and snapshot extracted to
  `panelMoneyFields` beside `panelIdentityFields`.

Drill: money fields re-inlined in both schemas → exit 1 (the exact
original clone, 8 lines, 51 tokens); spread restored → exit 0.

## 5. paidMoneyStructure — judge portion 85 sites to 0, devices 24 to 0 (suite: 46/46)

Judge plans, sides, wire costs, embedding quotes, runtime and command
assembly, lint budgets, panel facts/snapshots and the CLI budget flag
carry `UsdAmount` exact strings; ceilings compare with
`compareUsdAmounts`; reservations round up to the nano-USD. Per-unit
rates stay numeric display dollars under the shared RATE sanction
(M121 clause 1). Adoption stored records keep `legacyUsdSchema`.
The unpriced matrix drops non-finite floats: NaN/Infinity are not
representable prices, so the test feeding them as money was wrong by
the exact-money rule. `JUDGE_CLI_DEFAULT_BUDGET_USD` deleted (contract
pins the default through `parseJudgeArgs`).

Devices (lead follow-up): the 24 RLM100 sites (`spendUsd`,
`retainedLiabilityUsd`, `returnedUsd`, `budgetUsd`, `amountUsd` in
caps, tallies, panel, tasks and the paid budget) migrated the same
way — `UsdAmount` carriers, `legacyUsdSchema` at the wire/stored
boundary (M121 precedent, no protocol bump), ceilings via
`compareUsdAmounts`, spend-quota via `sumUsd`, the offer editor via
`usdInputSchema`. Corrupt amounts refuse like non-finite counts.
Devices behaviour otherwise untouched (RLF-DEVICES owns it);
`devices` 94, contracts, grants, panel, journal, handler/presence,
offer-editor suites green.

Drill: `drillUsd: number` added to `src/runtime/judge/assembly.ts` →
unexpected 24 to 25 naming `runtime/judge/assembly.ts:drillUsd`;
removed → back to 24. Re-drill after the devices migration: 0 to 1
naming the probe; removed → back to 0.

## 6. pathGuardSpawns — judge 6 files to 0, devices to 0 (suite: 7/7)

The six local-judge starters route through the guarded wrapper: fixed
execFile runs use the new judge-local `executeGuarded` (promisified
`execFileGuarded`, caller env branded by `probeChildEnvironment`,
`{stdout, stderr}` shape, failure message plus cause — the
`trees/run.ts` precedent); the two lease spawns use `spawnGuarded`
with a branded empty env and narrow their pipes, refusing a pipless
child with their existing lifetime error. Subprocess seams keep their
shapes, so injected fakes observe identical options. No bare program
names: fixed absolute paths or anchor/digest-verified helpers only.

Devices (lead follow-up): the linux and native worker runners go
through `execFileGuarded` (their env is already the branded child
env; seams and callbacks unchanged) and the linux start default
through `spawnGuarded` with a branded env — behaviour-preserving.
The darwin driver's fixed absolute commands and the storage helper's
compiled ping-proved helper are reviewed into the PATHGUARD record
with anchors; the embedded C helper's config-executable spawn and
its fixed `/usr/bin/true` probe are reviewed into the script record
(the executable resolves through the guarded tool lookup). A
PATH-carrying env change at those sites would be an unverifiable
behaviour change, so review — not re-pointing — is the fix.

Drill: `import { spawn }` plus a value use added to `guardedExec.ts`
→ unexpected 4 to 5 naming `guardedExec.ts: spawn:5`; removed →
back to 4. Re-drill after the devices migration: raw
`spawn as drillSpawn` import plus value use → names
`guardedExec.ts: drillSpawn:22`; removed → 7/7.

## 7. Suites fixed

- commandHelp 48/48, judgeCliArgs 10/10 (reservation before help
  routing: bare `judge --help` answers, action `--help` is malformed
  argv exit 2; registry, topics, reference regenerated for 313 CLI /
  89 features / 66 commands; D121 no-run-deadline timeout fix).
- judgeLocalWire 24/24, judgeSystemOneWire 11/11 (exact-money costs).
- judgeCliCommands 46/46, judgeContractPhase2, judgeP2ReviewFixes,
  judgeWiringAssembly, judgeP2Redesign, judgeLintPack: amount pins.
- judgePanel 21/21, modelsPanelSchemas/Reducer + judgeBinding 41/41.
- judgeLocalHost/judgeLocalPeer/judgeLocalPosixNative 17 pass,
  6 platform-skipped (guarded-spawn behaviour preserved).
- manifest 40/40: removed the stale `!native/darwin/muse-dictate`
  `.vscodeignore` line (D209 ships thin signed .apps only; the bare
  binary is asserted absent). Re-adding it fails the licence/helpers
  case; removing restores green (drill).
- planReader 55/55: two RLM98P2 merge artifacts left §8 tables
  directly abutting (no blank line), so the GFM reader swallowed the
  next header as a risk row. Separated. Removing one blank line fails
  the delimiter case; restoring returns 55/55 (drill).
- toolRoundsUsableReplyGuard 4/4 (shipped case green).
- judgeP2Delivery 100/102 on a quiet rig (103 cases after the new
  logText guard, §11): the 25 split-guard failures were the
  `logText` leak (fixed by `errorNameForLog`); 2 cases exceed their
  60 s budget on a loaded rig (5 gate spawns each); the other 2
  assert a green `check-bundle-size`, which is red on 7
  pre-existing over-budget non-judge bundles proven identical at
  base (below). Whistleblower verdict (§12): every split-guard
  whistleblower fires with exactly the right source — the
  non-budget delivery failures are case timeouts under load, not
  firing bugs.

## 8. Pre-existing failures, proven at base, out of scope

- `check-bundle-size` / `npm run build` exit 1: 7 OVER bundles, all
  over at base and investigated for in-scope fat at the lead's
  direction (byte-exact base worktree build at `3198954c91`):

  | bundle            | base bytes | lane bytes | budget | over by |
  | ----------------- | ---------- | ---------- | ------ | ------- |
  | reportingPanel    | 51245      | 51245      | 51200  | 45      |
  | resourceAdmission | 25670      | 25670      | 25600  | 70      |
  | estimateContracts | 25630      | 25630      | 25600  | 30      |
  | vaultActions      | 25637      | 25637      | 25600  | 37      |
  | wire              | 77611      | 77632      | 76800  | 832     |
  | resourceGovernor  | 129896     | 129896     | 128000 | 1896    |
  | modelApi          | 545025     | 545053     | 537600 | 7453    |

  Five bundles are byte-identical at base; the lane adds 21 bytes to
  wire (mandated exact-money schemas in `judgePanelSchema`) and 28
  bytes to modelApi (minifier-resultant of the required dedup) —
  0.5% of those overruns, irreducible without breaking the money
  and duplication gates. Every input of every OVER bundle is live,
  used code owned by other lanes: no test/dev code, no duplicated
  dependency, no wrong-module leak, no unread-block carriage (split
  gate green), no unused exports (deadcode green), no clones
  (duplication green). A `MODEL_API_MODEL_TEXT` key hunt found
  three seemingly unread keys, but all three are live via the
  injected `context.text` port (`schedulesEntry.ts`), so no cut.
  The remaining shrink needs other lanes' module redesign
  (splitting `settings.ts`, per-key text splitting, `ModelApiHost`
  surgery) or release-level re-baselining — the §7 deferral case
  for the lead, recorded here instead of presumed.
  All 8 judge bundles hold their budgets (judgeP2 66.2/75,
  judgeSources 62.7/75, judgeLocal 47.1/75, judgeLint 35.0/50,
  judgeHook 65.2/100, judgeUses 16.5/25, judgeServe 25.6/30,
  judge 77.0/100).

- `check:plan` exit 1: PLAN.md 3,720,399 bytes over the 3,565,158
  archive bound; base is 3,721,495 (over by more; this lane shrank
  it). Archiving is the lead's PLAN procedure, not a judge fix.
- `test/unit/judgeLocalLinuxNative.test.ts`: `beforeAll` needs a
  writable `/var/tmp` (block-device proofs); this sandbox mounts it
  read-only (`EROFS`). Fails identically at base; hosted CI runs it.
- Found, not owned: a third adjacent §8 table pair at PLAN.md:37589
  (M109 vault region, spurious `Location: Residual / follow-up`
  risk, no test covers it) and the 24 devices money sites + 4
  devices spawn files above.

## 9. Gates (final, this worktree)

typecheck 0, prettier 0, eslint 0, check:l10n 0, check:reference 0,
check:host-api 0 (regenerated twice: child_process 44→39
judge guards, →38 devices guards; util 19→14),
check:roadmap 0, check:catches 0, check:usable-reply 0, duplication
0, cycles 0, deadcode 0, check-bundle-split 0, check-bundle-size 1
(7 pre-existing OVERs, investigated §8, triaged to release),
check:plan 1 (pre-existing bound).

`vitest related` over all 61 changed sources: 928 files, 874 pass,
31 skip, 23 fail; 24,638 tests pass, 77 fail, 292 skip. Every failing
file is outside this lane (verified: the diff touches no schedule,
connector, device, vault, private-dir, inspect, estimator, vsix,
browser, media or team file): browser suites fail on Chrome's
`Socket path too long` (the sandbox's deep TMPDIR); device/vault/
private/inspect/exec suites fail on sandbox filesystem ownership and
refusals; vsixCompression needs the pinned zopfli install;
acpServeHandshake and resourceStatusCpu fail identically on a clean
base worktree; estimatorPlanSnapshotRealPlan fails on §6 M100/M110/
M111/M115/M116 lane content byte-identical at base; vaultPanelBuild
asserts a bundle over budget at base (a const removal cannot grow
it); windowsPowerShellModules names an untouched devices file;
judgeLocalLinuxNative needs writable /var/tmp (EROFS here). No
judge suite fails in the related run.

## 10. Commits (branch rec/rlf-judgefix)

- 65e4844f0 fix(judge): narrow the judge's parse and evidence-file catches
- eef2649ec fix(judge): narrow the cascade's catches
- 03445faa3 fix(judge): report the judge-use fences instead of swallowing
- 95b5a49bb fix(judge): narrow the embedding route and report the panel read
- 9bb6fd11a fix(judge): brand-check the embedding ledger fault
- 2db21a8aa fix(judge): narrow technique, local-source, MCP and CLI catches
- 7f5df2882 fix(judge): narrow the local peer scan and transport decode
- b8d8e22a6 fix(judge): report provider leg failures with their cause
- 557ad9d35 fix(judge): report SystemOne transport and key-check failures
- b59412ccc fix(judge): report the SystemOne source leg with its cause
- cd7f8e782 fix(judge): narrow the workspace scope reads
- c4d5d6a47 fix(judge): narrow argv parsing, carry reserve refusal causes
- 751364f80 fix(judge): report serve, lint and MCP loop failures
- 00a4ab8bd fix(judge): allow-list the hook preflight's answer statuses
- a34881f6b fix(judge): wire the orphaned availability, options and fixtures
- 0d059b427 fix(judge): share the shipped judge-bundle loader
- 026b1f021 fix(packaging): drop the stale bare macOS helper
- 86f3f11ab fix(judge): reserve judge before help routing, document its flags
- 87ab5e142 fix(judge): expect exact-money costs in the wire suites
- cf86ab778 fix(judge): exact-money panel snapshots, sanctioned judge rates
- 75a77e77f fix(judge): factor the log's error name out of the backend bundle
- 92f76689c fix(judge): delete paidAvailability instead of wiring it
- 40fbd55c5 fix(judge): exact-money core/CLI migration, judge liability in UsdAmount
- adb347c76 fix(judge): route local-peer spawns through the guarded wrapper
- 30dbff92a fix(packaging): stop shipping the bare darwin dictate binary
- 81bcbcc98 fix(plan): separate the RLM98P2 §8 tables from their neighbours
- a816aa60a fix(judge): share the panel money fields between facts and snapshot
- 8a6983867 chore(host-api): regenerate after guarded judge spawns
- b555e8005 fix(devices): exact-money caps, tallies and panel liability
- 2a83caaf6 fix(devices): guard worker spawns, review the fixed ones
- e2244e115 fix(judge): report judge legs through the neutral log formatter
- 28be71ee3 chore(host-api): regenerate after devices spawn guards
- 0d26758ea docs(judgefix): devices, bundles, logText, whistleblowers record
- 3209e9782 docs(judgefix): final proofs and host-api regen
- (records: this file, CHANGELOG entry, PLAN.md M98 status line)

## 11. logText out of the judge bundles (lead follow-up)

`src/core/backends/musecode/logText.ts` is a backend detail (MSP
failure naming, CLI stderr words), but six judge-bundle sources
imported its `failureForLog`, carrying it into four child bundles
(judgeSources, judgeLint, judgeHook, judgeServe — no gate covered
children). All six now report through the neutral `errorNameForLog`
(`src/core/logging.ts`), the §1 precedent: `providers/run.ts`
(6 sites), `systemone/source.ts` (7), `systemone/side.ts` (2),
`runtime/judge/lint.ts` (1, `error_` arg), `serve.ts` (2),
`hook.ts` (1). Safe: no `MspError`/`DeadlineError`/MSP/timeout
runtime import in any of the six (`unlessAborted` never throws),
and no test asserts the warn text; the catch inventory already
registers `errorNameForLog` as a redacting formatter, so REPORTED
catches stay green. The three host-side importers (`judgeBinding`,
`judgeEntry`, `tempRoot`) keep `failureForLog` deliberately: host
code drives the CLI and can see MSP failures. The lint bundle's
`modelapi/glob.ts` and the hook bundle's `hookFormats/*` engine are
backend files too, but not logText — noted, not moved.

All 7 judge bundles verify logtext-clean post-rebuild, split gate
green, and the four children shrank (logText plus its UI_TEXT walk
dropped out). New delivery case `keeps the backend log text out of
every judge child bundle` guards it: inject logText into the
judgeSources meta, the detector must name exactly
`dist/judgeSources.js`, restore byte-exact, then assert no child
carries it — the file's own inject-detect-restore idiom, so the
case proves its own whistle every run. (Proven green in the
targeted `-t` run; the full suite needs a quiet rig, §12.)
Swap-covering suites post-rebuild: providers decide/decode +
SystemOne wire 41/41, hook CLI + serve lifecycle + lint rules
21/21, wiring assembly + redesign sides 21/21, `vitest related`
over the 8 touched sources 34 passed / 23 platform-skipped /
0 failed.

## 12. Whistleblower verdict: they all fire (lead follow-up)

The lead's 4 non-budget delivery failures were suspected
non-firing split-guard whistleblowers. Census (scratch script,
same gate, same metas, same expected messages, batched per
bundle × parent): all 35 controls fire with exactly the right
source — 6 children × 4 parents (leak) + 6 drops +
JUDGE_ONLY × 3 targets + 1 drop + the gate's 2 extra
judgeSources files — status 1, zero missing messages,
byte-exact restoration every time. Test lists ⊆ gate lists
verified file by file; `inputsOf` reads the same map the suite
mutates; the suite's zod-parse keeps the inputs the gate reads
(replicated control fires). Two manual probes also fired.

The failures are case timeouts under rig load, not firing bugs:
one gate run takes 18 s at load 8.5 (swap exhausted, 8 cores)
against the 2.2 s idle figure, so a 5-gate child-guard case
needs ~90 s against its 60 s budget. Failure count scales with
load: 2 on a quiet rig, 4 at the lead's look, 55 (47 passed)
in the loaded full run here. Nothing to fix in the whistleblowers;
the full suite's green needs a quiet rig or hosted CI.
