# Agent SDKs, adapters and CLIs — currency table (2026-11-02)

Lane RLF-UPSDK, rig `macbook`, worktree `/Users/user/lanes/RLF-UPSDK`.
Registry facts were first read through `https://registry.npmjs.org/`
on 2026-11-02 while the first run's shell was approval-blocked, and
re-verified the same day with `npm view <pkg> version` for all seven
components when the lane resumed (newest unchanged: 1.4.14, 2.4.0,
1.32.2, 0.100.0, 2.5.0, 0.66.0, 1.0.105). Package diffs below are
`npm pack` tarballs of the old pins diffed against the installed new
pins on 2026-11-02. Changelogs read the same day: ACP TypeScript SDK
and Claude adapter `CHANGELOG.md` in full from our pinned versions
up; the Muse Code changelog
(`https://dev.meta.ai/docs/muse-code/changelog`) re-read 2026-11-02
for 1.4.12/1.4.13 in full (it still carries no 1.4.14 section), on
top of the 2026-10-30 read in
`docs/research/agents-sdks-2026-10-30.md` §§1–2. The pinned CLI's
own `--help` (`muse`, `muse serve`, `muse exec`, `muse usage`)
was read from 1.4.14-R7309.1 the same day. D260 (PLAN.md §2)
removed the 7-day `min-release-age` wait the same day, so no row
below waits.

Diff this table against the next round's: one row per component, the
version we pin or test at, the newest published that day, and the
verdict.

| Component                               | Ours before    | Newest 2026-11-02 | Ours after         | Verdict                                                                                                                                  |
| --------------------------------------- | -------------- | ----------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `@muse-code/sdk`                        | 1.4.12         | 1.4.14            | **1.4.14**         | Taken. Fingerprint `cfdb6d25…b4e0` → `c94c3d1f…49c6`; additive MSP only                                                                  |
| Muse Code CLI (rig pin)                 | 1.4.11-R6667.1 | 1.4.14-R7309.1    | 1.4.14-R7309.1     | Rig pin already current and tier-verified; SDK pin now matches it                                                                        |
| `@agentclientprotocol/sdk`              | 2.0.1          | 2.4.0             | **2.4.0**          | Taken. No break on stable v1 / `/unstable`; MCP-over-ACP named, not taken                                                                |
| `@modelcontextprotocol/sdk` (test-only) | 1.32.1         | 1.32.2            | **1.32.2**         | Taken. Maintenance line; our MCP client stays hand-rolled (D213)                                                                         |
| Claude adapter `claude-agent-acp`       | 0.99.1 tested  | 0.100.0           | **0.100.0 tested** | Install-time version; `strictMcpConfig` re-verified in 0.100.0's `dist/` and ACP v1 `initialize` answered (2026-11-02)                   |
| Codex adapter `codex-acp`               | 2.5.0 tested   | 2.5.0             | 2.5.0              | Current. Note: `@zed-industries/codex-acp` is deprecated in favour of `@agentclientprotocol/codex-acp`, which is what we already install |
| Gemini CLI (`@google/gemini-cli`)       | 0.66.0 cited   | 0.66.0            | 0.66.0             | Current                                                                                                                                  |
| Copilot CLI (`@github/copilot`)         | user-installed | 1.0.105           | user-installed     | Recorded; we pin nothing (the person's own CLI)                                                                                          |

## What each release carries (from our old pin up)

- **Muse 1.4.13** (changelog, read 2026-10-30): `muse usage`
  shows the subscription allowance without a model turn; `--yolo`
  keeps `request_user_input` and enables async questions, with
  `--disable-request-user-input` for runs that ask nothing;
  filesystem `deny` enforced on `:ask-me` profiles (macOS/Linux);
  untrusted-workspace sessions fail closed; resumed chats that lost
  a permission change reset narrower; `turn/unqueue` behind an
  internal turn; third-party models offered to connected clients
  (arrives through `model/list` with no code of ours).
- **Muse 1.4.12** (already our base; for the record): `muse serve
--preset`; profile `network.local_ports`; multi-root
  `workspaceRoots` writes; `muse serve -c hooks.…` honoured in
  served sessions; snapshot `activeTurn` names the turn a Replace
  started (we consume it as `activeTurnId` already).
- **SDK 1.4.14** (tarball diff 1.4.12 → 1.4.14, re-run 2026-11-02):
  only `facade/approval.js`, `facade/client.{d.ts,js}`,
  `fingerprint.{d.ts,js}`, `msp.d.ts` and `package.json` differ —
  the `connection/*` modules we import are byte-identical.
  `msp.d.ts` adds twelve types and nothing removed
  (`ApprovalCuaDataFact`, `ApprovalCuaMask`, `EarlierHistory`,
  `EarlierHistoryMessage`, `HeldFor`, `QueuedInput`, `ReplayHint`,
  `RuntimeWorktree` + its cleanup/ownership types,
  `SessionSpawnedBy`; fields `reviewerReason`, `heldFor`,
  `earlierHistory`, `queuedInputs`, `spawnedBy`). No 1.4.14
  changelog section existed on 2026-11-02 either. The pinned CLI
  serves the new fingerprint over the echo provider
  (`test/fixtures/m127/initialize-1.4.14.json`).
- **ACP SDK 2.0.2**: CR line endings in SSE streams; request-scoped
  HTTP POST failures isolated. (The 2026-10-30 tarball diff also
  recorded a stdio line-buffer LF/CRLF fix in `dist/core/`.)
- **ACP SDK 2.1.0**: `RequestError.sessionNotFound`; MCP-over-ACP
  caller/provider, HTTP bridge and MCP-SDK serving (`/unstable`);
  schema v1.27.0 / v2.0.0-alpha.10; no raw invalid messages printed;
  Rust-matching parsing for null lists, elicitation scope and
  64-bit integers.
- **ACP SDK 2.2.0**: schema v1.28.0; v2-only helpers (unadvertised
  MCP transport rejection, `ActiveSession.configOptions` sync).
- **ACP SDK 2.3.0**: schema v1.29.0 → v1.29.1; example-only fix.
- **ACP SDK 2.4.0**: callers can stop waiting for a cancelled
  request.
- **MCP SDK 1.32.2** (GitHub Release `1.32.2`, read 2026-11-02 —
  the repository carries no root `CHANGELOG.md`; releases are the
  changelog): explicit `| undefined` on `Transport` optional
  properties (v1.x backport), and registering after `connect()`
  allowed when the capability was declared. Test-only for us; the
  `Transport` typing is the one compile surface to watch in
  `test/unit/helpers/connectorSdkClient.ts`.
- **ACP unstable additions by 2.4.0** (method-table diff,
  2026-11-02; the stable v1 table is byte-identical): agent
  methods `session/archive`, `session/unarchive`, `session/status`,
  `session/set_title`, `auth/status`; client notification
  `auth/status_update`; `PROXY_METHODS` (`proxy/initialize`,
  `proxy/successor`, not routed through the agent/client APIs);
  `dist/mcp/` + `v1/unstable/mcp` (MCP-over-ACP); new core helpers
  `connection-access`, `treatSessionNotFoundAsSuccess`,
  `RequestError.sessionNotFound` (`-32002`), the pre-`initialize`
  gate and stream byte limits (we already pass
  `ACP_MAX_MESSAGE_BYTES`). All the new methods are
  `@experimental` and capability-gated (`sessionCapabilities.archive` /
  `.status` / `.title`, `auth.status`); our agent advertises none.
  Took / named per item: the certification record.
- **Claude adapter 0.100.0**: v2 background tool calls and work
  reporting, subagent working directories, "why Claude Code could
  not start a session"; rides ACP SDK 2.4.0 and Claude Agent SDK
  0.3.316 (Claude Code 2.1.316); request validation aligned to the
  latest ACP spec. Our integration is ACP v1 (`initialize`,
  `session/new` with `_meta.claudeCode.options.strictMcpConfig`),
  so the v2 surface changes nothing we send. Verified 2026-11-02
  from the installed 0.100.0: `strictMcpConfig: true` still stands
  in its session-rebuilding options table (`dist/acp-agent.js`),
  and a raw ACP v1 `initialize` over stdio answered
  `agentInfo.version 0.100.0`, protocol 1. The same probe answered
  for `codex-acp` 2.5.0 and `gemini --acp` 0.66.0 (both installed
  fresh in a scratch folder; Gemini's bundle still carries
  `--allowed-mcp-server-names`, our no-user-servers switch).
  No model turn was run through any of them (no sign-in in the
  scratch home; initialize only).

Per-version took / named-not-took, with reasons:
`docs/certification/rlf-upsdk.md`.
