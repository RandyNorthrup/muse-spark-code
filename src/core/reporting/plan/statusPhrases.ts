import type { PlanMilestone } from '../sources/types'

// Every dated status phrase in PLAN.md on 2026-10-06, plus the nine canonical states.
// Match the whole normalized phrase: new prose requires an explicit reviewed entry.
export const STATUS_PHRASES: Readonly<Record<string, PlanMilestone['status'] | undefined>> = {
  planned: 'planned',
  building: 'building',
  built: 'built',
  certified: 'certified',
  merged: 'merged',
  released: 'released',
  complete: 'complete',
  superseded: 'superseded',
  waiting: 'waiting',
  "complete against a fake server; live certification of the Model API path pending the owner's go (each live turn is billed to the owner's key)":
    'complete',
  "built; certified on Windows through the real recogniser twice (a synthesised recording, then a real webcam microphone hearing text-to-speech across the room, with text back), and on the owner's Mac mini for the helper's permissions, engine, capture (levels metered) and recognition lifecycle (three defects found and fixed there). macOS recognised text arrived once the recognition mode was left to Apple (forced on-device gives empty results on an Intel Mac without the model) and the mini's speech daemons were restarted after Dictation was enabled. Pending: a person speaking for the accuracy check on each platform":
    'built',
  'built and certified': 'certified',
  'M43–M56 merged (M56 as PR #44). All ship in 0.9.0': 'merged',
  "folded into M69 (D49), which also serves it to Muse Code through the `ide` server; built there on 2026-09-28 with every rule below (see M69's status)":
    'superseded',
  'built, certified and merged': 'merged',
  'PR #33 merged into main at `e219d04` after local and hosted gates': 'merged',
  'captured read-only presentation merged; owner controls deferred': 'merged',
  'merged as PR #35': 'merged',
  'merged as PR #36 at `4694803`; native writer-lock parity unproved': 'merged',
  'merged as PR #37 at `fa370ee`; local and all seven hosted checks passed': 'merged',
  'merged as PR #39 at `eb0ce56`; all seven hosted jobs passed (run 36291432546)': 'merged',
  'merged as PR #40 at `93ea81c`; all seven hosted jobs passed (run 36294862598)': 'merged',
  'merged as PR #41 at `be34ee8` with the Account & usage follow-up; all seven hosted jobs passed (run 36298748478)':
    'merged',
  'integrated in M53 PR #41, merged as `be34ee8` (tree `5757e29`)': 'merged',
  'merged as PR #42 at `cf33cb2`; all seven hosted jobs passed (run 36345148020)': 'merged',
  'merged as PR #43 at `0cf5e7e`, with the review fix to the sign-in reducer (`e489ed8`: a device sign-in started from a live Model API session keeps that session until it succeeds). All seven hosted jobs passed on head `d50ce40` (run 36346755802) and again on the review fix (run 36348351793). A live Meta install and a completed device sign-in are owner steps':
    'merged',
  "built, and joined onto M55 as branch `codex/m56-enterprise-final`. Its commit `f7dc40f` sits on `codex/m55-install` `b98c05b`. A merge then brings in M55's `d50ce40`, which carries main's merged M54 (PR #42, `cf33cb2`). Both trees passed local `npm run quality`, and the receipts are in their commit messages. M55's review fix and main after PR #43 (`0cf5e7e`) are merged in, and that tree passed `npm run quality` too (2,497 unit tests passed, 5 skipped; 328 accessibility pages; `dist/extension.js` 596.7 KiB). Merged as PR #44 (`890e37b`) after all seven hosted jobs passed (run 36350220096, the Windows job on its second attempt); ships in 0.9.0. Still open: live proof behind a real enterprise proxy with a private root, including Muse Code's IDE route":
    'merged',
  'built and certified on `feature/m68-verify-loop`': 'certified',
  'built on `feature/m69-web-fetch`, PR #52 open': 'built',
  resumed: 'building',
  'shipped off by default after its M75 run passed': 'released',
  'built on `feature/m76-agents`': 'built',
  'built on `feature/m79-plans-as-files`, reviewed and pushed as draft PR #53; certification and review fixes are in `docs/certification/m79.md`. Hosted Windows quality failed when the 100-name exhaustion test exceeded its unchanged 5-second timeout. Resume repair passed focused Windows tests: the complete suffix range is proved with the existing in-memory file port, including the last free name, exhaustion without replacement and reuse at the last name; retain the real-file-system publication, collision, cleanup, bounds and junction tests. Latest-main integration, independent review and the full candidate gates remain required':
    'built',
  'lane A1 of design spec v4 built on `feature/m81-browser`': 'built',
  'exposure-preserving import (D64) implemented; prescribed scoped rig verification complete, lead certification pending':
    'built',
  'masking redesigned': 'superseded',
  'lane complete on the current M72 candidate; lead certification pending': 'built',
  "the follow-up review RV84c and the Muse review fixed on `feature/m84-export`; the four-machine gate remains the lead's":
    'built',
  'built on `feature/m84-export`; `docs/certification/m84.md`': 'built',
  'M87 built and joined (its status below); M88 planned, nothing built': 'building',
  "joined on `m87/int` with main at `2e341e4c`; hosted CI on the milestone PR's head and native VS Code Tasks acceptance remain open":
    'built',
  "built and joined on the integration branch `m87/l0` (`feature/m87-panel-polish`); native VS Code Tasks acceptance and hosted CI on the milestone PR's exact head remain open":
    'built',
  'PR #104, after two independent review rounds and a live recheck; record in `docs/certification/m90.md`':
    'built',
  'integrated on `feature/m91-hooks-parity`; pull request next, in the 0.14.0 batch': 'built',
  'done on `m91/w-plugins` (`5a2aa619` and its docs commit); it ships with M91 in the 0.14.0 batch, not as a separate pull request':
    'complete',
  'built on `feature/m99-whats-new`; record in `docs/certification/m99.md`': 'built',
  'lanes 0/P/C/L/H/U integrated; lane W finishing wiring and verification on `feature/m94-tab`, merged with `main-sync`':
    'building',
  'waiting for a stable API (Q-M94d)': 'waiting',
  'documentation only on `feature/m100-multi-device`': 'planned',
  'folded into M55 (D36); built there (PR #43, merged 2026-09-27)': 'superseded',
  'built on `feature/m57-bundle-split` from main `2f4f669` (0.9.0); local `npm run quality` recorded in `docs/certification/m57.md`. Not pushed; no pull request yet':
    'built',
  'the program the owner handed over': 'building',
  'the first two steps built': 'built',
  'M62a built and certified': 'built',
  'M63a built and certified': 'built',
  'planned, documentation only': 'planned',
  'planned, as soon as possible': 'planned',
}
