# Lane USAGETRUE — usage and cost say what really happened

Real-life source: the lead's 2026-10-14 run of the published
muse-spark-code-acp 0.18.2 on Linux (Muse Code CLI 1.4.7) over a real review
lane: 53 Muse Code requests, contributor tier. The CLI's own records of those
requests carry per-request `cached_tokens` (3,377,308 of 3,541,059 input),
`reasoning_tokens` (3,348), `turn_duration_ms`, the effective provider model
(`muse-wonder-full-1.0-contributor`) and the meter plan name
("Muse Code Max Usage subscription").

Wire evidence used (no model call was made in this lane):

- `@muse-code/sdk` 1.4.4 `msp.d.ts` `SessionTokenUsageParams` (the vendor's
  published wire contract, in our own `node_modules`): one frame per model
  completion with raw `usage` (`inputTokens`, `outputTokens`,
  `cachedTokens`, `reasoningTokens`, `cacheReadTokens?`,
  `cacheWriteTokens?`), counted-once `promptTokens`/`totalTokens`, the
  call's own `durationMs`, and the effective `modelId` ("the effective model
  that produced this usage").
- The CLI's durable `model_completed` records (read-only, under the Muse
  sessions root on this rig): per-request `usage` + `duration_ms` +
  effective `model`, including `-contributor` tier spellings.
- `USAGE_HISTOGRAM_EDGES_MS` (constants): the last finite edge is 128_000 ms,
  which explains the observed "p50: 128s, p95: 128s" saturation.

## F20 — cached input, reasoning tokens, hit rate all Unknown

Cause: `src/core/backends/musecode/mapNotification.ts` (`session/tokenUsage`
schema) read only `cumulative { promptTokens, outputTokens }` and dropped
the frame's per-completion `usage`; `MuseUsageDeltas.receive`
(`src/core/backends/musecode/MuseCodeHost.ts`) journaled only
`{ input_tokens, output_tokens }` deltas. Journal records never carried
cached/reasoning, so the aggregate left them (and the paired hit rate)
unknown.

Fix (as a class): the mapper forwards the completion (`promptTokens` first —
the counted-once superset the journal's cached-inside-input invariant holds
against under both provider cache conventions — else raw input; cached,
reasoning, cache-write, the call's `durationMs`, the effective `modelId`).
`MuseUsageDeltas` journals one record per completion where the frame carries
it, keeping the cumulative-delta path for older frames. Session-total
`inputTokens`/`outputTokens` events keep D26's meaning for every surface
that sums them; the journal records the completion, never a re-derived
split.

Red: `test/unit/usageTruth.test.ts` F20 failed before the fix (records had
no cached/reasoning; summary showed the three Unknown lines).
Green: 5/5 pass; summary shows `Cached Input: 2,850,000`,
`Reasoning Tokens: 348`, `Cache Hit Rate: 95%`.

## F21 — request time 19,183s and p50/p95 128s for one 873.8 s turn

Cause: same `MuseUsageDeltas.receive`: each `tokenUsage` event journaled
`durationMs = now − turnStarted` (elapsed wall time), so every completion of
a turn recorded the whole elapsed turn; the total summed N overlapping
elapsed spans. Every inflated sample overflowed the latency histogram, and
`percentile()` returns the last finite edge — 128_000 ms — for p50 and p95.

Fix (as a class): each record carries the completion's own `durationMs`
from the frame, falling back to turn-elapsed only for frames that predate
it. Total time and the histogram now sum per-request durations.

Red: the new test recorded `[0, 2400000, 4200000]` ms for 30/40/50 s calls
(the old elapsed behaviour, live in the test).
Green: records carry `[30000, 40000, 50000]`; summary shows
`Total Request Time: 120s`, `Median Latency (p50): 64s`, `P95 Latency: 64s`.

## F22 — "Total Cost: Unknown", "Plan: Unknown · 53 records"

Cause (price): `settleCost` (`src/core/usage/journalRecord.ts`) priced a
plan equivalent only for `MODEL_API_PRICED_MODELS` whitelist ids
(`hasMetaPrice`); `muse-wonder-*` is published nowhere in the repo, so
`apiEquivalentUsd` stayed absent. Cause (name): the `usage/changed` meter
tier was dropped when the limit snapshot was written
(`MuseCodeHost.dispatchHostEvent`), so no surface could name the plan.

Fix (as a class): plan records price the equivalent at the used tier's
published rates — whitelist first, else the `-contributor` suffix the
backend's own model id carries (`planEquivalentUsd` via the extracted pure
`costForTier`; `estimateCostUsd` and paid admission keep the strict
whitelist, so actual costs are never guessed). The meter tier is stored
verbatim on the limit snapshot (`plan`, optional, additive) and plan rows
are named with `planLabel` of the latest observed meter
(`planDisplayName` in `src/shared/usage.ts`), falling back to the generic
label while no stored meter names one. `Total Cost` deliberately still
counts confirmed charges only — plan equivalents are not charges — and the
plan row carries the equivalent with its existing note.

Red: records had `certainty: 'plan'` with no `apiEquivalentUsd`; summary
showed `Plan: Unknown · 3 records`.
Green: summary shows `Muse Code Max Usage subscription: Unknown · 3 records`
with `API-Equivalent Cost: $0.03` beneath it. (The per-record cost amount is
Unknown because a subscription charges nothing per request; the equivalent
is the honest figure.)

## F23 — breakdown says `museCode / muse-wonder-full-1.0`

Cause: `MuseUsageDeltas` recorded the session standing model (`currentModel`,
from `session/start`) on every record — the same convention the Model API
path deliberately does NOT use (it records `body.model`, the sent model).
The wire's per-completion effective `modelId` only ever updated mutable
session state, so any request could also be renamed by a later model change.

Fix (as a class): each record carries that completion's own effective
`modelId`, falling back to the event and then the standing model only for
frames that predate it — mirroring the Model API's sent-model convention.

Red: records carried `muse-wonder-full-1.0`; models text showed it.
Green: records and models text show
`museCode / muse-wonder-full-1.0-contributor`.

One live request would confirm the exact spelling the CLI puts on the
wire's per-completion `modelId` for a contributor-tier request (expected:
`muse-wonder-full-1.0-contributor`, matching the CLI's durable
`model_completed.model`); see the lead re-run steps below.

## F24 — `usage daily --range today` prints the same day twice

Cause: `aggregateUsage` buckets `today` by hour, and the daily text section
(`src/core/usage/usageText.ts`) labelled every bucket with its calendar
day — one hour's 19 requests and another hour's 34 printed under two
identical "Oct 14, 2026" rows.

Fix (as a class): buckets that share a day name the hour that separates
them (`formatDateTime`), via existing strings only. Single-day ranges keep
one row per day.

Red: two identical day rows for one day's two hourly buckets.
Green: the two rows carry their hours.

## Surfaces

One shared journal, one aggregate, one text: the headless `usage`
commands, the ACP agent's usage path and the VS Code family's panel read
the same `UsagePageState` and `usageText`. The panel additionally names the
plan on its certainty rows (`KpiTiles` `plan` prop) and meter cards
(`LimitCard`) from the same stored meter; its breakdown table and daily
charts already keyed rows by model and timestamps.

### Lead's visual look (one small local look, no screenshots in-lane)

Per the owner's 2026-10-12 rule (no screenshot runs; a UI change gets one
small local look by the lead), no pictures were taken in any lane for this
change. Before release the lead looks once at the Account & usage page of
a metered Muse Code session, in one light and one dark theme:

- the cost section's certainty row reads the meter's plan name ("Muse Code
  Max Usage subscription") instead of the generic certainty label
  (`KpiTiles` `plan` prop, `src/webview/usage/KpiTiles.tsx:88-98);
- the limit card heading reads the same plan name instead of the provider
  id (`LimitCard`, `src/webview/usage/LimitsSection.tsx:104).

## Packed product (dist/acp.js)

Fixtures: 3 old-shape records (input/output only, standing model,
elapsed durations 0/2,400,000/4,200,000 ms, limit without plan) and 3
new-shape records (per-completion cached/reasoning, 30/40/50 s durations,
`-contributor` model, limit with the meter plan), each written by the
tree's own real `createUsageRecord` under a fixture `XDG_DATA_HOME`.

Before (base 898a26c5e `dist/acp.js`, old-shape journal) —
`usage summary`:

> Cached Input: Unknown … Reasoning Tokens: Unknown … Total Cost:
> Unknown … Cache Hit Rate: Unknown … Total Request Time: 6,600s …
> Median Latency (p50): 128s … P95 Latency: 128s … Plan: Unknown ·
> 3 records … museCode: As of …

`usage models`: `museCode / muse-wonder-full-1.0: Unknown · …`.
`usage daily --range today`: `Oct 14, 2026: …` three times, identical.

After (this lane's `dist/acp.js`, new-shape journal) — `usage summary`:

> Cached Input: 2,850,000 … Reasoning Tokens: 348 … Cache Hit Rate:
> 95% … Total Request Time: 120s … Median Latency (p50): 64s … P95
> Latency: 64s … Muse Code Max Usage subscription: Unknown · 3 records
> … API-Equivalent Cost: $0.03 … Muse Code Max Usage subscription: As
> of Oct 14, 2026, 11:43 AM …

`usage models`: `museCode / muse-wonder-full-1.0-contributor: Unknown ·
3,000,000 / 30,000 · 3 requests`. `usage daily --range today`:

> Oct 14, 2026, 9:00 AM: … · 1 request … Oct 14, 2026, 10:00 AM: … ·
> 1 request … Oct 14, 2026, 11:00 AM: … · 1 request

Note: the base `npm run build` in the scratch worktree stops at
`check-bundle-split` ("pageWorker.js no longer carries …") because its
`node_modules` is a symlink to this lane's install; the bundles it did
build (`dist/acp.js`, `dist/usageService.js`) are what the red drill ran.

## Gates and suites

- `npm run typecheck`: exit 0 (host, webview, unit, e2e, integration).
- `npm run build`: exit 0; extension 552.5 KiB / 600, Model API
  507.2 KiB / 525 — caps untouched.
- New `test/unit/usageTruth.test.ts`: red 5/5 before the fix (durations
  came out `[0, 2400000, 4200000]`; plan cost had no equivalent; breakdown
  showed the standing model), green 5/5 after.
- Extended pure suites green: `mapNotification` (40), `journalRecord`
  (12), `insights` (14), `usage` (9).
- Dependents (`vitest related` over the five touched non-hub modules):
  388 files / 10,881 tests green; 5 red files, each measured:
  - `usageCompanionChunks`: Chrome never starts here — `Socket path too
long` under this lane's deep TMPDIR (environmental; lead runs it).
  - `deferredBundles` RVM115U5 diet: fixed in-lane by the sanctioned
    exact-pin move 519,354 → 519,386 (+32 B of intended shared tier
    arithmetic; D6 cap unchanged), green solo.
  - `museUsageDeltas` (1 test): fake-based suite asserting the exact
    limit call; the intended new `plan` field fails it. Untouched per the
    owner's testing rules; named here for the lead/TESTCUT.
  - `usageIntegration` (1 timeout) and `usageRollup` (timeouts): fail
    identically on the untouched base worktree in the same conditions
    (measured, same rig/load/command) — load, not this change; both
    suites are fake-based/heavy and were left untouched.
- Fallback paths (no new-guard drill beyond the red/green runs: each is
  pinned by a dedicated case): legacy frames without `usage` keep the
  cumulative-delta path (`mapNotification.test.ts` legacy case);
  unpriced unsuffixed models keep plan-without-equivalent
  (`journalRecord.test.ts`); meters without a plan keep the generic label
  (`usage.test.ts` `planDisplayName` cases).

## Lead re-run (real life, needs one provider request)

1. On any machine with the Muse Code CLI signed in, run this build's
   `muse-spark-code-acp exec` (or the extension) for a turn on the
   contributor tier, then `usage summary`, `usage models`,
   `usage daily --range today` against that history.
2. Expect: cached input / reasoning / hit rate shown; request time near the
   turn's own duration; plan row named by the meter with an equivalent
   price; models breakdown at the `-contributor` id.
3. Confirm on the wire that the turn's `session/tokenUsage` frames carry
   `modelId: "muse-wonder-full-1.0-contributor"` (or the tier used) — this
   is the one spelling this lane could not capture without a model call.

## PR167ROOM — activation budget (Sat Oct 17, 2026, lane PR167ROOM)

Hosted CI run 38915744271 failed only
`test/unit/modelsActivationBudget.test.ts:100`
(`Activation baseline=561352 current=566025 growth=4673`, cap 3072).
The 3072 cap, the baseline and the test stand unchanged.

- Cause: PR 167's live journaling code rode the activation bundle
  (`dist/extension.js`). Measured marginal minified bytes over main-now
  (scratch worktrees, gate's own build, repo default timeout):
  MuseCodeHost additions 1185 (of which the completion path 1128, the
  limit-input extraction 57), mapNotification additions 719 (mapping 383,
  wire schema 336), all other touched modules combined ~126
  (tree-shaken report code). Total 2030; headroom was 429; cut needed 1601. Main-now alone: `current=563995 growth=2643` (passes).
- Fix: `MuseUsageDeltas` and `museCodeLimitInput` move verbatim from
  `src/core/backends/musecode/MuseCodeHost.ts` to
  `src/core/backends/musecode/usageDeltas.ts` (no value imports, only
  types), served by the existing deferred `dist/usageService.js` chunk:
  re-exported from `src/runtime/usage/usageServiceEntry.ts`, listed in
  that chunk's `DEFERRED` files, loaded through `requireFile` on the
  first session via `MuseCodeHost.usageNotesLoader` (set once in
  `src/extension.ts` beside `usageRecording`, guarded inline like
  `isUsageInsightsBundle`). Activation keeps only the loader seam; the
  recording interface is unchanged, so journal timing and content are
  unchanged. No person-visible behavior changed: no CHANGELOG line.
- Red: gate fails without the fix (`growth=4673`); the new
  `test/unit/usageNotesBundle.test.ts` fails when the entry re-export is
  broken (`built usageService.js lacks the usage writers`, restored
  byte-exact); `npm run build` fails a deferred file missing from its
  chunk (`no longer carries`) or present in activation.
- Green: gate prints
  `Activation baseline=561352 current=564168 growth=2816` (margin 256).
  New suite journals one completion and shapes one meter reading through
  the built chunk into a real store (2 tests). usageTruth 9/9,
  mapNotification/usage/usageContracts 63/63, related suites green.
  `dist/usageService.js` 95.7 KiB of its 100 KiB cap.
  Packed-product drill (throwaway, removed after the run): the production
  `dist/usageService.js` required like `src/extension.ts` requires it
  serves working writers and the journaled completion reads back.
  `npm run package` itself is blocked on this rig for every tree
  (`native/linux/arm64/muse-created` is not in-tree; x64 only).
- Gates on the final tree, each with its exit code: prettier 0, eslint
  (zero warnings) 0, typecheck (all five projects) 0, knip 0, cycles 0,
  duplication 0, check:l10n 0, check:reference 0, check:plan 0,
  `npm run build` (incl. bundle-split) 0, security:sast (533 rules,
  0 findings) 0, security:audit 0.
- Full unit suite: exit 1 under rig load 22-26, itemized, nothing
  hidden. Mid-run an external process deleted 170 tracked test files
  from this worktree (fake-test profile; commits and index intact);
  restored byte-exact from HEAD and every affected suite re-run. After
  the restore: all usage/activation suites green; the remaining red is
  (a) 5 s-deadline timeouts in browser/palette/KDF/native-build suites
  and throughput floors, three of them (cyclesRoots, vault/scrub,
  browserUiText) re-measured failing identically on the untouched base
  under the same load, the rest passing solo on this tree;
  (b) importHookSources, flaky in pairs on both trees (fails on base
  too); (c) four live e2e files, which skip without provider
  credentials by design. Nothing red is in code this lane touched.
