import { createRuntimeScheduleDelivery } from '../../src/runtime/schedules/delivery'
import path from 'node:path'
import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { createRuntimeBackend } from '../../src/runtime/backends'
import { runtimeScheduleSessionFactory } from '../../src/runtime/schedules/sessionFactory'
import { createScheduleEngine } from '../../src/runtime/schedules/engine'
import {
  createNodeScheduleFs,
  createNodeScheduleQueue,
} from '../../src/runtime/schedules/nodeScheduleFs'
import { runtimeSchedulesBinding } from '../../src/runtime/schedules/binding'
import { createScheduleDeliveryBinding } from '../../src/host/schedules/deliveryBinding'
import { createScheduleBilling } from '../../src/host/schedules/paidBinding'
import { createSessionBudgetJournal } from '../../src/host/backend/sessionBudgetJournal'
import { agentDataFolder, workspaceKey } from '../../src/runtime/dataFolder'
import { fingerprint } from '../../src/core/verify/fingerprint'
import {
  SCHEDULE_EDITOR_DELIVERY_CERTIFICATION,
  SCHEDULE_MIN_INTERVAL_MS,
  PAID_DAILY_BUDGET,
  SECRET_KEYS,
} from '../../src/shared/constants'
import { type ScheduleV2 } from '../../src/shared/scheduleV2'
import { Usd } from '../../src/shared/usd'
import { fakeModelApi, FAKE_MODEL_API_KEY } from './helpers/fakeModelApi'
import { memorySecrets, FakeLogOutputChannel } from './helpers/fakes'
import { fixtureRuntimeAdmission } from './helpers/runtimeAdmission'
import { buildModelApiBundle } from './helpers/modelApiBundle'
import { fakeScheduleDraft } from './helpers/schedules/runtimeFixtures'

const paths: { folder: string; dist: string; stopAdmission?: () => Promise<void> } = {
  folder: '',
  dist: '',
}
const unpublish = () => undefined
beforeAll(async () => {
  paths.folder = await mkdtemp(path.join(tmpdir(), 'schedule-assembly-'))
  paths.dist = path.join(paths.folder, 'dist')
  await mkdir(paths.dist)
  await buildModelApiBundle(paths.dist)
  paths.stopAdmission = await fixtureRuntimeAdmission()
})
afterEach(() =>
  Object.defineProperty(SCHEDULE_EDITOR_DELIVERY_CERTIFICATION, 'isReady', { value: false }),
)
afterAll(async () => {
  await paths.stopAdmission?.()
  await rm(paths.folder, { recursive: true, force: true, maxRetries: 3 })
})

it.each(['VS Code window', 'ACP', 'CLI run-due'] as const)(
  'composes %s through production assembly with consent and both caps before one model send',
  async (hostKind) => {
    Object.defineProperty(SCHEDULE_EDITOR_DELIVERY_CERTIFICATION, 'isReady', { value: true })
    const home = await mkdtemp(path.join(paths.folder, 'home-'))
    const cwd = path.join(home, 'workspace')
    await mkdir(cwd)
    const data = agentDataFolder({
      platform: process.platform,
      env: { XDG_DATA_HOME: home, LOCALAPPDATA: home },
      homeDir: home,
    })
    await mkdir(data, { recursive: true })
    await writeFile(path.join(data, 'settings.json'), JSON.stringify({ paidDailyBudgetUsd: 5 }))
    const key = workspaceKey(cwd)
    const api = fakeModelApi()
    const secrets = memorySecrets()
    secrets.values.set(SECRET_KEYS.modelApiKey, FAKE_MODEL_API_KEY)
    const log = new FakeLogOutputChannel()
    const journal = createSessionBudgetJournal({
      directory: path.join(data, PAID_DAILY_BUDGET.directory),
      sleep: () => Promise.resolve(),
      initialBudget: () =>
        Promise.resolve({ spentUsd: Usd.from(0).toAmount(), hasUnknownHistoricalFees: false }),
    })
    const currentDate = new Date()
    const day = [currentDate.getFullYear(), currentDate.getMonth() + 1, currentDate.getDate()].join(
      '-',
    )
    let stored: ScheduleV2 | undefined
    let dispatchChecks = 0
    const transport: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith('/responses')) {
        if (stored === undefined) throw new Error('dispatch before schedule persistence')
        const shared = await journal.readExisting(day, PAID_DAILY_BUDGET.accountId)
        const own = await journal.readExisting(
          `${day}-schedule-${fingerprint(stored.id)}`,
          PAID_DAILY_BUDGET.accountId,
        )
        expect(Usd.from(shared?.spentUsd ?? '0').compare(Usd.from(0))).toBeGreaterThan(0)
        expect(own?.spentUsd).toBe(shared?.spentUsd)
        expect(stored.paidConsent?.scope).toBe('always')
        dispatchChecks += 1
      }
      return await api.fetch(input, init)
    }
    const backend = createRuntimeBackend({
      options: {
        backend: 'modelApi',
        trustWorkspace: true,
        museBinary: '',
        shellSandbox: 'auto',
        canBypass: false,
        allowsContributorModels: false,
        paidFeatures: [],
        scheduledPrompts: true,
        maxBudgetUsd: Usd.from(5).toAmount(),
        isVerbose: false,
      },
      version: '0.0.0-test',
      distDir: paths.dist,
      platform: process.platform,
      env: { XDG_DATA_HOME: home, LOCALAPPDATA: home },
      homeDir: home,
      secrets,
      runGit: () => Promise.reject(new Error('unused git')),
      fetch: transport,
      sleep: () => Promise.resolve(),
      log,
    })
    const ask = vi.fn(() => Promise.resolve('always' as const))
    backend.paid.attach(ask)
    const sessions = runtimeScheduleSessionFactory({
      current: backend,
      create: () => Promise.resolve(backend),
      distDir: paths.dist,
      dataDir: data,
      log,
      allowsContributorModels: false,
    })
    const modelHost = await backend.backend.hostFor(cwd)
    const models = await modelHost.listModels()
    const model = models.find((model) => model.isDefault)
    if (model === undefined) throw new Error('no model')
    const agent = await modelHost.startSession({
      workspaceRoot: cwd,
      modelId: model.modelId,
      approvalMode: 'promptUnmatched',
    })
    if (backend.scheduleBilling === undefined) throw new Error('missing production billing')
    const caller = {
      source: hostKind === 'CLI run-due' ? ('cli' as const) : ('acp' as const),
      isInteractive: true,
      scheduledPrompts: true,
      maxBudgetUsd: Usd.from(5).toAmount(),
      sessionId: agent.sessionId,
      backend: 'modelApi' as const,
    }
    const billingPorts = await backend.scheduleBilling(cwd, model.modelId, caller)
    const billing = createScheduleBilling(billingPorts)
    const lifetime = new AbortController()
    const deliveryPorts = {
      workspaceRoot: cwd,
      platform: process.platform,
      dialect: process.platform === 'win32' ? ('powershell' as const) : ('bash' as const),
      io: { realPath: realpath },
      signal: lifetime.signal,
      isActive: () => true,
      host: () => Promise.resolve(modelHost),
      options: () =>
        Promise.resolve({
          workspaceRoot: cwd,
          modelId: model.modelId,
          approvalMode: 'promptUnmatched' as const,
        }),
      publish: () => unpublish,
      findLive: () => ({ agent, status: 'idle' }),
      row: () => undefined,
      deferQuestions: () => Promise.resolve(),
      safety: () => undefined,
      billing: billingPorts,
      caller: () => caller,
    }
    let now = Date.now()
    const root = path.join(home, 'schedules')
    const engine = createScheduleEngine({
      fs: createNodeScheduleFs(root),
      queue: createNodeScheduleQueue(root),
      now: () => now,
      platform: process.platform,
      homeDir: home,
      dataDir: data,
      ...(hostKind === 'VS Code window'
        ? {
            delivery: (authority) =>
              createScheduleDeliveryBinding(deliveryPorts, authority, billing),
            consent: (schedule) => billing.consent(schedule),
            caller: () => caller,
          }
        : {
            runtimeDeliveryFactory: createRuntimeScheduleDelivery,
            runtimeDelivery: sessions.ports,
          }),
      verifyWake: () =>
        Promise.resolve({ scheduledPrompts: true, maxBudgetUsd: Usd.from(5).toAmount() }),
    })
    const load = runtimeSchedulesBinding(
      path.join(paths.dist, 'schedules.js'),
      log,
      () => ({ createRuntimeSchedules: () => Promise.resolve(engine.runtime) }),
      hostKind === 'VS Code window' ? deliveryPorts : undefined,
      hostKind === 'VS Code window' ? undefined : sessions.ports,
    )
    const binding = await load()
    try {
      await binding.holdWorkspace(cwd, {
        agent,
        backend: 'modelApi',
        row: () => undefined,
        deferQuestions: () => Promise.resolve(),
      })
      const draft = {
        ...fakeScheduleDraft(),
        paidCapUsd: Usd.from(1).toAmount(),
        grant: { rules: [], destinationIds: [], paidCapUsd: Usd.from(1).toAmount() },
        trigger: { kind: 'once' as const, atMs: now + SCHEDULE_MIN_INTERVAL_MS },
        target: {
          kind: 'conversation' as const,
          backend: 'modelApi' as const,
          sessionId: agent.sessionId,
        },
      }
      if (hostKind === 'VS Code window') {
        const response = await binding.message(
          { method: 'schedules/create', workspaceKey: key, draft },
          cwd,
        )
        expect(response).toBeDefined()
      } else if (hostKind === 'ACP') {
        await binding.run(`/schedule add ${JSON.stringify(draft)}`, {
          cwd,
          sessionId: agent.sessionId,
          backend: 'modelApi',
          scheduledPrompts: true,
          maxBudgetUsd: Usd.from(5).toAmount(),
        })
      } else {
        expect(
          await binding.command(
            {
              operation: 'add',
              isJson: true,
              draft: JSON.stringify(draft),
              scheduledPrompts: true,
              maxBudgetUsd: Usd.from(5).toAmount(),
            },
            cwd,
          ),
        ).toMatchObject({ exitCode: 0 })
      }
      const schedules = await engine.store.list(key)
      stored = schedules[0]
      expect(stored?.paidConsent?.payerKind).toBe('paidKey')
      expect(ask).toHaveBeenCalledTimes(hostKind === 'CLI run-due' ? 0 : 1)
      now += SCHEDULE_MIN_INTERVAL_MS
      if (hostKind === 'CLI run-due') {
        expect(await binding.command({ operation: 'run-due', isJson: true }, cwd)).toMatchObject({
          exitCode: 0,
        })
      } else await engine.scheduler.poll(key)
      const [fire] = await engine.store.fires(key)
      expect(fire).toMatchObject({
        outcome: 'ran',
        cost: { certainty: 'exact' },
        refusedActions: [],
      })
      expect(dispatchChecks).toBe(1)
      expect(api.responseBodies()).toHaveLength(1)
      expect(await engine.store.pending(key)).toEqual([])
      const shared = await journal.readExisting(day, PAID_DAILY_BUDGET.accountId)
      const own = await journal.readExisting(
        `${day}-schedule-${fingerprint(stored!.id)}`,
        PAID_DAILY_BUDGET.accountId,
      )
      expect(shared?.spentUsd).toBe(fire?.cost.usd)
      expect(own?.spentUsd).toBe(fire?.cost.usd)
    } finally {
      lifetime.abort()
      await binding.close()
      await sessions.close()
    }
  },
)
