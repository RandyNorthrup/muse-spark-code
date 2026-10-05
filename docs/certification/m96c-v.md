# M96c lane V — Traffic and runners

## RVM96CV repair lane (2026-10-05)

Worktree `/Users/randy/lanes/FIXM96CV`, branch `m96c/vfix`, macmini.
The rig brief overrides the shared merge instruction: local commits with
hooks only; no merges, rebases, pushes, live calls or paid calls. It also
assigns the full quality gate to the lead and limits each owned vitest run
to three files and three workers.

Both P2 findings are fixed. Queue aggregation replays task transitions
before entry/agent scoping, clears the prior queue and ready-wait state on
reassignment, and attributes subsequent ready/start events to the new attempt.
Usage and event counters retain their original participant attribution.
Runner setup commands use a textarea and are saved without trimming, so
existing newlines and surrounding whitespace survive untouched saves.

| Finding                  | Regression test                                                                           | Deliberate red drill                                     |
| ------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| P2 phantom old queue     | `drains the old assignment and follows reassigned attempts across entry and agent scopes` | Keep the old queue on reassignment                       |
| P2 replay before scoping | `replays another entry’s attempt transitions before scoping the queue`                    | Filter transitions before replay                         |
| P2 multiline setup loss  | `preserves an existing multiline setup command when saving untouched fields`              | Replace the textarea with an input; trim the saved setup |

The original metrics and form each failed their regression before the fix.
Every drill ran the whole owned test file, produced the named failure, and
restored production bytes with equal before/restored SHA-256 values.
Receipt: `m96c-v-review-drills.json`. Initial P2 validation: owned unit tests,
unit-project typecheck, changed-file ESLint, Traffic CSS Stylelint and
Prettier passed. Final combined counts and checks are recorded below after
the P1 repair. X2's suggested Unreleased repair bullet: “Traffic actions
refuse changed targets; reassignment clears old queue metrics; runner edits
preserve multiline setup commands.” No new command, setting or script.

Worktree `/Users/randy/lanes/M96CV`, branch `m96c/v`, macmini rig.
Plan of record: PLAN.md D75 and M96c, research `m96-research.md` §8,
lane 0c contracts and `m96c-0c.md`. Owner defaults-on ruling applies.
No model calls, paid calls, credentials, pushes, merges or rebases.

## Metrics piece

`src/core/team/trafficMetrics.ts` reads final deduplicated ledger tasks,
scheduler events and piecewise slot observations through an injected input
contract. Reviews and merge-conflict accounting events are explicit ledger
adapter observations, not guessed MSP/ACP fields. All attempts belong in
`attempts`. Separate
review charges belong in `reviews`, linked to their owning attempt and
deduplicated by the adapter; primary usage excludes those separate charges.
An unresolved review reference throws. Reviews retain their own accuracy,
so a reported paid review of an estimated attempt stays reported.
Cached input/reasoning are subsets, not
additional tokens. Cost totals include merged changes only, retaining
reported and estimated amounts separately. Local periods use calendar
midnight and Monday; utilisation clips intervals at the period boundary.
The most recent bounded queue samples are shown; aggregation uses all rows.

Initial metrics-commit validation on macmini: `trafficMetrics.test.ts`,
4 tests passed;
ESLint on metrics and its tests passed. Full quality belongs to the lead/X2
under the brief's explicit shared-rig rule.

Eight red drills ran the whole focused test file. Each produced a named
assertion failure and restored the production file byte-exact with SHA-256
comparison. Receipts: `m96c-v-metric-drills.json`.

| Drill                        | Named test that failed                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| Start wait at submission     | matches hand-computed utilisation, ready wait, queues, conflicts, rework and merged costs           |
| Ignore impossible capacity   | keeps missing samples null and refuses impossible capacity                                          |
| Swap reported and estimated  | matches hand-computed utilisation, ready wait, queues, conflicts, rework and merged costs           |
| Count cached/reasoning twice | matches hand-computed utilisation, ready wait, queues, conflicts, rework and merged costs           |
| Include nonmerged cost       | matches hand-computed utilisation, ready wait, queues, conflicts, rework and merged costs           |
| Ignore entry attribution     | attributes every matching attempt separately without counting nonmerged cost or token subsets twice |
| Ignore period clipping       | matches hand-computed utilisation, ready wait, queues, conflicts, rework and merged costs           |
| Keep finished task queued    | matches hand-computed utilisation, ready wait, queues, conflicts, rework and merged costs           |

## Integration boundaries

This base contains 0c, but no M95 panel framework or M96 scheduler, leases,
merge queue, runners or Agent-map team tabs. Lane V provides explicit
validated projections and injected handler dependencies. X2 must wire the
same lazy Traffic view into both Agent maps, register Runners, and compose
the namespaces into the existing message parser. S/C/Q/O must supply the
real observations/actions; test and accessibility-harness fakes live only
under `test/**`. No production placeholder backend is supplied.

## Adapter contract for integration

- The host framework calls `handleTrafficMessage` / `handleRunnersMessage`
  only on these namespaces; it composes their strict schemas into its main
  postMessage union. The `traffic/state` and `runners/state` envelopes are
  parsed by the panel's receiver before replacing the owned state slices.
- `TrafficPanelDependencies` is injected by the lazy team adapter. Its
  snapshot methods project S's board/ranks/action availability, C's leases
  and conflicts, K's fresh hints and recovery observations, Q's queue,
  journal and copy sizes, and O's runners/health. No scheduler or runner
  fake lives in `src/**`.
- Action lists are authoritative availability, including retirement's
  free-slot/singleton check for **Hand off anyway**. They must change when
  admission changes. The handler checks workspace/window, attempt and
  availability before dispatch and after a confirmation; dispatch repeats
  the core admission after any further waits. Paid dispatch remains behind
  the existing shared-budget/price consent gate, under the owner's ruling.
- Possibly live journals cannot resume/discard/recover/stop through this
  handler. **New task** is a read-only snapshot of the old task; **Take over**
  requires a host confirmation. **Recover** is unavailable while the
  landing's lock is present. There is no lock-removal message or button.
  The adapter must never infer `ownerMayBeLive: false` from stale hints,
  endpoint timeouts or a PID guess; K supplies its actual local lifetime
  evidence. The confirmation callback must present the action's current
  warning, including uncertain process identity for orphan **Stop**.
- The two Agent maps call `createTrafficView(loader)` once, outside React
  render, with the same surface. The loader returns its separate module
  with shared React and installed UI-text state (ESM splitting, or the
  panel’s equivalent). A separately bundled table must instead be installed
  with the caller’s current language before the first surface render.
  Load `traffic.css` with the separate surface; its test ESM build emits
  CSS separately. The current production IIFE build would inline a static
  dynamic import;
  it must not be used as the loader. The factory imports no surface and
  does not call its loader in single-model mode. Pass the panel's existing
  polite announcer to avoid a second live region; without it, standalone
  rendering uses one local polite region. History events on mount are not
  replayed; only new landed/returned event ids announce.
- Metrics slot samples are disjoint groups for a selected role/entry/agent.
  Capacity includes held slots while a lowered cap drains existing workers.
  Queued entry/agent attribution needs the corresponding ledger attempt;
  unassigned tasks appear in the role scope. The panel metric adds
  `taskCount` to 0c’s writing count so rework is divided by all submitted
  tasks, including read-only tasks. Queue events follow their own attempt.
  Task/attempt updates and accounting events are deduplicated by the ledger
  adapter. `reviewRound`, `mergeConflict` and `finished` are explicit
  accounting observations from that adapter. Costs include every attempt
  and review of each merged change; cached input and reasoning are subsets.

X2 owns README/CHANGELOG and production build/message/section wiring.
Suggested Unreleased bullet: “Added the lazy team Traffic board, lanes,
leases, advisory window hints, crash recovery, conflicts, merge queue and
local metrics, plus user-configured runners with validated actions.”
No new command/setting/package script or dependency is introduced by V.

## Traffic, runners and final metric guard drills

63 additional drills ran whole owned test files, without filtering or skips.
Every recorded red result names a failed test and has equal before/restored
SHA-256 values. Together with the first eight metric drills, this is 71.
`m96c-v-drills.json` records the exact mutations and failures. The future-task
probe first removed only its source filter and stayed green: the independent
period filter still protected the result. Removing both filters produced the
recorded failure; the production file's bytes were restored after each probe.

| Guard deliberately broken                    | Named test that failed                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| workspace scope                              | refuses unknown fields, foreign windows, stale attempts and unavailable handoffs                         |
| window scope                                 | refuses unknown fields, foreign windows, stale attempts and unavailable handoffs                         |
| current attempt                              | refuses unknown fields, foreign windows, stale attempts and unavailable handoffs                         |
| task action availability                     | refuses unknown fields, foreign windows, stale attempts and unavailable handoffs                         |
| priority value required                      | routes priority and same-role entry choices, conflicts and queue actions                                 |
| same role reassignment                       | routes priority and same-role entry choices, conflicts and queue actions                                 |
| known peer only                              | offers other windows only opening, never stopping or releasing their work                                |
| resource action availability                 | refuses actions withdrawn from a resource, conflict or recovery row                                      |
| recovery action availability                 | refuses actions withdrawn from a resource, conflict or recovery row                                      |
| live recovery owner                          | preserves possibly live owners, held locks and unmerged copies; permits explicit takeover                |
| held recovery lock                           | preserves possibly live owners, held locks and unmerged copies; permits explicit takeover                |
| conflict action availability                 | refuses actions withdrawn from a resource, conflict or recovery row                                      |
| merge action availability                    | confirms retirement, orphan stop and discard, and refuses withdrawn merge actions                        |
| cleanup merged or discarded only             | preserves possibly live owners, held locks and unmerged copies; permits explicit takeover                |
| retirement confirmation                      | confirms retirement, orphan stop and discard, and refuses withdrawn merge actions                        |
| uncertain release confirmation               | asks for every landing, without-checks landing and uncertain release, and rechecks after the card        |
| recovery confirmation                        | confirms retirement, orphan stop and discard, and refuses withdrawn merge actions                        |
| landing confirmation                         | asks for every landing, without-checks landing and uncertain release, and rechecks after the card        |
| denied confirmation                          | asks for every landing, without-checks landing and uncertain release, and rechecks after the card        |
| state after confirmation                     | asks for every landing, without-checks landing and uncertain release, and rechecks after the card        |
| runner restricted mode                       | refuses tests in Restricted Mode or for unknown runners; routes user saves and removal                   |
| runner known id                              | refuses tests in Restricted Mode or for unknown runners; routes user saves and removal                   |
| strict messages and envelopes                | validates host envelopes and bounds projections, fits, positions and counts                              |
| bounded history projections                  | validates host envelopes and bounds projections, fits, positions and counts                              |
| bounded path projections                     | validates host envelopes and bounds projections, fits, positions and counts                              |
| nonnegative projection counts                | validates host envelopes and bounds projections, fits, positions and counts                              |
| bounded fit                                  | validates host envelopes and bounds projections, fits, positions and counts                              |
| one based queue position                     | validates host envelopes and bounds projections, fits, positions and counts                              |
| bounded runner health                        | validates host envelopes and bounds projections, fits, positions and counts                              |
| single model lazy guard                      | renders nothing and sends nothing in single-model mode                                                   |
| roving tab stop                              | has one tab stop and supports arrows, Home and End with focus following selection                        |
| tab keyboard focus                           | has one tab stop and supports arrows, Home and End with focus following selection                        |
| announcement deduplication                   | skips announcement history on mount and uses the existing panel announcer for new events                 |
| mount history suppression                    | skips announcement history on mount and uses the existing panel announcer for new events                 |
| single live region                           | announces only new landings or returned candidates once, never turns the Traffic view into a live region |
| parent announcer exclusivity                 | announces only new landings or returned candidates once, never turns the Traffic view into a live region |
| fresh peer hints only                        | sums only fresh other-window hints and offers only opening a peer window                                 |
| recovery live owner controls                 | keeps recovery read-only for possibly live owners and offers no lock removal or locked recovery          |
| recovery held lock controls                  | keeps recovery read-only for possibly live owners and offers no lock removal or locked recovery          |
| safe cleanup controls                        | shows lanes, leases, conflicts, serial merge reasons, flaky checks and safe disk cleanup                 |
| runner test controls restricted              | shows health/fingerprint and input-hang instructions, disables remote tests when untrusted               |
| runner form validation                       | edits a validated user runner and refuses credential variables before posting                            |
| harness ready only after render              | finishes each Traffic harness scenario on a rendered surface before axe may scan it                      |
| event counters attempt attribution           | attributes every matching attempt separately without counting nonmerged cost or token subsets twice      |
| factory does not prefetch                    | renders nothing and sends nothing in single-model mode                                                   |
| board ignores stale availability             | withholds board controls when the available actions belong to a stale attempt                            |
| board same-role entry choices                | ranks ready tasks by scheduler order, explains scores and sends current attempts with every board action |
| rework counts read-only tasks                | counts read-only tasks in rework denominators while keeping writing conflict denominators separate       |
| rework rates use all tasks                   | reads the installed table at render time and shows reported and estimated metrics separately             |
| metric projection validates utilization      | validates host envelopes and bounds projections, fits, positions and counts                              |
| queue events attributed to their own attempt | attributes every matching attempt separately without counting nonmerged cost or token subsets twice      |
| future task source and period filters        | ignores future and foreign-role observations in a scoped local period                                    |
| foreign task role excluded                   | ignores future and foreign-role observations in a scoped local period                                    |
| future event excluded                        | ignores future and foreign-role observations in a scoped local period                                    |
| future slot excluded                         | ignores future and foreign-role observations in a scoped local period                                    |
| foreign slot role excluded                   | ignores future and foreign-role observations in a scoped local period                                    |
| local window omitted from peers              | sums only fresh other-window hints and offers only opening a peer window                                 |
| empty updates are not announced              | skips announcement history on mount and uses the existing panel announcer for new events                 |
| arrows follow receiving button               | has one tab stop and supports arrows, Home and End with focus following selection                        |
| review charges included                      | includes separate review charges with their own accuracy and attributes them to the owning attempt       |
| review charges attributed to owner           | includes separate review charges with their own accuracy and attributes them to the owning attempt       |
| orphan review charge rejected                | includes separate review charges with their own accuracy and attributes them to the owning attempt       |
| week starts on Monday                        | starts the current calendar week on Monday when today is Wednesday                                       |

## Required integration check result

`npm run check:host-api` exits 1 solely because the generated record's theme
source list now also names `src/webview/components/traffic/traffic.css`.
The actual totals are unchanged: 271 VS Code APIs, 18 vscode-importing files,
23 Node built-ins and 59 theme variables. X2 owns the generated host API
record; V leaves it untouched and reports this exact regeneration work.
This check is not recorded as passing. No gate, ignore or threshold changed.

## Browser findings and checks

The real browser exposed arrows using the selected tab while focus had moved
to a different tab. The handler now computes its next tab from the button
receiving the key, which also handles keys arriving before React commits the
previous selection. The owned unit case and a red drill prove this change.

All eight Traffic panes were rendered at a true 320 × 760 viewport in
English and pseudo, in light/dark/high-contrast dark/high-contrast light.
64 pane checks passed: axe WCAG-tagged violations 0, document and surface
scroll widths no greater than their client widths, one tab stop, and arrows
moving both selection and focus. Receipts: `m96c-v/render-checks.json`.
Screenshots in that directory show the board, recovery, merge queue and
metrics. These are test-only fixture renders, with zero model attempts.
The ordinary gate remains the authority for incomplete findings and its
existing exemptions; the extra per-pane axe checks here report violations.

The Runners edit form also passed at 320 × 760 in English/pseudo and all
four themes: eight further axe/overflow checks, with the actual form open.
Receipt: `m96c-v/runner-render-checks.json`; two form screenshots are included.

The existing accessibility gate ran all five owned scenarios in four themes
for English, pseudo and every one of the 14 translations: 320 pages,
zero violations, undecided findings, exemptions, hidden-contrast findings or
missing results. Exact commands/results: `m96c-v/a11y-checks.json`.

The new render-readiness gate was also fired in the real browser. Deliberately
corrupting the harness ready marker made `team-traffic` fail in every theme
with “Traffic scenario did not finish rendering”. The source was restored
byte-exact, and the same four-page command then passed with zero findings.
Receipt: `m96c-v/harness-gate-drill.json`. This is a 72nd deliberate drill
in addition to the 71 named unit failures above.

## Final macmini validation

- Owned unit files: `trafficMetrics.test.ts` (8), `trafficHandlers.test.ts`
  (10), `trafficView.test.tsx` (12), `trafficHarness.test.tsx` (1): 31 passed.
  Commands used `--maxWorkers=3 --testTimeout=120000`, no more than three
  files per invocation and no filtered tests.
- `npm run typecheck`: all five projects passed. The new harness's own
  `tsc -p test/harness/tsconfig.json --noEmit` also passed.
- Changed-file ESLint and Traffic CSS Stylelint passed. `npm run deadcode`
  passed (only the existing vendor-ignore configuration hint), `npx jscpd`
  found zero clones, and `npm run check:l10n` reported 14 tables, 120 manifest
  strings, 435 source files and zero problems.
- `npm run build` passed every size/split/host-global/notices check. Startup
  measured 866.2 KiB at the start and 867.1 KiB at the end, under 900 KiB.
  Extension 590.7/600 KiB, Model API 430.2/475 KiB, shared English 111.4/125
  KiB, checkpoint store 135.7/225 KiB and ACP 801.0/850 KiB.
- Full `quality`, VS Code integration, live receipts and final VSIX/production
  Traffic bundle certification belong to X2. This base has no production
  caller for the new surface; the current successful production build is
  the base plus the English keys. The harness ESM chunks are private test
  outputs, excluded from the shipped package. No cap was raised.

No new dependencies, manifest keys, unsafe casts, disables or project-wide
rules were added. Owner defaults remain with the setup/team adapters; V
renders no UI and starts no loader for `mode: 'singleModel'`. No live model
attempts or paid calls were made. Only lane-owned source, harness regions,
translations, tests and this certification are changed.

A routing regression smoke check also ran `npm run test:a11y -- empty
share-narrow`: eight pages/four themes passed, zero violations/undecided/
exempt/missing results. The existing dialog scenario leaves 10 contrast
elements unmeasured while obscured, as the gate reports; that is separate
from the new Traffic/Runners matrix, which reported zero unmeasured elements.

The latest test-only lazy surface fragment `TrafficSurface-FEZK2U6W.js` is 13.5 KiB.
This excludes the shared runtime/English/schema chunks and the fixture entry;
it is not a certified production bundle size.
