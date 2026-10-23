# M98 phase-2 landing (RLM98P2, 2026-10-22)

Recovery lane landing phase 2 whole onto current main. Source
`src/RLM98P2/01-m98-p2-r4` tip `f131ffc880`; base main at 0.19.0
`c7bdd3e943`. Rig `linuxlt`, worktree `/home/randy/lanes/RLM98P2`,
branch `rec/rlm98p2`. Merge commit (no-ff, hooks on); no push, no rebase.

Phase 2's own record (`docs/certification/m98.md` on the source branch)
left one item open: caching the delivery gate scripts' setup across
controls was not done. That design (RVM98P2R3 10) is kept unchanged; the
landing proves its controls fire on the merged tree (below).

## Merge-conflict resolutions vs current main

1. `dist/judgeServe.js` budget 25 KiB to 30 KiB. The merged judge schema
   grows the serve closure to 25.2 KiB (20.1 KiB on the phase-2 branch);
   25.2 KiB + 15%, rounded up to 25 KiB. An exact-size assertion moved
   with the measured number and a one-line reason in the same change
   (working rule 2; the higher rule over common.md's standing text).
   Touched: `scripts/check-bundle-size.mjs`, the PLAN.md D6 table row,
   `test/unit/judgeP2Delivery.test.ts` size-guard row.
2. `src/runtime/tokenFile.ts` stays shared; only
   `src/runtime/judge/tokenFile.ts` is exclusive to `dist/judgeServe.js`.
   On the phase-2 branch no other bundle carried the shared token
   lifecycle; on current main the companion voice bundles
   (`dist/productionAudio.js`, `dist/voiceCompanion.js`, via
   `voiceSystem.ts`'s `secureOwnerOnly`) carry it, so the branch's
   exclusivity claim cannot hold. The judge wrapper is the genuine
   phase-2 code and stays exclusive. Touched:
   `scripts/check-bundle-split.mjs`,
   `test/unit/judgeP2Delivery.test.ts` children list.
3. `dist/meta/validationSchema.json` joins `CLASSIC_ZOD_CARRIERS`.
   INT0170 is main's rule (classic zod out of Node bundles that read
   zod/mini from `dist/validation.js`); the entry's re-export of
   `toJSONSchema` from `zod/v4/core` is phase 2's whole purpose for that
   lazy bundle (required on explicit MCP tool listing only), mirroring
   the `structuredSchema.js` by-design exemption. The rule still fires
   for every other bundle.
4. Lazy registry regenerated: 8 new rows (judgeP2, judgeSources,
   judgeLint, judgeHook, judgeLocal, judgeUses, judgeServe,
   validationSchema) with real loaders (judgeEntry, main, constants
   `JUDGE_P2_BUNDLE_FILE`).
5. `THIRD_PARTY_NOTICES.txt` regenerated (92 packages).
6. PLAN.md D6 row updated to 30 KiB; the merge's duplicate second
   `## 8.` heading removed (all register rows kept).
7. Sampling caps removed per D121 (`JUDGE_SAMPLING_MAX_USD_PER_QUESTION`
   and kin); arbitration timeouts (`JUDGE_REQUEST_TIMEOUT_MS` etc.)
   kept. The sampling suite proves real accounting with recording
   ledgers and exact `Usd` amounts, no per-question cap.
8. `test/unit/productionBuild.ts`: the global-setup default export is a
   function declaration (`export default function setup`), not a
   top-level call (the call was pre-existing from the phase-2 branch and
   trips main's `unicorn/no-top-level-side-effects`). Behaviour
   unchanged; `productionBuild.test.ts` covers `productionBuildSetup`.

## Test triage (no fakes)

About 31 fake-driven suites deleted outright (provider-seam
choreography with no real counterpart), the M80 precedent for fake-only
suites. The rest rewritten to real code: closure recorders, real
timers, recording ledgers, and the shipped-`dist/` assembly suite
(`test/unit/judgeWiringAssembly.test.ts`, registered in
`PRODUCTION_BUILD_SUITES` beside the delivery suite).

One expectation fix from running against the real bundle: the runtime
publishes the embedding availability manifest before every run's
dispatch (`src/core/judge/runtime.ts`), so two sequential runs publish
two statuses while consent is still asked once. The test asserts the
exact `['status', 'embed', 'status', 'embed']` order.

## Proof

- `npm run build`: exit 0 (`dist/judgeP2.js` and all children ship).
- `npx tsc --noEmit`: clean.
- ESLint on every changed file: clean, `--max-warnings=0`.
- Prettier check on every changed file: clean.
- `gen-reference.mjs --check`: current. `check-l10n.mjs`: 0 problems.
- `knip`: exit 0. `cycles.mjs` (dpdm): no cycles. `check-plan.mjs`:
  exit 1, cause measured: base PLAN.md is 3,563,591 bytes (1,567 under
  the 3,565,158 bound) and the merged tree is 3,627,254 — the merge's
  own net +63,663 bytes. The remedy is the `npm run plan:archive`
  procedure (CONTRIBUTING.md), which judges closed vs open across all
  unmerged branches; that is lead-owned plan surgery, out of this
  lane's scope. Still open for integration: archive before any
  PLAN-touching merge lands, else this gate stays red for everyone.
- `judgeWiringAssembly`: 7/7 pass on the shipped `dist/` (repo
  timeouts, fresh final run). `productionBuild`: 5/5 pass.
- `judgeP2RedesignSides`: 14/14 pass on the shipped `dist/` (rewritten
  at commit time: the file still imported the deleted `helpers/fakes`
  and per-test factory builds; now collecting logger, shipped bundle,
  closure recorders and exact `Usd` amounts).
- `judgeCliCommands` + `judgeContractPhase2`: 55/55.
  `connectorApprovalButtons` + `connectorServe` (real loopback HTTP
  through the shared helper): 8/8. `vitest related` on the regenerated
  lazy registry: 22/22.
- `jscpd`: exit 0 (three merge clones removed: `connectorCall` uses
  the shared `receiveHttpResponse`; one `paidAdmission` recorder in
  `judgeCliCommands`; the shared `warningLogger` in
  `judgeContractPhase2`).
- SAST (`security:sast`): exit 0, 0 findings on 4,145 tracked files.
  `security:audit`: exit 0 (4 advisories under the exceptions file).
- Delivery suite `judgeP2Delivery` (102 cases, repo timeouts): every
  completed case passes on the merged tree — all red controls fire
  with their exact messages and byte-exact restoration, and the final
  green-gate case passes. Across five full runs on this rig there were
  zero assertion failures; the failures seen (38/17/5/24 per run, a
  varying set each time — e.g. `judgeServe`/`serve.ts` fails at 62 s
  one run and passes at 47 s the next) are all the named 60 s
  per-case budgets expiring under shared-rig load: one gate spawn
  measures 7.3 s at load 2.9 here against 2.6 s in the phase-2
  record, and five spawns a case leave no margin once load pushes
  spawns past ~11 s. No base counterpart exists for the same-file
  comparison (the suite is new in this lane), so that comparison is
  UNMEASURED; the phase-2 record's 103/103 at ~900 s on Kubuntu stands
  as the design's proof that the budgets fit adequate hardware.
  Hosted CI re-runs this suite with the repo's own timeouts.
- No live, paid or local-model call was made (0 attempts, $0). No
  `--testTimeout` in any final run (one exploratory run used a raised
  timeout on this busy rig and is not claimed as proof; the named
  per-case 60 s budgets override flags inside the file in any case).

CHANGELOG: the M98 phase-2 entries came over with the source branch
and already describe the landed behaviour; no new entry added.
