import { describe, expect, it, vi } from 'vitest'
import type { SessionMcpHttpServer } from '../../src/core/agent/agentBackend'
import { ModelApiHost, type ModelApiHostDeps } from '../../src/core/backends/modelapi/ModelApiHost'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import type { ShellSandboxPosture } from '../../src/core/backends/musecode/sandbox'
import type { EditorContext } from '../../src/core/editorContext'
import type { AuthPort, AuthSnapshot } from '../../src/host/auth/authService'
import type { UsageInsights } from '../../src/shared/usage'
import {
  ConversationController,
  type ConversationDeps,
  type LastSession,
  type PickedFile,
  type SessionMemory,
} from '../../src/host/conversation/conversationController'
import type { DictationListener } from '../../src/core/voice/dictation'
import type { DictationSetup } from '../../src/host/voice/dictationHost'
import { CHOICE_STEERING_NOTE, type GoalCommandVerb, UI_TEXT } from '../../src/shared/constants'
import type { HostAction, LineRange, MentionItem } from '../../src/shared/protocol'
import type { SubscriptionUsage } from '../../src/shared/usage'
import { FakeLogOutputChannel, fakeSurface } from './helpers/fakes'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { memoryContextIo } from './helpers/fakeContextIo'
import { heldShellToolIo, memoryToolIo, type MemoryToolIo, noopToolIo } from './helpers/fakeToolIo'
import {
  fakeInitializeResult,
  fakeMspHost,
  goalRefusal,
  refusalOf,
  settle,
} from './helpers/fakeMsp'
import {
  INVALID_TARGET,
  SHELL_CALL_BACKGROUNDED,
  SHELL_CALL_STARTED,
  taskAck,
  USER_SHELL_SANDBOX_FAILED,
} from './helpers/m46Capture'

interface FakeAuth {
  readonly service: AuthPort
  readonly calls: string[]
  snapshot: AuthSnapshot
}

function fakeAuth(status: AuthSnapshot['status'] = 'signedIn'): FakeAuth {
  const calls: string[] = []
  const state: FakeAuth = {
    calls,
    snapshot: { status, detail: undefined },
    // AuthPort is exactly the member set the controller touches.
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
    },
  }
  return state
}

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2,
  0, 0, 0, 3,
])

const NOW = Date.parse('2026-09-22T12:00:00Z')
/** The choice-steering note every CLI turn carries (M14), hidden by displayText. */
const NOTE = { type: 'text', text: CHOICE_STEERING_NOTE }

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
    /** A remote window and the answer to its Bypass confirmation (D24). */
    isRemoteWindow?: boolean
    confirmsRemoteBypass?: boolean
    platform?: NodeJS.Platform
    userProfileDir?: string
    editorContext?: EditorContext
    isAutosaveEnabled?: boolean
    /** Files the fake mention index lists (for the selection-text rule). */
    indexed?: readonly string[]
    ideMcpEndpoint?: SessionMcpHttpServer
    /** How long the IDE tool server takes to answer (a retried start, D25). */
    ideMcpStartMs?: number
    grantedCapabilities?: readonly string[]
    /** The window a previous session left in the cache (M16). */
    cachedUsage?: SubscriptionUsage
    shellSandbox?: ShellSandboxPosture
    /** Contributor-tier guard (M7). */
    isConfidentialWorkspace?: boolean
    confirmsContributor?: boolean
    /** Session history memory (M6). */
    archivedIds?: readonly string[]
    lastSession?: LastSession
    isRestorable?: boolean
    /** The usage modal's insights (M14). */
    usageInsights?: { day: UsageInsights; week: UsageInsights }
    /** Voice dictation (M9). */
    dictation?: DictationSetup
    /** Muse Voice when it is the microphone's engine (M35). */
    museVoice?: () => DictationSetup | undefined
    now?: number
    /** Handshake fields over the fake's (D26: the platform, the version). */
    handshake?: Record<string, unknown>
    /** The clipboard refuses (M39: a failure no step catches). */
    copyFails?: boolean
    /** A clock the test moves (M39: turn timings). */
    beforeEnsureHost?: () => Promise<void>
    clock?: { now: number }
    /** What the workspace answers for a tool row's picture (M43). */
    readToolImage?: ConversationDeps['readToolImage']
    /** VS Code's workspace trust (M46: Restricted Mode runs no `!` command). */
    isWorkspaceTrusted?: boolean
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
        ...options.handshake,
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
  // The files an "editor" holds unsaved (D27); tests replace the list.
  const unsaved = { files: [] as readonly string[] }
  const applied: string[] = []
  const reviews: [string, string, string][] = []
  const opened: [string, string][] = []
  const openedFiles: [string, LineRange | undefined][] = []
  let cachedUsage: SubscriptionUsage | undefined = options.cachedUsage
  const contributorPrompts: string[] = []
  let remoteBypassPrompts = 0
  // What "Export conversation…" handed the save dialog (M30).
  const exported = {
    markdown: [] as [string, string][],
    sessionLogs: [] as [string, string][],
  }
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
    setPaidFeature: vi.fn(() => Promise.resolve()),
    isWorkspaceTrusted: () => options.isWorkspaceTrusted ?? true,
    onForegroundTasksChanged: vi.fn<() => void>(),
    museVoice: options.museVoice ?? (() => undefined),
    auth: auth.service,
    accountFacts: (backend) =>
      Promise.resolve(
        backend === 'museCode'
          ? { signInMethod: 'cli' as const, cliVersion: '1.3.0', delegationMode: 'off' }
          : { signInMethod: 'apiKey' as const },
      ),
    usageInsights: () => Promise.resolve(options.usageInsights),
    ensureHost: async () => {
      await options.beforeEnsureHost?.()
      return host
    },
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
    isRemoteWindow: options.isRemoteWindow ?? false,
    confirmRemoteBypass: () => {
      remoteBypassPrompts += 1
      return Promise.resolve(options.confirmsRemoteBypass ?? true)
    },
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
      return options.copyFails === true
        ? Promise.reject(new Error('clipboard busy'))
        : Promise.resolve()
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
    unsavedFiles: () => unsaved.files,
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
    openDocument: (title: string, content: string) => {
      opened.push([title, content])
      return Promise.resolve()
    },
    openFile: (filePath: string, range: LineRange | undefined) => {
      openedFiles.push([filePath, range])
      return Promise.resolve()
    },
    readToolImage:
      options.readToolImage ?? (() => Promise.resolve({ ok: false, reason: 'no image here' })),
    usageCache: {
      read: () => cachedUsage,
      write: (usage) => {
        cachedUsage = usage
        return Promise.resolve()
      },
    },
    ideMcpEndpoint: () =>
      new Promise((resolve) => {
        // A server still (re)starting answers later (D25); the session waits.
        setTimeout(() => {
          resolve(options.ideMcpEndpoint)
        }, options.ideMcpStartMs ?? 0)
      }),
    newAttachmentId: () => {
      attachmentCount += 1
      return `att-${String(attachmentCount)}`
    },
    sessions,
    isRestorable: options.isRestorable ?? false,
    dictation: options.dictation ?? { isAvailable: false, reason: 'no helper in tests' },
    exports: {
      saveMarkdown: (fileName: string, content: string) => {
        exported.markdown.push([fileName, content])
        return Promise.resolve()
      },
      saveSessionLog: (sessionId: string, fileName: string) => {
        exported.sessionLogs.push([sessionId, fileName])
        return Promise.resolve()
      },
    },
    now: () => options.clock?.now ?? options.now ?? NOW,
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
    opened,
    openedFiles,
    cachedUsage: () => cachedUsage,
    onSandboxUnavailable,
    saveAll,
    unsaved,
    applied,
    reviews,
    memory,
    contributorPrompts,
    exported,
    remoteBypassPrompts: () => remoteBypassPrompts,
    setHasEditor: (isOpen: boolean) => {
      hasEditor = isOpen
    },
  }
}

describe('ConversationController.surfaceReady', () => {
  it('replays auth and composer state, then models, session, skills and attachments', async () => {
    const t = setup()
    t.controller.surfaceReady()
    expect(t.surface.posted).toEqual([
      // M25: first, the live session and turn a reloaded webview checks its saved state against.
      { type: 'surfaceState' },
      { type: 'authState', status: 'signedIn' },
      composerState,
      {
        type: 'dictationState',
        status: 'unavailable',
        reason: 'no helper in tests',
        engine: 'system',
      },
    ])
    await t.send('l1', 'hi')
    await settle()
    await attachPng(t)
    t.surface.posted.length = 0
    t.controller.surfaceReady()
    expect(t.surface.posted).toEqual([
      { type: 'surfaceState', sessionId: 's1', activeTurnId: 't1' },
      { type: 'authState', status: 'signedIn' },
      composerState,
      {
        type: 'dictationState',
        status: 'unavailable',
        reason: 'no helper in tests',
        engine: 'system',
      },
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
      input: [{ type: 'text', text: 'hi' }, NOTE],
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

  // M39: the session's story in the log, with ids, results and times, and
  // nothing of what was typed.
  it('logs the session and each turn with its result and times, never the prompt', async () => {
    const clock = { now: 1000 }
    const t = setup({ clock })
    await t.send('l1', 'secret plan')
    t.server.notify('turn/started', { sessionId: 's1', turnId: 't1', viewCursor: 'v' })
    await settle()
    clock.now = 1400
    t.server.notify('item/delta', { sessionId: 's1', itemId: 'i', delta: 'x', viewCursor: 'v' })
    await settle()
    // A later delta does not move the first output's time.
    clock.now = 1600
    t.server.notify('item/delta', { sessionId: 's1', itemId: 'i', delta: 'y', viewCursor: 'v' })
    await settle()
    clock.now = 2500
    t.server.notify('turn/completed', { sessionId: 's1', turnId: 't1', terminal: 'completed' })
    await settle()
    const lines = t.log.info.mock.calls.map(([line]) => String(line))
    expect(lines).toContain('Session s1 started on the museCode backend, model muse-spark-1.3')
    expect(lines.filter((line) => line.startsWith('Turn t1'))).toEqual([
      'Turn t1 started in session s1',
      'Turn t1 completed after 1500 ms, first output after 400 ms',
    ])
    expect(lines.join('\n')).not.toContain('secret plan')
    // A turn cleared away with its session is said too, and its clock goes
    // (the review of PR #20).
    await t.send('l2', 'next')
    t.server.notify('turn/started', { sessionId: 's1', turnId: 't2', viewCursor: 'v' })
    await settle()
    await t.controller.handle({ type: 'clearConversation' })
    expect(t.log.info).toHaveBeenLastCalledWith('Turn t2 ended with its session')
  })

  // M39: streamed text reaches the panel at most once a frame, in order.
  it('joins the deltas of one item into one post a frame, posted before anything after them', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    t.server.notify('turn/started', { sessionId: 's1', turnId: 't1', viewCursor: 'v' })
    await settle()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      t.surface.posted.length = 0
      for (const delta of ['Hel', 'lo', ' there']) {
        t.server.notify('item/delta', { sessionId: 's1', itemId: 'i', delta, viewCursor: 'v' })
      }
      await settle()
      expect(t.surface.posted).toEqual([])
      vi.advanceTimersByTime(16)
      expect(t.surface.posted).toEqual([
        {
          type: 'agentEvent',
          event: { type: 'textDelta', itemId: 'i', field: 'text', delta: 'Hello there' },
        },
      ])
      // Any other message posts the waiting text first.
      t.surface.posted.length = 0
      t.server.notify('item/delta', { sessionId: 's1', itemId: 'i', delta: '!', viewCursor: 'v' })
      t.server.notify('turn/completed', { sessionId: 's1', turnId: 't1', terminal: 'completed' })
      await settle()
      expect(
        t.surface.posted
          .slice(0, 2)
          .map((message) => (message.type === 'agentEvent' ? message.event.type : message.type)),
      ).toEqual(['textDelta', 'turnCompleted'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('steers a running turn and falls back to a fresh turn when the steer is rejected', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    t.server.notify('turn/started', { sessionId: 's1', turnId: 't1', viewCursor: 'v' })
    await settle()
    await t.send('l2', 'also this')
    expect(t.server.requestsFor('turn/steer')[0]?.params).toMatchObject({
      expectedTurnId: 't1',
      input: [{ type: 'text', text: 'also this' }, NOTE],
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
        NOTE,
      ],
    })
    await t.send('l2', '/fix-bug the parser')
    expect(t.server.requestsFor('turn/start')[1]?.params).toMatchObject({
      input: [{ type: 'skill', selector: 'fix-bug', arguments: 'the parser' }, NOTE],
    })
    t.finishTurn()
    await settle()
    await t.send('l3', '/unknown-skill')
    expect(t.server.requestsFor('turn/start')[2]?.params).toMatchObject({
      input: [{ type: 'text', text: '/unknown-skill' }, NOTE],
    })
  })

  it('rejects an empty send, and sends while signed out or without a workspace', async () => {
    const t = setup()
    await t.send('l0', ' '.repeat(3))
    // Nothing was used, so the composer gets any images back (D26).
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'sendFailed',
      localId: 'l0',
      reason: UI_TEXT.nothingToSendReason,
      attachmentsKept: true,
    })
    const signedOut = setup({ status: 'signedOut' })
    await signedOut.send('l1', 'hi')
    expect(signedOut.surface.posted).toEqual([
      {
        type: 'sendFailed',
        localId: 'l1',
        reason: UI_TEXT.notSignedInReason,
        attachmentsKept: true,
      },
    ])
    const noWorkspace = setup({ workspaceRoot: undefined })
    await noWorkspace.send('l1', 'hi')
    expect(noWorkspace.surface.posted).toEqual([
      {
        type: 'sendFailed',
        localId: 'l1',
        reason: UI_TEXT.noWorkspaceReason,
        attachmentsKept: true,
      },
    ])
  })

  it('reports a backend failure on the echo and logs it', async () => {
    const t = setup()
    t.server.handle('turn/start', () => {
      throw new Error('boom')
    })
    await t.send('l1', 'hi')
    expect(t.surface.posted.at(-1)).toMatchObject({
      type: 'sendFailed',
      localId: 'l1',
      attachmentsKept: true,
    })
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
    t.surface.posted.length = 0
    await t.controller.handle({ type: 'clearConversation' })
    expect(t.host.sessionCount).toBe(0)
    // M25: the webview drops its transcript too, however the clear came (a keybinding too).
    expect(t.surface.posted[0]).toEqual({ type: 'conversationCleared' })
    expect(t.surface.posted.at(-1)).toEqual({ type: 'attachmentsCleared' })
    await t.controller.handle({ type: 'compact' })
    expect(t.server.requestsFor('session/start')).toHaveLength(2)
  })

  it('refuses skills, compaction and mentions when signed out', async () => {
    const t = setup({ status: 'signedOut' })
    await t.controller.handle({ type: 'listSkills' })
    await t.controller.handle({ type: 'compact' })
    expect(t.surface.posted).toEqual([
      { type: 'notice', level: 'warning', text: UI_TEXT.notSignedInReason },
      { type: 'notice', level: 'warning', text: UI_TEXT.notSignedInReason },
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
      { name: 'a b.md', fsPath: String.raw`D:\My Files\a b.md`, relativePath: undefined },
      { name: 'x#1.md', fsPath: '/ws/my docs/x#1.md', relativePath: 'my docs/x#1.md' },
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
      // Quoted so the path reads back whole (D27).
      { type: 'insertText', text: '@"D:/My Files/a b.md" ' },
      { type: 'insertText', text: '@"my docs/x#1.md" ' },
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
      input: [{ type: 'text', text: 'text only' }, NOTE],
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
    await t.controller.handle({ type: 'droppedUris', uris: ['file:///ws/my notes.md'] })
    expect(t.surface.posted).toEqual([
      { type: 'insertText', text: '@src/app.ts ' },
      { type: 'insertText', text: '@a.ts @c.ts ' },
      { type: 'insertText', text: '@"my notes.md" ' },
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
    // The answer is logged, never the feedback typed with it (M39).
    expect(t.log.info).toHaveBeenCalledWith('Approval a1 answered: abort')
    expect(t.log.info.mock.calls.flat().join('\n')).not.toContain('not that')
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
    // A refused decision is a warning since M15: the CLI can fail this reply
    // after applying the decision. The card opens again (D26).
    expect(t.surface.posted.slice(-2)).toEqual([
      expect.objectContaining({
        type: 'notice',
        level: 'warning',
        text: expect.stringContaining('stale requirement') as string,
      }),
      { type: 'approvalReopened', approvalId: 'a1' },
    ])
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
    // What the panel said is in the log too (M39).
    expect(t.log.error).toHaveBeenCalledWith(
      expect.stringMatching(/^Shown in the panel: .*missing/),
    )
  })

  // M39: the caller does not wait, so an uncaught failure would reach only
  // VS Code's Extension Host log.
  it('logs a failure no step caught, with its stack, and says it', async () => {
    const t = setup({ copyFails: true })
    await expect(t.controller.handle({ type: 'copyText', text: 'x' })).resolves.toBeUndefined()
    expect(t.log.error).toHaveBeenCalledWith(
      expect.stringMatching(/^copyText failed: Error: clipboard busy\n\s+at /),
    )
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'notice',
      level: 'error',
      text: 'That did not work (the Muse Spark log has the details): clipboard busy',
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
      NOTE,
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
    expect(turnStartParams(off)['input']).toEqual([{ type: 'text', text: 'explain' }, NOTE])
    // The note rides along, so the durable transcript keeps the typed text (M14).
    expect(turnStartParams(off)['displayText']).toBe('explain')
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

  it('rewinds code by reverting the edits after a message newest first, or says there is nothing (M13)', async () => {
    const t = setup()
    await t.send('l1', 'edit it')
    await t.controller.handle({
      type: 'rewindCode',
      edits: [
        { itemId: 'c2', outputRef: 'tool_patch-2' },
        { itemId: 'c1', outputRef: 'tool_patch-1' },
      ],
    })
    expect(t.reviews).toEqual([
      ['revert', 'c2', '{"files":[{"path":"notes.md","hunks":[]}]}#tool_patch-2'],
      ['revert', 'c1', '{"files":[{"path":"notes.md","hunks":[]}]}#tool_patch-1'],
    ])
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'notice',
      level: 'info',
      text: 'Code rewound to this message (2 edits)',
    })
    await t.controller.handle({ type: 'rewindCode', edits: [] })
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'notice',
      level: 'info',
      text: 'No edits after this message to rewind.',
    })
  })

  it('fetches the stored patch for a review and relays the notices', async () => {
    const t = setup()
    await t.send('l1', 'edit it')
    await t.controller.handle({ type: 'openEditDiff', itemId: 'c1', outputRef: 'tool_patch-1' })
    expect(t.reviews).toEqual([
      ['openDiff', 'c1', '{"files":[{"path":"notes.md","hunks":[]}]}#tool_patch-1'],
    ])
    const reads = t.server.requestsFor('item/readOutput')
    expect(reads).toHaveLength(1)
    expect(reads[0]?.params).toMatchObject({
      itemId: 'c1',
      outputRef: 'tool_patch-1',
      offsetBytes: 0,
    })
    const notices = t.surface.posted.flatMap((m) => (m.type === 'notice' ? [m.text] : []))
    expect(notices).toEqual(['opened c1'])
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

  it('waits for an IDE tool server that is still starting, so the session gets it (D25)', async () => {
    const endpoint = { url: 'http://127.0.0.1:1/mcp', headers: { Authorization: 'Bearer t' } }
    const t = setup({
      ideMcpEndpoint: endpoint,
      ideMcpStartMs: 20,
      grantedCapabilities: ['sessionMcp'],
    })
    await t.send('l1', 'hi')
    expect(t.server.requestsFor('session/start')[0]?.params?.['config']).toMatchObject({
      mcpServers: { ide: { url: endpoint.url } },
    })
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

  it('ends the turn on a crash and resumes the same session with the next message (D25)', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    t.server.notify('turn/started', { sessionId: 's1', turnId: 't1', viewCursor: 'v' })
    await settle()
    t.controller.hostExited({
      description: 'Muse Code failed with an unhandled error (exit 1)',
      isExpected: false,
      isPersistent: false,
    })
    expect(t.host.sessionCount).toBe(0)
    // The running turn ends in the webview; no error gate for a crash.
    expect(t.surface.posted).toContainEqual({
      type: 'agentEvent',
      event: {
        type: 'turnCompleted',
        turnId: 't1',
        terminal: 'failed',
        reason:
          'Muse Code stopped unexpectedly (Muse Code failed with an unhandled error (exit 1))',
      },
    })
    expect(t.auth.calls.some((call) => call.startsWith('error:'))).toBe(false)
    // A turn ended here gets its end line too (the review of PR #20).
    expect(t.log.info).toHaveBeenCalledWith(
      'Turn t1 failed: Muse Code stopped unexpectedly (Muse Code failed with an unhandled error (exit 1)) after 0 ms',
    )
    t.server.handle('session/resume', () => envelope({ ...storedSession, sessionId: 's1' }))
    await t.send('l2', 'again')
    expect(t.server.requestsFor('session/resume')[0]?.params).toMatchObject({ sessionId: 's1' })
    expect(t.server.requestsFor('session/start')).toHaveLength(1)
    t.controller.dispose()
  })

  it('starts afresh after a crash when the user asked for a new conversation (D25)', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    t.controller.hostExited({
      description: 'Muse Code failed with an unhandled error (exit 1)',
      isExpected: false,
      isPersistent: false,
    })
    await t.controller.handle({ type: 'clearConversation' })
    await t.send('l2', 'a new topic')
    expect(t.server.requestsFor('session/resume')).toHaveLength(0)
    expect(t.server.requestsFor('session/start')).toHaveLength(2)
  })

  it('reports a persistent exit through the sign-in gate and ignores its own close', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    t.controller.hostExited({ description: 'closed', isExpected: true, isPersistent: false })
    expect(t.host.sessionCount).toBe(1)
    t.controller.hostExited({
      description: 'Muse Code refused its configuration (exit 3)',
      isExpected: false,
      isPersistent: true,
    })
    expect(t.auth.calls.at(-1)).toBe(
      'error:Muse Code stopped unexpectedly (Muse Code refused its configuration (exit 3))',
    )
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

/** The first readUsage answer of a host that has observed no window yet. */
async function firstUsageReport(t: ReturnType<typeof setup>) {
  t.server.handle('usage/read', () => ({}))
  await t.controller.handle({ type: 'readUsage' })
  return t.surface.posted.at(-1)
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

describe('ConversationController: account & usage (M8)', () => {
  const usage = {
    observedAtMs: 1_800_000_000_000,
    tier: 'muse-pro',
    window: { usedPercent: 12, resetsAtMs: 1_800_000_900_000, windowDurationMins: 300 },
    weekly: { usedPercent: 3, resetsAtMs: 1_800_400_000_000 },
  }

  const account = { signInMethod: 'cli', cliVersion: '1.3.0', delegationMode: 'off' }

  it('carries the insights when the host has them (M14)', async () => {
    const insights = {
      day: {
        attempts: 31,
        sessions: 1,
        reminderAttempts: 30,
        subagentAttempts: 0,
        longSessionAttempts: 0,
      },
      week: {
        attempts: 31,
        sessions: 1,
        reminderAttempts: 30,
        subagentAttempts: 0,
        longSessionAttempts: 0,
      },
    }
    const t = setup({ usageInsights: insights })
    expect(await firstUsageReport(t)).toEqual({
      type: 'usageReport',
      backend: 'museCode',
      account,
      insights,
    })
  })

  it('answers readUsage with the backend and the window, then follows usage/changed', async () => {
    const t = setup()
    expect(await firstUsageReport(t)).toEqual({ type: 'usageReport', backend: 'museCode', account })
    t.server.handle('usage/read', () => ({ usage }))
    await t.controller.handle({ type: 'readUsage' })
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'usageReport',
      backend: 'museCode',
      account,
      subscription: usage,
    })
    const changed = { ...usage, window: { ...usage.window, usedPercent: 40 } }
    t.server.notify('usage/changed', changed)
    await settle()
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'usageReport',
      backend: 'museCode',
      account,
      subscription: changed,
    })
    // One subscription per host: the second readUsage did not double the stream.
    const reports = t.surface.posted.filter((message) => message.type === 'usageReport')
    expect(reports).toHaveLength(3)
    t.controller.dispose()
    t.server.notify('usage/changed', usage)
    await settle()
    expect(t.surface.posted.filter((message) => message.type === 'usageReport')).toHaveLength(3)
  })

  it('reports a host failure as a notice', async () => {
    const t = setup()
    t.server.handle('usage/read', () => {
      throw new Error('usage unavailable')
    })
    await t.controller.handle({ type: 'readUsage' })
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'notice',
      level: 'error',
      text: 'Usage could not be read: usage unavailable',
    })
  })
})

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
      { type: 'notice', level: 'warning', text: UI_TEXT.noWorkspaceReason },
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
      history: 'snapshot',
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

  it('restores a rebuilt panel on its stored session, never over a live one or signed out (M12)', async () => {
    const tab = withHistory({ isRestorable: false })
    await tab.controller.restoreSession('old')
    expect(tab.server.requestsFor('session/resume')).toHaveLength(1)
    expect(tab.surface.posted).toContainEqual(historyLoaded)
    await tab.controller.restoreSession('other')
    expect(tab.server.requestsFor('session/resume')).toHaveLength(1)
    const signedOut = withHistory({ status: 'signedOut' })
    await signedOut.controller.restoreSession('old')
    expect(signedOut.server.requestsFor('session/resume')).toHaveLength(0)
    const noWorkspace = withHistory({ workspaceRoot: undefined })
    await noWorkspace.controller.restoreSession('old')
    expect(noWorkspace.server.requestsFor('session/resume')).toHaveLength(0)
  })

  it('reads a subagent’s child session for the Agent map and reports a failure (M14)', async () => {
    const t = withHistory()
    t.server.handle('session/read', (params) =>
      envelope({ ...storedSession, sessionId: params['sessionId'], name: 'Explorer' }),
    )
    await t.controller.handle({ type: 'readChildSession', sessionId: 'child-1' })
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'childTranscript',
      sessionId: 'child-1',
      name: 'Explorer',
      items: storedItems,
    })
    t.server.handle('session/read', () => {
      throw new Error('unknown session')
    })
    await t.controller.handle({ type: 'readChildSession', sessionId: 'ghost' })
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'notice',
      level: 'warning',
      text: 'Could not read the agent’s transcript: unknown session',
    })
  })

  it('exports the conversation as Markdown or Muse Code’s session log (M30)', async () => {
    const t = withHistory()
    await t.controller.handle({ type: 'exportConversation', format: 'markdown' })
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'notice',
      level: 'info',
      text: 'There is no conversation to export yet.',
    })
    await t.controller.handle({ type: 'resumeSession', sessionId: 'old' })
    t.server.handle('session/read', (params) =>
      envelope({ ...storedSession, sessionId: params['sessionId'], name: 'Fix the tests' }),
    )
    await t.controller.handle({ type: 'exportConversation', format: 'markdown' })
    expect(t.exported.markdown).toHaveLength(1)
    const [fileName, content] = t.exported.markdown[0]!
    expect(fileName).toBe('muse-fix-the-tests-2026-09-22.md')
    expect(content).toContain('# Fix the tests')
    expect(content).toContain('- Session: `old`')
    expect(content).toContain('## You\n\nOld prompt')
    expect(content).toContain('## Muse\n\nReply')
    await t.controller.handle({ type: 'exportConversation', format: 'sessionLog' })
    expect(t.exported.sessionLogs).toEqual([['old', 'muse-fix-the-tests-2026-09-22.json']])
    t.server.handle('session/read', () => {
      throw new Error('log locked')
    })
    await t.controller.handle({ type: 'exportConversation', format: 'markdown' })
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'notice',
      level: 'error',
      text: 'The conversation could not be exported: log locked',
    })
    t.server.handle('session/read', (params) =>
      envelope({ ...storedSession, sessionId: params['sessionId'] }, 'none'),
    )
    await t.controller.handle({ type: 'exportConversation', format: 'markdown' })
    expect(t.surface.posted.at(-1)).toMatchObject({
      type: 'notice',
      level: 'warning',
      text: expect.stringMatching(/^Muse Code did not return this conversation’s history/),
    })
    expect(t.exported.markdown).toHaveLength(1)
  })

  it('asks to wait while a reply runs, so an export never misses part of it (M30)', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    await t.controller.handle({ type: 'exportConversation', format: 'markdown' })
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'notice',
      level: 'info',
      text: 'Export once the reply has finished, so the file holds all of it.',
    })
    expect(t.exported.markdown).toEqual([])
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
    const { api, controller } = modelApiController(t, {
      workspaceRoot: String.raw`C:\Users\r\ws`,
      platform: 'win32',
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

describe('ConversationController: voice dictation (M9)', () => {
  interface FakeDriver {
    readonly calls: string[]
    listener: DictationListener | undefined
  }

  function fakeDictation(): { setup: DictationSetup; driver: FakeDriver } {
    const driver: FakeDriver = { calls: [], listener: undefined }
    const setup: DictationSetup = {
      isAvailable: true,
      create: (listener) => {
        driver.listener = listener
        driver.calls.push('create')
        // The three methods of DictationHandle, the calls the controller makes.
        const record = (call: string) => () => {
          driver.calls.push(call)
        }
        return {
          start: record('start'),
          stop: record('stop'),
          dispose: record('dispose'),
        }
      },
    }
    return { setup, driver }
  }

  it('tells the webview the microphone is unavailable, with the reason, on ready and on a stray press', async () => {
    const t = setup()
    t.controller.surfaceReady()
    const unavailable = {
      type: 'dictationState',
      status: 'unavailable',
      reason: 'no helper in tests',
      engine: 'system',
    }
    expect(t.surface.posted).toContainEqual(unavailable)
    t.surface.posted.length = 0
    await t.controller.handle({ type: 'dictation', action: 'start' })
    expect(t.surface.posted).toEqual([unavailable])
  })

  it('creates the driver on the first press, relays status, inserts phrases with a space, and reports errors', async () => {
    const { setup: dictation, driver } = fakeDictation()
    const t = setup({ dictation })
    t.controller.surfaceReady()
    expect(t.surface.posted).toContainEqual({
      type: 'dictationState',
      status: 'idle',
      engine: 'system',
    })
    expect(driver.calls).toEqual([])
    await t.controller.handle({ type: 'dictation', action: 'start' })
    await t.controller.handle({ type: 'dictation', action: 'stop' })
    expect(driver.calls).toEqual(['create', 'start', 'stop'])
    t.surface.posted.length = 0
    driver.listener?.onStatus('listening')
    driver.listener?.onText('fix the bug')
    driver.listener?.onError('No microphone is available')
    expect(t.surface.posted).toEqual([
      { type: 'dictationState', status: 'listening', engine: 'system' },
      { type: 'insertText', text: 'fix the bug ' },
      {
        type: 'notice',
        level: 'error',
        text: 'Voice dictation failed: No microphone is available',
      },
    ])
    // A reopened webview learns the current status.
    t.surface.posted.length = 0
    t.controller.surfaceReady()
    expect(t.surface.posted).toContainEqual({
      type: 'dictationState',
      status: 'listening',
      engine: 'system',
    })
    t.controller.dispose()
    expect(driver.calls.at(-1)).toBe('dispose')
  })
})

describe('ConversationController: reload host action (M11)', () => {
  it('rebuilds the surface itself instead of delegating', async () => {
    const t = setup()
    await t.controller.handle({ type: 'hostAction', action: 'reload' })
    expect(t.surface.reload).toHaveBeenCalledOnce()
    expect(t.hostActions).toEqual([])
  })
})

describe('ConversationController (M15)', () => {
  it('lists the models as soon as the panel is ready, once, without starting a session', async () => {
    const t = setup()
    t.controller.surfaceReady()
    await settle()
    expect(t.surface.posted).toContainEqual(modelList)
    // The pill needs the model the first send will use, not only the list (M16).
    const info = t.surface.posted.find((message) => message.type === 'sessionInfo')
    expect(info).toMatchObject({ modelId: 'muse-spark-1.3', contextLimit: 1_007_997 })
    expect(info).not.toHaveProperty('sessionId')
    expect(t.server.requestsFor('model/list')).toHaveLength(1)
    expect(t.server.requestsFor('session/start')).toEqual([])
    await t.send('l1', 'hi')
    expect(t.server.requestsFor('model/list')).toHaveLength(1)
  })

  it("opens a tool row's file at its change through the host (M16)", async () => {
    const t = setup()
    await t.controller.handle({ type: 'openFile', path: 'src/a.ts', startLine: 4, endLine: 5 })
    await t.controller.handle({ type: 'openFile', path: String.raw`C:\abs\b.ts` })
    expect(t.openedFiles).toEqual([
      ['src/a.ts', { startLine: 4, endLine: 5 }],
      [String.raw`C:\abs\b.ts`, undefined],
    ])
  })

  it('leaves the host alone while signed out and warms the models after a sign-in', async () => {
    const t = setup({ status: 'signedOut' })
    t.controller.surfaceReady()
    await settle()
    expect(t.server.requestsFor('model/list')).toEqual([])
    t.auth.snapshot = { status: 'signedIn', detail: undefined }
    await t.controller.handle({ type: 'signIn', method: 'browser' })
    await settle()
    expect(t.server.requestsFor('model/list')).toHaveLength(1)
  })

  it('opens a tool output in an editor: the stored output paged in full, else the transcript copy', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    await t.controller.handle({
      type: 'openOutput',
      itemId: 'item-abcdef123456',
      label: 'PowerShell',
      text: 'short copy',
      outputRef: 'ref-1',
    })
    await t.controller.handle({
      type: 'openOutput',
      itemId: 'item-abcdef123456',
      label: 'Read',
      text: 'inline copy',
    })
    expect(t.opened).toEqual([
      ['PowerShell tool output (123456)', '{"files":[{"path":"notes.md","hunks":[]}]}#ref-1'],
      ['Read tool output (123456)', 'inline copy'],
    ])
  })

  it('reports an approval decision the CLI could not record as a warning, not a refusal', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    t.server.handle('approval/decide', () => {
      throw new Error('approval ledger durability fence')
    })
    await t.controller.handle({
      type: 'decideApproval',
      approvalId: 'ap-1',
      choiceId: 'allow',
      requirementId: { approvalId: 'ap-1', sourceIndex: 0 },
    })
    expect(t.surface.posted.at(-2)).toMatchObject({
      type: 'notice',
      level: 'warning',
      text: expect.stringContaining('may have run anyway') as string,
    })
    expect(t.surface.posted.at(-1)).toEqual({ type: 'approvalReopened', approvalId: 'ap-1' })
  })
})

describe('ConversationController usage cache (M16)', () => {
  const stale: SubscriptionUsage = {
    observedAtMs: 1000,
    tier: 'tier-1',
    window: { usedPercent: 10, resetsAtMs: 5000, windowDurationMins: 300 },
    weekly: { usedPercent: 5, resetsAtMs: 9000 },
  }

  it('shows the last reported window while the CLI has none yet, then refreshes the cache', async () => {
    const t = setup({ cachedUsage: stale })
    expect(await firstUsageReport(t)).toMatchObject({
      type: 'usageReport',
      backend: 'museCode',
      subscription: stale,
    })
    const fresh = { ...stale, observedAtMs: 2000 }
    t.server.handle('usage/read', () => ({ usage: fresh }))
    await t.controller.handle({ type: 'readUsage' })
    expect(t.surface.posted.at(-1)).toMatchObject({ subscription: fresh })
    expect(t.cachedUsage()).toEqual(fresh)
  })

  it('reports no window at all when nothing was ever cached', async () => {
    const t = setup()
    expect(await firstUsageReport(t)).not.toHaveProperty('subscription')
    expect(t.cachedUsage()).toBeUndefined()
  })
})

describe('ConversationController question cancel (M16)', () => {
  it('declines a prompt through userInput/cancel and reports a refusal', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    t.server.handle('userInput/cancel', (params) => ({
      status: 'accepted',
      userInputId: params['userInputId'],
    }))
    await t.controller.handle({ type: 'cancelQuestion', userInputId: 'q1' })
    expect(t.server.requestsFor('userInput/cancel')[0]?.params).toMatchObject({
      userInputId: 'q1',
    })
    t.server.handle('userInput/cancel', () => {
      throw new Error('already settled')
    })
    await t.controller.handle({ type: 'cancelQuestion', userInputId: 'q2' })
    expect(t.surface.posted.at(-1)).toMatchObject({
      type: 'notice',
      level: 'error',
      text: expect.stringContaining('already settled') as string,
    })
  })

  it('does nothing without a session', async () => {
    const t = setup()
    await t.controller.handle({ type: 'cancelQuestion', userInputId: 'q1' })
    expect(t.server.requestsFor('userInput/cancel')).toEqual([])
  })
})

describe('ConversationController chat references (M17)', () => {
  it('sends a reply or a quoted passage as its own context part and keeps the typed text as displayText', async () => {
    const t = setup()
    await t.controller.handle({
      type: 'sendMessage',
      localId: 'l1',
      text: 'why pnpm?',
      attachmentIds: [],
      reference: { intent: 'reply', role: 'assistant', entryId: 'a1', text: 'Use pnpm.' },
    })
    const params = t.server.requestsFor('turn/start')[0]?.params
    const input = params?.['input'] as readonly { type: string; text?: string }[]
    expect(input[0]).toEqual({ type: 'text', text: 'why pnpm?' })
    expect(input[1]?.text).toContain('<chat_reference intent="reply" from="assistant">')
    expect(input[1]?.text).toContain('Use pnpm.')
    expect(params?.['displayText']).toBe('why pnpm?')
    t.finishTurn()
    await settle()
    await t.controller.handle({
      type: 'sendMessage',
      localId: 'l2',
      text: 'is this right?',
      attachmentIds: [],
      reference: { intent: 'question', role: 'tool', text: 'exit code 1' },
    })
    const second = t.server.requestsFor('turn/start')[1]?.params?.['input'] as readonly {
      text?: string
    }[]
    expect(second[1]?.text).toContain('intent="question" from="tool"')
  })
})

describe('ConversationController subagent controls (M18)', () => {
  it('relays owner controls and notes to the session and reports a refusal', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    t.server.handle('subagent/stop', (params) => ({
      status: 'accepted',
      subagentId: params['subagentId'],
    }))
    t.server.handle('subagent/followupTask', (params) => ({
      status: 'accepted',
      subagentId: params['subagentId'],
    }))
    await t.controller.handle({ type: 'subagentControl', subagentId: 'sub-1', action: 'stop' })
    await t.controller.handle({
      type: 'subagentMessage',
      subagentId: 'sub-1',
      body: '  now BETA ',
      isFollowup: true,
    })
    await t.controller.handle({
      type: 'subagentMessage',
      subagentId: 'sub-1',
      body: ' '.repeat(3),
      isFollowup: false,
    })
    expect(t.server.requestsFor('subagent/stop')[0]?.params).toMatchObject({ subagentId: 'sub-1' })
    expect(t.server.requestsFor('subagent/followupTask')[0]?.params).toMatchObject({
      subagentId: 'sub-1',
      body: 'now BETA',
    })
    expect(t.server.requestsFor('subagent/sendMessage')).toEqual([])
    t.server.handle('subagent/interrupt', () => {
      throw new Error('child already closed')
    })
    await t.controller.handle({ type: 'subagentControl', subagentId: 'sub-1', action: 'interrupt' })
    expect(t.surface.posted.at(-1)).toMatchObject({
      type: 'notice',
      level: 'error',
      text: expect.stringContaining('child already closed') as string,
    })
  })

  it('does nothing without a session', async () => {
    const t = setup()
    await t.controller.handle({ type: 'subagentControl', subagentId: 'sub-1', action: 'stop' })
    await t.controller.handle({
      type: 'subagentMessage',
      subagentId: 'sub-1',
      body: 'x',
      isFollowup: false,
    })
    expect(t.server.requestsFor('subagent/stop')).toEqual([])
  })
})

/** The agent events a test surface was sent, in order. */
function agentEvents(t: ReturnType<typeof setup>) {
  return t.surface.posted.flatMap((message) =>
    message.type === 'agentEvent' ? [message.event] : [],
  )
}

/** A controller backed by the in-process Model API, with explicit test I/O. */
function modelApiController(
  t: ReturnType<typeof setup>,
  options: {
    readonly workspaceRoot?: string
    readonly platform?: NodeJS.Platform
    readonly io?: ModelApiHostDeps['io']
    readonly contextIo?: ModelApiHostDeps['contextIo']
    readonly newId?: () => string
  } = {},
) {
  const api = fakeModelApi()
  const host = new ModelApiHost({
    client: fakeModelApiClient(api, t.log),
    workspaceRoot: options.workspaceRoot ?? '/ws',
    platform: options.platform ?? 'linux',
    io: options.io ?? noopToolIo,
    contextIo: options.contextIo ?? memoryContextIo(new Map()),
    newId: options.newId ?? (() => 'fixed'),
    now: () => 0,
    log: t.log,
    personalSkillsRoot: undefined,
    isWorkspaceTrusted: () => true,
    describeEnvironment: () => Promise.resolve({ git: undefined }),
    isPaidFeatureOn: () => false,
    notePaidUse: () => undefined,
  })
  const controller = new ConversationController({
    ...t.deps,
    ensureHost: () => Promise.resolve(host),
  })
  return { api, host, controller }
}

function modelApiControllerWithIo(t: ReturnType<typeof setup>, io: MemoryToolIo) {
  let nextId = 0
  return modelApiController(t, {
    io,
    contextIo: memoryContextIo(io.files),
    newId: () => `id${String(++nextId)}`,
  })
}

function acceptApprovalDecisions(t: ReturnType<typeof setup>): void {
  t.server.handle('approval/decide', (params) => ({
    status: 'accepted',
    commandId: params['commandId'],
    approvalId: params['approvalId'],
    terminal: true,
  }))
}

describe('ConversationController: permission hardening (D24)', () => {
  const choices = [
    { choiceId: 'allow_once', label: 'Allow once', decision: 'approved', scope: 'once' },
    { choiceId: 'abort', label: 'Reject', decision: 'abort', scope: 'once' },
  ]
  function approvalParams(approvalId: string, overrides: Record<string, unknown> = {}) {
    return {
      sessionId: 's1',
      approvalId,
      itemId: `item-${approvalId}`,
      toolName: 'write',
      rawArgs: '{}',
      currentRequirementId: { approvalId, sourceIndex: 0 },
      subject: { kind: 'fileAccess', access: 'write', path: '/ws/a.ts' },
      availableChoices: choices,
      judgeEscalated: false,
      protectedWrite: false,
      ...overrides,
    }
  }
  function requestApproval(
    t: ReturnType<typeof setup>,
    approvalId: string,
    overrides: Record<string, unknown> = {},
  ) {
    t.server.notify('approval/requested', approvalParams(approvalId, overrides))
  }

  it('never takes a message typed while a card waits for a decision (Roo #11211)', async () => {
    const t = setup({ hasApprovalUi: true })
    await t.send('l1', 'hi')
    t.server.notify('turn/started', { sessionId: 's1', turnId: 't1', viewCursor: 'v' })
    requestApproval(t, 'a1')
    await settle()
    await t.send('l2', 'yes')
    // The text steers the running turn; the card stays pending until a choice is pressed.
    expect(t.server.requestsFor('turn/steer')[0]?.params).toMatchObject({ expectedTurnId: 't1' })
    expect(t.server.requestsFor('approval/decide')).toHaveLength(0)
    expect(t.surface.posted).toContainEqual({
      type: 'agentEvent',
      event: expect.objectContaining({ type: 'approvalRequested', approvalId: 'a1' }),
    })
  })

  it('answers a plain file-write approval itself in Edit automatically, labelled so', async () => {
    const t = setup({ hasApprovalUi: true, initialPermissionMode: 'acceptEdits' })
    t.server.handle('approval/decide', (params) => ({
      status: 'accepted',
      commandId: params['commandId'],
      approvalId: params['approvalId'],
      terminal: true,
    }))
    await t.send('l1', 'hi')
    requestApproval(t, 'a1')
    await vi.waitFor(() => {
      expect(t.server.requestsFor('approval/decide')).toHaveLength(1)
    })
    expect(t.server.requestsFor('approval/decide')[0]?.params).toMatchObject({
      approvalId: 'a1',
      choiceId: 'allow_once',
      requirementId: { approvalId: 'a1', sourceIndex: 0 },
    })
    // No card was shown for it.
    expect(agentEvents(t).some((event) => event.type === 'approvalRequested')).toBe(false)
    t.server.notify('approval/resolved', {
      sessionId: 's1',
      approvalId: 'a1',
      itemId: 'item-a1',
      decision: 'approved',
      resolvedBy: 'user',
    })
    await vi.waitFor(() => {
      expect(agentEvents(t).at(-1)?.type).toBe('approvalResolved')
    })
    expect(agentEvents(t).at(-1)).toEqual({
      type: 'approvalResolved',
      approvalId: 'a1',
      itemId: 'item-a1',
      decision: 'approved',
      resolvedBy: 'Edit automatically',
    })
  })

  it('does not auto-approve a Manual Model API edit when an Edit surface joins later', async () => {
    const t = setup({ hasApprovalUi: true })
    const io = memoryToolIo({ 'a.ts': 'old' }, '/ws')
    const { api, host, controller } = modelApiControllerWithIo(t, io)
    const second = new ConversationController({
      ...t.deps,
      initialPermissionMode: 'acceptEdits',
      ensureHost: () => Promise.resolve(host),
    })
    try {
      api.script(
        {
          calls: [
            {
              name: 'write_file',
              arguments: '{"path":"a.ts","content":"new"}',
              callId: 'call_write',
            },
          ],
        },
        { text: 'Done.' },
      )
      await controller.handle({
        type: 'sendMessage',
        localId: 'l1',
        text: 'edit a.ts',
        attachmentIds: [],
      })
      await vi.waitFor(() => {
        expect(agentEvents(t).some((event) => event.type === 'approvalRequested')).toBe(true)
      })
      const live = await host.listSessions({ workspaceRoot: '/ws', limit: 1 })
      const sessionId = live.sessions[0]?.sessionId
      if (sessionId === undefined) {
        throw new Error('expected a pending Model API edit')
      }
      await second.handle({ type: 'resumeSession', sessionId })
      await settle()
      expect(io.files.get('/ws/a.ts')).toBe('old')
      expect(agentEvents(t).some((event) => event.type === 'approvalResolved')).toBe(false)
    } finally {
      second.dispose()
      controller.dispose()
      await host.close()
    }
  })

  it('does not auto-approve a Manual Muse Code edit when an Edit surface joins later', async () => {
    for (const delivery of ['backlog', 'listPending']) {
      const t = setup({ hasApprovalUi: true })
      const pending = approvalParams('a1')
      t.server.handle('session/resume', () => ({
        ...envelope({ ...storedSession, sessionId: 's1', status: 'running', activeTurnId: 't1' }),
        pendingRequests: delivery === 'listPending' ? [{ kind: 'approval' }] : [],
      }))
      t.server.handle('approval/listPending', () => ({
        approvals: delivery === 'listPending' ? [pending] : [],
        userInputs: [],
      }))
      acceptApprovalDecisions(t)
      const second = new ConversationController({
        ...t.deps,
        initialPermissionMode: 'acceptEdits',
        ensureHost: () => Promise.resolve(t.host),
      })
      try {
        await t.send('l1', 'edit a.ts')
        if (delivery === 'backlog') {
          requestApproval(t, 'a1')
          await settle()
        }
        await second.handle({ type: 'resumeSession', sessionId: 's1' })
        await settle()
        expect(t.server.requestsFor('approval/decide')).toHaveLength(0)
        expect(
          t.surface.posted.filter(
            (message) =>
              message.type === 'agentEvent' &&
              message.event.type === 'approvalRequested' &&
              message.event.approvalId === 'a1',
          ).length,
        ).toBeGreaterThan(0)
      } finally {
        second.dispose()
        t.controller.dispose()
      }
    }
  })

  it('does not let an earlier Edit surface approve a later Manual Model API turn', async () => {
    const t = setup({ hasApprovalUi: true, initialPermissionMode: 'acceptEdits' })
    const io = memoryToolIo({ 'a.ts': 'old' }, '/ws')
    const { api, host, controller } = modelApiControllerWithIo(t, io)
    const second = new ConversationController({
      ...t.deps,
      initialPermissionMode: 'manual',
      ensureHost: () => Promise.resolve(host),
    })
    try {
      api.script({ text: 'Ready.' })
      await controller.handle({
        type: 'sendMessage',
        localId: 'l1',
        text: 'hello',
        attachmentIds: [],
      })
      await vi.waitFor(() => {
        expect(agentEvents(t).some((event) => event.type === 'turnCompleted')).toBe(true)
      })
      const live = await host.listSessions({ workspaceRoot: '/ws', limit: 1 })
      const sessionId = live.sessions[0]?.sessionId
      if (sessionId === undefined) {
        throw new Error('expected a Model API session')
      }
      await second.handle({ type: 'resumeSession', sessionId })
      api.script(
        {
          calls: [
            {
              name: 'write_file',
              arguments: '{"path":"a.ts","content":"new"}',
              callId: 'call_write',
            },
          ],
        },
        { text: 'Done.' },
      )
      await second.handle({
        type: 'sendMessage',
        localId: 'l2',
        text: 'edit a.ts',
        attachmentIds: [],
      })
      await vi.waitFor(() => {
        expect(agentEvents(t).some((event) => event.type === 'approvalRequested')).toBe(true)
      })
      await settle()
      expect(agentEvents(t).some((event) => event.type === 'approvalResolved')).toBe(false)
      expect(io.files.get('/ws/a.ts')).toBe('old')
    } finally {
      second.dispose()
      controller.dispose()
      await host.close()
    }
  })

  const sharedModeCases: readonly {
    readonly firstMode: ConversationDeps['initialPermissionMode']
    readonly secondMode: ConversationDeps['initialPermissionMode']
    readonly sender: 'first' | 'second'
  }[] = [
    { firstMode: 'acceptEdits', secondMode: 'manual', sender: 'second' },
    { firstMode: 'manual', secondMode: 'acceptEdits', sender: 'first' },
    { firstMode: 'acceptEdits', secondMode: 'acceptEdits', sender: 'second' },
  ]

  it.each(sharedModeCases)(
    'keeps shared Muse Code approvals explicit ($firstMode, $secondMode, $sender)',
    async ({ firstMode, secondMode, sender }) => {
      const t = setup({ hasApprovalUi: true, initialPermissionMode: firstMode })
      t.server.handle('session/resume', () =>
        envelope({ ...storedSession, sessionId: 's1', status: 'idle' }),
      )
      acceptApprovalDecisions(t)
      const second = new ConversationController({
        ...t.deps,
        initialPermissionMode: secondMode,
        ensureHost: () => Promise.resolve(t.host),
      })
      try {
        await t.send('l1', 'hello')
        t.finishTurn()
        await settle()
        await second.handle({ type: 'resumeSession', sessionId: 's1' })
        const sending = sender === 'first' ? t.controller : second
        await sending.handle({
          type: 'sendMessage',
          localId: 'l2',
          text: 'edit a.ts',
          attachmentIds: [],
        })
        requestApproval(t, 'a2')
        await settle()
        expect(t.server.requestsFor('approval/decide')).toHaveLength(0)
        if (firstMode === 'acceptEdits' && secondMode === 'manual') {
          second.dispose()
          requestApproval(t, 'a3')
          await vi.waitFor(() => {
            expect(t.server.requestsFor('approval/decide')).toHaveLength(1)
          })
        }
      } finally {
        second.dispose()
        t.controller.dispose()
      }
    },
  )

  it('shows the card for protected writes, escalations, commands and the other modes', async () => {
    const t = setup({ hasApprovalUi: true, initialPermissionMode: 'acceptEdits' })
    await t.send('l1', 'hi')
    requestApproval(t, 'p', { protectedWrite: true })
    requestApproval(t, 'j', { judgeEscalated: true })
    requestApproval(t, 's', { subject: { kind: 'shell', command: 'npm test' } })
    requestApproval(t, 'r', { subject: { kind: 'fileAccess', access: 'read', path: '/x' } })
    // A paid call is always the user's to accept (M34, PLAN.md D30).
    requestApproval(t, 'i', {
      subject: {
        kind: 'paidTool',
        toolName: 'generate_image',
        path: 'a.png',
        paidFeature: 'imageGeneration',
      },
    })
    const manual = setup({ hasApprovalUi: true, initialPermissionMode: 'manual' })
    await manual.send('l1', 'hi')
    requestApproval(manual, 'm')
    await vi.waitFor(() => {
      expect(agentEvents(manual).map((event) => event.type)).toContain('approvalRequested')
      expect(agentEvents(t).filter((event) => event.type === 'approvalRequested')).toHaveLength(5)
    })
    expect(t.server.requestsFor('approval/decide')).toHaveLength(0)
    expect(manual.server.requestsFor('approval/decide')).toHaveLength(0)
    expect(
      agentEvents(t).flatMap((event) =>
        event.type === 'approvalRequested' ? [event.approvalId] : [],
      ),
    ).toEqual(['p', 'j', 's', 'r', 'i'])
    expect(agentEvents(manual).map((event) => event.type)).toContain('approvalRequested')
  })

  it('shows the card after all when the host refuses the automatic answer', async () => {
    const t = setup({ hasApprovalUi: true, initialPermissionMode: 'acceptEdits' })
    t.server.handle('approval/decide', () => {
      throw new Error('stale requirement')
    })
    await t.send('l1', 'hi')
    requestApproval(t, 'a1')
    await vi.waitFor(() => {
      expect(agentEvents(t).some((event) => event.type === 'approvalRequested')).toBe(true)
    })
    expect(String(t.log.warn.mock.calls.at(-1)?.[0])).toContain('stale requirement')
  })

  it('drops a conversation out of Bypass when the setting is turned off', async () => {
    const t = setup({ hasApprovalUi: true, initialPermissionMode: 'bypassPermissions' })
    await t.send('l1', 'hi')
    expect(t.server.requestsFor('session/start')[0]?.params).toMatchObject({
      approvalMode: 'allowAll',
    })
    t.setBypassAllowed(false)
    await t.controller.revokeBypass()
    expect(t.server.requestsFor('session/setApprovalMode').at(-1)?.params).toMatchObject({
      mode: 'promptUnmatched',
    })
    expect(t.surface.posted.at(-2)).toMatchObject({
      type: 'notice',
      level: 'warning',
      text: expect.stringContaining('back in Manual') as string,
    })
    expect(t.surface.posted.at(-1)).toEqual({ ...composerState, permissionMode: 'manual' })
    // Nothing to do outside Bypass.
    const before = t.surface.posted.length
    await t.controller.revokeBypass()
    expect(t.surface.posted).toHaveLength(before)
  })

  it('ends the session when the host will not leave Bypass', async () => {
    const t = setup({ hasApprovalUi: true, initialPermissionMode: 'bypassPermissions' })
    await t.send('l1', 'hi')
    t.server.handle('session/setApprovalMode', () => {
      throw new Error('locked')
    })
    await t.controller.revokeBypass()
    await t.send('l2', 'again')
    // A new session, started in Manual.
    expect(t.server.requestsFor('session/start')).toHaveLength(2)
    expect(t.server.requestsFor('session/start')[1]?.params).toMatchObject({
      approvalMode: 'promptUnmatched',
    })
  })

  it('never starts a remote window in Bypass, and asks once before entering it', async () => {
    const t = setup({
      hasApprovalUi: true,
      initialPermissionMode: 'bypassPermissions',
      isRemoteWindow: true,
    })
    t.controller.surfaceReady()
    expect(t.surface.posted).toContainEqual({ ...composerState, permissionMode: 'manual' })
    expect(t.surface.posted).toContainEqual({
      type: 'notice',
      level: 'warning',
      text: expect.stringContaining('remote window') as string,
    })
    await t.controller.handle({ type: 'setPermissionMode', mode: 'bypassPermissions' })
    await t.controller.handle({ type: 'setPermissionMode', mode: 'manual' })
    await t.controller.handle({ type: 'setPermissionMode', mode: 'bypassPermissions' })
    expect(t.remoteBypassPrompts()).toBe(1)
    expect(t.surface.posted.findLast((message) => message.type === 'composerState')).toEqual({
      ...composerState,
      permissionMode: 'bypassPermissions',
    })
    const declined = setup({ isRemoteWindow: true, confirmsRemoteBypass: false })
    await declined.controller.handle({ type: 'setPermissionMode', mode: 'bypassPermissions' })
    expect(declined.surface.posted.at(-1)).toEqual({ ...composerState, permissionMode: 'manual' })
  })

  it('asks before resuming on a contributor-tier model and falls back when declined', async () => {
    const t = setup({ confirmsContributor: false })
    t.server.handle('model/list', () => ({
      providerId: 'meta',
      profileId: null,
      source: 'catalog',
      models: [
        { modelId: 'muse-spark-1.3', displayLabel: 'x', contextLimit: 1, isDefault: true },
        {
          modelId: 'muse-spark-1.3-contributor',
          displayLabel: 'c',
          contextLimit: 1,
          isDefault: false,
          isActive: true,
        },
      ],
    }))
    t.server.handle('session/resume', () => envelope(storedSession))
    await t.controller.handle({ type: 'resumeSession', sessionId: 'old' })
    expect(t.contributorPrompts).toEqual(['muse-spark-1.3-contributor'])
    expect(t.server.requestsFor('session/setModel').at(-1)?.params).toMatchObject({
      sessionId: 'old',
      model: { modelId: 'muse-spark-1.3' },
    })
    expect(t.surface.posted).toContainEqual({
      type: 'notice',
      level: 'info',
      text: expect.stringContaining('now uses muse-spark-1.3') as string,
    })
  })
})

describe('ConversationController: lifecycle (D25)', () => {
  it('cancels the running turn before a restart and resumes the session on the next message', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    await t.controller.backendStopping(false)
    expect(t.server.requestsFor('turn/cancel')).toHaveLength(1)
    expect(agentEvents(t)).toContainEqual({
      type: 'turnCompleted',
      turnId: 't1',
      terminal: 'cancelled',
      reason: 'Stopped: the backend restarted',
    })
    expect(t.host.sessionCount).toBe(0)
    t.server.handle('session/resume', () => envelope({ ...storedSession, sessionId: 's1' }))
    await t.send('l2', 'again')
    expect(t.server.requestsFor('session/resume')).toHaveLength(1)
    expect(t.server.requestsFor('session/start')).toHaveLength(1)
    expect(t.surface.posted).toContainEqual({
      type: 'notice',
      level: 'info',
      text: 'Conversation continued after the restart.',
    })
  })

  it('starts afresh after a sign-out, and says so when a resume fails', async () => {
    const ending = setup()
    await ending.send('l1', 'hi')
    ending.finishTurn()
    await ending.controller.backendStopping(true)
    await ending.send('l2', 'again')
    expect(ending.server.requestsFor('session/resume')).toHaveLength(0)
    expect(ending.server.requestsFor('session/start')).toHaveLength(2)
    const failing = setup()
    await failing.send('l1', 'hi')
    await failing.controller.backendStopping(false)
    failing.server.handle('session/resume', () => {
      throw new Error('gone')
    })
    await failing.send('l2', 'again')
    expect(failing.server.requestsFor('session/start')).toHaveLength(2)
    expect(failing.surface.posted).toContainEqual({
      type: 'notice',
      level: 'warning',
      text: expect.stringContaining('could not be continued') as string,
    })
  })

  it('starts one session for two quick messages', async () => {
    const t = setup()
    await Promise.all([t.send('l1', 'one'), t.send('l2', 'two')])
    expect(t.server.requestsFor('session/start')).toHaveLength(1)
  })

  it('resumes and retries once when the host no longer holds the session', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    t.finishTurn()
    await settle()
    let starts = 0
    t.server.handle('turn/start', (params) => {
      starts += 1
      if (starts === 1) {
        throw Object.assign(new Error('not loaded'), { kind: 'sessionNotLoaded' })
      }
      return {
        turnId: 't2',
        status: 'accepted',
        disposition: 'started',
        startedNewTurn: true,
        commandId: params['commandId'],
      }
    })
    t.server.handle('session/resume', () => envelope({ ...storedSession, sessionId: 's1' }))
    await t.send('l2', 'again')
    expect(t.server.requestsFor('session/resume')[0]?.params).toMatchObject({ sessionId: 's1' })
    expect(t.surface.posted).toContainEqual({ type: 'turnAccepted', localId: 'l2', turnId: 't2' })
  })

  it('hears the host close this session and resumes it on the next message', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    t.server.notify('session/closed', { sessionId: 's1', reason: 'idleEviction' })
    await settle()
    expect(t.host.sessionCount).toBe(0)
    expect(t.surface.posted).toContainEqual({
      type: 'notice',
      level: 'info',
      text: 'Muse Code closed this session (idleEviction). The next message resumes it.',
    })
    t.server.handle('session/resume', () => envelope({ ...storedSession, sessionId: 's1' }))
    await t.send('l2', 'again')
    expect(t.server.requestsFor('session/resume')).toHaveLength(1)
  })

  it('cancels the running turn when the conversation is cleared, and keeps nothing a closed panel started', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    await t.controller.handle({ type: 'clearConversation' })
    await settle()
    expect(t.server.requestsFor('turn/cancel')).toHaveLength(1)
    const closing = setup()
    const sending = closing.send('l1', 'hi')
    closing.controller.dispose()
    await sending
    await settle()
    expect(closing.host.sessionCount).toBe(0)
  })
})

function gapInlineHistory(sessionId: string) {
  return {
    session: { sessionId, createdAt: 'c', updatedAt: 'u', status: 'running', turnCount: 1 },
    history: { mode: 'inline', items: [] },
    viewCursor: 'v:s1:3',
    pendingRequests: [],
  }
}

function setupWithDeferredHost() {
  const gate = Promise.withResolvers<undefined>()
  let isDelayed = false
  let isWaiting = false
  const t = setup({
    beforeEnsureHost: () => {
      if (!isDelayed) {
        return Promise.resolve()
      }
      isWaiting = true
      return gate.promise
    },
  })
  return {
    t,
    delay: () => {
      isDelayed = true
    },
    allowOtherRequests: () => {
      isDelayed = false
    },
    release: () => {
      isDelayed = false
      gate.resolve(undefined)
    },
    isWaiting: () => isWaiting,
  }
}

async function activeGoalForGap(t: ReturnType<typeof setup>): Promise<void> {
  await t.send('l1', 'hi')
  t.server.notify('session/goalChanged', {
    sessionId: 's1',
    goal: { objective: 'Old goal', status: 'active', percentComplete: 50 },
  })
  t.server.handle('session/read', (params) => gapInlineHistory(String(params['sessionId'])))
}

describe('ConversationController: protocol semantics (D26)', () => {
  const refusal = refusalOf

  it('says a late decision, answer or cancel was not needed, as information', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    t.server.handle('approval/decide', refusal('approvalRequirementStale'))
    await t.controller.handle({
      type: 'decideApproval',
      approvalId: 'a1',
      choiceId: 'allow_once',
      requirementId: { approvalId: 'a1', sourceIndex: 0 },
    })
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'notice',
      level: 'info',
      text: UI_TEXT.promptMovedOn,
    })
    t.server.handle('userInput/answer', refusal('userInputAlreadySettled'))
    await t.controller.handle({ type: 'answerQuestion', userInputId: 'q1', answers: [] })
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'notice',
      level: 'info',
      text: UI_TEXT.promptAlreadySettled,
    })
    t.server.handle('userInput/cancel', refusal('userInputNotFound'))
    await t.controller.handle({ type: 'cancelQuestion', userInputId: 'q1' })
    // A prompt the host no longer holds loses its card.
    expect(t.surface.posted.slice(-2)).toEqual([
      { type: 'notice', level: 'info', text: UI_TEXT.promptGone },
      { type: 'promptDropped', userInputId: 'q1' },
    ])
    t.server.handle('approval/decide', refusal('approvalNotFound'))
    await t.controller.handle({
      type: 'decideApproval',
      approvalId: 'a2',
      choiceId: 'allow_once',
      requirementId: { approvalId: 'a2', sourceIndex: 0 },
    })
    expect(t.surface.posted.at(-1)).toEqual({ type: 'promptDropped', approvalId: 'a2' })
  })

  it('tells the panel where rename and fork are refused', async () => {
    const t = setup({
      handshake: { platformOs: 'windows', serverInfo: { name: 'muse', version: '1.3.0' } },
    })
    await t.send('l1', 'hi')
    expect(t.surface.posted).toContainEqual({
      type: 'sessionInfo',
      modelId: 'muse-spark-1.3',
      contextLimit: 1_007_997,
      sessionId: 's1',
      canEditSessions: false,
    })
  })

  it('reloads the transcript after a delivery gap, once more for a gap during the read', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    await settle()
    let reads = 0
    t.server.handle('session/read', (params) => {
      reads += 1
      if (reads === 1) {
        t.server.notify('view/gap', { sessionId: 's1', after: 'v2', next: 'v3' })
      }
      return {
        session: {
          sessionId: params['sessionId'],
          createdAt: 'c',
          updatedAt: 'u',
          status: 'running',
          turnCount: 1,
        },
        history: {
          mode: 'inline',
          items: [{ itemId: 'm1', kind: 'agentMessage', status: 'completed', text: 'all of it' }],
        },
        viewCursor: 'v9',
        pendingRequests: [],
      }
    })
    t.server.handle('view/page', () => ({ events: [], nextCursor: null }))
    t.surface.posted.length = 0
    t.server.notify('view/gap', { sessionId: 's1', after: 'v1', next: 'v2' })
    await settle()
    await settle()
    expect(reads).toBe(2)
    const reloads = t.surface.posted.filter((message) => message.type === 'historyLoaded')
    expect(reloads).toHaveLength(2)
    // The turn the send started is still running: the reload keeps it (D26).
    expect(reloads[0]).toMatchObject({
      sessionId: 's1',
      items: [expect.objectContaining({ itemId: 'm1' })],
      activeTurnId: 't1',
      goal: null,
    })
    expect(t.surface.posted).toContainEqual({
      type: 'notice',
      level: 'info',
      text: UI_TEXT.viewGapReloaded,
    })
    expect(t.surface.posted.some((message) => message.type === 'agentEvent')).toBe(false)
    t.server.handle('session/read', () => {
      throw new Error('log locked')
    })
    t.server.notify('view/gap', { sessionId: 's1', after: 'v9', next: 'v10' })
    await settle()
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'notice',
      level: 'warning',
      text: `${UI_TEXT.viewGapReloadFailed}: log locked`,
    })
  })

  it.each([
    { name: 'clear', recoveredGoal: null, paged: false },
    {
      name: 'completion',
      recoveredGoal: { objective: 'Old goal', status: 'complete', percentComplete: 100 },
      paged: true,
    },
  ])('recovers a missed goal $name from view history', async ({ recoveredGoal, paged }) => {
    const t = setup()
    await activeGoalForGap(t)
    t.server.handle('view/page', (params) => {
      if (paged && params['cursor'] === undefined) {
        return {
          events: [{ method: 'session/statusChanged', params: { sessionId: 's1' } }],
          nextCursor: 'v:s1:2',
        }
      }
      return {
        events: [
          {
            method: 'session/goalChanged',
            params: {
              sessionId: 's1',
              viewCursor: 'v:s1:2',
              sourceRange: {
                stream: { kind: 'session', id: 's1' },
                first: { id: 'goal-change', sequence: 2 },
                last: { id: 'goal-change', sequence: 2 },
              },
              goal: recoveredGoal,
            },
          },
        ],
        nextCursor: null,
      }
    })
    t.surface.posted.length = 0
    t.server.notify('view/gap', { sessionId: 's1', after: 'v:s1:1', next: 'v:s1:3' })
    await settle()
    expect(t.surface.posted).toContainEqual(
      expect.objectContaining({ type: 'historyLoaded', sessionId: 's1', goal: recoveredGoal }),
    )
    expect(t.server.requestsFor('view/page')).toHaveLength(paged ? 2 : 1)
  })

  it('keeps a newer live goal change when an older gap read finishes later', async () => {
    const deferred = setupWithDeferredHost()
    const { t } = deferred
    await activeGoalForGap(t)
    t.server.handle('view/page', () => ({
      events: [
        {
          method: 'session/goalChanged',
          params: {
            sessionId: 's1',
            viewCursor: 'v:s1:2',
            sourceRange: {
              stream: { kind: 'session', id: 's1' },
              first: { id: 'goal-old', sequence: 2 },
              last: { id: 'goal-old', sequence: 2 },
            },
            goal: { objective: 'Old goal', status: 'active', percentComplete: 50 },
          },
        },
      ],
      nextCursor: null,
    }))
    t.surface.posted.length = 0
    deferred.delay()
    t.server.notify('view/gap', { sessionId: 's1', after: 'v:s1:1', next: 'v:s1:3' })
    await vi.waitFor(() => {
      expect(deferred.isWaiting()).toBe(true)
    })
    t.server.notify('session/goalChanged', { sessionId: 's1', goal: null })
    await settle()
    deferred.release()
    await vi.waitFor(() => {
      expect(t.surface.posted.filter((message) => message.type === 'historyLoaded')).toHaveLength(1)
    })
    const reloads = t.surface.posted.filter((message) => message.type === 'historyLoaded')
    expect(reloads).toHaveLength(1)
    expect(reloads[0]).not.toHaveProperty('goal')
    expect(t.surface.posted).toContainEqual({
      type: 'agentEvent',
      event: { type: 'goalChanged', goal: null },
    })
  })

  it('posts a backend notice as a notice, never as an event', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    await settle()
    t.surface.posted.length = 0
    t.server.notify('session/modelRouteUnserved', { sessionId: 's1', modelId: 'muse-spark-1.3' })
    await settle()
    expect(t.surface.posted).toEqual([
      {
        type: 'notice',
        level: 'warning',
        text: `${UI_TEXT.modelRouteUnserved} (muse-spark-1.3)`,
      },
    ])
  })

  it('keeps steering the running turn when a queued one is withdrawn', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    t.server.notify('turn/started', { sessionId: 's1', turnId: 't1', viewCursor: 'v' })
    t.server.notify('turn/unqueued', { sessionId: 's1', turnId: 't2', commandId: 'c' })
    await settle()
    await t.send('l2', 'more')
    expect(t.server.requestsFor('turn/steer')[0]?.params).toMatchObject({ expectedTurnId: 't1' })
  })

  it('does not take a queued turn, or one already finished, for the running one', async () => {
    const queued = setup()
    queued.server.handle('turn/start', (params) => ({
      turnId: 'tq',
      status: 'accepted',
      disposition: 'queued',
      commandId: params['commandId'],
    }))
    await queued.send('l1', 'hi')
    await queued.send('l2', 'again')
    expect(queued.server.requestsFor('turn/steer')).toHaveLength(0)
    expect(queued.server.requestsFor('turn/start')).toHaveLength(2)
    // The turn completes in the same read as the ack that started it.
    const fast = setup()
    fast.server.followWith('turn/start', () => [
      {
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: { sessionId: 's1', turnId: 't1', terminal: 'completed' },
      },
    ])
    await fast.send('l1', 'hi')
    await settle()
    await fast.send('l2', 'next')
    expect(fast.server.requestsFor('turn/steer')).toHaveLength(0)
  })

  it('carries the running turn of a resumed session into steering and a reload', async () => {
    const t = withHistory({}, { status: 'running', activeTurnId: 'tr' })
    await t.controller.handle({ type: 'resumeSession', sessionId: 'old' })
    await settle()
    // The panel already open keeps Stop for the running turn.
    expect(t.surface.posted).toContainEqual(
      expect.objectContaining({ type: 'historyLoaded', sessionId: 'old', activeTurnId: 'tr' }),
    )
    t.surface.posted.length = 0
    t.controller.surfaceReady()
    expect(t.surface.posted[0]).toEqual({
      type: 'surfaceState',
      sessionId: 'old',
      activeTurnId: 'tr',
    })
    await t.send('l1', 'more')
    expect(t.server.requestsFor('turn/steer')[0]?.params).toMatchObject({ expectedTurnId: 'tr' })
  })

  it('does not offer rename or fork where Muse Code refuses them', async () => {
    const t = setup({
      handshake: { platformOs: 'windows', serverInfo: { name: 'muse', version: '1.3.0' } },
    })
    await t.send('l1', 'hi')
    t.surface.posted.length = 0
    await t.controller.handle({ type: 'renameSession', name: 'New name' })
    await t.controller.handle({ type: 'forkSession', lastTurnId: 't1' })
    expect(t.server.requestsFor('session/rename')).toHaveLength(0)
    expect(t.server.requestsFor('session/fork')).toHaveLength(0)
    expect(t.surface.posted).toEqual([
      { type: 'notice', level: 'info', text: UI_TEXT.sessionEditsUnsupported },
      { type: 'notice', level: 'info', text: UI_TEXT.sessionEditsUnsupported },
    ])
  })

  it('keeps a refused message’s images for the next try and lets them go once sent', async () => {
    const t = setup()
    await attachPng(t)
    t.server.handle('turn/start', () => {
      throw new Error('busy')
    })
    await t.send('l1', 'look', ['att-1'])
    expect(t.surface.posted.at(-1)).toMatchObject({ type: 'sendFailed', attachmentsKept: true })
    t.server.handle('turn/start', (params) => ({
      turnId: 't1',
      status: 'accepted',
      disposition: 'started',
      commandId: params['commandId'],
    }))
    await t.send('l2', 'look', ['att-1'])
    const input = (index: number) =>
      t.server.requestsFor('turn/start')[index]?.params?.['input'] as readonly { type: string }[]
    expect(input(1).map((part) => part.type)).toEqual(['text', 'image', 'text'])
    t.finishTurn()
    await settle()
    await t.send('l3', 'again', ['att-1'])
    expect(input(2).map((part) => part.type)).toEqual(['text', 'text'])
  })
})

describe('ConversationController: unsaved editors (D27)', () => {
  it('names the unsaved files once per set, counting past the first three', async () => {
    const t = setup()
    t.unsaved.files = ['a.ts', 'b.ts', 'c.ts', 'd.ts']
    await t.send('l1', 'hi')
    const warnings = () =>
      t.surface.posted.filter((message) => message.type === 'notice' && message.level === 'warning')
    expect(warnings()).toEqual([
      {
        type: 'notice',
        level: 'warning',
        text: `${UI_TEXT.unsavedFilesNotice} a.ts, b.ts, c.ts (+1).`,
      },
    ])
    t.unsaved.files = ['d.ts', 'c.ts', 'b.ts', 'a.ts']
    await t.send('l2', 'again')
    expect(warnings()).toHaveLength(1)
    t.unsaved.files = []
    await t.send('l3', 'saved now')
    t.unsaved.files = ['a.ts']
    await t.send('l4', 'one more')
    expect(warnings().at(-1)).toMatchObject({ text: `${UI_TEXT.unsavedFilesNotice} a.ts.` })
  })

  it('says nothing when autosave saved them first', async () => {
    const t = setup({ isAutosaveEnabled: true })
    t.saveAll.mockImplementation(() => {
      t.unsaved.files = []
      return Promise.resolve()
    })
    t.unsaved.files = ['a.ts']
    await t.send('l1', 'hi')
    expect(t.saveAll).toHaveBeenCalledOnce()
    expect(t.surface.posted.some((message) => message.type === 'notice')).toBe(false)
  })
})

describe('ConversationController: paid feature toggles (M33, PLAN.md D30)', () => {
  it('hands the palette toggle to the host, which confirms the price before turning one on', async () => {
    const t = setup()
    await t.controller.handle({ type: 'setPaidFeature', feature: 'webSearch', isOn: true })
    await t.controller.handle({ type: 'setPaidFeature', feature: 'voice', isOn: false })
    expect(t.deps.setPaidFeature).toHaveBeenNthCalledWith(1, 'webSearch', true)
    expect(t.deps.setPaidFeature).toHaveBeenNthCalledWith(2, 'voice', false)
  })
})

/** A dictation setup whose drivers record their calls under a name (M35). */
function namedSetup(name: string, calls: string[]): DictationSetup {
  return {
    isAvailable: true,
    create: () => {
      calls.push(`${name}:create`)
      return {
        start: () => {
          calls.push(`${name}:start`)
        },
        stop: () => {
          calls.push(`${name}:stop`)
        },
        dispose: () => {
          calls.push(`${name}:dispose`)
        },
      }
    },
  }
}
describe('ConversationController: the microphone’s engine (M35, PLAN.md D30)', () => {
  it('records with Muse Voice while it is the engine, and says so to the microphone', async () => {
    const calls: string[] = []
    const engine = { isPaid: true }
    const t = setup({
      dictation: namedSetup('system', calls),
      museVoice: () => (engine.isPaid ? namedSetup('muse', calls) : undefined),
    })
    t.controller.surfaceReady()
    expect(t.surface.posted).toContainEqual({
      type: 'dictationState',
      status: 'idle',
      engine: 'museVoice',
    })
    await t.controller.handle({ type: 'dictation', action: 'start' })
    await t.controller.handle({ type: 'dictation', action: 'stop' })
    // Turned off: the idle paid driver goes, and the next press is the free engine's.
    engine.isPaid = false
    t.surface.posted.length = 0
    t.controller.refreshDictation()
    expect(t.surface.posted).toEqual([{ type: 'dictationState', status: 'idle', engine: 'system' }])
    await t.controller.handle({ type: 'dictation', action: 'start' })
    expect(calls).toEqual([
      'muse:create',
      'muse:start',
      'muse:stop',
      'muse:dispose',
      'system:create',
      'system:start',
    ])
  })

  it('says why when Muse Voice is the engine but cannot record here', async () => {
    const t = setup({
      dictation: namedSetup('system', []),
      museVoice: () => ({ isAvailable: false, reason: 'no recorder' }),
    })
    await t.controller.handle({ type: 'dictation', action: 'start' })
    expect(t.surface.posted).toContainEqual({
      type: 'dictationState',
      status: 'unavailable',
      reason: 'no recorder',
      engine: 'museVoice',
    })
  })
})

describe('ConversationController: Muse Voice turned off mid-recording (the review of PR #27)', () => {
  it('stops the paid recording at once and keeps its driver until the panel closes', async () => {
    const calls: string[] = []
    const engine = { isPaid: true }
    let paidListener: DictationListener | undefined
    const paid: DictationSetup = {
      isAvailable: true,
      create: (listener) => {
        paidListener = listener
        return {
          start: () => {
            calls.push('muse:start')
          },
          stop: () => {
            calls.push('muse:stop')
          },
          dispose: () => {
            calls.push('muse:dispose')
          },
        }
      },
    }
    const t = setup({
      dictation: namedSetup('system', calls),
      museVoice: () => (engine.isPaid ? paid : undefined),
    })
    await t.controller.handle({ type: 'dictation', action: 'start' })
    paidListener?.onStatus('listening')
    engine.isPaid = false
    t.controller.refreshDictation()
    // Stopped, so no more audio is sent; not disposed, so its transcript can still land.
    expect(calls).toEqual(['muse:start', 'muse:stop'])
    paidListener?.onText('what was said')
    expect(t.surface.posted).toContainEqual({ type: 'insertText', text: 'what was said ' })
    t.controller.dispose()
    expect(calls.at(-1)).toBe('muse:dispose')
  })
})

describe('ConversationController: a tool row’s picture (M43)', () => {
  it('answers with the picture as a data URI, or with why it cannot be shown', async () => {
    const asked: string[] = []
    const t = setup({
      readToolImage: (imagePath) => {
        asked.push(imagePath)
        return Promise.resolve(
          imagePath === 'dot.png'
            ? { ok: true, dataUri: 'data:image/png;base64,AA' }
            : { ok: false, reason: 'path ../x.png is outside the workspace' },
        )
      },
    })
    await t.controller.handle({ type: 'readToolImage', itemId: 'r1', path: 'dot.png' })
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'toolImage',
      itemId: 'r1',
      path: 'dot.png',
      dataUri: 'data:image/png;base64,AA',
    })
    await t.controller.handle({ type: 'readToolImage', itemId: 'r2', path: '../x.png' })
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'toolImage',
      itemId: 'r2',
      path: '../x.png',
      error: 'path ../x.png is outside the workspace',
    })
    expect(asked).toEqual(['dot.png', '../x.png'])
  })

  it('answers a read that threw with its reason instead of leaving the row loading', async () => {
    const t = setup({ readToolImage: () => Promise.reject(new Error('EACCES')) })
    await t.controller.handle({ type: 'readToolImage', itemId: 'r', path: 'a.png' })
    expect(t.surface.posted.at(-1)).toEqual({
      type: 'toolImage',
      itemId: 'r',
      path: 'a.png',
      error: 'EACCES',
    })
  })
})

/** MSP's bare `goal/*` ack (M45). */
function accepted(params: Record<string, unknown>) {
  return { commandId: params['commandId'], status: 'accepted' }
}

/** The webview's goal command (M45). */
function goal(verb: GoalCommandVerb, objective?: string) {
  return {
    type: 'goalCommand' as const,
    requestId: 'g1',
    verb,
    ...(objective !== undefined && { objective }),
  }
}

/** The notices the panel was sent, in order. */
function notices(t: ReturnType<typeof setup>) {
  return t.surface.posted.flatMap((message) => (message.type === 'notice' ? [message] : []))
}

describe('ConversationController: the session goal (M45, PLAN.md D38)', () => {
  it('refuses bare goal verbs without creating an empty conversation', async () => {
    const t = setup()
    await t.controller.handle(goal('pause'))
    await t.controller.handle(goal('resume'))
    await t.controller.handle(goal('edit', 'New objective'))
    await t.controller.handle(goal('clear'))
    expect(t.server.requestsFor('session/start')).toHaveLength(0)
    expect(notices(t).map((notice) => notice.text)).toEqual([
      UI_TEXT.goalNone,
      UI_TEXT.goalNone,
      UI_TEXT.goalNone,
      UI_TEXT.goalNone,
    ])
    expect(t.surface.posted.filter((message) => message.type === 'goalCommandResult')).toEqual([
      { type: 'goalCommandResult', requestId: 'g1', accepted: false },
      { type: 'goalCommandResult', requestId: 'g1', accepted: false },
      { type: 'goalCommandResult', requestId: 'g1', accepted: false },
      { type: 'goalCommandResult', requestId: 'g1', accepted: false },
    ])
  })

  it('starts a conversation for a goal, sends the verb and says what was done', async () => {
    const t = setup()
    t.server.handle('goal/set', (params) => ({ ...accepted(params), turnId: 'goal-turn' }))
    t.server.handle('goal/pause', accepted)
    await t.controller.handle(goal('set', ' Ship the parser '))
    expect(t.server.requestsFor('session/start')).toHaveLength(1)
    expect(t.server.requestsFor('goal/set')[0]?.params).toMatchObject({
      sessionId: 's1',
      objective: 'Ship the parser',
    })
    await t.controller.handle(goal('pause'))
    expect(t.surface.posted.filter((message) => message.type === 'goalCommandResult')).toEqual([
      { type: 'goalCommandResult', requestId: 'g1', accepted: true },
      { type: 'goalCommandResult', requestId: 'g1', accepted: true },
    ])
    expect(notices(t)).toEqual([
      { type: 'notice', level: 'info', text: 'Goal set: Ship the parser' },
      { type: 'notice', level: 'info', text: UI_TEXT.goalPausedNotice },
    ])
    // The objective is the user's text: the log says what was done, not what was typed.
    expect(t.log.info).toHaveBeenCalledWith('Goal set accepted (turn goal-turn)')
    expect(t.log.info).not.toHaveBeenCalledWith(expect.stringContaining('Ship the parser'))
  })

  it('says a refusal in words and asks for a missing objective before sending anything', async () => {
    const t = setup()
    await t.controller.handle(goal('set', ' '.repeat(3)))
    await t.controller.handle(goal('edit'))
    expect(t.server.requestsFor('session/start')).toHaveLength(0)
    await t.send('l1', 'hi')
    t.finishTurn()
    await settle()
    t.server.handle('goal/pause', goalRefusal('missing_goal'))
    t.server.handle('goal/resume', goalRefusal('invalid_goal_state'))
    t.server.handle('goal/edit', goalRefusal('invalid_goal_state'))
    t.server.handle('goal/clear', refusalOf('overloaded', -32_050))
    await t.controller.handle(goal('pause'))
    await t.controller.handle(goal('resume'))
    await t.controller.handle(goal('edit', 'New'))
    await t.controller.handle(goal('clear'))
    expect(notices(t).map((notice) => [notice.level, notice.text])).toEqual([
      ['warning', UI_TEXT.goalObjectiveMissing],
      ['warning', UI_TEXT.goalObjectiveMissing],
      ['warning', UI_TEXT.goalNone],
      ['warning', UI_TEXT.goalCannotResume],
      ['warning', UI_TEXT.goalCannotEdit],
      ['error', expect.stringContaining(`${UI_TEXT.goalCommandFailed}: `)],
    ])
    expect(t.surface.posted.filter((message) => message.type === 'goalCommandResult')).toEqual(
      Array.from({ length: 6 }, () => ({
        type: 'goalCommandResult',
        requestId: 'g1',
        accepted: false,
      })),
    )
  })

  it('resumes the session and sends again when the host no longer holds it', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    t.finishTurn()
    await settle()
    let calls = 0
    t.server.handle('goal/clear', (params) => {
      calls += 1
      if (calls === 1) {
        throw Object.assign(new Error('not loaded'), { kind: 'sessionNotLoaded' })
      }
      return accepted(params)
    })
    t.server.handle('session/resume', () => envelope({ ...storedSession, sessionId: 's1' }))
    await t.controller.handle(goal('clear'))
    expect(t.server.requestsFor('session/resume')).toHaveLength(1)
    expect(calls).toBe(2)
    expect(notices(t).at(-1)).toMatchObject({ text: UI_TEXT.goalClearedNotice })
  })

  it.each([
    { result: 'accepted', isNotLoaded: false },
    { result: 'unloaded', isNotLoaded: true },
  ])(
    'does not route an old $result goal request into a newly resumed session',
    async ({ isNotLoaded }) => {
      const deferred = setupWithDeferredHost()
      const { t } = deferred
      await t.send('l1', 'hi')
      t.finishTurn()
      await settle()
      t.server.handle('goal/set', (params) => {
        if (isNotLoaded) {
          throw Object.assign(new Error('not loaded'), { kind: 'sessionNotLoaded' })
        }
        return accepted(params)
      })
      t.server.handle('session/resume', (params) =>
        envelope({ ...storedSession, sessionId: params['sessionId'], status: 'idle' }),
      )
      t.server.handle('view/page', () => ({ events: [], nextCursor: null }))
      deferred.delay()
      const oldGoal = t.controller.handle(goal('set', 'Old objective'))
      await vi.waitFor(() => {
        expect(deferred.isWaiting()).toBe(true)
      })
      deferred.allowOtherRequests()
      await t.controller.handle({ type: 'resumeSession', sessionId: 's2' })
      const activity = vi.spyOn(t.deps.sessions, 'setLastSession')
      t.surface.posted.length = 0
      deferred.release()
      await oldGoal
      expect(t.server.requestsFor('goal/set')[0]?.params).toMatchObject({ sessionId: 's1' })
      expect(t.server.requestsFor('session/resume')).toHaveLength(1)
      expect(t.memory.lastSession?.sessionId).toBe('s2')
      expect(t.surface.posted).not.toContainEqual(
        expect.objectContaining({ type: 'notice', text: expect.stringContaining('Old objective') }),
      )
      expect(t.surface.posted.some((message) => message.type === 'goalCommandResult')).toBe(false)
      expect(activity).not.toHaveBeenCalled()
    },
  )

  it('forwards goalChanged, and a resumed snapshot brings the goal with the history', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    t.server.notify('session/goalChanged', {
      sessionId: 's1',
      goal: { objective: 'Ship it', status: 'active', percentComplete: 10 },
    })
    await settle()
    expect(t.surface.posted).toContainEqual({
      type: 'agentEvent',
      event: {
        type: 'goalChanged',
        goal: { objective: 'Ship it', status: 'active', percentComplete: 10 },
      },
    })
    t.server.handle('session/resume', () => ({
      ...envelope({ ...storedSession, status: 'idle' }, 'snapshot'),
      history: {
        mode: 'snapshot',
        items: null,
        snapshot: {
          state: {
            items: storedItems,
            goal: { objective: 'Old goal', status: 'paused', percentComplete: 20 },
          },
        },
      },
    }))
    await t.controller.handle({ type: 'resumeSession', sessionId: 'old' })
    expect(t.surface.posted).toContainEqual(
      expect.objectContaining({
        type: 'historyLoaded',
        sessionId: 'old',
        goal: { objective: 'Old goal', status: 'paused', percentComplete: 20 },
      }),
    )
  })
})

// --- M46: background work, the user's `!` commands, explanations ---

/** The captured frames of M46, on this fake host's session and turn. */
function onFakeSession<T extends { readonly item: Record<string, unknown> }>(frame: T) {
  return {
    ...frame,
    sessionId: 's1',
    item: { ...frame.item, ...(typeof frame.item['turnId'] === 'string' && { turnId: 't1' }) },
  }
}

/** A controller whose session runs turn t1 (M46). */
async function runningTurn(options: Parameters<typeof setup>[0] = {}) {
  const t = setup(options)
  for (const method of ['task/background', 'task/stop']) {
    t.server.handle(method, taskAck)
  }
  t.server.handle('task/stopAll', (params) => ({
    commandId: params['commandId'],
    status: 'accepted',
  }))
  await t.send('l1', 'start the dev server')
  t.server.notify('turn/started', { sessionId: 's1', turnId: 't1' })
  await settle()
  return t
}

describe('ConversationController: the user’s own shell commands (M46)', () => {
  it('runs a `!` command through the session, with no approval card', async () => {
    const t = setup({ grantedCapabilities: ['userShell'] })
    t.server.handle('session/userShell', (params) => ({
      commandId: params['commandId'],
      status: 'accepted',
    }))
    await t.controller.handle({ type: 'runUserShell', command: " Write-Output 'hello-m46' " })
    expect(t.server.requestsFor('session/userShell')[0]?.params).toMatchObject({
      sessionId: 's1',
      commandText: "Write-Output 'hello-m46'",
    })
    expect(t.surface.posted.some((message) => message.type === 'userShellRefused')).toBe(false)
  })

  it('runs none in Restricted Mode and gives the command back with the reason', async () => {
    const t = setup({ grantedCapabilities: ['userShell'], isWorkspaceTrusted: false })
    await t.controller.handle({ type: 'runUserShell', command: 'ls' })
    expect(t.surface.posted).toContainEqual({
      type: 'userShellRefused',
      command: 'ls',
      reason: UI_TEXT.userShellRestricted,
    })
    expect(t.server.requestsFor('session/userShell')).toHaveLength(0)
    expect(t.server.requestsFor('session/start')).toHaveLength(0)
  })

  it('returns an unsent command when signed out or when no workspace is open', async () => {
    const signedOut = setup({ status: 'signedOut' })
    await signedOut.controller.handle({ type: 'runUserShell', command: 'ls' })
    expect(signedOut.surface.posted).toContainEqual({
      type: 'userShellRefused',
      command: 'ls',
      reason: UI_TEXT.notSignedInReason,
    })
    expect(signedOut.server.requestsFor('session/start')).toHaveLength(0)

    const noWorkspace = setup({ workspaceRoot: undefined })
    await noWorkspace.controller.handle({ type: 'runUserShell', command: 'ls' })
    expect(noWorkspace.surface.posted).toContainEqual({
      type: 'userShellRefused',
      command: 'ls',
      reason: UI_TEXT.noWorkspaceReason,
    })
    expect(noWorkspace.server.requestsFor('session/start')).toHaveLength(0)
  })

  it('gives back a command the backend refused, and ignores an empty one', async () => {
    const t = setup()
    await t.controller.handle({ type: 'runUserShell', command: ' '.repeat(3) })
    expect(t.server.requestsFor('session/start')).toHaveLength(0)
    await t.controller.handle({ type: 'runUserShell', command: 'ls' })
    expect(t.surface.posted).toContainEqual({
      type: 'userShellRefused',
      command: 'ls',
      reason: `${UI_TEXT.userShellFailed}: ${UI_TEXT.userShellNotGranted}`,
    })
  })

  it('offers the sandbox setup when a `!` command could not start without it', async () => {
    const t = setup()
    await t.send('l1', 'hi')
    t.server.notify('item/completed', onFakeSession(USER_SHELL_SANDBOX_FAILED))
    await settle()
    expect(
      t.surface.posted.filter((m) => m.type === 'notice' && m.text === UI_TEXT.sandboxNotice),
    ).toHaveLength(1)
    expect(t.onSandboxUnavailable).toHaveBeenCalledOnce()
  })
})

describe('ConversationController: background work (M46)', () => {
  it('leaves Ctrl+B to VS Code while a Model API shell awaits approval', async () => {
    const t = setup({ hasApprovalUi: true })
    const io = heldShellToolIo({}, '/ws')
    const { api, host, controller } = modelApiControllerWithIo(t, io)
    const second = new ConversationController({
      ...t.deps,
      ensureHost: () => Promise.resolve(host),
    })
    try {
      api.script(
        {
          calls: [
            {
              name: 'bash',
              arguments: '{"command":"npm run dev","description":"Start the dev server"}',
              callId: 'call_dev',
            },
          ],
        },
        { text: 'Done.' },
      )
      await controller.handle({
        type: 'sendMessage',
        localId: 'l1',
        text: 'start the dev server',
        attachmentIds: [],
      })
      await vi.waitFor(() => {
        expect(agentEvents(t).some((event) => event.type === 'approvalRequested')).toBe(true)
      })
      const approval = agentEvents(t).find((event) => event.type === 'approvalRequested')
      if (approval?.type !== 'approvalRequested') {
        throw new Error('expected shell approval')
      }
      expect(controller.hasForegroundShell).toBe(false)
      expect(io.runs).toHaveLength(0)
      const live = await host.listSessions({ workspaceRoot: '/ws', limit: 1 })
      const sessionId = live.sessions[0]?.sessionId
      if (sessionId === undefined) {
        throw new Error('expected the live Model API session')
      }
      await second.handle({ type: 'resumeSession', sessionId })
      expect(second.hasForegroundShell).toBe(false)
      const shownApprovals = agentEvents(t).filter(
        (event) => event.type === 'approvalRequested' && event.itemId === approval.itemId,
      )
      expect(shownApprovals).toHaveLength(2)
      expect(shownApprovals.every((event) => !('isReplayed' in event))).toBe(true)
      await controller.handle({
        type: 'decideApproval',
        approvalId: approval.approvalId,
        choiceId: 'allow_once',
        requirementId: approval.requirementId,
      })
      await vi.waitFor(() => {
        expect(io.runs).toHaveLength(1)
      })
      expect(controller.hasForegroundShell).toBe(true)
      expect(second.hasForegroundShell).toBe(true)
      await second.moveRunningToBackground()
      expect(io.runs[0]?.isLifted).toBe(true)
    } finally {
      second.dispose()
      controller.dispose()
      await host.close()
    }
  })

  it('restores Ctrl+B from the running foreground shell in a resumed history', async () => {
    const t = withHistory()
    t.server.handle('session/resume', () => {
      const resumed = envelope({
        ...storedSession,
        sessionId: 'old',
        status: 'running',
        activeTurnId: 't1',
      })
      return {
        ...resumed,
        history: {
          ...resumed.history,
          items: [
            ...storedItems,
            { ...SHELL_CALL_STARTED.item, turnId: 't1' },
            { ...SHELL_CALL_BACKGROUNDED.item, itemId: 'already-background', turnId: 't1' },
            { ...SHELL_CALL_STARTED.item, itemId: 'other-turn', turnId: 't0' },
          ],
        },
      }
    })
    t.server.handle('task/background', taskAck)
    await t.controller.handle({ type: 'resumeSession', sessionId: 'old' })
    expect(t.controller.hasForegroundShell).toBe(true)
    expect(t.deps.onForegroundTasksChanged).toHaveBeenCalledOnce()
    await t.controller.moveRunningToBackground()
    expect(
      t.server.requestsFor('task/background').map((request) => request.params?.['taskId']),
    ).toEqual([SHELL_CALL_STARTED.item.itemId])
  })

  it('stops the CLI tasks when the conversation surface closes', async () => {
    const t = await runningTurn()
    t.server.notify('item/started', onFakeSession(SHELL_CALL_STARTED))
    t.server.notify('item/updated', onFakeSession(SHELL_CALL_BACKGROUNDED))
    await settle()
    t.controller.dispose()
    await settle()
    expect(t.server.requestsFor('task/stopAll')[0]?.params).toMatchObject({ sessionId: 's1' })
    expect(t.host.sessionCount).toBe(0)
  })

  it('moves a row’s command to the background, stops it, and stops them all', async () => {
    const t = await runningTurn()
    const taskId = SHELL_CALL_STARTED.item.itemId
    await t.controller.handle({ type: 'moveToBackground', itemId: taskId })
    await t.controller.handle({ type: 'stopTask', itemId: taskId })
    await t.controller.handle({ type: 'stopAllTasks' })
    expect(t.server.requestsFor('task/background')[0]?.params).toMatchObject({ taskId })
    expect(t.server.requestsFor('task/stop')[0]?.params).toMatchObject({ taskId })
    expect(t.server.requestsFor('task/stopAll')).toHaveLength(1)
  })

  it('says why a task command was refused and frees the row’s button', async () => {
    const t = await runningTurn()
    const refused = refusalOf(INVALID_TARGET.kind, INVALID_TARGET.code, INVALID_TARGET.data)
    t.server.handle('task/background', refused)
    t.server.handle('task/stop', refused)
    await t.controller.handle({ type: 'moveToBackground', itemId: 'gone' })
    await t.controller.handle({ type: 'stopTask', itemId: 'gone' })
    expect(t.surface.posted).toContainEqual({
      type: 'notice',
      level: 'warning',
      text: `${UI_TEXT.moveToBackgroundFailed}: ${UI_TEXT.taskNotRunning}`,
    })
    expect(t.surface.posted).toContainEqual({
      type: 'notice',
      level: 'warning',
      text: `${UI_TEXT.stopTaskFailed}: ${UI_TEXT.taskNotRunning}`,
    })
    expect(t.surface.posted.filter((m) => m.type === 'taskRefused').map((m) => m.itemId)).toEqual([
      'gone',
      'gone',
    ])
  })

  it('frees the button when there is no session to ask', async () => {
    const t = setup()
    await t.controller.handle({ type: 'stopTask', itemId: 'x' })
    expect(t.surface.posted).toContainEqual({ type: 'taskRefused', itemId: 'x' })
  })

  it('knows the running turn’s shell calls Ctrl+B moves, until they move or the turn ends', async () => {
    const t = await runningTurn()
    const changed = vi.mocked(t.deps.onForegroundTasksChanged)
    expect(t.controller.hasForegroundShell).toBe(false)
    await t.controller.moveRunningToBackground()
    expect(t.surface.posted).toContainEqual({
      type: 'notice',
      level: 'info',
      text: UI_TEXT.nothingToMoveToBackground,
    })
    t.server.notify('item/started', onFakeSession(SHELL_CALL_STARTED))
    await settle()
    expect(t.controller.hasForegroundShell).toBe(true)
    expect(changed).toHaveBeenCalledTimes(1)
    await t.controller.moveRunningToBackground()
    expect(t.server.requestsFor('task/background')[0]?.params).toMatchObject({
      taskId: SHELL_CALL_STARTED.item.itemId,
    })
    t.server.notify('item/updated', onFakeSession(SHELL_CALL_BACKGROUNDED))
    await settle()
    expect(t.controller.hasForegroundShell).toBe(false)
    expect(changed).toHaveBeenCalledTimes(2)
    // A new one, then the turn's end: nothing is left to move.
    t.server.notify('item/started', {
      ...onFakeSession(SHELL_CALL_STARTED),
      item: { ...onFakeSession(SHELL_CALL_STARTED).item, itemId: 'second' },
    })
    await settle()
    expect(t.controller.hasForegroundShell).toBe(true)
    t.finishTurn()
    await settle()
    expect(t.controller.hasForegroundShell).toBe(false)
    expect(changed).toHaveBeenCalledTimes(4)
  })

  it('stops the background tasks from the command palette', async () => {
    const t = await runningTurn()
    await t.controller.stopBackgroundTasks()
    expect(t.server.requestsFor('task/stopAll')).toHaveLength(1)
  })
})

describe('ConversationController: explanations (M46)', () => {
  it('sends an explanation with userInput/clarify, and says when it is refused', async () => {
    const t = await runningTurn()
    t.server.handle('userInput/clarify', (params) => ({
      commandId: params['commandId'],
      status: 'accepted',
      userInputId: params['userInputId'],
    }))
    await t.controller.handle({ type: 'clarifyQuestion', userInputId: 'q1', text: '  ' })
    expect(t.server.requestsFor('userInput/clarify')).toHaveLength(0)
    await t.controller.handle({ type: 'clarifyQuestion', userInputId: 'q1', text: ' green ' })
    expect(t.server.requestsFor('userInput/clarify')[0]?.params).toMatchObject({
      userInputId: 'q1',
      clarification: { format: 'text', content: 'green' },
    })
    t.server.handle('userInput/clarify', refusalOf('internalError'))
    await t.controller.handle({ type: 'clarifyQuestion', userInputId: 'q2', text: 'blue' })
    expect(t.surface.posted).toContainEqual(
      expect.objectContaining({
        type: 'notice',
        level: 'error',
        text: expect.stringContaining(UI_TEXT.clarifyNotAccepted),
      }),
    )
    // A late one is settled, not an error.
    t.server.handle('userInput/clarify', refusalOf('userInputNotFound'))
    await t.controller.handle({ type: 'clarifyQuestion', userInputId: 'q3', text: 'red' })
    expect(t.surface.posted).toContainEqual({ type: 'promptDropped', userInputId: 'q3' })
  })
})
