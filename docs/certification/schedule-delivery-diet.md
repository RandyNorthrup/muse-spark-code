# Schedule delivery diet (lane RU207)

Worktree `/Users/user/lanes/RU207`, branch `release/0.19.0-ru207`. No cap,
budget-table or gate change beyond the new chunk's own size row, the
`SCHEDULE_MODEL_TEXT` readers update, and the pin the ownership test holds.
No behaviour change: one static import becomes `await import()` on a path
that already awaits, with a fail-closed refusal naming the chunk; the engine
factory goes async with its single caller; the schedule billing popup goes
through the paid entry instead of a static host import.

Production `npm run build` on this rig went 200.5 KiB → 172.1 KiB for
`dist/schedules.js` (cap unchanged at 200 KiB).

## 1. Why the bundle was over

Per-module `bytesInOutput` from `dist/meta/schedules.json` against a pristine
`release/0.19.0` baseline worktree showed the merge added new modules to the
schedules graph, largest first: `host/schedules/backgroundTarget.ts` (+6,389),
`host/schedules/deliveryBinding.ts` (+5,899), `modelapi/shellSyntax.ts`
(+5,489), `core/schedules/unattended.ts` (+5,489), plus growth in
`scheduler.ts` (+2,871), `engine.ts` (+2,705) and `store.ts` (+1,943). The
chain enters through one static edge: `runtimeEntry.ts` imports
`createScheduleDeliveryBinding` from `host/schedules/deliveryBinding`, which
constructs `ScheduleGrants` and `UnattendedRun` as values. The terminal CLI
never binds editor delivery, so the whole editor path rode every schedule
invocation for nothing.

## 2. The move

New deferred `dist/scheduleDelivery.js` from
`src/host/schedules/scheduleDeliveryEntry.ts` (re-exports the factory and its
ports type, nothing else), following the `dist/modelApiTools.js` pattern:
`runtimeEntry.ts` keeps `import type` and loads the entry with a memoized
`loadDelivery()` beside the existing `loadBilling()`; a bundle that cannot
load refuses the run with `the scheduleDelivery.js bundle could not be
loaded`. `createScheduleEngine` goes async (single caller, already async)
and the `delivery` port admits a promise. Terminal runs without editor
delivery never load the chunk: the provider key is omitted exactly as before.

The schedule billing popup (`askPaidUse`) moved off the static host import
for the same reason: `extension.js` may not carry `paidHost.ts` /
`paidConsent.ts` (paid.js-only deferred files). `paidEntry.ts` re-exports the
existing popup and the billing `ask` loads it with a chunk-named refusal;
popup errors still propagate truthfully (load inside `try`, call outside).

## 3. Gate-fire proof

`test/unit/scheduleLazyOwners.test.ts` gains `SCHEDULEDELIVERY`: the
schedules graph holds neither `deliveryBinding.ts` nor `backgroundTarget.ts`
and keeps the `./scheduleDelivery.js` external edge. Pointing the loader at
`deliveryBinding.js` instead fails the new test (1 failed, 1 passed);
restoring the entry passes (2 passed).

## 4. Before / after (bytes, production `npm run build`)

| Bundle                     | Before    | After   | Delta   | Budget  |
| -------------------------- | --------- | ------- | ------- | ------- |
| `dist/schedules.js`        | 205,304   | 176,256 | −29,048 | 204,800 |
| `dist/scheduleDelivery.js` | — (new)   | 37,105  | +37,105 | 51,200  |
| `dist/extension.js`        | 510.3 KiB | 522,662 | +~115 B | 614,400 |
| `dist/paid.js`             | 51.4 KiB  | 52,705  | +~70 B  | 76,800  |
| `dist/runtimeEngine.js`    | 703,175   | 703,175 | 0       | 896,000 |

Budgets are KiB-exact in `scripts/check-bundle-size.mjs` (200 / 50 / 600 /
75 / 875). `dist/conversation.js` is untouched by this change and stays over
its 250 KiB cap by ~1.3 KiB (separate item).

## 5. Verification on this rig

- `npm run typecheck` exit 0; `npm run format:check` clean; eslint on every
  touched file zero errors; `node scripts/check-l10n.mjs` 0 problems; knip
  exit 0 (entry registered); `npm run cycles` clean.
- `npm run build`: size gate passes every row except the known
  `conversation.js` overage; split gate exit 0; host-globals exit 0
  (new bundle listed, 0 `navigator` refs); lazy-registry `--check` exit 0.
- Suites with the repository timeout: `scheduleLazyOwners` 2/2,
  `schedulePaidConsent` + `scheduleWorkspaceBridge` + `scheduleLazyOwners`
  batch 14/14, `scheduleFireFailures` + `runtimeDailyBudget` 15/15,
  `packagedBundles` + `featureCatalogDetails` 17/17,
  `test/e2e/schedulesStdio.e2e.test.ts` 3/3.
- Packed-product drill (`node dist/acp.js schedule …` on the slim bundle):
  the new chunk loads standalone (`createScheduleDeliveryBinding` is a
  function); add → pause (`paused:true`) → resume → remove → empty list,
  all exit 0.

## 6. `dist/conversation.js` stays over (separate item, not this change)

The #207 merge adds +4,468 output bytes to `conversationController.ts`
(+95 `agentRecovery.ts`); the bundle is 257,360 B against the 250 KiB
(256,000 B) cap: over by ~1,360 B (0.5%). There is no honest sub-2K cut:
every added member is referenced (no dead code), the growth is dense logic
(no trimmable literal), esbuild already elides type-only imports, and the
bundle carries zero preserved comments. The only movable mass is the six
schedule readout methods, and they are pinned by synchronous delivery ports:
`scheduleTarget` is passed as the sync `findLive` port, `scheduleModelId`
sits in a sync `??` chain, `scheduleWorkspaceChanged` runs on sync workspace
events, and `submitted`/`row` are invoked without `await` in the dispatch
loop — only `scheduledQuestion` is already async, worth ~400 B alone
(~950 B net for the three async-compatible methods together, short of the
~1,360 B need). Clearing the cap needs the delivery ports to go async
(`findLive`, `submitted`, `row` in `deliveryBinding.ts`, the six controller
methods, six `extension.ts` call sites, a second deferred bundle with the
full entry/build/deferred/size/split/packaging/registry ceremony). That is a
behaviour-touching redesign of the delivery contract whose proof is a live
schedule fire, which is impossible while delivery certification stays off
(lead-only receipts): it cannot merge proven tonight, so it is left for a
follow-up milestone, not release-night surgery.
