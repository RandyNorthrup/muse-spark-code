import { redactSecrets } from '../../core/redact'
import type { Logger } from '../../host/logger'
import {
  EXEC_PROTOCOL_VERSION,
  EXEC_SINK_HIGH_WATER_BYTES,
  EXEC_STOP_GRACE_MS,
  EXEC_USD_DECIMALS,
  REDACTED_MARK,
  UI_TEXT,
} from '../../shared/constants'
import { fill, formatNumber, formatUsd } from '../../shared/l10n/text'
import { stderrLogger } from '../stderrLog'
import type { ExecOutput } from './execArgs'
import {
  execEventSchema,
  type ExecEventBody,
  type ExecResult,
  validateResult,
} from './execProtocol'
import type { FdWriter } from './fdWriter'

export interface ExecSink {
  emit(event: ExecEventBody): void
  message(item: {
    itemId: string
    kind: 'agentMessage' | 'reasoning'
    text: string
    complete: boolean
  }): void
  finish(result: ExecResult): Promise<void>
  forceFinish(result: ExecResult): void
  readonly isStalled: boolean
}

export function redactWhole(text: string, literals: readonly string[]): string {
  return redactSecrets(text, literals)
}

/** Preserve structure/unknown ACP fields; redact every string leaf before serialization. */
function redactValue(value: unknown, literals: readonly string[]): unknown {
  if (typeof value === 'string') return redactWhole(value, literals)
  if (Array.isArray(value)) return value.map((item: unknown) => redactValue(item, literals))
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const label = redactWhole(key, literals)
      // Reuse the core field patterns on a harmless scalar. Never redact
      // serialized user values: escaped quotes must keep their JSON structure.
      const field = JSON.stringify({ [label]: 'x' })
      return [label, redactWhole(field, []) === field ? redactValue(item, literals) : REDACTED_MARK]
    }),
  )
}

export function createExecSink(input: {
  format: ExecOutput
  out: FdWriter
  now: () => number
  literals: () => readonly string[]
  summary: (line: string) => void
  onStalled: () => void
}): ExecSink {
  let seq = 0
  let isFinished = false
  let isStalled = false
  let lastMessage: string | undefined
  const emittedItems = new Set<string>()
  const checkStall = () => {
    if (!isStalled && (input.out.isClosed || input.out.queuedBytes > EXEC_SINK_HIGH_WATER_BYTES)) {
      isStalled = true
      input.onStalled()
    }
    return isStalled
  }
  const write = (text: string) => {
    if (checkStall()) return
    // String leaves are redacted before serialization; never rewrite JSON bytes.
    input.out.write(text)
    checkStall()
  }
  const emit = (event: ExecEventBody) => {
    if (isFinished) throw new Error(UI_TEXT.execOutputStalled)
    if (event.type === 'result') throw new Error(UI_TEXT.execRequestShape)
    const normalized =
      event.type === 'message' && !event.complete
        ? { ...event, text: UI_TEXT.execMessageWithheld }
        : event
    const raw = {
      ...normalized,
      v: EXEC_PROTOCOL_VERSION,
      seq: seq + 1,
      time: new Date(input.now()).toISOString(),
    }
    execEventSchema.parse(raw)
    const redacted = execEventSchema.parse(redactValue(raw, input.literals()))
    seq += 1
    if (input.format === 'jsonl') write(`${JSON.stringify(redacted)}\n`)
  }
  const finishOnce = (result: ExecResult) => {
    const raw = validateResult(
      lastMessage === undefined ? result : { ...result, finalMessage: lastMessage },
    )
    const redacted = validateResult(redactValue(raw, input.literals()))
    const envelope = execEventSchema.parse({
      type: 'result',
      result: redacted,
      v: EXEC_PROTOCOL_VERSION,
      seq: seq + 1,
      time: new Date(input.now()).toISOString(),
    })
    isFinished = true
    seq += 1
    if (input.format === 'jsonl') write(`${JSON.stringify(envelope)}\n`)
    else if (input.format === 'json') write(`${JSON.stringify(redacted)}\n`)
    else write(`${redacted.finalMessage}\n`)
    const paid = redacted.usage.paid
    const cost = redacted.usage.costUsd
    const summary = fill(
      cost?.isUpperBound === true ? UI_TEXT.execSummaryUpperBound : UI_TEXT.execSummary,
      {
        status: UI_TEXT.execStatus[redacted.status],
        requests: formatNumber(redacted.usage.requests ?? 0),
        settled: formatUsd(cost?.settled ?? 0, EXEC_USD_DECIMALS),
        uncertain: formatUsd(cost?.uncertain ?? 0, EXEC_USD_DECIMALS),
        imageAttempts: formatNumber(paid.imageAttempts),
        imagesReturned: formatNumber(paid.imagesReturned),
        imagesUncertain: formatNumber(paid.imagesUncertain),
      },
    )
    input.summary(redactWhole(summary, input.literals()))
  }
  return {
    emit,
    message(item) {
      if (emittedItems.has(item.itemId)) throw new Error(UI_TEXT.execRequestShape)
      emit({ ...item, type: 'message' })
      emittedItems.add(item.itemId)
      if (item.kind === 'agentMessage')
        lastMessage = item.complete ? item.text : UI_TEXT.execMessageWithheld
    },
    async finish(result) {
      if (isFinished) throw new Error(UI_TEXT.execRequestShape)
      finishOnce(result)
      const isFlushed = await input.out.flush(EXEC_STOP_GRACE_MS)
      if (isStalled || isFlushed) {
        return
      }

      isStalled = true
      input.onStalled()
    },
    forceFinish(result) {
      if (!isFinished) finishOnce(result)
    },
    get isStalled() {
      return checkStall()
    },
  }
}

export function createExecLogger(input: {
  stderr: FdWriter
  literals: () => readonly string[]
  verbose: boolean
}): Logger {
  const log = stderrLogger(
    (line) => {
      input.stderr.write(`${line}\n`)
    },
    input.verbose ? 'trace' : 'info',
  )
  const raw = (message: string) => redactWhole(message, input.literals())
  return {
    trace(message) {
      log.trace(raw(message))
    },
    info(message) {
      log.info(raw(message))
    },
    warn(message) {
      log.warn(raw(message))
    },
    error(message) {
      log.error(raw(message))
    },
  }
}
