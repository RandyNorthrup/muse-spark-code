# M96c lane V — Traffic and runners

Worktree `/Users/randy/lanes/M96CV`, branch `m96c/v`, macmini rig.
Plan of record: PLAN.md D75 and M96c, research `m96-research.md` §8,
lane 0c contracts and `m96c-0c.md`. Owner defaults-on ruling applies.
No model calls, paid calls, credentials, pushes, merges or rebases.

## Metrics piece

`src/core/team/trafficMetrics.ts` reads final deduplicated ledger tasks,
scheduler events and piecewise slot observations through an injected input
contract. Reviews and merge-conflict accounting events are explicit ledger
adapter observations, not guessed MSP/ACP fields. All attempts and reviews
belong in each task's usage list. Cached input/reasoning are subsets, not
additional tokens. Cost totals include merged changes only, retaining
reported and estimated amounts separately. Local periods use calendar
midnight and Monday; utilisation clips intervals at the period boundary.
The most recent bounded queue samples are shown; aggregation uses all rows.

Macmini validation: focused `trafficMetrics.test.ts`, 4 tests passed;
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
