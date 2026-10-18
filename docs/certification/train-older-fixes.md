# Train older-fixes: six fix PRs onto main-now (81dacaf5a)

Lane branch `train/older-fixes` starts at `main-now` (81dacaf5a, PR #184).
The six PR heads were fetched read-only from upstream (no remote added) into
`refs/lane-prs/`. All six share merge-base 821566c0f with the start.

## Conflict counts against the start (git merge-tree, hunks)

| Order | PR   | Branch               | Head      | Conflicts                   | Conflicted files                                                                                                                          |
| ----- | ---- | -------------------- | --------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | #187 | fix/panel-text       | 37db3d801 | 0 markers + 1 modify/delete | test/unit/Palette.test.tsx                                                                                                                |
| 2     | #167 | fix/usage-truth      | 832c6bf74 | 1 + 1 modify/delete         | CHANGELOG.md, test/unit/helpers/usageFixture.ts                                                                                           |
| 3     | #186 | fix/provider-truth   | 5e8e9b9f5 | 1 + 1 modify/delete         | CHANGELOG.md, test/unit/acpTranslate.test.ts                                                                                              |
| 4     | #177 | fix/tool-output-cap  | 04fcd8705 | 3                           | CHANGELOG.md, src/runtime/reference.node.generated.ts, src/shared/reference/reference.generated.ts                                        |
| 5     | #178 | fix/tool-rounds      | b0c79a758 | 4 + 2 modify/delete         | src/core/backends/modelapi/ModelApiHost.ts (x2), generated reference (x2), test/e2e/execStdio.e2e.test.ts, test/unit/agentOutcome.test.ts |
| 6     | #179 | fix/reasoning-shapes | 034e99c05 | 6                           | CHANGELOG.md, src/core/backends/modelapi/codecs/anthropic.ts, src/core/providers/configured.ts (x2), generated reference (x2)             |

Marker counts undercounted modify/delete conflicts; the table above is the
actual resolution record. Merge order followed fewest-first. No decision or
milestone numbers clashed, so nothing was renumbered.

## Merge log (all `git merge --no-ff` on train/older-fixes)

- 53276f6c6 #187 fix/panel-text. Kept the branch's Palette test over main's
  deletion, rewritten off `vi.fn` to recording closures (18 green, lint
  clean). Two more of its suites (cliPeek, palettePanelText) rewritten off
  `vi.fn` in 675d8afde (7 green).
- 143c4678c #167 fix/usage-truth. CHANGELOG keeps both sides. Kept main's
  deletion of the `vi.fn`-based test/unit/helpers/usageFixture.ts (nothing
  references it).
- ac5bc7497 #186 fix/provider-truth. Controller keeps the branch's
  agentLimit passthrough (F83) plus main's contributor derivation (F62).
  Restored acpTranslate.test.ts over main's deletion, rewritten off
  `vi.spyOn`/`vi.fn` (44 green); the allocation-count assertion became the
  behavioral bound check.
- 5f2333bfa #177 fix/tool-output-cap. Generated reference files regenerated
  with `node scripts/gen-reference.mjs` instead of hand-merged.
- 79f71a695 #178 fix/tool-rounds. Overflow recovery keeps TOOLCAP's
  trim-then-compact plus the round's wrap-up-slot guard and one-exit
  conversion; refusal checks take main's isDefiniteRefusal. l10n keeps the
  round's max-requests wording plus the cap's max-tool-output-bytes key in
  all 14 tables. Generated reference and roadmap regenerated. PLAN keeps
  both records; one stale TOOLROUNDS escape-hatch row dropped (its test
  file is deleted on both sides). Deleted the fake-only execStdio e2e;
  agentOutcome's read-port stub became a typed closure. invariants:
  recorded outputs enter via restoredToolText; the key-order test pins the
  tools-disabled wrap-up shape beside the full one.
- 56fe65417 #179 fix/reasoning-shapes. agentBackend keeps both optional
  fields; chat combines the tool-less gate with the sendTools quirk;
  responses keeps the hasTools gate plus conditional reasoning;
  configured.ts keeps the capabilities-gated codec with the reasoning
  omission and main's newer error classification. CHANGELOG keeps both.
- e3e292c59 regenerated referenceSchema.generated.ts for the merged catalog.

No merge was reverted: every combination break had a plain fix, except the
bundle overage below, which is cumulative (no single PR at fault).

## Real-use steps per PR (from each cert record and CHANGELOG entry)

- #187 panel-text ([PANELTEXT.md](PANELTEXT.md)): the published 0.18.2 panel
  was driven for real (F59 key-column overlap, F60 slow sign-in pill,
  F62 model rows without price/tier, F66–F69/F71 composer and palette
  wording). Verify: open the panel narrow, sign out and back in, open the
  model picker and the `/` palette — keys never overlap text, the pill names
  what it waits for, model rows carry price/tier/contributor, skill rows
  read person-facing.
- #167 usage-truth ([usagetrue.md](usagetrue.md)): the lead's 2026-10-14
  ACP run (53 Muse Code requests, contributor tier) showed Unknown cached
  tokens and doubled completions. Verify: run `usage summary` on the Muse
  Code backend — cached input, reasoning tokens and hit rate come from each
  request's own counters; a twice-delivered completion journals once.
- #186 provider-truth ([provider-truth.md](provider-truth.md)): F82/F83/F85
  were reproduced against the editor protocol and terminal. Verify: trigger
  a compaction status mid-turn (arrives as its own notice, not model text),
  list a model without confirmed tool calling (limit stated), run terminal
  `providers add` without `--model` (lists the key's models).
- #177 tool-output-cap ([tool-result-bound.md](tool-result-bound.md)): the
  lead's 940k-token grep output ended a conversation on released code.
  Verify: run a tool call past 16,000 estimated tokens — the result is cut,
  the full text pages from `.muse-spark/tool-results/`, the model is told
  what was cut.
- #178 tool-rounds ([toolrounds.md](toolrounds.md), [toolrounds-captures/](toolrounds-captures/)):
  turn-limit and wrap-up behavior with recorded provider captures. Verify:
  set a small model-call limit, run to the cap — the turn ends with the
  typed limit stop and the final call goes out tools-disabled; held input
  is re-queued through the one exit.
- #179 reasoning-shapes ([REASONSHAPESR2.md](REASONSHAPESR2.md)): 27
  provider documentation captures (round-1 rows verified/refuted, round-2
  gaps closed by capability record; xAI-first defect measured on the
  published product). Verify: pick a reasoning model per provider — Thinking
  off sends that model's affirmed switch, unlisted levels fall back to the
  provider default, models with no effort evidence send no reasoning field.

## Gates on the final tree

- prettier `--check .`: pass.
- eslint `src/ test/ --max-warnings=0`: pass (three restored suites
  rewritten off `vi.fn`/`vi.spyOn` first).
- `npm run typecheck` (all five projects): pass.
- `npm run check:plan`: 0 drift. `npm run check:roadmap`: current.
- `node scripts/check-l10n.mjs`: 0 problems. `npm run check:reference`:
  pass (generated files regenerated, never hand-merged).
- knip (plain `knip`): exit 0; one pre-existing hint
  (`OVERFLOW_MAX_REQUEST_SENDS`, comment-only on main too).
- Suites the conflicts touch: Palette (18), cliPeek + palettePanelText
  (7), usageTruth/usage/usageContracts (32), usageNotesBundle/UsageCharts/
  accountUsageText (46), acpTranslate (44), acpResources/providerRegistry
  (49 total with acpTranslate), toolResultBound/autoCompact/modelapiChatCodec
  (152), anthropic/ollama/execArgs (184), toolRounds guards + responsesCodec
  (63), usableReply/capabilityRecord/l10n (69), agentOutcome (22),
  invariants (42), responses/modelapiChat/anthropic codecs (248),
  execArgs/effort/museCodeEfforts (71), ollama/capabilityRecord/
  providersPresets (93), sessionStore/providerRegistry (23). All green on
  the repository's own timeouts.
- `npm run build`: FAILS on one gate — `dist/modelApi.js` is 530.7 KiB
  against the 525 KiB budget (OVER by 5.7 KiB). Measured honestly: the same
  build of the start commit (81dacaf5a, exported to temp/, since removed)
  is 514.6 KiB, so the train adds 16.1 KiB. Metafile attribution (source
  bytes): ModelApiHost.ts +49,417, toolResultBound.ts +16,558 (new),
  modelPolicy.ts +5,831, constants.ts +4,126, sessionStore.ts +2,593,
  observationPack.ts +2,399. The growth is inline session/request-path
  logic from all six PRs combined — no single PR breaks it, and no
  first-use-only chunk of the needed size separates plainly (the choke and
  the turn loop must stay; spill paging is ~1.5 KiB). Per AGENTS.md this
  needs a lazily loaded bundle or a lead decision: NOT fixed here, no
  budget raised, no revert (nothing to single out). All other 157 bundle
  lines report ok.
