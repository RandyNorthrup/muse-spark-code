import { describe, expect, it, vi } from 'vitest'
import type { SessionMcpHttpServer } from '../../src/core/agent/agentBackend'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import type { ShellSandboxPosture } from '../../src/core/backends/musecode/sandbox'
import type { EditorContext } from '../../src/core/editorContext'
import type { AuthService, AuthSnapshot } from '../../src/host/auth/authService'
import {
  ConversationController,
  type ConversationDeps,
  type LastSession,
  NO_WORKSPACE_REASON,
  NOT_SIGNED_IN_REASON,
  NOTHING_TO_SEND_REASON,
  type PickedFile,
  type SessionMemory,
} from '../../src/host/conversation/conversationController'
import type { HostAction, MentionItem } from '../../src/shared/protocol'
import { FakeLogOutputChannel, fakeSurface } from './helpers/fakes'
import { fakeModelApi } from './helpers/fakeModelApi'
import { noopToolIo } from './helpers/fakeToolIo'
import { fakeInitializeResult, fakeMspHost, settle } from './helpers/fakeMsp'

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

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2,
  0, 0, 0, 3,
])

const NOW = Date.parse('2026-09-22T12:00:00Z')

const composerState = {
  type: 'composerState',
  effort: 'high',
  isThinkingEnabled: true,
  permissionMode: 'manual',
}
const modelList = {
  type: 'modelList',
  models: [
    { modelId: 'muse-spark-1.3', displayLabel: 'x', contextLimit: 1_007_997, isDefault: false },
    { modelId: 'muse-spark-1.2', displayLabel: 'y', isDefault: true },
  ],
}
const sessionInfo = {
  type: 'sessionInfo',
  modelId: 'muse-spark-1.3',
  contextLimit: 1_007_997,
  sessionId: 's1',
}
const skillList = {
  type: 'skillList',
  skills: [{ selector: 'fix-bug', displayName: 'Fix bug', description: 'd', argumentHint: 'h' }],
}

/** Attaches the 2×3 test PNG through the paste/drop path. */
function attachPng(t: { controller: ConversationController }): Promise<void> {
  return t.controller.handle({
    type: 'attachImageData',
    name: 'a.png',
    mediaType: 'image/png',
    base64: Buffer.from(PNG).toString('base64'),
  })
}

function setup(
  options: {
    status?: AuthSnapshot['status']
    workspaceRoot?: string | undefined
    hasApprovalUi?: boolean
    initialPermissionMode?: ConversationDeps['initialPermissionMode']
    isBypassAllowed?: boolean
    platform?: NodeJS.Platform
    userProfileDir?: string
    editorContext?: EditorContext
    isAutosaveEnabled?: boolean
    /** Files the fake mention index lists (for the selection-text rule). */
    indexed?: readonly string[]
    ideMcpEndpoint?: SessionMcpHttpServer
    grantedCapabilities?: readonly string[]
    shellSandbox?: ShellSandboxPosture
    /** Contributor-tier guard (M7). */
    isConfidentialWorkspace?: boolean
    confirmsContributor?: boolean
    /** Session history memory (M6). */
    archivedIds?: readonly string[]
    lastSession?: LastSession
    isRestorable?: boolean
    now?: number
  } = {},
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
  handle.server.handle('turn/steer', (params) => ({
    turnId: 't1',
    status: 'accepted',
    commandId: params['commandId'],
  }))
  handle.server.handle('turn/cancel', (params) => ({
    status: 'accepted',
    commandId: params['commandId'],
  }))
  handle.server.handle('session/setModel', (params) => ({
    status: 'accepted',
    commandId: params['commandId'],
  }))
  handle.server.handle('session/setReasoningEffort', (params) => ({
    status: 'accepted',
    commandId: params['commandId'],
  }))
  handle.server.handle('session/setApprovalMode', (params) => ({
    status: 'accepted',
    commandId: params['commandId'],
    applyOutcome: 'completed',
    effectiveMode: { mode: params['mode'], source: 'approvalReconfigure' },
  }))
  handle.server.handle('session/compact', (params) => ({
    status: 'accepted',
    commandId: params['commandId'],
  }))
  // The stored session `old` runs on 1.2 (its active row), as a resume must learn.
  handle.server.handle('model/list', (params) => ({
    providerId: 'meta',
    profileId: null,
    source: 'catalog',
    models: [
      { modelId: 'muse-spark-1.3', displayLabel: 'x', contextLimit: 1_007_997, isDefault: false },
      {
        modelId: 'muse-spark-1.2',
        displayLabel: 'y',
        contextLimit: null,
        isDefault: true,
        isActive: params['sessionId'] === 'old',
      },
    ],
  }))
  handle.server.handle('skill/list', () => ({
    skills: [
      {
        selector: 'fix-bug',
        displayName: 'Fix bug',
        description: 'd',
        argumentHint: 'h',
        source: 'project',
      },
    ],
  }))
  handle.server.handle('item/readOutput', (params) => ({
    content: `{"files":[{"path":"notes.md","hunks":[]}]}#${String(params['outputRef'])}`,
    encoding: 'utf8',
    mediaType: 'application/json',
    offsetBytes: 0,
    byteLen: 40,
    eof: true,
  }))
  const log = new FakeLogOutputChannel()
  const host = new MuseCodeHost(
    {
      ...handle.host,
      initializeResult: {
        ...fakeInitializeResult,
        grantedCapabilities: [...(options.grantedCapabilities ?? [])],
      },
    },
    log,
  )
  const auth = fakeAuth(options.status)
  const surface = fakeSurface('s')
  const openExternal = vi.fn<(url: string) => void>()
  const hostActions: HostAction[] = []
  let picked: PickedFile[] = []
  let mentionChoice: string | undefined = undefined
  let isBypassAllowed = options.isBypassAllowed ?? true
  let attachmentCount = 0
  const copied: string[] = []
  const inserted: string[] = []
  let hasEditor = true
  const onSandboxUnavailable = vi.fn<() => void>()
  const saveAll = vi.fn(() => Promise.resolve())
  const applied: string[] = []
  const reviews: [string, string, string][] = []
  const contributorPrompts: string[] = []
  const memory = {
    archivedIds: [...(options.archivedIds ?? [])] as readonly string[],
    lastSession: options.lastSession,
  }
  const sessions: SessionMemory = {
    archivedIds: () => memory.archivedIds,
    setArchivedIds: (ids) => {
      memory.archivedIds = ids
      return Promise.resolve()
    },
    lastSession: () => memory.lastSession,
    setLastSession: (last) => {
      memory.lastSession = last
      return Promise.resolve()
    },
  }
  const deps: ConversationDeps = {
    surface,
    auth: auth.service,
    ensureHost: () => Promise.resolve(host),
    workspaceRoot: 'workspaceRoot' in options ? options.workspaceRoot : '/ws',
    modelId: 'muse-spark-1.3',
    initialPermissionMode: options.initialPermissionMode ?? 'manual',
    hasApprovalUi: options.hasApprovalUi ?? false,
    openExternal,
    mentions: {
      search: (query: string, limit: number) => {
        const items: MentionItem[] = [
          { path: `${query}.ts`, isFolder: false },
          { path: `${query}/`, isFolder: true },
        ]
        return Promise.resolve(items.slice(0, limit))
      },
      contains: (relativePath: string) =>
        Promise.resolve((options.indexed ?? ['src/a.ts']).includes(relativePath)),
    },
    files: {
      showOpenDialog: () => Promise.resolve(picked),
      readFile: (fsPath: string) =>
        fsPath.endsWith('.png') ? Promise.resolve(PNG) : Promise.resolve(Uint8Array.from([1])),
      pickMentionFile: () => Promise.resolve(mentionChoice),
      toRelativePath: (uri: string) =>
        uri.startsWith('file:///ws/') ? uri.slice('file:///ws/'.length) : undefined,
    },
    isBypassAllowed: () => isBypassAllowed,
    isConfidentialWorkspace: () => options.isConfidentialWorkspace ?? false,
    confirmContributor: (modelId: string) => {
      contributorPrompts.push(modelId)
      return Promise.resolve(options.confirmsContributor ?? true)
    },
    runHostAction: (action: HostAction) => {
      hostActions.push(action)
      return action === 'openLog' ? Promise.reject(new Error('no channel')) : Promise.resolve()
    },
    copyText: (text: string) => {
      copied.push(text)
      return Promise.resolve()
    },
    insertCode: (text: string) => {
      inserted.push(text)
      return Promise.resolve(hasEditor)
    },
    onSandboxUnavailable,
    platform: options.platform ?? 'linux',
    userProfileDir: options.userProfileDir,
    shellSandbox: () => options.shellSandbox ?? { isSandboxed: true, reason: 'default' },
    editorContext: () => options.editorContext,
    isAutosaveEnabled: () => options.isAutosaveEnabled ?? false,
    saveAll,
    applyCode: (text: string) => {
      applied.push(text)
      return Promise.resolve(hasEditor)
    },
    editReview: {
      openDiff: (itemId: string, patchJson: string) => {
        reviews.push(['openDiff', itemId, patchJson])
        return Promise.resolve([{ level: 'info' as const, text: `opened ${itemId}` }])
      },
      revert: (itemId: string, patchJson: string) => {
        reviews.push(['revert', itemId, patchJson])
        return Promise.resolve([{ level: 'info' as const, text: `reverted ${itemId}` }])
      },
    },
    ideMcpEndpoint: () => options.ideMcpEndpoint,
    newAttachmentId: () => {
      attachmentCount += 1
      return `att-${String(attachmentCount)}`
    },
    sessions,
    isRestorable: options.isRestorable ?? false,
    now: () => options.now ?? NOW,
    log,
  }
  const controller = new ConversationController(deps)
  const send = (localId: string, text: string, attachmentIds: string[] = []) =>
    controller.handle({ type: 'sendMessage', localId, text, attachmentIds })
  const finishTurn = () => {
    handle.server.notify('turn/completed', { sessionId: 's1', turnId: 't1', terminal: 'completed' })
  }
  return {
    finishTurn,
    ...handle,
    host,
    auth,
    surface,
    controller,
    deps,
    openExternal,
    log,
    hostActions,
    send,
    setPicked: (files: PickedFile[]) => {
      picked = files
    },
    setMentionChoice: (path: string | undefined) => {
      mentionChoice = path
    },
    setBypassAllowed: (isAllowed: boolean) => {
      isBypassAllowed = isAllowed
    },
    copied,
    inserted,
    onSandboxUnavailable,
    saveAll,
    applied,
    reviews,
    memory,
    contributorPrompts,
    setHasEditor: (isOpen: boolean) => {
      hasEditor = isOpen
    },
  }
}

describe('ConversationController.surfaceReady', () => {
  it('replays auth and composer state, then models, session, skills and attachments', async () => {
    const t = setup()
    t.controller.surfaceReady()
    expect(t.surface.posted).toEqual([{ type: 'authState', status: 'signedIn' }, composerState])
    await t.send('l1', 'hi')
    await settle()
    await attachPng(t)
    t.surface.posted.length = 0
    t.controller.surfaceReady()
    expect(t.surface.posted).toEqual([
      { type: 'authState', status: 'signedIn' },
      composerState,
      modelList,
      sessionInfo,
      skillList,
      {
        type: 'attachmentAdded',
        attachment: {
          id: 'att-1',
          name: 'a.png',
          mediaType: 'image/png',
          width: 2,
          height: 3,
          sizeBytes: PNG.length,
        },
      },
    ])
  })
})

describe('ConversationController.sendMessage', () => {
  it('starts a session on first send, applies effort, submits, confirms, loads skills', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    await settle()
    expect(t.server.requestsFor('session/start')[0]?.params).toMatchObject({
      workspaceRoot: '/ws',
      modelId: 'muse-spark-1.3',
      approvalMode: 'denyUnmatched',
    })
    expect(t.server.requestsFor('session/setReasoningEffort')[0]?.params).toMatchObject({
      sessionId: 's1',
      reasoningEffort: 'high',
    })
    expect(t.server.requestsFor('turn/start')[0]?.params).toMatchObject({
      input: [{ type: 'text', text: 'hi' }],
    })
    expect(t.surface.posted).toEqual([
      modelList,
      sessionInfo,
      skillList,
      { type: 'turnAccepted', localId: 'l1', turnId: 't1' },
    ])
    await t.send('l2', 'again')
    expect(t.server.requestsFor('session/start')).toHaveLength(1)
    expect(t.host.sessionCount).toBe(1)
  })

  it('steers a running turn and falls back to a fresh turn when the steer is rejected', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    t.server.notify('turn/started', { sessionId: 's1', turnId: 't1', viewCursor: 'v' })
    await settle()
    await t.send('l2', 'also this')
    expect(t.server.requestsFor('turn/steer')[0]?.params).toMatchObject({
      expectedTurnId: 't1',
      input: [{ type: 'text', text: 'also this' }],
    })
    expect(t.surface.posted.at(-1)).toEqual({ type: 'turnAccepted', localId: 'l2', turnId: 't1' })
    t.server.handle('turn/steer', () => {
      throw new Error('turn t1 is not running')
    })
    await t.send('l3', 'late')
    expect(t.server.requestsFor('turn/start')).toHaveLength(2)
    expect(t.log.warn).toHaveBeenCalledWith(expect.stringContaining('turn/steer failed'))
    t.server.notify('turn/completed', { sessionId: 's1', turnId: 't1', terminal: 'completed' })
    await settle()
    await t.send('l4', 'fresh')
    expect(t.server.requestsFor('turn/steer')).toHaveLength(2)
    expect(t.server.requestsFor('turn/start')).toHaveLength(3)
  })

  it('sends attached images as image parts and a known skill as a skill part', async () => {
    const t = setup()
    await attachPng(t)
    await t.send('l1', 'look', ['att-1', 'ghost'])
    await settle()
    t.finishTurn()
    await settle()
    expect(t.server.requestsFor('turn/start')[0]?.params).toMatchObject({
      input: [
        { type: 'text', text: 'look' },
        {
          type: 'image',
          mediaType: 'image/png',
          width: 2,
          height: 3,
          base64Data: Buffer.from(PNG).toString('base64'),
        },
      ],
    })
    await t.send('l2', '/fix-bug the parser')
    expect(t.server.requestsFor('turn/start')[1]?.params).toMatchObject({
      input: [{ type: 'skill', selector: 'fix-bug', arguments: 'the parser' }],
    })
    t.finishTurn()
    await settle()
    await t.send('l3', '/unknown-skill')
    expect(t.server.requestsFor('turn/start')[2]?.params).toMatchObject({
      input: [{ type: 'text', text: '/unknown-skill' }],
    })
  })

  it('rejects an empty send, and sends while signed out or without a workspace', async () => {
    const t = setup()
    await t.send('l0', ' '.repeat(3))
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'sendFailed',
      localId: 'l0',
      reason: NOTHING_TO_SEND_REASON,
    })
    const signedOut = setup({ status: 'signedOut' })
    await signedOut.send('l1', 'hi')
    expect(signedOut.surface.posted).toEqual([
      { type: 'sendFailed', localId: 'l1', reason: NOT_SIGNED_IN_REASON },
    ])
    const noWorkspace = setup({ workspaceRoot: undefined })
    await noWorkspace.send('l1', 'hi')
    expect(noWorkspace.surface.posted).toEqual([
      { type: 'sendFailed', localId: 'l1', reason: NO_WORKSPACE_REASON },
    ])
  })

  it('reports a backend failure on the echo and logs it', async () => {
    const t = setup()
    t.server.handle('turn/start', () => {
      throw new Error('boom')
    })
    await t.send('l1', 'hi')
    expect(t.surface.posted.at(-1)).toMatchObject({ type: 'sendFailed', localId: 'l1' })
    expect(t.log.error).toHaveBeenCalledOnce()
  })

  it('turns an authRequired failure into a signed-out state', async () => {
    const t = setup()
    await t.send('l1', 'hi')
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

  it('warns when the host refuses the reasoning effort but still sends', async () => {
    const t = setup()
    t.server.handle('session/setReasoningEffort', () => {
      throw new Error('not adjustable')
    })
    await t.send('l1', 'hi')
    expect(t.surface.posted).toContainEqual({
      type: 'notice',
      level: 'warning',
      text: expect.stringContaining('Reasoning effort could not be applied') as string,
    })
    expect(t.surface.posted).toContainEqual({
      type: 'notice',
      level: 'warning',
      text: expect.stringContaining('not adjustable') as string,
    })
    expect(t.surface.posted.at(-1)).toMatchObject({ type: 'turnAccepted' })
  })
})

describe('ConversationController: composer controls', () => {
  it('stores a model choice before a session and applies it live afterwards', async () => {
    const t = setup()
    await t.controller.handle({ type: 'setModel', modelId: 'muse-spark-1.2' })
    expect(t.surface.posted).toEqual([{ type: 'sessionInfo', modelId: 'muse-spark-1.2' }])
    await t.send('l1', 'hi')
    expect(t.server.requestsFor('session/start')[0]?.params).toMatchObject({
      modelId: 'muse-spark-1.2',
    })
    await t.controller.handle({ type: 'setModel', modelId: 'muse-spark-1.3' })
    expect(t.server.requestsFor('session/setModel')[0]?.params).toMatchObject({
      sessionId: 's1',
      model: { modelId: 'muse-spark-1.3' },
    })
    expect(t.surface.posted.at(-1)).toEqual(sessionInfo)
    t.server.handle('session/setModel', () => {
      throw new Error('unknown model')
    })
    await t.controller.handle({ type: 'setModel', modelId: 'nope' })
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'notice',
      level: 'error',
      text: expect.stringContaining('Could not switch model') as string,
    })
    expect(t.surface.posted.at(-1)).toMatchObject({
      text: expect.stringContaining('unknown model') as string,
    })
  })

  it('drops the effort to the highest tier the new model serves', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    await t.controller.handle({ type: 'setEffort', effort: 'max' })
    expect(t.server.requestsFor('session/setReasoningEffort').at(-1)?.params).toMatchObject({
      reasoningEffort: 'max',
    })
    await t.controller.handle({ type: 'setModel', modelId: 'muse-spark-1.2' })
    expect(t.server.requestsFor('session/setReasoningEffort').at(-1)?.params).toMatchObject({
      reasoningEffort: 'xhigh',
    })
    expect(t.surface.posted.at(-1)).toEqual({ ...composerState, effort: 'xhigh' })
    // Back on 1.3 the tier stays where it is: nothing to clamp.
    await t.controller.handle({ type: 'setModel', modelId: 'muse-spark-1.3' })
    expect(t.server.requestsFor('session/setReasoningEffort')).toHaveLength(3)
  })

  it('applies effort and thinking changes to the session and echoes the state', async () => {
    const t = setup()
    await t.controller.handle({ type: 'setEffort', effort: 'max' })
    expect(t.surface.posted.at(-1)).toEqual({ ...composerState, effort: 'max' })
    await t.send('l1', 'hi')
    expect(t.server.requestsFor('session/setReasoningEffort')[0]?.params).toMatchObject({
      reasoningEffort: 'max',
    })
    await t.controller.handle({ type: 'setThinking', enabled: false })
    expect(t.server.requestsFor('session/setReasoningEffort')[1]?.params).toMatchObject({
      reasoningEffort: 'none',
    })
    expect(t.surface.posted.at(-1)).toEqual({
      ...composerState,
      effort: 'max',
      isThinkingEnabled: false,
    })
    await t.controller.toggleThinking()
    expect(t.server.requestsFor('session/setReasoningEffort')[2]?.params).toMatchObject({
      reasoningEffort: 'max',
    })
  })

  it('follows a host-driven effort change and a skill-set change', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    await settle()
    t.surface.posted.length = 0
    t.server.notify('session/reasoningEffortChanged', {
      sessionId: 's1',
      reasoningEffort: 'low',
      source: 'policy',
      viewCursor: 'v',
    })
    t.server.notify('session/reasoningEffortChanged', {
      sessionId: 's1',
      reasoningEffort: 'ultra',
      source: 'policy',
      viewCursor: 'v',
    })
    t.server.notify('skill/changed', { sessionId: 's1' })
    await settle()
    expect(t.surface.posted).toContainEqual({ ...composerState, effort: 'low' })
    expect(t.server.requestsFor('skill/list')).toHaveLength(2)
    expect(t.surface.posted.filter((m) => m.type === 'skillList')).toHaveLength(1)
  })

  it('maps permission modes onto approval modes and gates bypass on the setting', async () => {
    const t = setup({ initialPermissionMode: 'plan' })
    await t.send('l1', 'hi')
    expect(t.server.requestsFor('session/start')[0]?.params).toMatchObject({
      approvalMode: 'denyUnmatched',
    })
    await t.controller.handle({ type: 'setPermissionMode', mode: 'manual' })
    expect(t.server.requestsFor('session/setApprovalMode')).toHaveLength(0)
    expect(t.surface.posted.at(-1)).toEqual({ ...composerState, permissionMode: 'manual' })
    t.setBypassAllowed(false)
    await t.controller.handle({ type: 'setPermissionMode', mode: 'bypassPermissions' })
    expect(t.server.requestsFor('session/setApprovalMode')).toHaveLength(0)
    expect(t.surface.posted.at(-2)).toEqual({
      type: 'notice',
      level: 'warning',
      text: expect.stringContaining('Allow dangerously skip permissions') as string,
    })
    expect(t.surface.posted.at(-1)).toEqual({ ...composerState, permissionMode: 'manual' })
    t.setBypassAllowed(true)
    await t.controller.handle({ type: 'setPermissionMode', mode: 'bypassPermissions' })
    expect(t.server.requestsFor('session/setApprovalMode')[0]?.params).toMatchObject({
      mode: 'allowAll',
    })
    expect(t.surface.posted.at(-1)).toEqual({
      ...composerState,
      permissionMode: 'bypassPermissions',
    })
    t.server.handle('session/setApprovalMode', () => {
      throw new Error('locked')
    })
    await t.controller.handle({ type: 'setPermissionMode', mode: 'plan' })
    expect(t.surface.posted.at(-2)).toEqual({
      type: 'notice',
      level: 'error',
      text: expect.stringContaining('Could not change the permission mode') as string,
    })
    expect(t.surface.posted.at(-2)).toMatchObject({
      text: expect.stringContaining('locked') as string,
    })
    expect(t.surface.posted.at(-1)).toEqual({
      ...composerState,
      permissionMode: 'bypassPermissions',
    })
  })

  it('starts in Manual when the initial mode is Bypass but the setting is off', async () => {
    const t = setup({ initialPermissionMode: 'bypassPermissions', isBypassAllowed: false })
    t.controller.surfaceReady()
    expect(t.surface.posted).toContainEqual({ ...composerState, permissionMode: 'manual' })
    expect(String(t.log.warn.mock.calls[0]?.[0])).toContain('allowDangerouslySkipPermissions')
    const allowed = setup({ initialPermissionMode: 'bypassPermissions', isBypassAllowed: true })
    await allowed.send('l1', 'hi')
    expect(allowed.server.requestsFor('session/start')[0]?.params).toMatchObject({
      approvalMode: 'allowAll',
    })
  })

  it('uses the prompting modes once the approval UI exists', async () => {
    const t = setup({ hasApprovalUi: true, initialPermissionMode: 'auto' })
    await t.send('l1', 'hi')
    expect(t.server.requestsFor('session/start')[0]?.params).toMatchObject({
      approvalMode: 'onRequest',
    })
  })

  it('clears the conversation, compacts, and lists skills on demand', async () => {
    const t = setup()
    await t.controller.handle({ type: 'listSkills' })
    expect(t.server.requestsFor('session/start')).toHaveLength(1)
    expect(t.surface.posted.at(-1)).toEqual(skillList)
    await t.controller.handle({ type: 'listSkills' })
    expect(t.server.requestsFor('skill/list')).toHaveLength(1)
    await t.controller.handle({ type: 'compact' })
    expect(t.server.requestsFor('session/compact')).toHaveLength(1)
    t.server.handle('session/compact', () => ({ status: 'noop', reason: 'no_history' }))
    await t.controller.handle({ type: 'compact' })
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'notice',
      level: 'info',
      text: 'Nothing to compact (no_history).',
    })
    t.server.handle('session/compact', () => {
      throw new Error('session/compact command x rejected: missing_run')
    })
    await t.controller.handle({ type: 'compact' })
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'notice',
      level: 'info',
      text: 'Nothing to compact yet.',
    })
    t.server.handle('session/compact', () => {
      throw new Error('disk full')
    })
    await t.controller.handle({ type: 'compact' })
    expect(t.surface.posted.at(-1)).toMatchObject({
      type: 'notice',
      level: 'error',
      text: expect.stringContaining('Compaction failed') as string,
    })
    await t.controller.handle({ type: 'clearConversation' })
    expect(t.host.sessionCount).toBe(0)
    expect(t.surface.posted.at(-1)).toEqual({ type: 'attachmentsCleared' })
    await t.controller.handle({ type: 'compact' })
    expect(t.server.requestsFor('session/start')).toHaveLength(2)
  })

  it('refuses skills, compaction and mentions when signed out', async () => {
    const t = setup({ status: 'signedOut' })
    await t.controller.handle({ type: 'listSkills' })
    await t.controller.handle({ type: 'compact' })
    expect(t.surface.posted).toEqual([
      { type: 'notice', level: 'warning', text: NOT_SIGNED_IN_REASON },
      { type: 'notice', level: 'warning', text: NOT_SIGNED_IN_REASON },
    ])
    expect(t.server.requestsFor('session/start')).toHaveLength(0)
  })
})

describe('ConversationController: context', () => {
  it('answers mention searches with the request id, even on failure', async () => {
    const t = setup()
    await t.controller.handle({ type: 'searchMentions', requestId: 7, query: 'app' })
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'mentionResults',
      requestId: 7,
      items: [
        { path: 'app.ts', isFolder: false },
        { path: 'app/', isFolder: true },
      ],
    })
  })

  it('attaches picked images and mentions other picked files', async () => {
    const t = setup()
    t.setPicked([
      { name: 'shot.png', fsPath: '/tmp/shot.png', relativePath: undefined },
      { name: 'notes.md', fsPath: '/ws/docs/notes.md', relativePath: 'docs/notes.md' },
      { name: 'out.txt', fsPath: String.raw`D:\out.txt`, relativePath: undefined },
    ])
    await t.controller.handle({ type: 'pickFile' })
    expect(t.surface.posted).toEqual([
      {
        type: 'attachmentAdded',
        attachment: {
          id: 'att-1',
          name: 'shot.png',
          mediaType: 'image/png',
          width: 2,
          height: 3,
          sizeBytes: PNG.length,
        },
      },
      { type: 'insertText', text: '@docs/notes.md ' },
      { type: 'insertText', text: '@D:/out.txt ' },
    ])
  })

  it('rejects unsupported image data with the reason', async () => {
    const t = setup()
    await t.controller.handle({
      type: 'attachImageData',
      name: 'x.bmp',
      mediaType: 'image/bmp',
      base64: 'AAAA',
    })
    expect(t.surface.posted).toEqual([
      {
        type: 'attachmentRejected',
        name: 'x.bmp',
        reason: 'Only PNG, JPEG, GIF and WebP images can be attached.',
      },
    ])
  })

  it('removes attachments and drops the parts from later sends', async () => {
    const t = setup()
    await attachPng(t)
    await t.controller.handle({ type: 'removeAttachment', id: 'att-1' })
    await t.send('l1', 'text only', ['att-1'])
    expect(t.server.requestsFor('turn/start')[0]?.params).toMatchObject({
      input: [{ type: 'text', text: 'text only' }],
    })
  })

  it('inserts mentions for the QuickPick choice and for dropped workspace files', async () => {
    const t = setup()
    await t.controller.handle({ type: 'pickMentionFile' })
    t.setMentionChoice('src/app.ts')
    await t.controller.handle({ type: 'pickMentionFile' })
    await t.controller.handle({
      type: 'droppedUris',
      uris: ['file:///ws/a.ts', 'file:///elsewhere/b.ts', 'file:///ws/c.ts'],
    })
    await t.controller.handle({ type: 'droppedUris', uris: ['file:///elsewhere/b.ts'] })
    expect(t.surface.posted).toEqual([
      { type: 'insertText', text: '@src/app.ts ' },
      { type: 'insertText', text: '@a.ts @c.ts ' },
    ])
  })

  it('runs host actions and reports failures', async () => {
    const t = setup()
    await t.controller.handle({ type: 'hostAction', action: 'openSettings' })
    await t.controller.handle({ type: 'hostAction', action: 'openLog' })
    expect(t.hostActions).toEqual(['openSettings', 'openLog'])
    expect(t.surface.posted).toEqual([
      { type: 'notice', level: 'error', text: 'openLog failed: no channel' },
    ])
  })
})

describe('ConversationController: transcript actions (M4)', () => {
  it('forwards approval decisions and answers to the session and reports rejections', async () => {
    const t = setup()
    t.server.handle('approval/decide', (params) => ({
      status: 'accepted',
      commandId: params['commandId'],
      approvalId: params['approvalId'],
      terminal: true,
    }))
    t.server.handle('userInput/answer', (params) => ({
      status: 'accepted',
      commandId: params['commandId'],
      userInputId: params['userInputId'],
    }))
    // Without a session the messages are ignored, never sent.
    await t.controller.handle({
      type: 'decideApproval',
      approvalId: 'a1',
      choiceId: 'allow_once',
      requirementId: { approvalId: 'a1', sourceIndex: 0 },
    })
    expect(t.server.requestsFor('approval/decide')).toHaveLength(0)
    await t.send('l1', 'hi')
    await t.controller.handle({
      type: 'decideApproval',
      approvalId: 'a1',
      choiceId: 'abort',
      requirementId: { approvalId: 'a1', sourceIndex: 0 },
      feedback: 'not that',
    })
    expect(t.server.requestsFor('approval/decide')[0]?.params).toMatchObject({
      sessionId: 's1',
      approvalId: 'a1',
      choiceId: 'abort',
      feedback: 'not that',
    })
    await t.controller.handle({
      type: 'answerQuestion',
      userInputId: 'q1',
      answers: [{ questionId: 'c', selectedLabel: 'Red' }],
    })
    expect(t.server.requestsFor('userInput/answer')[0]?.params).toMatchObject({
      userInputId: 'q1',
      answers: [{ questionId: 'c', selectedLabel: 'Red' }],
    })
    t.server.handle('approval/decide', () => {
      throw new Error('stale requirement')
    })
    await t.controller.handle({
      type: 'decideApproval',
      approvalId: 'a1',
      choiceId: 'allow_once',
      requirementId: { approvalId: 'a1', sourceIndex: 0 },
    })
    expect(t.surface.posted.at(-1)).toMatchObject({
      type: 'notice',
      level: 'error',
      text: expect.stringContaining('stale requirement') as string,
    })
    t.server.handle('userInput/answer', () => {
      throw new Error('invalid answer')
    })
    await t.controller.handle({ type: 'answerQuestion', userInputId: 'q1', answers: [] })
    expect(t.surface.posted.at(-1)).toMatchObject({
      text: expect.stringContaining('invalid answer') as string,
    })
  })

  it('serves output pages and reports a failed fetch', async () => {
    const t = setup()
    t.server.handle('item/readOutput', (params) => ({
      content: '{"files":[]}',
      encoding: 'utf8',
      mediaType: 'application/json',
      offsetBytes: params['offsetBytes'],
      byteLen: 12,
      eof: true,
    }))
    await t.controller.handle({ type: 'readOutput', itemId: 'c', outputRef: 'p', offsetBytes: 0 })
    expect(t.server.requestsFor('item/readOutput')).toHaveLength(0)
    await t.send('l1', 'hi')
    await t.controller.handle({ type: 'readOutput', itemId: 'c', outputRef: 'p', offsetBytes: 0 })
    expect(t.server.requestsFor('item/readOutput')[0]?.params).toMatchObject({
      itemId: 'c',
      outputRef: 'p',
      offsetBytes: 0,
      lengthBytes: 262_144,
    })
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'outputPage',
      itemId: 'c',
      outputRef: 'p',
      offsetBytes: 0,
      byteLen: 12,
      content: '{"files":[]}',
      eof: true,
    })
    t.server.handle('item/readOutput', () => {
      throw new Error('missing')
    })
    await t.controller.handle({ type: 'readOutput', itemId: 'c', outputRef: 'p', offsetBytes: 0 })
    expect(t.surface.posted.at(-1)).toMatchObject({
      type: 'notice',
      level: 'error',
      text: expect.stringContaining('missing') as string,
    })
  })

  it('copies and inserts code, explaining when no editor is open', async () => {
    const t = setup()
    await t.controller.handle({ type: 'copyText', text: 'const a = 1' })
    expect(t.copied).toEqual(['const a = 1'])
    await t.controller.handle({ type: 'insertCode', text: 'x' })
    expect(t.inserted).toEqual(['x'])
    expect(t.surface.posted.filter((m) => m.type === 'notice')).toHaveLength(0)
    t.setHasEditor(false)
    await t.controller.handle({ type: 'insertCode', text: 'y' })
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'notice',
      level: 'info',
      text: 'Open a text editor to insert code into it.',
    })
  })

  it('opens http, https and mailto links only', async () => {
    const t = setup()
    await t.controller.handle({ type: 'openExternal', url: 'https://dev.meta.ai/' })
    await t.controller.handle({ type: 'openExternal', url: 'mailto:someone@example.com' })
    expect(t.openExternal.mock.calls.map(([url]) => url)).toEqual([
      'https://dev.meta.ai/',
      'mailto:someone@example.com',
    ])
    await t.controller.handle({ type: 'openExternal', url: 'file:///etc/passwd' })
    await t.controller.handle({ type: 'openExternal', url: 'not a url' })
    expect(t.openExternal).toHaveBeenCalledTimes(2)
    expect(t.surface.posted.filter((m) => m.type === 'notice')).toHaveLength(2)
    expect(t.surface.posted.at(-1)).toMatchObject({
      level: 'warning',
      text: expect.stringContaining('Only http, https and mailto') as string,
    })
  })

  it('explains the sandbox setup once when the shell tool cannot run', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    const failure = {
      sessionId: 's1',
      item: {
        itemId: 'c1',
        kind: 'toolCall',
        status: 'failed',
        tool: 'powershell',
        failureReason:
          'environment failure: sandbox enforcement unavailable: windows_elevated setup_required',
      },
    }
    t.server.notify('item/completed', failure)
    t.server.notify('item/completed', { ...failure, item: { ...failure.item, itemId: 'c2' } })
    await settle()
    const notices = t.surface.posted.filter(
      (m) => m.type === 'notice' && m.text.includes('Set Up Shell Sandbox'),
    )
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ level: 'warning' })
    // The host gets one chance to offer the elevated setup for the failure.
    expect(t.onSandboxUnavailable).toHaveBeenCalledTimes(1)
  })

  it('leaves other tool failures to the transcript', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    t.server.notify('item/completed', {
      sessionId: 's1',
      item: {
        itemId: 'c1',
        kind: 'toolCall',
        status: 'failed',
        tool: 'read_file',
        failureReason: 'no such file',
      },
    })
    await settle()
    expect(t.surface.posted.filter((m) => m.type === 'notice')).toHaveLength(0)
    expect(t.onSandboxUnavailable).not.toHaveBeenCalled()
  })

  it('warns once per session when the sandbox is forced on for a profile workspace', async () => {
    // The fake server reports 1.3.0-test, an affected version.
    const t = setup({
      platform: 'win32',
      userProfileDir: String.raw`C:\Users\randy`,
      workspaceRoot: String.raw`c:\users\RANDY\Coding\project`,
      shellSandbox: { isSandboxed: true, reason: 'setting' },
    })
    await t.send('l1', 'hi')
    await t.send('l2', 'again')
    const notices = t.surface.posted.filter(
      (m) => m.type === 'notice' && m.text.includes('under your user profile'),
    )
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({
      level: 'warning',
      text: expect.stringContaining('shell commands will start in the PowerShell folder') as string,
    })
  })

  it('explains once when auto turned the sandbox off for a profile workspace', async () => {
    const t = setup({
      platform: 'win32',
      userProfileDir: String.raw`C:\Users\randy`,
      workspaceRoot: String.raw`C:\Users\randy\project`,
      shellSandbox: { isSandboxed: false, reason: 'profileWorkspace' },
    })
    await t.send('l1', 'hi')
    const notices = t.surface.posted.filter((m) => m.type === 'notice')
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({
      level: 'info',
      text: expect.stringContaining('runs shell commands without the sandbox') as string,
    })
  })

  it('says nothing when the user chose off, or when the sandbox is on and works', async () => {
    const off = setup({
      platform: 'win32',
      userProfileDir: String.raw`C:\Users\randy`,
      workspaceRoot: String.raw`C:\Users\randy\project`,
      shellSandbox: { isSandboxed: false, reason: 'setting' },
    })
    await off.send('l1', 'hi')
    expect(off.surface.posted.filter((m) => m.type === 'notice')).toHaveLength(0)
  })

  it('stays quiet for a workspace outside the profile and off Windows', async () => {
    const outside = setup({
      platform: 'win32',
      userProfileDir: String.raw`C:\Users\randy`,
      workspaceRoot: String.raw`C:\src\project`,
    })
    await outside.send('l1', 'hi')
    const posix = setup({ platform: 'darwin', workspaceRoot: '/Users/randy/project' })
    await posix.send('l1', 'hi')
    for (const t of [outside, posix]) {
      expect(t.surface.posted.filter((m) => m.type === 'notice')).toHaveLength(0)
    }
  })
})

const sendWithContext = (t: ReturnType<typeof setup>, text = 'explain') =>
  t.controller.handle({
    type: 'sendMessage',
    localId: 'l1',
    text,
    attachmentIds: [],
    includeEditorContext: true,
  })
const turnStartParams = (t: ReturnType<typeof setup>) =>
  t.server.requestsFor('turn/start')[0]?.params ?? {}

describe('ConversationController: editor integration (M5)', () => {
  const selection: EditorContext = {
    relativePath: 'src/a.ts',
    startLine: 5,
    endLine: 6,
    isEmpty: false,
    selectedText: 'const a = 1',
  }

  it('appends the selection as an ide_selection part and keeps the typed text as displayText', async () => {
    const t = setup({ editorContext: selection })
    await sendWithContext(t)
    const params = turnStartParams(t)
    expect(params['input']).toEqual([
      { type: 'text', text: 'explain' },
      {
        type: 'text',
        text: '<ide_selection>The user selected the lines 5 to 6 from src/a.ts:\nconst a = 1\n</ide_selection>',
      },
    ])
    expect(params['displayText']).toBe('explain')
  })

  it('shares only the path of a file the mention index does not list', async () => {
    const t = setup({ editorContext: selection, indexed: [] })
    await sendWithContext(t)
    const parts = turnStartParams(t)['input'] as { text: string }[]
    expect(parts[1]?.text).toContain('not shared')
    expect(parts[1]?.text).not.toContain('const a = 1')
  })

  it('names the open file when nothing is selected, and adds nothing when the chip is off', async () => {
    const opened = setup({
      editorContext: { ...selection, isEmpty: true, selectedText: undefined },
    })
    await sendWithContext(opened)
    expect((turnStartParams(opened)['input'] as { text: string }[])[1]?.text).toContain(
      '<ide_opened_file>The user opened the file src/a.ts',
    )
    const off = setup({ editorContext: selection })
    await off.send('l1', 'explain')
    expect(turnStartParams(off)['input']).toEqual([{ type: 'text', text: 'explain' }])
    expect(turnStartParams(off)['displayText']).toBeUndefined()
  })

  it('saves every editor before the turn when autosave is on, and never otherwise', async () => {
    const on = setup({ isAutosaveEnabled: true })
    await on.send('l1', 'hi')
    expect(on.saveAll).toHaveBeenCalledTimes(1)
    expect(on.server.requestsFor('turn/start')).toHaveLength(1)
    const off = setup({ isAutosaveEnabled: false })
    await off.send('l1', 'hi')
    expect(off.saveAll).not.toHaveBeenCalled()
  })

  it('logs a failed autosave and still sends', async () => {
    const t = setup({ isAutosaveEnabled: true })
    t.saveAll.mockRejectedValueOnce(new Error('disk full'))
    await t.send('l1', 'hi')
    expect(t.log.warn).toHaveBeenCalledWith(expect.stringContaining('disk full'))
    expect(t.server.requestsFor('turn/start')).toHaveLength(1)
  })

  it('applies code into the editor, or explains when none is open', async () => {
    const t = setup()
    await t.controller.handle({ type: 'applyCode', text: 'x = 1' })
    expect(t.applied).toEqual(['x = 1'])
    t.setHasEditor(false)
    await t.controller.handle({ type: 'applyCode', text: 'y' })
    expect(t.surface.posted.at(-1)).toMatchObject({
      type: 'notice',
      level: 'info',
      text: 'Open a text editor to apply code into it.',
    })
  })

  it('fetches the stored patch for a review and relays the notices', async () => {
    const t = setup()
    await t.send('l1', 'edit it')
    await t.controller.handle({ type: 'openEditDiff', itemId: 'c1', outputRef: 'tool_patch-1' })
    await t.controller.handle({ type: 'revertEdit', itemId: 'c1', outputRef: 'tool_patch-1' })
    expect(t.reviews).toEqual([
      ['openDiff', 'c1', '{"files":[{"path":"notes.md","hunks":[]}]}#tool_patch-1'],
      ['revert', 'c1', '{"files":[{"path":"notes.md","hunks":[]}]}#tool_patch-1'],
    ])
    const reads = t.server.requestsFor('item/readOutput')
    expect(reads).toHaveLength(2)
    expect(reads[0]?.params).toMatchObject({
      itemId: 'c1',
      outputRef: 'tool_patch-1',
      offsetBytes: 0,
    })
    const notices = t.surface.posted.flatMap((m) => (m.type === 'notice' ? [m.text] : []))
    expect(notices).toEqual(['opened c1', 'reverted c1'])
  })

  it('does nothing for a review without a session', async () => {
    const t = setup()
    await t.controller.handle({ type: 'openEditDiff', itemId: 'c1', outputRef: 'r' })
    expect(t.reviews).toEqual([])
  })

  it('registers the IDE tool server with session/start only when sessionMcp was granted', async () => {
    const endpoint = { url: 'http://127.0.0.1:1/mcp', headers: { Authorization: 'Bearer t' } }
    const granted = setup({ ideMcpEndpoint: endpoint, grantedCapabilities: ['sessionMcp'] })
    await granted.send('l1', 'hi')
    expect(granted.server.requestsFor('session/start')[0]?.params?.['config']).toEqual({
      mcpServers: {
        ide: {
          transport: 'streamableHttp',
          url: endpoint.url,
          headers: endpoint.headers,
          mode: 'optional',
        },
      },
    })
    const denied = setup({ ideMcpEndpoint: endpoint })
    await denied.send('l1', 'hi')
    expect(denied.server.requestsFor('session/start')[0]?.params?.['config']).toBeUndefined()
    const noServer = setup({ grantedCapabilities: ['sessionMcp'] })
    await noServer.send('l1', 'hi')
    expect(noServer.server.requestsFor('session/start')[0]?.params?.['config']).toBeUndefined()
  })
})

describe('ConversationController: other messages', () => {
  it('cancels the running turn', async () => {
    const t = setup()
    await t.controller.handle({ type: 'cancelTurn' })
    expect(t.server.requestsFor('turn/cancel')).toHaveLength(0)
    await t.send('l1', 'hi')
    await t.controller.handle({ type: 'cancelTurn' })
    expect(t.server.requestsFor('turn/cancel')).toHaveLength(1)
    t.server.handle('turn/cancel', () => {
      throw new Error('nothing running')
    })
    await t.controller.handle({ type: 'cancelTurn' })
    expect(t.log.warn).toHaveBeenCalledWith(expect.stringContaining('turn/cancel failed'))
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
    await t.send('l1', 'hi')
    t.controller.hostExited('code 1, signal null')
    expect(t.host.sessionCount).toBe(0)
    expect(t.auth.calls.at(-1)).toBe('error:Muse Code stopped unexpectedly. (code 1, signal null)')
    t.controller.dispose()
  })

  it('clears the active turn when the session goes idle', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    t.server.notify('session/statusChanged', { sessionId: 's1', status: 'idle', viewCursor: 'v' })
    await settle()
    await t.send('l2', 'next')
    expect(t.server.requestsFor('turn/steer')).toHaveLength(0)
    expect(t.server.requestsFor('turn/start')).toHaveLength(2)
  })
})

// --- Session history (M6) ---

const storedSession = {
  sessionId: 'old',
  path: '/logs/old.jsonl',
  status: 'notLoaded',
  activeTurnId: null,
  createdAt: '2026-09-22T10:00:00Z',
  updatedAt: '2026-09-22T11:00:00Z',
  lastActivityAt: '2026-09-22T11:00:00Z',
  workspaceRoot: '/ws',
  providerId: 'meta',
  modelId: 'muse-spark-1.3-contributor',
  turnCount: 2,
  forkedFrom: null,
  title: 'Old prompt <ide_opened_file>x</ide_opened_file>',
  firstUserPrompt: 'Old prompt',
}
const storedItems = [
  { itemId: 'u1', kind: 'userMessage', status: 'completed', turnId: 't1', text: 'Old prompt' },
  { itemId: 'm1', kind: 'agentMessage', status: 'completed', turnId: 't1', text: 'Reply' },
]

function envelope(session: Record<string, unknown>, mode = 'inline') {
  return {
    session,
    history: {
      mode,
      items: mode === 'inline' ? storedItems : null,
      snapshot: null,
      ...(mode === 'none' && { noneReason: 'budget' }),
    },
    pendingRequests: [],
    viewCursor: 'v:old:9',
  }
}

function withHistory(
  options: Parameters<typeof setup>[0] = {},
  sessionOverrides: Record<string, unknown> = {},
) {
  const t = setup(options)
  t.server.handle('session/list', (params) => ({
    sessions: [{ ...storedSession, sessionId: params['cursor'] === undefined ? 'old' : 'page2' }],
    nextCursor: params['cursor'] === undefined ? 'c2' : null,
  }))
  t.server.handle('session/resume', (params) =>
    envelope({
      ...storedSession,
      sessionId: params['sessionId'],
      status: 'idle',
      ...sessionOverrides,
    }),
  )
  t.server.handle('session/fork', () =>
    envelope({ ...storedSession, sessionId: 'forked', forkedFrom: { sessionId: 'old' } }),
  )
  t.server.handle('session/rename', (params) => ({
    commandId: params['commandId'],
    status: 'accepted',
    name: `${String(params['name'])} (canonical)`,
  }))
  return t
}

const historyLoaded = {
  type: 'historyLoaded',
  sessionId: 'old',
  items: storedItems,
  todos: [],
}

describe('ConversationController: session history (M6)', () => {
  it('lists the workspace sessions page by page and posts rows with the archived ids', async () => {
    const t = withHistory({ archivedIds: ['page2'] })
    await t.controller.handle({ type: 'listSessions' })
    const requests = t.server.requestsFor('session/list')
    expect(requests).toHaveLength(2)
    expect(requests[0]?.params).toMatchObject({ workspaceRoot: '/ws', limit: 200 })
    expect(requests[0]?.params).not.toHaveProperty('cursor')
    expect(requests[1]?.params).toMatchObject({ workspaceRoot: '/ws', limit: 200, cursor: 'c2' })
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'sessionList',
      sessions: [
        expect.objectContaining({ sessionId: 'old', title: 'Old prompt', turnCount: 2 }),
        expect.objectContaining({ sessionId: 'page2' }),
      ],
      archivedIds: ['page2'],
    })
  })

  it('refuses to list without a workspace and reports a host failure as a notice', async () => {
    const noWorkspace = withHistory({ workspaceRoot: undefined })
    await noWorkspace.controller.handle({ type: 'listSessions' })
    expect(noWorkspace.surface.posted).toEqual([
      { type: 'notice', level: 'warning', text: NO_WORKSPACE_REASON },
    ])
    const t = withHistory()
    t.server.handle('session/list', () => {
      throw new Error('index locked')
    })
    await t.controller.handle({ type: 'listSessions' })
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'notice',
      level: 'error',
      text: 'The conversation history could not be loaded: index locked',
    })
  })

  it('folds session/listChanged and session/closed into the posted rows once listed', async () => {
    const t = withHistory()
    t.server.notify('session/listChanged', { session: { ...storedSession, sessionId: 'early' } })
    await settle()
    expect(t.surface.posted).toEqual([])
    await t.controller.handle({ type: 'listSessions' })
    t.server.notify('session/listChanged', {
      session: { ...storedSession, sessionId: 'new', status: 'running', title: 'Fresh' },
    })
    t.server.notify('session/listChanged', {
      session: { ...storedSession, sessionId: 'elsewhere', workspaceRoot: '/other' },
    })
    t.server.notify('session/closed', { sessionId: 'new', reason: 'idle', viewCursor: 'v' })
    t.server.notify('session/closed', { sessionId: 'unknown', reason: 'idle', viewCursor: 'v' })
    await settle()
    const lists = t.surface.posted.filter((message) => message.type === 'sessionList')
    expect(lists).toHaveLength(3)
    const last = lists.at(-1)
    expect(last?.type === 'sessionList' && last.sessions.map((row) => row.sessionId)).toEqual([
      'old',
      'page2',
      'new',
    ])
    expect(last?.type === 'sessionList' && last.sessions.at(-1)?.status).toBe('notLoaded')
    expect(t.log.warn).not.toHaveBeenCalled()
  })

  it('resumes a stored session: history, model from the catalogue, composer state, title, memory', async () => {
    const t = withHistory()
    await t.controller.handle({ type: 'resumeSession', sessionId: 'old' })
    await settle()
    expect(t.server.requestsFor('session/resume')[0]?.params).toMatchObject({
      sessionId: 'old',
      history: 'inline',
    })
    expect(t.surface.posted).toEqual([
      modelList,
      { ...historyLoaded },
      { type: 'notice', level: 'info', text: 'Resumed Old prompt' },
      { type: 'sessionInfo', modelId: 'muse-spark-1.2', sessionId: 'old' },
      skillList,
    ])
    expect(t.server.requestsFor('session/setReasoningEffort')[0]?.params).toMatchObject({
      sessionId: 'old',
    })
    expect(t.server.requestsFor('session/setApprovalMode')[0]?.params).toMatchObject({
      sessionId: 'old',
      mode: 'denyUnmatched',
    })
    expect(t.surface.setTitle).toHaveBeenLastCalledWith('Untitled')
    expect(t.memory.lastSession).toEqual({ sessionId: 'old', at: NOW })
    // Already current: nothing happens.
    await t.controller.handle({ type: 'resumeSession', sessionId: 'old' })
    expect(t.server.requestsFor('session/resume')).toHaveLength(1)
    // The live events now reach this surface.
    t.server.notify('session/nameChanged', { sessionId: 'old', name: 'Named later' })
    await settle()
    expect(t.surface.setTitle).toHaveBeenLastCalledWith('Named later')
  })

  it('warns when the host served no history, and reports a refused resume', async () => {
    const none = withHistory()
    none.server.handle('session/resume', (params) =>
      envelope({ ...storedSession, sessionId: params['sessionId'], name: 'Big one' }, 'none'),
    )
    await none.controller.handle({ type: 'resumeSession', sessionId: 'old' })
    expect(none.surface.posted).toContainEqual({
      type: 'historyLoaded',
      sessionId: 'old',
      items: [],
      name: 'Big one',
      todos: [],
    })
    expect(none.surface.posted).toContainEqual({
      type: 'notice',
      level: 'warning',
      text: 'The earlier messages of this conversation could not be shown',
    })
    expect(none.surface.setTitle).toHaveBeenCalledWith('Big one')
    const refused = withHistory()
    refused.server.handle('session/resume', () => {
      throw new Error('lease held elsewhere')
    })
    await refused.controller.handle({ type: 'resumeSession', sessionId: 'old' })
    expect(refused.surface.posted.at(-1)).toEqual({
      type: 'notice',
      level: 'error',
      text: 'Could not resume the conversation: lease held elsewhere',
    })
    const signedOut = withHistory({ status: 'signedOut' })
    await signedOut.controller.handle({ type: 'resumeSession', sessionId: 'old' })
    expect(signedOut.server.requestsFor('session/resume')).toHaveLength(0)
  })

  it('forks the current session through a cut point and switches to the fork', async () => {
    const t = withHistory()
    await t.controller.handle({ type: 'forkSession', lastTurnId: 't1' })
    expect(t.surface.posted).toEqual([
      { type: 'notice', level: 'info', text: 'Start a conversation first.' },
    ])
    await t.send('l1', 'hi')
    await settle()
    t.surface.posted.length = 0
    await t.controller.handle({ type: 'forkSession', lastTurnId: 't1' })
    expect(t.server.requestsFor('session/fork')[0]?.params).toMatchObject({
      sessionId: 's1',
      cutPoint: { lastTurnId: 't1' },
    })
    expect(t.surface.posted[0]).toEqual({ ...historyLoaded, sessionId: 'forked' })
    expect(t.surface.posted).toContainEqual({
      type: 'notice',
      level: 'info',
      text: 'Forked into a new conversation. Old prompt',
    })
    expect(t.host.sessionCount).toBe(1)
    await t.controller.handle({ type: 'forkSession' })
    expect(t.server.requestsFor('session/fork')[1]?.params).not.toHaveProperty('cutPoint')
    t.server.handle('session/fork', () => {
      throw new Error('invalid fork boundary: WriteFailed')
    })
    await t.controller.handle({ type: 'forkSession', lastTurnId: 't1' })
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'notice',
      level: 'error',
      text: 'Could not fork the conversation: invalid fork boundary: WriteFailed',
    })
  })

  it('renames the session to the canonical name, and reports a refusal', async () => {
    const t = withHistory()
    await t.controller.handle({ type: 'renameSession', name: 'Nothing yet' })
    expect(t.server.requestsFor('session/rename')).toHaveLength(0)
    await t.send('l1', 'hi')
    t.surface.posted.length = 0
    await t.controller.handle({ type: 'renameSession', name: '  ' })
    await t.controller.handle({ type: 'renameSession', name: ' Parser fix ' })
    expect(t.server.requestsFor('session/rename')).toHaveLength(1)
    expect(t.server.requestsFor('session/rename')[0]?.params).toMatchObject({
      sessionId: 's1',
      name: 'Parser fix',
    })
    expect(t.surface.posted).toEqual([
      { type: 'agentEvent', event: { type: 'sessionNamed', name: 'Parser fix (canonical)' } },
    ])
    expect(t.surface.setTitle).toHaveBeenLastCalledWith('Parser fix (canonical)')
    t.server.handle('session/rename', (params) => ({
      commandId: params['commandId'],
      status: 'accepted',
    }))
    await t.controller.handle({ type: 'renameSession', name: 'Later' })
    expect(t.surface.posted).toHaveLength(1)
    t.server.handle('session/rename', () => {
      throw new Error('UnsupportedPlatform')
    })
    await t.controller.handle({ type: 'renameSession', name: 'Nope' })
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'notice',
      level: 'error',
      text: 'Could not rename the conversation: UnsupportedPlatform',
    })
  })

  it('archives and unarchives in workspace memory and re-posts the rows', async () => {
    const t = withHistory({ archivedIds: ['a'] })
    await t.controller.handle({ type: 'setSessionArchived', sessionId: 'b', isArchived: true })
    expect(t.memory.archivedIds).toEqual(['a', 'b'])
    expect(t.surface.posted).toEqual([])
    await t.controller.handle({ type: 'listSessions' })
    await t.controller.handle({ type: 'setSessionArchived', sessionId: 'a', isArchived: false })
    expect(t.memory.archivedIds).toEqual(['b'])
    expect(t.surface.posted.at(-1)).toMatchObject({ type: 'sessionList', archivedIds: ['b'] })
    await t.controller.handle({ type: 'setSessionArchived', sessionId: 'b', isArchived: true })
    expect(t.memory.archivedIds).toEqual(['b'])
  })

  it('reopens on the last session within ten minutes, forgets it after, and never on a tab', async () => {
    const recent = { sessionId: 'old', at: NOW - 9 * 60 * 1000 }
    const sidebar = withHistory({ isRestorable: true, lastSession: recent })
    await sidebar.controller.restoreRecentSession()
    expect(sidebar.server.requestsFor('session/resume')).toHaveLength(1)
    expect(sidebar.surface.posted).toContainEqual(historyLoaded)
    const stale = withHistory({
      isRestorable: true,
      lastSession: { sessionId: 'old', at: NOW - 11 * 60 * 1000 },
    })
    await stale.controller.restoreRecentSession()
    expect(stale.server.requestsFor('session/resume')).toHaveLength(0)
    expect(stale.memory.lastSession).toBeUndefined()
    const tab = withHistory({ isRestorable: false, lastSession: recent })
    await tab.controller.restoreRecentSession()
    expect(tab.server.requestsFor('session/resume')).toHaveLength(0)
    expect(tab.memory.lastSession).toEqual(recent)
    const signedOut = withHistory({ isRestorable: true, lastSession: recent, status: 'signedOut' })
    await signedOut.controller.restoreRecentSession()
    expect(signedOut.server.requestsFor('session/resume')).toHaveLength(0)
  })

  it('remembers activity on sends and completed turns, and forgets it on clear', async () => {
    const t = withHistory({ now: NOW })
    await t.send('l1', 'hi')
    expect(t.memory.lastSession).toEqual({ sessionId: 's1', at: NOW })
    t.finishTurn()
    await settle()
    expect(t.memory.lastSession).toEqual({ sessionId: 's1', at: NOW })
    await t.controller.handle({ type: 'clearConversation' })
    expect(t.memory.lastSession).toBeUndefined()
    expect(t.surface.setTitle).toHaveBeenLastCalledWith('Untitled')
  })

  it('marks the surface unread when a turn completes or the agent waits on the user', async () => {
    const t = withHistory()
    await t.send('l1', 'hi')
    t.server.notify('turn/started', { sessionId: 's1', turnId: 't1', viewCursor: 'v' })
    t.server.notify('item/delta', { sessionId: 's1', itemId: 'i', delta: 'x', viewCursor: 'v' })
    await settle()
    expect(t.surface.markUnread).not.toHaveBeenCalled()
    t.server.notify('userInput/requested', {
      sessionId: 's1',
      userInputId: 'q',
      itemId: 'i',
      questions: [],
      viewCursor: 'v',
    })
    t.finishTurn()
    await settle()
    expect(t.surface.markUnread).toHaveBeenCalledTimes(2)
  })
})

describe('ConversationController: backends and tiers (M7)', () => {
  it('asks once before a contributor model, and reverts when declined', async () => {
    const t = setup({ confirmsContributor: false })
    await t.send('l1', 'hi')
    t.surface.posted.length = 0
    await t.controller.handle({ type: 'setModel', modelId: 'muse-spark-1.3-contributor' })
    expect(t.contributorPrompts).toEqual(['muse-spark-1.3-contributor'])
    expect(t.server.requestsFor('session/setModel')).toHaveLength(0)
    expect(t.surface.posted).toEqual([sessionInfo])
    const yes = setup({ confirmsContributor: true })
    await yes.send('l1', 'hi')
    await yes.controller.handle({ type: 'setModel', modelId: 'muse-spark-1.3-contributor' })
    await yes.controller.handle({ type: 'setModel', modelId: 'muse-spark-1.3' })
    await yes.controller.handle({ type: 'setModel', modelId: 'muse-spark-1.3-contributor' })
    expect(yes.contributorPrompts).toEqual(['muse-spark-1.3-contributor'])
    expect(yes.server.requestsFor('session/setModel')).toHaveLength(3)
  })

  it('blocks contributor models in a confidential workspace and hides them from the list', async () => {
    const t = setup({ isConfidentialWorkspace: true })
    t.server.handle('model/list', () => ({
      providerId: 'meta',
      profileId: null,
      source: 'catalog',
      models: [
        { modelId: 'muse-spark-1.3', displayLabel: 'x', contextLimit: 1, isDefault: false },
        {
          modelId: 'muse-spark-1.3-contributor',
          displayLabel: 'c',
          contextLimit: 1,
          isDefault: true,
        },
      ],
    }))
    await t.send('l1', 'hi')
    const list = t.surface.posted.find((message) => message.type === 'modelList')
    expect(list?.type === 'modelList' && list.models.map((model) => model.modelId)).toEqual([
      'muse-spark-1.3',
    ])
    t.surface.posted.length = 0
    await t.controller.handle({ type: 'setModel', modelId: 'muse-spark-1.2-contributor' })
    expect(t.contributorPrompts).toEqual([])
    expect(t.surface.posted).toEqual([
      {
        type: 'notice',
        level: 'warning',
        text: 'Contributor-tier models are blocked in this workspace (museSpark.confidentialWorkspace).',
      },
      expect.objectContaining({ type: 'sessionInfo', modelId: 'muse-spark-1.3' }),
    ])
  })

  it('explains the Model API backend once per session instead of the sandbox notice', async () => {
    const t = setup({
      platform: 'win32',
      userProfileDir: String.raw`C:\Users\r`,
      workspaceRoot: String.raw`C:\Users\r\ws`,
    })
    const api = fakeModelApi()
    const modelApiHost = new ModelApiHost({
      client: new ModelApiClient({
        fetch: api.fetch,
        baseUrl: 'https://api.example.test/v1',
        apiKey: () => Promise.resolve('LLM|1|secret'),
        sleep: () => Promise.resolve(),
        random: () => 0,
        log: t.log,
      }),
      workspaceRoot: String.raw`C:\Users\r\ws`,
      platform: 'win32',
      io: noopToolIo,
      newId: () => 'fixed',
      now: () => 0,
      log: t.log,
    })
    const controller = new ConversationController({
      ...t.deps,
      ensureHost: () => Promise.resolve(modelApiHost),
    })
    api.script({ text: 'pong' })
    await controller.handle({ type: 'sendMessage', localId: 'l1', text: 'ping', attachmentIds: [] })
    await settle()
    expect(t.surface.posted).toContainEqual({
      type: 'notice',
      level: 'info',
      text: expect.stringContaining('runs on the Meta Model API'),
    })
    expect(
      t.surface.posted.some(
        (message) => message.type === 'notice' && message.text.includes('sandbox'),
      ),
    ).toBe(false)
    expect(t.surface.posted).toContainEqual({
      type: 'turnAccepted',
      localId: 'l1',
      turnId: 'fixed',
    })
  })
})
