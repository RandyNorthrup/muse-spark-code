import { redactSecrets } from '../../core/redact'
import type { Logger } from '../../host/logger'
import {
  EXEC_PROTOCOL_VERSION,
  EXEC_EXIT,
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
  type ExecEvent,
  type ExecEventBody,
  type ExecResult,
  validateResult,
} from './execProtocol'
import type { FdWriter } from './fdWriter'
import { parseExecRecord, type OutputSchema } from './outputSchema'

/** Optional M106 fields; callers without a schema retain M80's exact result. */
export type SchemaExecResult = ExecResult

/** The canonical protocol owns additive fields and accounting at every egress. */
export function validateSchemaResult(value: unknown): SchemaExecResult {
  return validateResult(value)
}

export type SchemaExecEvent =
  | Exclude<ExecEvent, { type: 'result' }>
  | (Extract<ExecEvent, { type: 'result' }> & { result: SchemaExecResult })

export function validateSchemaEvent(value: unknown, schema?: OutputSchema): SchemaExecEvent {
  const record = parseExecRecord(value)
  if (record['type'] !== 'result') {
    const event = execEventSchema.parse(record)
    if (
      schema !== undefined &&
      event.type === 'message' &&
      event.kind === 'agentMessage' &&
      event.complete &&
      event.text !== UI_TEXT.execMessageWithheld &&
      !schema.parseAnswer(event.text).ok
    )
      throw new Error(UI_TEXT.execRequestShape)
    return event
  }
  const result = validateSchemaResult(record['result'])
  const { output: _output, ledger, ...base } = result
  const { outputSchemaSha256: _digest, ...baseLedger } = ledger ?? {}
  const envelope = execEventSchema.parse({
    ...record,
    result: { ...base, ledger: ledger === null ? null : baseLedger },
  })
  if (envelope.type !== 'result') throw new Error(UI_TEXT.execRequestShape)
  return { ...envelope, result }
}

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
  readonly resultExitCode: number | undefined
}

export function redactWhole(text: string, literals: readonly string[]): string {
  return redactSecrets(text, literals)
}

/** Preserve structure/unknown ACP fields; redact every string leaf before serialization. */
function redactValue(value: unknown, literals: readonly string[]): unknown {
  if (typeof value === 'string') return redactWhole(value, literals)
  // JSON has no BigInt: a loose ACP field holding one becomes its decimal
  // string, so serialization cannot throw after validation (RVM80A P3-4).
  if (typeof value === 'bigint') return redactWhole(value.toString(), literals)
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
  outputSchema?: () => OutputSchema | undefined
  outputValidation?: () => 'provider' | 'local'
}): ExecSink {
  let seq = 0
  let isFinished = false
  let isStalled = false
  let lastMessage: string | undefined
  let resultExitCode: number | undefined
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
  const answerForEgress = (text: string, schema: OutputSchema) => {
    const original = schema.parseAnswer(text)
    return original.ok
      ? schema.parseAnswer(JSON.stringify(redactValue(original.value, input.literals())))
      : original
  }
  const emit = (event: ExecEventBody) => {
    if (isFinished) throw new Error(UI_TEXT.execOutputStalled)
    if (event.type === 'result') throw new Error(UI_TEXT.execRequestShape)
    const normalized =
      event.type === 'message' && !event.complete
        ? { ...event, text: UI_TEXT.execMessageWithheld }
        : event
    const schema = input.outputSchema?.()
    const isSchemaMessage =
      schema !== undefined && normalized.type === 'message' && normalized.kind === 'agentMessage'
    const answer =
      isSchemaMessage && normalized.complete ? answerForEgress(normalized.text, schema) : undefined
    const raw = {
      ...normalized,
      // Scrub metadata with a harmless placeholder. A serialised JSON answer
      // must never pass through the text redactor again.
      ...(isSchemaMessage && { text: UI_TEXT.execMessageWithheld }),
      v: EXEC_PROTOCOL_VERSION,
      seq: seq + 1,
      time: new Date(input.now()).toISOString(),
    }
    execEventSchema.parse(raw)
    const metadata = execEventSchema.parse(redactValue(raw, input.literals()))
    const redacted = validateSchemaEvent(
      {
        ...metadata,
        ...(answer?.ok === true && { text: JSON.stringify(answer.value) }),
      },
      schema,
    )
    seq += 1
    if (input.format === 'jsonl') write(`${JSON.stringify(redacted)}\n`)
  }
  const finishOnce = (result: ExecResult) => {
    const raw = validateResult(
      lastMessage === undefined || result.finalMessage === UI_TEXT.execMessageWithheld
        ? result
        : { ...result, finalMessage: lastMessage },
    )
    const schema = input.outputSchema?.()
    const redactedBase = validateResult(
      redactValue(
        schema === undefined ? raw : { ...raw, finalMessage: UI_TEXT.execMessageWithheld },
        input.literals(),
      ),
    )
    let schemaResult: SchemaExecResult = redactedBase
    if (schema !== undefined && redactedBase.ledger !== null) {
      // Validate the exact data that leaves egress. Redaction may invalidate an
      // enum or a required key; it must never turn a mismatch into success.
      const answer =
        redactedBase.status === 'completed' ? answerForEgress(raw.finalMessage, schema) : undefined
      schemaResult = {
        ...redactedBase,
        ledger: { ...redactedBase.ledger, outputSchemaSha256: schema.sha256 },
        ...(answer?.ok === true && {
          output: { value: answer.value, validation: input.outputValidation?.() ?? 'provider' },
          finalMessage: JSON.stringify(answer.value),
        }),
        ...(answer?.ok === false && {
          status: 'failed',
          exitCode: EXEC_EXIT.outputSchemaMismatch,
          finalMessage: UI_TEXT.execMessageWithheld,
          error: {
            kind: answer.kind ?? 'output_schema_mismatch',
            message: fill(UI_TEXT.outputSchemaMismatch, { detail: answer.detail }),
          },
        }),
      }
    }
    const redacted = validateSchemaResult(schemaResult)
    resultExitCode = redacted.exitCode
    const envelope = validateSchemaEvent({
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
    if (schema !== undefined && input.outputValidation?.() === 'local')
      input.summary(UI_TEXT.outputSchemaLocalValidation)
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
    get resultExitCode() {
      return resultExitCode
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
