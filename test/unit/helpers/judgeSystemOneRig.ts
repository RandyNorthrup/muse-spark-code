// Shared fakes for the production SystemOne (C) side: the pinned M95
// transport's two seams (resolution and the pinned send), M95's stored
// credential record, and a daily ledger. The key is a fixture string and
// the answer is the recorded OpenRouter shape; nothing reaches a network.
import { vi } from 'vitest'
import * as z from 'zod/mini'
import type { SystemOneResolve, SystemOneSend } from '../../../src/core/judge/systemone/side'
import type { PinnedTarget } from '../../../src/core/web/webFetch'
import { PROVIDER_SECRET_PREFIX } from '../../../src/shared/constants'
import captures from '../fixtures/judgeSystemOneCaptures.json'

export const SYSTEMONE_ROUTE = 'openrouter-jev:typesafe/jev-1.13'
/** A public address standing in for openrouter.ai's DNS answer. */
export const SYSTEMONE_ADDRESS = '104.18.2.115'

/** The recorded OpenRouter answer, answering each asked id with this probability. */
export function systemOneAnswer(noul = 0.95, ids: readonly string[] = ['healthy']): unknown {
  const response = captures.openrouterRecordedNoul.response
  return {
    ...response,
    answers: Object.fromEntries(
      ids.map((id) => [id, { type: 'noul', noul, probabilities: { true: noul, false: 1 - noul } }]),
    ),
  }
}

const bodySchema = z.looseObject({ questions: z.record(z.string(), z.unknown()) })

function questionsOf(body: string): Record<string, unknown> {
  const parsed = bodySchema.safeParse(JSON.parse(body))
  return parsed.success ? parsed.data.questions : {}
}

/** The pinned transport's seams: one public answer, a recorded send. */
export function systemOneTransport(
  options: { address?: string; answer?: unknown; noul?: number; hold?: Promise<unknown> } = {},
) {
  const sent: {
    readonly target: PinnedTarget
    readonly body: string
    readonly headers: Readonly<Record<string, string>>
  }[] = []
  const resolve = vi.fn<SystemOneResolve>(() =>
    Promise.resolve([options.address ?? SYSTEMONE_ADDRESS]),
  )
  const send = vi.fn<SystemOneSend>(async (target, body, headers, _signal, onConnected) => {
    onConnected()
    sent.push({ target, body, headers })
    await options.hold
    const bytes = new TextEncoder().encode(
      JSON.stringify(
        options.answer ?? systemOneAnswer(options.noul ?? 0.95, Object.keys(questionsOf(body))),
      ),
    )
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: (async function* () {
        await Promise.resolve()
        yield bytes
      })(),
      close: vi.fn(),
    }
  })
  return { resolve, send, sent }
}

/** M95's stored record for OpenRouter, bound to its origin (fixture key). */
export function storedOpenRouterKey(hasKey = true) {
  return vi.fn((providerId: string) =>
    Promise.resolve(
      hasKey && providerId === 'openrouter'
        ? JSON.stringify({
            v: 1,
            auth: 'apiKey',
            origin: 'https://openrouter.ai',
            secret: 'fixture-not-a-key',
          })
        : undefined,
    ),
  )
}

/** The same record looked up by its SecretStorage / OS store name. */
export function storedSecretByName(hasKey = true) {
  const byProvider = storedOpenRouterKey(hasKey)
  return vi.fn((name: string) =>
    name.startsWith(PROVIDER_SECRET_PREFIX)
      ? byProvider(name.slice(PROVIDER_SECRET_PREFIX.length))
      : Promise.resolve(undefined),
  )
}

/** A daily ledger recording every reservation and settlement. */
export function recordingDailyLedger(hold?: Promise<unknown>) {
  const reserved: number[] = []
  const settled: number[] = []
  const reserve = vi.fn(async (costUsd: number) => {
    reserved.push(costUsd)
    await hold
    return {
      claimId: `claim-${String(reserved.length)}`,
      reservedUsd: costUsd,
      check: vi.fn(),
      settle: vi.fn((actualUsd: number) => {
        settled.push(actualUsd)
        return Promise.resolve()
      }),
    }
  })
  return { reserve, reserved, settled, remainingUsd: () => Promise.resolve(1) }
}
