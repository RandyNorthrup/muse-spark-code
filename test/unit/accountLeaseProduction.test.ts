import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseUsd } from '../../src/shared/accountUsd'
import { PAID_PRICES_USD } from '../../src/shared/constants'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import type { ResponseAttemptGuard } from '../../src/core/backends/modelapi/client'
import {
  activeAccountBilling,
  type AccountLeaseReporter,
  type AccountRequestLease,
} from '../../src/core/accounts/requestWriter'
import type { AccountPoolRequest } from '../../src/core/accounts/pool'
import { FAKE_MODEL_API_BASE_URL, type FakeModelApi } from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { startWatchedSession } from './helpers/sessionTurns'
import { memoryToolIo } from './helpers/fakeToolIo'
import { FakeLogOutputChannel } from './helpers/fakes'
import { writerRig } from './helpers/accounts/writer'

// The vault origin must equal the origin the host acquires with (production:
// both are the Model API origin; here both are the fake origin).
const ORIGIN = new URL(FAKE_MODEL_API_BASE_URL).origin

const rigs: { liveLeases: () => number }[] = []

function productionRig(
  configure?: (api: FakeModelApi) => void,
  paid: {
    readonly allowsPaidUse?: (bill: (string | undefined)[]) => Promise<boolean>
    readonly paidFeatures?: (feature: string) => boolean
  } = {},
) {
  const t = writerRig(ORIGIN, configure)
  rigs.push(t)
  const billed: (string | undefined)[] = []
  const asked: boolean[] = []
  const allowsPaidUse = vi.fn(
    async (_question: unknown, requiresAsking: boolean): Promise<boolean> => {
      asked.push(requiresAsking)
      billed.push(activeAccountBilling()?.account)
      return await (paid.allowsPaidUse?.(billed) ?? Promise.resolve(true))
    },
  )
  const log = new FakeLogOutputChannel()
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({
      client: t.client,
      workspaceRoot: '/ws',
      io: memoryToolIo({}, '/ws'),
      log,
    }),
    isPaidFeatureOn: (feature: string) => paid.paidFeatures?.(feature) ?? false,
    allowsPaidUse,
    accountRequests: {
      acquire: t.writer.acquire.bind(t.writer),
      within: t.writer.within.bind(t.writer),
      current: t.writer.current.bind(t.writer),
      currentWithoutNext: t.writer.currentWithoutNext.bind(t.writer),
      withinRequest: t.writer.withinRequest.bind(t.writer),
      // The vault origin is the fake origin here (production: both are the
      // Model API origin), so the helper origin is remapped to it.
      paidClient: (
        client: Parameters<typeof t.writer.paidClient>[0],
        request: Parameters<typeof t.writer.paidClient>[1],
        _origin: string,
        paid: Parameters<typeof t.writer.paidClient>[3],
        requiresAsking: boolean,
        allows: Parameters<typeof t.writer.paidClient>[5],
      ) => t.writer.paidClient(client, request, ORIGIN, paid, requiresAsking, allows),
      // The helper and Judge lease origins are remapped like paidClient.
      withLease: Object.assign(
        <T>(
          request: AccountPoolRequest,
          _origin: string,
          run: (lease: AccountRequestLease, report: AccountLeaseReporter) => Promise<T>,
        ): Promise<T> => t.writer.withLease(request, ORIGIN, run),
        <T>(
          request: AccountPoolRequest,
          _origin: string,
          run: (
            lease: AccountRequestLease,
            report: AccountLeaseReporter,
          ) => AsyncGenerator<T, void, unknown>,
        ): AsyncGenerator<T, void, unknown> => t.writer.withLease(request, ORIGIN, run),
      ),
    },
  })
  return { ...t, host, log, allowsPaidUse, billed, asked }
}

// A lease leaked anywhere in this suite fails here.
afterEach(() => {
  // Splice first: a failing assertion must not carry its rigs into the next test.
  const pending = rigs.splice(0)
  for (const t of pending) expect(t.liveLeases()).toBe(0)
})

function leaseDigest(account: string): string {
  return createHash('sha256').update(`fake-only-${account}`).digest('hex')
}

// One scripted image tool call plus its answered image: every image turn
// below stages through this so the gate sees no clones.
function scriptImageTurn(
  api: FakeModelApi,
  path: string,
  prompt: string,
  callId: string,
  closing: string,
): void {
  api.script(
    {
      calls: [{ name: 'generate_image', arguments: JSON.stringify({ path, prompt }), callId }],
    },
    { text: closing },
  )
  api.images.push({ count: 1 })
}

const IMAGE_PAID = { paidFeatures: (feature: string) => feature === 'imageGeneration' }

describe('leases in the production composition', () => {
  it('retries a main-turn 429 without Retry-After on the same lease', async () => {
    const t = productionRig((api) => {
      api.script(
        { httpError: { status: 429 } },
        { text: 'recovered', usage: { input: 10, output: 2 } },
      )
    })
    const { session, turnDone } = await startWatchedSession(t.host, '/ws', 'allowAll')
    t.pool.use('conversation', session.sessionId, 'a', () => true)
    await session.sendTurn([{ type: 'text', text: 'Hello' }])
    await turnDone()
    // The retry is a second send on the same lease: two posts, one claim,
    // settled with the recovered usage instead of a bare vendor limit.
    expect(t.api.responseBodies()).toHaveLength(2)
    expect(t.claims).toHaveLength(1)
    expect(t.claims[0]?.account).toBe('a')
    expect(t.claims[0]?.actual).not.toBeNull()
  })

  it('asks image spending consent through askPaidUse, once, under the lease payer', async () => {
    const t = productionRig((api) => {
      scriptImageTurn(api, 'plain.png', 'a red cat', 'img-1', 'done')
    }, IMAGE_PAID)
    const { session, turnDone } = await startWatchedSession(t.host, '/ws', 'allowAll')
    t.pool.use('conversation', session.sessionId, 'a', () => true)
    await session.sendTurn([{ type: 'text', text: 'Draw a cat' }])
    await turnDone()
    expect(t.api.imageBodies()).toHaveLength(1)
    // Asked once, for this request, under the lease's own payer: a direct
    // question in askPaidUse would bill no account.
    expect(t.allowsPaidUse).toHaveBeenCalledOnce()
    expect(t.billed).toEqual(['a'])
    expect(t.asked).toEqual([false])
    // The turn's two model requests and the image helper each own a lease;
    // the image claim settles the image price on the lease payer.
    expect(t.claims).toHaveLength(3)
    expect(t.claims[1]?.account).toBe('a')
    expect(t.claims[1]?.estimate).toMatchObject({ inputTokens: 0, outputTokens: 0, requests: 1 })
    expect(t.claims[1]?.actual).toEqual(parseUsd(PAID_PRICES_USD.imageGeneration))
  })

  it('carries each image request its own forced-ask flag', async () => {
    const t = productionRig((api) => {
      scriptImageTurn(api, '.git/x.png', 'protected', 'img-1', 'first')
    }, IMAGE_PAID)
    const { session, turnDone } = await startWatchedSession(t.host, '/ws', 'allowAll')
    t.pool.use('conversation', session.sessionId, 'a', () => true)
    await session.sendTurn([{ type: 'text', text: 'Draw first' }])
    await turnDone()
    scriptImageTurn(t.api, 'plain.png', 'plain', 'img-2', 'second')
    await session.sendTurn([{ type: 'text', text: 'Draw second' }])
    await turnDone()
    // The protected target forces its own question; the plain one that
    // follows answers only for itself. No shared field carries over.
    expect(t.asked).toEqual([true, false])
    expect(t.billed).toEqual(['a', 'a'])
  })

  it('ends a waiting image spending question on Stop and releases its lease', async () => {
    const { promise: gate, resolve: releaseAsk } = Promise.withResolvers<unknown>()
    const t = productionRig(
      (api) => {
        scriptImageTurn(api, 'plain.png', 'a red cat', 'img-1', 'done')
      },
      {
        paidFeatures: (feature) => feature === 'imageGeneration',
        allowsPaidUse: async () => {
          await gate
          return true
        },
      },
    )
    const { session, turnDone } = await startWatchedSession(t.host, '/ws', 'allowAll')
    t.pool.use('conversation', session.sessionId, 'a', () => true)
    const turn = session.sendTurn([{ type: 'text', text: 'Draw a cat' }])
    await vi.waitFor(() => {
      expect(t.allowsPaidUse).toHaveBeenCalled()
    })
    await session.cancel()
    // The Stop ends the wait itself: the turn completes while the spending
    // question is still unanswered, without waiting for the gate.
    const completed = (async () => {
      await turnDone()
      return true
    })()
    const expired = new Promise<boolean>((resolve) => {
      setTimeout(() => {
        resolve(false)
      }, 2000)
    })
    const isFinished = await Promise.race([completed, expired])
    expect(isFinished).toBe(true)
    releaseAsk(undefined)
    await turn
    // No image was bought for an unanswered question; the image lease settled.
    expect(t.api.imageBodies()).toHaveLength(0)
    expect(t.claims).toHaveLength(2)
    expect(t.claims[1]?.actual).toBe(0n)
  })

  it('pays the Judge on the turn payer, leaves nothing, and checks the used key', async () => {
    const t = productionRig()
    const held = Promise.withResolvers<unknown>()
    t.api.script(
      { text: 'Main answer', hold: held.promise },
      { text: 'judge says yes', usage: { input: 10, output: 2 } },
    )
    const { session, turnDone } = await startWatchedSession(t.host, '/ws', 'allowAll')
    t.pool.use('conversation', session.sessionId, 'a', () => true)
    const submitted = await session.sendTurn([{ type: 'text', text: 'Hello' }])
    await vi.waitFor(() => {
      expect(t.api.responseBodies()).toHaveLength(1)
    })
    // A switch to B queued while the turn runs on A: the Judge still pays A.
    t.pool.useNext('conversation', session.sessionId, 'b', () => true)
    const connection = session.judgeConnection(submitted.turnId, 'stale-connection-key')
    const main = connection.source.readMainBody()
    const seen: (string | undefined)[] = []
    const guard: ResponseAttemptGuard = Object.assign((keyDigest: string | undefined) => {
      seen.push(keyDigest)
    }, {})
    const response = await connection.transport.send(
      { ...main, tools: [], input: [], instructions: 'Judge this action.' },
      new AbortController().signal,
      guard,
    )
    expect(response.text).toContain('judge says yes')
    // The admission check saw the key this send actually used: the stale
    // connection constant would have arrived here before the fix.
    expect(seen).toEqual([leaseDigest('a')])
    // Pinned to the turn payer A despite the queued switch to B: two claims,
    // both on A, the Judge's settled with its usage.
    expect(t.claims).toHaveLength(2)
    expect(t.claims.map((claim) => claim.account)).toEqual(['a', 'a'])
    expect(t.claims[1]?.actual).not.toBeNull()
    // Transient: no persisted selection per send, and the conversation's own
    // choice is untouched by the side request.
    expect(t.selectionWrites.filter((entry) => entry.owner.includes(':judge:'))).toHaveLength(0)
    expect(t.pool.current('conversation', session.sessionId)).toBe('b')
    held.resolve(undefined)
    await turnDone()
  })
})
