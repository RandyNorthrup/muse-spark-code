import { resolveExecOutputCap } from './exec/runLedger'
import type { ModelPolicy } from '../core/backends/modelapi/modelPolicy'
import type * as RuntimeAccountingEntry from './runtimeAccountingEntry'
import { runtimeConverterPath } from './runtimeConverterPath'
import { Usd } from '../shared/usd'
import { loadLegalScanner } from './legal/legalScanner'
import { ModelApiClient } from '../core/backends/modelapi/client'
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
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { AcpBackend, BackendReadiness } from '../acp/agent'
import { accountErrorText, isInvalidProvidersFileError } from '../acp/accountText'
import { AcpPaidUse, type HeadlessPaidPolicy } from '../acp/paid'
import type { AgentHost } from '../core/agent/agentBackend'
import type { CliSignIn } from '../core/backends/musecode/credentialFile'
import {
  buildChildEnvironment,
  environmentValue,
  withLoopbackBypass,
} from '../core/backends/musecode/launch'
import { personalSkillsRoot } from '../core/context/skills'
import { personalAgentsRoot } from '../core/context/customAgents'
import { memoryDataRoot } from '../core/memory/memoryLocation'
import { MemoryStore } from '../core/memory/memoryStore'
import { WorkspaceEdits } from '../core/verify/workspaceEdits'
import { redactSecrets } from '../core/redact'
import { recordPaidUse } from '../core/paid/paidFeatures'
import type { UsageRecording } from '../core/usage/recording'
import type { UsageBudgetRead } from '../core/usage/usageService'
import { fileContextIo } from '../host/backend/contextIo'
import { describeEnvironment } from '../host/backend/environment'
import { createFileSessionStore } from '../host/backend/fileSessionStore'
import { jobSourceReader } from '../host/backend/jobSource'
import { createMemoryIo, systemPath } from '../host/backend/memoryIo'
import { ModelApiBackendManager } from '../host/backend/modelApiBackendManager'
import { MuseCodeBackendManager, type ProxySettings } from '../host/backend/museCodeBackendManager'
import { shellJobAssembly } from '../host/backend/shellJob'
import { mcpJobExecutable } from '../host/backend/mcpJobExecutable'
import { createToolIo } from '../host/backend/toolIo'
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
import type { Logger } from '../host/logger'
import { createWorkspaceFileLister } from '../host/mention/workspaceFiles'
import { pageConverter } from '../host/web/pageConverter'
import { createWebFetcher } from '../host/web/webFetcher'
import { captureWorkspaceIdentity } from '../host/workspaceIdentity'
import {
  FILE_REFUSAL_MODEL_TEXT,
  MENTION_INDEX_LIMIT,
  MODEL_API_BASE_URL,
  MODEL_API_BUNDLE_FILE,
  MODEL_API_UPLOADS_DIR,
  MEDIA_PRIVATE_ROOT_DIR,
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
import { fill, uiLocale } from '../shared/l10n/text'
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
import { walkFiles } from './fileWalk'
import { paidGrantFile } from './paidGrants'

import type { AssembledProviderRun } from './exec/providerExec'

export interface ExecRuntimeOptions {
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
   * At start: "always" lapses for a paid feature the Model API agent was
   * started without. A Muse Code agent has no paid flags, so it leaves the
   * grants to the Model API agent, which a user may run beside it.
   */
  readonly forgetUnflaggedGrants: () => Promise<void>
  /**
   * Lane V seam 5: ACP serve's and exec's media port on the Model API
   * backend, over the runtime's attached-media registry. Absent on Muse
   * Code, which refuses media with its own reason.
   */
  readonly media?: AcpMediaFactory
  /**
   * M105 lane F: ACP serve's uploaded-files port on the Model API backend,
   * over the same account ledger the session store cleans. Absent without
   * upload storage (ephemeral runs say so and delete nothing).
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

function museCodeManager(deps: RuntimeBackendDeps, workspaceRoot: string | undefined) {
  const { options, log } = deps
  // VS Code inherits its host environment (D1); the standalone runtime has
  // a stricter boundary, shared by serve, account hosts and login.
  const Manager = class extends MuseCodeBackendManager {
    public override childEnvironment(): NodeJS.ProcessEnv {
      const env = museCodeEnvironment(deps.env)
      return withLoopbackBypass(
        buildChildEnvironment({
          platform: deps.platform,
          baseEnv: env,
          extraVariables: [],
          systemRoot: environmentValue(env, deps.platform, 'SystemRoot'),
          programFiles: environmentValue(env, deps.platform, 'ProgramFiles'),
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
 * A Files-capable client over the pinned transport: the stored key, read
 * per use and never handed to a child process. Shared by the session
 * store's upload binding and the /uploads port.
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
  storedWorkspaceRoot: string,
  workspaceRoot: string,
  homes: MuseHomes,
  paid: AcpPaidUse,
  workspaceEdits: WorkspaceEdits,
  assertWorkspaceCurrent: () => void,
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
        openBrowser: () => Promise.reject(new Error(UI_TEXT.acpChatGpt.failure)),
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
    getApiKey: () => credentials.getApiKey(),
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
      } else if (
        deps.exec === undefined &&
        (existsSync(providerConfigFile) ||
          (await deps.secrets.get(PROVIDER_SECRET_PREFIX + 'chatgpt')) !== undefined)
      ) {
        const subscriptions = await subscriptionClient()
        client = await subscriptions.createClient(meta)
      }
      const entry = await accountingEntry()
      entry.setUiText(UI_TEXT, uiLocale())
      return entry.withRuntimeAccounting(
        client,
        await dailyBudget(),
        deps.exec?.responseAccounting,
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
      return await budget.reserve(PAID_PRICES_USD.imageGeneration, signal)
    },
    // The machine's converter path (lane V seam 3B): the agent data folder's
    // settings.json, never a workspace file or environment variable.
    mediaConverterPath: () => runtimeConverterPath(agentDataFolder(deps)),
    // D78's exact reservation for Muse Voice's batch transcription (lane V
    // seam 4): the runtime's own daily ledger, a hard cap in every editor.
    reservePaidExtra: async (costUsd, signal) => {
      const budget = await dailyBudget()
      const claim = await budget.reserve(costUsd, signal)
      return {
        reservedUsd: claim.reservedUsd,
        check: () => {
          claim.check(claim.reservedUsd)
        },
        settle: (amountUsd, hasUnknownCost) => claim.settle(amountUsd, hasUnknownCost),
      }
    },
    ...(deps.exec === undefined && {
      getProviderAccountId: async () => {
        const subscriptions = await subscriptionClient()
        return await subscriptions.accountId()
      },
    }),
    ...(deps.exec?.providerRun !== undefined && {
      getProviderAccountId: async () => {
        if (headlessProviders === undefined) throw new Error(UI_TEXT.execModelUnpriced)
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
    // M82's cap and reply line are VS Code settings; ACP exposes neither.
    sessionBudgetUsd: () => Usd.from(SETTING_DEFAULTS.modelApiSessionBudgetUsd).toAmount(),
    pacingOwner: deps,
    strictTools: () => SETTING_DEFAULTS.modelApiStrictTools,
    parallelReads: () => SETTING_DEFAULTS.modelApiParallelReads,
    webSearchMaxPerRequest: () => SETTING_DEFAULTS.webSearchMaxPerRequest,
    isAutoCompactionOn: () =>
      deps.options.autoCompaction ?? SETTING_DEFAULTS.modelApiAutoCompaction,
    autoCompactionEvaluated: () => IS_AUTO_COMPACTION_EVALUATED,
    // The wrapped runtime transport owns one daily claim per HTTP attempt.
    autoCompactionAccounting: 'transport',
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
  const museCode = museCodeManager(deps, undefined)
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
  const credentials = new CredentialStore(
    deps.secrets,
    (message) => {
      deps.log.warn(message)
    },
    "the operating system's credential store",
  )
  const paid = new AcpPaidUse({
    flagged: deps.options.paidFeatures,
    autoCompactionEvaluated: () => IS_AUTO_COMPACTION_EVALUATED,
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
      // A refused providers file is not a keyring outage: the runtime is
      // already on the account service, so its own refusal stands as read
      // through the runtime's wrapped metadata port.
      if (isInvalidProvidersFileError(error))
        return { state: 'unavailable', message: accountErrorText(error) }
      return {
        state: 'unavailable',
        message: fill(UI_TEXT.acpStoreUnavailable, { reason: describe(error) }),
      }
    }
    if (deps.exec?.providerRun !== undefined) return { state: 'ready' }
    if (deps.exec === undefined && (key === undefined || key === '')) {
      try {
        if ((await deps.secrets.get(`${PROVIDER_SECRET_PREFIX}chatgpt`)) !== undefined)
          return { state: 'ready' }
        const configFile = path.join(
          deps.env['XDG_CONFIG_HOME'] ?? path.join(deps.homeDir, '.config'),
          PROVIDERS_CONFIG_DIR_NAME,
          PROVIDERS_FILE_NAME,
        )
        if (existsSync(configFile)) {
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
      } catch {
        return { state: 'unavailable', message: UI_TEXT.acpChatGpt.storeUnavailable }
      }
    }
    return key === undefined || key === ''
      ? { state: 'signedOut', message: UI_TEXT.acpNoStoredKey }
      : { state: 'ready' }
  }

  const modelApiHostFor = async (cwd: string): Promise<AgentHost> => {
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
      cwd,
      canonical,
      homes,
      paid,
      edits,
      assertWorkspaceCurrent,
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
  return {
    readUsageBudgets: async () => {
      const budgets = await Promise.all(
        Array.from(modelApiHosts.values(), ({ manager }) => manager.readUsageBudgets()),
      )
      return budgets.flat()
    },
    backend: {
      kind: deps.options.backend,
      readiness: (isRecheck) =>
        deps.options.backend === 'modelApi' ? modelApiReadiness() : museCodeReadiness(isRecheck),
      hostFor,
    },
    configureOutputSchema: async (sessionId, model, mode, schema) => {
      if (deps.options.backend !== 'modelApi') throw new Error(UI_TEXT.execRequestShape)
      for (const { manager } of modelApiHosts.values()) {
        const host = await manager.ensureHost()
        if (host.configureOutputSchema(sessionId, model, mode, schema)) return
      }
      throw new Error(UI_TEXT.execRequestShape)
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
    forgetUnflaggedGrants: () =>
      deps.exec === undefined && deps.options.backend === 'modelApi'
        ? paid.forgetUnflagged()
        : Promise.resolve(),
    close: async () => {
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
