import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createScheduleBilling,
  type ScheduleBillingPorts,
} from '../../src/host/schedules/paidBinding'
import { createPaidDailyBudget } from '../../src/host/paid/paidDailyBudget'
import { createScheduleStore } from '../../src/core/schedules/store'
import { createAuthorityStore } from '../../src/runtime/schedules/authorityStore'
import { metaResolvedModel, modelPolicyFor } from '../../src/core/backends/modelapi/modelPolicy'
import { ModelApiHost, ModelApiSession } from '../../src/core/backends/modelapi/ModelApiHost'
import { Usd } from '../../src/shared/usd'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeSchedule, fakeRunContext } from './helpers/schedules/fixtures'
import { MemoryScheduleFs } from './helpers/schedules/storage'
import { removeFolder } from './helpers/temporaryFolders'
import { memoryToolIo } from './helpers/fakeToolIo'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import { UI_TEXT } from '../../src/shared/constants'
import { formatUnit } from '../../src/shared/l10n/text'
import type { ScheduleV2 } from '../../src/shared/scheduleV2'
import type { ModelPricing } from '../../src/core/providers/priceCard'
import { createScheduleDeliveryBinding } from '../../src/host/schedules/deliveryBinding'
import { workspaceKey } from '../../src/runtime/dataFolder'
import { unattendedRun } from './helpers/schedules/unattended'
import type { AgentEvent } from '../../src/shared/agentEvents'
import type { ScheduleRunDeps } from '../../src/core/schedules/unattended'

function body(model: string, max_output_tokens = 100): CreateResponseBody {
  return {
    model,
    instructions: 'test',
    input: [],
    tools: [],
    max_output_tokens,
    stream: true,
    store: false,
    tool_choice: 'auto',
    reasoning: { effort: 'high' },
    include: [],
    prompt_cache_key: 'test',
    prompt_cache_retention: 'in_memory',
  }
}

const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) await removeFolder(folder)
})

const unpublish = () => undefined

async function fixture(
  answer: 'once' | 'always' | 'deny' = 'always',
  cap = 5,
  overrides: Partial<ScheduleV2> = {},
  pricingOverride?: ModelPricing,
) {
  const folder = mkdtempSync(path.join(tmpdir(), 'm115-billing-'))
  folders.push(folder)
  const daily = createPaidDailyBudget({
    directory: folder,
    now: Date.now,
    capUsd: () => Usd.from(cap).toAmount(),
    sleep: () => Promise.resolve(),
    isModelApi: () => true,
  })
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const host = new ModelApiHost(
    fakeModelApiHostDeps({
      client: fakeModelApiClient(api, log),
      log,
      workspaceRoot: folder,
      io: memoryToolIo({}, folder),
    }),
  )
  const session = await host.startSession({
    workspaceRoot: folder,
    modelId: 'muse-spark-1.3',
    approvalMode: 'promptUnmatched',
  })
  if (!(session instanceof ModelApiSession)) throw new Error('unexpected billing session')
  const state = {
    generation: 0,
    active: true,
    pricing: pricingOverride ?? modelPolicyFor(session.modelId).pricing,
  }
  const ask = vi.fn<ScheduleBillingPorts['ask']>(() => Promise.resolve(answer))
  const ports: ScheduleBillingPorts = {
    modelId: () => session.modelId,
    host: () =>
      Promise.resolve({
        schedulePricing: async (modelId) => ({
          ...(await host.schedulePricing(modelId)),
          pricing: state.pricing,
        }),
      }),
    generation: () => state.generation,
    capUsd: daily.capUsd,
    isActive: () => state.active,
    isOn: () => true,
    ask,
    reserve: daily.reserveSchedule,
  }
  const billing = createScheduleBilling(ports)
  const fs = new MemoryScheduleFs()
  const store = createScheduleStore(fs)
  const authority = createAuthorityStore(store, fs, 'audits.json')
  const draft = fakeSchedule({
    workspaceKey: workspaceKey(path.resolve(folder)),
    ...overrides,
    paidCapUsd: Usd.from(1).toAmount(),
    grant: { rules: [], destinationIds: [], paidCapUsd: Usd.from(1).toAmount() },
  })
  const consent = await billing.consent(draft)
  const schedule = fakeSchedule({
    ...draft,
    ...(consent !== undefined && { paidConsent: consent }),
  })
  await store.create(schedule)
  return {
    billing,
    ports,
    folder,
    ask,
    session,
    schedule,
    store,
    authority,
    daily,
    state,
    api,
    host,
  }
}

describe('editor schedule billing over the actual authority and hard ledger', () => {
  it('does not retry a final authority refusal as a network failure', async () => {
    const f = await fixture()
    try {
      const context = fakeRunContext(f.schedule)
      const paid = await f.billing.paid(f.schedule, f.session, context, f.authority)
      const checkDispatch = vi.fn(() =>
        Promise.reject(new Error(UI_TEXT.scheduleV2.messages.changedConsent)),
      )
      const { run } = unattendedRun({ context, paid: { ...paid.policy, checkDispatch } })
      const events: AgentEvent[] = []
      f.session.onEvent((event) => {
        events.push(event)
      })
      const submission = await f.session.sendScheduledTurn(
        [{ type: 'text', text: 'scheduled' }],
        run,
      )
      await vi.waitFor(() => {
        expect(
          events.some(
            (event) => event.type === 'turnCompleted' && event.turnId === submission.turnId,
          ),
        ).toBe(true)
      })
      expect(checkDispatch).toHaveBeenCalledOnce()
      expect(f.api.responseBodies()).toHaveLength(0)
      await expect(paid.cost()).resolves.toMatchObject({ usd: '0', retainedLiabilityUsd: '0' })
      const day = await f.daily.latestDay()
      expect(day.spentUsd).toBe('0')
    } finally {
      await f.host.close()
    }
  })
  it('rechecks the billing route after reservation and refunds a drifted tariff', async () => {
    const f = await fixture()
    try {
      const paid = await f.billing.paid(
        f.schedule,
        f.session,
        fakeRunContext(f.schedule),
        f.authority,
      )
      const reserve = f.ports.reserve
      f.ports.reserve = async (...args) => {
        const claim = await reserve(...args)
        if (f.state.pricing.kind !== 'priced') throw new Error('missing tariff')
        f.state.pricing = { ...f.state.pricing, card: { ...f.state.pricing.card, output: 1 } }
        return claim
      }
      await assertTariffRefusal(f, paid.policy)
      expect(f.api.responseBodies()).toHaveLength(0)
    } finally {
      await f.host.close()
    }
  })
  it('retires an existing paid claim synchronously when a direct store edit starts', async () => {
    const f = await fixture()
    try {
      const paid = await f.billing.paid(
        f.schedule,
        f.session,
        fakeRunContext(f.schedule),
        f.authority,
      )
      const claim = await paid.policy.reserve(
        body(f.session.modelId),
        undefined,
        new AbortController().signal,
      )
      const updating = f.store.update({ ...f.schedule, paused: true })
      expect(() => claim.check(Usd.from(0).toAmount())).toThrow()
      await updating
      await claim.settle(Usd.from(0).toAmount())
      await expect(paid.cost()).resolves.toMatchObject({ usd: '0', retainedLiabilityUsd: '0' })
      expect(f.api.responseBodies()).toHaveLength(0)
    } finally {
      await f.host.close()
    }
  })
  it.each(['pause', 'grant', 'consent', 'trust', 'signIn', 'model', 'route'])(
    'refuses %s changed inside reservation, refunds it and settles refused before HTTP',
    async (change) => {
      const f = await fixture()
      const lifetime = new AbortController()
      const reserve = f.ports.reserve
      f.ports.reserve = async (...args) => {
        const claim = await reserve(...args)
        switch (change) {
          case 'trust': {
            f.state.active = false
            break
          }
          case 'signIn':
          case 'route': {
            f.state.generation += 1
            break
          }
          case 'model': {
            await f.session.setModel('changed-model')
            break
          }
          default: {
            const current = await f.authority.read(f.schedule.workspaceKey, f.schedule.id)
            if (current === undefined) throw new Error('missing schedule')
            const next = {
              ...current,
              ...(change === 'pause' && { paused: true }),
              ...(change === 'grant' && {
                grant: {
                  ...current.grant,
                  rules: [{ id: 'new', kind: 'tool' as const, name: 'read' }],
                },
              }),
              ...(change === 'consent' && { paidConsent: undefined }),
            }
            await f.authority.commit(next, {
              scheduleId: next.id,
              atMs: Date.now(),
              kind: 'changed',
            })
          }
        }
        return claim
      }
      const binding = createScheduleDeliveryBinding(
        {
          workspaceRoot: f.folder,
          platform: process.platform,
          dialect: process.platform === 'win32' ? 'powershell' : 'bash',
          io: memoryToolIo({}, f.folder),
          signal: lifetime.signal,
          isActive: () => f.state.active,
          host: () => Promise.resolve(f.host),
          options: () =>
            Promise.resolve({
              workspaceRoot: f.folder,
              modelId: f.session.modelId,
              approvalMode: 'promptUnmatched',
            }),
          publish: () => unpublish,
          findLive: () => ({ agent: f.session, status: 'idle' }),
          row: () => undefined,
          deferQuestions: () => Promise.resolve(),
          safety: () => undefined,
        },
        f.authority,
        f.billing,
      )
      const lease = await binding.targets.find(f.schedule)
      if (lease === undefined) throw new Error('missing target')
      try {
        const context = fakeRunContext(f.schedule)
        const result = await binding.runs.run(lease.session, f.schedule, context, async () => {
          await lease.session.send('scheduled prompt', context)
        })
        expect(result).toMatchObject({
          outcome: 'refused',
          reason: expect.any(String),
          cost: { usd: '0', retainedLiabilityUsd: '0' },
        })
        expect(f.api.responseBodies()).toHaveLength(0)
        const day = await f.daily.latestDay()
        expect(day.spentUsd).toBe('0')
      } finally {
        await lease.release()
        await f.host.close()
      }
    },
  )
  it('reserves the selected tariff cold-cache and image charges before dispatch', async () => {
    const pricing = modelPolicyFor('muse-spark-1.3').pricing
    if (pricing.kind !== 'priced') throw new Error('missing verified tariff')
    const f = await fixture(
      'always',
      5,
      {},
      {
        kind: 'priced',
        card: { ...pricing.card, input: 0.01, output: 0.02, cacheWrite: 0.03, image: 0.1 },
      },
    )
    try {
      const paid = await f.billing.paid(
        f.schedule,
        f.session,
        fakeRunContext(f.schedule),
        f.authority,
      )
      const request: CreateResponseBody = {
        ...body(f.session.modelId, 2),
        input: [
          {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_image', image_url: 'https://example.test/image.png', detail: 'auto' },
            ],
          },
        ],
      }
      const claim = await paid.policy.reserve(request, 2, new AbortController().signal)
      expect(claim.reservedUsd).toBe(Usd.from(0.2).toAmount())
      await claim.settle(Usd.from(0).toAmount())
      expect(f.api.responseBodies()).toHaveLength(0)
    } finally {
      await f.host.close()
    }
  })

  it('names the cadence in localized units rather than exposing trigger JSON in paid consent', async () => {
    const f = await fixture('always', 5, {
      trigger: { kind: 'interval', everyMs: 120_000, anchorMs: 0 },
      zone: 'UTC',
    })
    try {
      const question = f.ask.mock.calls[0]?.[0]
      expect(question?.detail).toContain(
        `${UI_TEXT.scheduleV2.triggers.interval}: ${formatUnit(2, 'minute')} (UTC)`,
      )
      expect(question?.detail).not.toContain('"trigger"')
      expect(question?.detail).not.toContain('"everyMs"')
    } finally {
      await f.host.close()
    }
  })
  it('refuses an expired provider capability/tariff resolution at the actual host boundary', async () => {
    const log = new FakeLogOutputChannel()
    const client = fakeModelApiClient(fakeModelApi(), log)
    const host = new ModelApiHost({
      ...fakeModelApiHostDeps({
        client,
        log,
        workspaceRoot: process.cwd(),
        io: memoryToolIo({}, process.cwd()),
      }),
      models: {
        resolve: (ref) =>
          Promise.resolve({ ...metaResolvedModel(ref, client), isCurrent: () => false }),
      },
    })
    try {
      await expect(host.schedulePricing('muse-spark-1.3')).rejects.toThrow(
        UI_TEXT.scheduleConfirmationExpired,
      )
    } finally {
      await host.close()
    }
  })
  it('binds Allow once to one run with a first-revision CAS and refuses its next run', async () => {
    const f = await fixture('once')
    try {
      const context = fakeRunContext(f.schedule)
      const admitted = await f.billing.paid(f.schedule, f.session, context, f.authority)
      expect(admitted.policy.allows('scheduledPrompts')).toBe(true)
      const stored = await f.authority.read(f.schedule.workspaceKey, f.schedule.id)
      expect(stored).toMatchObject({
        revision: 1,
        paidConsent: { scope: 'once', runId: context.runId },
      })
      if (stored === undefined) throw new Error('schedule missing')
      await expect(
        f.billing.paid(stored, f.session, { ...context, runId: 'later-run' }, f.authority),
      ).rejects.toThrow()
      expect(f.ask).toHaveBeenCalledOnce()
      expect(f.api.responseBodies()).toHaveLength(0)
    } finally {
      await f.host.close()
    }
  })

  it('retains the standing grant while rejecting account generation and tariff drift before reservation', async () => {
    const f = await fixture()
    try {
      const paid = await f.billing.paid(
        f.schedule,
        f.session,
        fakeRunContext(f.schedule),
        f.authority,
      )
      expect(paid.consent?.scope).toBe('schedule')
      f.state.generation += 1
      expect(paid.policy.allows('scheduledPrompts')).toBe(false)
      f.state.generation -= 1
      if (f.state.pricing.kind !== 'priced') throw new Error('missing verified tariff')
      f.state.pricing = { ...f.state.pricing, card: { ...f.state.pricing.card, output: 1 } }
      await assertTariffRefusal(f, paid.policy)
    } finally {
      await f.host.close()
    }
  })

  it('refuses an unaffordable dispatch without asking to raise the daily budget', async () => {
    const f = await fixture('always', 0.01)
    try {
      const paid = await f.billing.paid(
        f.schedule,
        f.session,
        fakeRunContext(f.schedule),
        f.authority,
      )
      await expect(
        paid.policy.reserve(
          body(f.session.modelId, 1_000_000),
          undefined,
          new AbortController().signal,
        ),
      ).rejects.toThrow()
      expect(f.ask).toHaveBeenCalledOnce()
      await assertNoCharge(f)
    } finally {
      await f.host.close()
    }
  })

  it('declining creation leaves no paid authority and no HTTP request', async () => {
    const f = await fixture('deny')
    try {
      expect(f.schedule.paidConsent).toBeUndefined()
      await expect(
        f.billing.paid(f.schedule, f.session, fakeRunContext(f.schedule), f.authority),
      ).rejects.toThrow()
      expect(f.api.responseBodies()).toHaveLength(0)
      const day = await f.daily.latestDay()
      expect(day.spentUsd).toBe('0')
    } finally {
      await f.host.close()
    }
  })
})

async function assertTariffRefusal(
  f: Awaited<ReturnType<typeof fixture>>,
  policy: NonNullable<ScheduleRunDeps['paid']>,
) {
  await expect(
    policy.reserve(body(f.session.modelId), undefined, new AbortController().signal),
  ).rejects.toThrow(UI_TEXT.scheduleV2.messages.changedConsent)
  const day = await f.daily.latestDay()
  expect(day.spentUsd).toBe('0')
}
async function assertNoCharge(f: Awaited<ReturnType<typeof fixture>>) {
  const day = await f.daily.latestDay()
  expect(day.spentUsd).toBe('0')
  expect(f.api.responseBodies()).toHaveLength(0)
}
