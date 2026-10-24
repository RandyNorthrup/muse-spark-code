// Shared phase-2 rigs: the wiring assembly tests and the review-fix
// regressions build the same verified bindings and embedding transports
// from one helper instead of copying each other.
import path from 'node:path'
import { Usd, type UsdAmount } from '../../../src/shared/usd'
import { createLogger } from '../../../src/host/logger'
import { judgeFeaturesLoader } from '../../../src/runtime/judge/judgeBundle'
import { PaidUseConsent, paidUseQuestion } from '../../../src/core/paid/paidConsent'
import type { PaidUseRequest } from '../../../src/shared/paid'
import type { JudgeDailyLedger } from '../../../src/core/judge/admission'
import { embeddingHeadDigest, weightEnvelopeFor } from '../../../src/core/judge/embedding/schema'
import { fitEmbeddingHead } from '../../../src/core/judge/embedding/fit'
import { collectingLogger } from './collectingLogger'
import { wiringFixture } from './judgeWiring'
import { REQUEST } from '../judgeCliFixtures'
import {
  confidentVectors,
  embeddingLimits,
  embeddingSource,
  groupedDataset,
} from '../judgeEmbeddingFixtures'

type JudgeUseRequest = Extract<PaidUseRequest, { feature: 'judge' }>

/** The shipped lazy assembly (dist/judgeP2.js) with a collecting log. */
export function shippedJudgeFeatures() {
  const messages: string[] = []
  return judgeFeaturesLoader({
    bundlePath: path.join(process.cwd(), 'dist/judgeP2.js'),
    log: createLogger(collectingLogger(messages)),
  })()
}

/** The stdin body for an `ask` or MCP judge call over the same request. */
export function surfaceInput(action: string): string {
  return action === 'ask'
    ? JSON.stringify(REQUEST)
    : `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'judge', arguments: REQUEST } })}\n`
}

/** A verified binding for the requested engine, without an embedding transport. */
export function phase2Binding(engine = 'both') {
  const fixture = wiringFixture()
  const value = {
    ...fixture,
    context: { ...fixture.context, engine },
    separateVerified: true,
    separateLocality: 'verified-local' as const,
  }
  return { ...fixture, value }
}

/**
A ledger that admits every exact-amount reservation and records it, so the
suites can say what the assembly reserved and settled. Claims check single
settlement, like the production ledger.
*/
export function recordingLedger() {
  const claims: UsdAmount[] = []
  const settled: UsdAmount[] = []
  const ledger: JudgeDailyLedger = {
    remainingUsd: () => Promise.resolve(Usd.from(1).toAmount()),
    reserve: (cost) => {
      claims.push(cost)
      let isClosed = false
      return Promise.resolve({
        claimId: `claim-${String(claims.length)}`,
        reservedUsd: cost,
        check: () => {
          if (isClosed) throw new Error('judge claim is closed')
        },
        settle: (actual) => {
          isClosed = true
          settled.push(actual)
          return Promise.resolve()
        },
      })
    },
  }
  return { ledger, claims, settled }
}

/** A command binding with a capable embedding transport, paid or verified-local. */
export function embeddedBinding(locality: 'same-provider' | 'verified-local', consentDelayMs = 0) {
  const fixture = phase2Binding('same')
  const value = { ...fixture.value, attemptCostUsd: () => 0 }
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
  const messages: string[] = []
  const consent = new PaidUseConsent({
    isOn: () => true,
    canRemember: () => false,
    readGrants: () => new Set(),
    writeGrants: () => Promise.resolve(),
    log: collectingLogger(messages),
    ask: async (request) => {
      prompts.push(await paidUseQuestion(request))
      if (consentDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, consentDelayMs))
      return 'once'
    },
  })
  // The judge's own request, so the consent answers with its boolean verdict.
  const allowsCalls: JudgeUseRequest[] = []
  const allowsPaidUse = (request: JudgeUseRequest) => {
    allowsCalls.push(request)
    return consent.allows(request)
  }
  const { ledger, claims, settled } = recordingLedger()
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
    embedCalls: built.calls,
    allowsCalls,
    claims,
    settled,
    prompts,
  }
}
