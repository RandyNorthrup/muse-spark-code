import { Usd } from '../../src/shared/usd'
// M77 consumes M82 through the production manager and a real parent-owned
// file journal. Temporary hosts never write a transcript under the parent ID.
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../src/core/agent/agentBackend'
import type { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { createFileSessionStore } from '../../src/host/backend/fileSessionStore'
import { ModelApiBackendManager } from '../../src/host/backend/modelApiBackendManager'
import * as modelApiEntry from '../../src/host/backend/modelApiEntry'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { FAKE_MODEL_API_ACCOUNT_ID, fakeModelApi } from './helpers/fakeModelApi'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeManagerDeps } from './helpers/modelApiManager'

const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})

function watch(session: AgentSession) {
  const events: AgentEvent[] = []
  session.onEvent((event) => {
    events.push(event)
  })
  return {
    session,
    events,
    done: async () => {
      await vi.waitFor(() => {
        expect(events.some((event) => event.type === 'turnCompleted')).toBe(true)
      })
    },
  }
}

async function setup(initialCap = 0.1) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'muse-attempt-budget-')))
  folders.push(directory)
  const log = new FakeLogOutputChannel()
  const store = createFileSessionStore({
    directory,
    log,
    retentionDays: () => 0,
    now: () => 0,
    sleep: delay,
  })
  const api = fakeModelApi()
  let cap = initialCap
  let key: string | undefined = 'LLM|1|secret'
  let isTrusted = true
  let ids = 0
  const manager = new ModelApiBackendManager(
    fakeManagerDeps(api, log, {
      workspaceRoot: directory,
      store,
      getApiKey: () => Promise.resolve(key),
      sessionBudgetUsd: () => Usd.from(cap).toAmount(),
      isWorkspaceTrusted: () => isTrusted,
      newId: () => `offline-${String(++ids)}`,
      bundlePath: 'src/host/backend/modelApiEntry.ts',
      loadBundle: () => modelApiEntry,
    }),
  )
  const parent = await manager.ensureHost()
  const parentSession = await parent.startSession({
    workspaceRoot: directory,
    modelId: 'muse-spark-1.3',
    approvalMode: 'onRequest',
  })
  const scope = await manager.bestOfNBudgetScope(parentSession.sessionId)
  if (scope === undefined) throw new Error('Expected parent-owned real journal scope')
  const hosts: ModelApiHost[] = []
  const started: string[] = []
  const trial = async (name: string) => {
    const host = await manager.buildAttemptHost(
      path.join(directory, name),
      Object.assign(() => undefined, {
        onRequestStarted: () => {
          started.push(name)
        },
      }),
      undefined,
      scope,
    )
    hosts.push(host)
    const session = await host.startSession({
      workspaceRoot: path.join(directory, name),
      modelId: 'muse-spark-1.3',
      approvalMode: 'onRequest',
    })
    return watch(session)
  }
  return {
    directory,
    store,
    api,
    manager,
    parent,
    parentSession,
    scope,
    trial,
    started,
    changeKey: () => {
      key = 'LLM|1|other-offline-account'
    },
    loseTrust: () => {
      isTrusted = false
    },
    enableCap: () => {
      cap = 0.1
    },
    close: async () => {
      await Promise.all(
        hosts.map(async (host) => {
          await host.close()
        }),
      )
      await manager.dispose()
    },
  }
}

describe('production best-of-N parent budget binding (M77/M82)', () => {
  it('fences two concurrent attempt hosts with the parent liability in one durable journal', async () => {
    const t = await setup()
    const held = Promise.withResolvers<undefined>()
    const arrived = Promise.withResolvers<undefined>()
    try {
      const parent = watch(t.parentSession)
      const first = await t.trial('first')
      const second = await t.trial('second')
      t.api.script(
        {
          text: 'parent reply',
          usage: { input: 10, output: 5 },
          hold: held.promise,
          onRequest: () => {
            arrived.resolve(undefined)
          },
        },
        { text: 'first attempt reply', usage: { input: 10, output: 5 } },
        { text: 'second attempt reply', usage: { input: 10, output: 5 } },
      )
      await parent.session.sendTurn([{ type: 'text', text: 'parent request' }])
      await arrived.promise
      await Promise.all(
        [first, second].map((host) =>
          host.session.sendTurn([{ type: 'text', text: 'concurrent request' }]),
        ),
      )
      await Promise.all([first.done(), second.done()])
      expect(t.api.responseBodies()).toHaveLength(1)
      expect(t.started).toEqual([])
      for (const attempt of [first, second]) {
        expect(attempt.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
          terminal: 'failed',
        })
      }
      const observer = createFileSessionStore({
        directory: t.directory,
        log: new FakeLogOutputChannel(),
        retentionDays: () => 0,
        now: () => 0,
        sleep: delay,
      })
      const pending = await observer.budget?.read(t.scope.sessionId, t.scope.accountId)
      expect(Number(pending?.spentUsd)).toBeGreaterThan(0.09)
      expect(Number(pending?.spentUsd)).toBeLessThanOrEqual(0.1)
      held.resolve(undefined)
      await parent.done()
      for (const attempt of [first, second]) {
        const retry = watch(attempt.session)
        await retry.session.sendTurn([{ type: 'text', text: 'after parent settlement' }])
        await retry.done()
        expect(retry.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
          terminal: 'completed',
        })
      }
      expect(t.api.responseBodies()).toHaveLength(3)
      expect(t.started).toEqual(['first', 'second'])
      const total = await observer.budget?.read(t.scope.sessionId, t.scope.accountId)
      expect(total).toEqual({
        spentUsd: Usd.from('0.00010125').toAmount(),
        hasUnknownHistoricalFees: false,
      })
      await t.close()
      const stored = await t.store.load(t.scope.sessionId)
      expect(stored?.budgetSpentUsd).toBe(total?.spentUsd)
      const files = await readdir(t.directory)
      expect(files.filter((name) => name.endsWith('.json'))).toEqual([`${t.scope.sessionId}.json`])
      expect(
        await readdir(
          path.join(t.directory, 'budget-journal', t.scope.accountId, t.scope.sessionId, 'claims'),
        ),
      ).toHaveLength(3)
    } finally {
      held.resolve(undefined)
      await t.close()
    }
  })

  it('displays parent-owned pending liability without settling it or exposing account identity', async () => {
    const t = await setup()
    try {
      const claim = await t.scope.journal.reserve(
        t.scope.sessionId,
        t.scope.accountId,
        Usd.from(0.02).toAmount(),
      )
      const state = await t.manager.readUsageBudgets()
      expect(state).toEqual([
        {
          budget: {
            id: t.parentSession.sessionId,
            kind: 'conversation',
            capUsd: 0.1,
            spentUsd: 0.02,
            stopped: false,
            uncertainUsd: 0.02,
          },
        },
      ])
      expect(JSON.stringify(state)).not.toContain(t.scope.accountId)
      expect(await t.scope.journal.read(t.scope.sessionId, t.scope.accountId)).toHaveProperty(
        'spentUsd',
        Usd.from(0.02).toAmount(),
      )
      await claim.settle(Usd.from(0.005).toAmount())
      expect(await t.manager.readUsageBudgets()).toEqual([
        expect.objectContaining({ budget: expect.objectContaining({ spentUsd: 0.005 }) }),
      ])
    } finally {
      await t.close()
    }
  })
  it('shares pending liability across attempts, then admits a new attempt after measured settlement', async () => {
    const t = await setup()
    const held = Promise.withResolvers<undefined>()
    try {
      const first = await t.trial('first')
      const second = await t.trial('second')
      t.api.script(
        { text: 'first reply', hold: held.promise, usage: { input: 10, output: 5 } },
        { text: 'next reply', usage: { input: 10, output: 5 } },
      )
      await first.session.sendTurn([{ type: 'text', text: 'first attempt' }])
      await vi.waitFor(() => {
        expect(t.started).toEqual(['first'])
      })
      const pending = await t.scope.journal.read(t.scope.sessionId, t.scope.accountId)
      expect(Number(pending.spentUsd)).toBeGreaterThan(0.09)
      await second.session.sendTurn([{ type: 'text', text: 'second attempt' }])
      await second.done()
      expect(t.api.responseBodies()).toHaveLength(1)
      expect(t.started).toEqual(['first'])
      expect(second.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
        terminal: 'failed',
      })
      held.resolve(undefined)
      await first.done()
      const third = await t.trial('third')
      await third.session.sendTurn([{ type: 'text', text: 'third attempt' }])
      await third.done()
      expect(t.api.responseBodies()).toHaveLength(2)
      expect(t.started).toEqual(['first', 'third'])
      const total = await t.scope.journal.read(t.scope.sessionId, FAKE_MODEL_API_ACCOUNT_ID)
      expect(total.hasUnknownHistoricalFees).toBe(false)
      expect(Number(total.spentUsd)).toBeCloseTo((2 * (10 * 1.25 + 5 * 4.25)) / 1_000_000, 12)
      await t.close()
      const saved = await t.store.load(t.parentSession.sessionId)
      expect(JSON.stringify(saved?.transcript)).not.toContain('attempt')
      const awaitedMember1 = await readdir(t.directory)
      const storedIds = awaitedMember1.filter((name) => name.endsWith('.json'))
      expect(storedIds).toEqual([`${t.parentSession.sessionId}.json`])
    } finally {
      held.resolve(undefined)
      await t.close()
    }
  })

  it.each(['key', 'trust', 'close', 'stop', 'cap'] as const)(
    'refunds a proven nonsent attempt and counts no send after %s changes during real claim publication',
    async (change) => {
      const t = await setup(change === 'cap' ? 0 : 0.1)
      const held = Promise.withResolvers<undefined>()
      const published = Promise.withResolvers<undefined>()
      const reserve = t.scope.journal.reserve.bind(t.scope.journal)
      const spy = vi.spyOn(t.scope.journal, 'reserve').mockImplementation(async (...args) => {
        const claim = await reserve(...args)
        published.resolve(undefined)
        await held.promise
        return claim
      })
      try {
        const attempt = await t.trial('held')
        t.api.script({ text: 'must not send' })
        await attempt.session.sendTurn([{ type: 'text', text: 'held attempt' }])
        // Prove this host reached the parent's journal before waiting on its publication.
        await vi.waitFor(() => {
          expect(spy).toHaveBeenCalledOnce()
        })
        await published.promise
        switch (change) {
          case 'key': {
            t.changeKey()
            break
          }
          case 'trust': {
            t.loseTrust()
            break
          }
          case 'close': {
            await t.parent.close()
            break
          }
          case 'stop': {
            void attempt.session.cancel()
            break
          }
          case 'cap': {
            t.enableCap()
            break
          }
        }
        held.resolve(undefined)
        await attempt.done()
        await t.close()
        expect(t.api.responseBodies()).toEqual([])
        expect(t.started).toEqual([])
        const total = await t.scope.journal.read(t.scope.sessionId, t.scope.accountId)
        expect(total.spentUsd).toBe(Usd.from(0).toAmount())
        expect(total.hasUnknownHistoricalFees).toBe(false)
      } finally {
        held.resolve(undefined)
        spy.mockRestore()
        await t.close()
      }
    },
  )
})
