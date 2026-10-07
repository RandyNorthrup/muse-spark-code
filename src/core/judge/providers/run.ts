// Bring-your-own judge calls (M98 phase 2, lane E). One request on the
// caller's existing provider client: no second transport, no agent, no
// subprocess, and no credential leaves this module. Ollama's chat body is
// the captured request (logprobs, top_logprobs, think: false). Other formats
// carry the same decision on our seam; a codec maps it from a capture.
// No `vscode` import.

import { type ProviderIdentity } from '../../backends/modelapi/providerClient'
import { type ModelCapabilityRecord } from '../../providers/capabilityRecord'
import {
  isValidPriceCard,
  reserveRequestUsd,
  settleUsageUsd,
  type ModelPricing,
} from '../../providers/priceCard'
import {
  JUDGE_MAX_BODY_BYTES,
  JUDGE_MAX_STATE_TOKENS,
  JUDGE_TOP1_MIN_PROB,
} from '../../../shared/constants'
import { type JudgeDailyLedger, type JudgeLedgerClaim } from '../admission'
import { labelForTechnique, type AnswerMaterial } from '../judge'
import { entropyConfidence } from '../math'
import { planJudgeBatches, type JudgePromptBatch } from '../prompt'
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
  readonly messages: ByoOllamaChatRequest['messages']
  readonly ollama?: ByoOllamaChatRequest | undefined
}

export interface ByoRequestPort {
  complete(request: ByoCompletionRequest, signal: AbortSignal): Promise<unknown>
}

export interface ByoJudgeDeps {
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
  readonly keyReady: boolean
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
  return [
    'priced',
    card.source,
    card.input,
    card.output,
    card.cachedInput ?? '',
    card.cacheWrite ?? '',
    card.request ?? '',
  ].join(':')
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

function turnContent(messages: ByoOllamaChatRequest['messages'], index: number): string {
  const message = messages[index]
  if (message === undefined) {
    throw new TypeError('judge request is missing its system or user turn')
  }
  return message.content
}

function messagesOf(batch: JudgePromptBatch): ByoOllamaChatRequest['messages'] {
  return [
    { role: 'system', content: batch.system },
    { role: 'user', content: batch.user },
  ]
}

function ollamaBody(
  model: string,
  choice: ByoTechniqueChoice,
  messages: ByoOllamaChatRequest['messages'],
): ByoOllamaChatRequest {
  const body: ByoOllamaChatRequest = {
    model,
    stream: false,
    think: false,
    messages,
    options: { num_predict: choice.minOutputTokens, temperature: 0 },
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
    messages,
  }
  return snapshot.format === 'ollama'
    ? { ...request, ollama: ollamaBody(snapshot.modelId, choice, messages) }
    : request
}

function reservationUsd(
  pricing: ModelPricing,
  inputTokens: number,
  outputTokens: number,
): number | 'unpriced' {
  if (pricing.kind === 'local' || pricing.kind === 'plan') return 0
  if (pricing.kind !== 'priced' || !isValidPriceCard(pricing.card)) return 'unpriced'
  const usd = reserveRequestUsd(pricing.card, { inputTokens, outputTokens })
  return Number.isFinite(usd) && usd >= 0 ? usd : 'unpriced'
}

function isRefusal(value: JudgeLedgerClaim | JudgeOutcome): value is JudgeOutcome {
  return 'outcome' in value
}

/** Read again after an await. A direct `signal.aborted` check narrows to false. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

async function refund(claim: JudgeLedgerClaim): Promise<void> {
  await claim.settle(0)
}

function freeClaim(): JudgeLedgerClaim {
  let isClosed = false
  return {
    claimId: 'local',
    reservedUsd: 0,
    check(): void {
      if (isClosed) throw new Error('free judge claim is closed')
    },
    settle(): Promise<void> {
      isClosed = true
      return Promise.resolve()
    },
  }
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

  async function isKeyReady(): Promise<boolean> {
    if (deps.client.provider.auth === 'none') return true
    try {
      const digest = await deps.client.currentKeyDigest()
      return digest.length > 0
    } catch {
      return false
    }
  }

  async function snapshot(): Promise<Snapshot | JudgeOutcome> {
    const record = deps.record()
    const capability = deps.capability()
    const client = deps.client.provider
    const chat = deps.chat()
    const version = record.identity.servedVersion ?? capability.modelVersion
    if (
      record.identity.provider !== client.id ||
      record.identity.format !== client.format ||
      record.identity.nativeModel !== capability.model ||
      capability.providerId !== client.id ||
      capability.endpoint !== client.origin ||
      capability.modelVersion !== version
    ) {
      return noAnswer('capability-unavailable')
    }
    const consent = deps.consent()
    return {
      providerId: client.id,
      modelId: capability.model,
      endpoint: client.origin,
      version,
      format: client.format,
      isLocal: client.isLocal,
      confidential: deps.confidential(),
      policy: deps.confidentialPolicy(),
      chatProviderId: chat.providerId,
      chatModelId: chat.modelId,
      chatEndpoint: chat.endpoint,
      fingerprint: byoPriceFingerprint(deps.pricing()),
      consentState: consent.state,
      consentEpoch: consent.epoch,
      consentExpiresAtMs: consent.expiresAtMs,
      consentPrice: consent.priceFingerprint,
      keyReady: await isKeyReady(),
      captureId: capability.captureId,
      logprobs: capability.logprobs,
    }
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
  ): JudgeOutcome | undefined {
    if (
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
    if (!current.keyReady) return noAnswer('source-unavailable')
    if (current.fingerprint === 'unpriced') return noAnswer('unpriced')
    return current.fingerprint !== before.fingerprint ||
      current.consentEpoch !== before.consentEpoch ||
      current.consentPrice !== before.consentPrice
      ? noAnswer('consent-needed')
      : consentBlock(current, isPriced)
  }

  function opened(before: Snapshot): JudgeOutcome | undefined {
    if (before.confidential && (deps.source === 'separate' || before.policy !== 'allow')) {
      return noAnswer('confidential-refused')
    }
    if (!before.keyReady) return noAnswer('source-unavailable')
    return deps.source === 'same' &&
      (before.chatModelId !== before.modelId ||
        before.chatProviderId !== before.providerId ||
        before.chatEndpoint !== before.endpoint)
      ? noAnswer('capability-unavailable')
      : undefined
  }

  async function reserve(usd: number): Promise<JudgeLedgerClaim | JudgeOutcome> {
    if (usd === 0) return freeClaim()
    const ledger = deps.ledger
    if (ledger === undefined) return noAnswer('over-budget')
    try {
      const remaining = await ledger.remainingUsd()
      if (!Number.isFinite(remaining) || remaining < 0) return noAnswer('source-unavailable')
      if (usd > remaining) return noAnswer('over-budget')
      const claim = await ledger.reserve(usd)
      if (claim.claimId.length === 0 || claim.reservedUsd !== usd) {
        await claim.settle(0)
        return noAnswer('source-unavailable')
      }
      claim.check()
      return claim
    } catch {
      return noAnswer('source-unavailable')
    }
  }

  async function settleSent(claim: JudgeLedgerClaim, usage: ByoUsage): Promise<number | undefined> {
    const pricing = deps.pricing()
    if (pricing.kind !== 'priced' || !isValidPriceCard(pricing.card)) {
      await claim.settle(0)
      return 0
    }
    const settled = settleUsageUsd(pricing.card, {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    })
    if (settled === undefined) return undefined
    await claim.settle(settled)
    return settled
  }

  return {
    async run(request, signal = new AbortController().signal): Promise<JudgeOutcome> {
      const parsed = judgeRequestSchema.safeParse(request)
      if (!parsed.success) return noAnswer('engine-failure')
      const first = await snapshot()
      if ('outcome' in first) return first
      const blocked = opened(first)
      if (blocked !== undefined) return blocked
      const record = deps.record()
      const capability = deps.capability()
      const questions = Object.entries(parsed.data.questions)
      const choices: ByoTechniqueChoice[] = []
      for (const [, question] of questions) {
        const decision = chooseByoTechnique(record, capability, question.type)
        if (decision.outcome !== 'chosen') return decision
        choices.push(decision.choice)
      }
      const context = Math.min(
        record.limits.contextTokens ?? Infinity,
        capability.contextWindowTokens,
        JUDGE_MAX_STATE_TOKENS,
      )
      const outputRoom = Math.max(...choices.map((choice) => choice.minOutputTokens))
      if (outputRoom >= context) return noAnswer('over-context')
      const plan = planJudgeBatches({
        stateText: stateText(parsed.data.state),
        questions: questions.map(([id, question]) => promptQuestion(id, question)),
        wording: judgePromptWording(),
        maxQuestionsPerBatch: 1,
        contextTokenLimit: context - outputRoom,
        measureTokens: measured,
      })
      if (plan.refused !== undefined) return noAnswer('over-context')
      const planned = questions.map(([id, question], index) => {
        const batch = plan.batches[index]
        const choice = choices[index]
        if (batch === undefined || choice === undefined || batch.questionIds[0] !== id) {
          throw new TypeError('judge batch dropped a question')
        }
        const inputTokens = measured(batch.system) + measured(batch.user)
        const wire = completionRequest(first, choice, batch)
        const bytes = wireBytes(wire.ollama ?? wire)
        const reserved = reservationUsd(deps.pricing(), inputTokens, choice.minOutputTokens)
        return { id, question, choice, wire, bytes, reserved }
      })
      if (planned.some((item) => item.bytes > JUDGE_MAX_BODY_BYTES)) return noAnswer('over-context')
      if (planned.some((item) => item.reserved === 'unpriced')) return noAnswer('unpriced')
      const isPriced = planned.some((item) => item.reserved !== 'unpriced' && item.reserved > 0)
      const consent = consentBlock(first, isPriced)
      if (consent !== undefined) return consent
      const cacheKey = JSON.stringify({
        source: deps.source,
        providerId: first.providerId,
        modelId: first.modelId,
        endpoint: first.endpoint,
        version: first.version,
        confidential: first.confidential,
        fingerprint: first.fingerprint,
        consentEpoch: isPriced ? first.consentEpoch : '',
        captureId: first.captureId,
        logprobs: first.logprobs,
        request: parsed.data,
      })
      const cached = cache.get(cacheKey)
      if (cached !== undefined) return cached

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
          reservedCostUsd: number
          settledCostUsd: number
        }
      > = {}
      let inputTokens = 0
      let outputTokens = 0
      for (const item of planned) {
        const reservedUsd = item.reserved === 'unpriced' ? 0 : item.reserved
        const beforeSend = await snapshot()
        if ('outcome' in beforeSend) return beforeSend
        const moved = rebound(first, beforeSend, isPriced)
        if (moved !== undefined) return moved
        const claim = await reserve(reservedUsd)
        if (isRefusal(claim)) return claim
        try {
          if (deps.afterWait !== undefined) await deps.afterWait()
        } catch {
          await refund(claim)
          return noAnswer('engine-failure')
        }
        const after = await snapshot()
        if ('outcome' in after) {
          await refund(claim)
          return after
        }
        const changed = rebound(first, after, isPriced)
        if (changed !== undefined || isAborted(signal)) {
          await refund(claim)
          return changed ?? noAnswer('cancelled')
        }
        let response: unknown
        try {
          response = await deps.transport.complete(item.wire, signal)
        } catch {
          return noAnswer('engine-failure')
        }
        const decoded = decodeByoResponse(response, {
          model: first.modelId,
          technique: item.choice.technique,
          kind: item.question.type,
          optionCount: keysOf(item.question).length,
          top1Floor: JUDGE_TOP1_MIN_PROB,
        })
        // No parsed usage: the sent call stays a liability. Do not settle zero.
        if (decoded.outcome === 'failure') return noAnswer('engine-failure')
        const settledFirst = await settleSent(claim, decoded.usage)
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
          const statedWire = completionRequest(first, statedChoice, {
            system: turnContent(item.wire.messages, 0),
            user: turnContent(item.wire.messages, 1),
            questionIds: [item.id],
          })
          const statedClaim = await reserve(reservedUsd)
          if (isRefusal(statedClaim)) return statedClaim
          const again = await snapshot()
          if ('outcome' in again || isAborted(signal)) {
            await refund(statedClaim)
            return 'outcome' in again ? again : noAnswer('cancelled')
          }
          const movedAgain = rebound(first, again, isPriced)
          if (movedAgain !== undefined) {
            await refund(statedClaim)
            return movedAgain
          }
          let statedResponse: unknown
          try {
            statedResponse = await deps.transport.complete(statedWire, signal)
          } catch {
            return noAnswer('engine-failure')
          }
          const stated = decodeByoResponse(statedResponse, {
            model: first.modelId,
            technique: 'stated',
            kind: item.question.type,
            optionCount: keysOf(item.question).length,
            top1Floor: JUDGE_TOP1_MIN_PROB,
          })
          // The stated call was sent. A body we cannot read stays a liability.
          if (stated.outcome !== 'answer') return noAnswer('engine-failure')
          const statedSettled = await settleSent(statedClaim, stated.usage)
          if (statedSettled === undefined) return noAnswer('engine-failure')
          reserved += statedClaim.reservedUsd
          settled = settledFirst + statedSettled
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
      cache.set(cacheKey, outcome)
      return outcome
    },
  }
}
