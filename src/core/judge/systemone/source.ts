// Remote SystemOne judge (M98 phase 2 lane C). One injected reserve seam,
// the existing key id, and a fixed preset origin. No second client or ledger.
import {
  JUDGE_MAX_BODY_BYTES,
  JUDGE_MAX_STATE_TOKENS,
  JUDGE_REQUEST_TIMEOUT_MS,
} from '../../../shared/constants'
import { systemOneCapability, type SystemOneModelCapability } from '../../providers/capabilities'
import { systemOnePresetById, type SystemOneServicePreset } from '../../providers/presets'
import { redactSecrets } from '../../redact'
import type { JudgeRuntime } from '../engine'
import {
  judgeRequestBytes,
  judgeRequestSchema,
  type JudgeOutcome,
  type JudgeRequest,
} from '../schema'
import { systemOneUsd } from './policy'
import { prepareSystemOne } from './wire'

/** HTTP success is the only status whose body is a SystemOne result. */
const HTTP_OK = 200

type NoAnswerReason = Extract<JudgeOutcome, { outcome: 'no-answer' }>['reason']

export interface SystemOneSelection {
  readonly presetId: string
  readonly model: string
  readonly enabled: boolean
  readonly selection: 'explicit' | 'auto'
  readonly confidential: boolean
  readonly consent: 'granted' | 'needed' | 'declined'
}

export interface SystemOnePost {
  readonly origin: string
  readonly path: string
  readonly body: string
  readonly key: string
  readonly signal: AbortSignal
}

export interface SystemOnePostResult {
  readonly sent: boolean
  readonly status: number
  readonly body: unknown
}

export interface SystemOneClaim {
  readonly reservedUsd: number
  settle(usd: number): Promise<void>
  refund(): Promise<void>
}

export type SystemOneReserveResult =
  | { readonly reserved: true; readonly claim: SystemOneClaim }
  | { readonly reserved: false; readonly reason: 'over-budget' | 'unpriced' | 'ledger-unavailable' }

/** Assembly injects these. Constructing the runtime touches none of them. */
export interface SystemOneJudgeDependencies {
  configuration(): SystemOneSelection | undefined
  readKey(keyProviderId: string): Promise<string | undefined>
  measureTokens(text: string): number
  reserve(usd: number): Promise<SystemOneReserveResult>
  post(request: SystemOnePost): Promise<SystemOnePostResult>
}

interface ResolvedRoute {
  readonly preset: SystemOneServicePreset
  readonly capability: SystemOneModelCapability
}

function refused(reason: NoAnswerReason): JudgeOutcome {
  return { outcome: 'no-answer', reason }
}

/** Enabled, then confidential, then explicit opt-in, then consent. No I/O. */
function policyRefusal(selection: SystemOneSelection | undefined): NoAnswerReason | undefined {
  if (selection === undefined) return 'source-unavailable'
  if (!selection.enabled) return 'explicit-off'
  if (selection.confidential) return 'confidential-refused'
  if (selection.selection !== 'explicit') return 'source-untested'
  if (selection.consent === 'declined') return 'consent-declined'
  return selection.consent === 'granted' ? undefined : 'consent-needed'
}

function resolveRoute(
  selection: SystemOneSelection,
): ResolvedRoute | { readonly reason: 'source-unavailable' | 'capability-unavailable' } {
  const preset = systemOnePresetById(selection.presetId)
  if (preset === undefined) return { reason: 'source-unavailable' }
  const capability = systemOneCapability(selection.presetId, selection.model)
  return capability === undefined ? { reason: 'capability-unavailable' } : { preset, capability }
}

function routeRefusal(selection: SystemOneSelection | undefined): NoAnswerReason | undefined {
  const policy = policyRefusal(selection)
  if (policy !== undefined || selection === undefined) return policy
  const route = resolveRoute(selection)
  return 'reason' in route ? route.reason : undefined
}

function fingerprint(selection: SystemOneSelection | undefined): string {
  if (selection === undefined) return ''
  return JSON.stringify({
    presetId: selection.presetId,
    model: selection.model,
    enabled: selection.enabled,
    selection: selection.selection,
    confidential: selection.confidential,
    consent: selection.consent,
  })
}

function redactNode(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value)
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return Array.from(value, (item) => redactNode(item))
  const copy: Record<string, unknown> = {}
  for (const key of Object.keys(value)) copy[key] = redactNode(Reflect.get(value, key))
  return copy
}

/** A fresh read. A direct `.aborted` check stays narrowed false across awaits. */
function isSignalAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

function abortReason(caller: AbortSignal, deadline: AbortSignal): 'cancelled' | 'timeout' {
  if (caller.aborted) return 'cancelled'
  return deadline.aborted ? 'timeout' : 'cancelled'
}

async function release(claim: SystemOneClaim, reason: NoAnswerReason): Promise<JudgeOutcome> {
  try {
    await claim.refund()
    return refused(reason)
  } catch {
    return refused('engine-failure')
  }
}

function tokenCount(measure: (text: string) => number, text: string): number {
  const count = measure(text)
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError('systemone-measure')
  }
  return count
}

function redactedRequest(parsed: JudgeRequest): JudgeRequest | undefined {
  const candidate = judgeRequestSchema.safeParse({
    ...parsed,
    state: redactNode(parsed.state),
    questions: redactNode(parsed.questions),
  })
  return candidate.success ? candidate.data : undefined
}

interface MeasuredBody {
  readonly failure?: NoAnswerReason
  readonly bodyTokens: number
}

function measureBody(
  request: JudgeRequest,
  body: string,
  capability: SystemOneModelCapability,
  measure: (text: string) => number,
): MeasuredBody {
  const stateTokens = tokenCount(measure, JSON.stringify(request.state))
  let longestQuestion = 0
  for (const question of Object.values(request.questions)) {
    const count = tokenCount(measure, JSON.stringify(question))
    if (count > longestQuestion) longestQuestion = count
  }
  const stateCeiling = Math.min(capability.statePlusLongestQuestionTokens, JUDGE_MAX_STATE_TOKENS)
  if (stateTokens + longestQuestion > stateCeiling)
    return { failure: 'over-context', bodyTokens: 0 }
  if (new TextEncoder().encode(body).length > JUDGE_MAX_BODY_BYTES) {
    return { failure: 'engine-failure', bodyTokens: 0 }
  }
  const bodyTokens = tokenCount(measure, body)
  if (bodyTokens === 0) return { failure: 'engine-failure', bodyTokens: 0 }
  return bodyTokens > capability.requestTokens
    ? { failure: 'over-context', bodyTokens }
    : { bodyTokens }
}

function pricedReservation(
  bodyTokens: number,
  capability: SystemOneModelCapability,
): number | NoAnswerReason {
  if (
    !Number.isFinite(capability.inputUsdPerMillion) ||
    capability.inputUsdPerMillion <= 0 ||
    !Number.isFinite(capability.outputUsdPerMillion) ||
    capability.outputUsdPerMillion < 0
  ) {
    return 'unpriced'
  }
  try {
    return systemOneUsd(bodyTokens, 0, capability)
  } catch {
    return 'engine-failure'
  }
}

function ledgerReason(reason: 'over-budget' | 'unpriced' | 'ledger-unavailable'): NoAnswerReason {
  return reason === 'ledger-unavailable' ? 'engine-failure' : reason
}

/**
 * Opt-in remote Jev. Policy runs before any key, reservation or send.
 * A known non-send refunds; a send that fails closed keeps the liability.
 */
export function createSystemOneJudge(deps: SystemOneJudgeDependencies): JudgeRuntime {
  return {
    async judge(input, callerSignal): Promise<JudgeOutcome> {
      const initial = deps.configuration()
      if (initial === undefined) return refused('source-unavailable')
      const blocked = policyRefusal(initial)
      if (blocked !== undefined) return refused(blocked)
      const route = resolveRoute(initial)
      if ('reason' in route) return refused(route.reason)
      const parsed = judgeRequestSchema.safeParse(input)
      if (!parsed.success) return refused('engine-failure')
      if (parsed.data.model !== undefined && parsed.data.model !== initial.model) {
        return refused('capability-unavailable')
      }
      const request = redactedRequest(parsed.data)
      if (request === undefined || judgeRequestBytes(request) > JUDGE_MAX_BODY_BYTES) {
        return refused('engine-failure')
      }
      const body = JSON.stringify({
        state: request.state,
        model: initial.model,
        questions: request.questions,
      })
      let quoteInput: number
      try {
        const measured = measureBody(request, body, route.capability, (text) =>
          deps.measureTokens(text),
        )
        if (measured.failure !== undefined) return refused(measured.failure)
        quoteInput = measured.bodyTokens
      } catch {
        return refused('engine-failure')
      }
      const quote = pricedReservation(quoteInput, route.capability)
      if (typeof quote !== 'number') return refused(quote)
      const deadline = AbortSignal.timeout(JUDGE_REQUEST_TIMEOUT_MS)
      const signal = AbortSignal.any([callerSignal, deadline])
      if (isSignalAborted(signal)) return refused(abortReason(callerSignal, deadline))
      let reserved: SystemOneReserveResult
      try {
        reserved = await deps.reserve(quote)
      } catch {
        return refused('engine-failure')
      }
      if (!reserved.reserved) return refused(ledgerReason(reserved.reason))
      const claim = reserved.claim
      if (isSignalAborted(signal)) return await release(claim, abortReason(callerSignal, deadline))
      const fresh = deps.configuration()
      if (fingerprint(fresh) !== fingerprint(initial)) {
        return await release(claim, routeRefusal(fresh) ?? 'engine-failure')
      }
      let key: string | undefined
      try {
        key = await deps.readKey(route.preset.keyProviderId)
      } catch {
        return await release(claim, 'engine-failure')
      }
      if (key === undefined || key.length === 0) return await release(claim, 'source-unavailable')
      if (isSignalAborted(signal)) return await release(claim, abortReason(callerSignal, deadline))
      let response: SystemOnePostResult
      try {
        response = await deps.post({
          origin: route.preset.origin,
          path: route.preset.path,
          body,
          key,
          signal,
        })
      } catch {
        return refused(
          isSignalAborted(signal) ? abortReason(callerSignal, deadline) : 'engine-failure',
        )
      }
      if (!response.sent) return await release(claim, 'engine-failure')
      if (response.status !== HTTP_OK) return refused('engine-failure')
      try {
        const prepared = prepareSystemOne(response.body, request, route.capability.responseModels)
        const actual = systemOneUsd(
          prepared.usage.input_tokens,
          prepared.usage.output_tokens,
          route.capability,
        )
        if (actual > claim.reservedUsd) return refused('engine-failure')
        const result = prepared.withCosts({
          reservedCostUsd: claim.reservedUsd,
          settledCostUsd: actual,
        })
        await claim.settle(actual)
        return { outcome: 'answered', result }
      } catch {
        return refused('engine-failure')
      }
    },
  }
}
