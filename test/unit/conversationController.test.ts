import { describe, expect, it, vi } from 'vitest'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import type { AuthService, AuthSnapshot } from '../../src/host/auth/authService'
import {
  ConversationController,
  NO_WORKSPACE_REASON,
  NOT_SIGNED_IN_REASON,
} from '../../src/host/conversation/conversationController'
import { FakeLogOutputChannel, fakeSurface } from './helpers/fakes'
import { fakeMspHost, settle } from './helpers/fakeMsp'

interface FakeAuth {
  readonly service: AuthService
  readonly calls: string[]
  snapshot: AuthSnapshot
}

function fakeAuth(status: AuthSnapshot['status'] = 'signedIn'): FakeAuth {
  const calls: string[] = []
  const state: FakeAuth = {
    calls,
    snapshot: { status, detail: undefined },
    // Only the members the controller touches are implemented; the class type
    // is satisfied through a structural stand-in.
    service: {
      get current() {
        return state.snapshot
      },
      toMessage: () => ({ type: 'authState', status: state.snapshot.status }),
      signIn: (method: string) => {
        calls.push(`signIn:${method}`)
        return Promise.resolve(state.snapshot)
      },
      signOut: () => {
        calls.push('signOut')
        return Promise.resolve(state.snapshot)
      },
      refresh: () => {
        calls.push('refresh')
        return Promise.resolve(state.snapshot)
      },
      markAuthRequired: (reason: string) => {
        calls.push(`authRequired:${reason}`)
        state.snapshot = { status: 'signedOut', detail: reason }
        return state.snapshot
      },
      markBackendError: (detail: string) => {
        calls.push(`error:${detail}`)
        state.snapshot = { status: 'error', detail }
        return state.snapshot
      },
    } as unknown as AuthService,
  }
  return state
}

function setup(
  options: { status?: AuthSnapshot['status']; workspaceRoot?: string | undefined } = {},
) {
  const handle = fakeMspHost()
  handle.server.handle('session/start', (params) => ({
    session: { sessionId: 's1', modelId: params['modelId'], status: 'idle' },
    viewCursor: '',
  }))
  handle.server.handle('turn/start', (params) => ({
    turnId: 't1',
    status: 'accepted',
    disposition: 'started',
    startedNewTurn: true,
    commandId: params['commandId'],
  }))
  handle.server.handle('turn/cancel', () => ({ status: 'accepted' }))
  handle.server.handle('model/list', () => ({
    providerId: 'meta',
    profileId: null,
    source: 'catalog',
    models: [
      { modelId: 'muse-spark-1.3', displayLabel: 'x', contextLimit: 1_007_997, isDefault: false },
    ],
  }))
  const log = new FakeLogOutputChannel()
  const host = new MuseCodeHost(handle.host, log)
  const auth = fakeAuth(options.status)
  const surface = fakeSurface('s')
  const openExternal = vi.fn()
  const controller = new ConversationController({
    surface,
    auth: auth.service,
    ensureHost: () => Promise.resolve(host),
    workspaceRoot: 'workspaceRoot' in options ? options.workspaceRoot : '/ws',
    modelId: 'muse-spark-1.3',
    approvalMode: 'denyUnmatched',
    openExternal,
    log,
  })
  return { ...handle, host, auth, surface, controller, openExternal, log }
}

describe('ConversationController.surfaceReady', () => {
  it('replays the auth state, and the session info once a session exists', async () => {
    const t = setup()
    t.controller.surfaceReady()
    expect(t.surface.posted).toEqual([{ type: 'authState', status: 'signedIn' }])
    await t.controller.handle({ type: 'sendMessage', localId: 'l1', text: 'hi' })
    t.surface.posted.length = 0
    t.controller.surfaceReady()
    expect(t.surface.posted).toEqual([
      { type: 'authState', status: 'signedIn' },
      { type: 'sessionInfo', modelId: 'muse-spark-1.3', contextLimit: 1_007_997 },
    ])
  })
})

describe('ConversationController.sendMessage', () => {
  it('starts a session on first send, submits the turn, and confirms the echo', async () => {
    const t = setup()
    await t.controller.handle({ type: 'sendMessage', localId: 'l1', text: 'hi' })
    expect(t.server.requestsFor('session/start')[0]?.params).toMatchObject({
      workspaceRoot: '/ws',
      modelId: 'muse-spark-1.3',
      approvalMode: 'denyUnmatched',
    })
    expect(t.server.requestsFor('turn/start')[0]?.params).toMatchObject({
      input: [{ type: 'text', text: 'hi' }],
    })
    expect(t.surface.posted).toEqual([
      { type: 'sessionInfo', modelId: 'muse-spark-1.3', contextLimit: 1_007_997 },
      { type: 'turnAccepted', localId: 'l1', turnId: 't1' },
    ])
    await t.controller.handle({ type: 'sendMessage', localId: 'l2', text: 'again' })
    expect(t.server.requestsFor('session/start')).toHaveLength(1)
    expect(t.host.sessionCount).toBe(1)
  })

  it('streams the session events to the surface', async () => {
    const t = setup()
    await t.controller.handle({ type: 'sendMessage', localId: 'l1', text: 'hi' })
    t.server.notify('item/delta', { sessionId: 's1', itemId: 'm', delta: 'yo', viewCursor: 'v' })
    await settle()
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'agentEvent',
      event: { type: 'textDelta', itemId: 'm', field: 'text', delta: 'yo' },
    })
  })

  it('rejects sends while signed out or without a workspace', async () => {
    const signedOut = setup({ status: 'signedOut' })
    await signedOut.controller.handle({ type: 'sendMessage', localId: 'l1', text: 'hi' })
    expect(signedOut.surface.posted).toEqual([
      { type: 'sendFailed', localId: 'l1', reason: NOT_SIGNED_IN_REASON },
    ])
    const noWorkspace = setup({ workspaceRoot: undefined })
    await noWorkspace.controller.handle({ type: 'sendMessage', localId: 'l1', text: 'hi' })
    expect(noWorkspace.surface.posted).toEqual([
      { type: 'sendFailed', localId: 'l1', reason: NO_WORKSPACE_REASON },
    ])
  })

  it('reports a backend failure on the echo and logs it', async () => {
    const t = setup()
    t.server.handle('turn/start', () => {
      throw new Error('boom')
    })
    await t.controller.handle({ type: 'sendMessage', localId: 'l1', text: 'hi' })
    expect(t.surface.posted.at(-1)).toMatchObject({ type: 'sendFailed', localId: 'l1' })
    expect(t.log.error).toHaveBeenCalledOnce()
  })

  it('turns an authRequired failure into a signed-out state', async () => {
    const t = setup()
    await t.controller.handle({ type: 'sendMessage', localId: 'l1', text: 'hi' })
    t.server.notify('turn/completed', {
      sessionId: 's1',
      turnId: 't1',
      terminal: 'failed',
      reason: 'not logged in',
      error: { kind: 'authRequired', message: 'not logged in', retryable: false },
    })
    await settle()
    expect(t.auth.calls).toContain('authRequired:not logged in')
  })
})

describe('ConversationController: other messages', () => {
  it('cancels the running turn', async () => {
    const t = setup()
    await t.controller.handle({ type: 'cancelTurn' })
    expect(t.server.requestsFor('turn/cancel')).toHaveLength(0)
    await t.controller.handle({ type: 'sendMessage', localId: 'l1', text: 'hi' })
    await t.controller.handle({ type: 'cancelTurn' })
    expect(t.server.requestsFor('turn/cancel')).toHaveLength(1)
  })

  it('delegates sign-in, sign-out, retry and external links', async () => {
    const t = setup()
    await t.controller.handle({ type: 'signIn', method: 'apiKey' })
    await t.controller.handle({ type: 'signOut' })
    await t.controller.handle({ type: 'retryBackend' })
    await t.controller.handle({ type: 'openExternal', url: 'https://example.invalid/' })
    expect(t.auth.calls).toEqual(['signIn:apiKey', 'signOut', 'refresh'])
    expect(t.openExternal).toHaveBeenCalledWith('https://example.invalid/')
  })

  it('drops the session and reports an error when the host exits', async () => {
    const t = setup()
    await t.controller.handle({ type: 'sendMessage', localId: 'l1', text: 'hi' })
    t.controller.hostExited('code 1, signal null')
    expect(t.host.sessionCount).toBe(0)
    expect(t.auth.calls.at(-1)).toBe('error:Muse Code stopped unexpectedly. (code 1, signal null)')
    t.controller.dispose()
  })
})
