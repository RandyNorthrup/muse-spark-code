// Shared rig for the production SystemOne (C) side: the pinned M95
// transport's two seams (resolution and the pinned send), M95's stored
// credential record, and a daily ledger. The key is a fixture string and
// the answer is the recorded OpenRouter shape; nothing reaches a network.
import * as z from 'zod/mini'
import type { SystemOneResolve, SystemOneSend } from '../../../src/core/judge/systemone/side'
import type { PinnedTarget } from '../../../src/core/web/webFetch'
import type { UsdAmount } from '../../../src/shared/usd'
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
  options: {
    address?: string
    answer?: unknown
    noul?: number
    /** Held after the request is written (an HTTP wait). */
    hold?: Promise<unknown>
    /** Held inside name resolution (a DNS wait). */
    resolveHold?: Promise<unknown>
    /** Connected and written, then the response fails (a reset). */
    failAfterConnect?: boolean
  } = {},
) {
  const sent: {
    readonly target: PinnedTarget
    readonly body: string
    readonly headers: Readonly<Record<string, string>>
  }[] = []
  const withdrawn: PinnedTarget[] = []
  const resolves: string[][] = []
  const closes: number[] = []
  const resolve: SystemOneResolve = async () => {
    resolves.push([options.address ?? SYSTEMONE_ADDRESS])
    await options.resolveHold
    return [options.address ?? SYSTEMONE_ADDRESS]
  }
  const send: SystemOneSend = async (target, body, headers, _signal, onConnected, shouldWrite) => {
    // As the pinned transport: nothing is written unless the fence holds once connected.
    if (!shouldWrite()) {
      withdrawn.push(target)
      throw new Error('withdrawn before sending')
    }
    onConnected()
    sent.push({ target, body, headers })
    await options.hold
    if (options.failAfterConnect === true) throw new Error('connection reset after sending')
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
      close: () => {
        closes.push(1)
      },
    }
  }
  return { resolve, send, sent, withdrawn, resolves, closes }
}

/** M95's stored record for OpenRouter, bound to its origin (fixture key). */
export function storedOpenRouterKey(hasKey = true, hold?: () => Promise<unknown> | undefined) {
  return async (providerId: string) => {
    await hold?.()
    return hasKey && providerId === 'openrouter'
      ? JSON.stringify({
          v: 1,
          auth: 'apiKey',
          origin: 'https://openrouter.ai',
          secret: 'fixture-not-a-key',
        })
      : undefined
  }
}

/** The same record looked up by its SecretStorage / OS store name. */
export function storedSecretByName(hasKey = true) {
  const byProvider = storedOpenRouterKey(hasKey)
  return (name: string) =>
    name.startsWith(PROVIDER_SECRET_PREFIX)
      ? byProvider(name.slice(PROVIDER_SECRET_PREFIX.length))
      : Promise.resolve(undefined)
}

/**
A daily ledger recording every reservation and settlement in exact
amounts. Its claims' live `check` throws once `stop()` was called, as
D78's does after the Stop marker, a day change or a reduced cap.
*/
export function recordingDailyLedger(hold?: Promise<unknown>, stopAfterChecks?: number) {
  const reserveCalls: { costUsd: UsdAmount }[] = []
  const reserved: UsdAmount[] = []
  const settled: (UsdAmount | undefined)[] = []
  const state = { isStopped: false, checks: 0 }
  const reserve = async (costUsd: UsdAmount, _signal: AbortSignal) => {
    reserveCalls.push({ costUsd })
    reserved.push(costUsd)
    await hold
    return {
      estimateUsd: costUsd,
      check: () => {
        state.checks += 1
        if (stopAfterChecks !== undefined && state.checks > stopAfterChecks) state.isStopped = true
        if (state.isStopped) throw new Error('daily budget stopped')
      },
      settle: (actualUsd: UsdAmount | undefined) => {
        settled.push(actualUsd)
        return Promise.resolve()
      },
    }
  }
  return {
    reserve,
    reserveCalls,
    reserved,
    settled,
    stop: () => {
      state.isStopped = true
    },
    checks: () => state.checks,
  }
}
