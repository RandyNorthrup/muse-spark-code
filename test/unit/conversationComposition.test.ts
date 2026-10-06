import { describe, expect, it, vi } from 'vitest'
import {
  composeConversationDeps,
  type ConversationCompositionPorts,
  type ConversationFeaturePorts,
} from '../../src/host/compose/conversationDeps'
import { ConversationController } from '../../src/host/conversation/conversationController'
import { createCheckpointPort } from '../../src/host/checkpoints/checkpointHost'
import { BestOfNCoordinator } from '../../src/core/bestOfN/bestOfNCoordinator'
import type { ConversationController as Controller } from '../../src/host/conversation/conversationController'
import { PendingPrompts } from '../../src/core/sessionBoard'
import type { AuthSnapshot } from '../../src/host/auth/authService'
import type {
  HostServices,
  MhpParams,
  MhpRequestMethod,
  MhpResult,
} from '../../src/shared/hostApi/methods'
import { DEFAULT_MODEL_ID, HAS_APPROVAL_UI, UI_TEXT } from '../../src/shared/constants'

// A portable caller has no vscode module. Any runtime import fails this suite.
vi.mock('vscode', () => {
  throw new Error('portable composition imported vscode')
})

function unused(): never {
  throw new Error('unused fake port called')
}
function rig() {
  const calls: { method: MhpRequestMethod; params: unknown }[] = []
  let choice: MhpResult<'ui/confirm'> = 1
  const handlers: { [M in MhpRequestMethod]?: (params: MhpParams<M>) => Promise<MhpResult<M>> } = {
    'ui/clipboard': () => Promise.resolve(null),
    'ui/openExternal': () => Promise.resolve(null),
    'documents/saveAll': () => Promise.resolve({ saved: true }),
    'workspace/openFolder': () => Promise.resolve(null),
    'ui/confirm': () => Promise.resolve(choice),
  }
  const host: HostServices = {
    request: async (method, params) => {
      calls.push({ method, params })
      const handler = handlers[method]
      if (handler === undefined) throw new Error('unbound fake method')
      return await handler(params)
    },
    notify: unused,
  }
  const auth: { -readonly [K in keyof AuthSnapshot]: AuthSnapshot[K] } = {
    status: 'signedIn',
    backend: 'museCode',
    detail: undefined,
  }
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const features: ConversationFeaturePorts = {
    surface: {
      id: 'runtime-panel',
      post: vi.fn(),
      reveal: vi.fn(),
      markUnread: vi.fn(),
      setTitle: vi.fn(),
      reload: vi.fn(),
      takeRestoredSessionId: () => undefined,
      dispose: vi.fn(),
    },
    auth: {
      current: auth,
      backend: 'museCode',
      admissionGeneration: 0,
      toMessage: () => ({ type: 'authState', status: 'signedIn' }),
      signIn: unused,
      installMuseCode: unused,
      cancelSignIn: unused,
      signOut: unused,
      refresh: unused,
      checkAgain: unused,
      markAuthRequired: unused,
      markBackendError: unused,
    },
    ensureHost: unused,
    workspaceRoot: '/ws',
    mentions: { search: unused, contains: unused },
    files: {
      showOpenDialog: unused,
      readFile: unused,
      canonicalRelativePath: unused,
      pickMentionFile: unused,
      toRelativePath: unused,
    },
    isRemoteWindow: false,
    confirmContributor: unused,
    runHostAction: unused,
    insertCode: unused,
    onSandboxUnavailable: unused,
    platform: 'linux',
    shellSandbox: unused,
    editorContext: () => undefined,
    isAutosaveEnabled: () => true,
    unsavedFiles: () => ['dirty.ts'],
    applyCode: unused,
    editReview: { openDiff: unused, revert: unused, describe: unused, revertHunk: unused },
    review: { collect: unused, turnText: unused, newMarker: unused, createHold: unused },
    openDocument: unused,
    openFile: unused,
    ideMcpEndpoint: unused,
    newAttachmentId: () => 'attachment',
    sessions: {
      archivedIds: () => [],
      setArchivedIds: unused,
      damagedIds: () => [],
      setDamagedIds: unused,
      lastSession: () => undefined,
      setLastSession: unused,
    },
    accountFacts: unused,
    usageInsights: unused,
    isRestorable: true,
    dictation: { isAvailable: false, reason: 'fake dictation unavailable' },
    exports: {
      saveMarkdown: unused,
      saveSessionLog: unused,
      saveJson: unused,
      previewExport: unused,
      localRoots: () => ['/ws'],
    },
    transferFiles: { pickTransferFile: unused, confirmImport: unused },
    plans: undefined,
    isWorkspaceTrusted: () => true,
    isWorktreeHeld: () => false,
    createGit: () => ({
      postState: () => undefined,
      sessionChanged: () => undefined,
      handleAction: unused,
      commit: unused,
      createPullRequest: unused,
      promptFor: unused,
      generationStarting: unused,
      isGenerationCurrent: unused,
      generationSubmitted: unused,
      generationFailed: unused,
      onEvent: unused,
      dispose: () => undefined,
    }),
    onForegroundTasksChanged: unused,
    checkpoints: createCheckpointPort({
      isNamespaceKnown: () => false,
      store: undefined,
      isWorkspaceTrusted: () => true,
      isEnabled: () => false,
      hasGit: () => false,
    }),
    unsavedPaths: () => ['/ws/dirty.ts'],
    pendingPrompts: new PendingPrompts(),
    bestOfNCoordinator: new BestOfNCoordinator(),
    runGit: unused,
    realPath: (path) => Promise.resolve(path),
    notifyAttention: unused,
    now: () => 0,
    log,
  }
  const settings: {
    -readonly [K in keyof ReturnType<ConversationCompositionPorts['settings']>]: ReturnType<
      ConversationCompositionPorts['settings']
    >[K]
  } = {
    initialPermissionMode: 'manual',
    allowDangerouslySkipPermissions: false,
    confidentialWorkspace: false,
    dictationEngine: 'system',
    modelApiSessionBudgetUsd: 0,
    diagnosticsAfterEdits: true,
    checkCommands: [],
  }
  let isVoiceOn = false
  let isKeyStored = true
  let isTrusted = true
  let controllers: Pick<Controller, 'boardSession' | 'revealBoardSession'>[] = []
  const consent = vi.fn(() => Promise.resolve(false))
  const turnOn = vi.fn(() => Promise.resolve(true))
  const turnOff = vi.fn(() => Promise.resolve())
  const beginEdit = vi.fn<ConversationCompositionPorts['modelApi']['beginExternalEdit']>(unused)
  const captureOwner = vi.fn<ConversationCompositionPorts['modelApi']['captureExternalEditOwner']>(
    () => undefined,
  )
  const ports: ConversationCompositionPorts = {
    features,
    settings: () => settings,
    paid: {
      gate: { isOn: (feature) => feature === 'voice' && isVoiceOn, turnOn, turnOff },
      consent: { allows: consent, forget: () => Promise.resolve() },
      usage: { add: vi.fn(), addBestOfNRequest: vi.fn(), addBestOfNUsage: vi.fn() },
    },
    modelApi: {
      accountId: () => Promise.resolve('fake-account-digest'),
      ensureHost: unused,
      captureExternalEditOwner: captureOwner,
      beginExternalEdit: beginEdit,
      bestOfNBudgetScope: unused,
      buildAttemptHost: unused,
    },
    isKeyStored: () => isKeyStored,
    museVoiceSetup: { isAvailable: false, reason: 'fake voice' },
    controllers: () => controllers,
    isProjectTrusted: () => isTrusted,
    toolImageIo: {
      realPath: (path) => Promise.resolve(path),
      fileSize: vi.fn(() => Promise.resolve(1)),
      readBytes: () => Promise.resolve(Uint8Array.of(0)),
    },
  }
  return {
    host,
    ports,
    features,
    settings,
    auth,
    calls,
    consent,
    turnOn,
    turnOff,
    beginEdit,
    captureOwner,
    register: (next: typeof controllers) => {
      controllers = next
    },
    choose: (value: typeof choice) => {
      choice = value
    },
    voice: (isOn: boolean, hasKey = true) => {
      isVoiceOn = isOn
      isKeyStored = hasKey
    },
    trust: (isTrustedNow: boolean) => {
      isTrusted = isTrustedNow
    },
  }
}

describe('portable conversation composition', () => {
  it('composes a real controller with fake HostServices and no vscode module', () => {
    const r = rig(),
      deps = composeConversationDeps(r.host, r.ports)
    expect(deps.modelId).toBe(DEFAULT_MODEL_ID)
    expect(deps.hasApprovalUi).toBe(HAS_APPROVAL_UI)
    expect(deps.initialPermissionMode).toBe('manual')
    for (const key of Object.keys(r.features))
      expect(Reflect.get(deps, key)).toBe(Reflect.get(r.features, key))
    expect(new ConversationController(deps)).toBeInstanceOf(ConversationController)
  })
  it('uses host services for clipboard, save, external links, folder opens and explicit confirms', async () => {
    const r = rig(),
      deps = composeConversationDeps(r.host, r.ports)
    await deps.copyText('hello')
    await deps.saveAll()
    deps.openExternal('https://example.test/page')
    await deps.openBestOfNWorktree('/ws/attempt')
    expect(await deps.confirmRemoteBypass()).toBe(true)
    r.choose(null)
    expect(await deps.confirmFileAction('Restore', 'Files change', 'Restore')).toBe(false)
    r.choose('1')
    expect(await deps.confirmRemoteBypass()).toBe(false)
    expect(r.calls.slice(0, 4)).toEqual([
      { method: 'ui/clipboard', params: { text: 'hello' } },
      { method: 'documents/saveAll', params: {} },
      { method: 'ui/openExternal', params: { uri: 'https://example.test/page' } },
      { method: 'workspace/openFolder', params: { uri: 'file:///ws/attempt', newWindow: true } },
    ])
    expect(r.calls[4]).toEqual({
      method: 'ui/confirm',
      params: {
        title: UI_TEXT.bypassRemoteTitle,
        message: UI_TEXT.bypassRemoteDetail,
        choices: [{ id: 1, title: UI_TEXT.bypassRemoteConfirm }],
      },
    })
  })
  it('reads live settings and retains paid gates, key checks and per-use consent', async () => {
    const r = rig(),
      deps = composeConversationDeps(r.host, r.ports)
    r.settings.allowDangerouslySkipPermissions = true
    r.settings.confidentialWorkspace = true
    r.settings.modelApiSessionBudgetUsd = 2
    expect(deps.isBypassAllowed()).toBe(true)
    expect(deps.isConfidentialWorkspace()).toBe(true)
    expect(deps.modelApiSessionBudgetUsd()).toBe(2)
    expect(deps.museVoice()).toBeUndefined()
    r.voice(true, false)
    expect(deps.museVoice()).toBeUndefined()
    r.voice(true)
    expect(deps.museVoice()).toBe(r.ports.museVoiceSetup)
    r.auth.backend = 'modelApi'
    expect(deps.museVoice()).toBeUndefined()
    r.settings.dictationEngine = 'museVoice'
    expect(deps.museVoice()).toEqual({
      isAvailable: false,
      reason: UI_TEXT.sessionBudgetVoiceUnavailable,
    })
    expect(await deps.allowsPaidUse({ feature: 'voice' })).toBe(false)
    expect(r.consent).toHaveBeenCalledExactlyOnceWith({ feature: 'voice' })
    await deps.setPaidFeature('voice', true)
    expect(r.turnOn).toHaveBeenCalledExactlyOnceWith('voice')
    await deps.setPaidFeature('voice', false)
    expect(r.turnOff).toHaveBeenCalledExactlyOnceWith('voice')
    expect(
      await deps.confirmScheduledRun?.(
        {
          id: 'job',
          prompt: 'Do work',
          sessionId: 'session',
          workspaceRoot: '/ws',
          accountId: 'fake-account',
          cadence: { kind: 'interval', everyMs: 1000 },
          createdAtMs: 0,
          expiresAtMs: 1000,
          nextFireAtMs: 0,
          fireCount: 0,
        },
        DEFAULT_MODEL_ID,
      ),
    ).toBe(false)
  })
  it('shares the caller registry, guards external edits and refuses an escaped image before reading', async () => {
    const r = rig(),
      deps = composeConversationDeps(r.host, r.ports)
    expect(deps.boardSessions?.()).toEqual([])
    expect(deps.focusBoardSession?.('session', 'museCode')).toBe(false)
    const row = { sessionId: 'other', backend: 'museCode' as const, status: 'idle' as const }
    const reveal = vi.fn((sessionId: string) => sessionId === row.sessionId)
    r.register([{ boardSession: () => row, revealBoardSession: reveal }])
    expect(deps.boardSessions?.()).toEqual([row])
    expect(deps.focusBoardSession?.('other', 'museCode')).toBe(true)
    expect(reveal).toHaveBeenCalledExactlyOnceWith('other', 'museCode')
    const edits = deps.bestOfNWorkspaceEdits?.(undefined)
    expect(r.captureOwner).not.toHaveBeenCalled()
    await expect(edits?.('/ws', ['.agents/unsafe.txt'])).rejects.toThrow(
      UI_TEXT.bestOfNTargetChanged,
    )
    expect(r.beginEdit).not.toHaveBeenCalled()
    expect(await deps.readToolImage('../outside.png')).toMatchObject({ ok: false })
    expect(r.ports.toolImageIo.fileSize).not.toHaveBeenCalled()
    r.trust(false)
    expect(deps.verifyGuidance?.(true)).toBeDefined()
    await expect(deps.ownedVoiceBudgetScope('session')).rejects.toThrow(
      UI_TEXT.sessionBudgetStoreUnavailable,
    )
  })
})
