// Shared Judge panel facts. A subscription-only report still carries a price,
// a daily budget and a needed consent so the tests fail if that path asks.

import type { JudgePanelCapability, JudgePanelFacts } from '../../src/shared/judgePanel'
import { Usd } from '../../src/shared/usd'

export function judgeCapability(
  overrides: Partial<JudgePanelCapability> = {},
): JudgePanelCapability {
  return {
    providerId: 'openai',
    model: 'gpt-test',
    logprobs: { kind: 'topk', topK: 5 },
    stated: true,
    systemone: false,
    reasoningForced: false,
    cache: true,
    ...overrides,
  }
}

export function judgeFacts(overrides: Partial<JudgePanelFacts> = {}): JudgePanelFacts {
  const providerId = overrides.providerId ?? 'openai'
  const modelId = overrides.modelId ?? 'gpt-test'
  return {
    engine: 'same',
    effectiveSource: 'same',
    providerId,
    modelId,
    technique: 'logprob',
    capability: judgeCapability({ providerId, model: modelId }),
    label: 'calibrated (logprob)',
    locality: 'not-local',
    experimental: false,
    confidential: false,
    billing: 'subscription',
    paidSourceSelected: false,
    consent: 'not-required',
    ...overrides,
  }
}

/** Muse Code, no paid source. Priced and awaiting consent, which must not ask. */
export function subscriptionFacts(): JudgePanelFacts {
  return judgeFacts({
    billing: 'subscription',
    paidSourceSelected: false,
    consent: 'needed',
    reason: 'consent-needed',
    inputPerMillion: 1,
    outputPerMillion: 4,
    dailyBudgetUsd: Usd.from(2).toAmount(),
  })
}

/** Model API first charge: price, shared budget and a grant that is still needed. */
export function modelApiFacts(overrides: Partial<JudgePanelFacts> = {}): JudgePanelFacts {
  return judgeFacts({
    billing: 'modelApi',
    paidSourceSelected: false,
    consent: 'needed',
    reason: 'consent-needed',
    inputPerMillion: 3,
    outputPerMillion: 15,
    dailyBudgetUsd: Usd.from(5).toAmount(),
    ...overrides,
  })
}
