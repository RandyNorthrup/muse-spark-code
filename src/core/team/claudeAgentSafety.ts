// D262 (lane RLF-CLAUDESAFE): no Claude account is put at risk through this
// product. Claude's preset bills an Anthropic API key or a Console account
// only (`claude-agent-acp --hide-claude-auth`); these are the facts and words
// around that guard: the adapter's version floor, its refusal read as the
// key it needs, the empty configuration a keyed preset runs with, and the
// warning for a custom entry that would start Claude on a plan. Nothing here
// reads a credential: the environment is asked only whether a key is set.
// The rules and their sources: docs/research/claude-account-safety-2026-11-02.md.

import type { AuthMethod } from '@agentclientprotocol/sdk'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { ExternalAgent } from './externalAgents'

/** The adapter's npm package (the ACP registry's distribution). */
export const CLAUDE_AGENT_ACP_PACKAGE = '@agentclientprotocol/claude-agent-acp'
/**
The first release whose `--hide-claude-auth` refuses a Claude plan: upstream
commit da9f7e5 (2026-09-04, #1079) is first contained in tag v0.74.0,
published to npm the same day. Before it the flag only hid the sign-in.
*/
export const CLAUDE_AGENT_ACP_MIN_VERSION = '0.74.0'
/** The install pin: the newest release, read 2026-11-02 (agent SDKs wait for no release age). */
export const CLAUDE_AGENT_ACP_VERSION = '0.100.0'
/** The command that updates the adapter to the pin. */
export const CLAUDE_AGENT_ACP_UPDATE_COMMAND = `npm install -g ${CLAUDE_AGENT_ACP_PACKAGE}@${CLAUDE_AGENT_ACP_VERSION}`
/** The switch that makes the adapter refuse a Claude plan. */
export const HIDE_CLAUDE_AUTH_ARG = '--hide-claude-auth'
/** The adapter's `authRequired` `data.reason` for a refused plan (its hide-claude-auth.ts). */
export const CLAUDE_SUBSCRIPTION_REFUSAL_REASON = 'claude_subscription_not_supported'
/** The adapter's plain refusal when the account holds nothing it accepts. */
export const CLAUDE_LOGIN_REQUIRED_TEXT = 'Sign in with an API key or a Console account'
/** Claude Code's own Console sign-in, Anthropic's flow, never the plan's. */
export const CLAUDE_CONSOLE_LOGIN_COMMAND = 'claude auth login --console'
/** The adapter's Console terminal method id, offered only when `initialize` lists it. */
const CONSOLE_METHOD_ID = 'console-login'
/** The person's own key variable, the one key route Claude's preset receives. */
export const ANTHROPIC_API_KEY_VARIABLE = 'ANTHROPIC_API_KEY'
/** Claude Code's configuration folder variable (it replaces `~/.claude`). */
export const CLAUDE_CONFIG_DIR_VARIABLE = 'CLAUDE_CONFIG_DIR'
/** The folder under our storage that a keyed Claude preset runs with as its whole configuration. */
export const CLAUDE_AGENT_CONFIG_FOLDER = 'claude-agent-config'

/** Anthropic's page on third-party use of Claude Code, read 2026-11-02. */
export const ANTHROPIC_LEGAL_URL = 'https://code.claude.com/docs/en/legal-and-compliance'
/** Its sentence on plan sign-in in other apps, verbatim. */
export const ANTHROPIC_PLAN_LOGIN_QUOTE =
  'Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users.'

/** The release numbers of a version string and whether it is a prerelease, or undefined. */
function releaseOf(
  version: string,
): { readonly numbers: readonly number[]; readonly isPrerelease: boolean } | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    version.trim(),
  )
  if (match === null) return undefined
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    isPrerelease: match[4] !== undefined,
  }
}

/** Whether `found` is the floor's release or later; a prerelease of the floor comes before it. */
function isAtFloor(found: NonNullable<ReturnType<typeof releaseOf>>): boolean {
  const floor = releaseOf(CLAUDE_AGENT_ACP_MIN_VERSION)?.numbers ?? []
  for (const [index, part] of found.numbers.entries()) {
    const difference = part - (floor[index] ?? 0)
    if (difference !== 0) return difference > 0
  }
  return !found.isPrerelease
}

/**
Why the adapter found on the PATH must not start, in words, or undefined
when its reported version is the floor or later. An unreadable version is
refused too: only a version that proves the plan refusal passes.
*/
export function claudeAdapterVersionRefusal(version: string | undefined): string | undefined {
  const found = version === undefined ? undefined : releaseOf(version)
  if (version === undefined || found === undefined)
    return fill(UI_TEXT.claudeAgentVersionUnknown, {
      minimum: CLAUDE_AGENT_ACP_MIN_VERSION,
      command: CLAUDE_AGENT_ACP_UPDATE_COMMAND,
    })
  return isAtFloor(found)
    ? undefined
    : fill(UI_TEXT.claudeAgentTooOld, {
        version,
        minimum: CLAUDE_AGENT_ACP_MIN_VERSION,
        command: CLAUDE_AGENT_ACP_UPDATE_COMMAND,
      })
}

/** What an `authRequired` refusal carried: the adapter's `data.reason` and its message. */
export interface AuthRefusal {
  readonly reason?: string | undefined
  readonly detail?: string | undefined
}

/**
Whether a sign-in refusal is Claude's adapter asking for a key: always for
Claude's preset, and for any agent whose refusal carries the adapter's
plan reason or its plain "API key or a Console account" sentence.
*/
export function isClaudeKeyRefusal(
  agent: Pick<ExternalAgent, 'preset'>,
  refusal: AuthRefusal,
): boolean {
  return (
    agent.preset === 'claude' ||
    refusal.reason === CLAUDE_SUBSCRIPTION_REFUSAL_REASON ||
    (refusal.detail?.includes(CLAUDE_LOGIN_REQUIRED_TEXT) ?? false)
  )
}

/**
The Console sign-in to offer: the adapter's own terminal method when
`initialize` listed one, else Claude Code's `claude auth login --console`.
A plan login is never offered for Claude.
*/
export function claudeConsoleCommand(
  agent: Pick<ExternalAgent, 'command'>,
  methods: readonly AuthMethod[],
): string {
  const method = methods.find((entry) => entry.id === CONSOLE_METHOD_ID)
  if (method === undefined || !('type' in method)) return CLAUDE_CONSOLE_LOGIN_COMMAND
  const args = method.args ?? []
  return [agent.command, ...args].join(' ')
}

/** The sentence for Claude's refusal: a key or a Console account, never a plan. */
export function claudeNeedsKeySentence(
  agent: Pick<ExternalAgent, 'label' | 'command'>,
  methods: readonly AuthMethod[],
): string {
  return fill(UI_TEXT.claudeAgentNeedsKey, {
    agent: agent.label,
    command: claudeConsoleCommand(agent, methods),
  })
}

/**
The environment Claude's preset starts with, from the already scrubbed one.
When the person's own environment sets `ANTHROPIC_API_KEY` (theirs for
Claude's adapter, as `META_API_KEY` is Muse Code's, AGENTS.md rule 8), the
key passes and `CLAUDE_CONFIG_DIR` names our own empty folder, so no plan
login under `~/.claude`, nor the macOS Keychain entry keyed to it, can be
reached. Without a key the adapter reads the person's own configuration,
where a Console login or an `apiKeyHelper` lives, and its guard refuses a
plan. Any other agent's environment is returned as it is. Adding a key and
a folder cannot introduce a workspace PATH entry: a guarded environment
stays guarded.
*/
export function claudeAgentEnvironment<T extends NodeJS.ProcessEnv>(input: {
  readonly agent: Pick<ExternalAgent, 'preset'>
  readonly scrubbed: T
  readonly baseEnv: NodeJS.ProcessEnv
  readonly configDir: string | undefined
}): T {
  if (input.agent.preset !== 'claude' || input.configDir === undefined) return input.scrubbed
  const keyName = Object.keys(input.baseEnv).find(
    (name) => name.toUpperCase() === ANTHROPIC_API_KEY_VARIABLE,
  )
  const key = keyName === undefined ? undefined : input.baseEnv[keyName]
  if (key === undefined || key === '') return input.scrubbed
  const out: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(input.scrubbed)) {
    if (name.toUpperCase() !== CLAUDE_CONFIG_DIR_VARIABLE) out[name] = value
  }
  out[ANTHROPIC_API_KEY_VARIABLE] = key
  out[CLAUDE_CONFIG_DIR_VARIABLE] = input.configDir
  return out as T
}

/** The folder `claudeAgentEnvironment` chose for this child, to make before it starts. */
export function claudeConfigFolderOf(env: NodeJS.ProcessEnv): string | undefined {
  return env[CLAUDE_CONFIG_DIR_VARIABLE]
}

/** The bare program name of a command: no folder, no Windows extension, lowercased. */
function programName(command: string): string {
  const base = command.replaceAll('\\', '/').split('/').pop() ?? command
  return base.toLowerCase().replace(/\.(?:exe|cmd|bat|ps1)$/, '')
}

const CLAUDE_PROGRAMS: ReadonlySet<string> = new Set([
  'claude',
  'claude-agent-acp',
  'claude-code-acp',
])
const PACKAGE_RUNNERS: ReadonlySet<string> = new Set(['npx', 'bunx', 'pnpx'])

/**
Whether a person's own external agent starts Claude without
`--hide-claude-auth`, so it may bill their Claude plan. Decided by the
command and its arguments alone; no credential is ever read to decide.
A preset is never one: Claude's preset always passes the switch.
*/
export function isClaudeOnPlan(agent: Pick<ExternalAgent, 'command' | 'args' | 'preset'>): boolean {
  if (agent.preset !== undefined) return false
  const program = programName(agent.command)
  const isClaudeProgram =
    CLAUDE_PROGRAMS.has(program) ||
    (PACKAGE_RUNNERS.has(program) &&
      agent.args.some((arg) => /claude-(?:agent|code)-acp/i.test(arg)))
  return isClaudeProgram && !agent.args.includes(HIDE_CLAUDE_AUTH_ARG)
}

/** The warning shown before such an agent's first use: Anthropic's sentence, its link, the risk. */
export function claudePlanWarning(agent: Pick<ExternalAgent, 'label'>): string {
  return fill(UI_TEXT.externalAgentClaudePlanWarning, {
    agent: agent.label,
    quote: ANTHROPIC_PLAN_LOGIN_QUOTE,
    url: ANTHROPIC_LEGAL_URL,
  })
}

/**
The modal that confirms picking an external agent: who pays, true per agent
(Claude's preset is paid by a key or a Console account only), and for a
custom entry that would start Claude on a plan, the warning after it.
*/
export function externalAgentPickNotice(
  agent: Pick<ExternalAgent, 'label' | 'command' | 'args' | 'preset'>,
): string {
  const notice = fill(
    agent.preset === 'claude'
      ? UI_TEXT.teamExternalSwitchNoticeClaude
      : UI_TEXT.teamExternalSwitchNotice,
    { agent: agent.label },
  )
  return isClaudeOnPlan(agent) ? `${notice}\n\n${claudePlanWarning(agent)}` : notice
}
