// History's Delete, proven against the real session store on the real file
// system: a saved conversation lists, `remove` takes its file for good, and
// the list no longer names it; removing an id that is already gone resolves.
// The Muse Code side stays refused wherever the CLI cannot answer
// `session/delete` (PLAN.md D26): the version gate pins that refusal to the
// measured probes (1.4.4's `methodNotFound`, 1.4.10's probe and schema
// export of 2026-10-18).

import { createHash } from 'node:crypto'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BestOfNCoordinator } from '../../src/core/bestOfN/bestOfNCoordinator'
import { PendingPrompts } from '../../src/core/sessionBoard'
import type { AuthPort } from '../../src/host/auth/authService'
import { createCheckpointPort } from '../../src/host/checkpoints/checkpointHost'
import {
  ConversationController,
  type ConversationDeps,
  type ConversationGitPort,
  type FileAccess,
  type MentionSearch,
  type SessionMemory,
} from '../../src/host/conversation/conversationController'
import type { ConversationExports } from '../../src/host/conversation/exportConversation'
import type { SessionTransferFiles } from '../../src/host/conversation/sessionImport'
import type { EditReviewActions } from '../../src/host/editor/editReview'
import type { ReviewTurnFeatures } from '../../src/host/review/reviewBundle'
import type { ChatSurface } from '../../src/host/views/chatSurface'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { ModelApiHost, type ModelApiHostDeps } from '../../src/core/backends/modelapi/ModelApiHost'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import type { StoredSession } from '../../src/core/backends/modelapi/sessionStore'
import { canDeleteMuseSession } from '../../src/core/backends/musecode/MuseCodeHost'
import { fileContextIo } from '../../src/host/backend/contextIo'
import { createFileSessionStore } from '../../src/host/backend/fileSessionStore'
import { createToolIo } from '../../src/host/backend/toolIo'
import { DEFAULT_MODEL_ID, MODEL_API_BASE_URL, SETTING_DEFAULTS } from '../../src/shared/constants'
import { fill, UI_TEXT } from '../../src/shared/l10n/text'
import { sessionTitle } from '../../src/shared/sessions'
import { Usd } from '../../src/shared/usd'
import { removeFolder } from './helpers/temporaryFolders'

// A conversation as the product saves it, kept minimal: the store validates
// the shape, so only a shape the product itself accepts reaches the file.
const session: StoredSession = {
  version: 1,
  sessionId: 's1',
  workspaceRoot: '/ws',
  modelId: 'muse-spark-1.3',
  approvalMode: 'promptUnmatched',
  effort: 'high',
  name: 'Parser fix',
  createdAt: '2026-09-22T10:00:00.000Z',
  lastActivityAt: '2026-09-22T10:05:00.000Z',
  turnIds: [],
  firstPrompt: 'fix the parser',
  todos: [],
  replay: [],
  transcript: [],
  outputs: {},
  usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
}

describe('History delete against the real session store', () => {
  let directory = ''
  const store = () =>
    createFileSessionStore({
      directory,
      log: {
        trace: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
      retentionDays: () => 0,
      now: () => Date.now(),
      sleep: () => Promise.resolve(),
    })

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'muse-session-delete-'))
  })
  afterAll(async () => {
    await removeFolder(directory)
  })

  it('lists a saved conversation, then loses its file and its row on remove', async () => {
    const sessions = store()
    await sessions.save(session)
    const before = await sessions.list()
    expect(before.map((header) => header.sessionId)).toContain('s1')
    expect(await sessions.load('s1')).toBeDefined()

    await sessions.remove('s1')

    const after = await sessions.list()
    expect(after.map((header) => header.sessionId)).not.toContain('s1')
    expect(await sessions.load('s1')).toBeUndefined()
    expect(await readdir(directory)).not.toContain('s1.json')
  })

  it('resolves removing an id that is already gone', async () => {
    await expect(store().remove('never-saved')).resolves.toBeUndefined()
  })
})

// The product's own host against the real file store, shared by the host
// and panel delete tests below. The provider client is the product's own,
// constructed but never called: no turn runs, so any network use would fail
// loudly through its missing key.
// The spend ledger only serves key-digest accounts (`ACCOUNT_ID` in the
// journal is 64 hex chars), so the test account is the real SHA-256 digest
// of its name — a well-formed nobody, never a credential.
const TEST_ACCOUNT_ID = createHash('sha256').update('session-delete-test-account').digest('hex')

function makeHost(directory: string): {
  readonly host: ModelApiHost
  readonly store: ReturnType<typeof createFileSessionStore>
  readonly warnings: string[]
} {
  let ids = 0
  const warnings: string[] = []
  const log = {
    trace: () => undefined,
    info: () => undefined,
    warn: (message: string) => {
      warnings.push(message)
    },
    error: () => undefined,
  }
  const store = createFileSessionStore({
    directory,
    log,
    retentionDays: () => 0,
    now: () => Date.now(),
    sleep: () => Promise.resolve(),
  })
  const client = new ModelApiClient({
    fetch: globalThis.fetch,
    baseUrl: MODEL_API_BASE_URL,
    apiKey: () => Promise.resolve(undefined),
    sleep: () => Promise.resolve(),
    now: () => Date.now(),
    random: () => 0.5,
    log,
  })
  const deps: ModelApiHostDeps = {
    client,
    workspaceRoot: directory,
    platform: process.platform,
    io: createToolIo({
      platform: process.platform,
      listFiles: () => Promise.resolve([]),
      systemRoot: undefined,
      env: () => ({}),
      searchWorkerPath: path.join(directory, 'searchWorker.js'),
      log: () => undefined,
      unsavedFiles: () => [],
    }),
    contextIo: fileContextIo,
    newId: () => `test-session-${String((ids += 1))}`,
    now: () => Date.now(),
    log,
    personalSkillsRoot: undefined,
    personalAgentsRoot: undefined,
    isWorkspaceTrusted: () => true,
    isConfidentialWorkspace: () => false,
    confirmContributorModel: () => Promise.resolve(false),
    describeEnvironment: () => Promise.reject(new Error('sessionDelete test runs no turn')),
    isPaidFeatureOn: () => false,
    notePaidUse: () => undefined,
    allowsPaidUse: () => Promise.resolve(false),
    isPaidUseRemembered: () => false,
    noteSubagentUsage: () => undefined,
    noteReviewerUsage: () => undefined,
    promptCacheRetention: () => SETTING_DEFAULTS.modelApiPromptCacheRetention,
    sessionBudgetUsd: () => Usd.from(0).toAmount(),
    showReplyUsage: () => false,
    memory: undefined,
    getAccountId: () => Promise.resolve(TEST_ACCOUNT_ID),
    store,
  }
  return { host: new ModelApiHost(deps), store, warnings }
}

// The rename's save really landed: without this the file-gone assertions
// below would pass vacuously on a session that never wrote.
async function awaitSaved(
  host: ModelApiHost,
  store: ReturnType<typeof createFileSessionStore>,
  warnings: readonly string[],
  sessionId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await host.flush()
    if ((await store.load(sessionId)) !== undefined) {
      return
    }
  }
  throw new Error(`session ${sessionId} was never saved; warnings: ${JSON.stringify(warnings)}`)
}

describe('ModelApiHost.deleteSession keeps a deleted conversation deleted', () => {
  let directory = ''

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'muse-host-session-delete-'))
  })
  afterAll(async () => {
    await removeFolder(directory)
  })

  it('drains the in-flight save, removes the file, and stops the live handle', async () => {
    const { host, store, warnings } = makeHost(directory)
    const live = await host.startSession({
      workspaceRoot: directory,
      modelId: DEFAULT_MODEL_ID,
      approvalMode: 'promptUnmatched',
    })
    const sessionId = live.sessionId
    // Queue a real save and delete before it must have finished: the removal
    // has to win over the write, not race it.
    await live.rename('Parser fix')
    await awaitSaved(host, store, warnings, sessionId)
    expect(warnings).toEqual([])
    // Queue another real save and delete before it must have finished: the
    // removal has to win over the write, not race it.
    await live.rename('Parser fix again')
    await host.deleteSession(sessionId)
    await host.flush()

    expect(await store.load(sessionId)).toBeUndefined()
    const listed = await host.listSessions({ workspaceRoot: directory, limit: 50 })
    expect(listed.sessions.map((record) => record.sessionId)).not.toContain(sessionId)

    // The live handle is stopped with the conversation: neither resume nor
    // fork may bring a session back for the deleted id.
    await expect(host.resumeSession(sessionId, DEFAULT_MODEL_ID)).rejects.toThrow()
    await expect(host.forkSession(sessionId, DEFAULT_MODEL_ID)).rejects.toThrow()

    // Touching the stopped handle afterwards writes nothing back.
    await live.rename('A rename after the delete')
    await host.flush()
    expect(await store.load(sessionId)).toBeUndefined()

    // Deleting again resolves: the removal stays idempotent.
    await expect(host.deleteSession(sessionId)).resolves.toBeUndefined()
    await host.flush()
    expect(await store.load(sessionId)).toBeUndefined()
    expect(await readdir(directory)).not.toContain(`${sessionId}.json`)
  })
})

// The panel's delete path, driven through the same `handle` entry the
// webview uses, against the real controller, the real host and the real
// file store. What the editor does around it is the test operator's part:
// answering the confirm dialog the way the person would, and capturing the
// posted messages. Everything the delete itself touches — the host removal,
// the file, the saves, the archived ids, the checkpoints, the re-list — is
// production code. Collaborators the path never reaches fail closed: if it
// ever does reach one, the test fails loudly instead of silently faking it.
function unused(name: string): (...args: unknown[]) => never {
  return (..._args: unknown[]) => {
    throw new Error(`sessionDelete panel test never uses ${name}`)
  }
}

interface PanelRig {
  readonly controller: ConversationController
  readonly host: ModelApiHost
  readonly store: ReturnType<typeof createFileSessionStore>
  readonly warnings: string[]
  readonly posted: HostToWebviewMessage[]
  readonly releaseConfirm: () => ((isConfirmed: boolean) => void) | undefined
  readonly armArchivedIdsFailure: (error: Error) => void
}

function makePanel(directory: string, confirm: 'yes' | 'no' | 'deferred'): PanelRig {
  const { host, store, warnings } = makeHost(directory)
  const posted: HostToWebviewMessage[] = []
  const surface: ChatSurface = {
    id: 'session-delete-test-surface',
    documentId: 'session-delete-test-doc',
    post: (message) => {
      posted.push(message)
    },
    reveal: () => undefined,
    markUnread: () => undefined,
    setTitle: () => undefined,
    reload: () => undefined,
    takeRestoredSessionId: () => undefined,
    dispose: () => undefined,
  }
  let releaseConfirm: ((isConfirmed: boolean) => void) | undefined
  let archivedIds: readonly string[] = []
  let archivedIdsFailure: Error | undefined
  const sessions: SessionMemory = {
    archivedIds: () => [...archivedIds],
    setArchivedIds: (ids) => {
      if (archivedIdsFailure !== undefined) {
        return Promise.reject(archivedIdsFailure)
      }
      archivedIds = [...ids]
      return Promise.resolve()
    },
    damagedIds: () => [],
    setDamagedIds: () => Promise.resolve(),
    lastSession: () => undefined,
    setLastSession: () => Promise.resolve(),
  }
  const auth: AuthPort = {
    current: { status: 'signedIn', detail: undefined, backend: 'modelApi' },
    backend: 'modelApi',
    admissionGeneration: 0,
    toMessage: unused('auth.toMessage'),
    signIn: unused('auth.signIn'),
    installMuseCode: unused('auth.installMuseCode'),
    cancelSignIn: unused('auth.cancelSignIn'),
    signOut: unused('auth.signOut'),
    refresh: unused('auth.refresh'),
    checkAgain: unused('auth.checkAgain'),
    markAuthRequired: unused('auth.markAuthRequired'),
    markBackendError: unused('auth.markBackendError'),
  }
  // No test path below attaches a session, so git is never reached: every
  // entry fails closed instead of pretending git ran.
  const git: ConversationGitPort = {
    postState: unused('git.postState'),
    sessionChanged: unused('git.sessionChanged'),
    handleAction: unused('git.handleAction'),
    commit: unused('git.commit'),
    createPullRequest: unused('git.createPullRequest'),
    promptFor: unused('git.promptFor'),
    generationStarting: unused('git.generationStarting'),
    isGenerationCurrent: unused('git.isGenerationCurrent'),
    generationSubmitted: unused('git.generationSubmitted'),
    generationFailed: unused('git.generationFailed'),
    onEvent: unused('git.onEvent'),
    dispose: unused('git.dispose'),
  }
  const mentions: MentionSearch = {
    search: unused('mentions.search'),
    contains: unused('mentions.contains'),
  }
  const files: FileAccess = {
    showOpenDialog: unused('files.showOpenDialog'),
    readFile: unused('files.readFile'),
    canonicalRelativePath: unused('files.canonicalRelativePath'),
    pickMentionFile: unused('files.pickMentionFile'),
    toRelativePath: unused('files.toRelativePath'),
  }
  const editReview: EditReviewActions = {
    openDiff: unused('editReview.openDiff'),
    revert: unused('editReview.revert'),
    describe: unused('editReview.describe'),
    revertHunk: unused('editReview.revertHunk'),
  }
  const review: ReviewTurnFeatures = {
    collect: unused('review.collect'),
    turnText: unused('review.turnText'),
    newMarker: unused('review.newMarker'),
    createHold: unused('review.createHold'),
  }
  const exports: ConversationExports = {
    saveMarkdown: unused('exports.saveMarkdown'),
    saveSessionLog: unused('exports.saveSessionLog'),
    saveJson: unused('exports.saveJson'),
    previewExport: unused('exports.previewExport'),
    localRoots: unused('exports.localRoots'),
  }
  const transferFiles: SessionTransferFiles = {
    pickTransferFile: unused('transferFiles.pickTransferFile'),
    confirmImport: unused('transferFiles.confirmImport'),
  }
  let attachmentIds = 0
  const deps: ConversationDeps = {
    surface,
    auth,
    ensureHost: () => Promise.resolve(host),
    workspaceRoot: directory,
    modelId: DEFAULT_MODEL_ID,
    initialPermissionMode: 'manual',
    hasApprovalUi: false,
    openExternal: unused('openExternal'),
    mentions,
    files,
    isBypassAllowed: () => false,
    isRemoteWindow: false,
    confirmRemoteBypass: unused('confirmRemoteBypass'),
    isConfidentialWorkspace: () => false,
    confirmContributor: unused('confirmContributor'),
    runHostAction: unused('runHostAction'),
    copyText: unused('copyText'),
    insertCode: unused('insertCode'),
    onSandboxUnavailable: () => undefined,
    platform: process.platform,
    shellSandbox: unused('shellSandbox'),
    editorContext: () => undefined,
    isAutosaveEnabled: () => true,
    saveAll: unused('saveAll'),
    unsavedFiles: () => [],
    applyCode: unused('applyCode'),
    editReview,
    review,
    openDocument: unused('openDocument'),
    openFile: unused('openFile'),
    readToolImage: unused('readToolImage'),
    ideMcpEndpoint: unused('ideMcpEndpoint'),
    newAttachmentId: () => `test-attachment-${String((attachmentIds += 1))}`,
    sessions,
    accountFacts: unused('accountFacts'),
    usageInsights: unused('usageInsights'),
    isRestorable: false,
    dictation: { isAvailable: false, reason: 'sessionDelete panel test records nothing' },
    museVoice: () => undefined,
    modelApiSessionBudgetUsd: () => Usd.from(0).toAmount(),
    voiceAccountId: unused('voiceAccountId'),
    ownedVoiceBudgetScope: unused('ownedVoiceBudgetScope'),
    exports,
    transferFiles,
    plans: undefined,
    setPaidFeature: unused('setPaidFeature'),
    isWorkspaceTrusted: () => true,
    isWorktreeHeld: () => false,
    createGit: () => git,
    onForegroundTasksChanged: () => undefined,
    allowsPaidUse: unused('allowsPaidUse'),
    checkpoints: createCheckpointPort({
      store: undefined,
      isNamespaceKnown: () => false,
      isWorkspaceTrusted: () => true,
      isEnabled: () => true,
      hasGit: () => false,
    }),
    unsavedPaths: () => [],
    confirmFileAction: () =>
      new Promise<boolean>((resolve) => {
        if (confirm === 'yes') {
          resolve(true)
          return
        }
        if (confirm === 'no') {
          resolve(false)
          return
        }
        releaseConfirm = resolve
      }),
    forgetPaidUse: unused('forgetPaidUse'),
    pendingPrompts: new PendingPrompts(),
    bestOfNCoordinator: new BestOfNCoordinator(),
    modelApiAccountId: unused('modelApiAccountId'),
    openBestOfNWorktree: unused('openBestOfNWorktree'),
    noteBestOfNRequest: unused('noteBestOfNRequest'),
    noteBestOfNUsage: unused('noteBestOfNUsage'),
    runGit: unused('runGit'),
    isPaidFeatureOn: () => false,
    notePaidUse: () => undefined,
    buildAttemptHost: unused('buildAttemptHost'),
    realPath: unused('realPath'),
    notifyAttention: () => undefined,
    now: () => Date.now(),
    log: {
      trace: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  }
  return {
    controller: new ConversationController(deps),
    host,
    store,
    warnings,
    posted,
    releaseConfirm: () => releaseConfirm,
    armArchivedIdsFailure: (error: Error) => {
      archivedIdsFailure = error
    },
  }
}

function panelNotices(
  posted: readonly HostToWebviewMessage[],
): { readonly level: string; readonly text: string }[] {
  return posted
    .filter((message) => message.type === 'notice')
    .map((message) => ({
      level: message.level,
      text: message.text,
    }))
}

function panelSessionLists(posted: readonly HostToWebviewMessage[]): string[][] {
  return posted
    .filter((message) => message.type === 'sessionList')
    .map((message) => message.sessions.map((row) => row.sessionId))
}

async function waitForConfirm(
  releaseConfirm: () => ((isConfirmed: boolean) => void) | undefined,
): Promise<void> {
  for (let attempt = 0; attempt < 200 && releaseConfirm() === undefined; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  if (releaseConfirm() === undefined) {
    throw new Error('the delete confirm dialog never opened')
  }
}

// A live conversation with a save on disk: every panel test starts from
// this real state, then drives its own delete through the controller.
async function startNamedSession(panel: PanelRig, directory: string): Promise<string> {
  const live = await panel.host.startSession({
    workspaceRoot: directory,
    modelId: DEFAULT_MODEL_ID,
    approvalMode: 'promptUnmatched',
  })
  const sessionId = live.sessionId
  await live.rename('Parser fix')
  await awaitSaved(panel.host, panel.store, panel.warnings, sessionId)
  return sessionId
}

describe('ConversationController.deleteSession tells one true story', () => {
  it('says Deleted once and the re-listed History loses the row', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-panel-session-delete-'))
    try {
      const panel = makePanel(directory, 'yes')
      const sessionId = await startNamedSession(panel, directory)
      expect(panel.warnings).toEqual([])
      const listed = await panel.host.listSessions({ workspaceRoot: directory, limit: 50 })
      const record = listed.sessions.find((entry) => entry.sessionId === sessionId)
      if (record === undefined) {
        throw new Error(`session ${sessionId} was never listed`)
      }
      await panel.controller.handle({ type: 'listSessions' })
      const before = panelSessionLists(panel.posted)
      expect(before.length).toBeGreaterThan(0)
      expect(before[0]).toContain(sessionId)

      await panel.controller.handle({ type: 'deleteSession', sessionId })
      await panel.host.flush()

      expect(await panel.store.load(sessionId)).toBeUndefined()
      const deletedText = fill(UI_TEXT.historyDeleted, { name: sessionTitle(record) })
      expect(panelNotices(panel.posted)).toEqual([{ level: 'info', text: deletedText }])
      const after = panelSessionLists(panel.posted)
      expect(after.at(-1)).not.toContain(sessionId)
    } finally {
      await removeFolder(directory)
    }
  })

  it('keeps the row and says nothing when the person declines', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-panel-session-decline-'))
    try {
      const panel = makePanel(directory, 'no')
      const sessionId = await startNamedSession(panel, directory)

      await panel.controller.handle({ type: 'deleteSession', sessionId })
      await panel.host.flush()

      expect(await panel.store.load(sessionId)).toBeDefined()
      expect(panelNotices(panel.posted)).toEqual([])
    } finally {
      await removeFolder(directory)
    }
  })

  it('still says Deleted with the real cause when the archived-ids cleanup fails', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-panel-session-cleanup-'))
    try {
      const panel = makePanel(directory, 'yes')
      panel.armArchivedIdsFailure(new Error('archived ids storage is down'))
      const sessionId = await startNamedSession(panel, directory)

      await panel.controller.handle({ type: 'deleteSession', sessionId })
      await panel.host.flush()

      // The conversation is gone even though its cleanup failed.
      expect(await panel.store.load(sessionId)).toBeUndefined()
      const notices = panelNotices(panel.posted)
      expect(notices).toHaveLength(2)
      expect(notices[0]?.level).toBe('info')
      const deletedText = notices[0]?.text ?? ''
      expect(notices[1]).toEqual({
        level: 'error',
        text: expect.stringContaining('archived ids storage is down'),
      })
      expect(notices[1]?.text.startsWith(deletedText)).toBe(true)
      expect(notices[1]?.text).not.toContain('Could not delete')
    } finally {
      await removeFolder(directory)
    }
  })

  it('drops the row and still says Deleted when the epoch moves mid-delete', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-panel-session-epoch-'))
    try {
      const panel = makePanel(directory, 'deferred')
      const sessionId = await startNamedSession(panel, directory)

      // The delete is parked at its confirm dialog. Once the person confirms,
      // the hosts stop (a real epoch invalidator) while the removal is still
      // in flight, so it lands on a stale generation.
      const deleting = panel.controller.handle({ type: 'deleteSession', sessionId })
      await waitForConfirm(panel.releaseConfirm)
      panel.releaseConfirm()?.(true)
      // Let the confirmed delete pass its generation check, then stop the
      // hosts before the removal settles: the file writes below still take
      // real I/O, so this always lands first.
      await Promise.resolve()
      await panel.controller.backendStopping(false)
      await deleting
      await panel.host.flush()

      expect(await panel.store.load(sessionId)).toBeUndefined()
      const deletedText = fill(UI_TEXT.historyDeleted, { name: sessionId })
      expect(panelNotices(panel.posted)).toEqual([{ level: 'info', text: deletedText }])
    } finally {
      await removeFolder(directory)
    }
  })
})

describe('canDeleteMuseSession', () => {
  it('opens Delete only where the CLI serves session/delete and the reader is injected', () => {
    const rows: [version: string, hasReader: boolean, expected: boolean][] = [
      ['1.4.0', true, true],
      ['1.4.3', true, true],
      ['1.4.3-R5018.1', true, true],
      ['1.4.4', true, false],
      ['1.4.4-R5419.1', true, false],
      ['1.4.10', true, false],
      ['1.4.10-R6427.1', true, false],
      ['1.3.0', true, false],
      ['not-a-version', true, false],
      ['', true, false],
      ['1.4.3', false, false],
      ['1.4.10', false, false],
    ]
    for (const [version, hasReader, expected] of rows) {
      expect(canDeleteMuseSession(version, hasReader)).toBe(expected)
    }
  })
})
