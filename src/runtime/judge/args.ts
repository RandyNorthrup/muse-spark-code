import { parseArgs } from 'node:util'
import {
  EXEC_EXIT,
  JUDGE_CLI_DEFAULT_BUDGET_USD,
  JUDGE_ENGINES,
  JUDGE_REQUEST_TIMEOUT_MS,
  UI_TEXT,
  type JudgeEngine,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { USD_DECIMAL_RADIX, USD_LIABILITY_DECIMALS } from '../../shared/usdConstants'

export interface JudgeCliOptions {
  readonly engine: Exclude<JudgeEngine, 'off'>
  readonly model: string | undefined
  readonly separate: string | undefined
  /** Display only; admission uses `budgetNanoUsd`. */
  readonly budgetUsd: number
  /** The run cap in exact nano-USD (nine decimals, the liability precision). */
  readonly budgetNanoUsd: number
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
  readonly action: 'ask' | 'calibrate' | 'report' | 'mcp' | 'serve' | 'lint'
  readonly options: JudgeCliOptions
  /** CS/H validate their own flags; G reserves their dispatch without guessing them. */
  readonly surfaceArgs: readonly string[]
}

const DEFAULT_OPTIONS: JudgeCliOptions = {
  engine: 'auto',
  model: undefined,
  separate: undefined,
  budgetUsd: JUDGE_CLI_DEFAULT_BUDGET_USD,
  budgetNanoUsd: JUDGE_CLI_DEFAULT_BUDGET_USD,
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

/** `--budget-usd` as exact nano-USD: decimal text, at most nine decimals, never through a float. */
function budget(value: string | undefined): number | undefined {
  if (value === undefined) return JUDGE_CLI_DEFAULT_BUDGET_USD
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
  // budget must survive the trip to a double.
  return units <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(units) : undefined
}

function invalid() {
  return {
    command: 'invalid' as const,
    reason: fill(UI_TEXT.acpUnknownArgument, { argument: 'judge' }),
    exitCode: EXEC_EXIT.usage,
  }
}

/** Reserved before ACP/prompt parsing, including malformed and future judge commands. */
export function parseJudgeArgs(argv: readonly string[]):
  | JudgeCliCommand
  | {
      readonly command: 'invalid'
      readonly reason: string
      readonly exitCode: number
    } {
  const action = argv[1]
  if (action === 'serve' || action === 'lint') {
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
    const budgetNanoUsd = budget(values['budget-usd'])
    const timeout = values['timeout-ms']
    const timeoutMs = timeout === undefined ? JUDGE_REQUEST_TIMEOUT_MS : Number(timeout)
    if (
      engine === undefined ||
      engine === 'off' ||
      budgetNanoUsd === undefined ||
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
        budgetUsd: budgetNanoUsd / Number(NANO_USD_PER_USD),
        budgetNanoUsd,
        timeoutMs,
      },
    }
  } catch (error: unknown) {
    // Never echo parseArgs' raw argv: it can contain pasted credentials.
    if (!isParseArgsError(error)) throw error
    return invalid()
  }
}
