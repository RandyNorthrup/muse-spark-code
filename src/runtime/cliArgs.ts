import type { UsdAmount } from '../shared/usdSchema'
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
  type AcpBackendKind,
  type AcpPaidFeature,
  SETTING_DEFAULTS,
  SHELL_SANDBOX_MODES,
  type ShellSandboxMode,
  UI_TEXT,
  REPORT_KINDS,
} from '../shared/constants'
import { modelRef } from '../host/backend/providerPolicyEntry'
const { isProviderId } = modelRef
import type { OpenRouterPrivacy } from '../core/providers/presets'
import { accountIdSchema } from '../shared/accounts'
import { fill } from '../shared/l10n/text'
import { parseExec } from './exec/execArgs'
import { resourceFlagOverrides } from './resources/args'
import type { ResourceSettings } from '../shared/resources'
import type { ResourceCommandAction } from './resources/port'
import { parseLegalArgs, type LegalOptions } from './legal/legalArgs'
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
import { questionDeferSeconds } from '../shared/questionDeadline'
import { parsePlaybookCommand } from './playbook/command'

/** U's CLI route; the runtime entry owner binds runPlaybookCommand to P's
 * journal before the general ACP/auth parser. No model process is needed. */
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
  readonly usageHistory?: boolean
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
  /** The finest log detail on stderr. */
  readonly isVerbose: boolean
  /** Interactive ACP questions; no forms still defer at once. */
  readonly questionsDeferAfterSeconds?: number
  readonly autoCompaction?: boolean | undefined
  readonly scheduledPrompts?: boolean
  readonly maxBudgetUsd?: UsdAmount
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
  /** OpenRouter's privacy routing; the default stays `zdr` (D74). */
  readonly privacy?: OpenRouterPrivacy | undefined
  /** Confirm a private-network address (asked once, D74). */
  readonly privateOk: boolean
  /** Read the key from standard input (never an argument or the environment). */
  readonly keyFromStdin: boolean
}

export type RuntimeCommand =
  | { readonly command: 'usage'; readonly options: UsageCommand }
  | { readonly command: 'schedule'; readonly options: ScheduleCommandOptions }
  | { readonly command: 'vault'; readonly options: VaultCommandOptions }
  | { readonly command: 'setup'; readonly options: ServeOptions; readonly maintenance: boolean }
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
  | { readonly command: 'scan-secrets'; readonly file: string; readonly keyFromStdin: boolean }
  | { readonly command: 'report'; readonly options: ReportOptions }
  | { readonly command: 'legal'; readonly options: LegalOptions }
  | { readonly command: 'reports'; readonly args: readonly string[] }
  | { readonly command: 'fontsInstall'; readonly sourceDirectory: string | undefined }
  | { readonly command: 'playbook'; readonly argv: readonly string[] }
  | { readonly command: 'estimate'; readonly argv: readonly string[] }
  | { readonly command: 'serve'; readonly options: ServeOptions }
  | { readonly command: 'login'; readonly options: ServeOptions }
  | {
      readonly command: 'authStatus' | 'authClear'
      readonly provider?: string | undefined
    }
  | { readonly command: 'providersList' }
  | { readonly command: 'providersAdd'; readonly options: ProvidersAddOptions }
  | { readonly command: 'providersTest'; readonly provider: string }
  | { readonly command: 'providersRemove'; readonly provider: string }
  | {
      readonly command: 'authSet'
      readonly provider?: string | undefined
      readonly target?: AccountTarget
    }
  | { readonly command: 'accounts'; readonly options: AccountsCommand }
  | { readonly command: 'developer'; readonly args: readonly string[] }
  | { readonly command: 'help'; readonly all?: boolean }
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
  if (command !== 'providers' || provider !== 'chatgpt' || rest.length > 0) return
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
 * Flags `serve` and `login` never take (M95: `auth … --provider` and
 * `providers …`). Each names a key of the strict parser's values, so
 * indexing with one typechecks without a cast.
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
] as const
const NON_SERVE_OPTIONS = ['provider', ...PROVIDER_AUTH_OPTIONS] as const

/** The strict parser's values, for the provider subcommands below. */
type StrictValues = ReturnType<typeof parseCommandLineStrictly>['values']

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
  return { command: 'invalid', reason: fill(UI_TEXT.acpUnknownArgument, { argument }) }
}

/** The paid features whose flags were given, in the flags' order. */
function paidFeaturesOf(values: Readonly<Record<string, unknown>>): AcpPaidFeature[] {
  return ACP_PAID_FEATURES.filter((feature) => values[ACP_PAID_FLAGS[feature]] === true)
}

export function parseCommandLine<T>(
  argv: readonly string[],
  localSharing: (argv: readonly string[]) => T,
): RuntimeCommand | T
export function parseCommandLine(argv: readonly string[]): RuntimeCommand
export function parseCommandLine<T>(
  argv: readonly string[],
  localSharing?: (argv: readonly string[]) => T,
): RuntimeCommand | T {
  // M118-X-CLI: main's owner injects the local parser/runner once P/C bind.
  // Without that binding these reserved commands fail explicitly, never serve.
  if (argv[0] === 'share' || argv[0] === 'prompts') {
    if (localSharing === undefined) return invalid(argv[0])
    try {
      return localSharing(argv)
    } catch (error: unknown) {
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
  if (argv[0] === 'resources') return parseResources(argv.slice(1))
  if (argv[0] === 'usage' && argv[1] === 'resources')
    return parseResources(['history', ...argv.slice(2)])
  if (argv[0] === 'usage') return parseUsage(argv.slice(1))
  if (argv[0] === 'providers' && (argv[2] === 'chatgpt' || argv[2] === 'copilot')) {
    const action = parseChatGptProviderAction(argv)
    return action === undefined
      ? { command: 'invalid', reason: UI_TEXT.acpChatGpt.usage }
      : { command: 'chatGptProvider', action }
  }
  if (argv[0] === 'help') {
    return argv.length === 1 || (argv.length === 2 && argv[1] === '--all')
      ? { command: 'help', all: argv[1] === '--all' }
      : invalid(argv.join(' '))
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
      ? { command: 'invalid', reason: fill(UI_TEXT.accounts.cliUsage, { command: ACP_AGENT_NAME }) }
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
  if (argv[0] === 'exec' || argv[0] === 'scan-secrets') return parseHeadless(argv)
  if (argv[0] === 'report')
    return parseReport(argv.slice(argv[1] === 'problem' ? 2 : 1), argv[1] !== 'problem')
  if (argv[0] === 'legal') return parseLegalCommand(argv)
  if (argv[0] === 'fonts') return parseFonts(argv.slice(1))
  if (argv[0] === 'playbook') return { command: 'playbook', argv: argv.slice(1) }
  let parsed: ReturnType<typeof parseCommandLineStrictly>
  try {
    parsed = parseCommandLineStrictly(argv)
  } catch (error: unknown) {
    if (argv.includes('auth'))
      return { command: 'invalid', reason: UI_TEXT.accounts.credentialHelp }
    return { command: 'invalid', reason: error instanceof Error ? error.message : String(error) }
  }
  const { values, positionals } = parsed
  if (values.help === true) {
    return { command: 'help' }
  }
  if (values.version === true) {
    return { command: 'version' }
  }
  const backend = values.backend ?? ACP_DEFAULT_BACKEND
  if (!isOneOf(ACP_BACKENDS, backend)) {
    return positionals[0] === 'auth'
      ? { command: 'invalid', reason: UI_TEXT.accounts.credentialHelp }
      : invalid(`--backend ${backend}`)
  }
  const shellSandbox = values['shell-sandbox'] ?? SETTING_DEFAULTS.shellSandbox
  if (!isOneOf(SHELL_SANDBOX_MODES, shellSandbox)) {
    return positionals[0] === 'auth'
      ? { command: 'invalid', reason: UI_TEXT.accounts.credentialHelp }
      : invalid(`--shell-sandbox ${shellSandbox}`)
  }
  const paidFeatures = paidFeaturesOf(values)
  if (values['usage-history'] !== undefined && !['on', 'off'].includes(values['usage-history']))
    return invalid('--usage-history')
  const rawSeconds = values['questions-defer-after']
  const questionsDeferAfterSeconds =
    rawSeconds === undefined ? questionDeferSeconds() : questionDeferSeconds(Number(rawSeconds))
  if (
    questionsDeferAfterSeconds === undefined ||
    (rawSeconds !== undefined && !/^\d+$/.test(rawSeconds))
  )
    return invalid(`--questions-defer-after ${rawSeconds ?? ''}`)
  const [firstPaid] = paidFeatures
  if (firstPaid !== undefined && backend !== 'modelApi') {
    return {
      command: 'invalid',
      reason: fill(UI_TEXT.acpPaidNeedsModelApi, { argument: `--${ACP_PAID_FLAGS[firstPaid]}` }),
    }
  }
  const budget =
    values['max-budget-usd'] === undefined ? undefined : scheduleBudgetUsd(values['max-budget-usd'])
  if (budget === undefined && values['max-budget-usd'] !== undefined)
    return { command: 'invalid', reason: UI_TEXT.scheduleV2.runtime.usage }
  const options: ServeOptions = {
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
    isVerbose: values.verbose === true,
    questionsDeferAfterSeconds,
    autoCompaction: values['no-auto-compaction'] !== true,
    ...(values['scheduled-prompts'] !== undefined && {
      scheduledPrompts: values['scheduled-prompts'],
    }),
    ...(budget !== undefined && { maxBudgetUsd: budget }),
  }
  const [first, second, ...rest] = positionals
  if (values.account !== undefined && (first !== 'auth' || second !== 'set' || rest.length > 0))
    return { command: 'invalid', reason: UI_TEXT.accounts.credentialHelp }
  if (first === 'setup' && second === undefined) {
    if (values.provider !== undefined) return invalid('setup')
    return options.trustWorkspace
      ? { command: 'setup', options, maintenance: values.maintenance === true }
      : { command: 'invalid', reason: UI_TEXT.hooksNotRunnable }
  }
  if (values.maintenance === true) return invalid('--maintenance')
  if (first === undefined) {
    // The provider commands' flags are not serve flags.
    return NON_SERVE_OPTIONS.some((name) => values[name] !== undefined)
      ? invalid(positionals.join(' '))
      : { command: 'serve', options }
  }
  if (first === 'login') {
    return second === undefined && NON_SERVE_OPTIONS.every((name) => values[name] === undefined)
      ? { command: 'login', options }
      : invalid(positionals.join(' '))
  }
  if (first === 'providers') {
    return parseProviders(values, second, rest)
  }
  if (first !== 'auth') return invalid(positionals.join(' '))
  if (rest.length > 0) return { command: 'invalid', reason: UI_TEXT.accounts.credentialHelp }
  if (PROVIDER_AUTH_OPTIONS.some((name) => values[name] !== undefined)) {
    return { command: 'invalid', reason: UI_TEXT.accounts.credentialHelp }
  }
  const auth = authCommand(second)
  if (auth === undefined) {
    return { command: 'invalid', reason: UI_TEXT.accounts.credentialHelp }
  }
  const provider = values.provider
  const hasTarget = values.account !== undefined
  if (auth === 'authSet' && hasTarget) {
    const targetProvider = accountIdSchema.safeParse(provider ?? 'meta')
    const targetAccount = accountIdSchema.safeParse(values.account ?? ACCOUNT_DEFAULT_ID)
    return targetProvider.success && targetAccount.success
      ? { command: auth, target: { provider: targetProvider.data, account: targetAccount.data } }
      : { command: 'invalid', reason: UI_TEXT.accounts.invalidAccount }
  }
  if (provider !== undefined && !isProviderId(provider)) {
    return { command: 'invalid', reason: fill(UI_TEXT.providerUnknown, { provider }) }
  }

  return provider === undefined ? { command: auth } : { command: auth, provider }
}

/** `providers list|add|test|remove` (M95, PLAN.md D74). */
function parseProviders(
  values: StrictValues,
  verb: string | undefined,
  rest: readonly string[],
): RuntimeCommand {
  switch (verb) {
    case 'list': {
      return rest.length === 0 ? { command: 'providersList' } : invalid('providers list')
    }
    case 'test':
    case 'remove': {
      const [provider] = rest
      if (provider === undefined || rest.length !== 1 || !isProviderId(provider)) {
        return {
          command: 'invalid',
          reason: fill(UI_TEXT.providerUnknown, { provider: provider ?? '' }),
        }
      }
      return { command: verb === 'test' ? 'providersTest' : 'providersRemove', provider }
    }
    case 'add': {
      return parseProvidersAdd(values, rest)
    }
    default: {
      return invalid(`providers ${verb ?? ''}`.trim())
    }
  }
}

/** `providers add --preset <id> [--as <id>] [--address <url>] [--model <id>…] …`. */
function parseProvidersAdd(values: StrictValues, rest: readonly string[]): RuntimeCommand {
  if (rest.length > 0) {
    return invalid(`providers add ${rest.join(' ')}`.trim())
  }
  const preset = values.preset
  if (typeof preset !== 'string' || !isProviderId(preset)) {
    return {
      command: 'invalid',
      reason: fill(UI_TEXT.providerUnknown, {
        provider: typeof preset === 'string' ? preset : '',
      }),
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
    return invalid('providers add')
  }
  const rawModels = values.model ?? []
  if (rawModels.some((model) => typeof model !== 'string' || model === '')) {
    return invalid('providers add')
  }
  for (const name of Object.keys(values)) {
    if (
      ![
        'preset',
        'as',
        'address',
        'format',
        'model',
        'privacy',
        'key-stdin',
        'private-ok',
      ].includes(name)
    ) {
      return invalid(`--${name}`)
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
    if (values.help) return { command: 'help' }
    const [action = 'summary', ...rest] = positionals
    const fail = (): RuntimeCommand => ({ ...invalid('usage'), exitCode: 2 })
    if (rest.length > 0 || (values.json && values.csv) || values.out === '') return fail()
    if (action === 'open' || action === 'serve') {
      if (
        Object.keys(values).some((key) => key !== 'stdio') ||
        (action === 'serve' ? values.stdio !== true : values.stdio !== undefined)
      )
        return fail()
      return { command: 'usage', options: { action: action === 'serve' ? 'stdio' : 'open' } }
    }
    if (
      values.stdio !== undefined ||
      !['summary', 'daily', 'models', 'limits', 'export'].includes(action)
    )
      return fail()
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
    if (
      !query.success ||
      (query.data.range === 'custom' &&
        (query.data.from === undefined ||
          query.data.to === undefined ||
          query.data.from > query.data.to)) ||
      (query.data.range !== 'custom' && (values.from !== undefined || values.to !== undefined))
    )
      return fail()
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
  } catch {
    return { ...invalid('usage'), exitCode: 2 }
  }
}

function parseHeadless(argv: readonly string[]): RuntimeCommand {
  try {
    if (argv[0] === 'scan-secrets') {
      const { values, positionals } = parseArgs({
        args: argv.slice(1),
        allowPositionals: true,
        strict: true,
        options: CLI_OPTION_REGISTRY['scan-secrets'].options,
      })
      if (values.help === true) return { command: 'help', all: true }
      return positionals.length === 1 && positionals[0] !== undefined
        ? {
            command: 'scan-secrets',
            file: positionals[0],
            keyFromStdin: values['key-stdin'] === true,
          }
        : { command: 'invalid', reason: UI_TEXT.execScanUsage, exitCode: 2 }
    }
    const { values, positionals } = parseArgs({
      args: argv.slice(1),
      allowPositionals: true,
      strict: true,
      options: CLI_OPTION_REGISTRY.exec.options,
    })
    if (values.help === true) return { command: 'help', all: true }
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
    return invalidHeadlessCause(error)
  }
}

/** A headless usage refusal, with the headless usage exit code. */
function invalidHeadlessReason(reason: string): RuntimeCommand {
  return { command: 'invalid', reason, exitCode: 2 }
}

/** A `parseArgs` throw as a headless usage refusal (never a prompt). */
function invalidHeadlessCause(error: unknown): RuntimeCommand {
  return invalidHeadlessReason(error instanceof Error ? error.message : String(error))
}

function legalOutcome(parsed: ReturnType<typeof parseLegalArgs>): RuntimeCommand {
  return parsed.ok
    ? { command: 'legal', options: parsed.options }
    : invalidHeadlessReason(parsed.reason)
}

/**
 * The reserved read-only scan (M97 lane R): `legal` never reaches prompt
 * parsing, starts no backend and touches no credential store. Unknown flags
 * are usage errors, as for the other headless commands.
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
      ? { command: 'help' }
      : legalOutcome(parseLegalArgs(values, positionals))
  } catch (error: unknown) {
    return invalidHeadlessCause(error)
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
    if (values.help === true) return { command: 'help' }
    const action = positionals[0] ?? 'status'
    return positionals.length > 1 ||
      (action !== 'status' && action !== 'history' && action !== 'resume')
      ? { ...invalid(`resources ${positionals.join(' ')}`), exitCode: 2 }
      : { command: 'resources', action, json: values.json === true }
  } catch {
    return { ...invalid('resources'), exitCode: 2 }
  }
}

/** `report [options]`: the standalone problem report (M93 lane A, PLAN.md D72). */
function parseReport(argv: readonly string[], canUseNamed = true): RuntimeCommand {
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
    } catch {
      return { command: 'reports', args: argv }
    }
  }
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: CLI_OPTION_REGISTRY.report.options,
    })
    if (values.help === true) return { command: 'help', all: true }
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
  } catch {
    return { command: 'invalid', reason: reportUsage(), exitCode: 2 }
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
    if (values.help === true) return { command: 'help' }
    if (positionals.length === 1 && positionals[0] === 'install' && values.from !== '')
      return { command: 'fontsInstall', sourceDirectory: values.from }
  } catch {
    /* Invalid font arguments get the localized usage below. */
  }
  return {
    command: 'invalid',
    // main installs the display language after parsing, before printing usage.
    get reason() {
      return fill(UI_TEXT.acpFontsUsage, { command: ACP_AGENT_NAME })
    },
  }
}
