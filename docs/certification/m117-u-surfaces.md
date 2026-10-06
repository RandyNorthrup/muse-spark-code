# M117 U — estimator surfaces

Branch `m117/u`, Mac mini, 2026-10-06. Read the rig brief, shared rules,
AGENTS.md, D97 and M117 in full, the contract/G/S/R certifications and C's
prior before implementation. The authorized prerequisite merges are C
`df69a66aa` and S `c28cf3073`; PLAN/CHANGELOG conflicts retain both records.
No other merge, rebase, push, network, credential or paid call is authorized.

## Implementation plan

1. Implement strict CLI/slash options, a validated injected estimate runner,
   portable text/Markdown/HTML/JSON output, a report collector and TUI port.
2. Re-estimate on normalized lane-finished events, showing signed forecast
   drift. Cancel superseded work and discard late results after disposal.
3. Intercept ACP `/estimate` locally, with cancellation and safe errors.
   Absent bindings report waiting and never send the command to a model.
4. Build the shared React Estimator panel as a lazy entry: accessible Gantt,
   forecast marks, bottleneck, setup cards, complete inputs/disclosures,
   calibration and a provisioning port. An unbound P port disables Spin it up.
5. Exercise the surfaces on fakes, keyboard flows and axe in four themes at
   320 px. Prove each new guard with a named failing mutation and SHA-256
   restoration. Run scoped serial rig gates with default test timeouts.

## Ownership and binding boundaries

U consumes exported contracts/types only. R's exact-money repair is pending;
money presentation accepts `CatalogPrice` through an injected formatter,
with no numeric money arithmetic or conversion in U. W binds that formatter
to `src/shared/usd.ts` after R merges. No npm dependency is added.

W owns shipping build/size/split wiring, the manifest, help/catalog rows,
README/CHANGELOG/ACP guides and the runtime dispatch. Those files are not
silently changed here. The absent M113/M115/TUI sources and P implementation
use explicit ports; fixtures remain under `test/**`. Integration actions and
verification receipts follow below.

## First guard-fire receipts

All runs use the complete owning file, `--maxWorkers=3`, and the repository
default timeout on Mac mini. No test-name filter, skip or timeout override.
Each accepted mutation exits 1 with the named assertion below, and restores
the original bytes in `finally`, checked by SHA-256.

The initial extra rollover-comparison probe passed because the strict ISO
schema already rejects rollover dates. It is not a receipt. The redundant
comparison was removed in both command and panel; U01 bypasses the actual
strict date boundary and fails.

| Drill                   | Owning regression                                                                      | Exit |
| ----------------------- | -------------------------------------------------------------------------------------- | ---: |
| `U01-date-boundary`     | refuses malformed options, duplicate flags, rollover and ambiguous dates               |    1 |
| `U02-duplicate-flags`   | refuses malformed options, duplicate flags, rollover and ambiguous dates               |    1 |
| `U03-request-boundary`  | validates the request before dispatch and rejects damaged or mismatched engine replies |    1 |
| `U04-result-schema`     | validates the request before dispatch and rejects damaged or mismatched engine replies |    1 |
| `U05-result-request`    | validates the request before dispatch and rejects damaged or mismatched engine replies |    1 |
| `U06-abort-boundaries`  | aborts before dispatch and discards a result returned after cancellation               |    1 |
| `U07-html-escape`       | escapes hostile HTML and Markdown and uses only the injected price formatter           |    1 |
| `U08-event-relevance`   | refreshes only relevant newer lane-finished events and unsubscribes on close           |    1 |
| `U09-event-time`        | refreshes only relevant newer lane-finished events and unsubscribes on close           |    1 |
| `U10-drift-sign`        | shows signed finish-date drift with complete new disclosures                           |    1 |
| `U11-output-TZ`         | renders byte-identical terminal output across process time zones and languages         |    1 |
| `U12-acp-cancel`        | cancels the local estimate, denies overlapping prompts and suppresses a late result    |    1 |
| `U13-acp-error-privacy` | scrubs a throwing injected adapter from ACP output                                     |    1 |

Restoration hashes for this command/ACP piece:

- `src/runtime/estimator/command.ts`: `54f0caf9108b74864809fe389c4453d8eff5b854094788b15cbf6f79b818e432`.
- `src/runtime/estimator/session.ts`: `60e6103cc51af77082c55d41e14671fd1058aa7a574869191e55e9bb55ebbd5a`.
- `src/acp/agent.ts`: `d6577d1258f0dbc5cdb0f82b11d94a697196758ad52a4ffddf65abd684bb9a03`.

First green checks: 18 command/ACP tests with default timeouts; 6 panel
unit tests; 8 actual Chrome/axe theme-width cases (four captured themes,
690/320 px), all green. Heavy checks run serially. Final receipts follow.
