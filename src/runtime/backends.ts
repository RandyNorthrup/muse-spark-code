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
import { statSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { AcpBackend, BackendReadiness } from '../acp/agent'
import { AcpPaidUse } from '../acp/paid'
import type { AgentHost } from '../core/agent/agentBackend'
import type { CliSignIn } from '../core/backends/musecode/credentialFile'
import { environmentValue } from '../core/backends/musecode/launch'
import { personalSkillsRoot } from '../core/context/skills'
import { memoryDataRoot } from '../core/memory/memoryLocation'
import { MemoryStore } from '../core/memory/memoryStore'
import { WorkspaceEdits } from '../core/verify/workspaceEdits'
import { canonicalPath } from '../host/canonicalPath'
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
import {
  type EnvironmentVariable,
  MENTION_INDEX_LIMIT,
  MODEL_API_BUNDLE_FILE,
  MODEL_TEXT,
  PAGE_WORKER_FILE,
  SEARCH_WORKER_FILE,
  SECRET_KEYS,
  SETTING_DEFAULTS,
  UI_TEXT,
  WORKSPACE_IDENTITY_ZERO,
} from '../shared/constants'
import { fill } from '../shared/l10n/text'
import type { ServeOptions } from './cliArgs'
import {
  agentDataFolder,
  type DataFolderInput,
  paidGrantsFile,
  workspaceSessionsFolder,
} from './dataFolder'
import { withoutCredentials } from './credentialVariables'
import { walkFiles } from './fileWalk'
import { paidGrantFile } from './paidGrants'

export interface RuntimeBackendDeps {
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
}

export interface RuntimeBackend {
  readonly backend: AcpBackend
  /** Muse Code's launch and environment, for `login`. */
  readonly museCode: MuseCodeBackendManager
  /** The flagged paid features and their questions, shared with the agent (M63c, M58). */
  readonly paid: AcpPaidUse
  /**
   * At start: "always" lapses for a paid feature the Model API agent was
   * started without. A Muse Code agent has no paid flags, so it leaves the
   * grants to the Model API agent, which a user may run beside it.
   */
  readonly forgetUnflaggedGrants: () => Promise<void>
  readonly close: () => Promise<void>
}

// No editor proxy setting exists outside VS Code; the CLI reads the
// environment's HTTPS_PROXY and NO_PROXY as it inherits them.
const NO_EDITOR_PROXY: ProxySettings = { proxy: '', noProxy: [] }

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function museCodeManager(deps: RuntimeBackendDeps, workspaceRoot: string | undefined) {
  const { options, log } = deps
  return new MuseCodeBackendManager({
    log,
    extensionVersion: deps.version,
    getConfiguredBinaryPath: () => options.museBinary,
    getEnvironmentVariables: () => deps.museCodeCredentials,
    workspaceRoot,
    getShellSandbox: () => options.shellSandbox,
    // No `--sandbox-network` (M56): Muse Code's default, or a managed policy's.
    getSandboxNetwork: () => SETTING_DEFAULTS.sandboxNetwork,
    userProfileDir: deps.env['USERPROFILE'],
    isWorkspaceTrusted: () => options.trustWorkspace,
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
): ModelApiBackendManager {
  const { options, log, platform } = deps
  const isWorkspaceTrusted = () => options.trustWorkspace
  const dataInput: DataFolderInput = { platform, env: deps.env, homeDir: deps.homeDir }
  const systemRoot = deps.env['SystemRoot']
  const warn = (message: string) => {
    log.warn(message)
  }
  const listFiles = createWorkspaceFileLister({
    workspaceRoot,
    respectGitIgnore: () => SETTING_DEFAULTS.respectGitIgnore,
    isWorkspaceTrusted,
    runGit: deps.runGit,
    findFiles: () => walkFiles(workspaceRoot, MENTION_INDEX_LIMIT, log),
    log,
  })
  const io = createToolIo({
    platform,
    listFiles,
    systemRoot,
    // No credential variable reaches a tool's process (AGENTS.md rule 8).
    env: () => withoutCredentials(deps.env),
    searchWorkerPath: path.join(deps.distDir, SEARCH_WORKER_FILE),
    log: warn,
    // The agent cannot see the editor's buffers (D62); the client's `fs/*` will (M63c).
    unsavedFiles: () => [],
    assertWorkspaceCurrent,
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
  const memory = new MemoryStore({
    io: createMemoryIo(io, { warn: warnMemory, assertCanWrite: assertWorkspaceCurrent }),
    platform,
    dataRoot: () =>
      memoryDataRoot({ platform, homeDir: deps.homeDir, xdgDataHome: homes.xdgDataHome }),
    workspaceRoot,
    systemPath,
    warn: warnMemory,
  })
  return new ModelApiBackendManager({
    log,
    getApiKey: () => credentials.getApiKey(),
    workspaceRoot,
    sessionWorkspaceRoot: storedWorkspaceRoot,
    assertWorkspaceCurrent,
    workspaceEdits,
    io,
    contextIo: fileContextIo,
    webFetch: createWebFetcher(log, pageConverter(path.join(deps.distDir, PAGE_WORKER_FILE), log)),
    fetch: deps.fetch,
    newId: () => randomUUID(),
    now: () => Date.now(),
    sleep: deps.sleep,
    random: () => Math.random(),
    personalSkillsRoot: personalSkillsRoot({
      platform,
      homeDir: deps.homeDir,
      xdgConfigHome: homes.xdgConfigHome,
    }),
    isWorkspaceTrusted,
    store: createFileSessionStore({
      directory: workspaceSessionsFolder(dataInput, storedWorkspaceRoot),
      log,
      retentionDays: () => SETTING_DEFAULTS.cleanupPeriodDays,
      now: () => Date.now(),
      sleep: deps.sleep,
    }),
    describeEnvironment: () =>
      describeEnvironment({
        runGit: deps.runGit,
        workspaceRoot,
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
    // Each use asked in the editor's session (M58, PLAN.md D48). Child tasks
    // are paid (M48, D45) and the agent's paid features are its two flags
    // (D62), so `subagents` is never on here and every task is denied.
    allowsPaidUse: (request, requiresAsking, sessionId) =>
      paid.allows(storedWorkspaceRoot, sessionId, request, requiresAsking),
    isPaidUseRemembered: (feature) => paid.isRemembered(storedWorkspaceRoot, feature),
    noteSubagentUsage: (modelId) => {
      log.warn(`A subagent's usage on ${modelId} was reported, but the agent runs no subagents`)
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
  const credentials = new CredentialStore(
    deps.secrets,
    (message) => {
      deps.log.warn(message)
    },
    "the operating system's credential store",
  )
  const paid = new AcpPaidUse({
    flagged: deps.options.paidFeatures,
    canRemember: () => deps.options.trustWorkspace,
    grants: paidGrantFile({
      file: paidGrantsFile({ platform: deps.platform, env: deps.env, homeDir: deps.homeDir }),
      log: deps.log,
      sleep: deps.sleep,
    }),
    log: deps.log,
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

  const modelApiHostFor = async (cwd: string): Promise<AgentHost> => {
    const canonical = await canonicalPath(cwd)
    const identity = await stat(canonical, { bigint: true })
    if (
      !identity.isDirectory() ||
      identity.ino <= WORKSPACE_IDENTITY_ZERO ||
      identity.dev < WORKSPACE_IDENTITY_ZERO
    ) {
      throw new Error(UI_TEXT.modelApiNeedsFolder)
    }
    const key = `${identity.dev.toString()}:${identity.ino.toString()}`
    const existing = modelApiHosts.get(cwd)
    if (existing !== undefined) {
      if (existing.identity !== key) {
        throw new Error(MODEL_TEXT.pathChangedAfterApproval)
      }
      return await existing.manager.ensureHost()
    }
    const assertWorkspaceCurrent = () => {
      try {
        for (const root of [cwd, canonical]) {
          const current = statSync(root, { bigint: true })
          if (
            !current.isDirectory() ||
            current.dev !== identity.dev ||
            current.ino !== identity.ino
          ) {
            throw new Error(MODEL_TEXT.pathChangedAfterApproval)
          }
        }
      } catch {
        throw new Error(MODEL_TEXT.pathChangedAfterApproval)
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
    )
    modelApiHosts.set(cwd, { manager, identity: key })
    return await manager.ensureHost()
  }

  const hostFor = (cwd: string): Promise<AgentHost> => {
    if (deps.options.backend === 'modelApi') {
      return modelApiHostFor(cwd)
    }
    const manager = museCodeHosts.get(cwd) ?? museCodeManager(deps, cwd)
    museCodeHosts.set(cwd, manager)
    return manager.ensureHost()
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
    forgetUnflaggedGrants: () =>
      deps.options.backend === 'modelApi' ? paid.forgetUnflagged() : Promise.resolve(),
    close: async () => {
      // A probe still waiting on its short-lived host ends with the agent.
      accountHosts.close()
      const managers = [
        ...museCodeHosts.values(),
        ...Array.from(modelApiHosts.values(), ({ manager }) => manager),
      ]
      await Promise.all(managers.map((manager) => manager.dispose()))
    },
  }
}
