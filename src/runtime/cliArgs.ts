import { compareUsdAmounts, nonnegativeUsdSchema, type UsdAmount } from '../shared/usdSchema'
// The agent's command line (PLAN.md D62): serve ACP on stdio, or one of the
// sign-in commands the editors' terminal sign-ins run (D61). Pure: the
// arguments in, what to do out, with the reason when they make no sense.

import { parseArgs } from 'node:util'
import * as z from 'zod/mini'
import { CLI_OPTION_REGISTRY } from './cliOptions'
import {
  ACCOUNT_DEFAULT_ID,
  ACP_AGENT_NAME,
  ACP_BACKENDS,
  ACP_DEFAULT_BACKEND,
  ACP_PAID_FEATURES,
  ACP_PAID_FLAGS,
  GITHUB_AUTH_ACTIONS,
  type AcpBackendKind,
  type AcpPaidFeature,
  CHATGPT_NEW_ACCOUNT_FLAG,
  GROK_CLIENT_ID_FLAG,
  GROK_DEVICE_FLAG,
  GROK_SCOPES_FLAG,
  MILLISECONDS_PER_SECOND,
  PROVIDER_SPEND_DAYS_DEFAULT,
  PROVIDER_SPEND_DAYS_MAX,
  SETTING_DEFAULTS,
  SHELL_SANDBOX_MODES,
  type ShellSandboxMode,
  TAB_DAILY_BUDGET_MIN_USD,
  TAB_MODELS,
  TAB_NO_BUDGET_USD,
  TAB_TRIGGER_MODES,
  type TabTrigger,
  TIMER_MAX_DELAY_MS,
  UI_TEXT,
  REPORT_KINDS,
} from '../shared/constants'
import { COMPANION_VOICE_RELEASE } from '../shared/companionVoice'
import { modelRef } from '../host/backend/providerPolicyEntry'
const { isProviderId, isStorableModelId } = modelRef
import type { OpenRouterPrivacy } from '../core/providers/presets'
import { accountIdSchema } from '../shared/accounts'
import { fill } from '../shared/l10n/text'
import { parseExec } from './exec/execArgs'
import {
  CLI_HELP_TOPICS,
  helpTopicNamed,
  topicShownOptionNames,
  unknownOptionReason,
} from './cliHelp'
import { nearestOptionName } from './editDistance'
import { resourceFlagOverrides } from './resources/args'
import type { ResourceSettings } from '../shared/resources'
import type { ResourceCommandAction } from './resources/port'
import { parseLegalArgs, type LegalOptions } from './legal/legalArgs'
import { parseJudgeArgs, type JudgeCliCommand } from './judge/args'
import type { UsageQuery } from '../shared/usagePage'
import type { UsageSection } from './usage/usageAdapter'

export type UsageCommand =
  | { readonly action: 'open' }
  | { readonly action: 'stdio' }
  | {
      readonly action: UsageSection | 'export'
      readonly query: UsageQuery
      readonly format: 'text' | 'json' | 'csv'
      readonly out?: string
    }
import type { ChatGptProviderAction } from './chatGptProviderCommands'
import type { GrokProviderAction } from './grokProviderCommands'
import type { GitHubAuthAction } from './authCommands'
import { questionDeferSeconds } from '../shared/questionDeadline'
import { parsePlaybookCommand } from './playbook/command'

/** U's CLI route; the runtime entry owner binds runPlaybookCommand to P's
journal before the general ACP/auth parser. No model process is needed.
@unwired unassigned read only by tests deleted 2026-10-17 (no fakes) */
export function parsePlaybookCommandLine(argv: readonly string[]) {
  return argv[0] === 'playbook' ? parsePlaybookCommand(argv.slice(1)) : undefined
}
import {
  parseScheduleCommand,
  scheduleBudgetUsd,
  type ScheduleCommandOptions,
} from './schedules/args'
import { parseAttachArgs, type ExecAttachmentOptions } from './exec/attachArgs'
import {
  parseAccountsCommand,
  type AccountsCommand,
  type AccountTarget,
} from './providers/accountArgs'
import { parseVaultCommand, vaultUsage, type VaultCommandOptions } from './vault/vaultCommand'

export interface ServeOptions {
  readonly initialModelId?: string
  readonly usageHistory?: boolean
  readonly companionVoice?: boolean
  /** Which account pays; chosen here, never guessed (D62). */
  readonly backend: AcpBackendKind
  /** A folder's rules, skills and memory load (D13's flag, as Muse Code takes it). */
  readonly trustWorkspace: boolean
  /** The Muse Code CLI to run; empty to find it where the panel looks. */
  readonly museBinary: string
  readonly shellSandbox: ShellSandboxMode
  readonly canBypass: boolean
  readonly allowsContributorModels: boolean
  /** The paid features whose flags were given (M63c); each use asks first (M58). Model API only. */
  readonly paidFeatures: readonly AcpPaidFeature[]
  /**
  C-M95-SUB: drive the Model API backend from the Muse Code
  subscription instead of a stored key. Model API only.
  */
  readonly subscription?: boolean | undefined
  /** The finest log detail on stderr. */
  readonly isVerbose: boolean
  /** Interactive ACP questions; no forms still defer at once. */
  readonly questionsDeferAfterSeconds?: number
  readonly autoCompaction?: boolean | undefined
  readonly scheduledPrompts?: boolean
  readonly maxBudgetUsd?: UsdAmount
  /** TOOLCAP: the run's per-tool-result byte guard, if raised for one run. */
  readonly maxToolOutputBytes?: number | undefined
}

/**
`lsp` (M104 lane H, PLAN.md D84): Tab served to an LSP editor. Paid use
waits for `--tab` and, in every request, D48's question; Tab reads files
only with `--trust-workspace`.
*/
export interface LspOptions {
  /** The workspace root; the folder the server starts in unless named. */
  readonly workspace: string
  /** `--tab`: the paid feature on. Without it the credential store is never read. */
  readonly isTabOn: boolean
  /** `--trust-workspace`: Tab reads files, the workspace's hooks run, Always is kept. */
  readonly isTrusted: boolean
  readonly tabModel: string
  /** 0 is no daily budget (D208). */
  readonly tabBudgetUsd: UsdAmount
  /** 0 is the model's record maximum (D121). */
  readonly tabMaxOutputTokens: number
  readonly tabTrigger: TabTrigger
  /** `--verbose`: every detail on stderr, the editor's language-server log. */
  readonly isVerbose: boolean
}

/** What `report` prints: the scrubbed draft as text, or its exact bytes in a file. */
export interface ReportOptions {
  /** Write the report to this file instead of stdout; undefined prints it. */
  readonly out: string | undefined
  /** What was happening, in the user's own words (capped and scrubbed by the builder). */
  readonly description: string
  /** Section switches: the user can leave items out before anyone reads them. */
  readonly includeFacts: boolean
  readonly includeEvents: boolean
}

/** `providers models <entry> [--add <model>] [--remove <model>] [--force <reason>]` (D120). */
export interface ProvidersModelsOptions {
  /** The provider entry id whose model list changes. */
  readonly entry: string
  /** Models to offer; empty lists nothing. */
  readonly add: readonly string[]
  /** Models to stop offering; empty removes nothing. */
  readonly remove: readonly string[]
  /** Why an unlisted model is added anyway; shown on the entry. */
  readonly force: string | undefined
}

/** `providers add` flags (M95, PLAN.md D74): the terminal runs the same checks as the wizard. */
export interface ProvidersAddOptions {
  /** The preset to add from (or a configured provider id for `custom --as`). */
  readonly preset: string
  /** The entry id when it differs from the preset (`custom` servers). */
  readonly as?: string | undefined
  /** A custom server's address, a loopback address or an Azure resource. */
  readonly address?: string | undefined
  /** A custom server's wire format (D74: chat, responses or anthropic). */
  readonly format?: 'chat' | 'responses' | 'anthropic' | undefined
  /** The models to offer (`<modelId>` as the provider lists them). */
  readonly models: readonly string[]
  /** Validated window applied to each selected local-server model. */
  readonly contextWindow?: number | undefined
  /** OpenRouter's privacy routing; the default stays `zdr` (D74). */
  readonly privacy?: OpenRouterPrivacy | undefined
  /** Confirm a private-network address (asked once, D74). */
  readonly privateOk: boolean
  /** Read the key from standard input (never an argument or the environment). */
  readonly keyFromStdin: boolean
}

export type RuntimeCommand =
  | { readonly command: 'dictate'; readonly paid: boolean; readonly trustWorkspace: boolean }
  | { readonly command: 'usage'; readonly options: UsageCommand }
  | { readonly command: 'schedule'; readonly options: ScheduleCommandOptions }
  | { readonly command: 'vault'; readonly options: VaultCommandOptions }
  | {
      readonly command: 'judge'
      readonly action: JudgeCliCommand['action']
      readonly options: JudgeCliCommand['options']
      readonly surfaceArgs: JudgeCliCommand['surfaceArgs']
    }
  | { readonly command: 'node'; readonly argv: readonly string[] }
  | { readonly command: 'setup'; readonly options: ServeOptions; readonly maintenance: boolean }
  | { readonly command: 'lsp'; readonly options: LspOptions }
  | { readonly command: 'supervise'; readonly args: readonly string[] }
  | { readonly command: 'stop' }
  | {
      readonly command: 'exec'
      readonly options: ExecAttachmentOptions
      readonly resourceOverrides: Partial<ResourceSettings>
    }
  | {
      readonly command: 'resources'
      readonly action: ResourceCommandAction
      readonly json: boolean
    }
  | { readonly command: 'chatGptProvider'; readonly action: ChatGptProviderAction }
  | { readonly command: 'grokProvider'; readonly action: GrokProviderAction }
  | {
      readonly command: 'scan-secrets'
      readonly file: string
      readonly keyFromStdin: boolean
      /**
      D121: a CI-set deadline in milliseconds, or absent when the scan
      runs until it finishes. No default of ours.
      */
      readonly timeoutMs?: number | undefined
    }
  | { readonly command: 'report'; readonly options: ReportOptions }
  | { readonly command: 'legal'; readonly options: LegalOptions }
  | { readonly command: 'reports'; readonly args: readonly string[] }
  | { readonly command: 'fontsInstall'; readonly sourceDirectory: string | undefined }
  | { readonly command: 'playbook'; readonly argv: readonly string[] }
  | { readonly command: 'mcp'; readonly argv: readonly string[] }
  | { readonly command: 'estimate'; readonly argv: readonly string[] }
  | { readonly command: 'serve'; readonly options: ServeOptions }
  | { readonly command: 'login'; readonly options: ServeOptions }
  | {
      readonly command: 'authStatus' | 'authClear'
      readonly provider?: string | undefined
      readonly admin?: boolean | undefined
    }
  | { readonly command: 'authGitHub'; readonly action: GitHubAuthAction }
  | { readonly command: 'providersList' }
  | { readonly command: 'providersAdd'; readonly options: ProvidersAddOptions }
  | { readonly command: 'providersModels'; readonly options: ProvidersModelsOptions }
  | { readonly command: 'providersTest'; readonly provider: string }
  | { readonly command: 'providersRefresh'; readonly provider: string }
  | { readonly command: 'providersRemove'; readonly provider: string }
  | { readonly command: 'providersHeaders'; readonly options: ProvidersHeadersOptions }
  | { readonly command: 'openRouterConnect' }
  | { readonly command: 'providersUsageTargets' }
  | {
      readonly command: 'providersUsage'
      readonly provider: string
      readonly days: number
      readonly json: boolean
    }
  | {
      readonly command: 'authSet'
      readonly provider?: string | undefined
      readonly target?: AccountTarget
      readonly admin?: boolean | undefined
    }
  | { readonly command: 'accounts'; readonly options: AccountsCommand }
  | { readonly command: 'developer'; readonly args: readonly string[] }
  | { readonly command: 'help'; readonly all?: boolean; readonly route?: string }
  | { readonly command: 'helpTopic'; readonly topic: string }
  | { readonly command: 'version' }
  | { readonly command: 'vaultHelp' }
  | { readonly command: 'invalid'; readonly reason: string; readonly exitCode?: number }

/** The commands that own their process with no backend and no sign-in. */
export type HeadlessCommand = Extract<
  RuntimeCommand,
  { command: 'exec' | 'scan-secrets' | 'legal' }
>

const HEADLESS_COMMANDS: ReadonlySet<string> = new Set(['exec', 'scan-secrets', 'legal'])

/** Whether the command runs headless, before any prompt parsing or sign-in. */
export function isHeadlessCommand(command: RuntimeCommand): command is HeadlessCommand {
  return HEADLESS_COMMANDS.has(command.command)
}
/** Exact terminal grammar: credentials and extra arguments are never accepted. */
export function parseChatGptProviderAction(
  argv: readonly string[],
): ChatGptProviderAction | undefined {
  const [command, action, provider, ...rest] = argv
  if (command !== 'providers' || provider !== 'chatgpt') return
  // `--new-account` registers a different ChatGPT account instead of
  // reusing the saved registration; only `add` takes it.
  if (action === 'add' && rest.length === 1 && rest[0] === CHATGPT_NEW_ACCOUNT_FLAG) {
    return 'add-new-account'
  }
  if (rest.length > 0) return
  switch (action) {
    case 'add':
    case 'remove':
    case 'status': {
      return action
    }
    default: {
      return undefined
    }
  }
}
/**
Exact Grok grammar: only `add` takes flags (`--device`, `--client-id <id>`,
`--scopes <scopes>`), each at most once, values never empty. A client id is
a public identifier, not a secret, so it travels on the command line.
*/
export function parseGrokProviderAction(argv: readonly string[]): GrokProviderAction | undefined {
  const [command, action, provider, ...rest] = argv
  if (command !== 'providers' || provider !== 'grok') return
  if (action === 'remove' || action === 'status') {
    return rest.length === 0 ? { action, isDeviceFlow: false } : undefined
  }
  if (action !== 'add') return
  let isDeviceFlow = false
  let clientId: string | undefined
  let scopes: string | undefined
  for (let index = 0; index < rest.length; index++) {
    const word = rest[index] ?? ''
    if (word === GROK_DEVICE_FLAG) {
      if (isDeviceFlow) return
      isDeviceFlow = true
      continue
    }
    if (word === GROK_CLIENT_ID_FLAG || word === GROK_SCOPES_FLAG) {
      const value = rest[index + 1] ?? ''
      if (value === '' || value.startsWith('-')) return
      if (word === GROK_CLIENT_ID_FLAG) {
        if (clientId !== undefined) return
        clientId = value
      } else {
        if (scopes !== undefined) return
        scopes = value
      }
      index++
      continue
    }
    return
  }
  return {
    action: 'add',
    isDeviceFlow,
    ...(clientId !== undefined && { clientId }),
    ...(scopes !== undefined && { scopes }),
  }
}
/**
Flags `serve` and `login` never take (M95: `auth … --provider` and
`providers …`). Each names a key of the strict parser's values, so
indexing with one typechecks without a cast.
*/
const PROVIDER_AUTH_OPTIONS = [
  'preset',
  'as',
  'address',
  'format',
  'model',
  'privacy',
  'private-ok',
  'key-stdin',
  'context-window',
] as const
const NON_SERVE_OPTIONS = ['provider', ...PROVIDER_AUTH_OPTIONS, 'days', 'admin', 'output'] as const
/**
Flags the auth route refuses beside its own targeting: the providers-add
flags and the spend report's own flags. `--admin` passes through.
*/
const AUTH_FORBIDDEN_OPTIONS = [...PROVIDER_AUTH_OPTIONS, 'days', 'output'] as const

/** The strict parser's values, for the provider subcommands below. */
type StrictValues = ReturnType<typeof parseCommandLineStrictly>['values']

/**
The non-Meta provider an `auth set` stores a key for, if any (M95,
PLAN.md D74). Both spellings count: `auth set --provider <id>` parses
without an account, and `--account default` names the same default
slot. Anything else (Meta, a named account, no provider at all) is not
a provider key set. One rule here, so the parser's two shapes cannot
drift from the dispatch again.
*/
export function authSetProviderId(
  command: Extract<RuntimeCommand, { command: 'authSet' }>,
): string | undefined {
  const targeted = command.target
  if (targeted !== undefined) {
    return targeted.provider !== 'meta' && targeted.account === ACCOUNT_DEFAULT_ID
      ? targeted.provider
      : undefined
  }
  const provider = command.provider
  return provider !== undefined && provider !== 'meta' ? provider : undefined
}

/** `auth set|status|clear`: the key's three commands (D61). */
function authCommand(name: string | undefined): 'authSet' | 'authStatus' | 'authClear' | undefined {
  switch (name) {
    case 'set': {
      return 'authSet'
    }
    case 'status': {
      return 'authStatus'
    }
    case 'clear': {
      return 'authClear'
    }
    default: {
      return undefined
    }
  }
}

function isOneOf<T extends string>(allowed: readonly T[], value: string | undefined): value is T {
  // Widened only to call includes; the predicate's true branch is the narrowing.
  return value !== undefined && (allowed as readonly string[]).includes(value)
}

function invalid(argument: string): Extract<RuntimeCommand, { command: 'invalid' }> {
  // Every misuse owns exit 2; only a real failure falls back to exit 1.
  return { command: 'invalid', reason: fill(UI_TEXT.acpUnknownArgument, { argument }), exitCode: 2 }
}

/** A usage refusal: exit 2, never a run. */
function refused(reason: string): Extract<RuntimeCommand, { command: 'invalid' }> {
  return { command: 'invalid', reason, exitCode: 2 }
}

/**
The option a `parseArgs` invalid-value throw names, without its value
placeholder (`--range` from "Option '--range <value>' argument missing").
Undefined when the throw names no option (an unexpected positional): that
path never echoes the raw parser sentence either.
*/
function parserOptionName(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error)
  return /^Option '(--[A-Za-z][A-Za-z0-9_-]*)/.exec(message)?.[1]
}

/**
A known option's bad value names the option and the help that lists its
accepted values, never the supplied value (D120 secret rule). The help is
named as a command a person can run as typed, as the unknown-option
answer names it.
*/
function valueInvalidReason(topic: string, option: string): string {
  return fill(UI_TEXT.cliValueInvalid, { option, help: `${ACP_AGENT_NAME} ${topic} --help` })
}

/**
A strict-parser throw as a usage refusal (D120): a wrong option names the
option, the topic's accepted options, and the nearest valid option when
the name is close. Anything else keeps the parser's reason, still exit 2.
*/
function invalidStrictOption(
  topic: string,
  valid: readonly string[],
  error: unknown,
): Extract<RuntimeCommand, { command: 'invalid' }> {
  const message = error instanceof Error ? error.message : String(error)
  if (/unknown option/i.test(message)) {
    return refused(unknownOptionReason(UI_TEXT, ACP_AGENT_NAME, topic, valid, message))
  }
  // A bad or missing value names the option and its help, never the value
  // and never the parser's English sentence.
  if (
    error instanceof Error &&
    'code' in error &&
    error.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE'
  ) {
    const option = parserOptionName(message)
    if (option !== undefined) return refused(valueInvalidReason(topic, option))
  }
  // Anything else is a downstream refusal already in the product's words
  // (such as the resource bounds); it passes through, still exit 2. An
  // unexpected-positional throw cannot reach these parsers: every one of
  // them allows positionals.
  return refused(message)
}

/** An option-parser failure on one topic as its usage refusal (D120): a wrong
option names the option and the nearest valid one; anything else keeps the
parser's reason, still exit 2. */
function usageRefusal(
  topic: string,
  error: unknown,
): Extract<RuntimeCommand, { command: 'invalid' }> {
  const found = helpTopicNamed(topic)
  return found === undefined
    ? { ...invalid(topic), exitCode: 2 }
    : invalidStrictOption(found.name, topicShownOptionNames(found), error)
}

/** The option names behind one help topic, for error messages. */
function topicValidOptions(topic: string): readonly string[] {
  const found = helpTopicNamed(topic)
  return found === undefined ? [] : topicShownOptionNames(found)
}

/** Enum refusals use the help table's accepted values, never the supplied value. */
function enumRefusal(
  topic: string,
  values: Readonly<Record<string, unknown>>,
): Extract<RuntimeCommand, { command: 'invalid' }> | undefined {
  const options = helpTopicNamed(topic)?.options ?? []
  for (const option of options) {
    const value = values[option.name]
    if (value === undefined || option.fact?.kind !== 'enum') continue
    if (typeof value === 'string' && option.fact.values.includes(value)) continue
    const optionName = `--${option.name}`
    const reason = valueInvalidReason(topic, optionName)
    return refused(
      `${reason} (${fill(UI_TEXT.cliHelp.accepts, { values: option.fact.values.join('|') })})`,
    )
  }
  return undefined
}

/** The paid features whose flags were given, in the flags' order. */
function paidFeaturesOf(values: Readonly<Record<string, unknown>>): AcpPaidFeature[] {
  return ACP_PAID_FEATURES.filter((feature) => values[ACP_PAID_FLAGS[feature]] === true)
}

/** Report flags that take a value: the value is never a subcommand word. */
const REPORT_VALUE_FLAGS: ReadonlySet<string> = new Set(
  Object.entries(CLI_OPTION_REGISTRY.report.options)
    .filter(([, option]) => option.type === 'string')
    .map(([name]) => `--${name}`),
)

/** Flags that take a value on either side of a leading command word. */
const HOIST_VALUE_FLAGS: ReadonlySet<string> = new Set(
  [CLI_OPTION_REGISTRY.serve.options, CLI_OPTION_REGISTRY.exec.options].flatMap((options) =>
    Object.entries(options)
      .filter(([, option]) => option.type === 'string')
      .map(([name]) => `--${name}`),
  ),
)

/**
D5: global options ride before or after the command word, so
`--verbose exec …` parses like `exec --verbose …`. Only `exec` and
`scan-secrets` hoist; anything past `--` stays positional.
*/
function hoistLeadingCommand(argv: readonly string[]): readonly string[] {
  let index = 0
  while (index < argv.length) {
    const word = argv[index] ?? ''
    if (word === '--' || word === '-' || !word.startsWith('-')) break
    const name = word.split('=', 1)[0] ?? ''
    index += !word.includes('=') && HOIST_VALUE_FLAGS.has(name) ? 2 : 1
  }
  const command = argv[index]
  return (command === 'exec' || command === 'scan-secrets') && index > 0
    ? [command, ...argv.slice(0, index), ...argv.slice(index + 1)]
    : argv
}

/** D5: the parser library's unknown-option sentence never reaches the person. */
function parserUnknownOption(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error)
  const option = /^Unknown option '([^']+)'/.exec(message)?.[1]
  return option === undefined ? undefined : fill(UI_TEXT.acpUnknownArgument, { argument: option })
}

export function parseCommandLine<T>(
  argv: readonly string[],
  localSharing: (argv: readonly string[]) => T,
): RuntimeCommand | T
export function parseCommandLine(argv: readonly string[]): RuntimeCommand
export function parseCommandLine<T>(
  args: readonly string[],
  localSharing?: (argv: readonly string[]) => T,
): RuntimeCommand | T {
  // D5: a leading command word never hides behind global options.
  const argv = hoistLeadingCommand(args)
  const divider = argv.indexOf('--')
  const flags = divider === -1 ? argv : argv.slice(0, divider)
  // Reserve judge before help routing, as legal-scan and usage are before
  // prompt parsing: an action's --help is malformed judge argv (exit 2),
  // and only the bare form answers help (parseJudgeArgs).
  if (argv[0] === 'judge') return parseJudgeArgs(argv)
  // The node command answers its own --help through its dispatcher (A3).
  if (argv[0] === 'node') return { command: 'node', argv: argv.slice(1) }
  // M104 lane H: each answers its own --help with its help topic; the
  // supervised command's words are its own, its --help included.
  if (argv[0] === 'supervise') return parseSupervise(argv.slice(1))
  if (argv[0] === 'lsp') return parseLsp(argv.slice(1))
  if (argv[0] === 'stop') return parseStop(argv.slice(1))
  if (flags.includes('--help') || flags.includes('-h')) {
    if (argv[0] === 'vault') return { command: 'vaultHelp' }
    // Bare `report --help` is the report command's own help, not the help
    // topic (RVMSM113 F34): the reports command prints its usage with the
    // working kinds. Longer report forms keep the topic route below.
    if (argv[0] === 'report' && argv.length === 2) return parseReport(argv.slice(1), true)
    const routes: Readonly<Record<string, string>> = {
      exec: 'exec',
      'scan-secrets': 'scan-secrets',
      report: 'report',
      usage: 'usage',
      resources: 'resources',
      login: 'login',
      setup: 'setup',
      legal: 'legal',
      estimate: 'estimate',
      fonts: 'fontsInstall',
    }
    let route = routes[argv[0] ?? '']
    if (argv[0] === 'providers' && argv[1] === 'accounts')
      route = flags.filter((word) => !word.startsWith('-')).join(' ')
    else if (argv[0] === 'providers' && argv[2] === 'chatgpt')
      route = `chatGptProvider ${argv[1] ?? 'add'}`
    else if (argv[0] === 'providers' && argv[2] === 'grok')
      route = `grokProvider ${argv[1] ?? 'add'}`
    else if (argv[0] === 'exec' && argv[1] === 'legal-scan') route = 'legal'
    else if (argv[0] === 'report' && argv[1] !== undefined) {
      // P2-1: `problem` aliases bare report, so both reach the problem
      // report's own options. Anything else names the reports namespace.
      // Flag values (e.g. `--description foo`) are not subcommand words.
      const words: string[] = []
      for (let index = 0; index < flags.length; index++) {
        const word = flags[index] ?? ''
        if (word.startsWith('-')) {
          const name = word.split('=', 1)[0] ?? ''
          if (!word.includes('=') && REPORT_VALUE_FLAGS.has(name)) index++
          continue
        }
        words.push(word)
      }
      const rest = words[1] === 'problem' ? words.slice(2) : words.slice(1)
      route = rest.length === 0 ? 'report' : `reports ${rest.join(' ')}`
    } else if (argv[0] === 'usage' && argv[1] === 'resources') route = 'resources'
    else if (argv[0] === 'providers')
      route =
        argv[1] === 'add'
          ? 'providersAdd'
          : `providers${(argv[1] === undefined || argv[1].startsWith('-') ? 'list' : argv[1]).replace(/^./, (letter) => letter.toUpperCase())}`
    else if (argv[0] === 'auth')
      route = `auth${(argv[1] === undefined || argv[1].startsWith('-') ? 'status' : argv[1]).replace(/^./, (letter) => letter.toUpperCase())}`
    else if (
      route !== undefined &&
      argv[0] !== 'fonts' &&
      flags[1] !== undefined &&
      !flags[1].startsWith('-')
    )
      route += ` ${flags
        .slice(1)
        .filter((word) => !word.startsWith('-'))
        .join(' ')}`
    // Bare flags ask about the agent, not the default launch: the compact
    // general help names the machine flags and points at help reference.
    const resolved =
      route ??
      (argv[0]?.startsWith('-') === true
        ? undefined
        : flags.filter((word) => !word.startsWith('-')).join(' ') || 'serve')
    return resolved === undefined ? { command: 'help' } : { command: 'help', route: resolved }
  }

  // M118-X-CLI: main's owner injects the local parser/runner once P/C bind.
  // Without that binding these reserved commands fail explicitly, never serve.
  if (argv[0] === 'share' || argv[0] === 'prompts') {
    // The sharing commands' help is their own one screen, answered before
    // any local binding is needed.
    if (argv.length === 2 && argv[1] === '--help') return { command: 'helpTopic', topic: argv[0] }
    if (localSharing === undefined) return invalid(argv[0])
    try {
      return localSharing(argv)
    } catch (error: unknown) {
      // The owner's parser throws the library's sentences: an unknown
      // option names what the command accepts, a bad value names the
      // option and its help, still exit 2. Anything else keeps the
      // owner's own words, which never echo a credential.
      if (error instanceof Error && 'code' in error) {
        const root = argv[0] === 'prompts' ? 'prompts' : 'share'
        const topic = helpTopicNamed(root)
        if (
          topic !== undefined &&
          (error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' ||
            error.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE')
        )
          return invalidStrictOption(topic.name, topicShownOptionNames(topic), error)
      }
      return {
        command: 'invalid',
        reason: error instanceof Error ? error.message : UI_TEXT.promptFileInvalid,
        exitCode: 2,
      }
    }
  }
  if (argv[0] === 'exec' && argv[1] === 'legal-scan')
    return parseLegalCommand(['legal', ...argv.slice(2)])
  if (argv[0] === '--usage') return parseUsage(['--json', ...argv.slice(1)])
  if (COMPANION_VOICE_RELEASE.isReady && argv[0] === 'dictate') {
    const flags = argv.slice(1)
    if (
      flags.some((flag) => flag !== '--muse-voice' && flag !== '--trust-workspace') ||
      new Set(flags).size !== flags.length
    )
      return invalid('dictate')
    return {
      command: 'dictate',
      paid: flags.includes('--muse-voice'),
      trustWorkspace: flags.includes('--trust-workspace'),
    }
  }
  if (argv[0] === 'resources') return parseResources(argv.slice(1))
  if (argv[0] === 'usage' && argv[1] === 'resources')
    return parseResources(['history', ...argv.slice(2)])
  if (argv[0] === 'usage') return parseUsage(argv.slice(1))
  // The models route comes first: `chatgpt` and `copilot` are entry ids the
  // product creates, so `providers models chatgpt` must reach the models
  // command instead of the subscription provider actions below (Codex on
  // PR #227).
  if (argv[0] === 'providers' && argv[1] === 'models') return parseProvidersModels(argv.slice(2))
  if (argv[0] === 'providers' && argv[1] === 'headers') return parseProvidersHeaders(argv.slice(2))
  if (argv[0] === 'providers' && (argv[2] === 'chatgpt' || argv[2] === 'copilot')) {
    const action = parseChatGptProviderAction(argv)
    return action === undefined
      ? { command: 'invalid', reason: UI_TEXT.acpChatGpt.usage, exitCode: 2 }
      : { command: 'chatGptProvider', action }
  }
  if (argv[0] === 'providers' && argv[2] === 'grok') {
    const action = parseGrokProviderAction(argv)
    return action === undefined
      ? { command: 'invalid', reason: UI_TEXT.acpGrok.usage, exitCode: 2 }
      : { command: 'grokProvider', action }
  }
  if (argv[0] === 'help') {
    if (argv.length === 1) return { command: 'help' }
    if (argv.length === 2 && (argv[1] === '--all' || argv[1] === 'reference'))
      return { command: 'help', all: true }
    if (argv.length === 2 && helpTopicNamed(argv[1] ?? '') !== undefined)
      return { command: 'helpTopic', topic: argv[1] ?? '' }
    if (argv.length === 2) {
      const wanted = argv[1] ?? ''
      const names = CLI_HELP_TOPICS.map((topic) => topic.name)
      const nearest = nearestOptionName(wanted, names)
      const reason = fill(UI_TEXT.cliHelp.unknownTopic, { topic: wanted, command: ACP_AGENT_NAME })
      return refused(
        nearest === undefined
          ? reason
          : `${reason} ${fill(UI_TEXT.cliHelp.suggestOption, { nearest })}`,
      )
    }
    return { ...invalid(argv.join(' ')), exitCode: 2 }
  }
  if (argv[0] === 'schedule') {
    const parsed = parseScheduleCommand(argv.slice(1))
    return parsed.ok
      ? { command: 'schedule', options: parsed.options }
      : { command: 'invalid', reason: parsed.reason, exitCode: 2 }
  }
  if (argv[0] === 'providers' && argv[1] === 'accounts') {
    const options = parseAccountsCommand(argv.slice(2))
    return options === undefined
      ? {
          command: 'invalid',
          reason: fill(UI_TEXT.accounts.cliUsage, { command: ACP_AGENT_NAME }),
          exitCode: 2,
        }
      : { command: 'accounts', options }
  }
  // The developer words stay raw here: the strict parser would reject them,
  // and the terminal owner validates them (X-D4, lane X's strict table).
  if (argv[0] === 'developer') return { command: 'developer', args: argv }
  if (argv[0] === 'vault') {
    if (argv.length === 1 || (argv.length === 2 && (argv[1] === '--help' || argv[1] === 'help')))
      return { command: 'vaultHelp' }
    const options = parseVaultCommand(argv.slice(1))
    return options === undefined
      ? { command: 'invalid', reason: vaultUsage(), exitCode: 2 }
      : { command: 'vault', options }
  }
  if (argv[0] === 'estimate') return { command: 'estimate', argv: argv.slice(1) }
  if (argv[0] === 'auth' && argv[1] === 'github') return parseAuthGitHub(argv.slice(2))
  if (argv[0] === 'exec' || argv[0] === 'scan-secrets') return parseHeadless(argv)
  if (argv[0] === 'report')
    return parseReport(argv.slice(argv[1] === 'problem' ? 2 : 1), argv[1] !== 'problem')
  if (argv[0] === 'legal') return parseLegalCommand(argv)
  if (argv[0] === 'fonts') return parseFonts(argv.slice(1))
  if (argv[0] === 'playbook')
    return argv.length === 2 && (argv[1] === '--help' || argv[1] === '-h')
      ? { command: 'helpTopic', topic: 'playbook' }
      : { command: 'playbook', argv: argv.slice(1) }
  // M124: the connector parses its own words in its lazy bundle.
  if (argv[0] === 'mcp') return { command: 'mcp', argv: argv.slice(1) }
  let parsed: ReturnType<typeof parseCommandLineStrictly>
  try {
    parsed = parseCommandLineStrictly(argv)
  } catch (error: unknown) {
    if (error instanceof Error && /unknown option/i.test(error.message)) {
      // The strict grammar is the serve family: a bare wrong option belongs
      // to serve, a named one to its command. The raw parser message is
      // never the answer: it repeats the typed name (D120 secret rule).
      const named = argv.find((argument) => helpTopicNamed(argument) !== undefined) ?? 'serve'
      const topic = helpTopicNamed(named)
      if (topic !== undefined) {
        const refusal = invalidStrictOption(topic.name, topicShownOptionNames(topic), error)
        // REVCLI keeps the credential guidance on every auth refusal; the
        // self-doc above still names the accepted flags without repeating a
        // secret-looking name.
        if (argv.includes('auth'))
          return {
            ...refusal,
            reason: `${refusal.reason} ${UI_TEXT.accounts.credentialHelp}`,
            exitCode: 2,
          }
        return refusal
      }
    }
    // Auth argv is never echoed: a mistyped token may be the key itself.
    if (argv.includes('auth'))
      return { command: 'invalid', reason: UI_TEXT.accounts.credentialHelp, exitCode: 2 }
    // A bad or missing value names the option and the help that lists its
    // accepted values: the parser's English sentence never reaches the
    // person. The strict grammar is the serve family, so a bare wrong
    // value belongs to serve and a named one to its command, as above.
    const topicName = argv.find((argument) => helpTopicNamed(argument) !== undefined) ?? 'serve'
    const topic = helpTopicNamed(topicName)
    return topic === undefined
      ? { ...invalid(topicName), exitCode: 2 }
      : invalidStrictOption(topic.name, topicShownOptionNames(topic), error)
  }
  const { values, positionals } = parsed
  if (values.help === true) {
    const [first = ''] = positionals
    const topic = helpTopicNamed(first)
    return topic === undefined ? { command: 'help' } : { command: 'helpTopic', topic: topic.name }
  }
  if (values.version === true) {
    return { command: 'version' }
  }
  // REVCLI: an auth global refusal carries the credential guidance below,
  // never the enum self-doc.
  const enumError =
    positionals[0] === 'auth'
      ? undefined
      : enumRefusal(positionals[0] === 'providers' ? 'providers' : 'serve', values)
  if (enumError !== undefined) return enumError
  const backend = values.backend ?? ACP_DEFAULT_BACKEND
  if (!isOneOf(ACP_BACKENDS, backend)) {
    // Auth argv is never echoed, but the misuse still owns exit 2. A bad
    // value names the option and its help, never the supplied value.
    return positionals[0] === 'auth'
      ? { command: 'invalid', reason: UI_TEXT.accounts.credentialHelp, exitCode: 2 }
      : refused(valueInvalidReason('serve', '--backend'))
  }
  const shellSandbox = values['shell-sandbox'] ?? SETTING_DEFAULTS.shellSandbox
  if (!isOneOf(SHELL_SANDBOX_MODES, shellSandbox)) {
    return positionals[0] === 'auth'
      ? { command: 'invalid', reason: UI_TEXT.accounts.credentialHelp, exitCode: 2 }
      : refused(valueInvalidReason('serve', '--shell-sandbox'))
  }
  const paidFeatures = paidFeaturesOf(values)
  if (values['usage-history'] !== undefined && !['on', 'off'].includes(values['usage-history']))
    return refused(valueInvalidReason('serve', '--usage-history'))
  const rawSeconds = values['questions-defer-after']
  const questionsDeferAfterSeconds =
    rawSeconds === undefined ? questionDeferSeconds() : questionDeferSeconds(Number(rawSeconds))
  if (
    questionsDeferAfterSeconds === undefined ||
    (rawSeconds !== undefined && !/^\d+$/.test(rawSeconds))
  )
    return refused(valueInvalidReason('serve', '--questions-defer-after'))
  const [firstPaid] = paidFeatures
  if (firstPaid !== undefined && backend !== 'modelApi') {
    return {
      command: 'invalid',
      reason: fill(UI_TEXT.acpPaidNeedsModelApi, { argument: `--${ACP_PAID_FLAGS[firstPaid]}` }),
      exitCode: 2,
    }
  }
  if (backend !== 'modelApi' && values.subscription === true) {
    return {
      command: 'invalid',
      reason: fill(UI_TEXT.acpSubscriptionNeedsModelApi, { argument: '--subscription' }),
    }
  }
  const budget =
    values['max-budget-usd'] === undefined ? undefined : scheduleBudgetUsd(values['max-budget-usd'])
  if (budget === undefined && values['max-budget-usd'] !== undefined)
    return { command: 'invalid', reason: UI_TEXT.scheduleV2.runtime.usage, exitCode: 2 }
  const options: ServeOptions = {
    ...(values.model?.[0] !== undefined && { initialModelId: values.model[0] }),
    ...(values['usage-history'] !== undefined && {
      usageHistory: values['usage-history'] === 'on',
    }),
    backend,
    trustWorkspace: values['trust-workspace'] === true,
    museBinary: values['muse-binary'] ?? SETTING_DEFAULTS.museBinaryPath,
    shellSandbox,
    canBypass: values['allow-dangerously-skip-permissions'] === true,
    allowsContributorModels: values['allow-contributor-models'] === true,
    paidFeatures,
    ...(COMPANION_VOICE_RELEASE.isReady && { companionVoice: values['muse-voice'] === true }),
    isVerbose: values.verbose === true,
    questionsDeferAfterSeconds,
    autoCompaction: values['no-auto-compaction'] !== true,
    ...(values['scheduled-prompts'] !== undefined && {
      scheduledPrompts: values['scheduled-prompts'],
    }),
    ...(values.subscription === true && { subscription: true }),
    ...(budget !== undefined && { maxBudgetUsd: budget }),
  }
  const [first, second, ...rest] = positionals
  // A refused flag is named, never folded into the positionals.
  const refusedServeFlag = NON_SERVE_OPTIONS.find((name) => values[name] !== undefined)
  if (values.account !== undefined && (first !== 'auth' || second !== 'set' || rest.length > 0))
    return invalid('--account')
  if (first === 'setup' && second === undefined) {
    if (values.provider !== undefined) return invalid('--provider')
    return options.trustWorkspace
      ? { command: 'setup', options, maintenance: values.maintenance === true }
      : { command: 'invalid', reason: UI_TEXT.hooksNotRunnable, exitCode: 2 }
  }
  if (values.maintenance === true) return { ...invalid('--maintenance'), exitCode: 2 }
  if (first === undefined) {
    // The provider commands' flags are not serve flags.
    return refusedServeFlag === undefined
      ? { command: 'serve', options }
      : invalid(`--${refusedServeFlag}`)
  }
  if (first === 'login') {
    return second === undefined && refusedServeFlag === undefined
      ? { command: 'login', options }
      : invalid(refusedServeFlag === undefined ? positionals.join(' ') : `--${refusedServeFlag}`)
  }
  if (first === 'providers') {
    return parseProviders(values, second, rest)
  }
  if (first !== 'auth') return invalid(positionals.join(' '))
  // Auth positionals are never echoed: a mistyped token may be the key itself.
  if (rest.length > 0)
    return { command: 'invalid', reason: UI_TEXT.accounts.credentialHelp, exitCode: 2 }
  // The auth route takes its own targeting plus `--admin` (PROVSPEND); the
  // providers-add flags and the spend report's own flags stay out.
  const refusedAuthFlag = AUTH_FORBIDDEN_OPTIONS.find((name) => values[name] !== undefined)
  if (refusedAuthFlag !== undefined) {
    return invalid(`--${refusedAuthFlag}`)
  }
  const auth = authCommand(second)
  if (auth === undefined) {
    return { command: 'invalid', reason: UI_TEXT.accounts.credentialHelp, exitCode: 2 }
  }
  const provider = values.provider
  const hasTarget = values.account !== undefined
  // PROVSPEND: the admin report key is per provider, never per account.
  const isAdmin = values.admin === true
  if (isAdmin && (provider === undefined || !isProviderId(provider))) {
    return { command: 'invalid', reason: UI_TEXT.accounts.credentialHelp }
  }
  if (isAdmin && hasTarget) {
    return { command: 'invalid', reason: UI_TEXT.accounts.credentialHelp }
  }
  if (auth === 'authSet' && hasTarget) {
    const targetProvider = accountIdSchema.safeParse(provider ?? 'meta')
    const targetAccount = accountIdSchema.safeParse(values.account ?? ACCOUNT_DEFAULT_ID)
    return targetProvider.success && targetAccount.success
      ? { command: auth, target: { provider: targetProvider.data, account: targetAccount.data } }
      : { command: 'invalid', reason: UI_TEXT.accounts.invalidAccount, exitCode: 2 }
  }
  if (provider !== undefined && !isProviderId(provider)) {
    return {
      command: 'invalid',
      reason: fill(UI_TEXT.providerUnknown, { provider }),
      exitCode: 2,
    }
  }
  if (provider === undefined) return { command: auth }
  return isAdmin ? { command: auth, provider, admin: true } : { command: auth, provider }
}

/**
`providers usage <id> [--days n] [--output json]` (PROVSPEND): what the
provider itself reports was spent. Only its own flags ride along.
*/
/**
The `<id>` of `providers test|remove|usage`: the id, or the invalid
command unless exactly one known provider id rides along.
*/
function providersIdOrInvalid(rest: readonly string[], usage: string): string | RuntimeCommand {
  const [provider] = rest
  if (provider === undefined || rest.length !== 1) {
    return invalid(usage)
  }
  if (!isProviderId(provider)) {
    return {
      command: 'invalid',
      reason: fill(UI_TEXT.providerUnknown, { provider }),
      exitCode: 2,
    }
  }
  return provider
}

function parseProvidersUsage(values: StrictValues, rest: readonly string[]): RuntimeCommand {
  // Bare `providers usage` names the missing id and the ids to choose
  // from (RLTESTDRIVE2 14); the handler lists the configured ids, which
  // this parser cannot see.
  if (rest.length === 0 && Object.keys(values).length === 0)
    return { command: 'providersUsageTargets' }
  const provider = providersIdOrInvalid(rest, 'providers usage')
  if (typeof provider !== 'string') return provider
  if (
    values.preset !== undefined ||
    values.as !== undefined ||
    values.address !== undefined ||
    values.format !== undefined ||
    values.model !== undefined ||
    values.privacy !== undefined ||
    values['private-ok'] !== undefined ||
    values['key-stdin'] !== undefined ||
    values.admin === true
  ) {
    return invalid('providers usage')
  }
  let days = PROVIDER_SPEND_DAYS_DEFAULT
  if (values.days !== undefined) {
    const parsed = /^\d+$/.test(values.days) ? Number(values.days) : NaN
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > PROVIDER_SPEND_DAYS_MAX)
      return invalid('providers usage')
    days = parsed
  }
  return values.output === undefined || values.output === 'json'
    ? { command: 'providersUsage', provider, days, json: values.output === 'json' }
    : invalid('providers usage')
}

/** `auth github login|logout|status` (M123): exactly one word, no flag, no value. */
function parseAuthGitHub(rest: readonly string[]): RuntimeCommand {
  const [action, ...extra] = rest
  return extra.length === 0 && isOneOf(GITHUB_AUTH_ACTIONS, action)
    ? { command: 'authGitHub', action }
    : { command: 'invalid', reason: UI_TEXT.githubSignIn.usage, exitCode: 2 }
}

/** `providers list|add|test|remove` (M95, PLAN.md D74). */
function parseProviders(
  values: StrictValues,
  verb: string | undefined,
  rest: readonly string[],
): RuntimeCommand {
  switch (verb) {
    case 'connect': {
      return rest.length === 1 && rest[0] === 'openrouter' && Object.keys(values).length === 0
        ? { command: 'openRouterConnect' }
        : invalid('providers connect openrouter')
    }
    case 'list': {
      return rest.length === 0
        ? { command: 'providersList' }
        : { ...invalid('providers list'), exitCode: 2 }
    }
    case 'test':
    case 'refresh':
    case 'remove': {
      const provider = providersIdOrInvalid(rest, `providers ${verb}`)
      if (typeof provider !== 'string') return provider
      switch (verb) {
        case 'test': {
          return { command: 'providersTest', provider }
        }
        case 'refresh': {
          return { command: 'providersRefresh', provider }
        }
        default: {
          return { command: 'providersRemove', provider }
        }
      }
    }
    case 'usage': {
      return parseProvidersUsage(values, rest)
    }
    case 'add': {
      return parseProvidersAdd(values, rest)
    }
    case 'models': {
      return parseProvidersModels(rest)
    }
    default: {
      return { ...invalid(`providers ${verb ?? ''}`.trim()), exitCode: 2 }
    }
  }
}

/** `providers headers` (M95c part 6): the provider, and at most one name to set or unset. */
export interface ProvidersHeadersOptions {
  readonly provider: string
  readonly set?: string | undefined
  readonly unset?: string | undefined
}

/**
`providers headers <id> [set|unset <name>]`: positional only, so a value
can never ride the command line; `set` reads it from standard input.
*/
function parseProvidersHeaders(argv: readonly string[]): RuntimeCommand {
  const usage: RuntimeCommand = {
    command: 'invalid',
    reason: fill(UI_TEXT.providerHeaders.usage, { command: ACP_AGENT_NAME }),
    exitCode: 2,
  }
  try {
    const strict = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: CLI_OPTION_REGISTRY.providersHeaders.options,
    })
    if (strict.values.help === true) return { command: 'helpTopic', topic: 'providers' }
    const [provider, action, name, ...extra] = strict.positionals
    if (provider === undefined || provider === '' || extra.length > 0) return usage
    if (action === undefined) return { command: 'providersHeaders', options: { provider } }
    // A name is printed back by later lists, so it never carries a
    // control character; the header rules themselves are the command's.
    if (name === undefined || name === '' || hasControlCharacter(name)) return usage
    if (action === 'set') return { command: 'providersHeaders', options: { provider, set: name } }
    return action === 'unset'
      ? { command: 'providersHeaders', options: { provider, unset: name } }
      : usage
  } catch (error: unknown) {
    // Only the strict parser's own refusals (an unknown option, a value
    // where none goes) are usage errors; anything else is thrown on.
    if (!(error instanceof TypeError && 'code' in error)) throw error
    const topic = helpTopicNamed('providers')
    return topic === undefined
      ? refused(error.message)
      : invalidStrictOption(topic.name, topicShownOptionNames(topic), error)
  }
}

/** The models flags, narrowed from the strict parse. */
interface ProvidersModelsFlags {
  readonly help?: boolean
  readonly add?: readonly string[]
  readonly remove?: readonly string[]
  readonly force?: string
}

/** `providers models <entry> [--add <model>] [--remove <model>] [--force <reason>]` (D120). */
function parseProvidersModels(argv: readonly string[]): RuntimeCommand {
  try {
    const strict = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: CLI_OPTION_REGISTRY.providersModels.options,
    })
    return finishProvidersModels(
      {
        ...(strict.values.help === true && { help: true as const }),
        ...(strict.values.add !== undefined && { add: [...strict.values.add] }),
        ...(strict.values.remove !== undefined && { remove: [...strict.values.remove] }),
        ...(typeof strict.values.force === 'string' && { force: strict.values.force }),
      },
      [...strict.positionals],
    )
  } catch (error: unknown) {
    const topic = helpTopicNamed('providers')
    return topic === undefined
      ? refused(error instanceof Error ? error.message : String(error))
      : invalidStrictOption(topic.name, topicShownOptionNames(topic), error)
  }
}

/** A stored-and-reprinted reason must not smuggle in lines or terminal controls. */
function hasControlCharacter(text: string): boolean {
  return /\p{Cc}|\p{Zl}|\p{Zp}/u.test(text)
}

function finishProvidersModels(
  values: ProvidersModelsFlags,
  positionals: readonly string[],
): RuntimeCommand {
  if (values.help === true) return { command: 'helpTopic', topic: 'providers' }
  const [entry, ...rest] = positionals
  if (entry === undefined || entry === '' || rest.length > 0)
    return {
      command: 'invalid',
      reason: fill(UI_TEXT.cliHelp.modelsUsage, { command: ACP_AGENT_NAME }),
      exitCode: 2,
    }
  // A stored id is printed back by later lists, so control and format
  // characters never parse: no stored value can steer a terminal (Codex on
  // PR #227). Whitespace stays the command layer's refusal below. Add and
  // remove share one refusal: both name models to store.
  const add = values.add ?? []
  const remove = values.remove ?? []
  if (
    [...add, ...remove].some(
      (model) => typeof model !== 'string' || model === '' || !isStorableModelId(model),
    )
  ) {
    return {
      command: 'invalid',
      reason: fill(UI_TEXT.cliHelp.modelsUsage, { command: ACP_AGENT_NAME }),
      exitCode: 2,
    }
  }
  const force = values.force
  // The reason is stored on the entry and printed back by later lists, so
  // it stays one honest line: no blank reason, no control characters.
  if (force !== undefined && (force.trim() === '' || hasControlCharacter(force))) {
    return {
      command: 'invalid',
      reason: fill(UI_TEXT.cliHelp.modelsUsage, { command: ACP_AGENT_NAME }),
      exitCode: 2,
    }
  }
  return force !== undefined && add.length === 0
    ? { command: 'invalid', reason: UI_TEXT.cliHelp.modelsForceNeedsAdd, exitCode: 2 }
    : { command: 'providersModels', options: { entry, add, remove, force } }
}

/** `providers add --preset <id> [--as <id>] [--address <url>] [--model <id>…] …`. */
function parseProvidersAdd(values: StrictValues, rest: readonly string[]): RuntimeCommand {
  if (rest.length > 0) {
    return { ...invalid(`providers add ${rest.join(' ')}`.trim()), exitCode: 2 }
  }
  const preset = values.preset
  if (preset === undefined) return invalid('--preset')
  if (typeof preset !== 'string' || !isProviderId(preset)) {
    return {
      command: 'invalid',
      reason: fill(UI_TEXT.providerUnknown, {
        provider: typeof preset === 'string' ? preset : '',
      }),
      exitCode: 2,
    }
  }
  const as = values.as
  const address = values.address
  // Narrowed without a cast: only these literals reach the options below.
  let formatOption: 'chat' | 'responses' | 'anthropic' | undefined
  switch (values.format) {
    case 'chat':
    case 'responses':
    case 'anthropic': {
      formatOption = values.format
      break
    }
    default: {
      formatOption = undefined
      break
    }
  }
  let privacyOption: OpenRouterPrivacy | undefined
  switch (values.privacy) {
    case 'zdr':
    case 'no-training':
    case 'any': {
      privacyOption = values.privacy
      break
    }
    default: {
      privacyOption = undefined
      break
    }
  }
  const format = values.format
  const privacy = values.privacy
  if (
    (as !== undefined && (typeof as !== 'string' || !isProviderId(as))) ||
    (address !== undefined && typeof address !== 'string') ||
    (format !== undefined && formatOption === undefined) ||
    (privacy !== undefined && privacyOption === undefined) ||
    // `--format` is a custom server's choice; `--privacy` is OpenRouter's.
    (format !== undefined && preset !== 'custom') ||
    (privacy !== undefined && preset !== 'openrouter')
  ) {
    return { ...invalid('providers add'), exitCode: 2 }
  }
  const rawModels = values.model ?? []
  const rawWindow = values['context-window']
  const contextWindow = rawWindow === undefined ? undefined : Number(rawWindow)
  if (contextWindow !== undefined && (!Number.isSafeInteger(contextWindow) || contextWindow <= 0)) {
    return { command: 'invalid', reason: UI_TEXT.localContextWindowInvalid, exitCode: 2 }
  }
  if (rawModels.some((model) => typeof model !== 'string' || model === '')) {
    return { ...invalid('providers add'), exitCode: 2 }
  }
  for (const name of Object.keys(values)) {
    if (
      ![
        'preset',
        'as',
        'address',
        'format',
        'model',
        'context-window',
        'privacy',
        'key-stdin',
        'private-ok',
      ].includes(name)
    ) {
      return invalidStrictOption(
        'providers',
        topicValidOptions('providers'),
        new Error(`Unknown option "--${name}"`),
      )
    }
  }
  return {
    command: 'providersAdd',
    options: {
      preset,
      ...(as !== undefined && { as }),
      ...(address !== undefined && { address }),
      ...(formatOption !== undefined && { format: formatOption }),
      models: rawModels,
      ...(contextWindow !== undefined && { contextWindow }),
      ...(privacyOption !== undefined && { privacy: privacyOption }),
      privateOk: values['private-ok'] === true,
      keyFromStdin: values['key-stdin'] === true,
    },
  }
}

function parseUsage(argv: readonly string[]): RuntimeCommand {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: CLI_OPTION_REGISTRY.usage.options,
    })
    if (values.help) return { command: 'helpTopic', topic: 'usage' }
    const enumError = enumRefusal('usage', values)
    if (enumError !== undefined) return enumError
    const [action = 'summary', ...rest] = positionals
    // A refused flag or argument is named, never folded into the command.
    const fail = (argument = 'usage'): RuntimeCommand => invalid(argument)
    if (rest.length > 0) return fail(rest.join(' '))
    if (values.json === true && values.csv === true) return fail('--json --csv')
    if (values.out === '') return fail('--out')
    if (action === 'open' || action === 'serve') {
      if (
        Object.keys(values).some((key) => key !== 'stdio') ||
        (action === 'serve' ? values.stdio !== true : values.stdio !== undefined)
      )
        return fail('--stdio')
      return { command: 'usage', options: { action: action === 'serve' ? 'stdio' : 'open' } }
    }
    if (values.stdio !== undefined) return fail('--stdio')
    if (!['summary', 'daily', 'models', 'limits', 'export'].includes(action)) return fail(action)
    // CLI flags are a separate input boundary. Importing the page schema here
    // would eagerly carry the full usage table into the ACP startup bundle.
    const query = z
      .strictObject({
        range: z.enum(['today', '7d', '30d', '90d', 'custom']),
        groupBy: z.enum(['provider', 'model', 'kind', 'client']),
        metric: z.literal('cost'),
        from: z.optional(z.iso.date()),
        to: z.optional(z.iso.date()),
      })
      .safeParse({
        range:
          values.range ?? (values.from !== undefined || values.to !== undefined ? 'custom' : '30d'),
        groupBy: values.by ?? (action === 'models' ? 'model' : 'provider'),
        metric: 'cost',
        ...(values.from !== undefined && { from: values.from }),
        ...(values.to !== undefined && { to: values.to }),
      })
    if (!query.success) {
      if (
        typeof values.range === 'string' &&
        !['today', '7d', '30d', '90d', 'custom'].includes(values.range)
      )
        return fail('--range')
      return fail(
        typeof values.by === 'string' &&
          !['provider', 'model', 'kind', 'client'].includes(values.by)
          ? '--by'
          : '--from --to',
      )
    }
    if (
      (query.data.range === 'custom' &&
        (query.data.from === undefined ||
          query.data.to === undefined ||
          query.data.from > query.data.to)) ||
      (query.data.range !== 'custom' && (values.from !== undefined || values.to !== undefined))
    )
      return fail('--from --to')
    // Narrow the validated subcommand without a cast, keeping invalid actions out.
    if (
      action !== 'summary' &&
      action !== 'daily' &&
      action !== 'models' &&
      action !== 'limits' &&
      action !== 'export'
    )
      return fail()
    const format = action === 'export' || values.csv ? 'csv' : 'text'
    return {
      command: 'usage',
      options: {
        action,
        query: query.data,
        format: values.json ? 'json' : format,
        ...(values.out !== undefined && { out: values.out }),
      },
    }
  } catch (error: unknown) {
    // Only the option parser fails here (unknown option, invalid value);
    // anything else is not this parse's answer to give.
    if (error instanceof Error && 'code' in error) {
      if (error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') return usageRefusal('usage', error)
      if (error.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') return usageRefusal('usage', error)
    }
    throw error
  }
}

function parseHeadless(argv: readonly string[]): RuntimeCommand {
  const topic = argv[0] === 'scan-secrets' ? 'scan-secrets' : 'exec'
  try {
    if (argv[0] === 'scan-secrets') {
      const { values, positionals } = parseArgs({
        args: argv.slice(1),
        allowPositionals: true,
        strict: true,
        options: CLI_OPTION_REGISTRY['scan-secrets'].options,
      })
      if (values.help === true) return { command: 'helpTopic', topic: 'scan-secrets' }
      // D121: no deadline of ours — absent runs until the scan finishes. A
      // set value is whole seconds within the platform timer's range.
      const rawTimeout = values.timeout
      let timeoutMs: number | undefined
      if (rawTimeout !== undefined) {
        const seconds =
          typeof rawTimeout === 'string' && /^[0-9]+$/.test(rawTimeout) ? Number(rawTimeout) : NaN
        if (
          !Number.isSafeInteger(seconds) ||
          seconds < 1 ||
          seconds > Math.floor(TIMER_MAX_DELAY_MS / MILLISECONDS_PER_SECOND)
        )
          return {
            command: 'invalid',
            reason: fill(UI_TEXT.execLimitInvalid, { flag: '--timeout' }),
            exitCode: 2,
          }
        timeoutMs = seconds * MILLISECONDS_PER_SECOND
      }
      return positionals.length === 1 && positionals[0] !== undefined
        ? {
            command: 'scan-secrets',
            file: positionals[0],
            keyFromStdin: values['key-stdin'] === true,
            ...(timeoutMs !== undefined && { timeoutMs }),
          }
        : { command: 'invalid', reason: UI_TEXT.execScanUsage, exitCode: 2 }
    }
    const { values, positionals } = parseArgs({
      args: argv.slice(1),
      allowPositionals: true,
      strict: true,
      options: CLI_OPTION_REGISTRY.exec.options,
    })
    if (values.help === true) return { command: 'helpTopic', topic: 'exec' }
    const enumError = enumRefusal('exec', values)
    if (enumError !== undefined) return enumError
    const { help: _help, attach, record, ...execValues } = values
    if (record === true)
      return { command: 'invalid', reason: UI_TEXT.media.recordingUserOnly, exitCode: 2 }
    const attachments = parseAttachArgs(attach)
    if (!attachments.ok) return { command: 'invalid', reason: attachments.reason, exitCode: 2 }
    const resourceOverrides = resourceFlagOverrides(execValues)
    const options = Object.fromEntries(
      Object.entries(execValues).filter(
        ([key]) => !['resource-governor', 'cpu-max', 'memory-max'].includes(key),
      ),
    )
    const parsed = parseExec(options, positionals)
    return parsed.ok
      ? {
          command: 'exec',
          options: {
            ...parsed.options,
            ...(attachments.files.length > 0 && { attachFiles: attachments.files }),
          },
          resourceOverrides,
        }
      : { command: 'invalid', reason: parsed.reason, exitCode: 2 }
  } catch (error: unknown) {
    const found = helpTopicNamed(topic)
    return found === undefined
      ? invalidHeadlessCause(error)
      : invalidStrictOption(found.name, topicShownOptionNames(found), error)
  }
}

/** A headless usage refusal, with the headless usage exit code. */
function invalidHeadlessReason(reason: string): RuntimeCommand {
  return { command: 'invalid', reason, exitCode: 2 }
}

/** A `parseArgs` throw as a headless usage refusal (never a prompt). */
function invalidHeadlessCause(error: unknown): RuntimeCommand {
  return invalidHeadlessReason(
    parserUnknownOption(error) ?? (error instanceof Error ? error.message : String(error)),
  )
}

function legalOutcome(parsed: ReturnType<typeof parseLegalArgs>): RuntimeCommand {
  return parsed.ok
    ? { command: 'legal', options: parsed.options }
    : invalidHeadlessReason(parsed.reason)
}

/**
The reserved read-only scan (M97 lane R): `legal` never reaches prompt
parsing, starts no backend and touches no credential store. Unknown flags
are usage errors, as for the other headless commands.
*/
function parseLegalCommand(argv: readonly string[]): RuntimeCommand {
  try {
    const { values, positionals } = parseArgs({
      args: argv.slice(1),
      allowPositionals: true,
      strict: true,
      options: CLI_OPTION_REGISTRY.legal.options,
    })
    return values.help === true
      ? { command: 'helpTopic', topic: 'legal' }
      : legalOutcome(parseLegalArgs(values, positionals))
  } catch (error: unknown) {
    const found = helpTopicNamed('legal')
    return found === undefined
      ? invalidHeadlessCause(error)
      : invalidStrictOption(found.name, topicShownOptionNames(found), error)
  }
}

function parseResources(argv: readonly string[]): RuntimeCommand {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: true,
      options: CLI_OPTION_REGISTRY.resources.options,
    })
    if (values.help === true) return { command: 'helpTopic', topic: 'resources' }
    const action = positionals[0] ?? 'status'
    return positionals.length > 1 ||
      (action !== 'status' && action !== 'history' && action !== 'resume')
      ? invalid(`resources ${positionals.join(' ')}`)
      : { command: 'resources', action, json: values.json === true }
  } catch (error: unknown) {
    // Only the option parser fails here (unknown option, invalid value);
    // anything else is not this parse's answer to give.
    if (error instanceof Error && 'code' in error) {
      if (error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') return usageRefusal('resources', error)
      if (error.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE')
        return usageRefusal('resources', error)
    }
    throw error
  }
}

/** `report [options]`: the standalone problem report (M93 lane A, PLAN.md D72). */
function parseReport(argv: readonly string[], canUseNamed = true): RuntimeCommand {
  // `report --help` is the report command's own help, not the whole
  // reference (REALLIFE F34); the reports command prints its usage.
  if (canUseNamed && argv.some((argument) => argument === '--help' || argument === '-h'))
    return { command: 'reports', args: argv }
  // M113 owns named reports; M93's bare command and option parser stay intact.
  if (
    canUseNamed &&
    argv.some((argument) => !argument.startsWith('-') || /^--from(?:=|$)/.test(argument))
  ) {
    // Values of M93 options are positionals only after parseArgs; try that
    // unchanged parser first before delegating to the lazy reports engine.
    try {
      const legacy = parseArgs({
        args: [...argv],
        allowPositionals: true,
        strict: true,
        options: CLI_OPTION_REGISTRY.report.options,
      })
      const namedKinds: readonly string[] = REPORT_KINDS
      if (
        legacy.positionals.some(
          (argument) => argument === 'history' || namedKinds.includes(argument),
        )
      )
        return { command: 'reports', args: argv }
    } catch (error) {
      // An M93-option parse failure belongs to the named reports engine,
      // which parses or refuses with its own words; anything else is not
      // this parse's answer to give.
      if (error instanceof Error && 'code' in error) {
        if (error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION')
          return { command: 'reports', args: argv }
        if (error.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE')
          return { command: 'reports', args: argv }
      }
      throw error
    }
  }
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: CLI_OPTION_REGISTRY.report.options,
    })
    if (values.help === true) return { command: 'helpTopic', topic: 'report' }
    if (positionals.length > 0 || values.out === '') {
      return { command: 'invalid', reason: reportUsage(), exitCode: 2 }
    }
    return {
      command: 'report',
      options: {
        out: values.out,
        description: values.description ?? '',
        includeFacts: values['no-facts'] !== true,
        includeEvents: values['no-events'] !== true,
      },
    }
  } catch (error) {
    // Only the option parser fails here (unknown option, invalid value);
    // anything else is not this parse's answer to give.
    if (error instanceof Error && 'code' in error) {
      if (error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION')
        return { command: 'invalid', reason: reportUsage(), exitCode: 2 }
      if (error.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE')
        return { command: 'invalid', reason: reportUsage(), exitCode: 2 }
    }
    throw error
  }
}

function reportUsage(): string {
  return fill(UI_TEXT.reportUsage, { command: ACP_AGENT_NAME })
}

function parseCommandLineStrictly(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: CLI_OPTION_REGISTRY.serve.options,
  })
}

/** Installation is an explicit command; none of the serve flags can trigger it. */
function parseFonts(argv: readonly string[]): RuntimeCommand {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: CLI_OPTION_REGISTRY.fontsInstall.options,
    })
    if (values.help === true) return { command: 'helpTopic', topic: 'fonts' }
    if (positionals.length === 1 && positionals[0] === 'install' && values.from !== '')
      return { command: 'fontsInstall', sourceDirectory: values.from }
  } catch (error: unknown) {
    /* A wrong fonts option names the option and the nearest valid one. */
    const found = helpTopicNamed('fonts')
    if (found !== undefined && error instanceof Error && /unknown option/i.test(error.message)) {
      const topic = found.name
      const valid = topicShownOptionNames(found)
      const raw = error.message
      return {
        command: 'invalid',
        exitCode: 2,
        // main installs the display language after parsing, before printing.
        get reason() {
          return unknownOptionReason(UI_TEXT, ACP_AGENT_NAME, topic, valid, raw)
        },
      }
    }
  }
  return {
    command: 'invalid',
    exitCode: 2,
    // main installs the display language after parsing, before printing usage.
    get reason() {
      return fill(UI_TEXT.acpFontsUsage, { command: ACP_AGENT_NAME })
    },
  }
}

/** A strict-parser throw for a topic: the topic's own options named, exit 2. */
function invalidTopicOption(name: string, error: unknown): RuntimeCommand {
  const topic = helpTopicNamed(name)
  return topic === undefined
    ? { ...invalid(name), exitCode: 2 }
    : invalidStrictOption(topic.name, topicShownOptionNames(topic), error)
}

/**
`lsp` (M104 lane H): every flag checked here, none read from the serve
grammar, so no paid feature turns on by a shared flag. The Tab model is
one of Meta's two (a contributor model only with
`--allow-contributor-models`); a budget is 0 (none) or at least the dust
floor; an output cap is a whole count, 0 for the model's maximum.
*/
function parseLsp(argv: readonly string[]): RuntimeCommand {
  let values: ReturnType<typeof parseLspArgs>['values']
  try {
    ;({ values } = parseLspArgs(argv))
  } catch (error: unknown) {
    return invalidTopicOption('lsp', error)
  }
  if (values.help === true) return { command: 'helpTopic', topic: 'lsp' }
  const tabModel = values['tab-model'] ?? SETTING_DEFAULTS.tabModel
  if (!isOneOf(TAB_MODELS, tabModel)) return refused(valueInvalidReason('lsp', '--tab-model'))
  if (tabModel !== SETTING_DEFAULTS.tabModel && values['allow-contributor-models'] !== true)
    return invalid('--allow-contributor-models')
  const budget = nonnegativeUsdSchema.safeParse(
    values['tab-daily-budget-usd'] ?? String(SETTING_DEFAULTS.tabDailyBudgetUsd),
  )
  if (
    !budget.success ||
    (compareUsdAmounts(budget.data, nonnegativeUsdSchema.parse(String(TAB_NO_BUDGET_USD))) !== 0 &&
      compareUsdAmounts(budget.data, nonnegativeUsdSchema.parse(String(TAB_DAILY_BUDGET_MIN_USD))) <
        0)
  )
    return refused(valueInvalidReason('lsp', '--tab-daily-budget-usd'))
  const rawCap = values['tab-max-output-tokens'] ?? String(SETTING_DEFAULTS.tabMaxOutputTokens)
  const cap = /^\d+$/u.test(rawCap) ? Number(rawCap) : NaN
  if (!Number.isSafeInteger(cap))
    return refused(valueInvalidReason('lsp', '--tab-max-output-tokens'))
  const tabTrigger = values['tab-trigger'] ?? SETTING_DEFAULTS.tabTrigger
  if (!isOneOf(TAB_TRIGGER_MODES, tabTrigger))
    return refused(valueInvalidReason('lsp', '--tab-trigger'))
  return {
    command: 'lsp',
    options: {
      workspace: values.workspace ?? '.',
      isTabOn: values.tab === true,
      isTrusted: values['trust-workspace'] === true,
      tabModel,
      tabBudgetUsd: budget.data,
      tabMaxOutputTokens: cap,
      tabTrigger,
      isVerbose: values.verbose === true,
    },
  }
}

function parseLspArgs(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: false,
    strict: true,
    options: CLI_OPTION_REGISTRY.lsp.options,
  })
}

/**
`supervise <command>` (M104 lane H): everything after the word is the
supervised command's own, parsed by the child as typed. A supervisor never
supervises another supervisor or a stop.
*/
function parseSupervise(argv: readonly string[]): RuntimeCommand {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h'))
    return { command: 'helpTopic', topic: 'supervise' }
  return argv[0] === 'supervise' || argv[0] === 'stop'
    ? invalid(argv[0])
    : { command: 'supervise', args: argv }
}

/** `stop` (M104 lane H): no option but help; the folder it runs in names the runs. */
function parseStop(argv: readonly string[]): RuntimeCommand {
  try {
    const { values } = parseArgs({
      args: [...argv],
      allowPositionals: false,
      strict: true,
      options: CLI_OPTION_REGISTRY.stop.options,
    })
    return values.help === true ? { command: 'helpTopic', topic: 'stop' } : { command: 'stop' }
  } catch (error: unknown) {
    return invalidTopicOption('stop', error)
  }
}
