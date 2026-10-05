import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPaidDailyBudget } from '../../src/host/paid/paidDailyBudget'
import type { JudgeLedgerClaim } from '../../src/core/judge/admission'
import { admittedModelApiJudge } from '../../src/host/judge/judgeTransport'
import { JudgeUsageRows } from '../../src/host/judge/judgeUsage'
import { PaidUsage } from '../../src/core/paid/paidFeatures'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { fakeModelApi, fakeModelApiClientSettings } from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { FakeLogOutputChannel } from './helpers/fakes'
import { memoryToolIo } from './helpers/fakeToolIo'
import { removeFolder } from './helpers/temporaryFolders'
import { watchSessionTurns } from './helpers/sessionTurns'

const state = { directory: '', now: new Date(2026, 9, 5, 12).getTime() }
beforeEach(async () => {
  state.directory = await mkdtemp(path.join(tmpdir(), 'muse-judge-daily-'))
  state.now = new Date(2026, 9, 5, 12).getTime()
})
afterEach(async () => {
  await removeFolder(state.directory)
})
function daily(capUsd = 5) {
  return createPaidDailyBudget({
    directory: state.directory,
    now: () => state.now,
    capUsd: () => capUsd,
    sleep: () => Promise.resolve(),
    isModelApi: () => true,
  })
}

describe('Judge on the real D78 shared journal', () => {
  it('counts another window’s image reservation against Judge’s remaining budget', async () => {
    const image = await daily().reserve(
      {
        model: 'muse-image-1.0',
        prompt: 'Tree',
        n: 1,
        size: '1024x1024',
        response_format: 'b64_json',
        output_format: 'png',
      },
      'imageGeneration',
    )
    if (image === undefined) throw new Error('Image claim absent')
    expect(await daily().judgeLedger.remainingUsd()).toBe(4.99)
    const judge = await daily().judgeLedger.reserve(0.1)
    expect(await daily().judgeLedger.remainingUsd()).toBe(4.89)
    await image.settle(0)
    await judge.settle(0)
    expect(await daily().judgeLedger.remainingUsd()).toBe(5)
  })

  it('shares claims, settlement, retained liability, restart lookup and live cap/day checks', async () => {
    const first = daily()
    const claim = await first.judgeLedger.reserve(0.2)
    expect(await daily().judgeLedger.remainingUsd()).toBe(4.8)
    const day = await first.latestDay()
    expect(day).toMatchObject({ day: '2026-10-5', capUsd: 5, spentUsd: 0.2 })
    expect(await daily().lookupByClaimId(day.day, claim.claimId)).toMatchObject({
      reservedUsd: 0.2,
    })
    await claim.settle(0.1)
    await claim.settle(0.1)
    await expect(claim.settle(0.2)).rejects.toThrow()
    expect(await daily().lookupByClaimId(day.day, claim.claimId)).toMatchObject({ settledUsd: 0.1 })
    const refund = await first.judgeLedger.reserve(0.2)
    await refund.settle(0)
    expect(await daily().judgeLedger.remainingUsd()).toBe(4.9)
    const retained = await first.judgeLedger.reserve(0.4)
    expect(await daily().judgeLedger.remainingUsd()).toBe(4.5)
    await expect(daily(0.5).judgeLedger.reserve(0.1)).rejects.toThrow()
    state.now = new Date(2026, 9, 6, 12).getTime()
    expect(() => {
      retained.check()
    }).toThrow()
    expect(await daily().judgeLedger.remainingUsd()).toBe(5)
    expect(await daily().lookupByClaimId(day.day, retained.claimId)).not.toHaveProperty(
      'settledUsd',
    )
  })

  it.each(['complete', 'missing', 'nonsend'] as const)(
    'uses exactly one shared reservation through the actual Judge source and client: %s receipt',
    async (receipt) => {
      const shared = daily()
      const api = fakeModelApi()
      const held = Promise.withResolvers<undefined>()
      const log = new FakeLogOutputChannel()
      const automatic = vi.fn(shared.reserve)
      const client = new ModelApiClient({
        fetch: api.fetch,
        ...fakeModelApiClientSettings(log),
        reservePaidRequest: automatic,
      })
      const host = new ModelApiHost({
        ...fakeModelApiHostDeps({ client, workspaceRoot: '/ws', io: memoryToolIo({}, '/ws'), log }),
      })
      const session = await host.startSession({
        workspaceRoot: '/ws',
        modelId: 'muse-spark-1.3',
        approvalMode: 'allowAll',
      })
      const watched = watchSessionTurns(session)
      api.script(
        { text: 'Main answer', hold: held.promise },
        {
          text: '{"answer":"yes","confidence":99}',
          usage: { input: 10, output: 2, cached: 1 },
          ...(receipt === 'missing' && { omitUsage: true }),
        },
      )
      try {
        const submitted = await session.sendTurn([{ type: 'text', text: 'Hello' }])
        await vi.waitFor(() => {
          expect(api.responseBodies()).toHaveLength(1)
        })
        const connection = host.judgeConnection(session.sessionId, submitted.turnId)
        if (connection === undefined) throw new Error('Judge source absent')
        let owned: JudgeLedgerClaim | undefined
        const observed = vi.fn(async (cost: number) => {
          owned = await shared.judgeLedger.reserve(cost)
          return owned
        })
        const rows = new JudgeUsageRows({
          billing: 'modelApi',
          usage: new PaidUsage(log),
          emit: () => undefined,
        })
        const signal = new AbortController()
        const transport = admittedModelApiJudge({
          connection,
          ledger: { remainingUsd: shared.judgeLedger.remainingUsd, reserve: observed },
          rows,
          binding: () => ({
            backend: 'modelApi',
            ownerId: 'window',
            modelId: session.modelId,
            engine: 'same',
            confidential: false,
            consent: 'granted',
          }),
          signal: signal.signal,
          contextLimit: 100_000,
          turnId: submitted.turnId,
        })
        if (receipt === 'nonsend')
          observed.mockImplementationOnce(async (cost) => {
            const claim = await shared.judgeLedger.reserve(cost)
            owned = claim
            signal.abort()
            return claim
          })
        const body = {
          ...connection.source.readMainBody(),
          tools: [],
          input: [],
          instructions: 'Judge',
          max_output_tokens: 100,
        }
        if (receipt === 'nonsend')
          await expect(transport.send(body, new AbortController().signal)).rejects.toThrow()
        else await transport.send(body, new AbortController().signal)
        expect(observed).toHaveBeenCalledTimes(1)
        expect(automatic).not.toHaveBeenCalled()
        const claim = owned
        if (claim === undefined) throw new Error('Judge claim absent')
        const snapshot = await shared.lookupByClaimId('2026-10-5', claim.claimId)
        if (receipt === 'missing') expect(snapshot).not.toHaveProperty('settledUsd')
        else expect(snapshot.settledUsd).toBe(receipt === 'complete' ? 0.0000199 : 0)
        const latest = await daily().latestDay()
        expect(latest.spentUsd).toBe(
          receipt === 'missing' ? claim.reservedUsd : (snapshot.settledUsd ?? 0),
        )
        expect(api.responseBodies()).toHaveLength(receipt === 'nonsend' ? 1 : 2)
      } finally {
        held.resolve(undefined)
        await watched.turnDone()
        await host.close()
      }
    },
  )
})
