// The ACP agent's backend (PLAN.md D62): the panel's backend managers,
// given in this process what VS Code gives them in the extension, one per
// workspace folder. Muse Code signs in on its own and the subscription
// pays; the Model API backend reads the key from the OS credential store
// (D61). Paid features are off (D60), and nothing here sees an editor's
// unsaved buffers until file access goes through the client (M63c).

import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { AcpBackend, BackendReadiness } from '../acp/agent'
import { AcpPaidFeatures } from '../acp/paid'
import type { AgentHost } from '../core/agent/agentBackend'
import { environmentValue } from '../core/backends/musecode/launch'
import { personalSkillsRoot } from '../core/context/skills'
import { fileContextIo } from '../host/backend/contextIo'
import { describeEnvironment } from '../host/backend/environment'
import { createFileSessionStore } from '../host/backend/fileSessionStore'
import { ModelApiBackendManager } from '../host/backend/modelApiBackendManager'
import { MuseCodeBackendManager, type ProxySettings } from '../host/backend/museCodeBackendManager'
import { shellJobAssembly } from '../host/backend/shellJob'
import { createToolIo } from '../host/backend/toolIo'
import { CredentialStore, type SecretStore } from '../host/auth/credentialStore'
import type { Logger } from '../host/logger'
import { createWorkspaceFileLister } from '../host/mention/workspaceFiles'
import {
  MENTION_INDEX_LIMIT,
  SEARCH_WORKER_FILE,
  SECRET_KEYS,
  SETTING_DEFAULTS,
  UI_TEXT,
} from '../shared/constants'
import { fill } from '../shared/l10n/text'
import type { ServeOptions } from './cliArgs'
import { agentDataFolder, type DataFolderInput, workspaceSessionsFolder } from './dataFolder'
import { walkFiles } from './fileWalk'

export interface RuntimeBackendDeps {
  readonly options: ServeOptions
  readonly version: string
  /** The folder holding `acp.js` and `searchWorker.js`. */
  readonly distDir: string
  readonly platform: NodeJS.Platform
  readonly env: NodeJS.ProcessEnv
  readonly homeDir: string
  readonly secrets: SecretStore
  readonly runGit: (args: readonly string[], cwd: string) => Promise<string>
  /** The Model API's transport. */
  readonly fetch: typeof fetch
  readonly log: Logger
}

export interface RuntimeBackend {
  readonly backend: AcpBackend
  /** Muse Code's launch and environment, for `login`. */
  readonly museCode: MuseCodeBackendManager
  /** The flagged paid features and the user's answers, shared with the agent (M63c). */
  readonly paid: AcpPaidFeatures
  readonly close: () => Promise<void>
}

// No editor proxy setting exists outside VS Code; the CLI reads the
// environment's HTTPS_PROXY and NO_PROXY as it inherits them.
const NO_EDITOR_PROXY: ProxySettings = { proxy: '', noProxy: [] }

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function museCodeManager(deps: RuntimeBackendDeps, workspaceRoot: string | undefined) {
  const { options, log } = deps
  return new MuseCodeBackendManager({
    log,
    extensionVersion: deps.version,
    getConfiguredBinaryPath: () => options.museBinary,
    getEnvironmentVariables: () => [],
    workspaceRoot,
    getShellSandbox: () => options.shellSandbox,
    userProfileDir: deps.env['USERPROFILE'],
    isWorkspaceTrusted: () => options.trustWorkspace,
    getProxySettings: () => NO_EDITOR_PROXY,
  })
}

function modelApiManager(
  deps: RuntimeBackendDeps,
  credentials: CredentialStore,
  workspaceRoot: string,
  xdgConfigHome: string | undefined,
  paid: AcpPaidFeatures,
): ModelApiBackendManager {
  const { options, log, platform } = deps
  const isWorkspaceTrusted = () => options.trustWorkspace
  const dataInput: DataFolderInput = { platform, env: deps.env, homeDir: deps.homeDir }
  const systemRoot = deps.env['SystemRoot']
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
    env: () => deps.env,
    searchWorkerPath: path.join(deps.distDir, SEARCH_WORKER_FILE),
    log: (message) => {
      log.warn(message)
    },
    // The agent cannot see the editor's buffers (D62); the client's `fs/*` will (M63c).
    hasUnsavedChanges: () => false,
    shellJobAssembly:
      platform === 'win32' && systemRoot !== undefined
        ? shellJobAssembly({
            storageDir: agentDataFolder(dataInput),
            systemRoot,
            log: (message) => {
              log.warn(message)
            },
          })
        : undefined,
  })
  return new ModelApiBackendManager({
    log,
    getApiKey: () => credentials.getApiKey(),
    workspaceRoot,
    io,
    contextIo: fileContextIo,
    fetch: deps.fetch,
    newId: () => randomUUID(),
    now: () => Date.now(),
    sleep,
    random: () => Math.random(),
    personalSkillsRoot: personalSkillsRoot({ platform, homeDir: deps.homeDir, xdgConfigHome }),
    isWorkspaceTrusted,
    store: createFileSessionStore({
      directory: workspaceSessionsFolder(dataInput, workspaceRoot),
      log,
      retentionDays: () => SETTING_DEFAULTS.cleanupPeriodDays,
      now: () => Date.now(),
      sleep,
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
  })
}

/** The backend `--backend` names, its managers created per folder on first use. */
export function createRuntimeBackend(deps: RuntimeBackendDeps): RuntimeBackend {
  const museCode = museCodeManager(deps, undefined)
  const museCodeHosts = new Map<string, MuseCodeBackendManager>()
  const modelApiHosts = new Map<string, ModelApiBackendManager>()
  const credentials = new CredentialStore(deps.secrets, (message) => {
    deps.log.warn(message)
  })
  const paid = new AcpPaidFeatures(deps.options.paidFeatures, deps.log)
  const xdgConfigHome = environmentValue(
    museCode.childEnvironment(),
    deps.platform,
    'XDG_CONFIG_HOME',
  )

  const museCodeReadiness = (): BackendReadiness => {
    const resolution = museCode.resolveLaunch()
    if (!resolution.ok) {
      return {
        state: 'unavailable',
        message: `${resolution.reason} ${fill(UI_TEXT.cliSearched, { paths: resolution.searched.join(', ') })}`,
      }
    }
    return museCode.credentialFileExists() || museCode.hasEnvironmentKey()
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

  const hostFor = (cwd: string): Promise<AgentHost> => {
    if (deps.options.backend === 'modelApi') {
      const manager =
        modelApiHosts.get(cwd) ?? modelApiManager(deps, credentials, cwd, xdgConfigHome, paid)
      modelApiHosts.set(cwd, manager)
      return manager.ensureHost()
    }
    const manager = museCodeHosts.get(cwd) ?? museCodeManager(deps, cwd)
    museCodeHosts.set(cwd, manager)
    return manager.ensureHost()
  }

  return {
    backend: {
      kind: deps.options.backend,
      readiness: () =>
        deps.options.backend === 'modelApi'
          ? modelApiReadiness()
          : Promise.resolve(museCodeReadiness()),
      hostFor,
    },
    museCode,
    paid,
    close: async () => {
      const managers = [...museCodeHosts.values(), ...modelApiHosts.values()]
      await Promise.all(managers.map((manager) => manager.dispose()))
    },
  }
}
