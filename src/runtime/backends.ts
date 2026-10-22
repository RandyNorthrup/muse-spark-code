import { UserRefusalError } from '../shared/refusal'
import type { ScheduleBillingPorts } from '../host/schedules/paidBinding'
import type { ScheduleCallerContext } from './schedules/args'
import { runtimeConverterPath } from './runtimeConverterPath'
import { sumUsd } from '../shared/usd'
import { providersFilePath } from './providerPaths'
import { ModelApiClient } from '../core/backends/modelapi/client'
import { failureForLog } from '../core/backends/musecode/logText'
import type { ModelPolicy } from '../core/backends/modelapi/modelPolicy'
import type * as RuntimeAccountingEntry from './runtimeAccountingEntry'
import type { ProviderClient } from '../core/backends/modelapi/client'
import type { runtimeSubscriptionClient } from './chatGptProviderCommands'
import type * as ConfiguredProvidersEntry from '../host/backend/configuredProvidersEntry'

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

import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { AcpBackend, BackendReadiness } from '../acp/agent'
import type { AgentHost } from '../core/agent/agentBackend'
import type { CliSignIn } from '../core/backends/musecode/credentialFile'
import {
  checkScheduleOwnCap,
  paidExtraAdmission,
  passthroughSpendClaim,
} from '../core/paid/spendClaim'
import type { UsageRecording } from '../core/usage/recording'
import type { UsageBudgetRead } from '../core/usage/usageService'
import { SubscriptionCredential } from '../host/auth/subscriptionCredential'
import {
  SubscriptionKeySource,
  subscriptionKeyRefusal,
} from '../core/backends/modelapi/subscriptionKey'
import type { Logger } from '../host/logger'
import {
  FILE_REFUSAL_MODEL_TEXT,
  MENTION_INDEX_LIMIT,
  MODEL_API_BASE_URL,
  MODEL_API_BUNDLE_FILE,
  MODEL_API_UPLOADS_DIR,
  MEDIA_PRIVATE_ROOT_DIR,
  MUSE_CODE_BUNDLE_FILE,
  PAGE_WORKER_FILE,
  SEARCH_WORKER_FILE,
  SECRET_KEYS,
  PROVIDER_SECRET_PREFIX,
  PAID_PRICES_USD,
  PROVIDERS_CONFIG_DIR_NAME,
  PROVIDERS_FILE_NAME,
  IS_AUTO_COMPACTION_EVALUATED,
  SETTING_DEFAULTS,
  UI_TEXT,
} from '../shared/constants'
import { COMPANION_VOICE_RELEASE } from '../shared/companionVoice'
import type { ServeOptions } from './cliArgs'
import {
  agentDataFolder,
  type DataFolderInput,
  paidGrantsFile,
  workspaceSessionsFolder,
} from './dataFolder'
import {
  museCodeEnvironment,
  withoutCredentials,
  withoutKeyringRoutes,
} from './credentialVariables'
import { isStoreUnavailable, StoreUnavailableError } from './keyStore'
import { isPlanModelRef } from '../shared/providerRouting'
import { providersFile } from '../host/backend/providersEntry'

import type { AssembledProviderRun } from './exec/providerExec'
import { type GuardedChildEnv, NO_WORKSPACE } from '../core/executables'
import { withLoopbackBypass } from '../core/backends/musecode/launch'
import { buildChildEnvironment, environmentValue } from '../core/execGuard'
import { createToolIo } from '../host/backend/toolIo'
import { resolveExecOutputCap } from './exec/runLedger'
import { Usd } from '../shared/usd'
import { loadLegalScanner } from './legal/legalScanner'
import { existsSync, realpathSync } from 'node:fs'
import { accountErrorText, isInvalidProvidersFileError } from '../acp/accountText'
import { AcpPaidUse, type HeadlessPaidPolicy } from '../acp/paid'
import { personalSkillsRoot } from '../core/context/skills'
import { personalAgentsRoot } from '../core/context/customAgents'
import { memoryDataRoot } from '../core/memory/memoryLocation'
import { MemoryStore } from '../core/memory/memoryStore'
import { WorkspaceEdits } from '../core/verify/workspaceEdits'
import { redactSecrets } from '../core/redact'
import { recordPaidUse } from '../core/paid/paidFeatures'
import { fileContextIo } from '../host/backend/contextIo'
import { describeEnvironment } from '../host/backend/environment'
import { createFileSessionStore } from '../host/backend/fileSessionStore'
import type { SessionStore } from '../core/backends/modelapi/sessionStore'
import { jobSourceReader } from '../host/backend/jobSource'
import { createMemoryIo, systemPath } from '../host/backend/memoryIo'
import { ModelApiBackendManager } from '../host/backend/modelApiBackendManager'
import { MuseCodeBackendManager, type ProxySettings } from '../host/backend/museCodeBackendManager'
import { shellJobAssembly } from '../host/backend/shellJob'
import { mcpJobExecutable } from '../host/backend/mcpJobExecutable'
import type { ToolIo } from '../core/backends/modelapi/tools'
import type { AcpMediaFactory } from '../acp/media'
import type { AcpUploadsPort } from '../acp/uploads'
import { createUploadedFilesPort } from '../core/media/uploadedFiles'
import type { UploadLedger } from '../core/media/uploadLedger'
import type { AttachedMedia, AttachedMediaPort } from '../core/media/attachedMedia'
import { lazyAttachedMedia } from '../core/media/attachedMediaPort'
import type * as RuntimeMediaEntry from './runtimeMediaEntry'
import { AccountHosts, connectAccountSession } from '../host/auth/accountHost'
import { CliAccount, isCliSignedIn } from '../host/auth/cliAccount'
import { CredentialStore, type SecretStore } from '../host/auth/credentialStore'
import { createWorkspaceFileLister } from '../host/mention/workspaceFiles'
import { pageConverter } from '../host/web/pageConverter'
import { createWebFetcher } from '../host/web/webFetcher'
import { captureWorkspaceIdentity } from '../host/workspaceIdentity'
import { fill, uiLocale } from '../shared/l10n/text'
import { walkFiles } from './fileWalk'
import { paidGrantFile } from './paidGrants'

const { readProvidersFile } = providersFile

export interface ExecRuntimeOptions {
  readonly remainingModelCalls?: () => number
  readonly outputCap?: (policy: ModelPolicy) => number
  readonly providerRun?: AssembledProviderRun
  readonly responseAccounting?: RuntimeAccountingEntry.RuntimeResponseAccounting
  readonly isEphemeral: boolean
  readonly headlessPaid: HeadlessPaidPolicy
  readonly streamIdleMs: number
}

export interface RuntimeBackendDeps {
  readonly usageRecording?: UsageRecording | undefined
  readonly questions?: { remove(sessionId: string): Promise<void> }
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
  /** The Model API's transport. */
  readonly fetch: typeof fetch
  /** Waits between retries and rename attempts; injectable so tests do not sleep. */
  readonly sleep: (ms: number) => Promise<void>
  readonly log: Logger
}

export interface RuntimeBackend {
  readonly scheduleBilling?: (
    cwd: string,
    modelId: string,
    caller?: ScheduleCallerContext,
  ) => Promise<ScheduleBillingPorts>
  readonly readUsageBudgets: () => Promise<readonly UsageBudgetRead[]>
  readonly backend: AcpBackend
  /** Muse Code's launch and environment, for `login`. */
  readonly configureOutputSchema?: (
    sessionId: string,
    model: string,
    mode: 'strict_schema' | 'json_schema',
    schema: Readonly<Record<string, unknown>>,
  ) => Promise<void>
  readonly museCode: MuseCodeBackendManager
  /** The flagged paid features and their questions, shared with the agent (M63c, M58). */
  readonly paid: AcpPaidUse
  /**
  At start: "always" lapses for a paid feature the Model API agent was
  started without. A Muse Code agent has no paid flags, so it leaves the
  grants to the Model API agent, which a user may run beside it.
  */
  readonly forgetUnflaggedGrants: () => Promise<void>
  /**
  Lane V seam 5: ACP serve's and exec's media port on the Model API
  backend, over the runtime's attached-media registry. Absent on Muse
  Code, which refuses media with its own reason.
  */
  readonly media?: AcpMediaFactory
  /**
  M105 lane F: ACP serve's uploaded-files port on the Model API backend,
  over the same account ledger the session store cleans. Absent without
  upload storage (ephemeral runs say so and delete nothing).
  */
  readonly uploads?: AcpUploadsPort
  readonly close: () => Promise<void>
}

// No editor proxy setting exists outside VS Code; the CLI reads the
// environment's HTTPS_PROXY and NO_PROXY as it inherits them.
const NO_EDITOR_PROXY: ProxySettings = { proxy: '', noProxy: [] }

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** ACP has no VS Code checkpoint store: record the independent-editor startup policy. */
function independentEditorStartupPolicy(log: Logger): Promise<void> {
  log.trace('ACP native startup is outside the VS Code checkpoint namespace and restore guarantee')
  return Promise.resolve()
}

// Snapshot copies are plain structured data. Keep their type/shape while
// replacing every string leaf before a headless transcript reaches disk.
export function redactSnapshotCopy(value: unknown, literals: readonly string[]): void {
  if (typeof value !== 'object' || value === null) return
  for (const [key, leaf] of Object.entries(value)) {
    if (typeof leaf === 'string') Reflect.set(value, key, redactSecrets(leaf, literals))
    else redactSnapshotCopy(leaf, literals)
  }
}

/**
A session store whose saves scrub every credential that could have
been sent (the pasted key and the opted-in subscription key) before a
headless transcript reaches disk. The literals resolve per save and
never throw, so an unreadable sign-in cannot break persistence.
*/
export function withCredentialRedaction(
  store: SessionStore,
  redactionKeys: () => Promise<readonly string[]>,
): SessionStore {
  return {
    ...store,
    async save(snapshot) {
      const copy = structuredClone(snapshot)
      redactSnapshotCopy(copy, await redactionKeys())
      await store.save(copy)
    },
  }
}

function museCodeManager(deps: RuntimeBackendDeps, workspaceRoot: string | undefined) {
  const { options, log } = deps
  // VS Code inherits its host environment (D1); the standalone runtime has
  // a stricter boundary, shared by serve, account hosts and login.
  const Manager = class extends MuseCodeBackendManager {
    public override childEnvironment(): GuardedChildEnv {
      const env = museCodeEnvironment(deps.env)
      return withLoopbackBypass(
        buildChildEnvironment({
          platform: deps.platform,
          baseEnv: env,
          extraVariables: [],
          systemRoot: environmentValue(env, deps.platform, 'SystemRoot'),
          programFiles: environmentValue(env, deps.platform, 'ProgramFiles'),
          scope:
            workspaceRoot === undefined
              ? { noWorkspace: NO_WORKSPACE, realpath: realpathSync }
              : { workspaceRoot, realpath: realpathSync },
        }),
        deps.platform,
      )
    }
  }
  // A governed `muse serve` on Windows joins the shell job type (M27), as the
  // extension's manager does; without it every Muse Code session was refused
  // ("Windows Muse Code native job launcher unavailable").
  const systemRoot = environmentValue(deps.env, deps.platform, 'SystemRoot')
  const windowsJobAssembly =
    systemRoot !== undefined && deps.platform === 'win32'
      ? shellJobAssembly({
          storageDir: agentDataFolder(deps),
          systemRoot,
          readJobSource: jobSourceReader(path.dirname(deps.distDir)),
          log: (message) => {
            log.warn(message)
          },
        })
      : undefined
  return new Manager({
    ...(windowsJobAssembly !== undefined && { shellJobAssembly: windowsJobAssembly }),
    bundlePath: path.join(deps.distDir, MUSE_CODE_BUNDLE_FILE),
    usageRecording: deps.usageRecording,
    // This records the actual scope boundary; it does not certify a VS Code fence.
    beforeWorkspaceHostStart: () => independentEditorStartupPolicy(log),
    log,
    extensionVersion: deps.version,
    getConfiguredBinaryPath: () => options.museBinary,
    getEnvironmentVariables: () => [],
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

/**
The last Meta-key probe's outcome, shared by the session gate (which
probes) and the workspace managers (which list and dispatch). The gate
runs before the model list, so a dead store is known before anything
dials, and a step that needs the stored key can name the store instead
of claiming that no key is stored.
*/
interface MetaKeyProbe {
  state: 'key' | 'absent' | 'storeDown' | undefined
}

/**
A Files-capable client over the pinned transport: the stored key, read
per use and never handed to a child process. Shared by the session
store's upload binding and the /uploads port.
*/
function newFilesClient(input: {
  readonly fetch: typeof fetch
  readonly apiKey: () => Promise<string | undefined>
  readonly sleep: (ms: number) => Promise<void>
  readonly log: Logger
}): ModelApiClient {
  return new ModelApiClient({
    fetch: input.fetch,
    baseUrl: MODEL_API_BASE_URL,
    apiKey: input.apiKey,
    sleep: input.sleep,
    now: () => Date.now(),
    random: () => Math.random(),
    log: input.log,
  })
}

function modelApiManager(
  deps: RuntimeBackendDeps,
  credentials: CredentialStore,
  subscription: SubscriptionCredential,
  storedWorkspaceRoot: string,
  workspaceRoot: string,
  homes: MuseHomes,
  paid: AcpPaidUse,
  workspaceEdits: WorkspaceEdits,
  assertWorkspaceCurrent: () => void,
  metaKeyProbe: MetaKeyProbe,
  media: {
    /** The runtime's one registry: the media port writes, every session resolves. */
    readonly attached: AttachedMediaPort
    /** The folder's confined reads, for the media port. */
    readonly onIo: (io: ToolIo) => void
  },
): ModelApiBackendManager {
  const { options, log, platform } = deps
  const providerConfigFile = path.join(
    deps.env['XDG_CONFIG_HOME'] ?? path.join(deps.homeDir, '.config'),
    PROVIDERS_CONFIG_DIR_NAME,
    PROVIDERS_FILE_NAME,
  )
  // A dead store simply holds no subscription secret; session creation
  // must not fail before any key is needed.
  const hasChatGptSecret = async (): Promise<boolean> => {
    try {
      return (await deps.secrets.get(PROVIDER_SECRET_PREFIX + 'chatgpt')) !== undefined
    } catch (error: unknown) {
      if (isStoreUnavailable(error)) return false
      throw error
    }
  }
  let subscriptions: Promise<ReturnType<typeof runtimeSubscriptionClient>> | undefined
  let headlessProviders:
    ReturnType<typeof ConfiguredProvidersEntry.createConfiguredProviderServices> | undefined
  const subscriptionClient = () =>
    (subscriptions ??= (async () => {
      const bundle = await import('./chatGptProviderCommands')
      return bundle.runtimeSubscriptionClient({
        secrets: deps.secrets,
        fetch: deps.fetch,
        catalogFile: path.join(deps.distDir, 'providerCatalog.json'),
        configFile: providerConfigFile,
        // A session never signs in: the terminal command does (`providers add chatgpt`).
        openBrowser: () => Promise.reject(new Error(UI_TEXT.acpChatGpt.browserUnavailable)),
        callbackText: () => UI_TEXT.acpChatGpt.callback,
      })
    })())
  let accounting: Promise<typeof RuntimeAccountingEntry> | undefined
  const accountingEntry = () => (accounting ??= import('./runtimeAccountingEntry.js'))
  let daily: ReturnType<typeof RuntimeAccountingEntry.createRuntimeDailyBudget> | undefined
  const dailyBudget = async () => {
    const entry = await accountingEntry()
    return (daily ??= entry.createRuntimeDailyBudget({
      dataFolder: agentDataFolder(deps),
      now: () => Date.now(),
      sleep: deps.sleep,
    }))
  }
  const isWorkspaceTrusted = () => options.trustWorkspace
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
      findFiles: (signal) => walkFiles(root, MENTION_INDEX_LIMIT, log, signal),
      log,
    })
  const listFiles = filesIn(workspaceRoot)
  const io = createToolIo({
    platform,
    listFiles,
    // The interpreter lookup excludes this workspace, so a planted `bash`
    // there never becomes the shell that runs.
    workspaceRoot,
    systemRoot,
    // No credential variable reaches a tool's process (AGENTS.md rule 8).
    env: () => withoutKeyringRoutes(withoutCredentials(deps.env)),
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
    // The ACP agent exposes no hook-concurrency setting (D62).
    hookMaxRunningCommands: () => SETTING_DEFAULTS.hooksMaxRunningCommands,
  })
  media.onIo(io)
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
  // The runtime's own Files-capable client for the session store's upload
  // binding: the stored key over the pinned transport, read per use and
  // never handed to a child process.
  let filesClientValue: ModelApiClient | undefined
  const filesClient = () =>
    (filesClientValue ??= newFilesClient({
      fetch: deps.fetch,
      apiKey: () => credentials.getApiKey(),
      sleep: deps.sleep,
      log,
    }))
  // Production media ledger and calibration (MONEY017D, D85.2/D85.6); the
  // CLI/ACP runtime shares createModelApiHost with VS Code, so this one
  // directory wires the same real path. Ephemeral runs keep no storage.
  const uploadLedgerDir =
    deps.exec?.isEphemeral === true
      ? undefined
      : path.join(agentDataFolder(deps), MODEL_API_UPLOADS_DIR)
  const store =
    deps.exec?.isEphemeral === true
      ? undefined
      : createFileSessionStore({
          directory: workspaceSessionsFolder(dataInput, storedWorkspaceRoot),
          ...(deps.questions !== undefined && { questions: deps.questions }),
          log,
          retentionDays: () => SETTING_DEFAULTS.cleanupPeriodDays,
          now: () => Date.now(),
          sleep: deps.sleep,
          // Production media (P1, D85.2/D85.6): the upload ledger binds
          // the real session store, so a media turn saves and reopens
          // and deletion/purge releases that session's provider uploads.
          // It loads from dist/productionMedia.js on first use.
          ...(uploadLedgerDir !== undefined && {
            uploads: async (accountId: string) => {
              const media = await import('../host/backend/productionMediaEntry')
              media.setUiText(UI_TEXT, uiLocale())
              return await media.createSessionUploads({
                uploadLedgerDir,
                currentAccountId: async () => {
                  const key = await credentials.getApiKey()
                  return key === undefined
                    ? undefined
                    : createHash('sha256').update(key).digest('hex')
                },
                filesClient: () => filesClient(),
                expiryDays: () => SETTING_DEFAULTS.mediaUploadExpiryDays,
              })(accountId)
            },
          }),
        })
  const headlessStore =
    store === undefined
      ? undefined
      : withCredentialRedaction(store, () => subscription.redactionKeys())
  // Lanes V and VB: Windows conversion runs in M50's kill-on-close job under
  // a kernel memory cap; its launcher compiles on first use from the C#
  // shipped beside dist/ (scripts/package-acp.mjs JOB_SOURCES).
  const mediaJobExecutable =
    platform === 'win32' && systemRoot !== undefined
      ? mcpJobExecutable({
          storageDir: agentDataFolder(dataInput),
          systemRoot,
          readJobSource: jobSourceReader(path.dirname(deps.distDir)),
          log: warn,
        })
      : undefined
  return new ModelApiBackendManager({
    log,
    ...(mediaJobExecutable !== undefined && { mediaJobExecutable }),
    // Each conversion's owner-only folder sits in this private root (VB).
    mediaPrivateRoot: path.join(agentDataFolder(deps), MEDIA_PRIVATE_ROOT_DIR),
    // Lane V seam 1/5: attached video and audio from ACP and exec resolve here.
    attachedMedia: media.attached,
    // ACP/exec keep their existing flag-controlled transcription default.
    mediaAudioAction: undefined,
    usageRecording: deps.usageRecording,
    hasExternalPaidRecording: deps.exec !== undefined,
    // The effective key per attempt: the pasted key, or the opted-in
    // subscription's. Resolution re-reads every call, so an unlocked store
    // or a rotated file heals without a probe.
    getApiKey: () => subscription.getApiKey(),
    // Paid extras bill the stored key even while chat bills the plan. The
    // watched store covers a stdin key too; nothing here throws, so an
    // unreadable store reads as no paid key and the image path refuses.
    getPaidApiKey: async () => {
      try {
        const stored = await deps.secrets.get(SECRET_KEYS.modelApiKey)
        return stored === undefined || stored === '' ? undefined : stored
      } catch (error: unknown) {
        log.warn(`Paid key read failed (${failureForLog(error)}); reading as no paid key`)
        return
      }
    },
    subscriptionAccountId: subscription.accountId(),
    getBillingRoute: (isPaid) => subscription.route(isPaid),
    // No Meta key on record means no catalogue dial: the model list comes
    // from the providers file alone, so a keyless session still opens.
    // Unprobed sessions keep today's dial behavior.
    hasMetaCredential: () => metaKeyProbe.state === undefined || metaKeyProbe.state === 'key',
    isCredentialStoreDown: () => metaKeyProbe.state === 'storeDown',
    workspaceRoot,
    sessionWorkspaceRoot: storedWorkspaceRoot,
    assertWorkspaceCurrent,
    workspaceEdits,
    io,
    listAttemptFiles: (attemptRoot, signal) => filesIn(attemptRoot)(signal),
    contextIo: fileContextIo,
    webFetch: createWebFetcher(log, pageConverter(path.join(deps.distDir, PAGE_WORKER_FILE), log)),
    fetch: deps.fetch,
    legalScan: async (input, signal) => {
      assertWorkspaceCurrent()
      const handle = await loadLegalScanner({ distDir: deps.distDir }).scan({
        workspaceRoot,
        input,
        signal,
      })
      assertWorkspaceCurrent()
      signal.throwIfAborted()
      return handle.result
    },
    createProviderClient: async (meta: ProviderClient) => {
      let client = meta
      const run = deps.exec?.providerRun
      if (run !== undefined) {
        const entry = await import('../host/backend/configuredProvidersEntry')
        entry.setUiText(UI_TEXT, uiLocale())
        headlessProviders = entry.createConfiguredProviderServices(meta, {
          configFile: providerConfigFile,
          catalogFile: path.join(deps.distDir, 'providerCatalog.json'),
          secrets: run.secrets,
          // Headless indefinite waits are said out loud too (PR #214
          // review); per-request timing still goes nowhere.
          log,
          hasMetaKey: () => Promise.resolve(false),
          resolve: run.resolveHost,
          send: async (target, body, headers, signal) => {
            const response = await run.fetch(target.url.href, {
              method: body === undefined ? 'GET' : 'POST',
              headers,
              ...(body !== undefined && { body }),
              signal,
            })
            const reader = response.body?.getReader()
            let isReleased = false
            return {
              status: response.status,
              headers: Object.fromEntries(response.headers.entries()),
              body: {
                async *[Symbol.asyncIterator]() {
                  if (reader === undefined) return
                  try {
                    for (;;) {
                      const next = await reader.read()
                      if (next.done) return
                      yield next.value
                    }
                  } finally {
                    reader.releaseLock()
                    isReleased = true
                  }
                },
              },
              close: () => {
                if (!isReleased)
                  void reader?.cancel().catch(() => {
                    // Cleanup follows the request's settled error or abort; a late
                    // stream cancellation failure must not replace that outcome.
                  })
              },
            }
          },
        })
        client = headlessProviders.client
      } else if (existsSync(providerConfigFile) || (await hasChatGptSecret())) {
        // The editor protocol and a terminal plan-model exec share this
        // construction: a plan model runs on its own subscription sign-in,
        // with or without a Meta key. A plan exec bypasses the Meta-only
        // transport (runExec), so its requests reach the subscription leg
        // while admission and settlement stay on the shared accounting path.
        const subscriptions = await subscriptionClient()
        client = await subscriptions.createClient(meta)
      }
      const entry = await accountingEntry()
      entry.setUiText(UI_TEXT, uiLocale())
      return entry.withRuntimeAccounting(
        client,
        await dailyBudget(),
        deps.exec?.responseAccounting,
        deps.exec?.providerRun?.dispatch,
        deps.exec?.outputCap,
      )
    },
    reservePaidRequest: async (
      body,
      _feature,
      _estimated,
      signal = new AbortController().signal,
    ) => {
      if ('input' in body) return
      const budget = await dailyBudget()
      return budget.admit(Usd.from(PAID_PRICES_USD.imageGeneration).toAmount(), signal)
    },
    // The machine's converter path (lane V seam 3B): the agent data folder's
    // settings.json, never a workspace file or environment variable.
    mediaConverterPath: () => runtimeConverterPath(agentDataFolder(deps)),
    // D78's exact reservation for Muse Voice's batch transcription (lane V
    // seam 4): the runtime's own daily ledger, estimate-checked and settled
    // after (D208). With no daily limit there is nothing to enforce.
    reservePaidExtra: async (costUsd, signal) => {
      const budget = await dailyBudget()
      return paidExtraAdmission(await budget.reserve(costUsd, signal), costUsd, signal)
    },
    ...(deps.exec?.providerRun === undefined && {
      getProviderAccountId: async () => {
        // One shared subscription identity for the editor protocol and a
        // terminal plan-model exec. No readable store means no readable
        // account: unknown, not failed.
        try {
          const subscriptions = await subscriptionClient()
          return await subscriptions.accountId()
        } catch (error: unknown) {
          if (!isStoreUnavailable(error)) throw error
          // No readable store means no readable account.
          return
        }
      },
    }),
    ...(deps.exec?.providerRun !== undefined && {
      getProviderAccountId: async () => {
        if (headlessProviders === undefined)
          throw new UserRefusalError(UI_TEXT.execModelUnpriced, 'unpriced')
        return await headlessProviders.accountId()
      },
    }),
    // RVCM1062B P1: no raw-registry resolver here. The entry binds the
    // selected record through the session client's own resolver, which is
    // the accounting-wrapped headless client, so every priced request keeps
    // its daily reservation and run-ledger admission/settlement.
    ...(deps.exec !== undefined && {
      streamIdleMs: deps.exec.streamIdleMs,
      modelOutputMaxTokens: (_ref, resolved) =>
        deps.exec?.outputCap?.(resolved.policy) ?? resolveExecOutputCap(resolved.policy),
    }),
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
    ...(uploadLedgerDir !== undefined && { uploadLedgerDir }),
    uploadExpiryDays: () => SETTING_DEFAULTS.mediaUploadExpiryDays,
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
      // Headless image settlement has its own per-attempt tap in runExec.
      if (deps.exec === undefined) {
        recordPaidUse(deps.usageRecording ?? ModelApiBackendManager.usageRecording, feature, units)
      }
    },
    // The panel's default (M56); the agent has no setting for the longer retention.
    promptCacheRetention: () => SETTING_DEFAULTS.modelApiPromptCacheRetention,
    // ACP and headless share the panel's packing/recall engine. Without a
    // VS Code setting here, use D81.6's enabled policy in every editor.
    isObservationPackingOn: () => true,
    // TOOLCAP: the headless run's --max-tool-output-bytes, if raised for one run.
    maxToolOutputBytes: () => deps.options.maxToolOutputBytes,
    // M82's cap and reply line are VS Code settings; ACP exposes neither.
    sessionBudgetUsd: () => Usd.from(SETTING_DEFAULTS.modelApiSessionBudgetUsd).toAmount(),
    remainingModelCalls: deps.exec?.remainingModelCalls,
    pacingOwner: deps,
    strictTools: () => SETTING_DEFAULTS.modelApiStrictTools,
    parallelReads: () => SETTING_DEFAULTS.modelApiParallelReads,
    webSearchMaxPerRequest: () => SETTING_DEFAULTS.webSearchMaxPerRequest,
    hookMaxStopContinuations: () => SETTING_DEFAULTS.hooksMaxStopContinuations,
    hookMaxRunningCommands: () => SETTING_DEFAULTS.hooksMaxRunningCommands,
    subagentMaxConcurrent: () => SETTING_DEFAULTS.subagentMaxConcurrent,
    isAutoCompactionOn: () =>
      deps.options.autoCompaction ?? SETTING_DEFAULTS.modelApiAutoCompaction,
    autoCompactionEvaluated: () => IS_AUTO_COMPACTION_EVALUATED,
    // The route's own context-full stop: modelApi exec names its flag and
    // budget, ACP the editor approval. Other routes keep the shared manual
    // sentence.
    ...(deps.exec !== undefined &&
      deps.options.backend === 'modelApi' && {
        contextWindowFullText: UI_TEXT.contextWindowFullExec,
      }),
    ...(deps.exec === undefined && { contextWindowFullText: UI_TEXT.contextWindowFullAcp }),
    // The wrapped runtime transport checks a person-set daily limit per HTTP attempt.
    autoCompactionAccounting: 'transport',
    // Compaction spending here is authorized by the editor's per-use paid
    // question (serve) or exec's explicit flag under its run budget, never
    // by workspace trust: exec refuses trust outright, so the editor's
    // trust fence would make the headless flag a no-op (RVMSM101).
    // Workspace trust still gates hooks, grants and tools as before.
    autoCompactionTrusted: () => true,
    paidDailyBudgetUsd: async () => {
      const budget = await dailyBudget()
      return budget.capUsd()
    },
    // D78 changes only VS Code's display default; ACP remains unchanged.
    showReplyUsage: () => false,
    // Each use asked in the editor's session (M58, PLAN.md D48). Child tasks
    // are paid (M48, D45) and the agent's paid features are its two flags
    // (D62), so `subagents` is never on here and every task is denied.
    paidAuthority: paid.authorityFor(),
    allowsPaidUse: (request, requiresAsking, sessionId) =>
      paid.allows(storedWorkspaceRoot, sessionId, request, requiresAsking),
    isPaidUseRemembered: (feature) => paid.isRemembered(storedWorkspaceRoot, feature),
    paidUseFence: (feature, sessionId) => paid.fence(storedWorkspaceRoot, sessionId, feature),
    noteSubagentUsage: (modelId) => {
      log.warn(`A subagent's usage on ${modelId} was reported, but the agent runs no subagents`)
    },
    noteReviewerUsage: () => {
      log.warn('An Auto reviewer reported usage, but the ACP agent runs no Auto reviewer')
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
  // The shared manager serves `login` and the account host, whose children
  // keep this process's working directory: it is the directory they run in,
  // so the PATH guard and the CLI lookup treat it as their workspace —
  // otherwise a project directory they start from is still searched
  // (docs/certification/pathguard.md).
  const launchDirectory = process.cwd()
  const museCode = museCodeManager(deps, launchDirectory)
  const museCodeHosts = new Map<string, MuseCodeBackendManager>()
  const modelApiHosts = new Map<
    string,
    { readonly manager: ModelApiBackendManager; readonly identity: string }
  >()
  const workspaceEdits = new Map<string, WorkspaceEdits>()
  // Lane V seam 5: one attached-media registry for the runtime, and each
  // folder's confined reads for its media port.
  // The registry itself loads with dist/runtimeMedia.js on the first media
  // prompt; until then nothing is attached and nothing resolves.
  let mediaEntry: Promise<typeof RuntimeMediaEntry> | undefined
  let registry: AttachedMedia | undefined
  const attachedMedia = lazyAttachedMedia(() => registry)
  const mediaIo = new Map<string, ToolIo>()
  // C-M95-SUB: the Model API backend on the Muse Code subscription. The
  // flag is the one opt-in; without it the pasted key behaves as before.
  // The source reads only the CLI's auth file, never the secret store.
  const subscriptionSource = new SubscriptionKeySource({
    platform: deps.platform,
    homeDir: deps.homeDir,
    xdgConfigHome: deps.env['XDG_CONFIG_HOME'],
  })
  const credentials = new CredentialStore(
    deps.secrets,
    (message) => {
      deps.log.warn(message)
    },
    "the operating system's credential store",
    undefined,
    // The --subscription opt-in counts the CLI sign-in for backend
    // availability; the key itself never enters the store.
    async () => deps.options.subscription === true && (await subscriptionSource.isReady()),
  )
  const grants = paidGrantFile({
    file: paidGrantsFile({ platform: deps.platform, env: deps.env, homeDir: deps.homeDir }),
    log: deps.log,
    sleep: deps.sleep,
  })
  const subscription = new SubscriptionCredential({
    credentials,
    isEnabled: () => deps.options.subscription === true,
    platform: deps.platform,
    homeDir: deps.homeDir,
    xdgConfigHome: deps.env['XDG_CONFIG_HOME'],
    source: subscriptionSource,
  })
  const paid = new AcpPaidUse({
    flagged: deps.options.paidFeatures,
    scheduleAuthorization: {
      scheduledPrompts:
        deps.options.backend === 'modelApi' && deps.options.scheduledPrompts === true,
      ...(deps.options.maxBudgetUsd !== undefined && { maxBudgetUsd: deps.options.maxBudgetUsd }),
    },
    autoCompactionEvaluated: () => IS_AUTO_COMPACTION_EVALUATED,
    autoCompactionOff: deps.options.autoCompaction === false,
    canRemember: () => deps.options.trustWorkspace,
    grants,
    log: deps.log,
    // The terminal operator's console is the runtime log: an "always" that
    // could not be kept is said there at once. A served session's person
    // hears it in the session instead (the agent attaches its notifier).
    notify: (text) => {
      deps.log.warn(text)
    },
    ...(deps.exec !== undefined && { headless: deps.exec.headlessPaid }),
  })
  const metaKeyProbe: MetaKeyProbe = { state: undefined }
  const museEnvironment = museCode.childEnvironment()
  const homes: MuseHomes = {
    xdgConfigHome: environmentValue(museEnvironment, deps.platform, 'XDG_CONFIG_HOME'),
    xdgDataHome: environmentValue(museEnvironment, deps.platform, 'XDG_DATA_HOME'),
  }

  // Muse Code's account methods on a short-lived host of their own, as the
  // panel asks them (PR #49): `account/read` when the file cannot say.
  const accountHosts = new AccountHosts(
    (signal) => connectAccountSession(museCode, deps.version, deps.log, launchDirectory, signal),
    deps.log,
  )
  const cliAccount = new CliAccount({
    platform: deps.platform,
    credentialFilePath: () => museCode.credentialFilePath(),
    probe: () => accountHosts.probe(),
    log: deps.log,
  })

  /**
  Muse Code's readiness, as the panel's sign-in gate counts it (D26):
  `META_API_KEY` in the CLI's environment (with it `muse serve` starts
  whatever the file says), or the CLI's own sign-in from the file's
  structure, asked of the CLI where only it can say. `authenticate`, the
  user saying they signed in, is the agent's user action, as the panel's
  Check again is: it forgets what the CLI said before and may ask on
  macOS, where a question can read the Keychain. A session or a list is
  not: on macOS it takes the file's word or the panel's passive estimate
  (a turn's `authRequired` corrects it) rather than start `muse serve`
  each time. A macOS file on Windows or Linux stops `muse serve`, so it is
  said as such.
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

  // `modelHint`: the exec run's requested model, when one is named. A plan
  // model (chatgpt/…, copilot/…) runs on its own subscription sign-in, so a
  // missing Meta key must not refuse it; a refusal then names the plan
  // sign-in instead. Without a hint (the editor picks the model later) any
  // subscription keeps the gate open.
  const modelApiReadiness = async (modelHint?: string): Promise<BackendReadiness> => {
    // One ChatGPT subscription client for both probes below: the same
    // providers file, catalog and browser refusal; absent when no file.
    const chatGptFactory = async (): Promise<
      | {
          readonly factory: ReturnType<typeof runtimeSubscriptionClient>
          readonly failureOf: (error: unknown) => string | undefined
        }
      | undefined
    > => {
      const configFile = providersFilePath({
        platform: process.platform,
        homeDir: deps.homeDir,
        xdgConfigHome: deps.env['XDG_CONFIG_HOME'],
      })
      if (!existsSync(configFile)) return undefined
      const entry = await import('./chatGptProviderCommands')
      return {
        factory: entry.runtimeSubscriptionClient({
          secrets: deps.secrets,
          fetch: deps.fetch,
          configFile,
          catalogFile: path.join(deps.distDir, 'providerCatalog.json'),
          openBrowser: () => Promise.reject(new Error(UI_TEXT.actionFailed)),
          callbackText: () => UI_TEXT.acpChatGpt.callback,
        }),
        failureOf: entry.chatGptFailureOf,
      }
    }
    // The opted-in CLI subscription counts before the secret store is
    // touched: a valid sign-in is usable with no pasted key, and an
    // unavailable OS store never blocks subscription-only use.
    let subscriptionRefusal: string | undefined
    if (deps.options.subscription === true) {
      const read = await subscriptionSource.read()
      if (read.status === 'ready') return { state: 'ready' }
      subscriptionRefusal = subscriptionKeyRefusal(read.status)
    }
    let key: string | undefined
    try {
      key = await deps.secrets.get(SECRET_KEYS.modelApiKey)
      metaKeyProbe.state = key !== undefined && key !== '' ? 'key' : 'absent'
    } catch (error: unknown) {
      // A refused providers file is not a keyring outage: the runtime is
      // already on the account service, so its own refusal stands as read
      // through the runtime's wrapped metadata port.
      if (isInvalidProvidersFileError(error))
        return { state: 'unavailable', message: accountErrorText(error) }
      // A dead store reads as no key; only a step that needs a stored key
      // still says so, in the one sentence for this condition.
      if (isStoreUnavailable(error)) {
        metaKeyProbe.state = 'storeDown'
        return { state: 'signedOut', message: UI_TEXT.acpStoreDown, storeDown: true }
      }
      return {
        state: 'unavailable',
        message: fill(UI_TEXT.acpStoreUnavailable, { reason: describe(error) }),
      }
    }
    if (deps.exec?.providerRun !== undefined) return { state: 'ready' }
    if (key !== undefined && key !== '') return { state: 'ready' }
    // No `--model`: the configured default decides, as the late default-model
    // resolution does after the session starts (Codex on PR #227). A default
    // plan model must reach the subscription checks below instead of this
    // key gate, or the keyless default-plan flow never starts.
    let hint = modelHint
    if (hint === undefined && deps.exec !== undefined) {
      try {
        const read = await readProvidersFile(
          path.join(
            deps.env['XDG_CONFIG_HOME'] ?? path.join(deps.homeDir, '.config'),
            PROVIDERS_CONFIG_DIR_NAME,
            PROVIDERS_FILE_NAME,
          ),
        )
        if (read.ok) hint = read.file.defaultModel
      } catch {
        // An unreadable providers file reads as no default: the key gate
        // below still refuses, and the run surfaces the file's own error.
      }
    }
    // The early key return above leaves only an absent or empty key here,
    // so this gate is the interactive session's ChatGPT-grant check alone.
    if (deps.exec === undefined) {
      try {
        const hasProviderRecord =
          (await deps.secrets.get(`${PROVIDER_SECRET_PREFIX}chatgpt`)) !== undefined
        const configFile = path.join(
          deps.env['XDG_CONFIG_HOME'] ?? path.join(deps.homeDir, '.config'),
          PROVIDERS_CONFIG_DIR_NAME,
          PROVIDERS_FILE_NAME,
        )
        if (hasProviderRecord || existsSync(configFile)) {
          const entry = await import('./chatGptProviderCommands')
          const factory = entry.runtimeSubscriptionClient({
            secrets: deps.secrets,
            fetch: deps.fetch,
            configFile,
            catalogFile: path.join(deps.distDir, 'providerCatalog.json'),
            openBrowser: () => Promise.reject(new Error(UI_TEXT.actionFailed)),
            callbackText: () => UI_TEXT.acpChatGpt.callback,
          })
          if ((await factory.accountId()) !== undefined) return { state: 'ready' }
        }
      } catch (error: unknown) {
        // An unreadable providers file reads as no default: the key gate
        // below still refuses, and the run surfaces the file's own error.
        deps.log.warn(`Plan model probe failed (${failureForLog(error)}); no default plan model`)
      }
      const chatGpt = await chatGptFactory()
      if (chatGpt !== undefined) {
        try {
          if ((await chatGpt.factory.accountId()) !== undefined) return { state: 'ready' }
        } catch (error: unknown) {
          // The providers file, a stored ChatGPT grant or the store: each in
          // its own words, never all of them as the store. The file's refusal
          // carries its own sentence (unparseable or invalid); anything else
          // is not this account read's answer to give.
          deps.log.warn(
            `ChatGPT account probe failed (${failureForLog(error)}); answering unavailable`,
          )
          if (isInvalidProvidersFileError(error))
            return { state: 'unavailable', message: error.message }
          const grantWords = chatGpt.failureOf(error)
          if (grantWords !== undefined) return { state: 'unavailable', message: grantWords }
          if (error instanceof StoreUnavailableError)
            return {
              state: 'unavailable',
              message: fill(UI_TEXT.acpStoreUnavailable, { reason: describe(error) }),
            }
          throw error
        }
      }
    }
    const isPlan = hint !== undefined && isPlanModelRef(hint)
    if (!isPlan && deps.exec !== undefined)
      return { state: 'signedOut', message: UI_TEXT.acpNoStoredKey }
    try {
      if ((await deps.secrets.get(`${PROVIDER_SECRET_PREFIX}chatgpt`)) !== undefined)
        return { state: 'ready' }
      const chatGpt = await chatGptFactory()
      if (chatGpt !== undefined && (await chatGpt.factory.accountId()) !== undefined)
        return { state: 'ready' }
    } catch (error: unknown) {
      if (isStoreUnavailable(error)) {
        metaKeyProbe.state = 'storeDown'
        return { state: 'signedOut', message: UI_TEXT.acpStoreDown, storeDown: true }
      }
      return { state: 'unavailable', message: UI_TEXT.acpChatGpt.failure }
    }
    // C-M95-SUB: an opted-in subscription that is not usable refuses in its
    // own words before the generic key refusal.
    if (subscriptionRefusal !== undefined)
      return { state: 'signedOut', message: subscriptionRefusal }
    // A plan model's refusal names its own sign-in, never the Meta key. The
    // name comes from the resolved hint (the configured default included),
    // not the flag: without `--model` the flag is empty here (Codex on PR
    // #227).
    let refusal = UI_TEXT.acpNoStoredKey
    if (hint !== undefined && isPlanModelRef(hint)) {
      if (hint.startsWith('chatgpt/')) refusal = UI_TEXT.acpChatGpt.states['signed-out']
      // The Copilot dispatch adapter is VS Code's Language Model API
      // (src/host/providers/copilotClient.ts): this terminal cannot reach that
      // grant, so the refusal names its source instead of offering a sign-in
      // no terminal can perform.
      else if (hint.startsWith('copilot/')) refusal = UI_TEXT.planUi.copilotTerminalGrant
    }
    return { state: 'signedOut', message: refusal }
  }

  const modelApiHostFor = async (cwd: string) => {
    const identity = await captureWorkspaceIdentity(cwd)
    if (identity === undefined) {
      throw new Error(UI_TEXT.modelApiNeedsFolder)
    }
    const { canonical, key } = identity
    const existing = modelApiHosts.get(cwd)
    if (existing !== undefined) {
      if (existing.identity !== key) {
        throw new Error(FILE_REFUSAL_MODEL_TEXT.pathChangedAfterApproval)
      }
      return await existing.manager.ensureHost()
    }
    const assertWorkspaceCurrent = () => {
      if (!identity.isCurrent()) {
        throw new Error(FILE_REFUSAL_MODEL_TEXT.pathChangedAfterApproval)
      }
    }
    const edits = workspaceEdits.get(key) ?? new WorkspaceEdits()
    workspaceEdits.set(key, edits)
    const manager = modelApiManager(
      deps,
      credentials,
      subscription,
      cwd,
      canonical,
      homes,
      paid,
      edits,
      assertWorkspaceCurrent,
      metaKeyProbe,
      {
        attached: attachedMedia,
        onIo: (io) => {
          mediaIo.set(cwd, io)
        },
      },
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

  // M105 lane F: the /uploads port over the account ledger in the agent
  // data folder. The media bundle loads on first use; without storage or
  // an account it reads empty and deletes nothing. ACP answers in text,
  // never through post.
  const agentUploadLedgerDir =
    deps.exec?.isEphemeral === true
      ? undefined
      : path.join(agentDataFolder(deps), MODEL_API_UPLOADS_DIR)
  const uploadsAccountId = async (): Promise<string | undefined> => {
    const key = await credentials.getApiKey()
    return key === undefined ? undefined : createHash('sha256').update(key).digest('hex')
  }
  let uploadsClient: ModelApiClient | undefined
  const uploadsFilesClient = () =>
    (uploadsClient ??= newFilesClient({
      fetch: deps.fetch,
      apiKey: () => credentials.getApiKey(),
      sleep: deps.sleep,
      log: deps.log,
    }))
  const openUploadsLedger = async (
    accountId: string | undefined,
  ): Promise<UploadLedger | undefined> => {
    if (agentUploadLedgerDir === undefined) return undefined
    const media = await import('../host/backend/productionMediaEntry')
    media.setUiText(UI_TEXT, uiLocale())
    const uploadsDeps = {
      uploadLedgerDir: agentUploadLedgerDir,
      currentAccountId: uploadsAccountId,
      filesClient: uploadsFilesClient,
      expiryDays: () => SETTING_DEFAULTS.mediaUploadExpiryDays,
    }
    // Removing the key keeps the retained list across a restart: the
    // last account's persisted ledger reads read-only (PLAN D85.2).
    return accountId === undefined
      ? await media.openLastAccountUploads(uploadsDeps)()
      : await media.createSessionUploads(uploadsDeps)(accountId)
  }
  const uploads: AcpUploadsPort = createUploadedFilesPort({
    ledger: async (): Promise<UploadLedger | undefined> =>
      agentUploadLedgerDir === undefined
        ? undefined
        : await openUploadsLedger(await uploadsAccountId()),
  })
  let isClosed = false
  return {
    readUsageBudgets: async () => {
      // The shared daily paid budget first, then the live session budgets:
      // the same pair VS Code passes (RVCM1132B finding 3). The ledger read
      // never starts a backend.
      const accounting = await import('./runtimeAccountingEntry.js')
      const [daily, ...session] = await Promise.all([
        accounting.readRuntimeDailyBudget({ dataFolder: agentDataFolder(deps), now: Date.now }),
        ...Array.from(modelApiHosts.values(), ({ manager }) => manager.readUsageBudgets()),
      ])
      return [...daily, ...session.flat()]
    },
    backend: {
      kind: deps.options.backend,
      readiness: (isRecheck, modelHint) =>
        deps.options.backend === 'modelApi'
          ? modelApiReadiness(modelHint)
          : museCodeReadiness(isRecheck),
      hostFor,
      // F91: the folder host's Linux capability probe, measured at its
      // start; the editor hears it as a session update, the model as a tail
      // note. Undefined where the probe does not apply or no host started.
      shellSandboxReadiness: (cwd: string) => museCodeHosts.get(cwd)?.shellSandboxReadiness(),
    },
    configureOutputSchema: async (sessionId, model, mode, schema) => {
      if (deps.options.backend !== 'modelApi') throw new Error(UI_TEXT.execRequestShape)
      for (const { manager } of modelApiHosts.values()) {
        const host = await manager.ensureHost()
        if (host.configureOutputSchema(sessionId, model, mode, schema)) return
      }
      throw new Error(UI_TEXT.execRequestShape)
    },
    scheduleBilling: async (cwd, modelId, caller) => {
      if (deps.exec !== undefined || deps.options.backend !== 'modelApi')
        throw new Error(UI_TEXT.schedulePaidOff)
      const host = await modelApiHostFor(cwd)
      const entry = await import('./runtimeAccountingEntry.js')
      const daily = entry.createRuntimeDailyBudget({
        dataFolder: agentDataFolder(deps),
        now: Date.now,
        sleep: deps.sleep,
      })
      return {
        modelId: () => modelId,
        host: () => Promise.resolve(host),
        generation: () => 0,
        capUsd: daily.capUsd,
        isActive: () => !isClosed,
        isOn: (feature) => paid.isOn(feature),
        ...(caller !== undefined && { caller: () => caller }),
        reportConsent: (question) => {
          process.stderr.write(`${question.title}\n${question.detail}\n`)
          return Promise.resolve()
        },
        ask: (question) =>
          caller?.sessionId === undefined
            ? Promise.resolve('deny')
            : paid.askScheduleUse(caller.sessionId, question.request),
        reserve: async (record, amount, signal) => {
          signal.throwIfAborted()
          // The shared daily cap first: over it the stop sentence refuses.
          const claim = await daily.reserve(amount, signal)
          // Then the schedule's own caps against the same day pool (the
          // consent gates a shared budget, so the pool exists here).
          await checkScheduleOwnCap(record, amount, async () => {
            const rows = await daily.readToday()
            return sumUsd(...rows.map((row) => row.budget.spentUsd))
          })
          // Paid consent always carries a shared budget; without one set
          // the fire is admitted through a claim that enforces nothing.
          return claim ?? passthroughSpendClaim(amount, signal)
        },
      }
    },
    museCode,
    paid,
    ...(deps.options.backend === 'modelApi' && {
      media: async (context) => {
        // The folder's host first: it owns the confined reads the port uses.
        await modelApiHostFor(context.cwd)
        const io = mediaIo.get(context.cwd)
        if (io === undefined) throw new Error(UI_TEXT.media.uploadUnavailable)
        const entry = await (mediaEntry ??= import('./runtimeMediaEntry'))
        entry.setUiText(UI_TEXT, uiLocale())
        return entry.runtimeMediaPort(context, {
          platform: deps.platform,
          io,
          attached: (registry ??= entry.createAttachedMedia()),
          newToken: () => randomUUID(),
          // Muse Voice transcribes attached sound only under its flag.
          transcribesSound: (info) =>
            paid.isOn('voice') &&
            (info.mediaType === 'audio/wav' || info.mediaType === 'audio/mpeg'),
        })
      },
    }),
    ...(deps.options.backend === 'modelApi' && { uploads }),
    forgetUnflaggedGrants: async () => {
      if (deps.exec !== undefined) return
      if (deps.options.backend === 'modelApi') await paid.forgetUnflagged()
      // Companion voice uses the stored Model API key on either backend.
      // Dropping its flag revokes remembered consent before a later re-enable.
      if (COMPANION_VOICE_RELEASE.isReady && deps.options.companionVoice !== true) {
        try {
          await grants.forget(['voice'])
        } catch {
          deps.log.warn('Companion voice workspace grants could not be forgotten')
        }
      }
    },
    close: async () => {
      isClosed = true
      // A probe still waiting on its short-lived host ends with the agent.
      accountHosts.close()
      const managers = [
        ...museCodeHosts.values(),
        ...Array.from(modelApiHosts.values(), ({ manager }) => manager),
      ]
      await Promise.all(managers.map((manager) => manager.dispose()))
      // Every attached source, embedded bytes included, ends with the runtime.
      registry?.clear()
    },
  }
}
