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
  /** The paid features the user may turn on at the first prompt (M63c); Model API only. */
  readonly paidFeatures: readonly AcpPaidFeature[]
  /** The finest log detail on stderr. */
  readonly isVerbose: boolean
}

export type RuntimeCommand =
  | { readonly command: 'serve'; readonly options: ServeOptions }
  | { readonly command: 'login'; readonly options: ServeOptions }
  | { readonly command: 'authSet' | 'authStatus' | 'authClear' | 'help' | 'version' }
  | { readonly command: 'invalid'; readonly reason: string }

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
