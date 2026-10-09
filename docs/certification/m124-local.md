# M124 local phase — MCP connector over stdio (D106)

Date: 2026-10-09. Host: Windows 11 (Node 24.20.0). Branch
`feature/m124-connector` from `d0b88d09a` (the 0.17.0 merge head). No model
call, key, network request, account call or MCP client installation was
made; **zero model attempts**.

## What was built

- `muse-spark-code-acp mcp [--connection ID]` serves MCP over stdio from
  the lazy `dist/connector.js` (`src/runtime/connector/entry.ts`); `mcp
grant|revoke|kill|resume|status` manage owner-only grants and the kill
  switch in the agent's data folder (`src/runtime/connector/store.ts`,
  `command.ts`).
- Protocol: the repository's pure MCP core (`src/core/mcp.ts`'s message
  schema and request keys) plus `src/core/connector/protocol.ts`
  (initialize negotiation over 2025-11-25, 2025-06-18, 2025-03-26 and
  2024-11-05; ping; tools/list; tools/call; `notifications/cancelled`; no
  server-sent requests, so client responses and elicitation answers are
  ignored) and a 64 KiB-bounded NDJSON framer (`stdio.ts`). No new npm
  dependency; `@modelcontextprotocol/sdk` was not added.
- Registry (`src/core/connector/registry.ts`, `src/shared/connectorTools.ts`):
  backed `muse_operation_get`, `muse_stop` (connector operations),
  `muse_report`, `muse_schedule_list`, `muse_schedule_cancel`,
  `muse_prompt_list`, `muse_prompt_get`, `muse_prompt_save`,
  `muse_prompt_prepare`, `muse_share_preview` (saved prompts);
  `unavailable` with a reason for `muse_fleet_status`,
  `muse_agent_outcomes`, `muse_receipt_get`, `muse_lane_start`,
  `muse_lane_continue`, `muse_team_start`, `muse_team_continue`,
  `muse_playbook_advice`, `muse_capacity_estimate`,
  `muse_schedule_create`, `muse_schedule_update`, `muse_share_publish`.
- Approval (`approval.ts`, `src/runtime/connector/approvalPage.ts`): one-use
  intents bound by SHA-256 to principal, grant generation, workspace, tool,
  payload, target generation, price and expiry; decided only by an
  authenticated post from the loopback page on M104 C's companion server;
  consumed once at dispatch after a re-read.
- Policy, audit and scrub (`policy.ts`, `audit.ts`, `redaction.ts`): grant
  scopes, workspaces, content and user-library flags, confidential refusal,
  call/read/approval/poll limits, keyed-digest JSONL audit with fail-closed
  reads and writes, M118's share privacy on every leaf plus a whole-result
  pass that withholds on change. Stop and schedule cancel bypass the
  limiter, the kill switch, the approval queue and audit failure.

## Tests (repository default timeouts, complete owning files)

| File                                  | Cases | Result |
| ------------------------------------- | ----: | ------ |
| `test/unit/connectorRegistry.test.ts` |    14 | pass   |
| `test/unit/connectorRuntime.test.ts`  |     8 | pass   |
| `test/e2e/connectorStdio.e2e.test.ts` |     2 | pass   |

The e2e file builds `src/runtime/main.ts` and the connector entry with
esbuild into a temporary package, then drives `acp.js mcp` as a fake client
over real stdio with a temporary data folder and a planted `META_API_KEY`
canary: protocol conformance (initialize, list, call, parse error,
oversized frame, ping after it), grant refusal, unavailable tools,
scrubbing of the canary and a private path from every stdout line and
stderr, `mcp kill` refusing reads while Stop still answers, and `mcp
resume` / `mcp grant` refusing without a terminal.

## Red drills

Driven by a script that applies one mutation, runs the owning test file,
restores the file with `git checkout`, and confirms `git diff --quiet`
(byte-exact against the HEAD blob, SHA-256 prefix shown).

| #   | Guard                              | Mutation                                              | Failing test(s)                                                                      | Restored (HEAD sha256)                              |
| --- | ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------- |
| 1   | Strict inputs                      | `muse_prompt_save` `strictObject` → `object`          | refuses unknown fields, so a client confirm or approve flag never reaches policy     | `e4e35e4cea476acf`                                  |
| 2   | Decision bound to the shown digest | drop the digest comparison in `decide`                | keeps a write inert until our page approves the exact intent, once                   | `be6e1247595d7559`                                  |
| 3   | Dispatch-time CAS                  | never compare the binding digest in `consume`         | cancels on denial, expiry, a changed grant…; binds the digest to every field…        | `be6e1247595d7559`                                  |
| 4   | Stop outside the limiter           | take a limiter token before Stop's path               | keeps Stop and schedule cancel outside limits, the kill switch and audit failure     | `aac941c2cc0b20fe`                                  |
| 5   | Kill switch                        | refuse only `muse_report` when switched off           | cancels on denial, expiry, a changed grant or the kill switch                        | `aac941c2cc0b20fe`                                  |
| 6   | Unavailable is never success       | answer `ok` for an unbacked tool                      | answers every unbacked tool with unavailable, never an empty success                 | `aac941c2cc0b20fe`                                  |
| 7   | Reads fail closed on audit failure | ignore the audit answer                               | fails reads closed when the audit cannot be written                                  | `aac941c2cc0b20fe`                                  |
| 8   | Shared redactor on every leaf      | return string leaves unscrubbed                       | scrubs planted secrets and private paths from every result                           | `9cdd29cf7412cb17`                                  |
| 9   | Frame bound before parse           | never refuse a long line                              | keeps stdout to one JSON reply per line, refuses an oversized frame…                 | `cb34b3b69a76b191`                                  |
| 10  | Paid authority stays zero          | accept `--scope paid:request`                         | parses only its own words and needs a terminal confirmation…                         | `9469740070a64fad`                                  |
| 11  | No grant grants nothing            | admit when the grant is missing                       | speaks only MCP on stdout and refuses everything without a grant (e2e)               | `5d611ec04cf2e3fc`                                  |
| 12  | stdout carries only MCP            | print `ready` on stdout at serve start                | both e2e cases                                                                       | `3dd38e995cbfa641`                                  |
| 13  | Lazy split                         | `import './connector/entry'` in `src/runtime/main.ts` | `check-bundle-split`: `dist/acp.js carries lazy connector implementation` ×5, exit 1 | restored clean; rebuild: split exit 0, sizes exit 0 |

## Gates run

- `npm run typecheck`: the five projects pass except
  `test/e2e/acpFixture.ts` (two TS2345 errors on esbuild's `external`
  type), which fail identically on the untouched base `d0b88d09a` in a
  scratch worktree; not touched here.
- ESLint on every changed TypeScript/script file: 0 problems; Prettier on
  changed files.
- `npx knip`: exit 0 (two pre-existing configuration hints).
- `npm run check:plan` (208 milestones, 0 drift), `check:roadmap`,
  `check:l10n` (0 problems; 14 tables carry `acpConnector`,
  `mcpConnectorTitle`, `referenceMcpCommand`), `check:host-api` (record
  regenerated), `check:reference` (current; `mcp` CLI row and the
  `mcp-connector` feature).
- `npm run build`: exit 0. Sizes (bytes):

  | Bundle                    | Base `d0b88d09a` |   After | Budget  |
  | ------------------------- | ---------------: | ------: | ------- |
  | `dist/extension.js`       |          563,348 | 563,348 | 600 KiB |
  | `dist/uiText.js`          |           95,135 |  95,226 | 125 KiB |
  | `dist/uiTextRuntime.js`   |            4,762 |   5,550 | 25 KiB  |
  | `dist/acp.js`             |          240,920 | 242,254 | 850 KiB |
  | `dist/reference.js`       |           57,552 |  57,772 | 125 KiB |
  | `dist/connector.js` (new) |                — |  88,324 | 100 KiB |

  The connector limits are plain literals: an earlier draft with `64 * 1024`
  style expressions was not tree-shaken and added 626 bytes of unused
  constants to `dist/extension.js` and pushed `dist/usagePanel.js` over its
  75 KiB cap; measured and fixed before commit.

- Not run here: the aggregate `npm run quality` and the whole unit suite
  (CI is the merge gate); the accessibility, visual and four-theme gates for
  the approval page (it has none yet: an open item).

## Commands run (temporary data folder, built `dist/acp.js`)

`mcp status` (exit 0), `mcp grant --workspace .` without a terminal (exit
1, refusal text), `mcp kill` (exit 0), `mcp status` after kill (exit 0),
`mcp revoke` (exit 0), `mcp resume` without a terminal (exit 1), an unknown
word (exit 2, usage), and `mcp` serving initialize at `2025-11-25` and an
empty `tools/list` without a grant (exit 0 on stdin close). A granted
`mcp grant` with a typed `y` ran through the unit test's interactive port,
not a real terminal. The client registration commands in the README and
`docs/mcp.md` (`codex mcp add`, `claude mcp add`, `gemini mcp add`, the
three configuration files) were checked against each vendor's
documentation on 2026-10-09 and **not run**: they write the owner's global
client configuration.

## Open items

- M104's shared React approval dialog and companion bridge in every editor;
  the page's accessibility, theme and visual qualification.
- Per-product qualification rows (design §8) for Codex, Claude Code and
  Gemini CLI on all three OSes.
- Adapters for the twelve `unavailable` tools as their owners expose ports.
- The hosted phase: M110, the orchestrator-link contract and Q-M124.1.

## RVM124 security review fixes (2026-10-09, kubuntu)

Branch `feature/m124-fix` from `20a67df05`. The review
(`RVM124.report.md`: 1 P1, 14 P2, 1 P3) treated the connected MCP client
as untrusted. The lane brief named the P1 and eleven P2s; findings 13 and
14 sat in the same code paths and were fixed with them. Rig: kubuntu
(Linux, Node from the lane's install), repository default timeouts (5 s a
test), no `--testTimeout`. No model call, key, network request or client
installation; **zero model attempts**.

### Closure

| #   | Sev | Finding                                                | Fix (file)                                                                                                                                                                                                                                                      | Regression test (fails on `20a67df05`)                                                                                   |
| --- | --- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | P1  | Report bodies without the content grant                | `muse_report` returns its body only with `content:read` and the workspace's content flag; otherwise `{kind, format, contentWithheld}` (`registry.ts`)                                                                                                           | `returns report bodies only with the content grant; metadata otherwise (P1)`                                             |
| 2   | P2  | Stop reported success while a consumed approval wrote  | consume and the move to `running` are one step; the dispatch receipt is written; the effect starts only from `running`; Stop cancels a dispatch whose effect has not started and says `stopRequested` once it has (`registry.ts`, `operations.ts`)              | `never writes after Stop cancels a consumed approval that is still dispatching (P2-2)` (+ `reports stopRequested…`)      |
| 3   | P2  | Cancelled/disconnected calls opened approvable writes  | the write path takes the call's signal and rechecks it and the disconnect flag after every await, settling the operation; `ConnectorProtocol.close` disconnects the registry first (`registry.ts`, `protocol.ts`)                                               | `opens no approvable write for a cancelled call (P2-3)`; `… after the client disconnects over stdio (P2-3)` (real stdio) |
| 4   | P2  | Closing stdout did not close the connector             | stdout `close`/`error` closes the protocol and destroys stdin, ending the read loop (`stdio.ts`)                                                                                                                                                                | `closes the connector when stdout closes while stdin stays open (RVM124 P2-4)` (real stdio)                              |
| 5   | P2  | Unbounded tasks and output                             | at most 16 frames at once (`Server busy`, -32002, beyond), 4 more for Stop/schedule cancel/cancellation; `write()` backpressure honoured with `drain`; more than 1 MiB unread disconnects (`stdio.ts`, `protocol.ts`)                                           | `honours stdout backpressure and disconnects a client that never reads`; `answers busy beyond the task bound…` (P2-5)    |
| 6   | P2  | Settled intents kept payloads forever                  | settlement deletes the intent; only its state stays, newest 64 (`approval.ts`)                                                                                                                                                                                  | `drops payloads at settlement and keeps a bounded history` (600 deny/expire cycles)                                      |
| 7   | P2  | Limits per process                                     | `SharedLimits` (`policy.ts`) over the store's locked `connector/limits/<connection>.json` (`store.ts`): token bucket, read and pending-approval leases that expire on their own; shared by every process of the grant and kept across restarts; failure refuses | `shares the rate limit between servers of one grant (P2-7)`; `keeps the limits of one grant across server processes…`    |
| 8   | P2  | Deadline did not settle reads; late success            | one 15 s timer bounds the whole ordinary call (admission and audit included); the answer races the signal, ports take it, the read lease frees on abort, a late answer is dropped (`registry.ts`)                                                               | `settles every read at the deadline, frees its slot and drops the late answer (P2-8)`                                    |
| 9   | P2  | Complete result over 64 KiB                            | the bound is measured on the serialized result (text, structured copy, escaping) (`registry.ts`)                                                                                                                                                                | `bounds the complete MCP result, text and structured copy, to 64 KiB (P2-9)`                                             |
| 10  | P2  | Calls and refusals without receipts                    | `call` records one `refused` line for every refusal (unknown tool without its client name, unavailable, kill switch, rate, concurrency, invalid, stale); Stop keeps its best-effort `stopped` line (`registry.ts`)                                              | `leaves an audit receipt for every refusal (P2-10)`                                                                      |
| 11  | P2  | Three report kinds failed through the real adapter     | subjects follow M113's grammar: positional for milestone and estimate (required), release (default `latest`); playbook's `--milestone` (`registry.ts`, `src/runtime/main.ts`)                                                                                   | e2e `generates every offered report kind through the real runtime adapter (RVM124 P2-11)` (main.ts + real reporting.js)  |
| 12  | P2  | User-library-only grant could not Stop                 | `muse_stop.workspaceId` optional; ownership resolves first, and an owned user-library operation stops with the Stop scope alone (`connector.ts`, `connectorTools.ts`, `registry.ts`)                                                                            | `lets a user-library-only grant stop its own operation (P2-12)`                                                          |
| 13  | P2  | Owner read failure stranded operations / rejection     | every failure after the claim settles the operation; the dispatch catches everything and cancels its intent (`registry.ts`)                                                                                                                                     | `settles the operation when an owner read fails, before or after approval (P2-13)`                                       |
| 14  | P2  | Retries misreported terminal work                      | a matching retry answers the operation's real state (`registry.ts`)                                                                                                                                                                                             | `answers a retry with the real state of the operation (P2-14)`                                                           |
| 15  | P2  | Grant/key storage trusted without ownership checks     | **open**: not in this lane's brief (needs an owner-storage boundary and Windows DACL qualification)                                                                                                                                                             | —                                                                                                                        |
| 16  | P3  | Setup docs: unrun commands, `status \| revoke …` block | **open**: not in this lane's brief                                                                                                                                                                                                                              | —                                                                                                                        |

Each new test was run against an archive of `20a67df05` (the new test
files copied over its tree): all 18 new cases failed there, each on its own
assertion (for example P2-2: one prompt written; P2-3: one pending intent;
P2-4/P2-5: the serve promise still unsettled; P2-11: `refused` for
milestone, release, estimate and playbook); the 24 original cases passed.

### Tests (kubuntu, repository default timeouts, complete owning files)

| File                                  | Cases | Result |
| ------------------------------------- | ----: | ------ |
| `test/unit/connectorRegistry.test.ts` |    27 | pass   |
| `test/unit/connectorRuntime.test.ts`  |    12 | pass   |
| `test/e2e/connectorStdio.e2e.test.ts` |     3 | pass   |

The e2e file now also builds `src/runtime/reporting/reportsEntry.ts` into
the temporary package's `dist/reporting.js`, so `muse_report` runs through
`src/runtime/main.ts`'s adapter and M113's real argument parser.

### Red drills

A driver applied one mutation, ran the owning file filtered to the guard's
test, wrote the original bytes back and confirmed the SHA-256 and `git diff
--quiet`. Every mutation turned its test red (exit 1); every file was
restored byte-exact.

| #   | Guard                                | Mutation                                      | Failing test                                                 | Restored (sha256)  |
| --- | ------------------------------------ | --------------------------------------------- | ------------------------------------------------------------ | ------------------ |
| R1  | Report body needs content (P1)       | gate condition → `grant.revoked`              | `returns report bodies only with the content grant…`         | `9f6833844f5b75d9` |
| R2  | Effect only from `running` (P2-2)    | drop `if (record.state !== 'running') return` | `never writes after Stop cancels a consumed approval…`       | `9f6833844f5b75d9` |
| R3  | Recheck the call after awaits (P2-3) | `isGone = () => false`                        | both P2-3 cases                                              | `9f6833844f5b75d9` |
| R4  | stdout close closes (P2-4)           | drop the output `close` listener              | `closes the connector when stdout closes…`                   | `226f98fddbee90f0` |
| R5  | Unread-output bound (P2-5)           | queue limit check never true                  | `honours stdout backpressure and disconnects…`               | `226f98fddbee90f0` |
| R6  | Task admission (P2-5)                | admission check never true                    | `answers busy beyond the task bound and keeps room for Stop` | `226f98fddbee90f0` |
| R7  | Payload dropped at settlement (P2-6) | drop `this.intents.delete(intent.id)`         | `drops payloads at settlement and keeps a bounded history`   | `15ff56f349fe3407` |
| R8  | Bounded terminal history (P2-6)      | eviction loop breaks at once                  | same                                                         | `15ff56f349fe3407` |
| R9  | Limit file lock (P2-7)               | drop `await acquire(lock)`                    | `keeps the limits of one grant across server processes…`     | `c029b42a1b82da27` |
| R10 | Shared limit port (P2-7)             | registry uses its own in-memory port          | `shares the rate limit between servers of one grant`         | `9f6833844f5b75d9` |
| R11 | Whole-call deadline (P2-8)           | the timer never aborts                        | `settles every read at the deadline…`                        | `9f6833844f5b75d9` |
| R12 | Complete result measured (P2-9)      | measure the text only                         | `bounds the complete MCP result…`                            | `9f6833844f5b75d9` |
| R13 | Refusal receipts (P2-10)             | central refusal record never written          | `leaves an audit receipt for every refusal`                  | `9f6833844f5b75d9` |
| R14 | M113 subject grammar (P2-11)         | every subject as `--milestone`                | e2e `generates every offered report kind…`                   | `d5c4d6449ce23801` |
| R15 | Stop without workspace (P2-12)       | `muse_stop` requires `workspaceId` again      | `lets a user-library-only grant stop its own operation`      | `17e14cf99f0d5a90` |
| R16 | Owner read failure settles (P2-13)   | the request's catch rethrows                  | `settles the operation when an owner read fails…`            | `9f6833844f5b75d9` |
| R17 | Retry's real state (P2-14)           | a retry always answers pending                | `answers a retry with the real state of the operation`       | `9f6833844f5b75d9` |

### Gates and sizes

- `npx tsc --noEmit -p .`: exit 0. `npm run typecheck`: only the two
  pre-existing `test/e2e/acpFixture.ts` TS2345 errors recorded above.
- ESLint `--max-warnings=0` and Prettier on every changed file: clean.
  `npx knip`: exit 0 (the two pre-existing configuration hints).
  `npm run duplication`: the two clones that exist on `20a67df05`
  (`connectorStdio.e2e`/`schedulesStdio.e2e`, `windowsTrustedPath`), none
  added.
- `check:l10n` 0 problems (no user-visible string changed; the model text
  is English by D6), `check:host-api` (record regenerated: `node:events`
  joins, `node:timers/promises` +1), `check:reference` current,
  `check:plan` 0 drift.
- `npm run build`: exit 0. `dist/extension.js` 563,348 bytes, SHA-256
  `34b93af4…381e371a`, identical to a build of `20a67df05`;
  `dist/connector.js` 88,324 → 92,519 bytes (90.4 KiB of its 100 KiB
  budget, no cap raised); `dist/acp.js` 242,254 → 242,286 (the report
  subject mapping).

## M124R3: one state machine, one authority (RVM124B, 2026-10-09)

Branch `feature/m124-r3` from `2fa594639`: the redesign in `8bc6cc2c7`;
three more tests (found needed by drills R1, L7 and L8) and the removal of
four clones the duplication gate found in this lane's own code (`bind` and
`lease` in the registry, two test helpers) in `6480a8811`; this record and
the docs in the commit after it. Lane host Windows 11; vitest ran on the
Kubuntu rig through `rig-test.sh` (repository default timeouts, no
`--testTimeout`, complete owning files), the store-sensitive files natively
on Windows, and the suites once more on the Mac mini. No model call, key,
network request, MCP client installation or client configuration change;
**zero model attempts**.

The second review (`RVM124B.report.md`: 1 P1, 4 P2) was the third round on
this module. Under the project's rule that means a redesign, not a fourth
patch: each finding was a check made before an `await` and trusted after
it. Design §3a has the full table and the rules; in short:

- **One state machine** (`src/core/connector/operations.ts`): received →
  admitted → (awaitingApproval → approved →) dispatching → settled, or
  refused, cancelled or failed. Terminal states have no exits; a started
  write is never cancelled. Every transition writes one receipt, so every
  call ends in exactly one terminal receipt.
- **One authority** (`ConnectorRegistry.stopCause`, synchronous): the
  call's cancellation and deadline, disconnect, the kill switch, and the
  grant it was admitted under (generation, scopes, workspace or user
  library, confidential policy, through the same `admit`). `refresh` reads
  the grant and kill switch again after every wait that precedes an effect
  and applies them to every live operation at once.
- **One final gate** (`Operation.gate`) immediately before each effect (rate
  token, read and pending leases, the intent, owner ports, the write) and
  before a read's result is delivered. No await sits between a passed gate
  and its effect. The write's dispatch receipt is written ahead, then the
  authority and target are read again, then the gate and the one-use
  approval's compare-and-swap pass in the same tick as the write.
- **The limits lock** follows the M123 `storeLock` protocol (read at
  `c212d38cf` on `m123/p4`), kept small in `store.ts` until a shared module
  is extracted, plus its generation fence. No child process is started:
  where a process's start time cannot be read without one (macOS,
  Windows), a live process id never counts as proof that the owner is gone.

### Found on the way: inode reuse

The two-contender lock regression first failed on Kubuntu with the
redesigned store: ext4 gave the crashed lock's freed inode number to the
next lock created, so a delayed waiter's identity check judged the new
holder's live lock to be the crashed instance (an ABA). The generation fence
still refused the stale write, so no debit was lost, but the takeover was
wrong. The move-aside check now compares the note's random id as well as
the native identity (drill L3). `storeLock` on `m123/p4` compares identity
alone; its generations fence the same way, but the M123 owner should know.

### Closure, both reports

"Closed in `6c0b13853`" means the RVM124 fix lane closed it and RVM124B's
closure table agreed; its regression test fails on `20a67df05` and still
passes here.

| Finding                                                | Sev | Status                                                                                                                                                                              | Regression test (fails on `2fa594639` unless noted)                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------ | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RVM124 1: report bodies without content grant          | P1  | Closed in `6c0b13853`; unchanged                                                                                                                                                    | `returns report bodies only with the content grant…` (fails on `20a67df05`)                                                                                                                                                                                                                                                |
| RVM124 2: Stop vs dispatch                             | P2  | Closed in `6c0b13853`; now the state machine's write-ahead and final gate                                                                                                           | `never writes after Stop cancels…`, `reports stopRequested…` (fail on `20a67df05`)                                                                                                                                                                                                                                         |
| RVM124 3: cancelled/disconnected calls                 | P2  | Partial there; **closed here** with RVM124B 1 and 2                                                                                                                                 | RVM124B P1 disconnect and P2-2 rows below                                                                                                                                                                                                                                                                                  |
| RVM124 4: closing stdout                               | P2  | Closed in `6c0b13853`; unchanged                                                                                                                                                    | `closes the connector when stdout closes…` (fails on `20a67df05`)                                                                                                                                                                                                                                                          |
| RVM124 5: task and output bounds                       | P2  | Closed in `6c0b13853`; the receipts backlog bound added here                                                                                                                        | `answers busy beyond the task bound…`; here `reads no further frame while the journal holds its backlog of receipts`                                                                                                                                                                                                       |
| RVM124 6: settled intents kept payloads                | P2  | Closed in `6c0b13853`; unchanged                                                                                                                                                    | `drops payloads at settlement…` (fails on `20a67df05`)                                                                                                                                                                                                                                                                     |
| RVM124 7: limits per process                           | P2  | Partial there; **closed here** with RVM124B 3                                                                                                                                       | RVM124B P2-3 rows below                                                                                                                                                                                                                                                                                                    |
| RVM124 8: deadline and late success                    | P2  | Partial there; **closed here** with RVM124B 2                                                                                                                                       | `lets a call past its deadline take no lease and start no owner read`                                                                                                                                                                                                                                                      |
| RVM124 9: complete result over 64 KiB                  | P2  | Closed in `6c0b13853`; its refusal now ends the call with its receipt (RVM124B 4)                                                                                                   | `bounds the complete MCP result…` (fails on `20a67df05`); here `records a final result refused for its size…`                                                                                                                                                                                                              |
| RVM124 10: calls and refusals without receipts         | P2  | Partial there; **closed here** with RVM124B 4                                                                                                                                       | RVM124B P2-4 rows below                                                                                                                                                                                                                                                                                                    |
| RVM124 11: report kinds through the real adapter       | P2  | Closed in `6c0b13853`; unchanged                                                                                                                                                    | e2e `generates every offered report kind…` (fails on `20a67df05`)                                                                                                                                                                                                                                                          |
| RVM124 12: user-library-only grant could not Stop      | P2  | Partial there; **closed here** with RVM124B 5                                                                                                                                       | `lets the user-library grant stop a user-library save that named a workspace, over stdio (P2-5)`                                                                                                                                                                                                                           |
| RVM124 13: owner read failure stranded operations      | P2  | Closed in `6c0b13853`; every failure is now a transition to `failed`                                                                                                                | `settles the operation when an owner read fails…` (fails on `20a67df05`)                                                                                                                                                                                                                                                   |
| RVM124 14: retries misreported terminal work           | P2  | Closed in `6c0b13853`; a retry is a status read of the kept operation                                                                                                               | `answers a retry with the real state…` (fails on `20a67df05`)                                                                                                                                                                                                                                                              |
| RVM124 15: grant/key storage ownership, Windows DACL   | P2  | **Open**: needs a verified owner-storage boundary (owner, mode, link checks) and Windows DACL qualification on a Windows rig; outside this lane's redesign brief                    | None yet                                                                                                                                                                                                                                                                                                                   |
| RVM124 16: setup docs, `status \| revoke …` block      | P3  | **Closed here**: README shows each control command on its own line; README, `docs/mcp.md` and CHANGELOG say the client recipes have not been run; the rule-10 gap is recorded below | None: documentation only (no runtime behaviour to test)                                                                                                                                                                                                                                                                    |
| RVM124B 1: approved write after revoke/kill/disconnect | P1  | **Closed**: write-ahead dispatch receipt, authority read again, final gate and CAS in the write's tick                                                                              | `starts no approved write after revocation / the kill switch / a confidential policy / the client disconnects during the dispatch receipt wait, over stdio`; `…when the policy changes while the target is re-read`                                                                                                        |
| RVM124B 2: aborted calls acquired leases               | P2  | **Closed**: abort cancels at once; every effect behind the gate; leases freed whenever the call ends; delivery gate                                                                 | `lets no cancelled call take a read lease…, over stdio`; `lets a call past its deadline…`; `frees a lease recorded after its call was cancelled…`; `withholds a read result when the grant is revoked…`                                                                                                                    |
| RVM124B 3: stale-lock recovery by age                  | P2  | **Closed**: storeLock protocol and generation fence; age never counts                                                                                                               | lock file: `never removes a live owner’s lock for its age`; `keeps both debits when two servers recover one crashed owner’s lock`; `keeps both debits when the wall clock steps…`                                                                                                                                          |
| RVM124B 4: receipts missing                            | P2  | **Closed**: one receipt per transition; final-result, protocol and transport refusals; settled reads; control receipts                                                              | `records a final result refused for its size…`; `leaves one transport receipt for every frame refused…, over stdio`; `walks a read and an approved write…`; `ends every call on every tool, for every refusal kind…`; runtime `parses only its own words…` (control receipts); e2e `speaks only MCP…` (transport receipts) |
| RVM124B 5: user-library save with workspace context    | P2  | **Closed**: an operation's scope is its admitted scope; Stop's authority follows it                                                                                                 | `lets the user-library grant stop a user-library save that named a workspace, over stdio (P2-5)`                                                                                                                                                                                                                           |

The tool-table walk calls every tool of `CONNECTOR_TOOLS` (and an unknown
name) with unknown fields and with a grant lacking its scopes, then every
other refusal path: kill switch, rate limit, a failed admitted receipt,
not found, stale, unavailable lanes, stale and unshowable writes, a denied
and an expired approval, Stop of an ended operation. Every answered call
ends in exactly one terminal receipt carrying its reason; every receipt is
an edge of the table; the reasons seen are every `CONNECTOR_REASONS` value
but `budget_exceeded`, which no backed tool can produce while paid
authority is zero.

### Tests

At `6480a8811` (the record's commit changes no code):

| File                                    | Cases | Kubuntu | Mac mini | Windows (native) | On `2fa594639` (new tests overlaid, Kubuntu) |
| --------------------------------------- | ----: | ------- | -------- | ---------------- | -------------------------------------------- |
| `test/unit/connectorRegistry.test.ts`   |    46 | pass    | pass     | —                | 19 fail (every new case), 27 pass            |
| `test/unit/connectorRuntime.test.ts`    |    12 | pass    | pass     | pass             | 1 fail (control receipts), 11 pass           |
| `test/unit/connectorLimitsLock.test.ts` |     8 | pass    | pass     | pass             | 8 fail                                       |
| `test/e2e/connectorStdio.e2e.test.ts`   |     3 | pass    | pass     | —                | 1 fail (transport receipts), 2 pass          |

29 cases fail on `2fa594639`, each on its finding's own assertion (an
approved prompt written; four owner reads started; a live lock deleted and
a debit lost; receipts absent; Stop `forbidden`); the 40 cases that predate
this lane (38 unit, 2 e2e) pass there. The old-tree runs used a snapshot of `2fa594639`'s
tree with only the four test files overlaid (temporary index; no worktree
touched). One existing test (`never writes after Stop cancels…`) now holds
the dispatch receipt under both its new and old names, so it means the same
on both trees. The pre-existing two-store limits test now uses a fixed
clock: with the wall clock, a token refilled while twenty updates took
turns at the lock (seen once on Kubuntu); its assertions are unchanged.

### Red drills

A driver applied one exact mutation (asserting a single match), ran the
complete owning file on Kubuntu through `rig-test.sh`, wrote the original
bytes back and checked them against the HEAD blob (SHA-256 and `git diff
--quiet`). The first pass ran at `8bc6cc2c7`: R1 stayed green there (the
`refresh` sweep just before the final gate already cancels an operation it
stops, so the gate's own check was masked), and L7 and L8 had no test of
their own. Those three got their own cases in `6480a8811`, and all 26
drills were run again at `6480a8811`: all 26 turned their tests red (exit

1. and all 26 restored byte-exact. The table is that second pass.

| #   | Guard                                            | Mutation                                            | Failing test(s)                                                                                         |
| --- | ------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| R1  | Final gate checks the authority (P1)             | the write's gate checks only `state === 'approved'` | `starts no approved write when the policy changes while the target is re-read…`                         |
| R2  | Authority read again after the receipt wait (P1) | drop the dispatch's `refresh()`                     | P1 revocation and kill switch; `cancels on denial, expiry, a changed grant or the kill switch`          |
| R3  | Kill switch in the authority (P1)                | `return 'killSwitch'` → `return undefined`          | P1 kill switch; `cancels on denial…`                                                                    |
| R4  | Disconnect in the authority (P1)                 | drop `if (this.isClosed) return 'disconnect'`       | P1 disconnect; `opens no approvable write after the client disconnects over stdio (P2-3)`               |
| R5  | Grant, scope, confidential policy (P1, P2-2)     | `: 'revoked'` → `: undefined`                       | P1 revocation, confidential policy and final gate; `withholds a read result when the grant is revoked…` |
| R6  | The gate itself                                  | `Operation.gate` returns `true`                     | 7 cases: both P2-3 cancellation cases, all four P2-2 cases, the gate unit test                          |
| R7  | A lease recorded after its call ended is freed   | release a read lease only after `settled`           | `frees a lease recorded after its call was cancelled…`; `settles every read at the deadline…`           |
| R8  | Authority read again before delivery (P2-2)      | drop the delivery `refresh()`                       | `withholds a read result when the grant is revoked…`                                                    |
| R9  | Refusal at delivery ends the call refused (P2-4) | always `move('settled')`                            | `records a final result refused for its size…`                                                          |
| R10 | Stop follows the operation's scope (P2-5)        | Stop admits with the named workspace only           | `lets the user-library grant stop a user-library save that named a workspace…`                          |
| R11 | Transport receipt (P2-4)                         | drop `this.server.transport(code)`                  | `leaves one transport receipt…`; `reads no further frame…`                                              |
| R12 | Receipts backlog (P2-4)                          | drop `await protocol.ready()`                       | `reads no further frame…`; `leaves one transport receipt…`                                              |
| R13 | A hung journal counts as failed                  | drop `if (this.hung > 0) return false`              | `counts a hung journal as failed…`                                                                      |
| R14 | A started write is never cancelled               | `isStartedWrite = false`                            | `reports stopRequested…`; `takes only the table’s edges…`                                               |
| R15 | Terminal states have no exits                    | `settled: ['cancelled']`                            | `takes only the table’s edges…`                                                                         |
| R16 | Kill switch control receipt (P2-4)               | drop the `kill` control receipt                     | runtime `parses only its own words and needs a terminal confirmation…`                                  |
| R17 | A signal aborted before attaching cancels        | drop `if (signal.aborted) this.check()`             | `stops at its gate… even for a signal that aborted before attaching`                                    |
| R18 | A late hold runs at once                         | drop `else release()`                               | `runs a hold when the operation leaves its states, or at once…`                                         |
| L1  | No age: the watched lease (P2-3)                 | every observed lock counts as expired               | `never removes a live owner’s lock for its age`; both "keeps both debits" cases                         |
| L2  | Takeover moves only the judged instance (P2-3)   | any moved instance counts                           | `keeps both debits when two servers recover one crashed owner’s lock`                                   |
| L3  | Note id as well as identity (inode reuse)        | compare native identity only                        | same                                                                                                    |
| L4  | Owner provably gone (pid, start time)            | `isGone: false`                                     | `takes over at once a lock whose owner is provably gone`; the two-contender case                        |
| L5  | Torn note watched briefly                        | a torn note never expires                           | `takes over a torn lock…`                                                                               |
| L6  | Fence: exclusive link of the next generation     | `link` → `rename` (overwrite)                       | `lands nothing from a holder that lost its lock while paused…`                                          |
| L7  | Fence: ours must be the newest                   | newest check → `< 0`                                | `lands nothing from a lost holder whose generation was already pruned…`                                 |
| L8  | A holder never publishes past its own lease      | drop the `isHeld()` check                           | `refuses to publish once its own lease has ended…`                                                      |

Restored SHA-256 (HEAD blobs at `6480a8811`; only `registry.ts` differs
from `8bc6cc2c7`, where it was `4515446124f0a759…`):

| File                               | SHA-256                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| `src/core/connector/registry.ts`   | `93351b8098adee32b43f0533dc3b47383852cf6d70abee9355646ccf2c64480e` |
| `src/core/connector/operations.ts` | `03fbcea17aa0465641767c5c39cad115d5f02003c6427d24feb3f30ddf7acd78` |
| `src/core/connector/protocol.ts`   | `8759c67a9a18d818a87a68024ce3dea6b4977541b299610975b09c41e6d20737` |
| `src/runtime/connector/stdio.ts`   | `715ced45a7a51afeacc594070f8a698d394dcada32c703146da6a57f8efdbba5` |
| `src/core/connector/audit.ts`      | `8c3e998dac39c1019d0e919ae345a0c5d7efe03fe981aae11e81b001ba9a7539` |
| `src/runtime/connector/command.ts` | `8fa174b4be846820ae37a5597815334b4e3f2a1b7feadcd7c48534b0be4432c9` |
| `src/runtime/connector/store.ts`   | `968f232e45af976e0b20d98d31c3b79ddaa60dfc839482b49383c36f598a3281` |

### Gates and sizes

- `npx tsc -p .` (host), webview, unit and integration projects: exit 0.
  The e2e project keeps only the two pre-existing `test/e2e/acpFixture.ts`
  TS2345 errors recorded above (failing identically on `d0b88d09a`).
- ESLint `--max-warnings=0` and Prettier on every changed file: clean (and
  again in the pre-commit hook, which changed nothing; gitleaks: no
  leaks). `npx knip`: exit 0 (the two pre-existing configuration hints).
  `npm run cycles`: no circular dependency. `npm run duplication`: the two
  clones that exist on `2fa594639` (`connectorStdio.e2e`/`schedulesStdio.e2e`,
  `windowsTrustedPath`; exit 1 there too, checked on the rig), none added:
  the four this lane first added were removed in `6480a8811`.
  `check:badges`: exit 0.
- `check:l10n` 0 problems (only `CONNECTOR_MODEL_TEXT` changed: English by
  D6), `check:host-api` (record regenerated: `node:events` −1, `node:os`
  +1, `node:timers/promises` +1), `check:reference` current, `check:plan`
  0 drift, `check:roadmap` current.
- `npm run build` on Kubuntu at `6480a8811`: exit 0, every budget check `ok`.

  | Bundle                  | `2fa594639` |   After | Budget  |
  | ----------------------- | ----------: | ------: | ------- |
  | `dist/extension.js`     |     563,348 | 563,348 | 600 KiB |
  | `dist/connector.js`     |      92,519 |  99,825 | 100 KiB |
  | `dist/acp.js`           |     242,286 | 242,286 | 850 KiB |
  | `dist/uiText.js`        |      95,226 |  95,226 | 125 KiB |
  | `dist/uiTextRuntime.js` |       5,550 |   5,550 | 25 KiB  |

  `dist/extension.js` SHA-256 `34b93af4902136c711cf93d1dc7ad2e96fdf4ef3802756154f355235381e371a`,
  identical to the base. `dist/connector.js` is at 97.5 KiB of its 100 KiB
  budget (no cap raised); the next connector feature needs room made first.

- Not run here: the aggregate `npm run quality` and the whole unit suite
  (hosted CI is the merge gate).

### Rule 10 and open items

- AGENTS rule 10 (every README command run successfully) is still unmet for
  the three client commands (`codex mcp add`, `claude mcp add`, `gemini mcp
add`) and the configuration snippets: running them writes the owner's
  global client configuration. The README and `docs/mcp.md` now say so. The
  connector's own commands (`mcp grant`, `status`, `revoke`, `kill`,
  `resume`) were run as recorded above; `grant` and `resume` with a typed
  `y` ran through the interactive port, not a real terminal.
- RVM124 finding 15 (storage ownership, Windows DACL) stays open.
- The open items of the local phase above are unchanged.
