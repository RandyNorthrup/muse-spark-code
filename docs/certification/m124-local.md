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
