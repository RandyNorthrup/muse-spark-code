# M96c lane O — check slots and runners

Rig: macmini. Base: `dfbedc5c`; plan of record: `e23ec61c`.
Read the rig brief, shared Codex rules, AGENTS.md, PLAN.md D75 and M96c,
`m96-research.md` (including §8) and lane 0c's contract record before editing.
No network, live model or paid calls. All remote execution tests use fakes,
local child processes and temporary repositories inside this worktree.

## Configuration and routing

User-level `runners.json` is read only beneath the supplied config home, with
an explicit bounded reader and lane 0c's strict schema. Credentials and Git
process overrides are removed; only the extension's SSH transport retains
its agent. Health is validated and expires after the plan's 60 seconds.
Routing passes shell admission before probing or dispatching, checks trust
again after waits, matches command classes/OS labels, follows runner affinity,
samples load and slots before dispatch, and falls back on busy, offline or
uncertain runners. A Windows-only check cannot fall back to a Mac local slot.
A late result's run id cannot admit another run.

Verification: `runnerRouting.test.ts`, 10 passing tests, directly on macmini.
ESLint and Prettier on these files passed; host typecheck passed.
Full quality is reserved to integration/X2 by the lane brief's shared rules.

## Red drills: configuration and routing

Each listed mutation failed the named test; every source was restored
byte-exact, checked with SHA-256. No test-name filters or skipped tests.
The first size drill showed the initial oversized fixture also failed JSON
parsing without the size guard. The fixture was corrected to valid padded
JSON, and the size guard then demonstrably failed when removed.

| Guard removed or changed | Named failure                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| config authority         | reads only the config-home file and refuses unknown authority and oversized data                            |
| config size              | reads only the config-home file and refuses unknown authority and oversized data                            |
| credentials              | drops credential names case-insensitively even when allowlisted, and keeps the SSH agent only for transport |
| allowlist                | drops credential names case-insensitively even when allowlisted, and keeps the SSH agent only for transport |
| health freshness         | expires health, refuses malformed measurements, and treats a clock rewind as unknown                        |
| health rewind            | expires health, refuses malformed measurements, and treats a clock rewind as unknown                        |
| health cores             | expires health, refuses malformed measurements, and treats a clock rewind as unknown                        |
| health load              | expires health, refuses malformed measurements, and treats a clock rewind as unknown                        |
| health slots             | expires health, refuses malformed measurements, and treats a clock rewind as unknown                        |
| health boundary          | expires health, refuses malformed measurements, and treats a clock rewind as unknown                        |
| shell admission          | runs every shell guard before any probe or dispatch                                                         |
| trust admission          | refuses untrusted work and trust lost while sampling                                                        |
| labels                   | matches Windows-only labels and command classes instead of routing to a Mac                                 |
| command class            | matches Windows-only labels and command classes instead of routing to a Mac                                 |
| affinity                 | tries affinity first, then falls back from offline, busy and uncertain runners                              |
| local platform           | refuses a Windows-only job when no Windows runner or local slot is available                                |
| load guard               | samples before dispatch and refuses overloaded, full, input-hung and offline runners                        |
| free slots               | samples before dispatch and refuses overloaded, full, input-hung and offline runners                        |
| input ready              | samples before dispatch and refuses overloaded, full, input-hung and offline runners                        |
| late remote result       | rejects late remote and local answers by run id, and respects cancellation                                  |
| late local result        | rejects late remote and local answers by run id, and respects cancellation                                  |
| cancel                   | rejects late remote and local answers by run id, and respects cancellation                                  |

Restored SHA-256 values before commit formatting:

- `src/core/runners/runnerConfig.ts`: `9a99a0a33b339716cf492bf6480851fa126dc5f257456fd9eefbba352b4155bc`
- `src/core/runners/health.ts`: `0a653fa81bf72719cf472d853187a1ce8fcf974c6e3880fe3866b11965ba570b`
- `src/core/runners/routing.ts`: `cbf8b11d78b2b49fa4220190e28b755f3983328c364bee3bbb0c63d04386fdef`
