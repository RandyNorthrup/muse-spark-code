// Shared phase-2 rigs: the wiring assembly tests and the review-fix
// regressions build the same verified bindings, embedding transports and
// phase-2 windows from one helper instead of copying each other.
import { EN } from '../../../src/shared/l10n/en'
import { PaidUseConsent, paidUseQuestion } from '../../../src/core/paid/paidConsent'
import { vi } from 'vitest'
import { createPaidFeatures } from '../../../src/host/paid/paidHost'
import { createWindowJudge } from '../../../src/host/judge/judgeEntry'
import type {
  JudgePlanRuntime,
  JudgeRuntimeBinding,
  JudgeRuntimeDeps,
} from '../../../src/core/judge/runtime'
import type { JudgeEntryParts } from '../../../src/core/judge/entries'
import { embeddingHeadDigest, weightEnvelopeFor } from '../../../src/core/judge/embedding/schema'
import { fitEmbeddingHead } from '../../../src/core/judge/embedding/fit'
import { FakeLogOutputChannel } from './fakes'
import { wiringFixture } from './judgeWiring'
import { REQUEST } from '../judgeCliFixtures'
import { memento } from './memento'
import {
  confidentVectors,
  embeddingLimits,
  embeddingSource,
  groupedDataset,
} from '../judgeEmbeddingFixtures'

/** The stdin body for an `ask` or MCP judge call over the same request. */
export function surfaceInput(action: string): string {
  return action === 'ask'
    ? JSON.stringify(REQUEST)
    : `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'judge', arguments: REQUEST } })}\n`
}

/** A verified binding for the requested engine, without an embedding transport. */
export function phase2Binding(engine = 'both') {
  const fixture = wiringFixture()
  const value: JudgeRuntimeBinding = {
    ...fixture,
    context: { ...fixture.context, engine },
    separateVerified: true,
    separateLocality: 'verified-local',
  }
  return { ...fixture, value }
}

/** A command binding with a capable embedding transport, paid or verified-local. */
export function embeddedBinding(locality: 'same-provider' | 'verified-local', consentDelayMs = 0) {
  const fixture = phase2Binding('same')
  const value: JudgeRuntimeBinding = { ...fixture.value, attemptCostUsd: () => 0 }
  const dataset = groupedDataset(200)
  dataset.identity.endpoint = 'fixture://offline'
  dataset.identity.providerId = 'fixture-provider'
  const fitted = fitEmbeddingHead(
    dataset,
    { optedIn: true },
    { ...embeddingLimits, maxSamples: 1000, minLabels: 200 },
  )
  if (!('version' in fitted)) throw new Error(fitted.reason)
  const head = { ...fitted, evidence: 'independent' as const }
  head.digest = embeddingHeadDigest(head)
  const built = embeddingSource({
    locality,
    endpoint: 'fixture://offline',
    uncachedCostUsd: locality === 'verified-local' ? 0 : 0.0002,
    embed: () => Promise.resolve(confidentVectors),
  })
  const prompts: { title: string; detail: string }[] = []
  const consent = new PaidUseConsent({
    isOn: () => true,
    canRemember: () => false,
    readGrants: () => new Set(),
    writeGrants: () => Promise.resolve(),
    log: new FakeLogOutputChannel(),
    ask: async (request) => {
      prompts.push(await paidUseQuestion(request))
      if (consentDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, consentDelayMs))
      return 'once'
    },
  })
  const allowsPaidUse = vi.fn((request: Parameters<typeof consent.allows>[0]) =>
    consent.allows(request),
  )
  const claims: number[] = []
  const ledger = {
    remainingUsd: () => Promise.resolve(1),
    reserve: (cost: number) => {
      claims.push(cost)
      return Promise.resolve({
        claimId: `claim-${String(claims.length)}`,
        reservedUsd: cost,
        check: vi.fn(),
        settle: vi.fn(() => Promise.resolve()),
      })
    },
  }
  const manifest = {
    identity: head.identity,
    evidence: 'independent',
    rows: dataset.samples.map((sample) => ({
      id: sample.id,
      labelId: sample.labelId,
      taskGroup: sample.taskGroup,
      repositoryGroup: sample.repositoryGroup,
      split: sample.split,
      labelSource: sample.labelSource,
      label: sample.label === 1,
      embeddingAttempts: 1,
      fallbackAttempts: 1,
      ...(sample.split === 'evaluation' && {
        fullProbability: 0.7,
        embeddingProbability: sample.label === 1 ? 0.9 : 0.1,
      }),
    })),
  }
  const embedding = {
    capable: true,
    source: built.source,
    localOptedIn: true,
    head,
    weights: weightEnvelopeFor(head),
    manifest,
    fitVersion: head.identity.fitVersion,
    gate: { isOn: () => true },
    isEnabled: () => true,
    priceFingerprint: 'fixture-verified-price',
    consentEpoch: () => 'epoch-1',
    allowsPaidUse,
    dailyBudgetUsd: () => 1,
    ledger,
  }
  return {
    ...fixture,
    value: { ...value, embedding },
    embedding,
    embed: built.embed,
    allowsPaidUse,
    claims,
    prompts,
  }
}

export interface Phase2Window {
  readonly binding: (action: JudgeEntryParts) => JudgeRuntimeBinding | undefined
  readonly createRuntime: (deps: JudgeRuntimeDeps) => Promise<JudgePlanRuntime>
}

/** A phase-2 window over the Muse Code backend with the given binding factory. */
export function phase2Window(overrides: Phase2Window) {
  const paid = createPaidFeatures({
    globalState: memento(new Map()),
    workspaceState: memento(new Map()),
    isSettingOn: () => false,
    isJudgeOn: () => true,
    isKeyStored: () => false,
    canRememberPaidUse: () => false,
    log: new FakeLogOutputChannel(),
  })
  return createWindowJudge(
    {
      phase2: overrides,
      engine: () => 'both',
      context: () => ({
        backend: 'museCode',
        modelId: 'chosen',
        ownerId: 'owner-1',
        contextLimit: 32_000,
        confidential: false,
      }),
      readSettingsText: () => undefined,
      startSession: vi.fn(),
      modelApi: () => undefined,
      paid,
      emit: vi.fn(),
      status: vi.fn(),
      notice: vi.fn(),
      log: new FakeLogOutputChannel(),
    },
    EN,
    'en',
  )
}
