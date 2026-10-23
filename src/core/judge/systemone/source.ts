// Remote SystemOne judge (M98 phase 2 lane C). One injected reserve seam,
// the existing key id, and a fixed preset origin. No second client or ledger.
import {
  JUDGE_MAX_BODY_BYTES,
  JUDGE_MAX_STATE_TOKENS,
  JUDGE_REQUEST_TIMEOUT_MS,
} from '../../../shared/constants'
import { capabilities, presets } from '../../../host/backend/providersEntry'
import type { SystemOneModelCapability } from '../../providers/capabilities'
const { systemOneCapability } = capabilities
const { systemOnePresetById } = presets
import type { SystemOneServicePreset } from '../../providers/presets'
import { redactSecrets } from '../../redact'
import { unlessAborted } from '../../timeouts'
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
  /** Increment for every policy/binding change, including revocation then restoration. */
  readonly generation: number
  readonly presetId: string
  readonly model: string
  readonly enabled: boolean
  readonly selection: 'explicit' | 'auto'
  readonly confidential: boolean
  readonly consent: 'granted' | 'needed' | 'declined'
  /** The route grant's revocation count ("Ask again", a price change); 0 where none exists. */
  readonly revocation?: number
}

export interface SystemOnePost {
  readonly origin: string
  readonly path: string
  readonly body: string
  readonly key: string
  readonly signal: AbortSignal
  /**
  The final fence, called after every wait up to the moment the request's
  bytes are written (after name resolution and again once connected):
  false withdraws the request unsent.
  */
  readonly proceed: () => boolean
  /** Called once, when the request is actually dispatched (its bytes are being written). */
  readonly onDispatch?: (() => void) | undefined
}

export interface SystemOnePostResult {
  readonly sent: boolean
  readonly status: number
  readonly body: unknown
}

export interface SystemOneClaim {
  readonly reservedUsd: number
  /** The durable claim's live admission (Stop, day change, reduced cap): throws when it no longer holds. */
  check(): void
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
    generation: selection.generation,
    presetId: selection.presetId,
    model: selection.model,
    enabled: selection.enabled,
    selection: selection.selection,
    confidential: selection.confidential,
    consent: selection.consent,
    revocation: selection.revocation ?? 0,
  })
}

function redactNode(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value)
  if (value === null || typeof value !== 'object') return value
  return Array.isArray(value)
    ? Array.from(value, (item) => redactNode(item))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactNode(item)]))
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
  try {
    // Scrub raw text before escaping, then named fields with their JSON context.
    // This is the sole outbound owner; only its validated copy reaches the wire.
    const redacted: unknown = JSON.parse(
      redactSecrets(
        JSON.stringify({
          ...parsed,
          state: redactNode(parsed.state),
          questions: redactNode(parsed.questions),
        }),
      ),
    )
    const candidate = judgeRequestSchema.safeParse(redacted)
    return candidate.success ? candidate.data : undefined
  } catch {
    return undefined
  }
}

function bindingRefusal(
  deps: SystemOneJudgeDependencies,
  binding: string,
): NoAnswerReason | undefined {
  const fresh = deps.configuration()
  // An otherwise allowed replacement still needs a new consent binding.
  return fingerprint(fresh) === binding ? undefined : (routeRefusal(fresh) ?? 'consent-needed')
}

async function reserveUntilAborted(
  deps: SystemOneJudgeDependencies,
  quote: number,
  signal: AbortSignal,
): Promise<SystemOneReserveResult | undefined> {
  const pending = deps.reserve(quote)
  const reserved = await unlessAborted(pending, signal)
  if (reserved === undefined) {
    // Admission may finish after Stop. Only this branch owns that late claim;
    // it cannot dispatch and refunds exactly once. Late rejections are consumed.
    void pending
      .then(async (late) => {
        if (late.reserved) await release(late.claim, 'cancelled')
      })
      .catch(() => refused('engine-failure'))
  }
  return reserved
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
Opt-in remote Jev. Policy runs before any key, reservation or send.
A known non-send refunds; a send that fails closed keeps the liability.
*/
export function createSystemOneJudge(deps: SystemOneJudgeDependencies): JudgeRuntime {
  return {
    async judge(input, callerSignal): Promise<JudgeOutcome> {
      const configured = deps.configuration()
      if (configured === undefined) return refused('source-unavailable')
      const initial = { ...configured }
      if (!Number.isSafeInteger(initial.generation) || initial.generation < 0) {
        return refused('source-unavailable')
      }
      const binding = fingerprint(initial)
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
      let reserved: SystemOneReserveResult | undefined
      try {
        reserved = await reserveUntilAborted(deps, quote, signal)
      } catch {
        return refused(
          isSignalAborted(signal) ? abortReason(callerSignal, deadline) : 'engine-failure',
        )
      }
      if (reserved === undefined) return refused(abortReason(callerSignal, deadline))
      if (!reserved.reserved) return refused(ledgerReason(reserved.reason))
      const claim = reserved.claim
      // Why this claim may not dispatch now: cancellation, a changed identity
      // or authorization (owner, chat model, source, consent, revocation), or
      // the durable claim's own live admission (Stop, day change, reduced
      // cap). Read after every wait, through the transport's final fence.
      const holdReason = (): NoAnswerReason | undefined => {
        const changed = bindingRefusal(deps, binding)
        let isAdmitted = true
        try {
          claim.check()
        } catch {
          isAdmitted = false
        }
        // Cancellation is read last: a reader above may abort synchronously.
        if (isSignalAborted(signal)) return abortReason(callerSignal, deadline)
        if (changed !== undefined) return changed
        return isAdmitted ? undefined : 'over-budget'
      }
      const complete = async (): Promise<JudgeOutcome> => {
        const before = holdReason()
        if (before !== undefined) return await release(claim, before)
        let key: string | undefined
        try {
          key = await unlessAborted(deps.readKey(route.preset.keyProviderId), signal)
        } catch {
          return await release(claim, 'engine-failure')
        }
        const afterKey = holdReason()
        if (afterKey !== undefined) return await release(claim, afterKey)
        if (key === undefined || key.length === 0) return await release(claim, 'source-unavailable')
        let response: SystemOnePostResult
        try {
          response = await deps.post({
            origin: route.preset.origin,
            path: route.preset.path,
            body,
            key,
            signal,
            proceed: () => holdReason() === undefined,
          })
        } catch {
          return refused('engine-failure')
        }
        // Withdrawn or refused before any byte was written: a known non-send.
        if (!response.sent) return await release(claim, holdReason() ?? 'engine-failure')
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
          // One serialized transition owns settlement. Stop ends the caller's
          // wait, while known dispatched usage still finishes accounting once.
          await claim.settle(actual)
          // A call whose authorization was revoked, or whose identity changed,
          // while it was in flight is charged but never answers: no caution
          // from a revoked call.
          const late = bindingRefusal(deps, binding)
          return late === undefined ? { outcome: 'answered', result } : refused(late)
        } catch {
          return refused('engine-failure')
        }
      }
      const outcome = await unlessAborted(complete(), signal)
      // The shared signal is sticky: cancellation can never become answered,
      // even if the response or ledger wins the promise race in the same turn.
      return outcome === undefined || isSignalAborted(signal)
        ? refused(abortReason(callerSignal, deadline))
        : outcome
    },
  }
}
