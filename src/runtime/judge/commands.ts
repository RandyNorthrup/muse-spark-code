import type { Readable } from 'node:stream'
import type { JudgeRuntime } from '../../core/judge/engine'
import {
  judgeOutcomeSchema,
  judgeRequestSchema,
  type JudgeOutcome,
  type JudgeRequest,
  type JudgeSource,
} from '../../core/judge/schema'
import {
  EXEC_EXIT,
  EXEC_FORCE_WRITE_MS,
  JUDGE_MAX_BODY_BYTES,
  UI_TEXT,
} from '../../shared/constants'
import { Usd } from '../../shared/usd'
import { USD_DECIMAL_RADIX, USD_LIABILITY_DECIMALS } from '../../shared/usdConstants'
import type { FdWriter } from '../exec/fdWriter'
import { readPromptStdin } from '../exec/keyInput'
import { JudgeCliInputError, type JudgeCliCommand, type JudgeCliOptions } from './args'
import { runJudgeMcp } from './mcp'
import { isServedJudgeModel } from '../../core/judge/served'

/** Nano-USD in one USD: the run cap's liability precision. */
const NANO_USD_PER_USD = USD_DECIMAL_RADIX ** USD_LIABILITY_DECIMALS

/** Z supplies current context; resolution must not start a chat backend/session. */
export interface JudgeCliSource {
  readonly source: JudgeSource
  readonly model: string
  readonly runtime: JudgeRuntime
  readonly billing: 'free' | 'paid'
  readonly worstCaseUsd: (request: JudgeRequest) => number | undefined
  /**
  The binding's declared embedding model, when an embedding transport is
  configured. An embedding answer honestly names that model instead of
  the conversation model; anything else stays a foreign-model refusal.
  */
  readonly embeddingModel?: string | undefined
  /**
  The model ids a separate source may report for `model` (a SystemOne
  alias resolves to a dated model). Absent means exactly `model`.
  */
  readonly servedModels?: readonly string[] | undefined
}

export interface JudgeCliIo {
  readonly stdin: Readable
  readonly stdout: FdWriter
  readonly stderr: FdWriter
}

/** B supplies its actual schemas and offline implementation, with no inference. */
interface OfflineCommand {
  readonly inputSchema: { parse(value: unknown): unknown }
  readonly outputSchema: { parse(value: unknown): unknown }
  run(input: unknown, signal: AbortSignal): Promise<unknown>
}

export interface JudgeCliDeps {
  initialize?(signal: AbortSignal): Promise<void>
  /**
  Resolve once per request: the returned source carries that request's
  one plan, so its price, admission and dispatch cannot drift apart.
  */
  resolveSource?(
    options: JudgeCliOptions,
    signal: AbortSignal,
    request: JudgeRequest,
  ): Promise<JudgeCliSource | Extract<JudgeOutcome, { outcome: 'no-answer' }> | undefined>
  /**
  Z's adapter must obtain current consent and D78's durable reservation for
  EVERY attempt before dispatch. reservedUsd is a hard uncached run cap for
  the complete batch, including any retry/fan-out; never permission itself.
  Timeout retains liability. This lane creates no ledger or credential store.
  */
  admitPaid?(
    source: JudgeCliSource,
    request: JudgeRequest,
    reservedUsd: number,
    signal: AbortSignal,
  ): Promise<JudgeOutcome>
  readonly calibrate?: OfflineCommand
  readonly report?: OfflineCommand
  readonly serve?: (
    command: JudgeCliCommand,
    io: JudgeCliIo,
    signal: AbortSignal,
  ) => Promise<number>
  readonly lint?: (command: JudgeCliCommand, io: JudgeCliIo, signal: AbortSignal) => Promise<number>
}

function noAnswer(reason: Extract<JudgeOutcome, { outcome: 'no-answer' }>['reason']): JudgeOutcome {
  return { outcome: 'no-answer', reason }
}

function isAligned(request: JudgeRequest, outcome: JudgeOutcome): boolean {
  if (outcome.outcome === 'no-answer') return true
  const ids = Object.keys(request.questions)
  const answers = outcome.result.answers
  return (
    Object.keys(answers).length === ids.length &&
    ids.every((id) => {
      const question = request.questions[id]
      const answer = answers[id]
      const meta = outcome.result.muse[id]
      if (question === undefined || meta === undefined || answer?.type !== question.type)
        return false
      const probabilities = answer.probabilities
      const keys = Object.keys(probabilities)
      // Accumulated IEEE-754 rounding only, never a model confidence threshold.
      const rounding = Number.EPSILON * 100
      const total = Object.values(probabilities).reduce((sum, probability) => sum + probability, 0)
      if (Math.abs(total - 1) > rounding) return false
      if (answer.type === 'noul') {
        return Math.abs(answer.noul - answer.probabilities.true) <= rounding
      }
      if (answer.type === 'choice' && question.type === 'choice') {
        const selected = answer.probabilities[answer.choice]
        return (
          selected !== undefined &&
          Object.hasOwn(question.criteria, answer.choice) &&
          keys.every((option) => Object.hasOwn(question.criteria, option)) &&
          (keys.length === Object.keys(question.criteria).length || meta.partial) &&
          Object.values(probabilities).every((probability) => probability <= selected)
        )
      }
      if (answer.type === 'score' && question.type === 'score') {
        const levels = question.criteria.map((_description, index) => String(index))
        const expected = keys.reduce(
          (sum, level) => sum + Number(level) * (answer.probabilities[level] ?? 0),
          0,
        )
        return (
          keys.every((level) => levels.includes(level)) &&
          (keys.length === levels.length || meta.partial) &&
          Object.keys(answer.legend).length === levels.length &&
          levels.every((level, index) => answer.legend[level] === question.criteria[index]) &&
          answer.score >= 0 &&
          answer.score <= question.criteria.length - 1 &&
          Math.abs(answer.score - expected) <= rounding
        )
      }
      return false
    })
  )
}

/** Per-process cap is conservatively retained, including failed/uncertain calls. */
function judgeCaller(options: JudgeCliOptions, deps: JudgeCliDeps) {
  // Exact nano-USD (RVM98P2R2 8): the run cap and every reservation are integers.
  let remainingUnits = options.budgetNanoUsd
  return async (raw: unknown, signal: AbortSignal): Promise<JudgeOutcome> => {
    signal.throwIfAborted()
    const request = judgeRequestSchema.parse(raw)
    if (
      options.model !== undefined &&
      request.model !== undefined &&
      options.model !== request.model
    ) {
      throw new JudgeCliInputError()
    }
    const model = options.model ?? request.model
    if (model === undefined && options.engine !== 'separate') return noAnswer('source-unavailable')
    const source = await untilAborted(
      Promise.resolve(deps.resolveSource?.({ ...options, model }, signal, request)),
      signal,
    )
    signal.throwIfAborted()
    if (source === undefined) return noAnswer('source-unavailable')
    // A precise refusal at resolution (a named source gap) is the answer.
    if ('outcome' in source) return source
    if (
      (source.source !== options.engine && options.engine !== 'auto') ||
      (source.model !== model && source.source !== 'separate')
    )
      return noAnswer('source-unavailable')
    let rawOutcome: unknown
    if (source.billing === 'paid') {
      if (remainingUnits <= 0) return noAnswer('over-budget')
      const cost = source.worstCaseUsd(request)
      if (cost === undefined || !Number.isFinite(cost) || cost <= 0) return noAnswer('unpriced')
      // The plan's number enters once, as its shortest decimal text, and a
      // liability rounds up to the nano-USD: never `cost * units` in floats.
      const reservedUnits = Number(
        Usd.from(cost).ceiling(USD_LIABILITY_DECIMALS).units(USD_LIABILITY_DECIMALS),
      )
      if (reservedUnits > remainingUnits) return noAnswer('over-budget')
      if (deps.admitPaid === undefined) return noAnswer('consent-needed')
      remainingUnits -= reservedUnits
      rawOutcome = await untilAborted(
        deps.admitPaid(source, request, reservedUnits / NANO_USD_PER_USD, signal),
        signal,
      )
    } else {
      rawOutcome = await untilAborted(source.runtime.judge(request, signal), signal)
    }
    signal.throwIfAborted()
    const parsed = judgeOutcomeSchema.safeParse(rawOutcome)
    if (!parsed.success) return noAnswer('engine-failure')
    // An embedding answer names the source's declared embedding model on
    // the envelope and on every verdict, never the conversation model. A
    // genuinely foreign model matches neither identity and stays refused.
    const isServed = (model: string) => isServedJudgeModel(model, source.model, source.servedModels)
    const isValid =
      isAligned(request, parsed.data) &&
      Buffer.byteLength(JSON.stringify(parsed.data)) <= JUDGE_MAX_BODY_BYTES &&
      (parsed.data.outcome === 'no-answer' ||
        source.source === 'both' ||
        (isServed(parsed.data.result.model) &&
          Object.values(parsed.data.result.muse).every(
            (meta) => meta.source === source.source && isServed(meta.model),
          )) ||
        (parsed.data.result.model === source.embeddingModel &&
          Object.values(parsed.data.result.muse).every(
            (meta) => meta.technique === 'embedding' && meta.model === source.embeddingModel,
          )))
    return isValid ? parsed.data : noAnswer('engine-failure')
  }
}

/** Race also bounds injected implementations that ignore cancellation. */
async function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let stop: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    stop = () => {
      reject(new Error(UI_TEXT.execInterrupted))
    }
    signal.addEventListener('abort', stop, { once: true })
  })
  try {
    return await Promise.race([work, aborted])
  } finally {
    if (stop !== undefined) signal.removeEventListener('abort', stop)
  }
}

export async function runJudgeCommand(
  command: JudgeCliCommand,
  io: JudgeCliIo,
  deps: JudgeCliDeps,
  parentSignal?: AbortSignal,
): Promise<number> {
  const deadline = AbortSignal.timeout(command.options.timeoutMs)
  const signal = parentSignal === undefined ? deadline : AbortSignal.any([parentSignal, deadline])
  const judge = judgeCaller(command.options, deps)
  let code: number
  try {
    if (io.stdout.isClosed || io.stderr.isClosed) return EXEC_EXIT.failed
    signal.throwIfAborted()
    if (deps.initialize !== undefined) await untilAborted(deps.initialize(signal), signal)
    if (command.action === 'mcp') {
      code = await untilAborted(runJudgeMcp(io, judge, signal), signal)
    } else if (command.action === 'serve' || command.action === 'lint') {
      const surface = deps[command.action]
      if (surface === undefined) throw new Error(UI_TEXT.execUnknownModel)
      code = await untilAborted(surface(command, io, signal), signal)
    } else {
      const raw: unknown = JSON.parse(await readPromptStdin(io.stdin, JUDGE_MAX_BODY_BYTES, signal))
      if (command.action === 'ask') {
        const request = judgeRequestSchema.parse(raw)
        if (
          command.options.model !== undefined &&
          request.model !== undefined &&
          command.options.model !== request.model
        ) {
          throw new Error(UI_TEXT.execRequestShape)
        }
        let outcome: JudgeOutcome
        try {
          outcome = await untilAborted(judge(request, signal), signal)
        } catch (error: unknown) {
          if (error instanceof JudgeCliInputError) throw error
          outcome = noAnswer(signal.aborted ? 'timeout' : 'engine-failure')
        }
        io.stdout.write(`${JSON.stringify(outcome)}\n`)
        code = outcome.outcome === 'answered' ? EXEC_EXIT.ok : EXEC_EXIT.failed
      } else {
        const offline = deps[command.action]
        if (offline === undefined) throw new Error(UI_TEXT.execUnknownModel)
        const input = offline.inputSchema.parse(raw)
        const result = offline.outputSchema.parse(
          await untilAborted(offline.run(input, signal), signal),
        )
        const text: unknown = JSON.stringify(result)
        if (typeof text !== 'string' || Buffer.byteLength(text) > JUDGE_MAX_BODY_BYTES) {
          throw new Error(UI_TEXT.execRequestShape)
        }
        io.stdout.write(`${text}\n`)
        code = EXEC_EXIT.ok
      }
    }
  } catch {
    // Fixed localized words only: no private stdin, model error or argv echo.
    io.stderr.write(`${signal.aborted ? UI_TEXT.execTimedOut : UI_TEXT.execRequestShape}\n`)
    code = signal.aborted ? EXEC_EXIT.failed : EXEC_EXIT.usage
  } finally {
    io.stdin.destroy()
  }
  const flushed = await Promise.all([
    io.stdout.flush(EXEC_FORCE_WRITE_MS),
    io.stderr.flush(EXEC_FORCE_WRITE_MS),
  ])
  return flushed.every(Boolean) && !io.stdout.isClosed && !io.stderr.isClosed
    ? code
    : EXEC_EXIT.failed
}
