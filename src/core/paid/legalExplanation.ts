import { Usd, type UsdAmount } from '../../shared/usd'
// Optional paid prose over technical findings. The deterministic scan never
// calls this port. Editors inject the same D78 consent, claim and HTTP client.
import {
  DEFAULT_MODEL_ID,
  LEGAL_EXPLANATION_MAX_INPUT_CHARS,
  LEGAL_EXPLANATION_CACHE_KEY,
  LEGAL_EXPLANATION_FINDING_ID,
  LEGAL_EXPLANATION_MAX_OUTPUT_TOKENS,
  LEGAL_EXPLANATION_TIMEOUT_MS,
  LEGAL_EXPLANATION_MODEL_TEXT,
  LEGAL_TEXT_MAX_CHARS,
  MODEL_API_EFFORT_OFF,
  UI_TEXT,
} from '../../shared/constants'
import { legalScanResultSchema, type LegalScanResult } from '../../shared/legal'
import type { PaidFeatureGate, PaidUsage } from '../paid/paidFeatures'
import type { PaidUseConsent } from '../paid/paidConsent'
import type { ModelApiClientDeps, ResponseAttemptGuard } from '../backends/modelapi/client'
import { estimateInput, requestParts } from '../backends/modelapi/sessionBudget'
import {
  streamEventSchema,
  type CreateResponseBody,
  type StreamEvent,
  type Usage,
} from '../backends/modelapi/schemas'
import { estimateCostUsd } from '../usage/insights'
import { parseSpdxExpression } from '../legal/spdx'
import { scrubLegalText } from '../legal/files'

export interface LegalExplanationDeps {
  readonly gate: Pick<PaidFeatureGate, 'isOn'>
  readonly consent: Pick<PaidUseConsent, 'allows'>
  readonly capUsd: () => UsdAmount
  readonly reserve: NonNullable<ModelApiClientDeps['reservePaidRequest']>
  readonly keyDigest: () => Promise<string | undefined>
  readonly usage: Pick<PaidUsage, 'add' | 'addLegalExplanationUsage'>
  readonly stream: (
    body: CreateResponseBody,
    signal: AbortSignal,
    guard: ResponseAttemptGuard,
  ) => AsyncIterable<StreamEvent>
}

function explanationPart(event: StreamEvent): {
  readonly text: string
  readonly usage?: Usage | undefined
  readonly isCompleted?: boolean
  readonly isFailed?: boolean
} {
  switch (event.type) {
    case 'response.output_text.delta': {
      return { text: event.delta }
    }
    case 'response.completed': {
      return { text: '', usage: event.response.usage ?? undefined, isCompleted: true }
    }
    case 'response.failed':
    case 'response.incomplete': {
      return { text: '', usage: event.response.usage ?? undefined, isFailed: true }
    }
    case 'error': {
      return { text: '', isFailed: true }
    }
    default: {
      return { text: '' }
    }
  }
}

export async function explainLegal(
  result: LegalScanResult,
  deps: LegalExplanationDeps,
  signal: AbortSignal,
): Promise<string> {
  const active = AbortSignal.any([signal, AbortSignal.timeout(LEGAL_EXPLANATION_TIMEOUT_MS)])
  active.throwIfAborted()
  const modelId = DEFAULT_MODEL_ID
  if (
    !deps.gate.isOn('legalExplanation') ||
    !(await deps.consent.allows({ feature: 'legalExplanation', modelId }))
  )
    throw new Error(UI_TEXT.legalExplainUnavailable)
  active.throwIfAborted()
  const digest = await deps.keyDigest()
  if (digest === undefined || !deps.gate.isOn('legalExplanation'))
    throw new Error(UI_TEXT.legalExplainUnavailable)
  const parsed = legalScanResultSchema.parse(result)
  const facts = parsed.findings.map((finding) => {
    if (!LEGAL_EXPLANATION_FINDING_ID.test(finding.id))
      throw new Error(UI_TEXT.legalExplainUnavailable)
    const license = parseSpdxExpression(finding.licenseExpression ?? '')
    return {
      id: finding.id,
      category: finding.category,
      severity: finding.severity,
      licenses: license.ok
        ? license.licenses.flatMap((entry) =>
            entry.canonicalId === undefined ? [] : [entry.canonicalId],
          )
        : [],
    }
  })
  const input = JSON.stringify(facts)
  if (input.length > LEGAL_EXPLANATION_MAX_INPUT_CHARS)
    throw new Error(UI_TEXT.legalExplainUnavailable)
  const body: CreateResponseBody = {
    model: modelId,
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: input }] }],
    instructions: LEGAL_EXPLANATION_MODEL_TEXT.legalExplanationInstructions,
    tools: [],
    tool_choice: 'auto',
    reasoning: { effort: MODEL_API_EFFORT_OFF, summary: 'auto' },
    stream: true,
    store: false,
    include: [],
    max_output_tokens: LEGAL_EXPLANATION_MAX_OUTPUT_TOKENS,
    prompt_cache_key: LEGAL_EXPLANATION_CACHE_KEY,
    prompt_cache_retention: 'in_memory',
  }
  const estimated = estimateInput(requestParts(body), undefined).inputTokens
  const claim = await deps.reserve(body, 'legalExplanation', estimated, active)
  if (claim === undefined) throw new Error(UI_TEXT.legalExplainUnavailable)
  const dispatch = { isSent: false }
  let usage: Usage | undefined
  let text = ''
  let isCompleted = false
  const guard: ResponseAttemptGuard = Object.assign(
    (key: string | undefined) => {
      active.throwIfAborted()
      if (key !== digest || !deps.gate.isOn('legalExplanation'))
        throw new Error(UI_TEXT.legalExplainUnavailable)
      claim.check(deps.capUsd())
    },
    {
      onRequestStarted: () => {
        dispatch.isSent = true
        deps.usage.add('legalExplanation', 1)
      },
    },
  )
  try {
    for await (const value of deps.stream(body, active, guard)) {
      active.throwIfAborted()
      const part = explanationPart(streamEventSchema.parse(value))
      text += part.text
      usage = part.usage ?? usage
      if (part.isCompleted === true) isCompleted = true
      if (part.isFailed === true || text.length > LEGAL_TEXT_MAX_CHARS)
        throw new Error(UI_TEXT.legalExplainUnavailable)
    }
    active.throwIfAborted()
    if (!isCompleted || usage === undefined || text.trim() === '')
      throw new Error(UI_TEXT.legalExplainUnavailable)
    return scrubLegalText(text)
  } finally {
    const tokens =
      usage === undefined
        ? undefined
        : {
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0,
          }
    if (tokens !== undefined) deps.usage.addLegalExplanationUsage(modelId, tokens)
    const unreportedCost = dispatch.isSent ? claim.reservedUsd : Usd.from(0).toAmount()
    await claim.settle(
      tokens === undefined ? unreportedCost : estimateCostUsd(tokens, modelId),
      dispatch.isSent && tokens === undefined,
    )
  }
}
