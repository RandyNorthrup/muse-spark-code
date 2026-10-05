// The agent's command line (PLAN.md D62): serve ACP on stdio, or one of the
// sign-in commands the editors' terminal sign-ins run (D61). Pure: the
// arguments in, what to do out, with the reason when they make no sense.

import { parseArgs } from 'node:util'
import {
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
import { fill } from '../shared/l10n/text'
import { parseExec, type ExecOptions } from './exec/execArgs'
import { parseLegalArgs, type LegalOptions } from './legal/legalArgs'

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
}

export type RuntimeCommand =
  | { readonly command: 'exec'; readonly options: ExecOptions }
  | { readonly command: 'scan-secrets'; readonly file: string; readonly keyFromStdin: boolean }
  | { readonly command: 'legal'; readonly options: LegalOptions }
  | { readonly command: 'serve'; readonly options: ServeOptions }
  | { readonly command: 'login'; readonly options: ServeOptions }
  | { readonly command: 'authSet' | 'authStatus' | 'authClear' | 'help' | 'version' }
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
  if (argv[0] === 'exec' || argv[0] === 'scan-secrets') return parseHeadless(argv)
  if (argv[0] === 'legal') return parseLegalCommand(argv)
  let parsed: ReturnType<typeof parseCommandLineStrictly>
  try {
    parsed = parseCommandLineStrictly(argv)
  } catch (error: unknown) {
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
    return invalid(`--backend ${backend}`)
  }
  const shellSandbox = values['shell-sandbox'] ?? SETTING_DEFAULTS.shellSandbox
  if (!isOneOf(SHELL_SANDBOX_MODES, shellSandbox)) {
    return invalid(`--shell-sandbox ${shellSandbox}`)
  }
  const paidFeatures = paidFeaturesOf(values)
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
  }
  const [first, second, ...rest] = positionals
  if (first === undefined) {
    return { command: 'serve', options }
  }
  if (first === 'login' && second === undefined) {
    return { command: 'login', options }
  }
  const auth = first === 'auth' && rest.length === 0 ? authCommand(second) : undefined
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
        ? {
            'key-stdin': { type: 'boolean' },
            help: { type: 'boolean', short: 'h' },
          }
        : {
            backend: { type: 'string' },
            cwd: { type: 'string' },
            'prompt-file': { type: 'string' },
            'untrusted-file': { type: 'string', multiple: true },
            'permission-mode': { type: 'string' },
            model: { type: 'string' },
            effort: { type: 'string' },
            output: { type: 'string' },
            'max-budget-usd': { type: 'string' },
            'max-requests': { type: 'string' },
            timeout: { type: 'string' },
            'muse-binary': { type: 'string' },
            'shell-sandbox': { type: 'string' },
            'allow-contributor-models': { type: 'boolean' },
            'image-generation': { type: 'boolean' },
            'fail-on-denial': { type: 'boolean' },
            ephemeral: { type: 'boolean' },
            'key-stdin': { type: 'boolean' },
            verbose: { type: 'boolean' },
            'trust-workspace': { type: 'boolean' },
            'allow-dangerously-skip-permissions': { type: 'boolean' },
            'web-search': { type: 'boolean' },
            help: { type: 'boolean', short: 'h' },
          },
    })
    if (values.help === true) return { command: 'help' }
    if (isScan)
      return positionals.length === 1 && positionals[0] !== undefined
        ? {
            command: 'scan-secrets',
            file: positionals[0],
            keyFromStdin: values['key-stdin'] === true,
          }
        : { command: 'invalid', reason: UI_TEXT.execScanUsage, exitCode: 2 }
    const { help: _help, ...options } = values
    return execOutcome(parseExec(options, positionals))
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

function execOutcome(parsed: ReturnType<typeof parseExec>): RuntimeCommand {
  return parsed.ok
    ? { command: 'exec', options: parsed.options }
    : invalidHeadlessReason(parsed.reason)
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
      options: {
        format: { type: 'string' },
        out: { type: 'string' },
        registry: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    })
    return values.help === true
      ? { command: 'help' }
      : legalOutcome(parseLegalArgs(values, positionals))
  } catch (error: unknown) {
    return invalidHeadlessCause(error)
  }
}

function parseCommandLineStrictly(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      backend: { type: 'string' },
      'trust-workspace': { type: 'boolean' },
      'muse-binary': { type: 'string' },
      'shell-sandbox': { type: 'string' },
      'allow-dangerously-skip-permissions': { type: 'boolean' },
      'allow-contributor-models': { type: 'boolean' },
      [ACP_PAID_FLAGS.webSearch]: { type: 'boolean' },
      [ACP_PAID_FLAGS.imageGeneration]: { type: 'boolean' },
      verbose: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })
}
