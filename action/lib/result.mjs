// Result extraction (M80, SPEC §6.5): after the exec child closes, and before
// any patch is considered, its JSONL is checked whole: every line a valid
// v2 event (envelope and body, each variant against a structural mirror of
// execEventSchema, including the update egress rule; RVM80CD P2-3) with
// consecutive sequence numbers, exactly one result and that result last,
// the result valid against a mirror of the execResultSchema invariants (both
// parity-tested against lane A's zod schemas), and its exit code equal to
// the child's. Only then is it staged and renamed into out/ while the owner
// still allows publication.

import { Buffer } from 'node:buffer'
import { renameSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
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
const REFUSALS = new Set(['budget', 'requests', 'closed', 'unpriced', 'request_shape'])
const ENDPOINTS = new Set(['responses', 'images.generations', 'images.edits'])
const LIMIT_KINDS = new Set([
  'budget',
  'requests',
  'timeout',
  'breach',
  'request_shape',
  'unpriced',
  'accounting',
])
const PAID_PHASES = new Set(['admitted', 'returned', 'refunded', 'uncertain', 'refused'])
// Projections of src/shared/constants.ts EXEC_PROHIBITED_UPDATE_PATTERN and
// EXEC_RAW_TOOL_FIELDS (parity-tested).
export const PROHIBITED_UPDATE = /^(?:agent_(?:message|thought)_chunk|tool)/
export const RAW_TOOL_FIELDS = Object.freeze(['rawInput', 'rawOutput', 'toolCallId'])
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
const USD_DECIMALS = 6
const MAX_BUDGET_USD = '20'
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

function isObject(value, keys, optional = []) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    keys.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => keys.includes(key) || optional.includes(key))
  )
}

const isCounter = (value) => Number.isSafeInteger(value) && value >= 0
const isNullableCounter = (value) => value === null || isCounter(value)
const isNullableText = (value) => value === null || typeof value === 'string'

/** Canonical decimal USD; fixed micro-units are bigint throughout validation. */
export function microUsd(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/.test(value)) return
  const [whole, fraction = ''] = value.split('.', 2)
  if (fraction.length > USD_DECIMALS) return
  const units =
    BigInt(whole) * 10n ** BigInt(USD_DECIMALS) + BigInt(fraction.padEnd(USD_DECIMALS, '0'))
  return units <= BigInt(Number.MAX_SAFE_INTEGER) ? units : undefined
}
const isAmount = (value) => microUsd(value) !== undefined
function isSumEqual(total, values) {
  const expected = microUsd(total)
  const units = values.map((value) => microUsd(value))
  if (expected === undefined || units.includes(undefined)) return false
  let sum = 0n
  for (const unit of units) sum += unit
  return sum === expected
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
    ((value.uncertain === '0' && value.reserved === '0') || value.isUpperBound)
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

const isCap = (value) =>
  isAmount(value) && microUsd(value) > 0n && microUsd(value) <= microUsd(MAX_BUDGET_USD)

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
      Object.entries(usage.paid).every(([key, total]) => total === (key.endsWith('Usd') ? '0' : 0))
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

function isTotals(value) {
  return (
    isObject(value, [
      'capUsd',
      'settledUsd',
      'uncertainUsd',
      'reservedUsd',
      'remainingUsd',
      'requests',
      'tokens',
      'paid',
      'breach',
      'refusal',
      'lastResponse',
    ]) &&
    isCounter(value.requests) &&
    isObject(value.tokens, ['inputTokens', 'outputTokens', 'cachedTokens', 'reasoningTokens']) &&
    Object.values(value.tokens).every((count) => isCounter(count)) &&
    isPaid(value.paid) &&
    typeof value.breach === 'boolean' &&
    (value.refusal === null || REFUSALS.has(value.refusal)) &&
    (value.lastResponse === null || isLastResponse(value.lastResponse)) &&
    isSumEqual(value.capUsd, [
      value.settledUsd,
      value.uncertainUsd,
      value.reservedUsd,
      value.remainingUsd,
    ])
  )
}

/** No prohibited ACP variant and no raw tool field, at any depth of an update. */
function isSafeUpdate(value) {
  return Array.isArray(value)
    ? value.every((item) => isSafeUpdate(item))
    : typeof value !== 'object' ||
        value === null ||
        Object.entries(value).every(
          ([key, item]) =>
            !RAW_TOOL_FIELDS.includes(key) &&
            (key !== 'sessionUpdate' ||
              (typeof item === 'string' && !PROHIBITED_UPDATE.test(item))) &&
            isSafeUpdate(item),
        )
}

const isTextFields = (value, keys) => keys.every((key) => typeof value[key] === 'string')

/** One event body by its type, field for field against execEventSchema (SPEC §5.1). */
const EVENT_BODIES = Object.freeze({
  start: (value) =>
    isObject(value, [
      'type',
      'agent',
      'backend',
      'mode',
      'model',
      'effort',
      'sessionId',
      'ephemeral',
      'paidFeatures',
      'limits',
    ]) &&
    isObject(value.agent, ['name', 'version']) &&
    isTextFields(value.agent, ['name', 'version']) &&
    (value.backend === 'museCode' || value.backend === 'modelApi') &&
    (value.mode === 'plan' || value.mode === 'acceptEdits') &&
    isNullableText(value.model) &&
    isNullableText(value.effort) &&
    typeof value.sessionId === 'string' &&
    typeof value.ephemeral === 'boolean' &&
    Array.isArray(value.paidFeatures) &&
    value.paidFeatures.every((feature) => feature === 'imageGeneration') &&
    isLimits(value.limits),
  update: (value) =>
    isObject(value, ['type', 'update']) &&
    typeof value.update === 'object' &&
    value.update !== null &&
    !Array.isArray(value.update) &&
    typeof value.update.sessionUpdate === 'string' &&
    isSafeUpdate(value.update),
  tool: (value) =>
    isObject(value, ['type', 'name', 'status', 'durationMs']) &&
    isTextFields(value, ['name', 'status']) &&
    typeof value.durationMs === 'number' &&
    Number.isFinite(value.durationMs) &&
    value.durationMs >= 0,
  message: (value) =>
    isObject(value, ['type', 'itemId', 'kind', 'text', 'complete']) &&
    isTextFields(value, ['itemId', 'text']) &&
    (value.kind === 'agentMessage' || value.kind === 'reasoning') &&
    typeof value.complete === 'boolean',
  permission_denied: (value) =>
    isObject(value, ['type', 'toolCallId', 'title', 'kind', 'paths']) &&
    isTextFields(value, ['toolCallId', 'title', 'kind']) &&
    isPathList(value.paths),
  question_declined: (value) => isObject(value, ['type', 'count']) && isCounter(value.count),
  attempt: (value) =>
    isObject(
      value,
      ['type', 'n', 'endpoint', 'phase', 'reservedUsd', 'totals'],
      ['maxOutputTokens', 'outcome', 'chargedUsd', 'terminal'],
    ) &&
    isCounter(value.n) &&
    value.n >= 1 &&
    ENDPOINTS.has(value.endpoint) &&
    (value.phase === 'admitted' || value.phase === 'settled') &&
    (!Object.hasOwn(value, 'maxOutputTokens') || isCounter(value.maxOutputTokens)) &&
    isAmount(value.reservedUsd) &&
    (!Object.hasOwn(value, 'outcome') ||
      value.outcome === 'priced' ||
      value.outcome === 'full-reservation') &&
    (!Object.hasOwn(value, 'chargedUsd') || isAmount(value.chargedUsd)) &&
    (!Object.hasOwn(value, 'terminal') || isNullableText(value.terminal)) &&
    isTotals(value.totals),
  paid_use: (value) =>
    isObject(value, ['type', 'feature', 'n', 'phase', 'units', 'usd'], ['reason']) &&
    value.feature === 'imageGeneration' &&
    (value.n === null || (isCounter(value.n) && value.n >= 1)) &&
    PAID_PHASES.has(value.phase) &&
    isCounter(value.units) &&
    isAmount(value.usd) &&
    (!Object.hasOwn(value, 'reason') || typeof value.reason === 'string'),
  limit: (value) => isObject(value, ['type', 'limit']) && LIMIT_KINDS.has(value.limit),
  signal: (value) =>
    isObject(value, ['type', 'signal']) &&
    (value.signal === 'SIGINT' || value.signal === 'SIGTERM'),
  result: (value) => isObject(value, ['type', 'result']) && isExecResult(value.result),
})

/** One exec event: the v2 envelope and its body (SPEC §2.2, §5.1). */
export function isExecEvent(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { v, seq, time, ...body } = value
  return (
    v === 2 &&
    isCounter(seq) &&
    seq >= 1 &&
    typeof time === 'string' &&
    ISO_TIME.test(time) &&
    Number.isFinite(Date.parse(time)) &&
    Object.hasOwn(EVENT_BODIES, body.type) &&
    EVENT_BODIES[body.type](body)
  )
}

/** The ExecResult v2 invariants, field for field (SPEC §2.1, §2.3). */
export function isExecResult(value) {
  return (
    isObject(value, RESULT_KEYS) &&
    value.v === 2 &&
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
 * valid v2 event with the next sequence number, the text is cut mid-line,
 * there is no result, more than one, a line after it, or the result is
 * invalid.
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
    if (!isExecEvent(event) || event.seq !== index + 1) return
    if (event.type !== 'result') continue
    if (Buffer.byteLength(line) > ACTION_RESULT_MAX_BYTES) return
    result = event.result
  }
  return result
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
    // Both moves are synchronous, right after the eligibility check: a stop
    // cannot interrupt one and leave it to finish after cleanup, and an
    // abandoned continuation reaches the check stopped (RVM80CD P2-2).
    if (!owner.publicationAllowed) return null
    try {
      renameSync(paths.resultTmp, paths.result)
      renameSync(paths.eventsTmp, paths.events)
    } catch (error) {
      rmSync(paths.result, { force: true })
      rmSync(paths.events, { force: true })
      throw error
    }
    return result
  })
}
