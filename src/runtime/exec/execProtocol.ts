// M80 result/event contract; no engine or lifecycle dependency.
import * as z from 'zod/mini'
import {
  HTTP_STATUS_MAX,
  ACP_BACKENDS,
  EXEC_EXIT,
  EXEC_MODES,
  EXEC_PAID_FEATURES,
  EXEC_PROTOCOL_VERSION,
  EXEC_USD_DECIMALS,
  EXEC_MAX_BUDGET_USD,
  EXEC_MAX_REQUESTS,
  EXEC_MIN_TIMEOUT_SECONDS,
  EXEC_MAX_TIMEOUT_SECONDS,
} from '../../shared/constants'
import type { AcpBackendKind } from '../../shared/constants'
import type { ExecMode, ExecPaidFeature } from './execArgs'

export type ExecStatus =
  | 'completed'
  | 'incomplete'
  | 'failed'
  | 'cancelled'
  | 'timeout'
  | 'budget_exceeded'
  | 'request_cap'
  | 'denied'
  | 'auth_required'
  | 'backend_unavailable'
  | 'internal'
  | 'accounting_unverified'
export type ExecSignal = 'SIGINT' | 'SIGTERM'
export type Refusal = 'budget' | 'requests' | 'closed' | 'unpriced' | 'request_shape'
export type AttemptEndpoint = 'responses' | 'images.generations' | 'images.edits'
export interface TokenTotals {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  reasoningTokens: number
}
export interface LastResponse {
  n: number
  terminal: string | null
  incompleteReason: string | null
  endedWithoutTerminal: boolean
  httpStatus: number | null
  transportError: string | null
  usage: 'valid' | 'missing' | 'invalid'
  settlement: 'priced' | 'full-reservation'
}
export interface PaidTotals {
  imageAttempts: number
  imagesReturned: number
  imagesRefunded: number
  imagesUncertain: number
  settledUsd: number
  uncertainUsd: number
}
export interface CostTotals {
  settled: number
  uncertain: number
  reserved: number
  total: number
  isUpperBound: boolean
}
export interface LedgerTotals {
  capUsd: number
  settledUsd: number
  uncertainUsd: number
  reservedUsd: number
  remainingUsd: number
  requests: number
  tokens: TokenTotals
  paid: PaidTotals
  breach: boolean
  refusal: Refusal | null
  lastResponse: LastResponse | null
}
export interface ExecLimits {
  budgetUsd: number | null
  maxRequests: number | null
  timeoutSeconds: number
}
export interface ExecInputRecord {
  name: string
  bytes: number
  chunks: number
  complete: boolean
}
export interface ExecDenial {
  toolCallId: string
  title: string
  kind: string
  paths: string[]
}
export interface ExecResult {
  v: 1
  status: ExecStatus
  exitCode: number
  signal: ExecSignal | null
  stopReason: string | null
  terminal: string | null
  incompleteReason: string | null
  backend: AcpBackendKind
  mode: ExecMode
  model: string | null
  sessionId: string | null
  ephemeral: boolean
  finalMessage: string
  filesChanged: string[]
  denials: ExecDenial[]
  questionsDeclined: number
  inputs: ExecInputRecord[]
  usage: {
    requests: number | null
    inputTokens: number | null
    outputTokens: number | null
    cachedTokens: number | null
    reasoningTokens: number | null
    costUsd: CostTotals | null
    paid: PaidTotals
  }
  ledger: {
    capUsd: number
    breach: boolean
    refusal: Refusal | null
    lastResponse: LastResponse | null
  } | null
  limits: ExecLimits
  durationMs: number
  error: { kind: string; message: string } | null
}
export type ExecEventBody =
  | {
      type: 'start'
      agent: { name: string; version: string }
      backend: AcpBackendKind
      mode: ExecMode
      model: string | null
      effort: string | null
      sessionId: string
      ephemeral: boolean
      paidFeatures: readonly ExecPaidFeature[]
      limits: ExecLimits
    }
  | { type: 'update'; update: { sessionUpdate: string; [key: string]: unknown } }
  | { type: 'tool'; name: string; status: string; durationMs: number }
  | {
      type: 'message'
      itemId: string
      kind: 'agentMessage' | 'reasoning'
      text: string
      complete: boolean
    }
  | {
      type: 'permission_denied'
      toolCallId: string
      title: string
      kind: string
      paths: readonly string[]
    }
  | { type: 'question_declined'; count: number }
  | {
      type: 'attempt'
      n: number
      endpoint: AttemptEndpoint
      phase: 'admitted' | 'settled'
      maxOutputTokens?: number
      reservedUsd: number
      outcome?: 'priced' | 'full-reservation'
      chargedUsd?: number
      terminal?: string | null
      totals: LedgerTotals
    }
  | {
      type: 'paid_use'
      feature: 'imageGeneration'
      n: number | null
      phase: 'admitted' | 'returned' | 'refunded' | 'uncertain' | 'refused'
      units: number
      usd: number
      reason?: string
    }
  | {
      type: 'limit'
      limit:
        'budget' | 'requests' | 'timeout' | 'breach' | 'request_shape' | 'unpriced' | 'accounting'
    }
  | { type: 'signal'; signal: ExecSignal }
  | { type: 'result'; result: ExecResult }
export type ExecEvent = ExecEventBody & { v: 1; seq: number; time: string }

const STATUSES = [
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
] as const
const SIGNALS = ['SIGINT', 'SIGTERM'] as const
const REFUSALS = ['budget', 'requests', 'closed', 'unpriced', 'request_shape'] as const
const ENDPOINTS = ['responses', 'images.generations', 'images.edits'] as const
const PROHIBITED_UPDATE = /^(?:agent_(?:message|thought)_chunk|tool)/
const RAW_TOOL_FIELDS = new Set(['rawInput', 'rawOutput', 'toolCallId'])
const counter = z.number().check(z.gte(0), z.int(), z.lte(Number.MAX_SAFE_INTEGER))
const amount = z.number().check(
  z.gte(0),
  z.refine((value) => microUsd(value) !== undefined),
)
const nullableText = z.nullable(z.string())
const relativePath = z.string().check(
  z.minLength(1),
  z.refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.includes(':') &&
      value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
  ),
)
const paths = z.array(relativePath).check(z.refine((value) => new Set(value).size === value.length))
const tokenSchema = z.strictObject({
  inputTokens: counter,
  outputTokens: counter,
  cachedTokens: counter,
  reasoningTokens: counter,
})
const paidSchema = z
  .strictObject({
    imageAttempts: counter,
    imagesReturned: counter,
    imagesRefunded: counter,
    imagesUncertain: counter,
    settledUsd: amount,
    uncertainUsd: amount,
  })
  .check(
    z.refine(
      (value) =>
        value.imagesReturned + value.imagesRefunded + value.imagesUncertain <= value.imageAttempts,
    ),
  )
const costSchema = z
  .strictObject({
    settled: amount,
    uncertain: amount,
    reserved: amount,
    total: amount,
    isUpperBound: z.boolean(),
  })
  .check(
    z.refine(
      (value) =>
        isSumEqual(value.total, [value.settled, value.uncertain, value.reserved]) &&
        (!(value.uncertain > 0 || value.reserved > 0) || value.isUpperBound),
    ),
  )
const lastResponseSchema = z
  .strictObject({
    n: counter.check(z.gte(1)),
    terminal: nullableText,
    incompleteReason: nullableText,
    endedWithoutTerminal: z.boolean(),
    httpStatus: z.nullable(counter.check(z.gte(100), z.lte(HTTP_STATUS_MAX))),
    transportError: nullableText,
    usage: z.enum(['valid', 'missing', 'invalid']),
    settlement: z.enum(['priced', 'full-reservation']),
  })
  .check(
    z.refine(
      (value) =>
        value.settlement !== 'priced' ||
        (value.terminal === 'completed' &&
          value.usage === 'valid' &&
          !value.endedWithoutTerminal &&
          value.transportError === null),
    ),
  )
const limitsSchema = z.strictObject({
  budgetUsd: z.nullable(amount.check(z.gt(0), z.lte(EXEC_MAX_BUDGET_USD))),
  maxRequests: z.nullable(counter.check(z.gte(1), z.lte(EXEC_MAX_REQUESTS))),
  timeoutSeconds: counter.check(z.gte(EXEC_MIN_TIMEOUT_SECONDS), z.lte(EXEC_MAX_TIMEOUT_SECONDS)),
})
const ledgerSchema = z.strictObject({
  capUsd: amount.check(z.gt(0), z.lte(EXEC_MAX_BUDGET_USD)),
  breach: z.boolean(),
  refusal: z.nullable(z.enum(REFUSALS)),
  lastResponse: z.nullable(lastResponseSchema),
})
const totalsSchema = z
  .strictObject({
    capUsd: amount,
    settledUsd: amount,
    uncertainUsd: amount,
    reservedUsd: amount,
    remainingUsd: amount,
    requests: counter,
    tokens: tokenSchema,
    paid: paidSchema,
    breach: z.boolean(),
    refusal: z.nullable(z.enum(REFUSALS)),
    lastResponse: z.nullable(lastResponseSchema),
  })
  .check(
    z.refine((value) =>
      isSumEqual(value.capUsd, [
        value.settledUsd,
        value.uncertainUsd,
        value.reservedUsd,
        value.remainingUsd,
      ]),
    ),
  )

/** USD is a serialization only. Recover canonical micro-USD before any comparison. */
function microUsd(value: number): number | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined
  const raw = value.toFixed(EXEC_USD_DECIMALS)
  if (Number(raw) !== value) return undefined
  const units = Number(raw.replace('.', ''))
  return Number.isSafeInteger(units) ? units : undefined
}

function isSumEqual(total: number, values: readonly number[]): boolean {
  const expected = microUsd(total)
  const units = values.map((value) => microUsd(value))
  if (expected === undefined || units.includes(undefined)) return false
  const sum = units.reduce<number>((acc, value) => acc + (value ?? 0), 0)
  return Number.isSafeInteger(sum) && expected === sum
}

/** Reject nested raw tool fields as well as future tool updates. */
function isSafeUpdate(value: unknown): boolean {
  return Array.isArray(value)
    ? value.every((item: unknown) => isSafeUpdate(item))
    : typeof value !== 'object' ||
        value === null ||
        Object.entries(value).every(
          ([key, item]) =>
            !RAW_TOOL_FIELDS.has(key) &&
            (key !== 'sessionUpdate' ||
              (typeof item === 'string' && !PROHIBITED_UPDATE.test(item))) &&
            isSafeUpdate(item),
        )
}

function hasCompletionEvidence(value: ExecResult): boolean {
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

function isBackendAccountingValid(value: ExecResult): boolean {
  const cost = value.usage.costUsd
  const ledger = value.ledger
  if (value.backend === 'museCode') {
    return (
      ledger === null &&
      cost === null &&
      value.usage.requests === null &&
      value.limits.budgetUsd === null &&
      value.limits.maxRequests === null &&
      Object.values(value.usage.paid).every((total) => total === 0)
    )
  }
  // An early failed setup may have no accounting yet; completion always does.
  if (
    ledger === null ||
    cost === null ||
    value.usage.requests === null ||
    value.limits.budgetUsd === null ||
    value.limits.maxRequests === null
  )
    return value.status !== 'completed'
  const cap = microUsd(ledger.capUsd)
  const total = microUsd(cost.total)
  return (
    cap !== undefined &&
    total !== undefined &&
    cap === microUsd(value.limits.budgetUsd) &&
    total <= cap
  )
}

export function exitCodeFor(status: ExecStatus, signal: ExecSignal | null): number {
  switch (status) {
    case 'completed': {
      return EXEC_EXIT.ok
    }
    case 'internal': {
      return EXEC_EXIT.internal
    }
    case 'auth_required':
    case 'backend_unavailable': {
      return EXEC_EXIT.auth
    }
    case 'failed': {
      return EXEC_EXIT.failed
    }
    case 'budget_exceeded':
    case 'request_cap': {
      return EXEC_EXIT.limit
    }
    case 'timeout': {
      return EXEC_EXIT.timeout
    }
    case 'denied': {
      return EXEC_EXIT.denied
    }
    case 'incomplete': {
      return EXEC_EXIT.incomplete
    }
    case 'accounting_unverified': {
      return EXEC_EXIT.accounting
    }
    case 'cancelled': {
      return signal === 'SIGINT' ? EXEC_EXIT.sigint : EXEC_EXIT.sigterm
    }
  }
}

export const execResultSchema: z.ZodMiniType<ExecResult> = z
  .strictObject({
    v: z.literal(EXEC_PROTOCOL_VERSION),
    status: z.enum(STATUSES),
    exitCode: counter,
    signal: z.nullable(z.enum(SIGNALS)),
    stopReason: nullableText,
    terminal: nullableText,
    incompleteReason: nullableText,
    backend: z.enum(ACP_BACKENDS),
    mode: z.enum(EXEC_MODES),
    model: nullableText,
    sessionId: nullableText,
    ephemeral: z.boolean(),
    finalMessage: z.string(),
    filesChanged: paths,
    denials: z.array(
      z.strictObject({ toolCallId: z.string(), title: z.string(), kind: z.string(), paths }),
    ),
    questionsDeclined: counter,
    inputs: z.array(
      z.strictObject({
        name: z.string().check(
          z.minLength(1),
          z.refine((value) => !/[\\/:]/.test(value)),
        ),
        bytes: counter,
        chunks: counter,
        complete: z.boolean(),
      }),
    ),
    usage: z.strictObject({
      requests: z.nullable(counter),
      inputTokens: z.nullable(counter),
      outputTokens: z.nullable(counter),
      cachedTokens: z.nullable(counter),
      reasoningTokens: z.nullable(counter),
      costUsd: z.nullable(costSchema),
      paid: paidSchema,
    }),
    ledger: z.nullable(ledgerSchema),
    limits: limitsSchema,
    durationMs: z.number().check(z.gte(0)),
    error: z.nullable(z.strictObject({ kind: z.string(), message: z.string() })),
  })
  .check(
    z.refine(
      (value) =>
        hasCompletionEvidence(value) &&
        isBackendAccountingValid(value) &&
        value.exitCode === exitCodeFor(value.status, value.signal) &&
        (value.status === 'cancelled') === (value.signal !== null) &&
        (value.status === 'completed') === (value.error === null) &&
        (value.usage.cachedTokens === null ||
          value.usage.inputTokens === null ||
          value.usage.cachedTokens <= value.usage.inputTokens) &&
        (value.usage.reasoningTokens === null ||
          value.usage.outputTokens === null ||
          value.usage.reasoningTokens <= value.usage.outputTokens),
    ),
  )

const eventSchemas = [
  z.strictObject({
    type: z.literal('start'),
    agent: z.strictObject({ name: z.string(), version: z.string() }),
    backend: z.enum(ACP_BACKENDS),
    mode: z.enum(EXEC_MODES),
    model: nullableText,
    effort: nullableText,
    sessionId: z.string(),
    ephemeral: z.boolean(),
    paidFeatures: z.array(z.enum(EXEC_PAID_FEATURES)),
    limits: limitsSchema,
  }),
  z.strictObject({
    type: z.literal('update'),
    update: z.looseObject({ sessionUpdate: z.string() }).check(z.refine(isSafeUpdate)),
  }),
  z.strictObject({
    type: z.literal('tool'),
    name: z.string(),
    status: z.string(),
    durationMs: z.number().check(z.gte(0)),
  }),
  z.strictObject({
    type: z.literal('message'),
    itemId: z.string(),
    kind: z.enum(['agentMessage', 'reasoning']),
    text: z.string(),
    complete: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('permission_denied'),
    toolCallId: z.string(),
    title: z.string(),
    kind: z.string(),
    paths,
  }),
  z.strictObject({ type: z.literal('question_declined'), count: counter }),
  z.strictObject({
    type: z.literal('attempt'),
    n: counter.check(z.gte(1)),
    endpoint: z.enum(ENDPOINTS),
    phase: z.enum(['admitted', 'settled']),
    maxOutputTokens: z.exactOptional(counter),
    reservedUsd: amount,
    outcome: z.exactOptional(z.enum(['priced', 'full-reservation'])),
    chargedUsd: z.exactOptional(amount),
    terminal: z.exactOptional(nullableText),
    totals: totalsSchema,
  }),
  z.strictObject({
    type: z.literal('paid_use'),
    feature: z.literal('imageGeneration'),
    n: z.nullable(counter.check(z.gte(1))),
    phase: z.enum(['admitted', 'returned', 'refunded', 'uncertain', 'refused']),
    units: counter,
    usd: amount,
    reason: z.exactOptional(z.string()),
  }),
  z.strictObject({
    type: z.literal('limit'),
    limit: z.enum([
      'budget',
      'requests',
      'timeout',
      'breach',
      'request_shape',
      'unpriced',
      'accounting',
    ]),
  }),
  z.strictObject({ type: z.literal('signal'), signal: z.enum(SIGNALS) }),
  z.strictObject({ type: z.literal('result'), result: execResultSchema }),
] as const
const envelope = {
  v: z.literal(EXEC_PROTOCOL_VERSION),
  seq: counter.check(z.gte(1)),
  time: z.iso.datetime(),
}
export const execEventSchema: z.ZodMiniType<ExecEvent> = z.union([
  z.extend(eventSchemas[0], envelope),
  z.extend(eventSchemas[1], envelope),
  z.extend(eventSchemas[2], envelope),
  z.extend(eventSchemas[3], envelope),
  z.extend(eventSchemas[4], envelope),
  z.extend(eventSchemas[5], envelope),
  z.extend(eventSchemas[6], envelope),
  z.extend(eventSchemas[7], envelope),
  z.extend(eventSchemas[8], envelope),
  z.extend(eventSchemas[9], envelope),
  z.extend(eventSchemas[10], envelope),
])

export function validateResult(value: unknown): ExecResult {
  return execResultSchema.parse(value)
}
