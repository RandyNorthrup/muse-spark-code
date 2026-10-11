import { Usd, type UsdAmount } from '../../src/shared/usd'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWindowJudge } from '../../src/host/judge/judgeEntry'
import { createPaidFeatures } from '../../src/host/paid/paidHost'
import { metaSideCallFormats } from '../../src/core/backends/modelapi/modelCapabilities'
import { estimateCostUsd } from '../../src/core/usage/insights'
import { M106_CAPTURED_META_MODEL, UI_TEXT } from '../../src/shared/constants'
import { memento } from './helpers/memento'
import { confirmModal } from './helpers/vscodeViews'
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
    capUsd: () => Usd.from(capUsd).toAmount(),
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
    expect(await daily().judgeLedger.remainingUsd()).toBe(Usd.from(4.99).toAmount())
    const judge = await daily().judgeLedger.reserve(Usd.from(0.1).toAmount())
    expect(await daily().judgeLedger.remainingUsd()).toBe(Usd.from(4.89).toAmount())
    await image.settle(Usd.from(0).toAmount())
    await judge.settle(Usd.from(0).toAmount())
    expect(await daily().judgeLedger.remainingUsd()).toBe(Usd.from(5).toAmount())
  })

  it('shares claims, settlement, retained liability, restart lookup and live cap/day checks', async () => {
    const first = daily()
    const claim = await first.judgeLedger.reserve(Usd.from(0.2).toAmount())
    expect(await daily().judgeLedger.remainingUsd()).toBe(Usd.from(4.8).toAmount())
    const day = await first.latestDay()
    expect(day).toMatchObject({
      day: '2026-10-5',
      capUsd: Usd.from(5).toAmount(),
      spentUsd: Usd.from(0.2).toAmount(),
    })
    expect(await daily().lookupByClaimId(day.day, claim.claimId)).toMatchObject({
      reservedUsd: Usd.from(0.2).toAmount(),
    })
    await claim.settle(Usd.from(0.1).toAmount())
    await claim.settle(Usd.from(0.1).toAmount())
    await expect(claim.settle(Usd.from(0.2).toAmount())).rejects.toThrow()
    expect(await daily().lookupByClaimId(day.day, claim.claimId)).toMatchObject({
      settledUsd: Usd.from(0.1).toAmount(),
    })
    const refund = await first.judgeLedger.reserve(Usd.from(0.2).toAmount())
    await refund.settle(Usd.from(0).toAmount())
    expect(await daily().judgeLedger.remainingUsd()).toBe(Usd.from(4.9).toAmount())
    const retained = await first.judgeLedger.reserve(Usd.from(0.4).toAmount())
    expect(await daily().judgeLedger.remainingUsd()).toBe(Usd.from(4.5).toAmount())
    await expect(daily(0.5).judgeLedger.reserve(Usd.from(0.1).toAmount())).rejects.toThrow()
    state.now = new Date(2026, 9, 6, 12).getTime()
    expect(() => {
      retained.check()
    }).toThrow()
    expect(await daily().judgeLedger.remainingUsd()).toBe(Usd.from(5).toAmount())
    expect(await daily().lookupByClaimId(day.day, retained.claimId)).not.toHaveProperty(
      'settledUsd',
    )
  })

  it.each(['complete', 'missing', 'nonsend'] as const)(
    'uses exactly one shared reservation and captured verdict format through the production Judge: %s receipt',
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
        sideCallFormats: metaSideCallFormats,
      })
      const session = await host.startSession({
        workspaceRoot: '/ws',
        modelId: receipt === 'complete' ? M106_CAPTURED_META_MODEL : 'muse-spark-1.3',
        approvalMode: 'allowAll',
      })
      const settledCost = estimateCostUsd(
        { inputTokens: 10, outputTokens: 2, cachedTokens: 1 },
        session.modelId,
      )
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
        const observed = vi.fn(async (cost: UsdAmount) => {
          owned = await shared.judgeLedger.reserve(Usd.from(cost).toAmount())
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
            const claim = await shared.judgeLedger.reserve(Usd.from(cost).toAmount())
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
        else if (receipt === 'complete') {
          vi.mocked(confirmModal).mockImplementationOnce((_title, _options, ...items) =>
            Promise.resolve(items[0]),
          )
          const paid = createPaidFeatures({
            globalState: memento(new Map()),
            workspaceState: memento(new Map()),
            isSettingOn: () => false,
            isJudgeOn: () => true,
            isKeyStored: () => true,
            canRememberPaidUse: () => false,
            dailyBudgetUsd: shared.capUsd,
            log,
          })
          const judge = createWindowJudge(
            {
              engine: () => 'same',
              context: () => ({
                backend: 'modelApi',
                modelId: session.modelId,
                ownerId: 'window',
                contextLimit: 100_000,
                confidential: false,
              }),
              readSettingsText: () => undefined,
              startSession: () => Promise.reject(new Error('Subscription source unexpected')),
              modelApi: () => connection,
              ledger: { remainingUsd: shared.judgeLedger.remainingUsd, reserve: observed },
              paid,
              emit: () => undefined,
              status: () => undefined,
              notice: () => undefined,
              log,
            },
            UI_TEXT,
            'en',
          )
          try {
            judge.start(
              {
                backend: 'modelApi',
                sessionId: session.sessionId,
                turnId: submitted.turnId,
                tool: 'shell',
                args: { command: 'npm test' },
              },
              'Current action',
            )
            await vi.waitFor(async () => {
              expect(owned).toBeDefined()
              if (owned === undefined) throw new Error('Judge claim absent')
              const settled = await shared.lookupByClaimId('2026-10-5', owned.claimId)
              expect(settled.settledUsd).toBe(settledCost)
            })
            expect(api.responseBodies()[1]?.['text']).toMatchObject({
              format: { name: 'judge_answer', strict: true },
            })
            expect(confirmModal).toHaveBeenCalledWith(
              expect.any(String),
              expect.objectContaining({ detail: expect.stringContaining('$5.00') }),
              expect.anything(),
              expect.anything(),
            )
          } finally {
            judge.dispose()
          }
        } else await transport.send(body, new AbortController().signal)
        expect(observed).toHaveBeenCalledTimes(1)
        expect(automatic).not.toHaveBeenCalled()
        const claim = owned
        if (claim === undefined) throw new Error('Judge claim absent')
        const snapshot = await shared.lookupByClaimId('2026-10-5', claim.claimId)
        if (receipt === 'missing') expect(snapshot).not.toHaveProperty('settledUsd')
        else
          expect(snapshot.settledUsd).toBe(
            receipt === 'complete' ? settledCost : Usd.from(0).toAmount(),
          )
        const latest = await daily().latestDay()
        expect(latest.spentUsd).toBe(
          receipt === 'missing'
            ? claim.reservedUsd
            : (snapshot.settledUsd ?? Usd.from(0).toAmount()),
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
