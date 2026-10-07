// The ACP agent's backend (PLAN.md D62): the panel's backend managers,
// given in this process what VS Code gives them in the extension, one per
// workspace folder. Muse Code signs in on its own and the subscription
// pays, its sign-in read as the panel reads it (D26: the credential file's
// structure, and `account/read` where only the CLI can say); the Model API
// backend reads the key from the OS credential store
// (D61) and is the extension's own bundle, dist/modelApi.js beside acp.js,
// loaded the first time that backend starts (M57, PLAN.md D6). Its paid
// features are the agent's flags, each use asked in the editor (M58, D48),
// and nothing here sees an editor's unsaved buffers until file access goes
// through the client (M63c).

import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { AcpBackend, BackendReadiness } from '../acp/agent'
import { AcpPaidUse, type HeadlessPaidPolicy } from '../acp/paid'
import type { AgentHost } from '../core/agent/agentBackend'
import type { CliSignIn } from '../core/backends/musecode/credentialFile'
import { environmentValue } from '../core/backends/musecode/launch'
import { personalSkillsRoot } from '../core/context/skills'
import { personalAgentsRoot } from '../core/context/customAgents'
import { memoryDataRoot } from '../core/memory/memoryLocation'
import { MemoryStore } from '../core/memory/memoryStore'
import { WorkspaceEdits } from '../core/verify/workspaceEdits'
import { redactSecrets } from '../core/redact'
import { fileContextIo } from '../host/backend/contextIo'
import { describeEnvironment } from '../host/backend/environment'
import { createFileSessionStore } from '../host/backend/fileSessionStore'
import { jobSourceReader } from '../host/backend/jobSource'
import { createMemoryIo, systemPath } from '../host/backend/memoryIo'
import { ModelApiBackendManager } from '../host/backend/modelApiBackendManager'
import { MuseCodeBackendManager, type ProxySettings } from '../host/backend/museCodeBackendManager'
import { shellJobAssembly } from '../host/backend/shellJob'
import { createToolIo } from '../host/backend/toolIo'
import { AccountHosts, connectAccountSession } from '../host/auth/accountHost'
import { CliAccount, isCliSignedIn } from '../host/auth/cliAccount'
import { CredentialStore, type SecretStore } from '../host/auth/credentialStore'
import type { Logger } from '../host/logger'
import { createWorkspaceFileLister } from '../host/mention/workspaceFiles'
import { pageConverter } from '../host/web/pageConverter'
import { createWebFetcher } from '../host/web/webFetcher'
import { captureWorkspaceIdentity } from '../host/workspaceIdentity'
import { canonicalPath } from '../host/canonicalPath'
import { createCheckpointedMemory } from '../host/backend/checkpointedMemory'
import {
  finishCheckpointTurn,
  prepareCheckpointTurn,
  withCheckpointStorageGuard,
} from '../host/checkpoints/checkpointHost'
import type { RuntimeCheckpoints } from './features/checkpoints'
import type { VerifyHooks } from '../core/backends/modelapi/verifyLoop'
import type { createRuntimeVerify } from './features/verify'
import type { createRuntimeHooks } from './features/hooks'
import type { createRuntimeCodeIntel } from './features/codeIntel'
import type { LanguageServiceHost } from '../core/codeIntel/languageService'
import type { WebFetcher } from '../core/web/webFetch'
import type { BrowserCheckHost } from '../core/browser/browserTool'
import type { createRuntimeWebFetch } from './features/webFetch'
import type { createRuntimeBrowser } from './features/browser'
import type { McpPoolSnapshot, McpToolSource } from '../core/backends/modelapi/mcp/pool'
import type { ScheduleStore } from '../shared/schedule'
import type { McpPoolFactory } from '../host/backend/modelApiBundle'
import type { RuntimePaidUse } from './features/paidUse'
import type { ModelApiClientDeps } from '../core/backends/modelapi/client'
import type { PaidUsage } from '../core/paid/paidFeatures'
import {
  type EnvironmentVariable,
  FILE_REFUSAL_MODEL_TEXT,
  MENTION_INDEX_LIMIT,
  MODEL_API_BUNDLE_FILE,
  PAGE_WORKER_FILE,
  SEARCH_WORKER_FILE,
  SECRET_KEYS,
  SETTING_DEFAULTS,
  UI_TEXT,
} from '../shared/constants'
import { fill } from '../shared/l10n/text'
import type { ServeOptions } from './cliArgs'
import {
  agentDataFolder,
  type DataFolderInput,
  paidGrantsFile,
  workspaceSessionsFolder,
} from './dataFolder'
import { withoutCredentials, withoutKeyringRoutes } from './credentialVariables'
import { walkFiles } from './fileWalk'
import { paidGrantFile } from './paidGrants'
import type { ConversationCompositionPorts } from '../host/compose/conversationDeps'
import type { createRuntimeAutoReviewer } from './features/autoReviewer'

export interface ExecRuntimeOptions {
  readonly isEphemeral: boolean
  readonly headlessPaid: HeadlessPaidPolicy
  readonly streamIdleMs: number
}

export interface RuntimeBackendDeps {
  readonly exec?: ExecRuntimeOptions
  readonly options: ServeOptions
  readonly version: string
  /** The folder holding the agent, backend, search and page-converter bundles. */
  readonly distDir: string
  readonly platform: NodeJS.Platform
  readonly env: NodeJS.ProcessEnv
  readonly homeDir: string
  readonly secrets: SecretStore
  readonly runGit: (args: readonly string[], cwd: string) => Promise<string>
  /**
   * The credential variables taken out of the agent's own environment at
   * start (credentialVariables.ts): handed back to Muse Code's processes
   * only, as the extension's `muse serve` inherits them (D1).
   */
  readonly museCodeCredentials: readonly EnvironmentVariable[]
  /** The Model API's transport. */
  readonly fetch: typeof fetch
  /** Waits between retries and rename attempts; injectable so tests do not sleep. */
  readonly sleep: (ms: number) => Promise<void>
  readonly log: Logger
  /** Interactive panel composition supplies this; ACP/headless keep their existing policy. */
  readonly checkpoints?: (workspaceRoot: string) => Promise<RuntimeCheckpoints>
  /** Absolute dirty-buffer paths, refreshed by the owning editor service. */
  readonly unsavedPaths?: (workspaceRoot: string) => readonly string[]
  /** Interactive editor verification; its portable owner drains it during profile release. */
  readonly verify?: (workspaceRoot: string) => ReturnType<typeof createRuntimeVerify>
  readonly hooks?: (workspaceRoot: string) => ReturnType<typeof createRuntimeHooks>
  readonly codeIntel?: (workspaceRoot: string) => ReturnType<typeof createRuntimeCodeIntel>
  readonly webFetch?: (
    workspaceRoot: string,
    fetchPage: WebFetcher,
  ) => ReturnType<typeof createRuntimeWebFetch>
  readonly browser?: (workspaceRoot: string) => ReturnType<typeof createRuntimeBrowser>
  readonly mcp?: (
    workspaceRoot: string,
    newPool: McpPoolFactory,
  ) => McpToolSource | Promise<McpToolSource>
  readonly schedules?: (workspaceRoot: string) => ScheduleStore
  readonly hookSettings?: {
    readonly path: (workspaceRoot: string) => string
    readonly isEnabled: (workspaceRoot: string) => boolean
  }
  /** Live interactive trust; the launch flag remains the upper bound for ACP/headless. */
  readonly isWorkspaceTrusted?: (workspaceRoot: string) => boolean
  readonly interactivePaid?: RuntimePaidUse
  readonly reservePaidRequest?: NonNullable<ModelApiClientDeps['reservePaidRequest']>
  readonly paidResponseCost?: NonNullable<ModelApiClientDeps['paidResponseCost']>
  readonly paidUsage?: PaidUsage
  readonly autoReviewer?: (root: string) => ReturnType<typeof createRuntimeAutoReviewer>
}

export interface RuntimeBackend {
  readonly backend: AcpBackend
  /** Muse Code's launch and environment, for `login`. */
  readonly museCode: MuseCodeBackendManager
  /** The flagged paid features and their questions, shared with the agent (M63c, M58). */
  readonly paid: AcpPaidUse
  readonly paidFor?: (root: string, surfaceId: string) => ConversationCompositionPorts['paid']
  readonly modelApiFor?: (root: string) => Promise<ModelApiBackendManager>
  readonly autoReviewerFor?: (root: string) => ReturnType<typeof createRuntimeAutoReviewer>
  /**
   * At start: "always" lapses for a paid feature the Model API agent was
   * started without. A Muse Code agent has no paid flags, so it leaves the
   * grants to the Model API agent, which a user may run beside it.
   */
  readonly forgetUnflaggedGrants: () => Promise<void>
  readonly close: () => Promise<void>
  /** The same port and recorder used by this workspace's actual backend tools. */
  readonly checkpointsFor?: (workspaceRoot: string) => Promise<RuntimeCheckpoints>
  readonly verifyFor?: (workspaceRoot: string) => ReturnType<typeof createRuntimeVerify>
  readonly hooksFor?: (workspaceRoot: string) => ReturnType<typeof createRuntimeHooks>
  readonly codeIntelFor?: (workspaceRoot: string) => ReturnType<typeof createRuntimeCodeIntel>
  readonly webFetchFor?: (workspaceRoot: string) => ReturnType<typeof createRuntimeWebFetch>
  readonly browserFor?: (workspaceRoot: string) => ReturnType<typeof createRuntimeBrowser>
  readonly mcpSnapshotFor?: (workspaceRoot: string) => McpPoolSnapshot | undefined
}

// No editor proxy setting exists outside VS Code; the CLI reads the
// environment's HTTPS_PROXY and NO_PROXY as it inherits them.
const NO_EDITOR_PROXY: ProxySettings = { proxy: '', noProxy: [] }
function unpricedResponse(): undefined {
  return
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** ACP has no VS Code checkpoint store: record the independent-editor startup policy. */
function independentEditorStartupPolicy(log: Logger): Promise<void> {
  log.trace('ACP native startup is outside the VS Code checkpoint namespace and restore guarantee')
  return Promise.resolve()
}

function museCodeManager(deps: RuntimeBackendDeps, workspaceRoot: string | undefined) {
  const { options, log } = deps
  return new MuseCodeBackendManager({
    // This records the actual scope boundary; it does not certify a VS Code fence.
    beforeWorkspaceHostStart: () => independentEditorStartupPolicy(log),
    log,
    extensionVersion: deps.version,
    getConfiguredBinaryPath: () => options.museBinary,
    getEnvironmentVariables: () => deps.museCodeCredentials,
    workspaceRoot,
    getShellSandbox: () => options.shellSandbox,
    // No `--sandbox-network` (M56): Muse Code's default, or a managed policy's.
    getSandboxNetwork: () => SETTING_DEFAULTS.sandboxNetwork,
    userProfileDir: deps.env['USERPROFILE'],
    isWorkspaceTrusted: () =>
      options.trustWorkspace &&
      (workspaceRoot === undefined || deps.isWorkspaceTrusted?.(workspaceRoot) !== false),
    getProxySettings: () => NO_EDITOR_PROXY,
  })
}

/** Muse Code's config and data homes as `muse serve` sees them: its skills and its memory. */
interface MuseHomes {
  readonly xdgConfigHome: string | undefined
  readonly xdgDataHome: string | undefined
}

function modelApiManager(
  deps: RuntimeBackendDeps,
  credentials: CredentialStore,
  storedWorkspaceRoot: string,
  workspaceRoot: string,
  homes: MuseHomes,
  paid: AcpPaidUse,
  workspaceEdits: WorkspaceEdits,
  assertWorkspaceCurrent: () => void,
  checkpoints: RuntimeCheckpoints | undefined,
  verify: VerifyHooks | undefined,
  codeIntel: LanguageServiceHost | undefined,
  webFetch: WebFetcher | undefined,
  browserCheck: BrowserCheckHost | undefined,
): ModelApiBackendManager {
  const { options, log, platform } = deps
  const paidUsage = deps.exec === undefined ? deps.paidUsage : undefined
  const isWorkspaceTrusted = () =>
    options.trustWorkspace && deps.isWorkspaceTrusted?.(storedWorkspaceRoot) !== false
  const dataInput: DataFolderInput = { platform, env: deps.env, homeDir: deps.homeDir }
  const systemRoot = deps.env['SystemRoot']
  const warn = (message: string) => {
    log.warn(message)
  }
  const filesIn = (root: string) =>
    createWorkspaceFileLister({
      workspaceRoot: root,
      respectGitIgnore: () => SETTING_DEFAULTS.respectGitIgnore,
      isWorkspaceTrusted,
      runGit: deps.runGit,
      findFiles: () => walkFiles(root, MENTION_INDEX_LIMIT, log),
      log,
    })
  const listFiles = filesIn(workspaceRoot)
  const rawIo = createToolIo({
    platform,
    listFiles,
    systemRoot,
    // No credential variable reaches a tool's process (AGENTS.md rule 8).
    env: () => withoutKeyringRoutes(withoutCredentials(deps.env)),
    searchWorkerPath: path.join(deps.distDir, SEARCH_WORKER_FILE),
    log: warn,
    // The agent cannot see the editor's buffers (D62); the client's `fs/*` will (M63c).
    unsavedFiles: () => deps.unsavedPaths?.(storedWorkspaceRoot) ?? [],
    assertWorkspaceCurrent: () => {
      assertWorkspaceCurrent()
      if (!isWorkspaceTrusted()) throw new Error('MHP_WORKSPACE_RESTRICTED')
    },
    shellJobAssembly:
      platform === 'win32' && systemRoot !== undefined
        ? shellJobAssembly({
            storageDir: agentDataFolder(dataInput),
            systemRoot,
            // The job's C#, shipped in the package beside `dist/` (M56, PLAN.md D6).
            readJobSource: jobSourceReader(path.dirname(deps.distDir)),
            log: warn,
          })
        : undefined,
  })
  // Muse Code's memory (M49, PLAN.md D41), in the data home `muse serve` sees.
  const warnMemory = (message: string) => {
    warn(`Memory: ${message}`)
  }
  const memoryDeps = {
    platform,
    dataRoot: () =>
      memoryDataRoot({ platform, homeDir: deps.homeDir, xdgDataHome: homes.xdgDataHome }),
    workspaceRoot,
    systemPath,
    warn: warnMemory,
  }
  const checkpointedMemory =
    checkpoints === undefined
      ? undefined
      : createCheckpointedMemory(rawIo, checkpoints.port, {
          ...memoryDeps,
          captureGuard: () => assertWorkspaceCurrent,
        })
  const io = checkpoints === undefined ? rawIo : withCheckpointStorageGuard(rawIo, checkpoints.port)
  const memory =
    checkpointedMemory?.store ??
    new MemoryStore({
      ...memoryDeps,
      io: createMemoryIo(io, { warn: warnMemory, assertCanWrite: assertWorkspaceCurrent }),
    })
  const recorder =
    checkpoints === undefined || checkpointedMemory === undefined
      ? undefined
      : checkpoints.recording.recorder({
          io,
          memory: checkpointedMemory.turnWrites,
          workspaceRoot,
          canonicalPath,
          newId: randomUUID,
          log,
        })
  const store =
    deps.exec?.isEphemeral === true
      ? undefined
      : createFileSessionStore({
          directory: workspaceSessionsFolder(dataInput, storedWorkspaceRoot),
          log,
          retentionDays: () => SETTING_DEFAULTS.cleanupPeriodDays,
          now: () => Date.now(),
          sleep: deps.sleep,
        })
  // Snapshot copies are plain structured data. Keep their type/shape while
  // replacing every string leaf before a headless transcript reaches disk.
  const redactSnapshot = (value: unknown, literals: readonly string[]): void => {
    if (typeof value !== 'object' || value === null) return
    for (const [key, leaf] of Object.entries(value)) {
      if (typeof leaf === 'string') Reflect.set(value, key, redactSecrets(leaf, literals))
      else redactSnapshot(leaf, literals)
    }
  }
  const headlessStore =
    store === undefined
      ? undefined
      : {
          ...store,
          async save(snapshot: Parameters<typeof store.save>[0]) {
            const key = await deps.secrets.get(SECRET_KEYS.modelApiKey)
            const copy = structuredClone(snapshot)
            redactSnapshot(copy, key === undefined ? [] : [key])
            await store.save(copy)
          },
        }
  return new ModelApiBackendManager({
    log,
    getApiKey: () => credentials.getApiKey(),
    workspaceRoot,
    sessionWorkspaceRoot: storedWorkspaceRoot,
    assertWorkspaceCurrent,
    workspaceEdits,
    io,
    ...(verify !== undefined && { verify }),
    ...(codeIntel !== undefined && { codeIntel }),
    ...(checkpoints !== undefined && {
      beforeTurnRuns: (sessionId, turnId, top) =>
        prepareCheckpointTurn(checkpoints.port, recorder, sessionId, turnId, log, top),
      afterTurnRuns: (sessionId, turnId, end) =>
        finishCheckpointTurn(checkpoints.port, recorder, sessionId, turnId, end),
    }),
    listAttemptFiles: (attemptRoot) => filesIn(attemptRoot)(),
    contextIo: fileContextIo,
    webFetch:
      webFetch ??
      createWebFetcher(log, pageConverter(path.join(deps.distDir, PAGE_WORKER_FILE), log)),
    ...(browserCheck !== undefined && { browserCheck }),
    fetch: deps.fetch,
    ...(deps.exec === undefined &&
      deps.reservePaidRequest !== undefined && {
        reservePaidRequest: deps.reservePaidRequest,
        paidResponseCost: deps.paidResponseCost ?? unpricedResponse,
      }),
    ...(deps.exec !== undefined && { streamIdleMs: deps.exec.streamIdleMs }),
    newId: () => randomUUID(),
    now: () => Date.now(),
    sleep: deps.sleep,
    random: () => Math.random(),
    personalSkillsRoot: personalSkillsRoot({
      platform,
      homeDir: deps.homeDir,
      xdgConfigHome: homes.xdgConfigHome,
    }),
    personalAgentsRoot: personalAgentsRoot({
      platform,
      homeDir: deps.homeDir,
      xdgConfigHome: homes.xdgConfigHome,
    }),
    isConfidentialWorkspace: () => false,
    confirmContributorModel: () => Promise.resolve(options.allowsContributorModels),
    isWorkspaceTrusted,
    store: deps.exec === undefined ? store : headlessStore,
    ...(deps.exec === undefined && {
      ...(deps.schedules !== undefined && { scheduleStore: deps.schedules(storedWorkspaceRoot) }),
      ...(deps.mcp !== undefined && {
        createMcpServers: (_root, newPool) =>
          deps.mcp?.(storedWorkspaceRoot, newPool) ??
          Promise.reject(new Error('MHP_MCP_UNAVAILABLE')),
      }),
      ...(deps.hookSettings !== undefined && {
        hookSettingsPath: deps.hookSettings.path(storedWorkspaceRoot),
        isHooksEnabled: () => deps.hookSettings?.isEnabled(storedWorkspaceRoot) === true,
      }),
    }),
    describeEnvironment: () =>
      describeEnvironment({
        runGit: deps.runGit,
        workspaceRoot,
        isWorkspaceTrusted,
        log,
        now: () => Date.now(),
      }),
    describeAttemptEnvironment: (attemptRoot) =>
      describeEnvironment({
        runGit: deps.runGit,
        workspaceRoot: attemptRoot,
        isWorkspaceTrusted,
        log,
        now: () => Date.now(),
      }),
    isPaidFeatureOn: (feature) => paid.isOn(feature),
    notePaidUse: (feature, units) => {
      paid.noteUse(feature, units)
    },
    // The panel's default (M56); the agent has no setting for the longer retention.
    promptCacheRetention: () => SETTING_DEFAULTS.modelApiPromptCacheRetention,
    // M82's cap and reply line are VS Code settings; ACP exposes neither.
    sessionBudgetUsd: () => SETTING_DEFAULTS.modelApiSessionBudgetUsd,
    // D78 changes only VS Code's display default; ACP remains unchanged.
    showReplyUsage: () => false,
    // Each use asked in the editor's session (M58, PLAN.md D48). Child tasks
    // are paid (M48, D45) and the agent's paid features are its two flags
    // (D62), so `subagents` is never on here and every task is denied.
    allowsPaidUse: (request, requiresAsking, sessionId) =>
      paid.allows(storedWorkspaceRoot, sessionId, request, requiresAsking),
    isPaidUseRemembered: (feature) => paid.isRemembered(storedWorkspaceRoot, feature),
    noteSubagentUsage: (modelId, usage) => {
      if (paidUsage === undefined) {
        log.warn(`A subagent's usage on ${modelId} was reported, but the agent runs no subagents`)
      } else {
        paidUsage.addSubagentUsage(modelId, usage)
      }
    },
    noteReviewerUsage: (modelId, usage) => {
      if (paidUsage === undefined) {
        log.warn('An Auto reviewer reported usage, but the ACP agent runs no Auto reviewer')
      } else {
        paidUsage.addReviewerUsage(modelId, usage)
      }
    },
    memory,
    bundlePath: path.join(deps.distDir, MODEL_API_BUNDLE_FILE),
    // VS Code's settings do not reach the agent: a failed request names its
    // environment variables instead (PLAN.md D62, Q66), and a missing bundle
    // the agent's package, not the extension.
    networkAdvice: 'agent',
    bundleUnavailable: () => UI_TEXT.acpModelApiBundleUnavailable,
  })
}

/** The backend `--backend` names, its managers created per folder on first use. */
export function createRuntimeBackend(deps: RuntimeBackendDeps): RuntimeBackend {
  const museCode = museCodeManager(deps, undefined)
  const museCodeHosts = new Map<string, MuseCodeBackendManager>()
  const modelApiHosts = new Map<
    string,
    { readonly manager: ModelApiBackendManager; readonly identity: string }
  >()
  const workspaceEdits = new Map<string, WorkspaceEdits>()
  const checkpointHosts = new Map<string, Promise<RuntimeCheckpoints>>()
  const checkpointFactory = deps.exec === undefined ? deps.checkpoints : undefined
  const verifyHosts = new Map<string, ReturnType<typeof createRuntimeVerify>>()
  const verifyFactory = deps.exec === undefined ? deps.verify : undefined
  const hookHosts = new Map<string, ReturnType<typeof createRuntimeHooks>>()
  const hookFactory = deps.exec === undefined ? deps.hooks : undefined
  const codeIntelHosts = new Map<string, ReturnType<typeof createRuntimeCodeIntel>>()
  const codeIntelFactory = deps.exec === undefined ? deps.codeIntel : undefined
  const webFetchHosts = new Map<string, ReturnType<typeof createRuntimeWebFetch>>()
  const webFetchFactory = deps.exec === undefined ? deps.webFetch : undefined
  const browserHosts = new Map<string, ReturnType<typeof createRuntimeBrowser>>()
  const browserFactory = deps.exec === undefined ? deps.browser : undefined
  const reviewerHosts = new Map<string, ReturnType<typeof createRuntimeAutoReviewer>>()
  const reviewerFactory = deps.exec === undefined ? deps.autoReviewer : undefined
  let isDisposed = false
  let closing: Promise<void> | undefined
  const assertOpen = () => {
    if (isDisposed) throw new Error('MHP_RUNTIME_CLOSED')
  }
  const autoReviewerFor = (root: string) => {
    assertOpen()
    if (reviewerFactory === undefined) throw new Error('MHP_AUTO_REVIEWER_UNAVAILABLE')
    const service = reviewerHosts.get(root) ?? reviewerFactory(root)
    reviewerHosts.set(root, service)
    return service
  }
  const verifyFor = (root: string) => {
    assertOpen()
    if (verifyFactory === undefined) throw new Error('MHP_VERIFY_UNAVAILABLE')
    const service = verifyHosts.get(root) ?? verifyFactory(root)
    verifyHosts.set(root, service)
    return service
  }
  const hooksFor = (root: string) => {
    assertOpen()
    if (hookFactory === undefined) throw new Error('MHP_HOOKS_UNAVAILABLE')
    const service = hookHosts.get(root) ?? hookFactory(root)
    hookHosts.set(root, service)
    return service
  }
  const codeIntelFor = (root: string) => {
    assertOpen()
    if (codeIntelFactory === undefined) throw new Error('MHP_CODE_INTEL_UNAVAILABLE')
    const service = codeIntelHosts.get(root) ?? codeIntelFactory(root)
    codeIntelHosts.set(root, service)
    return service
  }
  const webFetchFor = (root: string) => {
    assertOpen()
    if (webFetchFactory === undefined) throw new Error('MHP_WEB_FETCH_UNAVAILABLE')
    const service =
      webFetchHosts.get(root) ??
      webFetchFactory(
        root,
        createWebFetcher(
          deps.log,
          pageConverter(path.join(deps.distDir, PAGE_WORKER_FILE), deps.log),
        ),
      )
    webFetchHosts.set(root, service)
    return service
  }
  const browserFor = (root: string) => {
    assertOpen()
    if (browserFactory === undefined) throw new Error('MHP_BROWSER_UNAVAILABLE')
    const service = browserHosts.get(root) ?? browserFactory(root)
    browserHosts.set(root, service)
    return service
  }
  const checkpointsFor = async (root: string): Promise<RuntimeCheckpoints> => {
    assertOpen()
    if (checkpointFactory === undefined) throw new Error('MHP_CHECKPOINT_NAMESPACE_UNAVAILABLE')
    let pending = checkpointHosts.get(root)
    if (pending === undefined) {
      pending = checkpointFactory(root)
      checkpointHosts.set(root, pending)
    }
    let services: RuntimeCheckpoints
    try {
      services = await pending
    } catch (error: unknown) {
      if (checkpointHosts.get(root) === pending) checkpointHosts.delete(root)
      throw error
    }
    assertOpen()
    return services
  }
  const credentials = new CredentialStore(
    deps.secrets,
    (message) => {
      deps.log.warn(message)
    },
    "the operating system's credential store",
  )
  const paid =
    (deps.exec === undefined ? deps.interactivePaid : undefined) ??
    new AcpPaidUse({
      flagged: deps.options.paidFeatures,
      canRemember: () => deps.options.trustWorkspace,
      grants: paidGrantFile({
        file: paidGrantsFile({ platform: deps.platform, env: deps.env, homeDir: deps.homeDir }),
        log: deps.log,
        sleep: deps.sleep,
      }),
      log: deps.log,
      ...(deps.exec !== undefined && { headless: deps.exec.headlessPaid }),
    })
  const museEnvironment = museCode.childEnvironment()
  const homes: MuseHomes = {
    xdgConfigHome: environmentValue(museEnvironment, deps.platform, 'XDG_CONFIG_HOME'),
    xdgDataHome: environmentValue(museEnvironment, deps.platform, 'XDG_DATA_HOME'),
  }

  // Muse Code's account methods on a short-lived host of their own, as the
  // panel asks them (PR #49): `account/read` when the file cannot say.
  const accountHosts = new AccountHosts(
    (signal) => connectAccountSession(museCode, deps.version, deps.log, undefined, signal),
    deps.log,
  )
  const cliAccount = new CliAccount({
    platform: deps.platform,
    credentialFilePath: () => museCode.credentialFilePath(),
    probe: () => accountHosts.probe(),
    log: deps.log,
  })

  /**
   * Muse Code's readiness, as the panel's sign-in gate counts it (D26):
   * `META_API_KEY` in the CLI's environment (with it `muse serve` starts
   * whatever the file says), or the CLI's own sign-in from the file's
   * structure, asked of the CLI where only it can say. `authenticate`, the
   * user saying they signed in, is the agent's user action, as the panel's
   * Check again is: it forgets what the CLI said before and may ask on
   * macOS, where a question can read the Keychain. A session or a list is
   * not: on macOS it takes the file's word or the panel's passive estimate
   * (a turn's `authRequired` corrects it) rather than start `muse serve`
   * each time. A macOS file on Windows or Linux stops `muse serve`, so it is
   * said as such.
   */
  const museCodeReadiness = async (isRecheck: boolean): Promise<BackendReadiness> => {
    const resolution = museCode.resolveLaunch()
    if (!resolution.ok) {
      return {
        state: 'unavailable',
        message: `${resolution.reason} ${fill(UI_TEXT.cliSearched, { paths: resolution.searched.join(', ') })}`,
      }
    }
    if (museCode.hasEnvironmentKey()) {
      return { state: 'ready' }
    }
    if (isRecheck) {
      cliAccount.forgetAnswers()
    }
    const signIn: CliSignIn = await cliAccount.signIn(isRecheck)
    if (signIn === 'unsupportedHere') {
      return {
        state: 'unavailable',
        message: fill(UI_TEXT.cliCredentialUnsupported, { path: museCode.credentialFilePath() }),
      }
    }
    return isCliSignedIn(signIn)
      ? { state: 'ready' }
      : { state: 'signedOut', message: UI_TEXT.acpMuseCodeSignedOut }
  }

  const modelApiReadiness = async (): Promise<BackendReadiness> => {
    let key: string | undefined
    try {
      key = await deps.secrets.get(SECRET_KEYS.modelApiKey)
    } catch (error: unknown) {
      return {
        state: 'unavailable',
        message: fill(UI_TEXT.acpStoreUnavailable, { reason: describe(error) }),
      }
    }
    return key === undefined || key === ''
      ? { state: 'signedOut', message: UI_TEXT.acpNoStoredKey }
      : { state: 'ready' }
  }

  const modelApiManagerFor = async (cwd: string): Promise<ModelApiBackendManager> => {
    const identity = await captureWorkspaceIdentity(cwd)
    if (identity === undefined) {
      throw new Error(UI_TEXT.modelApiNeedsFolder)
    }
    const { canonical, key } = identity
    const checkpoints = checkpointFactory === undefined ? undefined : await checkpointsFor(cwd)
    assertOpen()
    const existing = modelApiHosts.get(cwd)
    if (existing !== undefined) {
      if (existing.identity !== key) {
        throw new Error(FILE_REFUSAL_MODEL_TEXT.pathChangedAfterApproval)
      }
      return existing.manager
    }
    const assertWorkspaceCurrent = () => {
      assertOpen()
      if (!identity.isCurrent()) {
        throw new Error(FILE_REFUSAL_MODEL_TEXT.pathChangedAfterApproval)
      }
    }
    const edits = workspaceEdits.get(key) ?? new WorkspaceEdits()
    workspaceEdits.set(key, edits)
    const manager = modelApiManager(
      deps,
      credentials,
      cwd,
      canonical,
      homes,
      paid,
      edits,
      assertWorkspaceCurrent,
      checkpoints,
      verifyFactory === undefined ? undefined : verifyFor(cwd).verify,
      codeIntelFactory === undefined ? undefined : codeIntelFor(cwd).service,
      webFetchFactory === undefined ? undefined : webFetchFor(cwd).fetchPage,
      browserFactory === undefined ? undefined : browserFor(cwd).host,
    )
    modelApiHosts.set(cwd, { manager, identity: key })
    return manager
  }

  const hostFor = async (cwd: string): Promise<AgentHost> => {
    assertOpen()
    if (deps.options.backend === 'modelApi') {
      const manager = await modelApiManagerFor(cwd)
      return await manager.ensureHost()
    }
    if (checkpointFactory !== undefined) {
      const checkpoints = await checkpointsFor(cwd)
      await checkpoints.port.markNativeBackend()
      assertOpen()
    }
    const manager = museCodeHosts.get(cwd) ?? museCodeManager(deps, cwd)
    museCodeHosts.set(cwd, manager)
    return await manager.ensureHost()
  }

  return {
    backend: {
      kind: deps.options.backend,
      readiness: (isRecheck) =>
        deps.options.backend === 'modelApi' ? modelApiReadiness() : museCodeReadiness(isRecheck),
      hostFor,
    },
    museCode,
    paid,
    ...(reviewerFactory !== undefined && { autoReviewerFor }),
    ...(deps.exec === undefined &&
      deps.interactivePaid !== undefined && {
        paidFor: (root: string, surfaceId: string) => {
          assertOpen()
          if (deps.interactivePaid === undefined) throw new Error('MHP_PAID_POLICY_UNAVAILABLE')
          return deps.interactivePaid.composition(root, surfaceId)
        },
        modelApiFor: modelApiManagerFor,
      }),
    ...(checkpointFactory !== undefined && { checkpointsFor }),
    ...(verifyFactory !== undefined && { verifyFor }),
    ...(hookFactory !== undefined && { hooksFor }),
    ...(codeIntelFactory !== undefined && { codeIntelFor }),
    ...(webFetchFactory !== undefined && { webFetchFor }),
    ...(browserFactory !== undefined && { browserFor }),
    ...(deps.exec === undefined &&
      deps.mcp !== undefined && {
        mcpSnapshotFor: (root: string) => modelApiHosts.get(root)?.manager.mcpSnapshot(),
      }),
    forgetUnflaggedGrants: () =>
      deps.exec === undefined && deps.options.backend === 'modelApi'
        ? paid.forgetUnflagged()
        : Promise.resolve(),
    close: () => {
      isDisposed = true
      closing ??= (async () => {
        // A probe still waiting on its short-lived host ends with the agent.
        accountHosts.close()
        const checking = Promise.allSettled([
          ...Array.from(reviewerHosts.values(), (service) => service.dispose()),
          ...Array.from(verifyHosts.values(), (service) => service.dispose()),
          ...Array.from(hookHosts.values(), (service) => service.dispose()),
          ...Array.from(codeIntelHosts.values(), (service) => service.dispose()),
          ...Array.from(webFetchHosts.values(), (service) => service.dispose()),
          ...Array.from(browserHosts.values(), (service) => service.dispose()),
          ...(deps.exec === undefined && deps.interactivePaid !== undefined
            ? [deps.interactivePaid.dispose()]
            : []),
        ])
        const managers = [
          ...museCodeHosts.values(),
          ...Array.from(modelApiHosts.values(), ({ manager }) => manager),
        ]
        const stopped = await Promise.allSettled(managers.map((manager) => manager.dispose()))
        const verified = await checking
        verifyHosts.clear()
        hookHosts.clear()
        codeIntelHosts.clear()
        webFetchHosts.clear()
        browserHosts.clear()
        reviewerHosts.clear()
        const released = await Promise.allSettled(
          Array.from(checkpointHosts.values(), async (pending) => {
            const services = await pending
            await services.dispose()
          }),
        )
        checkpointHosts.clear()
        const failures = [...stopped, ...verified, ...released].filter(
          (result) => result.status === 'rejected',
        )
        if (failures.length > 0)
          throw new AggregateError(
            failures.map((result): unknown => result.reason),
            'MHP_RUNTIME_CLOSE_FAILED',
          )
      })()
      return closing
    },
  }
}
