// Bring-your-own judge calls (M98 phase 2, lane E). One request on the
// caller's existing provider client: no second transport, no agent, no
// subprocess, and no credential leaves this module. Ollama's chat body is
// the captured request (logprobs, top_logprobs, think: false). Other formats
// carry the same decision on our seam; a codec maps it from a capture.
// No `vscode` import.

import { createHash } from 'node:crypto'
import { failureForLog } from '../../backends/musecode/logText'
import type { CoreLogger } from '../../logging'
import { redactSecrets } from '../../redact'
import type { ProviderIdentity } from '../../backends/modelapi/providerClient'
import type { ModelCapabilityRecord } from '../../providers/capabilityRecord'
import { priceCard } from '../../../host/backend/providersEntry'
import type { ModelPricing } from '../../providers/priceCard'
const { isValidPriceCard, reserveRequestAmount, settleUsageAmount } = priceCard
import {
  JUDGE_MAX_BODY_BYTES,
  JUDGE_MAX_STATE_TOKENS,
  JUDGE_RESULT_CACHE_MAX,
  JUDGE_TOP1_MIN_PROB,
} from '../../../shared/constants'
import {
  compareUsdAmounts,
  isPositiveUsd,
  nonnegativeUsdSchema,
  sumUsd,
  Usd,
  type UsdAmount,
} from '../../../shared/usd'
import type { JudgeDailyLedger, JudgeLedgerClaim } from '../admission'
import { labelForTechnique, type AnswerMaterial } from '../judge'
import { entropyConfidence } from '../math'
import { planJudgeBatches, type JudgePromptBatch, type JudgePromptWording } from '../prompt'
import { judgePromptWording } from '../same/wording'
import {
  judgeOptionIndex,
  judgeRequestSchema,
  judgeResultSchema,
  type JudgeCapability,
  type JudgeOutcome,
  type JudgeQuestion,
  type JudgeRequest,
} from '../schema'
import { chooseByoTechnique, type ByoStatedFormat, type ByoTechniqueChoice } from './decide'
import { decodeByoResponse, type ByoUsage } from './decode'

export interface ByoProviderClient {
  readonly provider: ProviderIdentity
  currentKeyDigest(): Promise<string>
}

export interface ByoConsent {
  readonly state: 'granted' | 'needed' | 'declined'
  readonly epoch: string
  readonly expiresAtMs: number
  /** The fingerprint consent was asked for. A price change asks again. */
  readonly priceFingerprint: string
}

export interface ByoChatBinding {
  readonly providerId: string
  readonly modelId: string
  readonly endpoint: string
}

export interface ByoOllamaChatRequest {
  readonly model: string
  readonly stream: false
  readonly think: false
  readonly messages: readonly { readonly role: 'system' | 'user'; readonly content: string }[]
  readonly options: { readonly num_predict: number; readonly temperature: 0 }
  readonly logprobs?: true
  readonly top_logprobs?: number
}

/** What one completion asks for. `ollama` is the only captured vendor body. */
export interface ByoCompletionRequest {
  readonly providerId: string
  readonly endpoint: string
  readonly format: ProviderIdentity['format']
  readonly model: string
  readonly technique: ByoTechniqueChoice['technique']
  readonly statedFormat?: ByoStatedFormat | undefined
  readonly requestTopK?: number | undefined
  readonly requiresEffortNone: boolean
  readonly minOutputTokens: number
  readonly maxOutputTokens: number
  readonly messages: ByoOllamaChatRequest['messages']
  readonly ollama?: ByoOllamaChatRequest | undefined
}

export interface ByoRequestPort {
  complete(request: ByoCompletionRequest, signal: AbortSignal): Promise<unknown>
}

export interface ByoJudgeDeps {
  /** Caller increments on every binding change, including A → B → A. */
  readonly generation: () => number
  readonly log?: CoreLogger | undefined
  /** Shared lazy model text: yes/no, one choice letter or one score digit. */
  readonly logprobWording: JudgePromptWording
  /** Shared bounded JSON ceiling; captured minimums can raise it. */
  readonly statedOutputTokens: number
  readonly client: ByoProviderClient
  readonly record: () => ModelCapabilityRecord
  readonly capability: () => JudgeCapability
  /** `same` must be the chat model. `separate` stays labelled separate. */
  readonly source: 'same' | 'separate'
  readonly chat: () => ByoChatBinding
  readonly pricing: () => ModelPricing
  readonly consent: () => ByoConsent
  readonly confidential: () => boolean
  /** The chat model's own confidential rule. Separate sources never send. */
  readonly confidentialPolicy: () => 'allow' | 'refuse'
  readonly measureTokens: (text: string) => number
  readonly transport: ByoRequestPort
  /** D78's ledger. Priced calls reserve on it; this module has no store. */
  readonly ledger?: JudgeDailyLedger | undefined
  /** Held consent or any other wait. Price and consent are read again after. */
  readonly afterWait?: (() => Promise<void>) | undefined
  readonly now: () => number
}

export interface ByoJudge {
  run(request: JudgeRequest, signal?: AbortSignal): Promise<JudgeOutcome>
}

interface Snapshot {
  readonly generation: number
  readonly record: ModelCapabilityRecord
  readonly capability: JudgeCapability
  readonly pricing: ModelPricing
  readonly auth: ProviderIdentity['auth']
  readonly providerId: string
  readonly modelId: string
  readonly endpoint: string
  readonly version: string
  readonly format: ProviderIdentity['format']
  readonly isLocal: boolean
  readonly confidential: boolean
  readonly policy: 'allow' | 'refuse'
  readonly chatProviderId: string
  readonly chatModelId: string
  readonly chatEndpoint: string
  readonly fingerprint: string
  readonly consentState: ByoConsent['state']
  readonly consentEpoch: string
  readonly consentExpiresAtMs: number
  readonly consentPrice: string
  readonly keyDigest: string
  readonly captureId: string
  readonly logprobs: JudgeCapability['logprobs']
}

const noAnswer = (
  reason: Extract<JudgeOutcome, { outcome: 'no-answer' }>['reason'],
): JudgeOutcome => ({
  outcome: 'no-answer',
  reason,
})

/** Stable price identity. An invalid card is unpriced, never a zero rate. */
export function byoPriceFingerprint(pricing: ModelPricing): string {
  if (pricing.kind !== 'priced') return pricing.kind
  if (!isValidPriceCard(pricing.card)) return 'unpriced'
  const card = pricing.card
  return JSON.stringify({
    kind: 'priced',
    source: card.source,
    input: card.input,
    output: card.output,
    cachedInput: card.cachedInput,
    cacheWrite: card.cacheWrite,
    cacheWrite1h: card.cacheWrite1h,
    request: card.request,
    image: card.image,
    longContextTier:
      card.longContextTier === undefined
        ? undefined
        : {
            fromTokens: card.longContextTier.fromTokens,
            input: card.longContextTier.input,
            output: card.longContextTier.output,
            cachedInput: card.longContextTier.cachedInput,
            cacheWrite: card.longContextTier.cacheWrite,
            cacheWrite1h: card.longContextTier.cacheWrite1h,
          },
  })
}

function wireBytes(value: unknown): number {
  const body: unknown = JSON.stringify(value)
  return new TextEncoder().encode(typeof body === 'string' ? body : '').length
}

function stateText(state: JudgeRequest['state']): string {
  return typeof state === 'string' ? state : JSON.stringify(state)
}

function keysOf(question: JudgeQuestion): string[] {
  if (question.type === 'noul') return ['true', 'false']
  return question.type === 'choice'
    ? Object.keys(question.criteria).toSorted(
        (left, right) => judgeOptionIndex(left) - judgeOptionIndex(right),
      )
    : question.criteria.map((_, index) => String(index))
}

function promptQuestion(
  id: string,
  question: JudgeQuestion,
): {
  readonly id: string
  readonly kind: JudgeQuestion['type']
  readonly text: string
  readonly options?: readonly string[]
} {
  if (question.type === 'noul') return { id, kind: 'noul', text: question.instructions }
  if (question.type === 'choice') {
    return {
      id,
      kind: 'choice',
      text: question.instructions,
      options: keysOf(question).map((key) => question.criteria[key] ?? ''),
    }
  }
  return { id, kind: 'score', text: question.instructions, options: question.criteria }
}

/** One redaction owner for strings and property names in judged data. */
function redactedValue(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value)
  if (Array.isArray(value)) return value.map((item: unknown) => redactedValue(item))
  return value === null || typeof value !== 'object'
    ? value
    : Object.fromEntries(
        Object.entries(value).map(([key, item]) => [redactSecrets(key), redactedValue(item)]),
      )
}

function cacheDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function messagesOf(batch: JudgePromptBatch): ByoOllamaChatRequest['messages'] {
  return [
    { role: 'system', content: redactSecrets(batch.system) },
    { role: 'user', content: redactSecrets(batch.user) },
  ]
}

function ollamaBody(
  model: string,
  choice: ByoTechniqueChoice,
  messages: ByoOllamaChatRequest['messages'],
  maxOutputTokens: number,
): ByoOllamaChatRequest {
  const body: ByoOllamaChatRequest = {
    model,
    stream: false,
    think: false,
    messages,
    options: { num_predict: maxOutputTokens, temperature: 0 },
  }
  if (choice.technique === 'stated') return body
  if (choice.requestTopK === undefined) {
    throw new TypeError('logprob judge request is missing its captured top-k')
  }
  return { ...body, logprobs: true, top_logprobs: choice.requestTopK }
}

function completionRequest(
  snapshot: Snapshot,
  choice: ByoTechniqueChoice,
  batch: JudgePromptBatch,
  maxOutputTokens: number,
): ByoCompletionRequest {
  const messages = messagesOf(batch)
  const request: ByoCompletionRequest = {
    providerId: snapshot.providerId,
    endpoint: snapshot.endpoint,
    format: snapshot.format,
    model: snapshot.modelId,
    technique: choice.technique,
    ...(choice.statedFormat !== undefined && { statedFormat: choice.statedFormat }),
    ...(choice.requestTopK !== undefined && { requestTopK: choice.requestTopK }),
    requiresEffortNone: choice.requiresEffortNone,
    minOutputTokens: choice.minOutputTokens,
    maxOutputTokens,
    messages,
  }
  return snapshot.format === 'ollama'
    ? { ...request, ollama: ollamaBody(snapshot.modelId, choice, messages, maxOutputTokens) }
    : request
}

function reservationUsd(
  pricing: ModelPricing,
  inputTokens: number,
  outputTokens: number,
): UsdAmount | 'unpriced' {
  if (pricing.kind === 'local' || pricing.kind === 'plan') return Usd.from(0).toAmount()
  if (pricing.kind !== 'priced' || !isValidPriceCard(pricing.card)) return 'unpriced'
  const usd = reserveRequestAmount(pricing.card, { inputTokens, outputTokens })
  return nonnegativeUsdSchema.safeParse(usd).success ? usd : 'unpriced'
}

function isRefusal(value: JudgeLedgerClaim | JudgeOutcome): value is JudgeOutcome {
  return 'outcome' in value
}

/** Read again after an await. A direct `signal.aborted` check narrows to false. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

async function refund(claim: JudgeLedgerClaim): Promise<void> {
  await claim.settle(Usd.from(0).toAmount())
}

function freeClaim(): JudgeLedgerClaim {
  let isClosed = false
  return {
    claimId: 'local',
    reservedUsd: Usd.from(0).toAmount(),
    check(): void {
      if (isClosed) throw new Error('free judge claim is closed')
    },
    settle(): Promise<void> {
      isClosed = true
      return Promise.resolve()
    },
  }
}

async function settleSent(
  claim: JudgeLedgerClaim,
  usage: ByoUsage,
  pricing: ModelPricing,
  log: CoreLogger | undefined,
): Promise<UsdAmount | undefined> {
  const settled =
    pricing.kind === 'priced'
      ? settleUsageAmount(pricing.card, {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        })
      : Usd.from(0).toAmount()
  if (settled === undefined) return undefined
  try {
    await claim.settle(settled)
  } catch (error: unknown) {
    log?.warn(`Provider settlement failed: ${failureForLog(error)}`)
    return undefined
  }
  return settled
}

function answerBody(question: JudgeQuestion, material: AnswerMaterial): Record<string, unknown> {
  const keys = keysOf(question)
  const probabilities = Object.fromEntries(
    keys.map((key, index) => [key, material.probabilities[index] ?? 0]),
  )
  if (question.type === 'noul') {
    return { type: 'noul', noul: probabilities['true'], probabilities }
  }
  const confidence = entropyConfidence(material.probabilities)
  if (question.type === 'choice') {
    let winner = 0
    for (let index = 1; index < material.probabilities.length; index += 1) {
      const next = material.probabilities[index] ?? 0
      if (next > (material.probabilities[winner] ?? 0)) winner = index
    }
    return { type: 'choice', choice: keys[winner], confidence, probabilities }
  }
  let score = 0
  for (let index = 0; index < material.probabilities.length; index += 1) {
    score += (material.probabilities[index] ?? 0) * index
  }
  return {
    type: 'score',
    score,
    confidence,
    probabilities,
    legend: Object.fromEntries(question.criteria.map((level, index) => [String(index), level])),
  }
}

/** One in-process judge over the injected client. Results are memory-only. */
export function createByoJudge(deps: ByoJudgeDeps): ByoJudge {
  const cache = new Map<string, JudgeOutcome>()
  const measured = (text: string): number => {
    const tokens = deps.measureTokens(text)
    if (!Number.isSafeInteger(tokens) || tokens < 0) {
      throw new TypeError('judge token measurement must be a nonnegative integer')
    }
    return tokens
  }

  if (!Number.isSafeInteger(deps.statedOutputTokens) || deps.statedOutputTokens <= 1) {
    throw new RangeError('stated judge output needs a bounded JSON allowance')
  }
  let keyDigest = ''
  let cacheBinding = ''

  function readSnapshot(): Snapshot | JudgeOutcome {
    const generation = deps.generation()
    const record = structuredClone(deps.record())
    const capability = structuredClone(deps.capability())
    const client = { ...deps.client.provider }
    const chat = { ...deps.chat() }
    const pricing = structuredClone(deps.pricing())
    const consent = { ...deps.consent() }
    const isConfidential = deps.confidential()
    const policy = deps.confidentialPolicy()
    const version = record.identity.servedVersion ?? capability.modelVersion
    if (
      !Number.isSafeInteger(generation) ||
      generation < 0 ||
      generation !== deps.generation() ||
      record.identity.provider !== client.id ||
      record.identity.format !== client.format ||
      record.identity.nativeModel !== capability.model ||
      capability.providerId !== client.id ||
      capability.endpoint !== client.origin ||
      capability.modelVersion !== version ||
      [client.id, client.origin, capability.model].some((value) => redactSecrets(value) !== value)
    ) {
      cache.clear()
      cacheBinding = ''
      return noAnswer('capability-unavailable')
    }
    return {
      generation,
      record,
      capability,
      pricing,
      auth: client.auth,
      providerId: client.id,
      modelId: capability.model,
      endpoint: client.origin,
      version,
      format: client.format,
      isLocal: client.isLocal,
      confidential: isConfidential,
      policy,
      chatProviderId: chat.providerId,
      chatModelId: chat.modelId,
      chatEndpoint: chat.endpoint,
      fingerprint: byoPriceFingerprint(pricing),
      consentState: consent.state,
      consentEpoch: consent.epoch,
      consentExpiresAtMs: consent.expiresAtMs,
      consentPrice: consent.priceFingerprint,
      keyDigest: client.auth === 'none' ? 'no-auth' : keyDigest,
      captureId: capability.captureId,
      logprobs: capability.logprobs,
    }
  }

  function observe(current: Snapshot): void {
    const binding = cacheDigest(current)
    if (binding !== cacheBinding) cache.clear()
    cacheBinding = binding
  }

  async function snapshot(): Promise<Snapshot | JudgeOutcome> {
    const before = readSnapshot()
    if ('outcome' in before) return before
    observe(before)
    let digest = 'no-auth'
    if (before.auth !== 'none') {
      try {
        digest = await deps.client.currentKeyDigest()
      } catch (error: unknown) {
        deps.log?.warn(`Provider key digest failed: ${failureForLog(error)}`)
        digest = ''
      }
    }
    // The awaited key read is itself a wait. Re-read every synchronous field
    // before accepting its digest; caller generation also catches ABA switches.
    const after = readSnapshot()
    if ('outcome' in after) return after
    const changed = rebound(before, after, before.pricing.kind === 'priced', false)
    if (changed !== undefined) {
      observe(after)
      return changed
    }
    keyDigest = digest
    const current = { ...after, keyDigest: digest }
    observe(current)
    return current
  }

  function consentBlock(current: Snapshot, isPriced: boolean): JudgeOutcome | undefined {
    if (!isPriced) return undefined
    if (current.consentState === 'declined') return noAnswer('consent-declined')
    return current.consentState !== 'granted' ||
      current.consentPrice !== current.fingerprint ||
      deps.now() >= current.consentExpiresAtMs
      ? noAnswer('consent-needed')
      : undefined
  }

  function rebound(
    before: Snapshot,
    current: Snapshot,
    isPriced: boolean,
    shouldCheckKey = true,
  ): JudgeOutcome | undefined {
    if (
      current.generation !== before.generation ||
      current.auth !== before.auth ||
      current.isLocal !== before.isLocal ||
      JSON.stringify(current.record) !== JSON.stringify(before.record) ||
      JSON.stringify(current.capability) !== JSON.stringify(before.capability) ||
      current.providerId !== before.providerId ||
      current.modelId !== before.modelId ||
      current.endpoint !== before.endpoint ||
      current.version !== before.version ||
      current.format !== before.format ||
      current.chatProviderId !== before.chatProviderId ||
      current.chatModelId !== before.chatModelId ||
      current.chatEndpoint !== before.chatEndpoint ||
      current.captureId !== before.captureId ||
      JSON.stringify(current.logprobs) !== JSON.stringify(before.logprobs)
    ) {
      return noAnswer('capability-unavailable')
    }
    if (current.confidential !== before.confidential || current.policy !== before.policy) {
      return noAnswer('confidential-refused')
    }
    if (
      shouldCheckKey &&
      (current.keyDigest.length === 0 || current.keyDigest !== before.keyDigest)
    )
      return noAnswer('source-unavailable')
    if (current.fingerprint === 'unpriced') return noAnswer('unpriced')
    return current.fingerprint !== before.fingerprint ||
      current.consentEpoch !== before.consentEpoch ||
      current.consentExpiresAtMs !== before.consentExpiresAtMs ||
      current.consentPrice !== before.consentPrice
      ? noAnswer('consent-needed')
      : consentBlock(current, isPriced)
  }

  function opened(before: Snapshot): JudgeOutcome | undefined {
    if (before.confidential && (deps.source === 'separate' || before.policy !== 'allow')) {
      return noAnswer('confidential-refused')
    }
    if (before.keyDigest.length === 0) return noAnswer('source-unavailable')
    return deps.source === 'same' &&
      (before.chatModelId !== before.modelId ||
        before.chatProviderId !== before.providerId ||
        before.chatEndpoint !== before.endpoint)
      ? noAnswer('capability-unavailable')
      : undefined
  }

  function currentBlock(before: Snapshot, signal: AbortSignal): JudgeOutcome | undefined {
    const current = readSnapshot()
    if ('outcome' in current) return current
    observe(current)
    return isAborted(signal)
      ? noAnswer('cancelled')
      : rebound(before, current, before.pricing.kind === 'priced')
  }

  async function reserve(
    usd: UsdAmount,
    before: Snapshot,
    signal: AbortSignal,
  ): Promise<JudgeLedgerClaim | JudgeOutcome> {
    const blocked = currentBlock(before, signal)
    if (blocked !== undefined) return blocked
    if (!isPositiveUsd(usd)) return freeClaim()
    const ledger = deps.ledger
    if (ledger === undefined) return noAnswer('over-budget')
    try {
      const remaining = await ledger.remainingUsd()
      const moved = currentBlock(before, signal)
      if (moved !== undefined) return moved
      if (remaining !== undefined && compareUsdAmounts(usd, remaining) > 0)
        return noAnswer('over-budget')
      const claim = await ledger.reserve(usd)
      const changed = currentBlock(before, signal)
      if (changed !== undefined) {
        if (claim !== undefined) await refund(claim)
        return changed
      }
      // No daily limit set: the ledger records nothing and the call rides
      // unbilled, like a free claim.
      if (claim === undefined) return freeClaim()
      if (claim.claimId.length === 0 || compareUsdAmounts(claim.reservedUsd, usd) !== 0) {
        await refund(claim)
        return noAnswer('source-unavailable')
      }
      return claim
    } catch (error: unknown) {
      deps.log?.warn(`Provider reservation failed: ${failureForLog(error)}`)
      return noAnswer('source-unavailable')
    }
  }

  async function send(
    wire: ByoCompletionRequest,
    claim: JudgeLedgerClaim,
    before: Snapshot,
    signal: AbortSignal,
  ): Promise<JudgeOutcome | { readonly response: unknown }> {
    const fresh = await snapshot()
    const blocked =
      'outcome' in fresh
        ? fresh
        : (rebound(before, fresh, before.pricing.kind === 'priced') ?? currentBlock(before, signal))
    if (blocked !== undefined) {
      await refund(claim)
      return blocked
    }
    try {
      // No await between the synchronous binding/claim fences and dispatch.
      claim.check()
      const dispatchMoved = currentBlock(before, signal)
      if (dispatchMoved !== undefined) {
        await refund(claim)
        return dispatchMoved
      }
    } catch (error: unknown) {
      deps.log?.warn(`Provider claim check failed: ${failureForLog(error)}`)
      await refund(claim)
      return noAnswer('source-unavailable')
    }
    try {
      return { response: await deps.transport.complete(wire, signal) }
    } catch (error: unknown) {
      deps.log?.warn(`Provider transport failed: ${failureForLog(error)}`)
      return noAnswer('engine-failure')
    }
  }

  return {
    async run(request, signal = new AbortController().signal): Promise<JudgeOutcome> {
      const parsed = judgeRequestSchema.safeParse(request)
      if (!parsed.success) return noAnswer('engine-failure')
      const initial = await snapshot()
      if ('outcome' in initial) return initial
      const first: Snapshot = initial
      const blocked = opened(first)
      if (blocked !== undefined) return blocked
      const active = currentBlock(first, signal)
      if (active !== undefined) return active
      const safeParsed = judgeRequestSchema.safeParse({
        state: redactedValue(parsed.data.state),
        questions: Object.fromEntries(
          Object.entries(parsed.data.questions).map(([id, question]) => [
            id,
            redactedValue(question),
          ]),
        ),
      })
      if (!safeParsed.success) return noAnswer('engine-failure')
      const safe = safeParsed.data
      const questions = Object.entries(safe.questions)
      const context = Math.min(
        first.record.limits.contextTokens ?? Infinity,
        first.capability.contextWindowTokens,
        JUDGE_MAX_STATE_TOKENS,
      )
      function planCall(id: string, question: JudgeQuestion, choice: ByoTechniqueChoice) {
        const outputRoom =
          choice.technique === 'stated'
            ? Math.max(deps.statedOutputTokens, choice.minOutputTokens)
            : choice.minOutputTokens
        if (outputRoom >= context) return noAnswer('over-context')
        if (
          first.record.output.maxTokens !== undefined &&
          outputRoom > first.record.output.maxTokens
        )
          return noAnswer('capability-unavailable')
        const rawWording =
          choice.technique === 'stated' ? judgePromptWording() : deps.logprobWording
        const plan = planJudgeBatches({
          stateText: stateText(safe.state),
          questions: [promptQuestion(id, question)],
          wording: {
            ...rawWording,
            systemInstruction: redactSecrets(rawWording.systemInstruction),
          },
          maxQuestionsPerBatch: 1,
          contextTokenLimit: context - outputRoom,
          measureTokens: (text) => measured(redactSecrets(text)),
        })
        if (plan.refused !== undefined) return noAnswer('over-context')
        const batch = plan.batches[0]
        if (batch?.questionIds[0] !== id) throw new TypeError('judge batch dropped a question')
        const wire = completionRequest(first, choice, batch, outputRoom)
        if (wireBytes(wire.ollama ?? wire) > JUDGE_MAX_BODY_BYTES) return noAnswer('over-context')
        const inputTokens =
          measured(wire.messages[0]?.content ?? '') + measured(wire.messages[1]?.content ?? '')
        const reserved = reservationUsd(first.pricing, inputTokens, outputRoom)
        return reserved === 'unpriced'
          ? noAnswer('unpriced')
          : { id, question, choice, wire, reserved }
      }
      const planned = []
      for (const [id, question] of questions) {
        const decision = chooseByoTechnique(first.record, first.capability, question.type)
        if (decision.outcome !== 'chosen') return decision
        const item = planCall(id, question, decision.choice)
        if ('outcome' in item) return item
        planned.push(item)
      }
      const isPriced = first.pricing.kind === 'priced'
      const consent = consentBlock(first, isPriced)
      if (consent !== undefined) return consent
      // Keys retain neither judged content nor question ids or credential digest.
      const cacheKey = cacheDigest({ binding: cacheBinding, request: safe })
      const cached = cache.get(cacheKey)
      if (cached !== undefined) return currentBlock(first, signal) ?? cached

      const answers: Record<string, unknown> = {}
      const muse: Record<
        string,
        {
          source: 'same' | 'separate'
          technique: AnswerMaterial['technique']
          model: string
          label: ReturnType<typeof labelForTechnique>
          confidence: number
          partial: boolean
          reservedCostUsd: UsdAmount
          settledCostUsd: UsdAmount
        }
      > = {}
      let inputTokens = 0
      let outputTokens = 0
      for (const item of planned) {
        const beforeSend = await snapshot()
        if ('outcome' in beforeSend) return beforeSend
        const moved = rebound(first, beforeSend, isPriced) ?? currentBlock(first, signal)
        if (moved !== undefined) return moved
        const claim = await reserve(item.reserved, first, signal)
        if (isRefusal(claim)) return claim
        const reservedMoved = currentBlock(first, signal)
        if (reservedMoved !== undefined) {
          await refund(claim)
          return reservedMoved
        }
        try {
          if (deps.afterWait !== undefined) await deps.afterWait()
        } catch (error: unknown) {
          deps.log?.warn(`Provider wait failed: ${failureForLog(error)}`)
          await refund(claim)
          return noAnswer('engine-failure')
        }
        const waited = currentBlock(first, signal)
        if (waited !== undefined) {
          await refund(claim)
          return waited
        }
        const sent = await send(item.wire, claim, first, signal)
        if ('outcome' in sent) return sent
        const responseBlock = currentBlock(first, signal)
        const decoded = decodeByoResponse(sent.response, {
          model: first.modelId,
          technique: item.choice.technique,
          kind: item.question.type,
          optionCount: keysOf(item.question).length,
          top1Floor: JUDGE_TOP1_MIN_PROB,
        })
        // No parsed usage: the sent call stays a liability. Do not settle zero.
        if (decoded.outcome === 'failure') return noAnswer('engine-failure')
        const settledFirst = await settleSent(claim, decoded.usage, first.pricing, deps.log)
        const settlementBlock = currentBlock(first, signal)
        const completed = await snapshot()
        const stale =
          responseBlock ??
          settlementBlock ??
          ('outcome' in completed
            ? completed
            : (rebound(first, completed, isPriced) ?? currentBlock(first, signal)))
        if (stale !== undefined) return stale
        let reserved = claim.reservedUsd
        let settled = settledFirst
        let material = decoded.outcome === 'answer' ? decoded.material : undefined
        let used = decoded.usage
        if (decoded.outcome === 'fallback') {
          const format = item.choice.statedFormat
          if (format === undefined || settledFirst === undefined) return noAnswer('engine-failure')
          const statedChoice: ByoTechniqueChoice = {
            technique: 'stated',
            logprobs: item.choice.logprobs,
            statedFormat: format,
            requiresEffortNone: false,
            minOutputTokens: item.choice.minOutputTokens,
          }
          const fallback = planCall(item.id, item.question, statedChoice)
          if ('outcome' in fallback) return fallback
          const statedClaim = await reserve(fallback.reserved, first, signal)
          if (isRefusal(statedClaim)) return statedClaim
          const statedSent = await send(fallback.wire, statedClaim, first, signal)
          if ('outcome' in statedSent) return statedSent
          const fallbackResponseBlock = currentBlock(first, signal)
          const stated = decodeByoResponse(statedSent.response, {
            model: first.modelId,
            technique: 'stated',
            kind: item.question.type,
            optionCount: keysOf(item.question).length,
            top1Floor: JUDGE_TOP1_MIN_PROB,
          })
          // The stated call was sent. A body we cannot read stays a liability.
          if (stated.outcome !== 'answer') return noAnswer('engine-failure')
          const statedSettled = await settleSent(statedClaim, stated.usage, first.pricing, deps.log)
          if (statedSettled === undefined) return noAnswer('engine-failure')
          const fallbackSettlementBlock = currentBlock(first, signal)
          const finished = await snapshot()
          const staleFallback =
            fallbackResponseBlock ??
            fallbackSettlementBlock ??
            ('outcome' in finished
              ? finished
              : (rebound(first, finished, isPriced) ?? currentBlock(first, signal)))
          if (staleFallback !== undefined) return staleFallback
          reserved = sumUsd(reserved, statedClaim.reservedUsd)
          settled = sumUsd(settledFirst, statedSettled)
          material = stated.material
          used = {
            inputTokens: used.inputTokens + stated.usage.inputTokens,
            outputTokens: used.outputTokens + stated.usage.outputTokens,
          }
        }
        if (material === undefined || settled === undefined) return noAnswer('engine-failure')
        inputTokens += used.inputTokens
        outputTokens += used.outputTokens
        answers[item.id] = answerBody(item.question, material)
        muse[item.id] = {
          source: deps.source,
          technique: material.technique,
          model: first.modelId,
          label: labelForTechnique(material.technique),
          confidence: entropyConfidence(material.probabilities),
          partial: material.partial,
          reservedCostUsd: reserved,
          settledCostUsd: settled,
        }
      }
      const parsedResult = judgeResultSchema.safeParse({
        model: first.modelId,
        answers,
        muse,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      })
      if (!parsedResult.success) return noAnswer('engine-failure')
      const outcome: JudgeOutcome = { outcome: 'answered', result: parsedResult.data }
      const finalBlock = currentBlock(first, signal)
      if (finalBlock !== undefined) return finalBlock
      if (cache.size >= JUDGE_RESULT_CACHE_MAX && !cache.has(cacheKey)) {
        const oldest = cache.keys().next()
        if (!oldest.done) cache.delete(oldest.value)
      }
      cache.set(cacheKey, outcome)
      return outcome
    },
  }
}
