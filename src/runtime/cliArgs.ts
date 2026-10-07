// The agent's command line (PLAN.md D62): serve ACP on stdio, or one of the
// sign-in commands the editors' terminal sign-ins run (D61). Pure: the
// arguments in, what to do out, with the reason when they make no sense.

import { parseArgs } from 'node:util'
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
} from '../shared/constants'
import { accountIdSchema } from '../shared/accounts'
import { fill } from '../shared/l10n/text'
import { parseExec, type ExecOptions } from './exec/execArgs'
import { questionDeferSeconds } from '../shared/questionDeadline'
import {
  parseAccountsCommand,
  type AccountsCommand,
  type AccountTarget,
} from './providers/accountsCommand'

export interface ServeOptions {
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

export type RuntimeCommand =
  | { readonly command: 'setup'; readonly options: ServeOptions; readonly maintenance: boolean }
  | { readonly command: 'exec'; readonly options: ExecOptions }
  | { readonly command: 'scan-secrets'; readonly file: string; readonly keyFromStdin: boolean }
  | { readonly command: 'report'; readonly options: ReportOptions }
  | { readonly command: 'serve'; readonly options: ServeOptions }
  | { readonly command: 'login'; readonly options: ServeOptions }
  | { readonly command: 'accounts'; readonly options: AccountsCommand }
  | { readonly command: 'help'; readonly all?: boolean }
  | { readonly command: 'authSet'; readonly target?: AccountTarget }
  | { readonly command: 'authStatus' | 'authClear' | 'version' }
  | { readonly command: 'invalid'; readonly reason: string; readonly exitCode?: number }

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
  return value !== undefined && (allowed as readonly string[]).includes(value)
}

function invalid(argument: string): RuntimeCommand {
  return { command: 'invalid', reason: fill(UI_TEXT.acpUnknownArgument, { argument }) }
}

/** The paid features whose flags were given, in the flags' order. */
function paidFeaturesOf(values: Readonly<Record<string, unknown>>): AcpPaidFeature[] {
  return ACP_PAID_FEATURES.filter((feature) => values[ACP_PAID_FLAGS[feature]] === true)
}

export function parseCommandLine(argv: readonly string[]): RuntimeCommand {
  if (argv[0] === 'help') {
    return argv.length === 1 || (argv.length === 2 && argv[1] === '--all')
      ? { command: 'help', all: argv[1] === '--all' }
      : invalid(argv.join(' '))
  }
  if (argv[0] === 'providers') {
    const options = argv[1] === 'accounts' ? parseAccountsCommand(argv.slice(2)) : undefined
    return options === undefined
      ? { command: 'invalid', reason: fill(UI_TEXT.accounts.cliUsage, { command: ACP_AGENT_NAME }) }
      : { command: 'accounts', options }
  }
  if (argv[0] === 'exec' || argv[0] === 'scan-secrets') return parseHeadless(argv)
  if (argv[0] === 'report') return parseReport(argv.slice(1))
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
  const options: ServeOptions = {
    backend,
    trustWorkspace: values['trust-workspace'] === true,
    museBinary: values['muse-binary'] ?? SETTING_DEFAULTS.museBinaryPath,
    shellSandbox,
    canBypass: values['allow-dangerously-skip-permissions'] === true,
    allowsContributorModels: values['allow-contributor-models'] === true,
    paidFeatures,
    isVerbose: values.verbose === true,
    questionsDeferAfterSeconds,
  }
  const [first, second, ...rest] = positionals
  const hasTarget = values.provider !== undefined || values.account !== undefined
  if (hasTarget && (first !== 'auth' || second !== 'set' || rest.length > 0))
    return { command: 'invalid', reason: UI_TEXT.accounts.credentialHelp }
  if (first === 'setup' && second === undefined) {
    return options.trustWorkspace
      ? { command: 'setup', options, maintenance: values.maintenance === true }
      : { command: 'invalid', reason: UI_TEXT.hooksNotRunnable }
  }
  if (values.maintenance === true) return invalid('--maintenance')
  if (first === undefined) {
    return { command: 'serve', options }
  }
  if (first === 'login' && second === undefined) {
    return { command: 'login', options }
  }
  const auth = first === 'auth' && rest.length === 0 ? authCommand(second) : undefined
  if (first === 'auth' && auth === undefined)
    return { command: 'invalid', reason: UI_TEXT.accounts.credentialHelp }
  if (auth === 'authSet' && hasTarget) {
    const provider = accountIdSchema.safeParse(values.provider ?? 'meta')
    const account = accountIdSchema.safeParse(values.account ?? ACCOUNT_DEFAULT_ID)
    return provider.success && account.success
      ? { command: auth, target: { provider: provider.data, account: account.data } }
      : { command: 'invalid', reason: UI_TEXT.accounts.invalidAccount }
  }
  return auth === undefined ? invalid(positionals.join(' ')) : { command: auth }
}

function parseHeadless(argv: readonly string[]): RuntimeCommand {
  try {
    const isScan = argv[0] === 'scan-secrets'
    const { values, positionals } = parseArgs({
      args: argv.slice(1),
      allowPositionals: true,
      strict: true,
      options: isScan
        ? CLI_OPTION_REGISTRY['scan-secrets'].options
        : CLI_OPTION_REGISTRY.exec.options,
    })
    if (values.help === true) return { command: 'help', all: true }
    if (isScan)
      return positionals.length === 1 && positionals[0] !== undefined
        ? {
            command: 'scan-secrets',
            file: positionals[0],
            keyFromStdin: values['key-stdin'] === true,
          }
        : { command: 'invalid', reason: UI_TEXT.execScanUsage, exitCode: 2 }
    const { help: _help, ...options } = values
    const parsed = parseExec(options, positionals)
    return parsed.ok
      ? { command: 'exec', options: parsed.options }
      : { command: 'invalid', reason: parsed.reason, exitCode: 2 }
  } catch (error: unknown) {
    return {
      command: 'invalid',
      reason: error instanceof Error ? error.message : String(error),
      exitCode: 2,
    }
  }
}

/** `report [options]`: the standalone problem report (M93 lane A, PLAN.md D72). */
function parseReport(argv: readonly string[]): RuntimeCommand {
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
