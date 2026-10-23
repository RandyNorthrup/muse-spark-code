import { parseArgs } from 'node:util'
import {
  EXEC_EXIT,
  JUDGE_ENGINES,
  JUDGE_REQUEST_TIMEOUT_MS,
  UI_TEXT,
  type JudgeEngine,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { Usd } from '../../shared/usd'
import { USD_DECIMAL_RADIX, USD_LIABILITY_DECIMALS } from '../../shared/usdConstants'
import type { UsdAmount } from '../../shared/usdSchema'

export interface JudgeCliOptions {
  readonly engine: Exclude<JudgeEngine, 'off'>
  readonly model: string | undefined
  readonly separate: string | undefined
  /** The run cap as a canonical amount; admission accounts it in integer nano-USD. */
  readonly budgetUsd: UsdAmount
  readonly timeoutMs: number
}

/** Distinguish caller configuration from an engine's private failures. */
export class JudgeCliInputError extends Error {
  public constructor() {
    super(UI_TEXT.execRequestShape)
    this.name = 'JudgeCliInputError'
  }
}

export interface JudgeCliCommand {
  readonly command: 'judge'
  readonly action:
    'ask' | 'calibrate' | 'report' | 'mcp' | 'serve' | 'lint' | 'scan' | 'setup' | 'remove'
  readonly options: JudgeCliOptions
  /** CS/H validate their own flags; G reserves their dispatch without guessing them. */
  readonly surfaceArgs: readonly string[]
}

/** M125 lane W: the local-judge text steps, which validate their own flags. */
export function isSetupAction(
  action: unknown,
): action is Extract<JudgeCliCommand['action'], 'scan' | 'setup' | 'remove'> {
  return typeof action === 'string' && ['scan', 'setup', 'remove'].includes(action)
}

const DEFAULT_OPTIONS: JudgeCliOptions = {
  engine: 'auto',
  model: undefined,
  separate: undefined,
  budgetUsd: Usd.from(0).toAmount(),
  timeoutMs: JUDGE_REQUEST_TIMEOUT_MS,
}

/** Nano-USD in one USD: the judge's run cap keeps the liability precision (RVM98P2R2 8). */
const NANO_USD_PER_USD = BigInt(USD_DECIMAL_RADIX) ** BigInt(USD_LIABILITY_DECIMALS)

/** Node's argv parser refusing flags: every refusal keeps its code prefix. */
function isParseArgsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('ERR_PARSE_ARGS_')
  )
}

/** `--budget-usd` as a canonical amount: decimal text, at most nine decimals, never through a float. */
function budget(value: string | undefined): UsdAmount | undefined {
  if (value === undefined) return Usd.from(0).toAmount()
  const [whole, fraction = ''] = value.split('.', 2)
  if (
    whole === undefined ||
    !/^[0-9]+(?:\.[0-9]+)?$/.test(value) ||
    fraction.length > USD_LIABILITY_DECIMALS
  )
    return undefined
  const units =
    BigInt(whole) * NANO_USD_PER_USD + BigInt(fraction.padEnd(USD_LIABILITY_DECIMALS, '0'))
  // Exactness bound only (D121: no spending cap of ours): the caller's
  // budget must survive the trip to integer nano-USD.
  return units <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Usd.fromUnits(units, USD_LIABILITY_DECIMALS).toAmount()
    : undefined
}

function invalid() {
  return {
    command: 'invalid' as const,
    reason: fill(UI_TEXT.acpUnknownArgument, { argument: 'judge' }),
    exitCode: EXEC_EXIT.usage,
  }
}

/**
Reserved before ACP/prompt parsing, including malformed and future judge
commands. An action's `--help` is malformed judge argv (exit 2): the strict
parser below owns every action form. Only the bare form answers help, so the
command table's walk can describe the one judge screen; the local-judge
steps (scan, setup, remove) answer a lone `--help` the same way.
*/
export function parseJudgeArgs(argv: readonly string[]):
  | JudgeCliCommand
  | {
      readonly command: 'invalid'
      readonly reason: string
      readonly exitCode: number
    }
  | { readonly command: 'help'; readonly route: string } {
  const action = argv[1]
  if (argv.length === 2 && (action === '--help' || action === '-h'))
    return { command: 'help', route: 'judge' }
  // The local-judge steps (M125 lane W) answer a lone --help with their
  // help screen, as the generic help router did for them before judge was
  // reserved here; their other flags stay theirs to validate.
  const [onlyFlag, ...more] = argv.slice(2)
  if (isSetupAction(action) && more.length === 0 && (onlyFlag === '--help' || onlyFlag === '-h'))
    return { command: 'help', route: `judge ${action}` }
  if (action === 'serve' || action === 'lint' || isSetupAction(action)) {
    return { command: 'judge', action, options: DEFAULT_OPTIONS, surfaceArgs: argv.slice(2) }
  }
  if (action !== 'ask' && action !== 'calibrate' && action !== 'report' && action !== 'mcp') {
    return invalid()
  }
  try {
    const { values, positionals, tokens } = parseArgs({
      args: argv.slice(2),
      strict: true,
      allowPositionals: true,
      tokens: true,
      options: {
        engine: { type: 'string' },
        model: { type: 'string' },
        separate: { type: 'string' },
        'budget-usd': { type: 'string' },
        'timeout-ms': { type: 'string' },
      },
    })
    const names = tokens.filter((token) => token.kind === 'option').map((token) => token.name)
    if (positionals.length > 0 || new Set(names).size !== names.length) return invalid()
    const engine = JUDGE_ENGINES.find((candidate) => candidate === (values.engine ?? 'auto'))
    const budgetUsd = budget(values['budget-usd'])
    const timeout = values['timeout-ms']
    const timeoutMs = timeout === undefined ? JUDGE_REQUEST_TIMEOUT_MS : Number(timeout)
    if (
      engine === undefined ||
      engine === 'off' ||
      budgetUsd === undefined ||
      (timeout !== undefined && !/^[0-9]+$/.test(timeout)) ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= 0 ||
      values.model?.trim() === '' ||
      values.separate?.trim() === ''
    )
      return invalid()
    return {
      command: 'judge',
      action,
      surfaceArgs: [],
      options: {
        engine,
        model: values.model,
        separate: values.separate,
        budgetUsd,
        timeoutMs,
      },
    }
  } catch (error: unknown) {
    // Never echo parseArgs' raw argv: it can contain pasted credentials.
    if (!isParseArgsError(error)) throw error
    return invalid()
  }
}
