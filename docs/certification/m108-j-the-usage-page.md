# M108 J — The usage page

Worktree `/home/randy/lanes/M108J`, branch `m108/j`, Kubuntu, base
`291fc547a`. Read the rig brief, shared `codex/common.md`, AGENTS,
PLAN D88/M108, the account-terms research, and the lane 0/T/P policy and
certification records. No credentials, external network, paid/live calls, dependencies,
push, merge or rebase. The rig brief overrides the old shared merge and
remote-test instructions. Aggregate quality belongs to the lead.

## Scope and integration contracts, before implementation

This base has the lane-0 account/event schemas, K/T/P implementations and
`src/shared/usd.ts`. M95's registry, M102's journal, `aggregate.ts`,
`usageText.ts`, `UsageApp.tsx`, and the feature catalog are absent. J supplies
only its account aggregation, text renderer and React section. The normalized
journal source and local catalog are injected interfaces; no production fake,
file reader, guessed vendor wire shape or substitute usage application.

- **J-M102-JOURNAL:** adapt M102's validated records into J's credential-free
  record projection, preserving provider, opaque account (absent means
  `default`), timestamp, separate settled/reserved/uncertain USD, tokens and
  requests. Amounts are decimal strings or individually reported legacy
  numbers; never aggregate binary dollar values before this port. Read enough
  history for selected and configured local calendar periods. Honor the
  required `includeOutstanding: true` query: also return all still-unresolved
  reservations/uncertainty created before `end`, regardless of `start`. Return
  each current projection once, including claims inside the history range;
  released or settled claims have no outstanding amount. This is the same
  authoritative outstanding state T's admission reader must carry through a
  reset, not an unbounded scan or a sum of historical reservation events. The source
  returns P's canonical `AccountEvent` shapes, after its atomic swap/spread
  commit or stop append; J does not synthesize pool events.
- **J-M95-CATALOG:** inject local provider/account labels and thresholds from
  the registry. Deleted or unknown identities fall back to their opaque IDs.
  Labels are presentation only and never go back into journal records.
- **J-M106-LIMITS:** inject T's `AccountLimitsReader`, whose snapshots come
  from captured codecs. Unobserved configured limits show unavailable.
- **J-M102-W-MOUNT:** mount the section through a dynamic import on the usage
  page. Include its report in M102's validated bridge envelope and its text
  in M102's text summary. All shared/native/companion panels receive the same
  section; ACP/terminal/headless receive the same text through M102's ports.
  The lazy factory installs the caller’s UI table before reading the report.
  Omit this optional slice for an unconfigured single-key setup; mount it only
  for account configuration, multiple accounts or pool history. Existing
  single-model startup and behaviour remain unchanged.
  No editor-specific logic or dispatch is added here.
- **J-W-BUNDLE:** W owns build/size/split scripts. Give this section a separate
  lazy output and cap: measured size × 1.15, rounded up to 25 KiB. Existing
  startup/deferred caps stay unchanged. J will measure an isolated split
  build and prove its dynamic graph before handing off the entry. Load the
  emitted section stylesheet with that mount: esbuild's dynamic JavaScript
  import does not install its CSS. The standalone fixture explicitly links
  the generated stylesheet for its visual/accessibility checks.
- **J-W-DOCS-HELP:** W owns README/CHANGELOG/manifest/reference. Describe the
  usage page's account grouping, liability, threshold meters and swap/spread/
  stop history. Add the feature catalog entry when M102/M95's catalog lands;
  no new command or setting is introduced by J.

## Delivered and initial verification

`accountUsage.ts` validates a strict journal projection and local catalog,
resolves legacy records to `default`, and groups by provider **and** account.
It includes configured idle accounts and removed identities in event history.
USD is summed as integer nano-USD and returned as canonical decimal strings;
settled spend, reservations and uncertainty retain separate fields. Counts
reject overflow. The source range includes the observation millisecond, so a
new reservation or committed swap/stop appears in the immediate snapshot;
future records/events are excluded. Calendar period ends remain half-open. Thresholds use exact liability, floored USD caps, local day,
Monday week and calendar month, including skipped-midnight DST and leap months.

Plan windows and rate headroom use T's normalized captured-codec port, scoped
by both identities. Missing/expired snapshots have no zero usage or progress
bar. Headroom uses exact cross multiplication and the same precision/safe-count
refusal as T. Journal projections/events never accept labels or credentials.
Local labels, tokens, costs, meters and chronological canonical P events are
shared by `usageText.ts` and `AccountsSection.tsx`. Swaps name the re-read cost;
stops show their recorded trigger and its reset, not an inferred whole-pool
recovery. W's live stop notice must retain `AccountPoolStoppedError`'s computed
next eligible reset and vendor usage URL; the history event has no such fields.

`loadAccountsSection` is M102's React.lazy factory. The section owns its CSS,
uses accessible regions/progress names and exact value text, wraps long labels,
and renders labels as text. No host, credential, vendor codec or admission
code enters its browser graph. Ten new usage keys have real translations in
all 14 UI tables. No new manifest text, command, setting, dependency or escape
hatch; existing `package.nls*.json` tables remain unchanged and checked.

Initial direct Kubuntu runs: three complete unit files **19 passed**, bundle
file **1 passed**, repository-default deadlines and three workers. Unit project
typecheck, changed-source ESLint, CSS lint and Prettier pass. Localization:
**14 tables, 164 manifest strings, 610 source files, zero problems**. Final
restored verification and standalone theme measurements are recorded below.

## Executed red drills

All 44 mutations ran a complete owning test file with `--maxWorkers=3`, no
filter, skip or timeout override. Each exited 1 at the named test, then restored
its original bytes in `finally`; each SHA-256 comparison matched. Native DOM
query/matcher failures count as named test failures just as Vitest assertions
do. The private runner initially expected the latter error class only; it
restored and then rechecked both accessibility mutations by their named FAIL
records. No production fix or timeout change was needed for that runner check.
All drills were repeated on the final source after the observation-instant,
plan-percentage and lint-style repairs. The bundle fixture uses the production build's
automatic JSX mode.

The final precision regressions first failed on the existing implementation:
`28.1234567891` was reported as `28.12345679`, and `1e-8` percent was displayed
as `0%`. The repairs preserve plan values/thresholds and T's comparison, show
scientific fractions through the shared Intl helper, and retain its existing
whole-percent default and precision-specific formatter cache.

| Guard deliberately broken     | Named failing test                                                                                                | Owning file                   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| provider-account-isolation    | isolates provider and account identities, resolves legacy default locally and never writes labels                 | `accountUsage.test.ts`        |
| legacy-default                | isolates provider and account identities, resolves legacy default locally and never writes labels                 | `accountUsage.test.ts`        |
| local-label-resolution        | isolates provider and account identities, resolves legacy default locally and never writes labels                 | `accountUsage.test.ts`        |
| journal-field-validation      | rejects malformed records, labels or credentials in the journal, invalid clocks and duplicate catalogs            | `accountUsage.test.ts`        |
| ignored-row-money-validation  | rejects malformed records, labels or credentials in the journal, invalid clocks and duplicate catalogs            | `accountUsage.test.ts`        |
| exact-money-sum               | keeps exact nano-USD liability and safe counts across settlement, reservation and uncertainty                     | `accountUsage.test.ts`        |
| reserved-uncertain-liability  | keeps exact nano-USD liability and safe counts across settlement, reservation and uncertainty                     | `accountUsage.test.ts`        |
| count-overflow                | keeps exact nano-USD liability and safe counts across settlement, reservation and uncertainty                     | `accountUsage.test.ts`        |
| money-cap-floor               | keeps exact nano-USD liability and safe counts across settlement, reservation and uncertainty                     | `accountUsage.test.ts`        |
| threshold-equality            | includes configured idle accounts and removed event identities without inventing usage                            | `accountUsage.test.ts`        |
| period-history-isolation      | uses half-open local calendar periods for selected totals and each threshold meter                                | `accountUsage.test.ts`        |
| calendar-reset                | handles a week crossing a month, leap months and DST midnight normalization                                       | `accountUsage.test.ts`        |
| invalid-clock                 | rejects malformed records, labels or credentials in the journal, invalid clocks and duplicate catalogs            | `accountUsage.test.ts`        |
| duplicate-provider-catalog    | rejects malformed records, labels or credentials in the journal, invalid clocks and duplicate catalogs            | `accountUsage.test.ts`        |
| event-interval                | lists canonical committed swaps, spreads and stops chronologically in the selected interval                       | `accountUsage.test.ts`        |
| event-field-validation        | rejects malformed records, labels or credentials in the journal, invalid clocks and duplicate catalogs            | `accountUsage.test.ts`        |
| missing-live-window           | shows missing or expired live meters as unavailable, scoped by both identities                                    | `accountUsage.test.ts`        |
| expired-plan-window           | shows missing or expired live meters as unavailable, scoped by both identities                                    | `accountUsage.test.ts`        |
| expired-rate-bucket           | shows missing or expired live meters as unavailable, scoped by both identities                                    | `accountUsage.test.ts`        |
| plan-percentage-validation    | validates captured plan percentages and reset timestamps rather than displaying malformed snapshots               | `accountUsage.test.ts`        |
| plan-reset-validation         | validates captured plan percentages and reset timestamps rather than displaying malformed snapshots               | `accountUsage.test.ts`        |
| rate-bucket-validation        | uses exact headroom cross multiplication and rejects malformed normalized buckets                                 | `accountUsage.test.ts`        |
| rate-bucket-safe-limit        | uses exact headroom cross multiplication and rejects malformed normalized buckets                                 | `accountUsage.test.ts`        |
| remaining-within-limit        | uses exact headroom cross multiplication and rejects malformed normalized buckets                                 | `accountUsage.test.ts`        |
| headroom-cross-multiplication | uses exact headroom cross multiplication and rejects malformed normalized buckets                                 | `accountUsage.test.ts`        |
| headroom-percentage-precision | uses exact headroom cross multiplication and rejects malformed normalized buckets                                 | `accountUsage.test.ts`        |
| uncertain-cost-display        | shows settled spend, separate liability and tokens without binary dollar artifacts or rounding down               | `accountUsageText.test.ts`    |
| cold-cache-event-display      | explains every swap, spread and stop, including cold-cache cost and known or unknown reset                        | `accountUsageText.test.ts`    |
| installed-language-at-render  | reads installed strings, plurals, USD, percentages and dates at render time                                       | `accountUsageText.test.ts`    |
| meter-accessible-name         | gives every available meter an accessible name and exact text; unavailable meters have no misleading progress bar | `AccountsSection.test.tsx`    |
| meter-exact-accessible-value  | gives every available meter an accessible name and exact text; unavailable meters have no misleading progress bar | `AccountsSection.test.tsx`    |
| lazy-graph                    | keeps the section, formatting and USD arithmetic out of the caller static graph                                   | `accountUsageBundle.test.mjs` |
| lazy-size-budget              | keeps the section, formatting and USD arithmetic out of the caller static graph                                   | `accountUsageBundle.test.mjs` |
| observation-query-inclusive   | uses half-open local calendar periods for selected totals and each threshold meter                                | `accountUsage.test.ts`        |
| observation-record-inclusive  | includes reservations and committed events at the observation instant and excludes future data                    | `accountUsage.test.ts`        |
| observation-event-inclusive   | includes reservations and committed events at the observation instant and excludes future data                    | `accountUsage.test.ts`        |
| plan-value-precision          | preserves fractional plan percentages and matches admission without money quantization                            | `accountUsage.test.ts`        |
| plan-threshold-precision      | preserves fractional plan percentages and matches admission without money quantization                            | `accountUsage.test.ts`        |
| plan-comparison-precision     | preserves fractional plan percentages and matches admission without money quantization                            | `accountUsage.test.ts`        |
| plan-progress-below-threshold | preserves fractional plan percentages and matches admission without money quantization                            | `accountUsage.test.ts`        |
| scientific-percentage-format  | preserves fractional and scientific percentages while keeping the shared whole-percent default                    | `accountUsageText.test.ts`    |
| shared-percentage-precision   | preserves fractional and scientific percentages while keeping the shared whole-percent default                    | `accountUsageText.test.ts`    |
| shared-percentage-cache       | preserves fractional and scientific percentages while keeping the shared whole-percent default                    | `accountUsageText.test.ts`    |
| shared-percentage-default     | preserves fractional and scientific percentages while keeping the shared whole-percent default                    | `accountUsageText.test.ts`    |

| Restored source                              | SHA-256                                                            |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `src/core/usage/accountUsage.ts`             | `b8aa9cadabfea772793f0a4e91ef23a55c4f78264196735914e569a5cc802ed2` |
| `src/core/usage/usageText.ts`                | `63d6307ce2d7bceeef154d2523715588cea3861c43b5c21b5c9ce8c1a44975ca` |
| `src/webview/usage/AccountsSection.tsx`      | `c57e817ebed0989df12e884eea091003a287b9ff86b787a14e0334c01c628c8f` |
| `src/webview/usage/accountsSectionLoader.ts` | `4ca0df75ccdf8c15da95f7840ab65171078c6cb3050f0802c07cc1414744e910` |
| `src/shared/l10n/text.ts`                    | `41e5e2197b38628f76756d9f04ab7292e216c5ebfc7b406c4a595920c4199fcc` |

## Scoped browser and bundle certification

Standalone shared-section build served from local loopback in a fresh Chrome
profile; no owner profile, credentials, model or remote request. Uses the real
component/CSS, normalized fake report, installed Chrome and axe-core, with the
repository's captured VS Code light, dark, hc-dark and hc-light variables.
All eight combinations (each theme at 690 and 320 px) pass WCAG 2.0/2.1/2.2
A/AA with **zero violations**, color contrast included, and zero horizontal
overflow. Long local labels wrap; screenshots were visually inspected.

- [Dark section](m108-j-usage-dark.png)
- [320 px section](m108-j-usage-320.png)

The first scratch HTML pointed to the stdin build's diagnostic source name
instead of its actual `stdin.js` output. Its ordinary 30 s browser deadline
failed; fixing the fixture asset path produced the eight successful checks.
No timeout was raised and no shipped source changed for that fixture fix.

An isolated split caller shares its already-eager React/locale dependencies.
J's deferred JavaScript is **9,572 bytes / 9.348 KiB**, with **299 bytes** of
section CSS. `(9572 + 299) / 1024 × 1.15`, rounded up to a 25 KiB multiple,
gives an independent **25 KiB** cap. The test enforces that cap and proves the
component/formatters/USD helpers are absent from the caller's static graph;
no aggregation, admission or host code enters the section graph. Both graph
and size guards fired red. This measures the supplied seam; W must certify
its actual M102 mount and independently budgeted cohort, retaining all old
caps. Existing installed graphs gain no J loader or section on this base.

## Verification handoff

Final review repair within J's meter/text scope: plan percentages must retain
their captured numeric precision rather than be quantized as nano-USD. Compare
them exactly as T does, retain their decimal strings, and use the existing
shared Intl `formatPercent` helper with optional fractional precision. Existing
callers keep its zero-digit default. `src/shared/l10n/text.ts` has no assigned
owner in M108's lanes table; this small required formatter extension avoids a
local replacement of the mandated helper. No new feature, setting or gate.

Dead-code analysis passes (the same two existing configuration hints).
Duplication analysis passes with **zero clones**, unchanged zero threshold.
All five TypeScript projects passed after the percentage repair; the touched
host and unit projects passed again after the final lint-style edit. No aggregate quality,
full coverage/unit, installed editor or live calls: the rig brief assigns the
full gate and missing installed bindings to W/the lead. No source or gate
owned by another implementation lane is changed; shared string additions are
explicitly authorized by this brief. PLAN/README/CHANGELOG/manifest/catalog,
build/split/size scripts and bridge wiring remain named W handoffs above.

## Final restored completion receipt

All checks ran directly on Kubuntu in this worktree, serially with one heavy
tool at a time. No test timeout override, filtered test, skip, install, changed
gate, full coverage/quality run, live call or editor-specific implementation.
The final lint failures (a preferred ternary and a redundant test non-null
assertion) were fixed without suppression; all 44 drills were repeated and
restoration hashes rechecked afterward.

| Check                                                                                                                                | Result                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `npx vitest run test/unit/accountUsage.test.ts test/unit/accountUsageText.test.ts test/unit/AccountsSection.test.tsx --maxWorkers=3` | 22 passed; default deadlines                                                           |
| `npx vitest run test/unit/accountUsageBundle.test.mjs --maxWorkers=3`                                                                | 1 passed; default deadlines                                                            |
| Complete `accountUsage.test.ts`, `TZ=America/Santiago` and `TZ=America/New_York`, three workers                                      | 13 passed in each; default deadlines                                                   |
| `npm run typecheck`                                                                                                                  | All five projects passed after percentage repair                                       |
| `npm run typecheck:host`, `npm run typecheck:unit`                                                                                   | Both passed again on final restored source                                             |
| Changed TS/TSX/MJS ESLint, Prettier, section stylelint, `git diff --check`                                                           | Exit 0                                                                                 |
| `npm run deadcode`, `npx jscpd`                                                                                                      | Exit 0; two existing config hints, zero clones                                         |
| `node scripts/check-l10n.mjs`                                                                                                        | Exit 0; 14 tables, 164 manifest strings, 610 source files, zero problems               |
| `node scripts/check-host-api.mjs`                                                                                                    | Exit 1; exact W-owned record update below                                              |
| `npm run build`                                                                                                                      | Exit 0; all unchanged size/split/global/notice guards pass; 83 bundled-package notices |
| Standalone real section, Chrome + axe, four captured themes × two widths                                                             | Eight passes, zero WCAG/contrast violations, zero horizontal overflow                  |
| Deliberately broken guards                                                                                                           | 44 named failures, all restored byte-exact, final hashes matched                       |

**J-W-HOST-API-RECORD:** regenerate/review W's existing
`docs/ide-compatibility/host-api.md`. The executed gate prints exactly two
changes: inherited P's `node:crypto` count **46 → 47**, already recorded on the
base, and `src/webview/usage/AccountsSection.css` in the existing theme-variable
source list. Theme variables stay **61**; the source still uses **332** VS Code
APIs, **31** files importing VS Code, and **25** Node built-ins. J adds no host
API/import or theme-variable count. W's generated record is left untouched.
This remains a gate failure until W makes the documented update; no claim that
the aggregate quality gate is green.

| Production graph                 | Measured KiB |  Unchanged cap KiB |
| -------------------------------- | -----------: | -----------------: |
| Extension activation             |        440.3 |                600 |
| Model API                        |        450.1 |                475 |
| Checkpoint store                 |         76.9 |                225 |
| Main webview with static imports |        897.7 |                900 |
| Existing webview deferred cohort |         49.7 |                 50 |
| ACP                              |        818.6 |                850 |
| J's isolated deferred section JS |        9.348 | 25 independent cap |

The initial implementation is committed as `3e6497bfd` with repository hooks
on: staged ESLint/Prettier/stylelint and gitleaks all passed, no leaks. The final
percentage repair and this receipt are committed with the same unmodified hooks.
All work remains local for the lead; no push, merge or rebase. W's named M95/M102,
mount/CSS/budget, help/reference/docs and host-record bindings remain explicit
integration work, rather than installed product support on this base.

## Final review repair — FIXM108J (2026-10-06, Kubuntu)

Read `M108J.rig.md`, shared `codex/common.md` and the complete RVM108J report.
The sole finding, **RVM108J-P2-CALENDAR-LIABILITY**, is fixed within J's source,
tests and this record. No P1/P3 or review residual remains. The rig override
requires direct checks and forbids a merge/full quality run; hooks and every
existing guard remain unchanged. PLAN D88/M108 already covers this correction;
there is no new scope or residual requiring a PLAN §9 entry.

`AccountUsageSource.records` now explicitly requests `includeOutstanding:
true`: bounded settled history plus every current unresolved claim before
the observation cutoff, each once. Grouping retains older claims under their
own provider/account (legacy `default` included). `totalsFor` sums reserved
and uncertain nano-USD before applying the start boundary to settled spend,
tokens and requests. Future rows remain excluded. The selected summary and
all day/week/month spend meters therefore retain the same outstanding
liability as admission, even after a reset. W must honor this required query
when binding the already-named **J-M102-JOURNAL** port; no production journal
adapter exists on this base.

The new aggregation regression first failed on the original source with
liability `0.300000001` instead of `1.300000001` and reservation `0.2` instead
of `1.2`. It exercises each claim kind at midnight, across a week/month reset,
across New Year, and older than the earliest queried period. It compares all
spend meters with T's admission evaluator, checks exact summaries and counts,
isolates other providers/accounts and removed identities, excludes future
data, and releases the claim without duplicate current-period liability.
The existing calendar-history fixture now explicitly marks its old settled
row's outstanding amounts as zero.

The two additional end-to-end text/component regressions failed on the old
source too: they observed zero liability instead of carried `$1` reservation
and `$2` uncertainty. Their initial assertions mistakenly expected four
fraction digits for whole-dollar amounts; corrected to the existing formatter's
two-digit output, with no formatter or product change. The final assertions
require the carried summary, reached status and accessible full spend meter.

No strings, dependencies, manifests, settings, commands, paid behaviour,
admission code or browser graph change. W still owns the existing installed
bindings, README/CHANGELOG/help and host API record handoffs above; this shared
aggregation correction reaches every editor and ACP/headless text surface
through those same ports.

### Repair regression and red-drill receipts

Each drill ran all three complete owning test files with `--maxWorkers=3`,
repository-default deadlines, no test-name filter or skip, and exited 1.
Restoration in `finally` matched SHA-256 after every mutation:
`507a659c3b3f838fdcb5bb21017f15fa6e3737a05c49665b0a7c6f6dfc7fb005`.

| Broken guard                                                    | Named failing regression                                                                                                                                                                                                                                                                     | Result                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `outstanding-query`: send `includeOutstanding: false`           | `carries outstanding liability across calendar resets and matches admission without counting old settlements or duplicating current claims` (`accountUsage.test.ts`)                                                                                                                         | Exit 1; restored byte-exact                                     |
| `outstanding-grouping`: drop claims before history start        | Same aggregation regression; `shows carried reservations and uncertain liability after a reset while settled spend stays in its period` (`accountUsageText.test.ts`); `keeps carried liability visible in the summary and accessible spend meter after a reset` (`AccountsSection.test.tsx`) | Exit 1; all three named regressions failed; restored byte-exact |
| `outstanding-totals`: discard the whole row before period start | Same three named regressions                                                                                                                                                                                                                                                                 | Exit 1; all three failed; restored byte-exact                   |

Restored-source verification before the repair commit: all five TypeScript
projects pass; changed-source ESLint and Prettier pass. Final complete
`accountUsage.test.ts`, `accountUsageText.test.ts` and `AccountsSection.test.tsx`
run: **25 passed**. Separate complete `accountUsageBundle.test.mjs`: **1 passed**,
including its unchanged 25 KiB cap and lazy graph guard. Both final runs used
the repository's default deadlines and three workers on Kubuntu.

### Repair completion receipt

Repair commit **`1cb94ece3`** ran the unmodified repository hooks:
lint-staged's ESLint/Prettier and staged gitleaks passed, with zero leaks.
The committed source hash still matches the restoration receipt above.
Heavy tools ran serially; independent formatting/localization/host-record
checks were batched. No dependency install, full quality/coverage run, paid
or live call, push, merge, rebase, timeout override or weakened gate.

| Final check                                                                    | Result                                                                                     |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| All four complete J test files, in batches of at most three files/workers      | 26 passed; default deadlines; restored source                                              |
| `npm run typecheck`                                                            | All five projects passed                                                                   |
| Changed TS/TSX ESLint; changed-file `npx prettier --check`; `git diff --check` | Exit 0                                                                                     |
| `npm run deadcode`; `npx jscpd`                                                | Exit 0; same two configuration hints; zero clones                                          |
| `npm run check:l10n`                                                           | Exit 0; 14 tables, 164 manifest strings, 610 source files; zero problems                   |
| `npm run check:host-api`                                                       | Exit 1; exactly the existing **J-W-HOST-API-RECORD** handoff, unchanged by this repair     |
| `npm run build`                                                                | Exit 0; all existing budgets/split/global/notice guards passed; 83 bundled-package notices |
| Three deliberate guard-break drills                                            | Each exited 1 at a named regression; every restoration hash matched                        |

Production KiB/cap remains: activation **440.3/600**, Model API **450.1/475**,
checkpoint store **76.9/225**, webview plus static imports **897.7/900**,
existing deferred webview **49.7/50**, ACP **818.6/850**. The J bundle test
still enforces its independent 25 KiB cap. The host record still needs only
`node:crypto` **46 → 47** and `AccountsSection.css` added to its theme-source
list; API/import/built-in/theme counts remain **332/31/25/61**. That W-owned
record stays untouched, and aggregate quality is not claimed green.
