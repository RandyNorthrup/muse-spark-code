# M107 J — Journal and the usage page

## FIXM107J review repairs (2026-10-06, Kubuntu)

The repair brief supersedes the original shared-document handoff below: PLAN
and CHANGELOG now record the review fixes directly. No review finding is
accepted as residual. Verification remains scoped under the rig's explicit
full-quality prohibition; no timeout override, merge, push, dependency or
paid/live call.

**P2-1 fixed.** A read-time flush now appends a copied cumulative minute
snapshot without closing its bucket or clearing its readings. Final accounting
uses the same bucket and birth-bound local tree identity's CPU high-water
baseline. Segment timestamp plus local tree identity identifies the accounting
bucket; neither tree identity nor paths leave the collector. The aggregate
merges cumulative snapshots by stable segment timestamp before summing work,
so duplicate snapshots are idempotent and a final sample cannot replace a
known chart interval with an unknown reading. Threshold changes and minute
rollover still close the previous segment.

Regression `merges a read-time flush and same-timestamp final tree accounting
into one known minute` failed on the review base (two rows instead of one),
then passed. It reproduces the review's 5000 ms / 80% CPU / 30% memory / 1→2
CPU-seconds case, repeated read flushes, duplicate snapshots, immutable earlier
appends, subsequent averaging and minute rollover. The complete collector
suite passes **16/16** at repository-default deadlines. All five typecheck
projects and scoped ESLint pass.

| Guard drill             | Named regression                                                                        | Red / restoration         |
| ----------------------- | --------------------------------------------------------------------------------------- | ------------------------- |
| `flush-keeps-minute`    | merges a read-time flush and same-timestamp final tree accounting into one known minute | exit 1; SHA-256 identical |
| `minute-snapshot-merge` | merges a read-time flush and same-timestamp final tree accounting into one known minute | exit 1; SHA-256 identical |

Source digests at these drills: collector
`800e5d94d3de1d314b4a9373935509c97bfe594b2fa2514898c77b9e7a233513`;
aggregate `6ae159fddfe2d886b941cc841fc8529d7dc379b71a3c3e695128fe9b8eef4db0`.
Logs and machine-readable receipts: ignored `temp/fixm107j/`.

**M107-J-M102-history-binding (existing integration residual).** Bind M102's
consent/retention/rollups and collector-scoped retained reads to this cumulative
snapshot contract, with atomic/idempotent append. The same segment timestamp
means the latest complete snapshot of that collector, not another CPU delta;
distinct collectors need M102's source scope before aggregation. Safe for now:
these components have no durable-journal or page/command mount on this base,
no private tree id is added to egress, and append failures remain retryable.
Follow-up: W/M102 joins the real store, tree retirement samples, shared usage
page, ACP/CLI text routes and absent help reference, then certifies the joined
full gates on all platforms. The W-owned stylesheet inventory update remains
the previously recorded shared-check handoff.

Implemented on the Kubuntu rig, 2026-10-06, branch `m107/j`. The lane brief
and shared rules authorize bounded implementation against lane 0 before M102
joins; they prohibit full quality, branch merges, push/rebase and paid/live
calls. No dependency or tool installation; no credential access. Model
attempts: **0**. Existing gates, deadlines, scopes and caps are unchanged. Planning follows
D87.11/M107 J and the brief's explicit injected-port dependency rule; no new
milestone scope. W owns shared PLAN/CHANGELOG/delivery regions, so their
updates are handed off here rather than committed over lane ownership.

## Delivered components

- `ResourceRecords` consumes existing governor samples and an injected
  verified-work source; it starts no sampler, child or network request.
  It averages known readings by minute, keeps the worst observed level and
  available-memory bucket, gates GPU/disk readings on their settings and
  preserves null separately from actual zero. A missing minute is not filled.
  Threshold changes start a new segment at the actual sample timestamp.
- Tree CPU is accumulated as deltas of reported lifetime counters, starting
  with the first reported total. Unknown readings preserve the baseline;
  decreasing counters do not double count. Reclassification preserves the
  baseline, while a new birth identity starts a new baseline. Per-kind peak
  memory is the highest simultaneous sum of observed resident bytes.
- Serialized appends retain a rejected record for retry and report the
  failure. The next operation retries before admitting more data. Caller
  objects are copied before queueing, invalid batches fail before accounting
  changes, stale samples and duplicate trees are refused. Flush is explicit
  before history reads and clean shutdown.
- Only strict `ResourceRecord` objects reach the append port. Tree identities,
  scope paths, commands, process names, session ids and environments never
  enter records, the aggregate, the page or the text summary.
- `aggregateResources` validates retained records, orders minutes/events and
  provides kind-specific event totals and harness totals. The shared strict
  `ResourceHistory` view is the bridge boundary for every editor.
- `ResourcesSection` draws CPU/memory against the recorded limits, a level
  band, gap-preserving step lines and accessible readings/events/work tables.
  `LazyResourcesSection` is the real dynamic-import boundary. The same
  aggregate feeds `usageResourcesText`; both label work as observed, rather
  than estimating missed trees or minutes. Seventeen new strings have real
  translations in all 14 UI tables and are read at execution/render time.

## Named integration handoffs

1. **M107-J-M102-journal.** Bind `ResourceRecordSink.append` to M102's
   existing journal consent, retention and rollups; include lane 0's
   `resourceRecordSchema` in its envelope. Bind retained reads to H's
   `ResourceHistoryPort`. No replacement store, envelope, consent or
   retention policy is invented here; M102 and D82's implementation/text are
   absent from this base.
2. **M107-J-C1-T-accounting.** Bind `ResourceRecordWorkSource.read` to only
   registered, OS-verified trees. Its snapshot must be complete; an
   unavailable enumeration throws, and an unavailable individual reading is
   null. Send each final available tree sample before unregistering it.
   Feed `sample` on the existing governor cadence and `event` from G's
   event subscription. Flush before reads and clean disposal, handling
   rejected appends through the host's existing error reporting.
3. **M107-J-M102-usage.** Merge the resource regions into M102's real
   `aggregate.ts`/`usageText.ts` and mount `LazyResourcesSection` in its
   UsageApp. Pass `aggregateResources(retainedRecords)` through the validated
   usage bridge. Use `usageResourcesText` for `/usage resources` and
   `usage resources`. Every VS Code-family/MHP/companion usage page uses the
   same React section; ACP/CLI use the same portable summary. No editor API
   or VS Code-only path appears in J's components.
4. **M107-J-W-delivery.** Install an independent 25 KiB optional-page budget
   and split guard for ResourcesSection during the M102 join; preserve the
   startup 900 KiB and existing deferred 50 KiB caps. Add help-reference
   entries for the Resources usage section and text summary (featureCatalog
   and its generator do not exist on this base), then update README/ACP/
   privacy/delivery docs with the actual bound behavior. No new command,
   setting or manifest contribution is shipped here, so adding unused
   package.nls entries would fail localization and is intentionally avoided.

Missing final tree samples or unavailable accounting can undercount observed
work. Journal appends that succeed and then throw require M102's existing
atomic/idempotent append guarantee; J can retry a rejected append, not infer
whether an external store committed it. No user-process accounting is read.

## Guard drills and verification

Each mutation ran the complete `resourceRecords.test.ts` with `--maxWorkers=3`
and no timeout override. The named regression failed (exit 1), then its source
was restored byte-exact and checked by SHA-256. Original failure logs and
machine-readable receipts stay in `temp/m107-j/drills/`.

| Drill | Named failing test | Restoration |
| ----- | ------------------ | ----------- |

| `minute-average` | averages known readings | SHA-256 identical |
| `unknown-zero` | keeps genuine zero separate | SHA-256 identical |
| `optional-unset` | keeps genuine zero separate | SHA-256 identical |
| `memory-floor-cap` | uses the capped memory floor | SHA-256 identical |
| `threshold-segment` | splits threshold changes | SHA-256 identical |
| `cpu-delta` | uses CPU deltas | SHA-256 identical |
| `cpu-baseline-reclassify` | preserves the baseline on reclassification | SHA-256 identical |
| `memory-peak` | uses CPU deltas | SHA-256 identical |
| `duplicate-average` | captures final work | SHA-256 identical |
| `stale-sample` | rejects stale samples | SHA-256 identical |
| `duplicate-tree` | rejects stale samples | SHA-256 identical |
| `private-pid` | never journals process identity | SHA-256 identical |
| `append-retry` | retains a failed minute append | SHA-256 identical |
| `worst-level` | averages known readings | SHA-256 identical |
| `aggregate-private` | refuses private/invalid retained input | SHA-256 identical |
| `event-count` | sorts records and sums deltas/events | SHA-256 identical |
| `aggregate-peak` | sorts records and sums deltas/events | SHA-256 identical |
| `aggregate-order` | sorts records and sums deltas/events | SHA-256 identical |

Restored source digests:

- `src/core/usage/resourceRecords.ts`: `af3c395752c4e00f3b92182118a07f609492ddcd62061cbb7b8f6f9cc5014973`
- `src/core/usage/aggregate.ts`: `bc2f8e30cf37451924ae81d7051d5b8821a35fa9e9bee5abb9190208c3c3631b`

Additional complete-file drills (the UI suite or production split suite as appropriate), all exit 1 with the named failure and SHA-256-identical restoration:

| Drill                 | Named failing test                              | Restoration       |
| --------------------- | ----------------------------------------------- | ----------------- |
| `disabled-collection` | flushes when disabled                           | SHA-256 identical |
| `caller-snapshot`     | serializes concurrent reads                     | SHA-256 identical |
| `source-unknown`      | serializes concurrent reads                     | SHA-256 identical |
| `chart-unknown`       | property: chart readings/limits                 | SHA-256 identical |
| `chart-gap`           | leaves chart and level gaps                     | SHA-256 identical |
| `chart-threshold`     | property: chart readings/limits                 | SHA-256 identical |
| `band-level`          | property: chart readings/limits                 | SHA-256 identical |
| `text-work`           | property: chart readings/limits                 | SHA-256 identical |
| `bridge-private`      | rejects private and invalid bridge              | SHA-256 identical |
| `runtime-locale`      | reads the installed locale                      | SHA-256 identical |
| `event-details`       | renders all event details                       | SHA-256 identical |
| `keyboard-scroll`     | provides accessible charts and data tables      | SHA-256 identical |
| `lazy-startup`        | keeps ResourcesSection in its own dynamic chunk | SHA-256 identical |
| `section-budget`      | holds the section and its CSS                   | SHA-256 identical |

Additional restored source digests:

- `src/core/usage/resourceRecords.ts`: `af3c395752c4e00f3b92182118a07f609492ddcd62061cbb7b8f6f9cc5014973`
- `src/webview/usage/ResourcesSection.tsx`: `0275ef16f1d3046b1e074068d7996c2083637cab3e673713f533bc9794bc9859`
- `src/core/usage/usageText.ts`: `a78e4a991d5d55344cb3bcda94ec5c029f9252a3169dca77221e288b22266437`
- `src/shared/resourceHistory.ts`: `bcf585cbc2b142a34c378e796ccad8a7c11c0c4aea50b30f8869961299cfd40e`
- `src/webview/usage/LazyResourcesSection.tsx`: `21573316acd79c56a36fa5f95e3974927d3454efe6a9c662d13735f6c0cb4b87`

Total successful source/test guard drills so far: **32**. All runs use repository-default deadlines and at most three workers; no test-name filter. The intentional extra PID drill fails the journal privacy regression.

## W-owned documentation handoff

Add this factual Unreleased entry when the integration documentation joins:

> Resource-history collection, aggregation and text-summary components, with
> minute averages, event totals and observed harness CPU/memory by kind.
> A lazy Resources usage-page section includes step charts, a level band and
> accessible tables, translated into all 14 languages. Journal, page mount
> and command bindings await M102 integration.

In PLAN's M107/gate/security regions, record the bounded checks below and
**M107-J-M102-history-binding**: the complete verified-work snapshot, final
sample before unregister, atomic/idempotent journal append, M102 consent/
retention/rollups/read, UsageApp and text-route bindings, the independent
25 KiB page chunk and help-reference entries. Missing final samples and
unknown trees can undercount observed totals; decreasing cumulative counters
retain a high-water baseline. No new command/setting/NLS contribution exists
until that join. Full quality and joined coverage remain W/lead's checks
under the explicit rig brief; no gate is waived or represented as green.

Final harness/localization drills (each complete owning file or localization gate, default deadlines):

| Drill                   | Named failing test/gate                  | Restoration       |
| ----------------------- | ---------------------------------------- | ----------------- |
| `harness-argument`      | rejects unsupported acceptance arguments | SHA-256 identical |
| `harness-real-entry`    | mounts the actual history harness        | SHA-256 identical |
| `missing-czech-history` | resourceHistoryEmpty: missing            | SHA-256 identical |

Restored harness/localization digests:

- `test/harness/resource-history-check.mjs`: `7f8b66e4c810a9671715287de493943d5a2c8f466a8b02566c2c9d92a8ded839`
- `test/harness/resource-history-entry.mjs`: `ff89b0bdcc8a82d01dc2d49a40c0b0722ff1c0215412a9f4c64c427933105fb3`
- `l10n/ui.cs.json`: `142e8d781c1500ac2511429a1ae8b1121342263b80fa757b19effe8b8dee35b2`

**35 distinct guards** have successful red/restored receipts. The final
Czech missing-key drill starts from the zero-problem translation tables and
fails only `resourceHistoryEmpty: missing`. The harness pair was repeated
on its final initializer; both tests fail and restore exactly. All receipt
logs remain under ignored `temp/m107-j/drills/`.

## First-piece verification

- All five `npm run typecheck` projects pass. Changed-source ESLint and
  stylesheet Stylelint pass with zero warnings. Changed-file Prettier passes.
- Complete collector/page/split suites pass **25/25** with the repository's
  default timeout. The actual harness suite passes **2/2** before its final
  initializer/drill; its final restored-tree run follows in the receipts.
- Plain Knip passes, with only the two unchanged vendor/axe configuration
  hints. Its first run identified the standalone harness files; actual-entry
  tests make their usage explicit without changing Knip entries/ignores.
  `JITI_FS_CACHE=0` disables only its filesystem cache to protect shared
  node_modules. Duplication passes: **zero clones**.
- Localization passes: **14 tables, 164 manifest strings, 640 source files,
  zero problems**. Czech/Polish thresholds use their natural distinct
  wording rather than new English allowances.
- Production build exits **0**, including every existing size, split,
  model-text, host-global and notices check (83 bundled packages).
  Activation **446.2/600 KiB**, Model API **449.4/475 KiB**, ACP
  **837.9/850 KiB**, checkpoint **77.3/225 KiB**, shared English
  **49.0/125 KiB**, webview startup **895.4/900 KiB**, existing deferred JS
  **49.7/50 KiB**. J adds roughly **0.6 KiB** to startup's English fallback;
  no UI execution code enters the shipping startup graph.
- The section is measured by compiling the actual main alongside the test
  usage entry with production charset/target/define/plugins. React, locale
  and existing schemas are shared. The source/metafile test proves the
  section stays outside both static startup closures, counting its entire
  deferred closure and CSS against an independent **25 KiB** target.
  This is an integration measurement, not an already shipped M102 mount.

**M107-J-W-host-inventory:** `npm run check:host-api` runs and exits 1 only
because W's generated record must add `src/webview/usage/ResourcesSection.css`
to the styles source list. All counts remain **336 VS Code APIs, 32 VS Code
importers, 26 Node built-ins and 61 theme variables**. No host API is added;
CSS reuses existing captured theme tokens, including `contrastBorder`.
The owner-only generated file is untouched; W regenerates/reviews it with
M102's actual page join. This is the one non-green shared check, not a
weakened gate or a claimed pass. Full quality/coverage is forbidden by the
brief and remains the lead's integrated qualification.

The work source must reuse T/C1's cached existing tree-sample cadence, rather
than starting another OS accounting cadence on each machine sample. J starts
no timers or probes; `sample`/`event` are explicit inputs to its port.

## Final receipts and local commits

Implementation commit **`e27a1f739c661d6eec26858d7263f608e0967c99`** used
normal hooks: staged ESLint/Prettier, Stylelint and redacted gitleaks pass;
**95.26 KB**, no leaks. The source was clean afterwards. No hook, Git
configuration, branch history or other lane's file was changed.

The final collector/page/split run passes **25/25**; the final actual
harness/split pair passes **4/4**, including the same two split tests.
Thus **27 distinct tests in four complete files pass**, with repository-default
Vitest deadlines and `--maxWorkers=3`, no test-name filter or timeout flag.
Cycles pass (**593 files, no cycles**). Final plain Knip passes with the
same two existing configuration hints. The final byte/hash audit matches
all **35 distinct guard receipts** to the committed source.

`node test/harness/resource-history-check.mjs` passes on final source:
**8 scenes**, four captured themes × 690/320 px. Every scene has zero axe
violations, page errors and horizontal page overflow. CPU/memory chart
values and the four level spans match the supplied view. Wide data tables
are named, keyboard-focusable scroll regions; the narrow page itself fits
its viewport. The final section plus CSS is **11,110 bytes / 10.85 KiB**,
below its independent 25 KiB target. No shipping cap changes.

Tracked receipts: [guard-receipts.json](m107-j/guard-receipts.json) and
[browser-results.json](m107-j/browser-results.json). Representative
screenshots were visually checked: [dark at 320 px](m107-j/dark-320.png)
and [light at 690 px](m107-j/light-690.png). Full eight-scene screenshots,
metafile and browser log stay under ignored `temp/m107-j/`.

The sole shared check left non-green is the exact W-owned stylesheet-source
inventory update described above. M102's absence and the four named journal,
accounting, page/text and delivery handoffs are preserved. No fake storage,
new command/setting, feature-catalog replacement, release claim, paid/live
call, push, merge or rebase. Full quality and aggregate coverage remain
with the integration lead under the brief.
