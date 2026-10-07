import { parseArgs } from 'node:util'
import {
  EXEC_EXIT,
  EXEC_MAX_BUDGET_USD,
  EXEC_MAX_TIMEOUT_SECONDS,
  EXEC_USD_DECIMALS,
  EXEC_USD_UNITS,
  JUDGE_CLI_DEFAULT_BUDGET_USD,
  JUDGE_ENGINES,
  JUDGE_REQUEST_TIMEOUT_MS,
  MILLISECONDS_PER_SECOND,
  UI_TEXT,
  type JudgeEngine,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'

export interface JudgeCliOptions {
  readonly engine: Exclude<JudgeEngine, 'off'>
  readonly model: string | undefined
  readonly separate: string | undefined
  readonly budgetUsd: number
  readonly budgetMicroUsd: number
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
  budgetMicroUsd: JUDGE_CLI_DEFAULT_BUDGET_USD * EXEC_USD_UNITS,
  timeoutMs: JUDGE_REQUEST_TIMEOUT_MS,
}

function budget(value: string | undefined): number | undefined {
  if (value === undefined) return JUDGE_CLI_DEFAULT_BUDGET_USD
  const [whole, fraction = ''] = value.split('.', 2)
  if (
    whole === undefined ||
    !/^[0-9]+(?:\.[0-9]+)?$/.test(value) ||
    fraction.length > EXEC_USD_DECIMALS
  )
    return undefined
  const units =
    BigInt(whole) * BigInt(EXEC_USD_UNITS) + BigInt(fraction.padEnd(EXEC_USD_DECIMALS, '0'))
  return units <= BigInt(EXEC_MAX_BUDGET_USD * EXEC_USD_UNITS) ? Number(units) : undefined
}

function invalid(argument: string) {
  return {
    command: 'invalid' as const,
    reason: fill(UI_TEXT.acpUnknownArgument, { argument }),
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
    return invalid('judge')
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
    if (positionals.length > 0 || new Set(names).size !== names.length) return invalid('judge')
    const engine = JUDGE_ENGINES.find((candidate) => candidate === (values.engine ?? 'auto'))
    const budgetMicroUsd = budget(values['budget-usd'])
    const timeout = values['timeout-ms']
    const timeoutMs = timeout === undefined ? JUDGE_REQUEST_TIMEOUT_MS : Number(timeout)
    if (
      engine === undefined ||
      engine === 'off' ||
      budgetMicroUsd === undefined ||
      (timeout !== undefined && !/^[0-9]+$/.test(timeout)) ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= 0 ||
      timeoutMs > EXEC_MAX_TIMEOUT_SECONDS * MILLISECONDS_PER_SECOND ||
      values.model?.trim() === '' ||
      values.separate?.trim() === ''
    )
      return invalid('judge')
    return {
      command: 'judge',
      action,
      surfaceArgs: [],
      options: {
        engine,
        model: values.model,
        separate: values.separate,
        budgetUsd: budgetMicroUsd / EXEC_USD_UNITS,
        budgetMicroUsd,
        timeoutMs,
      },
    }
  } catch {
    // Never echo parseArgs' raw argv: it can contain pasted credentials.
    return invalid('judge')
  }
}
