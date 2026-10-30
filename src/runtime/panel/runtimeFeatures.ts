// The conversation controller's dependencies in the runtime panel (M104 lane
// B, D84): the same controller and the same shared mapping as VS Code
// (src/host/compose/conversationDeps.ts), with the runtime's own answers for
// what an editor owns. Editor services (documents, selection, modals, the
// terminal, pickers) are MHP requests; the backend, the credential store and
// the settings files are the runtime's. What this editor does not serve is
// refused in words (`unavailable`), never answered with an empty success.
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { BestOfNCoordinator } from '../../core/bestOfN/bestOfNCoordinator'
import { confineWorkspacePath } from '../../core/workspacePath'
import { isProtectedPath } from '../../core/protectedPaths'
import { PendingPrompts } from '../../core/sessionBoard'
import { failureForLog } from '../../core/backends/musecode/logText'
import { createCheckpointPort } from '../../host/checkpoints/checkpointHost'
import {
  composeConversationDeps,
  type ConversationCompositionPorts,
} from '../../host/compose/conversationDeps'
import type {
  ConversationController,
  ConversationDeps,
  LastSession,
} from '../../host/conversation/conversationController'
import type { ExtensionSettings } from '../../host/settings'
import type { Logger } from '../../host/logger'
import { logRejection } from '../../host/logger'
import {
  ACP_AGENT_NAME,
  META_IMAGE_MAX_BYTES,
  MODEL_API_BASE_URL,
  RUNTIME_PANEL_PORTS_BUNDLE_FILE,
  UI_TEXT,
} from '../../shared/constants'
import type { HostServices } from '../../shared/hostApi/methods'
import type { EditorContext } from '../../core/editorContext'
import { HOST_ACTIONS, type HostAction, type SignInMethod } from '../../shared/protocol'
import * as z from 'zod/mini'
import type { RuntimeBackend } from '../backends'
import type { RuntimeSettingsStore } from '../settingsStore'
import { RuntimeAuth } from '../features/auth'
import { createRuntimeReview } from '../features/review'
import { createRuntimeTransfer } from '../features/transfer'
import type { RuntimePaid } from '../features/paid'
import { lazyPlans } from '../features/portsBundle'
import { unavailable } from '../features/unavailable'
import { unavailableGit } from '../features/unavailableGit'
import { readConfinedBytes, type RuntimeWorkspaceFiles } from '../features/workspaceFiles'
import type { PanelGit } from './git/panelGit'
import type { ConversationContext } from './runtimeConversation'
import { stat } from 'node:fs/promises'

export interface RuntimeConversationPorts {
  /** The editor's services over MHP; settings and storage answer from the runtime's own store. */
  readonly host: HostServices
  readonly runtime: RuntimeBackend
  readonly workspaceRoot: string
  readonly store: RuntimeSettingsStore
  readonly settings: () => ExtensionSettings
  /** Whether the editor trusts the workspace (MHP `workspace/trust`); read at every use. */
  readonly isTrusted: () => boolean
  /** Whether Bypass is offered at all (`allowDangerouslySkipPermissions` and the runtime's own say). */
  readonly canBypass: boolean
  /** The paid features' gate and tally, shared by every conversation of the process. */
  readonly paid: RuntimePaid
  readonly controllers: () => Iterable<ConversationController>
  readonly runGit: ConversationDeps['runGit']
  /** The connection's Git, once opened; none in a workspace with no repository. */
  readonly git: () => PanelGit | undefined
  /** The editor shows this text in a tab of its own (a tool row's output). */
  readonly openDocument: (title: string, content: string) => Promise<void>
  /** The paid state the surfaces show changed outside the gate and the tally ("Ask again"). */
  readonly paidChanged: () => void
  /** The folder holding the shipped bundles (dist/). */
  readonly distDir: string
  /** The agent's data folder. */
  readonly dataFolder: string
  /** The workspace's files, indexed once for every conversation of the process. */
  readonly files: RuntimeWorkspaceFiles
  /** The active editor as the next message would carry it. */
  readonly editorContext: () => EditorContext | undefined
  readonly documents: () => readonly { readonly uri: string; readonly dirty: boolean }[]
  readonly isSideChat: boolean
  readonly log: Logger
}

const idsSchema = z.array(z.string())
const lastSessionSchema = z.strictObject({ sessionId: z.string(), at: z.number() })

/** The sign-in paths the gate offers for each backend, and the trusted command each starts. */
const SIGN_IN = {
  museCode: { methods: ['browser'] as const, command: { browser: ['login'] } },
  modelApi: { methods: ['apiKey'] as const, command: { apiKey: ['auth', 'set'] } },
} as const

export async function runtimeConversationDeps(
  ports: RuntimeConversationPorts,
  context: ConversationContext,
): Promise<ConversationDeps> {
  const { host, runtime, workspaceRoot, store, log, isTrusted } = ports
  const { surface } = context
  const platform = process.platform
  const kind = runtime.backend.kind
  const signIn = SIGN_IN[kind]
  const auth = new RuntimeAuth({
    backend: runtime.backend,
    broadcast: (message) => {
      surface.post(message)
    },
    methods: signIn.methods,
    installCommand: UI_TEXT.cliNotFound,
    startSignIn: async (method: SignInMethod, signal) => {
      const args = (signIn.command as Partial<Record<SignInMethod, readonly string[]>>)[method]
      if (args === undefined) return unavailable()
      // The key is typed in the editor's terminal on the trusted command; it never crosses MHP.
      const terminal = await host.request(
        'terminal/create',
        {
          cwd: pathToFileURL(workspaceRoot).href,
          executable: ACP_AGENT_NAME,
          args: [...args],
          env: {},
        },
        signal,
      )
      await host.request('terminal/show', terminal, signal)
    },
  })
  const { files } = ports
  const archived = idsSchema.parse((await store.getStorage('archivedSessions', 'workspace')) ?? [])
  const damaged = idsSchema.parse((await store.getStorage('damagedSessions', 'workspace')) ?? [])
  let last: LastSession | undefined
  const storedLast = await store.getStorage('lastSession', 'workspace')
  if (storedLast !== null) last = lastSessionSchema.parse(storedLast)
  const actions = hostActions(ports, auth)
  const ensureHost = async () => {
    if (auth.current.status !== 'signedIn') return unavailable()
    const found = await runtime.backend.hostFor(workspaceRoot)
    context.noteHost(found)
    return found
  }
  const isConfirmed = async (title: string, message: string, action: string): Promise<boolean> =>
    (await host.request('ui/confirm', { title, message, choices: [{ id: 1, title: action }] })) ===
    1
  async function didApplyCode(text: string, isInsert: boolean): Promise<boolean> {
    const active = await host.request('editor/active', {})
    if (active === null) return false
    const confined = await confineWorkspacePath(
      workspaceRoot,
      path.relative(workspaceRoot, fileURLToPath(active.uri)),
      platform,
      { realPath: realpath },
    )
    if (!isTrusted() || !confined.ok || isProtectedPath(confined.canonical)) return unavailable()
    if (isInsert)
      await host.request('editor/insertAtCursor', {
        uri: active.uri,
        expectedVersion: active.version,
        position: active.range.end,
        text,
        undoLabel: UI_TEXT.insertCode,
      })
    else
      await host.request('editor/replaceSelection', {
        uri: active.uri,
        expectedVersion: active.version,
        range: active.range,
        text,
        undoLabel: UI_TEXT.applyCode,
      })
    return true
  }
  const workspaceRelative = (uri: string) => files.files.toRelativePath(uri)
  const paid = runtime.paid
  // Edit review and `/review`: int's review bundle, with the editor's diff and picker over MHP.
  const reviewing = createRuntimeReview({
    host,
    distDir: ports.distDir,
    workspaceRoot,
    dataFolder: ports.dataFolder,
    platform,
    runGit: ports.runGit,
    documents: ports.documents,
    isTrusted,
    signal: context.signal,
    log,
  })
  context.own(() => reviewing.dispose())
  const transfer = createRuntimeTransfer({
    host,
    workspaceRoot,
    dataFolder: ports.dataFolder,
    signal: context.signal,
    log,
  })
  context.own(() => transfer.dispose())
  const plans = lazyPlans({
    bundlePath: path.join(ports.distDir, RUNTIME_PANEL_PORTS_BUNDLE_FILE),
    log,
    plans: {
      host,
      workspaceRoot,
      platform,
      distDir: ports.distDir,
      confirm: isConfirmed,
      isTrusted,
      signal: context.signal,
      log,
    },
  })
  await auth.refresh()
  const composition: ConversationCompositionPorts = {
    editor: {
      openExternal: (url) => {
        void host.request('ui/openExternal', { uri: url }).catch(logRejection(log, 'open external'))
      },
      copyText: async (text) => {
        await host.request('ui/clipboard', { text })
      },
      saveAll: async () => {
        await host.request('documents/saveAll', {})
      },
      confirm: isConfirmed,
      openFolderInNewWindow: async (absolutePath) => {
        await host.request('workspace/openFolder', {
          uri: pathToFileURL(absolutePath).href,
          newWindow: true,
        })
      },
    },
    settings: () => ({
      ...ports.settings(),
      allowDangerouslySkipPermissions:
        ports.canBypass && ports.settings().allowDangerouslySkipPermissions,
    }),
    auth,
    workspaceRoot,
    platform,
    realPath: realpath,
    paid: {
      gate: ports.paid.gate,
      consent: {
        // D48: every use asks first, in the editor; nothing is checked against a limit the person did not set.
        allows: (request) => paid.allows(workspaceRoot, context.sessionId(), request, false),
        // Every use asks again here (M58); the badge and toggles show it at once.
        forget: async () => {
          await paid.forget(workspaceRoot, context.sessionId())
          ports.paidChanged()
        },
      },
      usage: {
        add: (feature, units, searchPriceUsd) => {
          ports.paid.usage.add(feature, units, searchPriceUsd)
        },
        addBestOfNRequest: () => unavailable(),
        addBestOfNUsage: () => unavailable(),
      },
    },
    modelApi: {
      accountId: () => unavailable(),
      ensureHost: () => unavailable(),
      captureExternalEditOwner: () => unavailable(),
      beginExternalEdit: () => unavailable(),
      bestOfNBudgetScope: () => unavailable(),
      buildAttemptHost: () => unavailable(),
    },
    isKeyStored: () => kind === 'modelApi' && auth.current.status === 'signedIn',
    museVoiceSetup: { isAvailable: false, reason: UI_TEXT.dictationUnavailable },
    backgroundSessions: () => [],
    controllers: ports.controllers,
    isProjectTrusted: isTrusted,
    toolImageIo: {
      realPath: realpath,
      fileSize: async (file) => {
        const info = await stat(file)
        return info.size
      },
      readBytes: (file) => readConfinedBytes(file, workspaceRoot, META_IMAGE_MAX_BYTES),
    },
  }
  const shared = composeConversationDeps(composition)
  return {
    ...shared,
    surface,
    auth,
    ensureHost,
    workspaceRoot,
    mentions: files.mentions,
    files: files.files,
    isRemoteWindow: false,
    confirmContributor: async () =>
      await isConfirmed(
        UI_TEXT.contributorTitle,
        UI_TEXT.contributorDetail,
        UI_TEXT.contributorConfirm,
      ),
    runHostAction: (action) =>
      actions.get(action)?.() ?? Promise.reject(new Error(UI_TEXT.hostService.notAvailable)),
    insertCode: (text) => didApplyCode(text, true),
    applyCode: (text) => didApplyCode(text, false),
    onSandboxUnavailable: () => {
      surface.post({ type: 'notice', level: 'warning', text: UI_TEXT.hostService.notAvailable })
    },
    platform,
    shellSandbox: () => runtime.museCode.shellSandboxPosture(),
    editorContext: ports.editorContext,
    isAutosaveEnabled: () => ports.settings().autosave,
    unsavedFiles: () =>
      ports
        .documents()
        .filter((document) => document.dirty)
        .map((document) => workspaceRelative(document.uri) ?? document.uri),
    unsavedPaths: () =>
      ports
        .documents()
        .filter((document) => document.dirty)
        .map((document) => fileURLToPath(document.uri)),
    editReview: reviewing.editReview,
    review: reviewing.review,
    openDocument: ports.openDocument,
    openFile: async (file, range) => {
      const confined = await confineWorkspacePath(
        workspaceRoot,
        path.relative(workspaceRoot, path.resolve(workspaceRoot, file)),
        platform,
        { realPath: realpath },
      )
      if (!confined.ok) return unavailable()
      await host.request('editor/open', {
        uri: pathToFileURL(confined.checkedAbsolute).href,
        ...(range !== undefined && {
          range: {
            start: { line: range.startLine - 1, character: 0 },
            end: { line: range.endLine - 1, character: 0 },
          },
        }),
      })
    },
    // The IDE tool server (diagnostics, code intelligence) is not served here: a session starts without it.
    ideMcpEndpoint: () => Promise.resolve(undefined),
    newAttachmentId: randomUUID,
    sessions: {
      archivedIds: () => archived,
      damagedIds: () => damaged,
      lastSession: () => last,
      setArchivedIds: async (ids) => {
        await store.setStorage('archivedSessions', [...ids], 'workspace')
        archived.splice(0, archived.length, ...ids)
      },
      setDamagedIds: async (ids) => {
        await store.setStorage('damagedSessions', [...ids], 'workspace')
        damaged.splice(0, damaged.length, ...ids)
      },
      setLastSession: async (next) => {
        try {
          await store.setStorage(
            'lastSession',
            next === undefined ? null : { ...next },
            'workspace',
          )
        } catch (error: unknown) {
          // REPORTED: a last session that could not be kept is logged; the conversation goes on.
          log.warn(`The last session could not be kept: ${failureForLog(error)}`)
          return
        }
        const committed = await store.getStorage('lastSession', 'workspace')
        last = committed === null ? undefined : lastSessionSchema.parse(committed)
      },
    },
    accountFacts: async () => {
      const found = kind === 'museCode' ? await ensureHost() : undefined
      return {
        signInMethod:
          auth.current.status === 'signedIn' ? (kind === 'modelApi' ? 'apiKey' : 'cli') : 'none',
        ...(found !== undefined && { cliVersion: found.info.serverVersion }),
      }
    },
    // Muse Voice is a Meta service the panel cannot yet bill: the press says why.
    voiceAccountId: () => Promise.resolve(undefined),
    usageInsights: () =>
      Promise.resolve({ report: undefined, notice: 'unavailable' as const, empty: false }),
    isRestorable: false,
    dictation: { isAvailable: false, reason: UI_TEXT.dictationUnavailable },
    exports: transfer.exports,
    transferFiles: transfer.transferFiles,
    plans,
    isWorkspaceTrusted: isTrusted,
    isWorktreeHeld: () => false,
    createGit: (gitSurface) =>
      ports.git()?.createGit(gitSurface) ??
      unavailableGit(gitSurface, UI_TEXT.hostService.notAvailable, log),
    tasksTab: context.tasksTab,
    onForegroundTasksChanged: () => {
      log.trace('MHP_FOREGROUND_TASKS_CHANGED')
    },
    checkpoints: createCheckpointPort({
      isNamespaceKnown: () => true,
      store: undefined,
      isWorkspaceTrusted: isTrusted,
      isEnabled: () => false,
      hasGit: () => false,
    }),
    pendingPrompts: new PendingPrompts(),
    bestOfNCoordinator: new BestOfNCoordinator(),
    runGit: ports.runGit,
    realPath: realpath,
    notifyAttention: (notice) => {
      void host
        .request('window/attention', { message: notice.message })
        .catch(logRejection(log, 'panel attention'))
    },
    now: Date.now,
    log,
  }
}

/** The host actions the runtime answers itself; the rest are refused in words. */
function hostActions(
  ports: RuntimeConversationPorts,
  auth: RuntimeAuth,
): ReadonlyMap<HostAction, () => Promise<void>> {
  const known = new Map<HostAction, () => Promise<void>>()
  const toggle = (name: string, isOn: () => boolean) => async () => {
    await ports.store.updateSetting(`museSpark.${name}`, !isOn(), 'user')
  }
  const settings = ports.settings
  known.set('hideOnboarding', async () => {
    await ports.store.updateSetting('museSpark.hideOnboarding', true, 'user')
  })
  known.set(
    'toggleCtrlEnterToSend',
    toggle('useCtrlEnterToSend', () => settings().useCtrlEnterToSend),
  )
  known.set(
    'toggleFocusView',
    toggle('focusView', () => settings().focusView),
  )
  known.set('restartMuseCode', async () => {
    await auth.checkAgain()
  })
  known.set('openModelApiStatus', async () => {
    await ports.host.request('ui/openExternal', { uri: `${MODEL_API_BASE_URL}/status` })
  })
  for (const action of known.keys()) {
    if (!HOST_ACTIONS.includes(action)) throw new Error('MHP_COMPOSITION_ACTION_UNKNOWN')
  }
  return known
}
