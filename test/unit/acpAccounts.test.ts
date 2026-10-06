import * as acp from '@agentclientprotocol/sdk'
import { describe, expect, it, vi } from 'vitest'
import { AcpAccounts, companionAccountsPanel, type AccountsPanelPort } from '../../src/acp/accounts'
import { createAcpAgent, type AcpAgentDeps } from '../../src/acp/agent'
import { AcpPaidUse } from '../../src/acp/paid'
import { ACP_CONFIG_IDS, UI_TEXT } from '../../src/shared/constants'
import { accountSwap, forgedState, sessionAccountsRig } from './helpers/runtimeAccounts'
import { FakeAgentHost } from './helpers/fakeAgent'
import { memoryPaidGrants } from './helpers/paidGrants'
import { until } from './helpers/acpWaits'

function connectedAccounts(isBound = true) {
  const h = sessionAccountsRig()
  const host = new FakeAgentHost()
  const updates: acp.SessionUpdate[] = []
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const deps: AcpAgentDeps = {
    ...(isBound && { accounts: h.port }),
    backend: {
      kind: 'modelApi',
      readiness: () => Promise.resolve({ state: 'ready' }),
      hostFor: () => Promise.resolve(host),
    },
    version: 'accounts-test',
    options: { canBypass: false, allowsContributorModels: false, initialMode: 'manual' },
    signIn: {
      id: 'account-key',
      name: 'Account key',
      description: 'Test auth',
      args: [],
      command: 'test-auth',
    },
    defaultCwd: process.cwd(),
    paid: new AcpPaidUse({
      flagged: [],
      canRemember: () => false,
      grants: memoryPaidGrants(),
      log,
    }),
    log,
  }
  const agent = createAcpAgent(deps)
  const client = acp
    .client({ name: 'account-editor' })
    .onNotification('session/update', ({ params }) => {
      updates.push(params.update)
    })
  const run = async (op: (client: acp.ClientContext, id: string) => Promise<void>) => {
    await client.connectWith(agent, async (connection) => {
      await connection.request('initialize', {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      })
      const session = await connection.request('session/new', {
        cwd: process.cwd(),
        mcpServers: [],
      })
      await op(connection, session.sessionId)
    })
  }
  return { ...h, host, updates, run }
}

describe('M108 ACP accounts', () => {
  it('serves /accounts and its session option through the real ACP router without a model turn', async () => {
    const h = connectedAccounts()
    await h.run(async (client, id) => {
      for (const text of [
        '/accounts',
        '/accounts current',
        '/accounts thresholds work',
        '/accounts use work',
      ]) {
        const answer = await client.request('session/prompt', {
          sessionId: id,
          prompt: [{ type: 'text', text }],
        })
        expect(answer.stopReason).toBe('end_turn')
      }
      expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
      expect(h.updates).toContainEqual(
        expect.objectContaining({
          sessionUpdate: 'available_commands_update',
          availableCommands: expect.arrayContaining([
            expect.objectContaining({ name: 'accounts' }),
          ]),
        }),
      )
      const answer = await client.request('session/set_config_option', {
        sessionId: id,
        configId: ACP_CONFIG_IDS.account,
        value: 'default',
      })
      expect(answer.configOptions).toContainEqual(
        expect.objectContaining({
          id: 'account',
          currentValue: 'default',
          options: [
            { value: 'default', name: 'meta · Default' },
            { value: 'work', name: 'meta · Work' },
          ],
        }),
      )
      expect(h.updates).toContainEqual(
        expect.objectContaining({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Current account: meta · Work' },
        }),
      )
    })
  })

  it('refuses account commands and options without a binding before any model turn', async () => {
    const h = connectedAccounts(false)
    await h.run(async (client, id) => {
      await expect(
        client.request('session/prompt', {
          sessionId: id,
          prompt: [{ type: 'text', text: '/accounts' }],
        }),
      ).rejects.toThrow(UI_TEXT.accounts.unavailable)
      await expect(
        client.request('session/set_config_option', {
          sessionId: id,
          configId: 'account',
          value: 'work',
        }),
      ).rejects.toThrow(UI_TEXT.accounts.unavailable)
      expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
      expect(h.port.read).not.toHaveBeenCalled()
    })
  })

  it('announces a validated swap with account labels, reason and exact cold-cache cost', async () => {
    const h = connectedAccounts()
    await h.run(async (client, id) => {
      h.emit(accountSwap())
      // A following local prompt flushes the same ACP outbox.
      await client.request('session/prompt', {
        sessionId: id,
        prompt: [{ type: 'text', text: '/accounts current' }],
      })
      expect(h.updates).toContainEqual(
        expect.objectContaining({
          sessionUpdate: 'config_option_update',
          configOptions: expect.arrayContaining([
            expect.objectContaining({ id: 'account', currentValue: 'work' }),
          ]),
        }),
      )
      const notices = h.updates.filter((update) => update.sessionUpdate === 'agent_message_chunk')
      expect(JSON.stringify(notices)).toContain(
        'Now on meta · Work: Default reached spendUsd: $1.00 (day).',
      )
      expect(JSON.stringify(notices)).toContain('Estimated context re-read cost: $0.1000.')
    })
  })

  it('rejects malformed selections and mixed-content commands before any model dispatch', async () => {
    const h = connectedAccounts()
    await h.run(async (client, id) => {
      for (const text of [
        '/accounts use absent',
        '/accounts use ../secret',
        '/accounts current extra',
        '/accounts thresholds missing',
        '/accounts use work extra',
      ]) {
        await expect(
          client.request('session/prompt', { sessionId: id, prompt: [{ type: 'text', text }] }),
        ).rejects.toThrow()
      }
      await expect(
        client.request('session/prompt', {
          sessionId: id,
          prompt: [
            { type: 'text', text: '/accounts' },
            { type: 'text', text: 'also send a turn' },
          ],
        }),
      ).rejects.toThrow()
      await expect(
        client.request('session/set_config_option', {
          sessionId: id,
          configId: 'account',
          value: 'missing',
        }),
      ).rejects.toThrow()
      expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
      expect(h.port.use).not.toHaveBeenCalled()
    })
  })

  it('refuses account changes during a running turn and invalidates a held selection on close', async () => {
    const h = connectedAccounts()
    await h.run(async (client, id) => {
      const response = client.request('session/prompt', {
        sessionId: id,
        prompt: [{ type: 'text', text: 'normal turn' }],
      })
      await until(() => h.host.sessions[0]?.sendTurn.mock.calls.length === 1)
      await expect(
        client.request('session/set_config_option', {
          sessionId: id,
          configId: 'account',
          value: 'work',
        }),
      ).rejects.toThrow(UI_TEXT.acpPromptBusy)
      expect(h.port.use).not.toHaveBeenCalled()
      h.host.sessions[0]?.emit({ type: 'turnCompleted', turnId: 'turn-1', terminal: 'completed' })
      await response
      const started = Promise.withResolvers<() => boolean>(),
        release = Promise.withResolvers<undefined>()
      h.port.use = async (_session, account, canCommit) => {
        started.resolve(canCommit)
        await release.promise
        expect(canCommit()).toBe(false)
        return { ...h.state(), currentAccount: account }
      }
      const change = (async () => {
        try {
          await client.request('session/set_config_option', {
            sessionId: id,
            configId: 'account',
            value: 'work',
          })
          return 'unexpected'
        } catch {
          return 'rejected'
        }
      })()
      const fence = await started.promise
      await client.request('session/close', { sessionId: id })
      expect(fence()).toBe(false)
      release.resolve(undefined)
      expect(await change).toBe('rejected')
      expect(h.listeners.size).toBe(0)
    })
  })

  it('keeps notices received during the initial read and discards a selection result older than a committed swap', async () => {
    const h = sessionAccountsRig(),
      notice = vi.fn()
    const initial = Promise.withResolvers<ReturnType<typeof h.state>>()
    const read = Promise.withResolvers<undefined>()
    h.port.read = () => {
      read.resolve(undefined)
      return initial.promise
    }
    const controller = new AcpAccounts('session', h.port, vi.fn(), notice)
    const starting = controller.start()
    await read.promise
    const old = h.state()
    h.emit(accountSwap())
    initial.resolve(old)
    await starting
    expect(controller.option()[0]?.currentValue).toBe('work')
    expect(notice).toHaveBeenCalledOnce()
    const pending = Promise.withResolvers<ReturnType<typeof h.state>>(),
      begun = Promise.withResolvers<undefined>()
    h.port.use = () => {
      begun.resolve(undefined)
      return pending.promise
    }
    const use = controller.use('default', () => true)
    await begun.promise
    h.emit(accountSwap())
    pending.resolve(old)
    await expect(use).rejects.toThrow(UI_TEXT.accounts.unavailable)
    expect(controller.option()[0]?.currentValue).toBe('work')
    controller.dispose()
  })

  it('discards a held read and held selection after disposal, including its adoption fence', async () => {
    const h = sessionAccountsRig()
    const held = Promise.withResolvers<ReturnType<typeof h.state>>()
    const read = Promise.withResolvers<undefined>()
    h.port.read = () => {
      read.resolve(undefined)
      return held.promise
    }
    const change = vi.fn(),
      notice = vi.fn()
    const accounts = new AcpAccounts('session', h.port, change, notice)
    const starting = accounts.start()
    await read.promise
    accounts.dispose()
    held.resolve(h.state())
    await expect(starting).rejects.toThrow(UI_TEXT.accounts.unavailable)
    expect(accounts.option()).toEqual([])
    expect(h.listeners.size).toBe(0)
    const next = sessionAccountsRig()
    const controller = new AcpAccounts('session', next.port, change, notice)
    await controller.start()
    const ready = Promise.withResolvers<() => boolean>()
    const release = Promise.withResolvers<undefined>()
    next.port.use = async (_session, account, canCommit) => {
      ready.resolve(canCommit)
      await release.promise
      if (canCommit()) throw new Error('stale selection committed')
      return { ...next.state(), currentAccount: account }
    }
    const using = controller.use('work', () => true)
    const fence = await ready.promise
    controller.dispose()
    expect(fence()).toBe(false)
    release.resolve(undefined)
    await expect(using).rejects.toThrow(UI_TEXT.accounts.unavailable)
    next.emit(accountSwap())
    expect(change).not.toHaveBeenCalled()
    expect(notice).not.toHaveBeenCalled()
  })

  it('serializes overlapping selections and recovers after a service failure', async () => {
    const h = sessionAccountsRig()
    const controller = new AcpAccounts('session', h.port, vi.fn(), vi.fn())
    await controller.start()
    const begun = Promise.withResolvers<undefined>(),
      release = Promise.withResolvers<undefined>()
    const used: string[] = []
    h.port.use = async (_session, account, canCommit) => {
      used.push(account)
      if (account === 'work') {
        begun.resolve(undefined)
        await release.promise
        throw new Error('failed')
      }
      expect(canCommit()).toBe(true)
      return { ...h.state(), currentAccount: account }
    }
    const first = (async () => {
      try {
        await controller.use('work', () => true)
      } catch {
        return 'failed'
      }
      return 'unexpected'
    })()
    await begun.promise
    const second = controller.use('default', () => true)
    await Promise.resolve()
    expect(used).toEqual(['work'])
    release.resolve(undefined)
    expect(await first).toBe('failed')
    await second
    expect(used).toEqual(['work', 'default'])
    controller.dispose()
    expect(controller.option()).toEqual([])
  })

  it('rejects credential fields at the session boundary and ignores foreign or malformed notices', async () => {
    const h = sessionAccountsRig()
    h.port.read = () => Promise.resolve(forgedState())
    const controller = new AcpAccounts('session', h.port, vi.fn(), vi.fn())
    await expect(controller.start()).rejects.toThrow(UI_TEXT.accounts.unavailable)
    controller.dispose()
    const next = sessionAccountsRig(),
      notice = vi.fn()
    const valid = new AcpAccounts('session', next.port, vi.fn(), notice)
    await valid.start()
    next.emit({ ...accountSwap(), provider: 'other' })
    const invalid = { ...accountSwap(), secret: 'account-secret-canary' }
    for (const listener of next.listeners) listener(invalid)
    next.emit({ ...accountSwap(), account: 'missing' })
    const swap = accountSwap()
    if (swap.type !== 'swap') throw new Error('fixture must be swap')
    next.emit({ ...swap, previousAccount: 'missing' })
    expect(notice).not.toHaveBeenCalled()
    valid.dispose()
  })

  it('rejects uninitialized, disposed and null selections and service results for another provider or account', async () => {
    const h = sessionAccountsRig()
    const controller = new AcpAccounts('session', h.port, vi.fn(), vi.fn())
    await expect(controller.command('/accounts', () => true)).rejects.toThrow(
      UI_TEXT.accounts.unavailable,
    )
    h.port.read = () => Promise.resolve({ ...h.state(), currentAccount: null })
    await controller.start()
    expect(controller.option()).toEqual([])
    await expect(controller.command('/accounts current', () => true)).rejects.toThrow(
      UI_TEXT.accounts.unavailable,
    )
    const use = vi.fn<typeof h.port.use>()
    h.port.use = use
    for (const state of [h.state(), { ...h.state(), currentAccount: 'work', provider: 'other' }]) {
      use.mockResolvedValue(state)
      await expect(controller.use('work', () => true)).rejects.toThrow(
        UI_TEXT.accounts.invalidAccount,
      )
      expect(controller.option()).toEqual([])
    }
    controller.dispose()
    expect(controller.option()).toEqual([])
    await expect(controller.use('work', () => true)).rejects.toThrow(UI_TEXT.accounts.unavailable)
    expect(h.port.use).toHaveBeenCalledTimes(2)
    await expect(controller.command('/accounts', () => true)).rejects.toThrow(
      UI_TEXT.accounts.unavailable,
    )
  })

  it('uses fixed errors for service read/subscription failures and rejects credentials in public usage URLs', async () => {
    for (const operation of ['read', 'subscribe']) {
      const h = sessionAccountsRig()
      if (operation === 'read')
        h.port.read = () => Promise.reject(new Error('account-secret-canary'))
      else
        h.port.subscribe = () => {
          throw new Error('account-secret-canary')
        }
      const controller = new AcpAccounts('session', h.port, vi.fn(), vi.fn())
      await expect(controller.start()).rejects.toThrow(UI_TEXT.accounts.unavailable)
      controller.dispose()
    }
    const h = sessionAccountsRig(),
      notice = vi.fn()
    const controller = new AcpAccounts('session', h.port, vi.fn(), notice)
    await controller.start()
    const stop = {
      type: 'stop' as const,
      provider: 'meta',
      account: 'default',
      time: '2026-10-06T12:00:00Z',
      trigger: { kind: 'vendorLimit' as const, reason: 'rateLimited' as const, resetAt: null },
    }
    const insecure = new URL('https://example.test/usage')
    insecure.protocol = 'http:'
    for (const url of [
      'bad',
      insecure.href,
      'https://account-secret-canary@example.test/usage',
      'https://example.test/usage?key=account-secret-canary',
      'https://example.test/usage#account-secret-canary',
    ]) {
      h.port.usageUrl = () => url
      h.emit(stop)
      expect(notice).toHaveBeenLastCalledWith(UI_TEXT.accounts.unavailable, stop)
    }
    expect(JSON.stringify(notice.mock.calls)).not.toContain('account-secret-canary')
    controller.dispose()
  })

  it('shows stop reset times and the provider usage page', async () => {
    const h = sessionAccountsRig(),
      notice = vi.fn()
    const controller = new AcpAccounts('session', h.port, vi.fn(), notice)
    await controller.start()
    h.emit({
      type: 'stop',
      provider: 'meta',
      account: 'default',
      time: '2026-10-06T12:00:00Z',
      trigger: { kind: 'vendorLimit', reason: 'rateLimited', resetAt: null },
    })
    expect(notice).toHaveBeenCalledWith(
      'meta has no account with room. Reset time is unknown. https://example.test/usage',
      expect.objectContaining({ type: 'stop' }),
    )
    controller.dispose()
  })
})

describe('M108 companion through the shared panel', () => {
  it('uses the panel dispatcher for metadata and local confirmation, with no secret route', async () => {
    const state = sessionAccountsRig().state()
    const dispatch = vi.fn<AccountsPanelPort['dispatch']>(() => Promise.resolve(state))
    const subscribe = vi.fn<AccountsPanelPort['subscribe']>(() => vi.fn())
    const panel = companionAccountsPanel({ dispatch, subscribe })
    expect(await panel.dispatch({ type: 'accounts/list', provider: 'meta' })).toEqual(state)
    await panel.dispatch({
      type: 'accounts/confirm',
      provider: 'meta',
      product: 'model-api',
      choice: 'confirm',
    })
    expect(dispatch).toHaveBeenCalledTimes(2)
    const forged = {
      type: 'accounts/list' as const,
      provider: 'meta',
      secret: 'account-secret-canary',
    }
    await expect(panel.dispatch(forged)).resolves.toEqual({
      type: 'accounts/error',
      code: 'invalidAccount',
    })
    const grant = {
      type: 'accounts/confirm' as const,
      provider: 'meta',
      product: 'model-api',
      choice: 'confirm' as const,
      machineId: 'other-machine',
    }
    await expect(panel.dispatch(grant)).resolves.toEqual({
      type: 'accounts/error',
      code: 'invalidAccount',
    })
    expect(dispatch).toHaveBeenCalledTimes(2)
    dispatch.mockResolvedValue(forgedState())
    await expect(panel.dispatch({ type: 'accounts/list', provider: 'meta' })).resolves.toEqual({
      type: 'accounts/error',
      code: 'unavailable',
    })
    dispatch.mockRejectedValue(new Error('account-secret-canary'))
    await expect(panel.dispatch({ type: 'accounts/list', provider: 'meta' })).resolves.toEqual({
      type: 'accounts/error',
      code: 'unavailable',
    })
    const listener = vi.fn()
    panel.subscribe(listener)
    const forwarded = subscribe.mock.calls[0]?.[0]
    if (forwarded === undefined) throw new Error('not subscribed')
    forwarded(state)
    expect(listener).toHaveBeenCalledWith(state)
    forwarded(forgedState())
    expect(listener).toHaveBeenLastCalledWith({ type: 'accounts/error', code: 'unavailable' })
    expect(listener).toHaveBeenCalledTimes(2)
    subscribe.mockImplementation(() => {
      throw new Error('account-secret-canary')
    })
    expect(() => panel.subscribe(vi.fn())).toThrow(UI_TEXT.accounts.unavailable)
  })
})
