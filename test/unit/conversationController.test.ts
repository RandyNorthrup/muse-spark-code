import { describe, expect, it, vi } from 'vitest'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import type { AuthService, AuthSnapshot } from '../../src/host/auth/authService'
import {
  ConversationController,
  type ConversationDeps,
  NO_WORKSPACE_REASON,
  NOT_SIGNED_IN_REASON,
  NOTHING_TO_SEND_REASON,
  type PickedFile,
} from '../../src/host/conversation/conversationController'
import type { HostAction, MentionItem } from '../../src/shared/protocol'
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

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2,
  0, 0, 0, 3,
])

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
const sessionInfo = { type: 'sessionInfo', modelId: 'muse-spark-1.3', contextLimit: 1_007_997 }
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
  handle.server.handle('model/list', () => ({
    providerId: 'meta',
    profileId: null,
    source: 'catalog',
    models: [
      { modelId: 'muse-spark-1.3', displayLabel: 'x', contextLimit: 1_007_997, isDefault: false },
      { modelId: 'muse-spark-1.2', displayLabel: 'y', contextLimit: null, isDefault: true },
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
  const log = new FakeLogOutputChannel()
  const host = new MuseCodeHost(handle.host, log)
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
  const controller = new ConversationController({
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
    newAttachmentId: () => {
      attachmentCount += 1
      return `att-${String(attachmentCount)}`
    },
    log,
  })
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
      (m) => m.type === 'notice' && m.text.includes('muse sandbox windows setup'),
    )
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ level: 'warning' })
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
