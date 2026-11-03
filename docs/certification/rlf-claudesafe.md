# RLF-CLAUDESAFE — no Claude account put at risk (D262, 2026-11-02)

Base `cc/int10` (`9e25295f5`), rig linuxlt. Rules, quotes and the upstream
issue text: `docs/research/claude-account-safety-2026-11-02.md`.

## What was found before the change

- **Plan tokens.** Nothing in `src` named `CLAUDE_CODE_OAUTH_TOKEN`. A team
  worker (`spawnAcpAgent` → `scrubWorkerEnv`) keeps an allowlist, so the token
  reached a worker only through a profile's `passthrough`, which no caller set
  but any name could fill. The external orchestrator (`withoutCredentials`)
  dropped `CLAUDE_CODE_OAUTH_TOKEN` and `_REFRESH_TOKEN` by the `_TOKEN` suffix
  but passed `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR` and `_SCOPES`; a name in
  `museSpark.shell.passEnvironmentVariables` passed any of them to interactive
  shell commands, and the vault fence passed listed names (and Muse Code's
  child skipped its credential check). The adapter's guard lets any
  `tokenSource` pay (`billsClaudeSubscription`, `holdsNonSubscriptionCredential`
  at v0.100.0), so such a token would bill the plan with the guard passing.
- **Version.** Upstream `da9f7e5` (2026-09-04, #1079, "refuse claude.ai
  subscriptions under `--hide-claude-auth`") is first in tag v0.74.0
  (`git tag --contains`), published to npm 2026-09-04T11:11Z. No pin existed in
  `src`; the PATH preset had no version check.
- **Refusal.** `asAcpSdkError` dropped `data.reason`; the panel's sentence named
  `signInCommand: 'claude'`, the plan login, which the guard refuses again.

## What landed (commit `0277ddc5e` and the records commit)

1. `CLAUDE_PLAN_ENV_NAMES` (`CLAUDE_CODE_OAUTH_TOKEN`, `_FILE_DESCRIPTOR`,
   `_REFRESH_TOKEN`, `_SCOPES`) are credential variables everywhere and are
   dropped even where listed: `withoutCredentials`, `workerEnvironment`, the
   vault fence (Muse Code's child too). A profile that names one is refused in
   words (`claudePlanVariableRefused`, 15 languages) by `spawnAcpAgent`; one
   listed in `museSpark.shell.passEnvironmentVariables` is dropped without
   words (see Remaining).
2. `CLAUDE_AGENT_ACP_MIN_VERSION = 0.74.0`; both the orchestrator and team
   workers read `agentInfo.version` after `initialize` and stop the adapter
   before any session when it is older or unreadable, with
   `npm install -g @agentclientprotocol/claude-agent-acp@0.100.0`. Install pin
   `ACP_PRESET_INSTALLS.claude.version = 0.100.0`.
3. `AcpAuthRequiredError` carries `reason` and the agent's message; Claude's
   preset, or any agent refusing with the adapter's reason or its plain
   sentence, gets `claudeAgentNeedsKey` (15 languages): a key or a Console
   account, with the adapter's `console-login` terminal method when listed,
   else `claude auth login --console`. The preset's `signInCommand` is that
   Console login.
4. With the person's `ANTHROPIC_API_KEY` set, Claude's preset gets that key and
   `CLAUDE_CONFIG_DIR=<globalStorage>/claude-agent-config` (0700, created
   empty); nothing is copied out of `~/.claude`.
5. "Claude Agent" in the preset, the setting description (15 manifests), the
   generated reference; `backendExternal` "(Its Own Account)"; Claude-specific
   leader and switch notices; the `externalAgents.ts` comments say Claude's
   preset takes a key or a Console account only.
6. `externalAgentPickNotice`: the pick modal (orchestrator and team) appends
   `externalAgentClaudePlanWarning` for a custom entry starting Claude without
   `--hide-claude-auth` (command and arguments only).
7. `anthropic/api` pooling `on` → `confirm` with the AUP's two sentences first;
   `anthropic/claude-plan` stays `notOffered` with the full legal sentence and
   the AUP's proxy sentence; both rows `checkedAt: 2026-11-02`.

## Red/green drills (each broke the code once, `test/unit/team/claudeAgentSafety.test.ts` exited 1, reverted, exited 0)

| Drill | Break                                                         | Red    | Green  |
| ----- | ------------------------------------------------------------- | ------ | ------ |
| 1     | `workerEnvironment` lets a plan route through its passthrough | exit 1 | exit 0 |
| 2     | version floor lowered to 0.73.0                               | exit 1 | exit 0 |
| 3     | `withoutCredentials` honours a listed plan route              | exit 1 | exit 0 |
| 4     | custom-entry detection always false                           | exit 1 | exit 0 |
| 5     | `anthropic/api` pooling back to `on`                          | exit 1 | exit 0 |
| 6     | Claude's preset `pays` back to `subscription`                 | exit 1 | exit 0 |
| 7     | `readStoredTeam` returns a saved Claude ref unchanged         | exit 1 | exit 0 |

## Real use with no model request

Stated before: 0 model requests, no Muse request, no paid call. The real
adapter 0.100.0 in `$TMPDIR` driven over ACP with `--hide-claude-auth`, no key,
clean environment, plan-signed-in `~/.local/bin/claude`: `session/new` refused,
`-32000`, `data.reason: "claude_subscription_not_supported"`; 0 prompts, 0 usage
updates, 0 message chunks: 0 model requests counted. `claude auth status` under
an empty `CLAUDE_CONFIG_DIR`: `loggedIn: false`; with a placeholder key:
`apiKeySource: ANTHROPIC_API_KEY`. A first run that kept the lane harness's own
`CLAUDE_CONFIG_DIR` created a session (identity "Not logged in"); that folder is
the lane's own Claude Code configuration, not the plan login, and was not read.
No credential file, key or token was read or printed.

Not run here: the packed product (VSIX) driving Claude's preset end to end
with a real Anthropic key (no key on this rig, and no paid call is allowed);
the lead runs it.

## Activation budget

`modelsActivationBudget` (lane K, 3 KiB over the pre-K bundle): base growth
2824 bytes; this lane first measured 3211 (red), so the settings-level words
for a listed shell name (147 bytes) and then a tool-layer variant (+293) were
taken out; final growth 3064 (green). The budget was not raised.

## Remaining

- Words for a plan route listed in `museSpark.shell.passEnvironmentVariables`:
  the route never passes, but saying so costs activation bytes the lane K
  budget does not have; a lazily loaded place (the setting's own validation
  in the Settings panel) is the follow-up.
- Settled by the lead (2026-11-02): Claude's preset carries `pays: 'key'`, so
  the team's spend consent applies, as an API key spends real money; the other
  four keep `subscription`. A pool entry saved before with Claude as
  `subscription` reads as `key` (`withPresetPays` in `readStoredTeam`). Not
  normalised: the orchestrator slot's stored ref
  (`readOrchestratorOverride`; no spend consent reads its `pays`) and the
  CLI's `exec` team path (it runs engine entries only).
- The packed product's real use with a real Anthropic key (no key on this rig,
  no paid call allowed).

## Gates

Recorded with exit codes in the lane's final message.
