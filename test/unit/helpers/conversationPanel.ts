// The real conversation panel over the product's own Model API host and the
// real file session store, shared by the suites that drive the panel
// (`sessionDelete.test.ts`, `resumeFailureSend.test.ts`). What the editor
// does around the controller is the test operator's part: capturing the
// posted messages and answering a dialog the way the person would. Every
// collaborator a suite's path never reaches fails closed: if it ever does
// reach one, the test fails loudly instead of silently faking it.

import { createHash } from 'node:crypto'
import path from 'node:path'
import { expect } from 'vitest'
import { BestOfNCoordinator } from '../../../src/core/bestOfN/bestOfNCoordinator'
import { PendingPrompts } from '../../../src/core/sessionBoard'
import type { AuthPort, AuthSnapshot } from '../../../src/host/auth/authService'
import { createCheckpointPort } from '../../../src/host/checkpoints/checkpointHost'
import {
  ConversationController,
  type ConversationDeps,
  type ConversationGitPort,
  type FileAccess,
  type MentionSearch,
  type SessionMemory,
} from '../../../src/host/conversation/conversationController'
import type { BookmarkPort, SequencePort } from '../../../src/host/conversation/featurePorts'
import type { EstimatorRun } from '../../../src/host/estimator/estimatorBundle'
import type { ConversationExports } from '../../../src/host/conversation/exportConversation'
import type { SessionTransferFiles } from '../../../src/host/conversation/sessionImport'
import type { EditReviewActions } from '../../../src/host/editor/editReview'
import type { ReviewTurnFeatures } from '../../../src/host/review/reviewBundle'
import type { ChatSurface } from '../../../src/host/views/chatSurface'
import { parseHostToWebviewMessage, type HostToWebviewMessage } from '../../../src/shared/protocol'
import {
  ModelApiHost,
  type ModelApiHostDeps,
} from '../../../src/core/backends/modelapi/ModelApiHost'
import type { ModelResolver } from '../../../src/core/backends/modelapi/modelPolicy'
import { ModelApiClient } from '../../../src/core/backends/modelapi/client'
import type { ExtensionHookDefinition } from '../../../src/core/backends/modelapi/extensionHooks'
import { resolveShellSandbox } from '../../../src/core/backends/musecode/sandbox'
import { fileContextIo } from '../../../src/host/backend/contextIo'
import { createFileSessionStore } from '../../../src/host/backend/fileSessionStore'
import { createToolIo } from '../../../src/host/backend/toolIo'
import {
  DEFAULT_MODEL_ID,
  MODEL_API_BASE_URL,
  SETTING_DEFAULTS,
} from '../../../src/shared/constants'
import { Usd } from '../../../src/shared/usd'
import { initialUiState, uiReducer, type UiState } from '../../../src/webview/state/uiState'

// The spend ledger only serves key-digest accounts (`ACCOUNT_ID` in the
// journal is 64 hex chars), so the test account is the real SHA-256 digest
// of its name — a well-formed nobody, never a credential.
export const TEST_ACCOUNT_ID = createHash('sha256')
  .update('session-delete-test-account')
  .digest('hex')

export interface ModelApiRig {
  readonly host: ModelApiHost
  readonly store: ReturnType<typeof createFileSessionStore>
  readonly warnings: string[]
  /** What the host logged at error: a turn that died before reporting. */
  readonly errors: string[]
}

/**
The few variables a hook's shell needs from a real host, and nothing else
(no credential reaches the rig's hooks). On Windows PowerShell starts
cmd.exe by PATHEXT: without it PowerShell hands the file to the shell's
file association instead, which starts it detached and without the hook's
standard input.
*/
function hookShellEnvironment(): NodeJS.ProcessEnv {
  if (process.platform !== 'win32') return { SHELL: '/bin/sh' }
  const names: ReadonlySet<string> = new Set(['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT'])
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => names.has(name.toUpperCase())),
  )
}

/**
The product's own host against the real file store in `directory`. The
provider client is the product's own, constructed with no key: no Meta key
is stored, which the host is told as the extension tells it
(`hasMetaCredential`), so the model listing reads no network, and any
request that would need the key fails on its missing key before a byte is
sent. A suite that needs a turn to fail past the missing-key check (a
failure the backend judges retryable, e.g. the credential store failing)
hands its own `apiKey`: the request fails there, and no call is made. A
loaded rig over the same folder (`loadedModelApiRig`) is the next
window's host: it revives what this one saved.
*/
export function modelApiRig(
  directory: string,
  loadExtensionHooks?: () => Promise<readonly ExtensionHookDefinition[]>,
  hasHookShell?: boolean,
  options?: {
    apiKey?: () => Promise<string | undefined>
    /** Configured providers' models (a real providers file), listed with no Meta key. */
    models?: ModelResolver
  },
): ModelApiRig {
  let ids = 0
  const warnings: string[] = []
  const errors: string[] = []
  const log = {
    trace: () => undefined,
    info: () => undefined,
    warn: (message: string) => {
      warnings.push(message)
    },
    error: (message: string) => {
      errors.push(message)
    },
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
    apiKey: options?.apiKey ?? (() => Promise.resolve(undefined)),
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
      systemRoot:
        hasHookShell === true && process.platform === 'win32'
          ? process.env['SystemRoot']
          : undefined,
      env: () => (hasHookShell === true ? hookShellEnvironment() : {}),
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
    describeEnvironment: () => Promise.reject(new Error('the panel rig runs no turn')),
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
    hasMetaCredential: () => false,
    store,
    ...(loadExtensionHooks !== undefined && { loadExtensionHooks }),
    ...(options?.models !== undefined && { models: options.models }),
  }
  return { host: new ModelApiHost(deps), store, warnings, errors }
}

/**
A window's host as the product's entry builds it (`modelApiEntry.ts`):
constructed, then loaded, so the conversations saved in the folder by an
earlier window are this window's History.
*/
export async function loadedModelApiRig(directory: string): Promise<ModelApiRig> {
  const rig = modelApiRig(directory)
  await rig.host.load()
  return rig
}

/** A saved session really landed: assertions on its file never pass vacuously. */
export async function awaitSaved(rig: ModelApiRig, sessionId: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await rig.host.flush()
    if ((await rig.store.load(sessionId)) !== undefined) {
      return
    }
  }
  throw new Error(`session ${sessionId} was never saved; warnings: ${JSON.stringify(rig.warnings)}`)
}

/**
Starts a session, names it and waits for its file: the conversation the
panel suites resume, bookmark and run sequences against.
*/
export async function savedSession(
  rig: ModelApiRig,
  directory: string,
  title: string,
): ReturnType<ModelApiHost['startSession']> {
  const live = await rig.host.startSession({
    workspaceRoot: directory,
    modelId: DEFAULT_MODEL_ID,
    approvalMode: 'promptUnmatched',
  })
  await live.rename(title)
  await awaitSaved(rig, live.sessionId)
  return live
}

export function unused(name: string): (...args: unknown[]) => never {
  return (..._args: unknown[]) => {
    throw new Error(`the panel rig never uses ${name}`)
  }
}

/** History's memory as the editor keeps it, in memory: no archived, damaged or last session. */
export function emptySessionMemory(): SessionMemory {
  return {
    archivedIds: () => [],
    setArchivedIds: () => Promise.resolve(),
    damagedIds: () => [],
    setDamagedIds: () => Promise.resolve(),
    lastSession: () => undefined,
    setLastSession: () => Promise.resolve(),
  }
}

export interface PanelOptions {
  readonly rig: ModelApiRig
  readonly directory: string
  /**
  The suite runs turns (RLF-ACPTURNS): the temp folder counts as known,
  so the running mark publishes (nowhere, with no store). Absent, sends
  refuse at the mark, as before.
  */
  readonly isNamespaceKnown?: boolean
  /** The model the person's picker holds when the panel opens. */
  readonly modelId?: string
  readonly sessions?: SessionMemory
  /** The person's answer to the panel's confirm dialog, when the path asks one. */
  readonly confirmFileAction?: () => Promise<boolean>
  /** This workspace's bookmarks (M88); absent, the controller refuses bookmark messages. */
  readonly bookmarks?: BookmarkPort
  /** The prompt sequence library (M88); absent, the controller refuses sequence messages. */
  readonly sequences?: SequencePort
  /** `/estimate` runs against this engine instead of refusing without one. */
  readonly estimator?: EstimatorRun
  /** The credential-identity generation the estimate reads under, when bound. */
  readonly estimatorGeneration?: () => string
}

export interface PanelRig {
  readonly controller: ConversationController
  readonly posted: HostToWebviewMessage[]
  /** What the controller wrote to the window's log, as the output channel shows it. */
  readonly logged: string[]
  /** Backend errors reported to the sign-in gate (a host that refuses to run). */
  readonly backendErrors: string[]
}

/** The real controller on `rig`'s host, as the editor builds it for one panel. */
export function conversationPanel(options: PanelOptions): PanelRig {
  const posted: HostToWebviewMessage[] = []
  const logged: string[] = []
  const backendErrors: string[] = []
  const record = (message: string) => {
    logged.push(message)
  }
  const surface: ChatSurface = {
    id: 'conversation-panel-test-surface',
    documentId: 'conversation-panel-test-doc',
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
    markBackendError: (detail: string): AuthSnapshot => {
      backendErrors.push(detail)
      return { status: 'signedIn', detail, backend: 'modelApi' }
    },
  }
  // No path here drives git: every entry fails closed instead of pretending
  // git ran, except the session-changed notification, which the rig has no
  // git panel to observe, and the event feed, which the real port ignores
  // while no generation waits for its reply (conversationGit.ts `onEvent`).
  const git: ConversationGitPort = {
    onEvent: () => undefined,
    sessionChanged: () => undefined,
    postState: unused('git.postState'),
    handleAction: unused('git.handleAction'),
    commit: unused('git.commit'),
    createPullRequest: unused('git.createPullRequest'),
    promptFor: unused('git.promptFor'),
    generationStarting: unused('git.generationStarting'),
    isGenerationCurrent: unused('git.isGenerationCurrent'),
    generationSubmitted: unused('git.generationSubmitted'),
    generationFailed: unused('git.generationFailed'),
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
    playbackText: unused('review.playbackText'),
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
    ensureHost: () => Promise.resolve(options.rig.host),
    workspaceRoot: options.directory,
    modelId: options.modelId ?? DEFAULT_MODEL_ID,
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
    // Every opened conversation reads it: the product's own resolution of
    // the setting's default for this folder, as the backend manager makes it.
    shellSandbox: () =>
      resolveShellSandbox({
        mode: SETTING_DEFAULTS.shellSandbox,
        platform: process.platform,
        workspaceRoot: options.directory,
        userProfileDir: process.env['USERPROFILE'],
      }),
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
    sessions: options.sessions ?? emptySessionMemory(),
    ...(options.bookmarks !== undefined && { bookmarks: options.bookmarks }),
    ...(options.sequences !== undefined && { sequences: options.sequences }),
    accountFacts: unused('accountFacts'),
    usageInsights: unused('usageInsights'),
    isRestorable: false,
    dictation: { isAvailable: false, reason: 'the panel rig records nothing' },
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
      // The temp folder counts as known only where the suite runs turns;
      // with no store their presence is unpublished, and units stay off.
      // Default false: sends refuse at the running mark, as before.
      isNamespaceKnown: () => options.isNamespaceKnown === true,
      isWorkspaceTrusted: () => true,
      isEnabled: () => true,
      hasGit: () => false,
    }),
    unsavedPaths: () => [],
    confirmFileAction: options.confirmFileAction ?? unused('confirmFileAction'),
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
    log: { trace: record, info: record, warn: record, error: record },
    ...(options.estimator !== undefined && { estimator: options.estimator }),
    ...(options.estimatorGeneration !== undefined && {
      estimatorGeneration: options.estimatorGeneration,
    }),
  }
  return { controller: new ConversationController(deps), posted, logged, backendErrors }
}

export function panelNotices(
  posted: readonly HostToWebviewMessage[],
): { readonly level: string; readonly text: string }[] {
  return posted
    .filter((message) => message.type === 'notice')
    .map((message) => ({
      level: message.level,
      text: message.text,
    }))
}

/**
Folds every posted message through the webview reducer; each message
parses, or the suite fails at the unparsable one.
*/
export function shownState(posted: readonly HostToWebviewMessage[]): UiState {
  let state = initialUiState
  for (const raw of posted) {
    const parsed = parseHostToWebviewMessage(raw)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) state = uiReducer(state, { type: 'hostMessage', message: parsed.message, at: 0 })
  }
  return state
}
