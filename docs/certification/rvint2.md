# RVINT2 — Independent review of the second integration round

Base: `int/recovery` at 3198954c91 (round 2: RLWINFIX2, RLMCPERA, RLHOSTS,
RLM123, RLM114, RLM117, RLACP, RLM98P2, RLM100 merged onto 397aca3ddb, plus
11 `fix(int):` commits). Reviewer with fix rights; fix commits: 7d006a7ec
(catches), 0cec6b98a (dead code), 23480598b (test dedupe), bda3312d1
(reference witness).

## What was reviewed

- All 9 merge commits: `git show --remerge-diff` per source conflict, lane
  tip (`^2`) spot-compared against each merge result, and every integrator
  claim in merge messages re-checked on the final tree (ports, unions,
  renumberings).
- All 11 `fix(int):` commits read in full.
- Decision renumberings D212→D213/D214/D215 and gotcha renumberings
  G130→G135, G92–G95→G136–G139: headings unique, code references checked
  (`src/core/team/*` D212 references all mean secondary roles; D213
  references all in the MCP era client; gotcha ids unique in
  `docs/orchestration-gotchas.md`).
- The three judgement calls named in the brief (below).

## Findings fixed

### F1 — `npm run check:catches` red: 64 unbaselined judge catch sites

RLM98P2's lane tip had accepted its judge catches into
`scripts/catch-baseline.json`; the merge kept the int side's lower counts
instead (core SWALLOW 72→83, GENERIC 263→289 unbaselined), so the gate
failed on 64 sites, nearly all under `src/core/judge`, `src/host/judge`,
`src/runtime/judge`. Eleven got a named condition or a redacted record:

- JSON.parse / fatal-decode guards now test `SyntaxError` (and `TypeError`
  for the UTF-8 decode in `src/runtime/judge/serve.ts:57`) and rethrow the
  rest: `src/core/judge/providers/decode.ts:133`,
  `src/core/judge/systemone/side.ts:157` and `:217`,
  `src/host/judge/workspaceScope.ts:136`, `src/runtime/judge/hook.ts:268`.
- `src/core/judge/evidencePaths.ts:223` warns on an unreadable record, as
  the malformed-record path beside it already did.
- `src/host/review/reviewedApprovals.ts:153` and `:193`,
  `src/host/models/modelsPanel.ts:329`, `src/host/judge/judgeBinding.ts:111`
  log the failure kind through the redacting formatters
  (`failureForLog`/`wireWordForLog`) before taking their no-opinion path.

The other 53 were read one by one and stand, now held by identity in the
regenerated baseline: judge outcome funnels that publish a typed refusal
(cascade, sampling, contrastive, providers, SystemOne, local, embedding),
runtime CLI boundaries that answer with an outcome, exit code or HTTP
no-answer (args, commands, mcp, hook, serve, lint, cliBinding), fail-closed
fences and latches (uses, fences, workspaceScope, redaction, claim checks),
the `readFile → string | undefined` port contract (judgeBinding, main), and
two sites the classifier cannot prove but the code handles (posixPeer's
ENOENT/owner logic, transport's promise reject carrying the cause). One
accepted conflation is named here so it is not silent:
`src/runtime/judge/cliBinding.ts:81` reports a ledger failure as
`over-budget`; the reason enum is the SystemOne reserve contract and the
path stays fail-closed (no dispatch).

Drill: reverting the serve narrow to a plain catch makes
`node scripts/catch-inventory.mjs --check` print
`src/runtime/judge/serve.ts:57: new SWALLOW catch site` and exit 1;
restored byte-exact, exit 0.

### F2 — `npm run deadcode` red: dead code the join carried

- `src/host/paid/paidHost.ts:233` `paidAvailability` — no caller on either
  parent; `src/extension.ts` passes the same availability rule inline to
  `createPaid` (identical at lane tip and after the merge, so no wiring was
  lost; `docs/certification/m98.md`'s claim that extension.ts spreads
  `paidAvailability` does not hold on its own branch). Deleted.
- `src/core/redact.ts:6` re-exported `MAY_HOLD_SECRET` unused through that
  path. Removed from the re-export list (the shared original is untouched).
- `src/runtime/judge/lint.ts:25` `JudgeLintOptions` defined, never used.
  Deleted.
- `test/unit/helpers/judgeApprovalFixtures.ts` imported by no suite at the
  lane tip or after the merge. Deleted.
- The reference gate's host-capability witness for `paidHost.ts`
  (`scripts/lib/reference.mjs`) guarded two fragments inside the deleted
  `paidAvailability`; the live availability rule in `src/extension.ts` is
  already witnessed there, so the stale paidHost entry was removed and the
  reference regenerated unchanged. Drill: breaking the extension.ts
  fragment still fails `check:reference` with
  `Host capability witness changed: src/extension.ts` (exit 1); restored,
  exit 0.

Remaining knip output is 5 configuration hints (stale `vendor/**`,
`axe-core`, `readelf`/`cc`/`c++` ignores) and 2 tag hints; hints do not
fail the gate and pre-date this fix.

Drill: appending an unused export to paidHost.ts makes knip list it under
Unused exports and exit 1; removed, exit 0.

### F3 — `npm run duplication` red: one copied test loader

`test/unit/judgeP2RedesignSides.test.ts[27–39]` duplicated
`test/unit/judgeWiringAssembly.test.ts[8–20]` (the `features()` loader for
the shipped `dist/judgeP2.js`). It lives once in
`test/unit/helpers/judgePhase2Rig.ts` as `shippedJudgeFeatures`; both
suites import it. jscpd: 0 clones.

Drill: checking out the pre-fix pair (3198954c91) reproduces
`Found 1 clones`, exit 1; restored, exit 0.

## Verdicts: merges (conflict resolutions checked, both sides survive)

- RLWINFIX2 (`src/acp/agent.ts`): lane try/catch + `startRequestError`
  around int side's `startingEffort` — both present (agent.ts:4015, 4027).
- RLMCPERA: docs/roadmap level only; regenerated files current.
- RLHOSTS: ROADMAP only.
- RLM123 (resources): `beforeSpawn` (lane) and `handoffTimeoutMs` (int)
  both kept in `commands.ts`/`process.ts`.
- RLM114 (`scripts/build.mjs`): `resourceBrowserValidation` and
  `teamPanelBrowserValidation` both present (build.mjs:7, 1776).
- RLM117: estimator keys in featureCatalog (`estimateDiagnosticHelp`,
  `estimateCliHelp`, `referenceEstimateFacts` at featureCatalog.ts:1580);
  `usageRecording` wiring present (modelApiBackendManager.ts:504–507).
- RLACP: porting claims verified — `locateHead` refusal builder at
  tools.ts:1687 and fileRangeTools.ts:524/537, `confinedGlob` at
  tools.ts:1543, fatal UTF-8 decode in promptFile.ts:32; D214 renumber
  consistent in PLAN.md and the archive heading.
- RLM98P2: vault + team + judge sections all kept; `paidUseText` local in
  PaidUsageSection.tsx:253; the one loss is F1's baseline (fixed above).
- RLM100: gotcha/decision renumberings verified unique; productionPackage
  and uiTextRegions unions hold (team keys + account-key pattern).

## Verdicts: `fix(int):` commits (all stand)

- RLM117: history journal lazy bundle (d5ad42fa0) is a real D6 split with
  its own measured 25 KiB budget and an honest load-failure sentence;
  history loader census entry (de6c7b0b4) widens coverage; price-walk lazy
  names (93b405a8f) reasoned and drilled in its cert note; quota stamps
  (8a521185e) is a 3-line recording fix whose rewritten suite grew 9→11
  cases and reads stamps back from the real recording.
- RLM98P2 judge: suites-compile fix (2b0689c77) is type-level only (the one
  changed expectation keeps the same assertion with a valid answer kind);
  tripwire naming (d7be903c8) minimal and correct.
- Shared production build keys (3198954c9): the devices harness stages a
  copied build under `PRODUCTION_BUILD_KEY`; judge suites prove the root
  dist generation under `productionBuildGeneration`. Distinct keys, no
  suite lost its proof.
- RLM100 Windows helpers (416bfd456): `ownerOnlyEvidence` maps a Windows
  owner-only ACL to 700/600 (deviceFixtures.ts:249), so the unified
  expectation is exact, not looser; helpers compile through the real
  `runProgram`.
- Mechanical: setTimeout globals (e18aeac77), unused type drop
  (c1dc4b852).

## Judgement calls (report only, per brief)

- `test/unit/teamHostService.test.ts` still opens with "Every port is a
  fake that records its calls" (line 3, 73 KB) — RLINTFIX is rewriting it;
  not touched here.
- `promptSequence` usable-reply allow-list entry
  (`scripts/lib/usableReplyGuard.mjs:144`) is sound: `sequenceTurnSettled`
  reads only the wire terminal, never reply text, and ends the run loudly
  (`isSilent: false`) on any non-completed turn. Stands.
- README's team sections (e.g. `### Team configuration`, README.md:6853)
  left for RLINTFIX's README-truth pass.

## Known-open failures (RLINTFIX's, measured here, not fixed)

- `npm run check:plan` exit 1: PLAN.md 3,721,495 bytes over the 85% bound.
- Bundle budgets: the brief says three; a pristine 3198954c91 build (temp
  worktree, same node_modules) and this tree both show **seven** OVER:
  reportingPanel 50.0/50, resourceGovernor 126.9/125, resourceAdmission
  25.1/25, modelApi 532.3/525, vaultActions 25.0/25, estimateContracts
  25.0/25, wire 75.8/75 KiB. `npm run build` exit 1 on both trees, budgets
  only.
- `acpServeHandshake` appears among failures in hub-related runs (named
  known-open); `runnerHelperNative`/`evalFreezeLayout` not run (named
  known-open, untouched areas).

## Other measured non-findings

- `test/unit/nativeGitPullRequestReads.test.ts` beforeAll hook timeout
  (10 s): identical failure at 3198954c91 and at round-1 base 397aca3ddb
  on this rig (5 passed, 3 skipped each time) — rig-load threshold, not a
  round-2 or RVINT2 regression.
- `test/unit/estimatorPricePackaging.test.mjs` failed twice under load
  (91 s run), then passed on pristine base (81 s) and on this tree (53 s)
  back to back.
- `test/unit/vault/credentialMigrationStore.test.ts`: sandbox-blocked with
  `VaultError: The vault cannot acquire a writer because this process's
exact operating-system birth could not be established.` Vault sources
  are untouched by round 2 and by this lane (`git diff` empty both ways).
- Duplicate decision headings (D1/D70/D74/D89/D92) are identical at
  397aca3ddb — pre-existing, not round 2.
- `judgeWiringAssembly` + `judgeP2RedesignSides` in one run: 1 failure
  under parallel load; each suite green solo immediately after (7/7, 14/14).

## Tests run (real code, repository timeouts, `--maxWorkers=3`)

- Related: side.ts (29), decode.ts + reviewedApprovals.ts (19),
  modelsPanel.ts + workspaceScope.ts (8), hook/serve/judgeBinding (2),
  evidencePaths.ts (76), paidHost.ts + redact.ts (78), lint.ts (6) — all
  passed.
- Integrator areas: teamQuotaStamp + mcpEra + productionBuild (36),
  judgeSampling + judgeCliDispatch + estimatorHistoryBundle (18),
  estimatorSurfaces (738+1 skipped), judgeWiringAssembly (7),
  judgeP2RedesignSides (14), estimatorPricePackaging (1, see above).

## Gate exit codes (final tree)

| Gate                                      | Exit                                                                                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                       | 0                                                                                                                                                        |
| eslint `--max-warnings 0` (touched files) | 0                                                                                                                                                        |
| prettier `--check` (touched files)        | 0                                                                                                                                                        |
| `node scripts/check-l10n.mjs`             | 0 (0 problems)                                                                                                                                           |
| `npm run check:reference`                 | 0                                                                                                                                                        |
| `npm run check:host-api`                  | 0                                                                                                                                                        |
| `npm run check:roadmap`                   | 0                                                                                                                                                        |
| `npm run check:catches`                   | 0 (was 1, F1)                                                                                                                                            |
| `npm run check:plan`                      | 1 (known-open, RLINTFIX)                                                                                                                                 |
| `npm run duplication`                     | 0 (was 1, F3)                                                                                                                                            |
| `npm run cycles`                          | 0                                                                                                                                                        |
| `npm run deadcode`                        | 0 (was 1, F2)                                                                                                                                            |
| `npm run build`                           | 1 (7 known budgets, identical on pristine base)                                                                                                          |
| `npm run security:audit`                  | 0                                                                                                                                                        |
| `npm run security:sast`                   | 2 — sandbox-blocked: `Fatal error: exception Failure: ca-certs: empty trust anchors.` (semgrep crashes before scanning; lead to run outside the sandbox) |
