import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { RuntimeBackend } from '../backends'
import type { ServeOptions } from '../cliArgs'
import { walkFiles } from '../fileWalk'
import { type RuntimeSettingsStore } from '../settingsStore'
import type { AgentHost } from '../../core/agent/agentBackend'
import { MentionIndex } from '../../core/mentionIndex'
import { BestOfNCoordinator } from '../../core/bestOfN/bestOfNCoordinator'
import { PendingPrompts } from '../../core/sessionBoard'
import { handleIdentity, statIdentity, sameFile } from '../../core/fs/fileIdentity'
import { confineWorkspacePath } from '../../core/workspacePath'
import { paidUseQuestion } from '../../core/paid/paidConsent'
import { ACP_PAID_OPTIONS } from '../../shared/constants'
import { isProtectedPath } from '../../core/protectedPaths'
import { createCheckpointPort } from '../../host/checkpoints/checkpointHost'
import {
  composeConversationDeps,
  type ConversationCompositionPorts,
  type ConversationFeaturePorts,
} from '../../host/compose/conversationDeps'
import type {
  ConversationController,
  ConversationGitPort,
  LastSession,
} from '../../host/conversation/conversationController'
import type { ChatSurface } from '../../host/views/chatSurface'
import type { AuthPort, AuthSnapshot } from '../../host/auth/authService'
import type { Logger } from '../../host/logger'
import { logRejection } from '../../host/logger'
import { readSettings } from '../../host/settings'
import type { HostServices, MhpParams } from '../../shared/hostApi/methods'
import {
  ACP_AGENT_NAME,
  MENTION_INDEX_LIMIT,
  MENTION_INDEX_TTL_MS,
  MAX_IMAGE_BYTES,
  SETTING_DEFAULTS,
  SETTINGS_SECTION,
  UI_TEXT,
} from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import * as z from 'zod/mini'

function unavailable(feature: string): never {
  throw new Error(`${UI_TEXT.actionFailed}: ${feature} (MHP_UNSUPPORTED_CAPABILITY)`)
}

/** Reads only a confined regular file, bounded even when it grows during the read. */
async function readBytes(
  file: string,
  root: string,
  maximum: number,
  expected?: string,
): Promise<Uint8Array> {
  const confined = await confineWorkspacePath(root, path.relative(root, file), process.platform, {
    realPath: realpath,
  })
  if (!confined.ok || (expected !== undefined && confined.canonical !== expected))
    return unavailable('files')
  const handle = await open(confined.checkedAbsolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
  try {
    const info = await handleIdentity(handle)
    const after = await realpath(confined.checkedAbsolute)
    const target = await statIdentity(after)
    if (after !== confined.checkedAbsolute || !sameFile(target, info)) return unavailable('files')
    if (!info.isFile() || info.size > BigInt(maximum)) return unavailable('files')
    const bytes = new Uint8Array(maximum + 1)
    let offset = 0
    for (;;) {
      const next = await handle.read(bytes, offset, bytes.length - offset, null)
      offset += next.bytesRead
      if (offset > maximum) return unavailable('files')
      if (next.bytesRead === 0) break
    }
    return bytes.subarray(0, offset)
  } finally {
    await handle.close()
  }
}

/** Runtime settings are hydrated before composition and refreshed after each admitted update. */
export async function runtimeSettings(store: RuntimeSettingsStore, log: Logger) {
  const values = new Map<string, unknown>()
  async function refresh(): Promise<void> {
    for (const key of Object.keys(SETTING_DEFAULTS))
      values.set(key, await store.getSetting(`${SETTINGS_SECTION}.${key}`))
  }
  await refresh()
  return { refresh, current: () => readSettings({ get: (key) => values.get(key) }, log) }
}

/** Explicitly unavailable Git actions; no empty successful commit/push/PR result. */
function unavailableGit(
  surface: Parameters<ConversationFeaturePorts['createGit']>[0],
  log: Logger,
): ConversationGitPort {
  let isDisposed = false
  const report = () => {
    if (!isDisposed) surface.notice('warning', UI_TEXT.gitUnavailable)
  }
  return {
    postState: report,
    sessionChanged: report,
    handleAction: () => Promise.reject(new Error(UI_TEXT.gitUnavailable)),
    commit: () => Promise.reject(new Error(UI_TEXT.gitUnavailable)),
    createPullRequest: () => Promise.reject(new Error(UI_TEXT.gitUnavailable)),
    promptFor: () => Promise.reject(new Error(UI_TEXT.gitUnavailable)),
    generationStarting: () => unavailable('git'),
    isGenerationCurrent: () => false,
    generationSubmitted: report,
    generationFailed: report,
    onEvent: () => {
      log.trace('MHP_GIT_UNAVAILABLE')
    },
    dispose: () => {
      isDisposed = true
    },
  }
}

const idsSchema = z.array(z.string())
const lastSessionSchema = z.strictObject({ sessionId: z.string(), at: z.number() })
export interface RuntimeConversationPorts {
  /** Absent for ACP, whose editor owns its immutable session identity. */
  readonly sessionChanged?: (previousId: string, sessionId: string) => Promise<void>
  readonly openSideChat?: ConversationFeaturePorts['openSideChat']
  readonly ownsPaidConsent?: boolean
  readonly confirmContributor?: ConversationFeaturePorts['confirmContributor']
  readonly host: HostServices
  readonly runtime: RuntimeBackend
  readonly workspaceRoot: string
  readonly options: ServeOptions
  readonly store: RuntimeSettingsStore
  readonly settings: Awaited<ReturnType<typeof runtimeSettings>>
  readonly surface: ChatSurface
  readonly controllers: () => Iterable<ConversationController>
  readonly runGit: ConversationFeaturePorts['runGit']
  readonly selection: () => MhpParams<'editor/didChangeSelection'>['selection']
  readonly documents: () => readonly { readonly uri: string; readonly dirty: boolean }[]
  readonly log: Logger
}

/** Uses the same composition and controller as VS Code, with runtime admission policy. */
export async function runtimeConversationDeps(ports: RuntimeConversationPorts) {
  const { host, runtime, workspaceRoot, options, store, settings, surface, log } = ports
  let snapshot: AuthSnapshot = {
    status: 'checking',
    backend: runtime.backend.kind,
    detail: undefined,
  }
  let admissionGeneration = 0
  const refresh = async (isRecheck = false) => {
    const readiness = await runtime.backend.readiness(isRecheck)
    let status: AuthSnapshot['status'] = 'error'
    if (readiness.state === 'ready') status = 'signedIn'
    else if (readiness.state === 'signedOut') status = 'signedOut'
    snapshot = {
      status,
      backend: runtime.backend.kind,
      detail: readiness.state === 'ready' ? undefined : readiness.message,
    }
    admissionGeneration += 1
    surface.post(auth.toMessage())
    return snapshot
  }
  const auth: AuthPort = {
    get current() {
      return snapshot
    },
    get backend() {
      return runtime.backend.kind
    },
    get admissionGeneration() {
      return admissionGeneration
    },
    toMessage: () => ({
      type: 'authState',
      status: snapshot.status,
      ...(snapshot.detail !== undefined && { detail: snapshot.detail }),
    }),
    signIn: async () => {
      const terminal = await host.request('terminal/create', {
        cwd: pathToFileURL(workspaceRoot).href,
        executable: ACP_AGENT_NAME,
        args: options.backend === 'modelApi' ? ['auth', 'set'] : ['login'],
        env: {},
      })
      await host.request('terminal/show', terminal)
      return await refresh(true)
    },
    installMuseCode: () => Promise.reject(new Error(UI_TEXT.cliNotFound)),
    cancelSignIn: () => {
      admissionGeneration += 1
    },
    signOut: () => Promise.reject(new Error(UI_TEXT.actionFailed)),
    refresh: () => refresh(),
    checkAgain: () => refresh(true),
    markAuthRequired: (detail) => {
      snapshot = { status: 'signedOut', backend: runtime.backend.kind, detail }
      admissionGeneration += 1
      surface.post(auth.toMessage())
      return snapshot
    },
    markBackendError: (detail) => {
      snapshot = { status: 'error', backend: runtime.backend.kind, detail }
      admissionGeneration += 1
      surface.post(auth.toMessage())
      return snapshot
    },
  }
  await refresh()
  if (ports.ownsPaidConsent !== false)
    runtime.paid.attach(async (_sessionId, request, canRemember) => {
      const question = paidUseQuestion(request)
      const answer = await host.request('ui/confirm', {
        title: question.title,
        message: question.detail,
        choices: [
          { id: ACP_PAID_OPTIONS.allowOnce, title: UI_TEXT.allowOnce },
          ...(canRemember
            ? [{ id: ACP_PAID_OPTIONS.allowAlways, title: UI_TEXT.paidAllowAlways }]
            : []),
          { id: ACP_PAID_OPTIONS.deny, title: UI_TEXT.paidDeny },
        ],
      })
      if (answer === ACP_PAID_OPTIONS.allowOnce) return 'once'
      return canRemember && answer === ACP_PAID_OPTIONS.allowAlways ? 'always' : 'deny'
    })
  const mentions = new MentionIndex({
    listFiles: () => walkFiles(workspaceRoot, MENTION_INDEX_LIMIT, log),
    now: Date.now,
    ttlMs: MENTION_INDEX_TTL_MS,
    limit: MENTION_INDEX_LIMIT,
    log,
  })
  const archived = idsSchema.parse((await store.getStorage('archivedSessions', 'workspace')) ?? [])
  const damaged = idsSchema.parse((await store.getStorage('damagedSessions', 'workspace')) ?? [])
  let last: LastSession | undefined
  const storedLast = await store.getStorage('lastSession', 'workspace')
  if (storedLast !== null) last = lastSessionSchema.parse(storedLast)
  const ensureHost = async (): Promise<AgentHost> => {
    return auth.current.status === 'signedIn'
      ? await runtime.backend.hostFor(workspaceRoot)
      : unavailable('authentication')
  }
  async function didApplyCode(text: string, isInsert: boolean): Promise<boolean> {
    const active = await host.request('editor/active', {})
    if (active === null) return false
    const absolute = fileURLToPath(active.uri)
    const confined = await confineWorkspacePath(
      workspaceRoot,
      path.relative(workspaceRoot, absolute),
      process.platform,
      { realPath: realpath },
    )
    if (!options.trustWorkspace || !confined.ok || isProtectedPath(confined.canonical))
      return unavailable('editor')
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
  const features: ConversationFeaturePorts = {
    surface,
    auth,
    ensureHost,
    workspaceRoot,
    mentions,
    files: {
      showOpenDialog: () => Promise.reject(new Error(UI_TEXT.actionFailed)),
      readFile: async (file, maximum, expected) => ({
        bytes: await readBytes(file, workspaceRoot, maximum, expected),
        isPdf: path.extname(file).toLowerCase() === '.pdf',
      }),
      canonicalRelativePath: async (file) => {
        const confined = await confineWorkspacePath(
          workspaceRoot,
          path.relative(workspaceRoot, file),
          process.platform,
          { realPath: realpath },
        )
        return confined.ok
          ? { canonical: confined.canonical, checkedAbsolute: confined.checkedAbsolute }
          : undefined
      },
      pickMentionFile: async () => {
        const items = await mentions.search('', MENTION_INDEX_LIMIT)
        const selected = await host.request('ui/pick', {
          title: UI_TEXT.attachFile,
          items: items
            .filter((item) => !item.isFolder)
            .map((item) => ({ id: item.path, title: item.path })),
          multiple: false,
        })
        return typeof selected?.[0] === 'string' ? selected[0] : undefined
      },
      toRelativePath: (uri) => {
        try {
          const relative = path.relative(workspaceRoot, fileURLToPath(uri))
          return relative.startsWith('..') || path.isAbsolute(relative)
            ? undefined
            : relative.replaceAll(path.sep, '/')
        } catch {
          return
        }
      },
    },
    isRemoteWindow: false,
    confirmContributor:
      ports.confirmContributor ??
      (async () =>
        options.allowsContributorModels &&
        (await host.request('ui/confirm', {
          title: UI_TEXT.contributorTitle,
          message: UI_TEXT.contributorDetail,
          choices: [{ id: 1, title: UI_TEXT.contributorConfirm }],
        })) === 1),
    runHostAction: () => Promise.reject(new Error(UI_TEXT.actionFailed)),
    insertCode: (text) => didApplyCode(text, true),
    applyCode: (text) => didApplyCode(text, false),
    onSandboxUnavailable: () => {
      surface.post({ type: 'notice', level: 'warning', text: UI_TEXT.actionFailed })
    },
    platform: process.platform,
    shellSandbox: () => runtime.museCode.shellSandboxPosture(),
    editorContext: () => {
      const active = ports.selection()
      if (active === null) return
      const relative = features.files.toRelativePath(active.uri)
      if (relative === undefined) return
      return {
        relativePath: relative,
        startLine: active.range.start.line + 1,
        endLine: active.range.end.line + 1,
        isEmpty:
          active.range.start.line === active.range.end.line &&
          active.range.start.character === active.range.end.character,
        selectedText: undefined,
      }
    },
    isAutosaveEnabled: () => settings.current().autosave,
    unsavedFiles: () =>
      ports
        .documents()
        .filter((document) => document.dirty)
        .map((document) => features.files.toRelativePath(document.uri) ?? document.uri),
    unsavedPaths: () =>
      ports
        .documents()
        .filter((document) => document.dirty)
        .map((document) => fileURLToPath(document.uri)),
    editReview: {
      openDiff: () => unavailable('diff'),
      revert: () => unavailable('diff'),
      describe: () => unavailable('diff'),
      revertHunk: () => unavailable('diff'),
    },
    review: {
      collect: () => unavailable('review'),
      turnText: () => unavailable('review'),
      newMarker: () => unavailable('review'),
      createHold: () => unavailable('review'),
    },
    openDocument: () => Promise.reject(new Error(UI_TEXT.actionFailed)),
    openFile: async (file, range) => {
      const target = path.resolve(workspaceRoot, file)
      const confined = await confineWorkspacePath(
        workspaceRoot,
        path.relative(workspaceRoot, target),
        process.platform,
        { realPath: realpath },
      )
      if (!confined.ok) return unavailable('files')
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
          logRejection(log, 'last session')(error)
          return
        }
        last = next
      },
    },
    accountFacts: async () => {
      const host = options.backend === 'museCode' ? await ensureHost() : undefined
      const method = options.backend === 'modelApi' ? 'apiKey' : 'cli'
      return {
        signInMethod: auth.current.status === 'signedIn' ? method : 'none',
        ...(host !== undefined && { cliVersion: host.info.serverVersion }),
      }
    },
    usageInsights: () => Promise.resolve(undefined),
    isRestorable: true,
    dictation: { isAvailable: false, reason: UI_TEXT.dictationUnavailable },
    exports: {
      saveMarkdown: () => unavailable('export'),
      saveSessionLog: () => unavailable('export'),
      saveJson: () => unavailable('export'),
      previewExport: () => unavailable('export'),
      localRoots: () => [workspaceRoot],
    },
    transferFiles: {
      pickTransferFile: () => unavailable('import'),
      confirmImport: () => unavailable('import'),
    },
    plans: undefined,
    isWorkspaceTrusted: () => options.trustWorkspace,
    isWorktreeHeld: () => false,
    createGit: (gitSurface) => unavailableGit(gitSurface, log),
    onForegroundTasksChanged: () => {
      log.trace('MHP_FOREGROUND_TASKS_CHANGED')
    },
    checkpoints: {
      ...createCheckpointPort({
        isNamespaceKnown: () => true,
        store: undefined,
        isWorkspaceTrusted: () => options.trustWorkspace,
        isEnabled: () => false,
        hasGit: () => false,
      }),
      // This runtime has a folder but no checkpoint store/recorder adapter yet.
      availability: () => (options.trustWorkspace ? 'off' : 'restricted'),
    },
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
  const composition: ConversationCompositionPorts = {
    features,
    settings: () => ({
      ...settings.current(),
      allowDangerouslySkipPermissions:
        options.canBypass && settings.current().allowDangerouslySkipPermissions,
    }),
    paid: {
      gate: {
        isOn: (feature) => runtime.paid.isOn(feature),
        turnOn: () => unavailable('paidSettings'),
        turnOff: () => unavailable('paidSettings'),
      },
      consent: {
        allows: (request) => runtime.paid.allows(workspaceRoot, surface.id, request, true),
        forget: () => unavailable('paidConsent'),
      },
      usage: {
        add: (feature, units) => {
          runtime.paid.noteUse(feature, units)
        },
        addBestOfNRequest: () => unavailable('bestOfN'),
        addBestOfNUsage: () => unavailable('bestOfN'),
      },
    },
    modelApi: {
      accountId: () => unavailable('modelApiAccount'),
      ensureHost: () => unavailable('modelApiBudget'),
      captureExternalEditOwner: () => unavailable('workspaceEdits'),
      beginExternalEdit: () => unavailable('workspaceEdits'),
      bestOfNBudgetScope: () => unavailable('bestOfN'),
      buildAttemptHost: () => unavailable('bestOfN'),
    },
    isKeyStored: () => options.backend === 'modelApi' && auth.current.status === 'signedIn',
    museVoiceSetup: features.dictation,
    controllers: ports.controllers,
    isProjectTrusted: () => options.trustWorkspace,
    toolImageIo: {
      realPath: realpath,
      fileSize: async (file) => {
        const info = await stat(file)
        return info.size
      },
      readBytes: (file) => readBytes(file, workspaceRoot, MAX_IMAGE_BYTES),
    },
  }
  log.trace(`Panel language ${uiLocale()}`)
  return composeConversationDeps(host, composition)
}
