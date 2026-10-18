# Schedule surfaces diet (lane RU207, follows schedule-delivery-diet.md)

Worktree `/Users/user/lanes/RU207`, branch `release/0.19.0-ru207`. No cap,
budget-table or gate change beyond the new chunk's own size row and the pins
the ownership test holds. No behaviour change: nine method bodies move
byte-identical behind one snapshot (plain data plus bound closures read
after the chunk loads); no port type, signature (except two private
sync-to-async promotions the callers already await), timing or ordering
change. Production `npm run build` on this rig went 251.3 KiB → 248.7 KiB
for `dist/conversation.js` (cap unchanged at 250 KiB).

## 1. Why the bundle was over

Per-module `bytesInOutput` from `dist/meta/conversation.json` showed the
merge adding +4,468 output bytes to `conversationController.ts` (plus +95
`agentRecovery.ts`): six delivery/panel entry points whose synchronous
delivery ports pin them to the first chat surface. No dead code, no
trimmable literal, no should-be-type import, zero preserved comments. The
async-compatible subset alone nets ~1 KiB against a ~1.4 KiB need, and the
remainder is pinned by synchronous contracts (the `findLive` value port,
the sync dispatch callbacks, the workspace lease), so the move carries the
panel commands too.

## 2. The move

New deferred `dist/scheduleSurfaces.js` (9,344 B; new 25 KiB budget,
9.1 KiB +15% rounded up to 25 KiB) from
`src/host/conversation/scheduleSurfacesEntry.ts`, following the
`dist/modelApiTools.js` / `dist/scheduleDelivery.js` pattern: the target
readout, the scheduled-question settlement and the schedules panel commands
(`scheduleSession`, create/list/cancel/answer/open/run, run-changed) read
controller state through `ScheduleSnapshot` (data plus bound closures, built
after the chunk loads so every read is fresh; `revision` and `now` stay
live closures so the lost-update and due-check timing match the inline
code). The controller keeps thin shells, the snapshot builder and the
loader; the dispatcher is untouched and still awaits every call. Extension
warms the chunk while the schedule wiring builds and every caller past
`liveSchedule` awaits the load; `liveSchedule` reads the warm cache
synchronously and falls back to the unattended path only inside the load
window, so a first fire still runs. No delivery port changes type; the
billing, dispatch and lease paths are untouched. A bundle that cannot load
refuses through the dispatcher's existing catch (log plus panel error),
never silently.

## 3. Gate-fire proof

`test/unit/scheduleLazyOwners.test.ts` gains `SCHEDULESURFACES`: the
conversation graph holds neither `scheduleSurfaces.ts` nor its entry and
keeps the `./scheduleSurfaces.js` external edge. Importing the module
instead of the entry fails the new test (1 failed, 2 passed); restoring the
entry passes (3 passed).

## 4. Before / after (bytes, production `npm run build`)

| Bundle                     | Before  | After   | Delta  | Budget  |
| -------------------------- | ------- | ------- | ------ | ------- |
| `dist/conversation.js`     | 257,360 | 254,707 | −2,653 | 256,000 |
| `dist/scheduleSurfaces.js` | — (new) | 9,344   | +9,344 | 25,600  |
| `dist/extension.js`        | 522,662 | 523,113 | +451   | 614,400 |
| `dist/schedules.js`        | 176,256 | 176,256 | 0      | 204,800 |

Budgets are KiB-exact in `scripts/check-bundle-size.mjs` (250 / 25 / 600 /
200). The `extension.js` delta is the loader, the warm-up and the
`deferQuestions` direct call.

## 5. Verification on this rig

- `npm run typecheck` exit 0; `npm run format:check` clean; eslint on every
  touched file zero errors; `node scripts/check-l10n.mjs` 0 problems; knip
  exit 0 (entry registered); `npm run cycles` clean.
- `npm run build` exit 0 end to end: size gate passes every row; split gate
  exit 0; host-globals exit 0 (new bundle listed, 0 `navigator` refs);
  lazy-registry `--check` exit 0; third-party notices unchanged.
- Suites with the repository timeout: `scheduleLazyOwners` 3/3,
  `lazyBundleFiles` + `scheduleLazyOwners` batch 16/16,
  `test/e2e/schedulesStdio.e2e.test.ts` 3/3; earlier schedule/paid batches
  re-run green where touched (14/14, 15/15, 17/17 on the delivery diet).
- Packed-product drills: the new chunk loads standalone and its shipped
  `scheduleTargetOf` answers match/mismatch/unadmitted/running correctly;
  `node dist/acp.js schedule …` add → remove → empty list, all exit 0.
- Not live-proven (recorded, not claimed): the editor panel and delivery
  paths that consume the moved code fire only with editor delivery, which
  stays certification-off on lead-only receipts; the moved bodies are
  byte-identical and every async seam preserves order (dispatcher awaits,
  dispatch catches, warm-up precedes first fire).
