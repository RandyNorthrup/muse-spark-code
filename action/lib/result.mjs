// Result extraction (M80, SPEC §6.5): after the exec child closes, and before
// any patch is considered, its JSONL is checked whole: every line a valid
// v1 envelope with consecutive sequence numbers, exactly one result and that
// result last, the result valid against a structural mirror of the
// execResultSchema invariants (parity-tested against lane A's zod schema),
// and its exit code equal to the child's. Only then is it staged and
// renamed into out/ while the owner still allows publication.

import { Buffer } from 'node:buffer'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { TextDecoder } from 'node:util'
import {
  ACTION_EVENTS_MAX_BYTES,
  ACTION_EXTRACT_MS,
  ACTION_RESULT_MAX_BYTES,
} from './lifecycle.mjs'

const STATUSES = new Set([
  'completed',
  'incomplete',
  'failed',
  'cancelled',
  'timeout',
  'budget_exceeded',
  'request_cap',
  'denied',
  'auth_required',
  'backend_unavailable',
  'internal',
  'accounting_unverified',
])
const EXIT_CODES = Object.freeze({
  completed: 0,
  internal: 1,
  auth_required: 3,
  backend_unavailable: 3,
  failed: 4,
  budget_exceeded: 5,
  request_cap: 5,
  timeout: 6,
  denied: 7,
  incomplete: 8,
  accounting_unverified: 9,
})
const SIGNAL_CODES = Object.freeze({ SIGINT: 130, SIGTERM: 143 })
const EVENT_TYPES = new Set([
  'start',
  'update',
  'tool',
  'message',
  'permission_denied',
  'question_declined',
  'attempt',
  'paid_use',
  'limit',
  'signal',
  'result',
])
const REFUSALS = new Set(['budget', 'requests', 'closed', 'unpriced', 'request_shape'])
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
const USD_DECIMALS = 6
const MAX_BUDGET_USD = 20
const MAX_REQUESTS = 500
const MIN_TIMEOUT_SECONDS = 10
const MAX_TIMEOUT_SECONDS = 21_600
const HTTP_MIN = 100
const HTTP_MAX = 599
const PRIVATE_FILE = 0o600

/** exitCodeFor from the exec protocol: the status's code; cancelled by its signal. */
export function exitCodeFor(status, signal) {
  if (status === 'cancelled')
    return signal === 'SIGINT' ? SIGNAL_CODES.SIGINT : SIGNAL_CODES.SIGTERM
  return EXIT_CODES[status]
}

function isObject(value, keys) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const own = Object.keys(value)
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

const isCounter = (value) => Number.isSafeInteger(value) && value >= 0
const isNullableCounter = (value) => value === null || isCounter(value)
const isNullableText = (value) => value === null || typeof value === 'string'

/** USD is a serialization only: its canonical micro-USD integer, or undefined. */
export function microUsd(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return
  const raw = value.toFixed(USD_DECIMALS)
  if (Number(raw) !== value) return
  const units = Number(raw.replace('.', ''))
  return Number.isSafeInteger(units) ? units : undefined
}

const isAmount = (value) => microUsd(value) !== undefined

function isSumEqual(total, values) {
  const expected = microUsd(total)
  const units = values.map((value) => microUsd(value))
  if (expected === undefined || units.includes(undefined)) return false
  let sum = 0
  for (const unit of units) sum += unit
  return Number.isSafeInteger(sum) && sum === expected
}

function isRelativePath(value) {
  return (
    typeof value === 'string' &&
    value !== '' &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.includes(':') &&
    value.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  )
}

function isPathList(value) {
  return (
    Array.isArray(value) &&
    value.every((item) => isRelativePath(item)) &&
    new Set(value).size === value.length
  )
}

function isPaid(value) {
  return (
    isObject(value, [
      'imageAttempts',
      'imagesReturned',
      'imagesRefunded',
      'imagesUncertain',
      'settledUsd',
      'uncertainUsd',
    ]) &&
    [value.imageAttempts, value.imagesReturned, value.imagesRefunded, value.imagesUncertain].every(
      (count) => isCounter(count),
    ) &&
    isAmount(value.settledUsd) &&
    isAmount(value.uncertainUsd) &&
    value.imagesReturned + value.imagesRefunded + value.imagesUncertain <= value.imageAttempts
  )
}

function isCost(value) {
  return (
    isObject(value, ['settled', 'uncertain', 'reserved', 'total', 'isUpperBound']) &&
    typeof value.isUpperBound === 'boolean' &&
    isSumEqual(value.total, [value.settled, value.uncertain, value.reserved]) &&
    (!(value.uncertain > 0 || value.reserved > 0) || value.isUpperBound)
  )
}

function isLastResponse(value) {
  if (
    !isObject(value, [
      'n',
      'terminal',
      'incompleteReason',
      'endedWithoutTerminal',
      'httpStatus',
      'transportError',
      'usage',
      'settlement',
    ])
  ) {
    return false
  }
  const isPriced = value.settlement === 'priced'
  return (
    isCounter(value.n) &&
    value.n >= 1 &&
    isNullableText(value.terminal) &&
    isNullableText(value.incompleteReason) &&
    typeof value.endedWithoutTerminal === 'boolean' &&
    (value.httpStatus === null ||
      (isCounter(value.httpStatus) &&
        value.httpStatus >= HTTP_MIN &&
        value.httpStatus <= HTTP_MAX)) &&
    isNullableText(value.transportError) &&
    ['valid', 'missing', 'invalid'].includes(value.usage) &&
    (isPriced || value.settlement === 'full-reservation') &&
    (!isPriced ||
      (value.terminal === 'completed' &&
        value.usage === 'valid' &&
        !value.endedWithoutTerminal &&
        value.transportError === null))
  )
}

const isCap = (value) => isAmount(value) && value > 0 && value <= MAX_BUDGET_USD

function isLedger(value) {
  return (
    value === null ||
    (isObject(value, ['capUsd', 'breach', 'refusal', 'lastResponse']) &&
      isCap(value.capUsd) &&
      typeof value.breach === 'boolean' &&
      (value.refusal === null || REFUSALS.has(value.refusal)) &&
      (value.lastResponse === null || isLastResponse(value.lastResponse)))
  )
}

function isLimits(value) {
  return (
    isObject(value, ['budgetUsd', 'maxRequests', 'timeoutSeconds']) &&
    (value.budgetUsd === null || isCap(value.budgetUsd)) &&
    (value.maxRequests === null ||
      (isCounter(value.maxRequests) &&
        value.maxRequests >= 1 &&
        value.maxRequests <= MAX_REQUESTS)) &&
    isCounter(value.timeoutSeconds) &&
    value.timeoutSeconds >= MIN_TIMEOUT_SECONDS &&
    value.timeoutSeconds <= MAX_TIMEOUT_SECONDS
  )
}

function isUsage(value) {
  return (
    isObject(value, [
      'requests',
      'inputTokens',
      'outputTokens',
      'cachedTokens',
      'reasoningTokens',
      'costUsd',
      'paid',
    ]) &&
    [
      value.requests,
      value.inputTokens,
      value.outputTokens,
      value.cachedTokens,
      value.reasoningTokens,
    ].every((item) => isNullableCounter(item)) &&
    (value.costUsd === null || isCost(value.costUsd)) &&
    isPaid(value.paid) &&
    (value.cachedTokens === null ||
      value.inputTokens === null ||
      value.cachedTokens <= value.inputTokens) &&
    (value.reasoningTokens === null ||
      value.outputTokens === null ||
      value.reasoningTokens <= value.outputTokens)
  )
}

function isDenial(value) {
  return (
    isObject(value, ['toolCallId', 'title', 'kind', 'paths']) &&
    typeof value.toolCallId === 'string' &&
    typeof value.title === 'string' &&
    typeof value.kind === 'string' &&
    isPathList(value.paths)
  )
}

function isInput(value) {
  return (
    isObject(value, ['name', 'bytes', 'chunks', 'complete']) &&
    typeof value.name === 'string' &&
    value.name !== '' &&
    !/[\\/:]/.test(value.name) &&
    isCounter(value.bytes) &&
    isCounter(value.chunks) &&
    typeof value.complete === 'boolean'
  )
}

/** A completed result carries end_turn and, on the Model API, the latest response's priced evidence. */
function hasCompletionEvidence(value) {
  if (value.status !== 'completed') return true
  if (value.stopReason !== 'end_turn' || value.terminal !== 'completed') return false
  if (value.backend === 'museCode') return true
  const last = value.ledger?.lastResponse
  return (
    last?.terminal === 'completed' &&
    last.usage === 'valid' &&
    last.settlement === 'priced' &&
    last.transportError === null &&
    !last.endedWithoutTerminal
  )
}

function isBackendAccountingValid(value) {
  const { usage, ledger, limits } = value
  if (value.backend === 'museCode') {
    return (
      ledger === null &&
      usage.costUsd === null &&
      usage.requests === null &&
      limits.budgetUsd === null &&
      limits.maxRequests === null &&
      Object.values(usage.paid).every((total) => total === 0)
    )
  }
  if (
    ledger === null ||
    usage.costUsd === null ||
    usage.requests === null ||
    limits.budgetUsd === null ||
    limits.maxRequests === null
  ) {
    return value.status !== 'completed'
  }
  const cap = microUsd(ledger.capUsd)
  const total = microUsd(usage.costUsd.total)
  return (
    cap !== undefined && total !== undefined && cap === microUsd(limits.budgetUsd) && total <= cap
  )
}

const RESULT_KEYS = [
  'v',
  'status',
  'exitCode',
  'signal',
  'stopReason',
  'terminal',
  'incompleteReason',
  'backend',
  'mode',
  'model',
  'sessionId',
  'ephemeral',
  'finalMessage',
  'filesChanged',
  'denials',
  'questionsDeclined',
  'inputs',
  'usage',
  'ledger',
  'limits',
  'durationMs',
  'error',
]

/** The ExecResult v1 invariants, field for field (SPEC §2.1, §2.3). */
export function isExecResult(value) {
  return (
    isObject(value, RESULT_KEYS) &&
    value.v === 1 &&
    STATUSES.has(value.status) &&
    isCounter(value.exitCode) &&
    [null, 'SIGINT', 'SIGTERM'].includes(value.signal) &&
    isNullableText(value.stopReason) &&
    isNullableText(value.terminal) &&
    isNullableText(value.incompleteReason) &&
    (value.backend === 'museCode' || value.backend === 'modelApi') &&
    (value.mode === 'plan' || value.mode === 'acceptEdits') &&
    isNullableText(value.model) &&
    isNullableText(value.sessionId) &&
    typeof value.ephemeral === 'boolean' &&
    typeof value.finalMessage === 'string' &&
    isPathList(value.filesChanged) &&
    Array.isArray(value.denials) &&
    value.denials.every((denial) => isDenial(denial)) &&
    isCounter(value.questionsDeclined) &&
    Array.isArray(value.inputs) &&
    value.inputs.every((record) => isInput(record)) &&
    isUsage(value.usage) &&
    isLedger(value.ledger) &&
    isLimits(value.limits) &&
    typeof value.durationMs === 'number' &&
    Number.isFinite(value.durationMs) &&
    value.durationMs >= 0 &&
    (value.error === null ||
      (isObject(value.error, ['kind', 'message']) &&
        typeof value.error.kind === 'string' &&
        typeof value.error.message === 'string')) &&
    hasCompletionEvidence(value) &&
    isBackendAccountingValid(value) &&
    value.exitCode === exitCodeFor(value.status, value.signal) &&
    (value.status === 'cancelled') === (value.signal !== null) &&
    (value.status === 'completed') === (value.error === null)
  )
}

/**
 * The single result in exec's JSONL text, or undefined when any line is not a
 * consecutive v1 envelope, the text is cut mid-line, there is no result,
 * more than one, a line after it, or the result is invalid.
 */
export function parseEventsText(text) {
  if (text === '' || !text.endsWith('\n')) return
  const lines = text.slice(0, -1).split('\n')
  let result
  for (const [index, line] of lines.entries()) {
    if (result !== undefined) return
    let event
    try {
      event = JSON.parse(line)
    } catch {
      return
    }
    if (
      typeof event !== 'object' ||
      event === null ||
      event.v !== 1 ||
      event.seq !== index + 1 ||
      typeof event.time !== 'string' ||
      !ISO_TIME.test(event.time) ||
      !Number.isFinite(Date.parse(event.time)) ||
      !EVENT_TYPES.has(event.type)
    ) {
      return
    }
    if (event.type !== 'result') continue
    if (
      Buffer.byteLength(line) > ACTION_RESULT_MAX_BYTES ||
      !isObject(event, ['v', 'seq', 'time', 'type', 'result'])
    ) {
      return
    }
    result = event.result
  }
  return result !== undefined && isExecResult(result) ? result : undefined
}

/**
 * Extracts and publishes the result under the owner (SPEC §6.5, G21): the
 * valid result whose exit code equals `execCode`, staged privately and
 * renamed into out/result.json with the events beside it. Anything else is
 * null: no result path, and the patch is withheld as no_result.
 */
export async function extractResult({ owner, paths, execCode }) {
  return await owner.phase('extract', ACTION_EXTRACT_MS, async (signal) => {
    let bytes
    try {
      bytes = await readFile(paths.eventsTmp, { signal })
    } catch {
      return null
    }
    if (bytes.length > ACTION_EVENTS_MAX_BYTES) return null
    let text
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      return null
    }
    const result = parseEventsText(text)
    if (result === undefined || result.exitCode !== execCode) return null
    await writeFile(paths.resultTmp, `${JSON.stringify(result)}\n`, {
      flag: 'wx',
      mode: PRIVATE_FILE,
      signal,
    })
    if (!owner.publicationAllowed) return null
    await rename(paths.resultTmp, paths.result)
    await rename(paths.eventsTmp, paths.events)
    return result
  })
}
