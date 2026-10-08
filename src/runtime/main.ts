import { legalScanLoader } from '../host/ide/legalScanBundle'
// `muse-spark-code-acp` (PLAN.md D62): the Muse Spark agent for editors that
// speak the Agent Client Protocol, and the sign-in commands their terminal
// sign-ins run (D61). stdout carries the protocol; everything the user or
// the log reads goes to stderr, except the sign-in commands' own output.
// Exercised through the built `dist/acp.js` by the stdio e2e test.

import { spawnResourceProcess, handoffResourceFile } from '../core/resources/admission'
import { isResourcePaused } from '../core/resources/paused'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { open, writeFile, realpath, lstat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { homedir, hostname, tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { Writable } from 'node:stream'
import type { SignInMethod } from '../acp/agent'
import { runtimeQuestionsLoader } from './questions/questionRegistryBundle'
import { processGitRunner } from '../host/git'
import { loadUiTable, readUiTableFile } from '../host/l10n'
import {
  ACP_AGENT_NAME,
  ESTIMATOR_BUNDLE_FILE,
  RUNTIME_QUESTIONS_BUNDLE_FILE,
  PLAYBOOK_BUNDLE_FILE,
  RUNTIME_ACCOUNTS_BUNDLE_FILE,
  ACP_AUTH_METHODS,
  EXEC_EXIT,
  EXEC_SCAN_TIMEOUT_MS,
  EXEC_FORCE_WRITE_MS,
  MEMORY_STAGE_FILE_MODE,
  EXTENSION_HOOKS_BUNDLE_FILE,
  FONT_INSTALL_BUNDLE_FILE,
  FONT_PACK_SUBFOLDER,
  SEARCH_WORKER_FILE,
  SECRET_KEYS,
  EXEC_STOP_GRACE_MS,
  LEGAL_EXIT,
  LEGAL_SCAN_TIMEOUT_MS,
  LEGAL_SCAN_BUNDLE_FILE,
  PROVIDERS_CONFIG_DIR_NAME,
  PROVIDERS_FILE_NAME,
  SETTING_DEFAULTS,
  USAGE_HISTORY_DAYS_DEFAULT,
  UI_TEXT,
  REFERENCE_BUNDLE_FILE,
  SESSION_EXPORT_MAX_BYTES,
  REPORT_SOURCE_TIMEOUT_MS,
} from '../shared/constants'
import type { SecretStore } from '../host/auth/credentialStore'
import { fill, uiLocale, UI_TEXT as referenceTable } from '../shared/l10n/text'
import { setUiText as setProviderPolicyText } from '../host/backend/providerPolicyEntry'
import {
  authClear,
  authClearProvider,
  type AuthCommandDeps,
  authSet,
  authSetProvider,
  authStatus,
  authStatusProvider,
  login,
} from './authCommands'
import {
  isHeadlessCommand,
  parseCommandLine,
  type RuntimeCommand,
  type ServeOptions,
} from './cliArgs'
import { parseSharingArgs, type SharingCommand } from './sharing/args'
import { runtimeSharingLoader } from './sharing/sharingBundle'
import { acpSharingCommands } from '../acp/sharing'
import { boundedAcpStream } from '../shared/acpStream'
import type { RuntimeSharingPorts } from './sharing/sharingEntry'
import type { PlaybookCommand, PlaybookSurfacePort } from './playbook/command'
import { formatAcpUsage } from './cliOptions'
import { referenceLoader } from '../host/referenceLoader'
import { createRuntimeEstimate, runRuntimeEstimateCommand } from './estimator/ports'
import { isProcessAlive } from '../host/checkpoints/windowPresence'
import type { ReportJournal } from '../host/support/reportJournal'
import { reportEventsOf } from '../core/support/journalEvents'
import { agentDataFolder } from './dataFolder'
import { fontsBundle } from './fonts/bundle'
import { playbookLoader } from './playbook/playbookBundle'
import { runReportCommand } from './reportCommand'
import { readSecretLine } from './hiddenInput'
import {
  credentialStoreName,
  keyringSecretStore,
  StoreUnavailableError,
  type KeyringEntry,
} from './keyStore'
import type { ChatGptProviderAction } from './chatGptProviderCommands'
import type { ProvidersDeps } from './providersCommands'
import { takeCredentials } from './credentialVariables'
import { displayLanguage } from './locale'
import { envProxyWarning } from './proxyWarning'
import type { Logger } from '../host/logger'
import { type LogLevel, stderrLogger } from './stderrLog'
import { webReadable } from './webStreams'
import { createLifecycle } from './exec/execLimits'
import { createFdWriter } from './exec/fdWriter'
import { createExecLogger, redactWhole } from './exec/execOutput'
import { runSecretScan } from './exec/scanSecrets'
import { loadLegalScanner } from './legal/legalScanner'
import { runLegalCommand } from './legal/runLegal'

import { lazyUsageAdapter, usageCompanionUrl, type UsageAdapter } from './usage/usageAdapter'

import {
  createUsageRecording,
  isUsageWriterBundle,
  type UsageRecording,
} from '../core/usage/recording'
import { requireFile } from '../host/lazyBundle'
import { extensionHooksBundle } from '../host/extensionHooksBundle'
import { fileContextIo } from '../host/backend/contextIo'
import { createToolIo } from '../host/backend/toolIo'
import { museSettingsPath } from '../host/backend/museSettings'
import { walkFiles } from './fileWalk'
import { shellJobAssembly } from '../host/backend/shellJob'
import { jobSourceReader } from '../host/backend/jobSource'
import { reportsLoader } from './reporting/reportsLoader'
import type { createRuntimeReports } from './reporting/reportsEntry'
import { runtimeSchedulesBinding } from './schedules/binding'
import { settleScheduleCommand } from './schedules/settle'

import { lazyRuntimeResources } from './resources/load'
import type { ResourceSettings } from '../shared/resources'
import { execAccountSelection } from './exec/execAccounts'
import { ACCOUNT_DEFAULT_ID } from '../shared/constants'
import { runtimeAccountsLoader, type RuntimeAccountsBundle } from './providers/accountsBundle'
import type {
  RuntimeAccountServices,
  RuntimeAccountServicesInput,
} from './providers/runtimeServices'
import { AcpVault } from '../acp/vault'
import { runtimeVaultLoader } from './vault/vaultRuntime'
import { runVaultCommand, vaultUsage } from './vault/vaultCommand'
import { chooseVaultDecision, readVaultMaterial } from './vault/vaultInput'

const EXIT_FAILED = 1
// Keep only presence for reports, before credential variables leave the process.
const META_API_KEY_VARIABLE = 'META_API_KEY'
/** The headless deadlines beside exec's own (M97 lane R: the workspace scan). */
const HEADLESS_FIXED_TIMEOUT_MS = {
  'scan-secrets': EXEC_SCAN_TIMEOUT_MS,
  legal: LEGAL_SCAN_TIMEOUT_MS,
} as const
/** What a headless command answers when its own wiring fails (D76: 2 for the scan). */
const HEADLESS_WIRING_EXIT = {
  'scan-secrets': EXEC_EXIT.usage,
  legal: LEGAL_EXIT.incomplete,
} as const
const wasEnvironmentApiKeyPresent = process.env[META_API_KEY_VARIABLE] !== undefined
// Credential variables leave the agent's own environment before anything
// starts a process; no child gets them back (FIXM95X). Removed values remain
// in memory only for D98 sharing redaction, never for authentication or children.
const sharingCredentials = takeCredentials(process.env)
// The package root holds `package.json` and `l10n/`; this file runs from `dist/`.
const distDir = __dirname
const packageRoot = path.dirname(distDir)
// Construction performs no I/O; W binds the installed lazy factory on the first need.
async function openVaultCommands() {
  const binding = await loadVault()
  return await binding.commands()
}
const acpVault = new AcpVault(openVaultCommands)
const loadVault = runtimeVaultLoader({
  dataDir: agentDataFolder({ platform: process.platform, env: process.env, homeDir: homedir() }),
  distDir,
  processId: process.pid,
  acp: acpVault,
})

/** Standalone headless commands own their process, including wedged late setup. */
function exitHeadless(code: number, shouldForce = false): never {
  if (shouldForce && process.platform === 'win32') {
    // Self-SIGKILL bypasses a blocked libuv pipe worker after bounded cleanup.
    // Windows reports exit 1; queued output is best effort (PLAN.md M80Bw).
    process.kill(process.pid, 'SIGKILL')
    throw new Error(UI_TEXT.execInterrupted)
  }
  // eslint-disable-next-line unicorn/no-process-exit -- Headless deadlines and closed/stalled pipes require a bounded final process exit after async writes (PLAN.md M80, §8).
  process.exit(code)
}

function writeLine(stream: NodeJS.WriteStream, line: string): void {
  stream.write(`${line}\n`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function packageVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
  const version =
    typeof manifest === 'object' && manifest !== null && 'version' in manifest
      ? manifest.version
      : undefined
  if (typeof version !== 'string') {
    throw new TypeError(`${packageRoot}/package.json has no version`)
  }
  return version
}

/** The OS credential store's entry; Linux is held to the Secret Service (D61). */
type KeyringEntryConstructor = new (
  service: string,
  account: string,
  options: { linux: { store: 'secret-service' } },
) => KeyringEntry
const keyringEntryClass: { value?: Promise<KeyringEntryConstructor> } = {}
async function loadEntryClass(): Promise<KeyringEntryConstructor> {
  keyringEntryClass.value ??= (async () => {
    const keyring = await import('@napi-rs/keyring')
    return keyring.AsyncEntry
  })()
  return await keyringEntryClass.value
}
/** The OS credential store's entry; Linux is held to the Secret Service (D61). */
function openKeyringEntry(service: string, account: string): KeyringEntry {
  const loaded: { value?: Promise<KeyringEntry> } = {}
  const entry = async (): Promise<KeyringEntry> => {
    loaded.value ??= (async () => {
      const AsyncEntry = await loadEntryClass()
      return new AsyncEntry(service, account, { linux: { store: 'secret-service' } })
    })()
    return await loaded.value
  }
  return {
    getPassword: async (): Promise<string | undefined> => {
      const open = await entry()
      const secret = await open.getPassword()
      return secret ?? undefined
    },
    setPassword: async (value: string): Promise<void> => {
      const open = await entry()
      await open.setPassword(value)
    },
    deletePassword: async (): Promise<boolean> => {
      const open = await entry()
      return await open.deletePassword()
    },
  }
}
const nativeStore: { value?: Promise<SecretStore> } = {}
async function loadSecrets(): Promise<SecretStore> {
  nativeStore.value ??= (async () => {
    const { AsyncEntry } = await import('@napi-rs/keyring')
    return keyringSecretStore(
      (service, account) =>
        new AsyncEntry(service, account, { linux: { store: 'secret-service' } }),
    )
  })()
  try {
    return await nativeStore.value
  } catch {
    throw new StoreUnavailableError()
  }
}
const secrets: SecretStore = {
  async get(name) {
    const store = await loadSecrets()
    return await store.get(name)
  },
  async store(name, value) {
    const store = await loadSecrets()
    await store.store(name, value)
  },
  async delete(name) {
    const store = await loadSecrets()
    await store.delete(name)
  },
}

/** A held regular-file descriptor bounds both stat size and growth while reading. */
async function readBoundedFile(
  file: string,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  signal.throwIfAborted()
  const handle = await open(file, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error(UI_TEXT.execFileUnreadable)
    if (info.size > maxBytes) throw new Error(UI_TEXT.execFileTooLarge)
    const bytes = new Uint8Array(maxBytes + 1)
    let offset = 0
    for (;;) {
      signal.throwIfAborted()
      const part = await handle.read(bytes, offset, bytes.length - offset, null)
      offset += part.bytesRead
      if (offset > maxBytes) throw new Error(UI_TEXT.execFileTooLarge)
      if (part.bytesRead === 0) break
    }
    return bytes.subarray(0, offset)
  } finally {
    await handle.close()
  }
}

/**
 * This agent process's flight recorder (M93, PLAN.md D72): the extension's
 * own ReportJournal, with the same policy, under the agent's data folder
 * (no workspace needed). Each process writes only its own journal; `report`
 * reads them all.
 */
async function reportJournal(log: Logger): Promise<ReportJournal> {
  const { ReportJournal } = await import('../host/support/recorderEntry')
  return new ReportJournal({
    globalStorageDir: agentDataFolder({
      platform: process.platform,
      env: process.env,
      homeDir: homedir(),
    }),
    instance: randomUUID(),
    ext: packageVersion(),
    host: process.versions.node,
    pid: process.pid,
    log,
    isAlive: isProcessAlive,
  })
}

function authDeps(): AuthCommandDeps {
  return {
    secrets,
    storeName: credentialStoreName(process.platform),
    readSecret: (prompt) => readSecretLine(prompt, process.stdin, process.stderr),
    print: (line) => {
      writeLine(process.stdout, line)
    },
    printError: (line) => {
      writeLine(process.stderr, line)
    },
  }
}

async function chatGptDeps() {
  const bundle = await import('./chatGptProviderCommands')
  const commands = bundle.runtimeChatGptCommandDeps({
    uiText: UI_TEXT,
    locale: uiLocale(),
    secrets,
    fetch: globalThis.fetch.bind(globalThis),
    configFile: path.join(
      process.env['XDG_CONFIG_HOME'] ?? path.join(homedir(), '.config'),
      PROVIDERS_CONFIG_DIR_NAME,
      PROVIDERS_FILE_NAME,
    ),
    callbackText: () => UI_TEXT.acpChatGpt.callback,
    openBrowser: (url) => {
      writeLine(process.stdout, url)
      return Promise.resolve()
    },
    print: (line) => {
      writeLine(process.stdout, line)
    },
    printError: (line) => {
      writeLine(process.stderr, line)
    },
  })
  return {
    signIns: bundle.chatGptAuthenticationMethods(() => commands.createHost()),
    run: (action: ChatGptProviderAction) => bundle.runChatGptProviderCommand(action, commands),
  }
}

/** The runner's own user file (never a repository file). */
async function userProvidersFile() {
  const { userFileIo, providersFilePath } = await import('./providersCommands')
  return userFileIo(
    providersFilePath({
      platform: process.platform,
      homeDir: homedir(),
      xdgConfigHome: process.env['XDG_CONFIG_HOME'],
    }),
  )
}

/** The `providers …` commands' dependencies: the user's own file, the OS store, stdin. */
async function providersDeps(): Promise<ProvidersDeps> {
  const { resolveEndpointHost } = await import('./providersCommands')
  return {
    ...authDeps(),
    ...(await userProvidersFile()),
    resolveHost: resolveEndpointHost,
    fetch: globalThis.fetch.bind(globalThis),
  }
}

function signInMethod(options: ServeOptions): SignInMethod {
  if (options.backend === 'modelApi') {
    const { id, args } = ACP_AUTH_METHODS.modelApiKey
    return {
      id,
      name: UI_TEXT.acpAuthKeyName,
      description: UI_TEXT.acpAuthKeyDetail,
      args,
      command: `${ACP_AGENT_NAME} ${args.join(' ')}`,
    }
  }
  const { id, args } = ACP_AUTH_METHODS.museCodeLogin
  return {
    id,
    name: UI_TEXT.acpAuthMuseCodeName,
    description: UI_TEXT.acpAuthMuseCodeDetail,
    args,
    command: `${ACP_AGENT_NAME} ${args.join(' ')}`,
  }
}

async function runtimeFor(
  options: ServeOptions,
  log: Logger,
  questions?: { remove(sessionId: string): Promise<void> },
) {
  const engine = await import('./runtimeEngineEntry')
  engine.setUiText(UI_TEXT, uiLocale())
  return engine.createRuntimeBackend({
    options,
    version: packageVersion(),
    distDir,
    platform: process.platform,
    env: process.env,
    homeDir: homedir(),
    secrets,
    runGit: processGitRunner(),
    fetch: globalThis.fetch.bind(globalThis),
    sleep,
    log,
    ...(questions !== undefined && { questions }),
  })
}

function resourcesFor(log: Logger, overrides?: Partial<ResourceSettings>) {
  return lazyRuntimeResources({
    distDir,
    machineDir: agentDataFolder({
      platform: process.platform,
      env: process.env,
      homeDir: homedir(),
    }),
    sleep,
    log,
    onError: () => {
      log.warn(UI_TEXT.resourceUnavailable)
    },
    ...(overrides !== undefined && { overrides }),
  })
}

/** No account or backend is touched; W ships this entry in its own lazy chunk. */
function runtimeReports(log: Logger): () => ReturnType<typeof createRuntimeReports> {
  const load = reportsLoader({ bundlePath: path.join(distDir, 'reporting.js'), log })
  let reports: ReturnType<typeof createRuntimeReports> | undefined
  return () => {
    reports ??= load().createRuntimeReports({
      cwd: process.cwd(),
      locale: uiLocale(),
      table: UI_TEXT,
      now: () => new Date().toISOString(),
      roots: [homedir()],
      servicesFor: (cwd, _sessionId, language) =>
        Promise.resolve({
          keepHistory: true,
          services: load().createReportingServices({
            workspaceRoot: cwd,
            log,
            storageRoot: agentDataFolder({
              platform: process.platform,
              env: process.env,
              homeDir: homedir(),
            }),
            l10n: language ?? { table: UI_TEXT, locale: uiLocale() },
            generatorVersion: packageVersion(),
            keepHistory: true,
            enabledAgents: [],
            network: {
              policy: {
                surface: 'terminal',
                mode: 'always',
                githubSignedIn: false,
                allowEgress: () => Promise.resolve(process.env['CI'] === undefined),
              },
            },
          }),
        }),
      resolveSaved: async (cwd, file) => {
        const target = path.resolve(cwd, file)
        const info = await lstat(target)
        if (info.isSymbolicLink()) throw new Error(UI_TEXT.reportUi.generationFailed)
        return await realpath(target)
      },
      readSaved: async (cwd, file) => {
        const bytes = await readBoundedFile(
          path.resolve(cwd, file),
          SESSION_EXPORT_MAX_BYTES,
          AbortSignal.timeout(REPORT_SOURCE_TIMEOUT_MS),
        )
        const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
        return value
      },
      writeOut: async (cwd, file, text) => {
        await writeFile(path.resolve(cwd, file), text, { encoding: 'utf8', mode: 0o600 })
      },
      readTable: async (locale) => {
        const value: unknown = JSON.parse(
          await readUiTableFile(packageRoot, ['l10n', `ui.${locale}.json`]),
        )
        return value
      },
      stdout: (text) => {
        process.stdout.write(text)
      },
      stderr: (text) => {
        writeLine(process.stderr, text)
      },
    })
    return reports
  }
}

/** Explicit trusted Setup runs neither an account probe nor a model request. */
async function setupHooks(
  options: ServeOptions,
  isMaintenance: boolean,
  log: Logger,
): Promise<number> {
  const workspaceRoot = process.cwd()
  const systemRoot = process.env['SystemRoot']
  const io = createToolIo({
    platform: process.platform,
    listFiles: (signal) => walkFiles(workspaceRoot, 1, log, signal),
    systemRoot,
    searchWorkerPath: path.join(distDir, SEARCH_WORKER_FILE),
    env: () => process.env,
    log: (message) => {
      log.warn(message)
    },
    unsavedFiles: () => [],
    shellJobAssembly:
      systemRoot !== undefined && process.platform === 'win32'
        ? shellJobAssembly({
            storageDir: path.join(tmpdir(), ACP_AGENT_NAME),
            systemRoot,
            readJobSource: jobSourceReader(packageRoot),
            log: (message) => {
              log.warn(message)
            },
          })
        : undefined,
  })
  const runHook = io.runHook?.bind(io)
  if (runHook === undefined) throw new Error(UI_TEXT.hooksNotRunnable)
  const bundle = await extensionHooksBundle(
    path.join(distDir, EXTENSION_HOOKS_BUNDLE_FILE),
    log,
  ).loadBundle()
  const runner = bundle.createExtensionHookRunner(
    {
      io: fileContextIo,
      runHook,
      platform: process.platform,
      workspaceRoot,
      settingsPath: museSettingsPath({
        platform: process.platform,
        homeDir: homedir(),
        xdgConfigHome: process.env['XDG_CONFIG_HOME'],
      }),
      isWorkspaceTrusted: () => options.trustWorkspace,
      isHooksEnabled: () => options.trustWorkspace,
      now: () => Date.now(),
      notice: (_level, text) => {
        writeLine(process.stderr, text)
      },
      showOutput: (_title, text) => {
        writeLine(process.stdout, text)
      },
      warn: (message) => {
        log.warn(message)
      },
    },
    UI_TEXT,
    uiLocale(),
  )
  const result = await runner.runSetup(isMaintenance ? 'maintenance' : 'init')
  if (result.failedReason !== undefined) {
    writeLine(process.stderr, fill(UI_TEXT.setupHooksFailed, { reason: result.failedReason }))
    return EXIT_FAILED
  }
  if (result.ran === 0) writeLine(process.stderr, UI_TEXT.setupHooksNone)
  return 0
}

function usageFor(
  log: Logger,
  recording?: UsageRecording,
  runtime?: Pick<Awaited<ReturnType<typeof runtimeFor>>, 'readUsageBudgets'>,
  isHistoryEnabled = true,
): UsageAdapter {
  return lazyUsageAdapter({
    dataFolder: agentDataFolder({
      platform: process.platform,
      env: process.env,
      homeDir: homedir(),
    }),
    packageRoot,
    host: hostname(),
    locale: uiLocale(),
    uiText: UI_TEXT,
    log,
    historySettings: () => ({ enabled: isHistoryEnabled, days: USAGE_HISTORY_DAYS_DEFAULT }),
    ...(recording !== undefined && {
      beforeRead: () => recording.flush(),
      live: {
        readBudgets: runtime?.readUsageBudgets ?? (() => Promise.resolve([])),
        readLiveLimits: () => Promise.resolve(recording.limits?.() ?? []),
        providerConsoles: () => [],
      },
    }),
  })
}

async function openUsageBrowser(input: string): Promise<void> {
  const url = usageCompanionUrl(input)
  let executable = 'xdg-open'
  if (process.platform === 'darwin') executable = 'open'
  else if (process.platform === 'win32') executable = 'rundll32.exe'
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url]
  // The fixed OS opener receives only a checked loopback URL and no credential
  // environment; argument arrays never pass through a shell (D82, rule 8).
  try {
    await handoffResourceFile(executable, args, { env: process.env })
  } catch (error: unknown) {
    if (isResourcePaused(error)) throw error
    // Opener output goes to the null device; only fixed words are reported.
    throw new Error(UI_TEXT.actionFailed, { cause: error })
  }
}

async function serve(
  options: ServeOptions,
  log: Logger,
  loadAccounts: () => RuntimeAccountServices,
): Promise<number> {
  let clientName = 'ACP'
  const recording = createUsageRecording({
    client: () => clientName,
    now: Date.now,
    newId: randomUUID,
    isEnabled: () => options.usageHistory ?? true,
    log,
    writer: async (onWriteError) => {
      const bundle = requireFile(path.join(distDir, 'usageService.js'))
      if (!isUsageWriterBundle(bundle)) throw new Error(UI_TEXT.actionFailed)
      return await bundle.createUsageWriter({
        dataFolder: agentDataFolder({
          platform: process.platform,
          env: process.env,
          homeDir: homedir(),
        }),
        writerId: randomUUID(),
        now: Date.now,
        isEnabled: () => options.usageHistory ?? true,
        onWriteError,
      })
    },
  })
  const engine = await import('./runtimeEngineEntry')
  engine.setUiText(UI_TEXT, uiLocale())
  const restoreRecording = engine.installUsageRecording(recording)
  try {
    const directory = path.join(
      agentDataFolder({ platform: process.platform, env: process.env, homeDir: homedir() }),
      'questions',
    )
    const loadQuestions = runtimeQuestionsLoader(
      path.join(distDir, RUNTIME_QUESTIONS_BUNDLE_FILE),
      log,
    )
    const loadPlaybook = playbookLoader(path.join(distDir, PLAYBOOK_BUNDLE_FILE), log)
    const registries: { flush(): Promise<void>; dispose(): void }[] = []
    const runtime = await runtimeFor(options, log, {
      remove: (id) => loadQuestions().removeRuntimeQuestions(directory, id, UI_TEXT, uiLocale()),
    })
    const resources = resourcesFor(log)
    const loadSchedules = runtimeSchedulesBinding(path.join(distDir, 'schedules.js'), log)
    let loadedSchedules: Awaited<ReturnType<typeof loadSchedules>> | undefined
    const usage = usageFor(log, recording, runtime, options.usageHistory ?? true)
    const journal = await reportJournal(log)
    await journal.startup()
    // A proxy the Model API backend's requests will not use is said at once (Q66).
    const proxyWarning = envProxyWarning({
      backend: options.backend,
      platform: process.platform,
      env: process.env,
      execArgv: process.execArgv,
      nodeVersion: process.version,
    })
    if (proxyWarning !== undefined) {
      log.warn(proxyWarning)
    }
    // "Allow always" lapses for a paid feature started without its flag (M58).
    await runtime.forgetUnflaggedGrants()
    const providerCommands = await chatGptDeps()
    const legalRegistryNotices = new Map<string, Set<string>>()
    const agentLegalBundle = legalScanLoader({
      bundlePath: path.join(distDir, LEGAL_SCAN_BUNDLE_FILE),
      log,
    })
    const reports = runtimeReports(log)
    const agent = engine.createAcpAgent({
      schedules: {
        async holdWorkspace(cwd) {
          loadedSchedules ??= await loadSchedules()
          return await loadedSchedules.holdWorkspace(cwd)
        },
        async run(text, context) {
          try {
            loadedSchedules ??= await loadSchedules()
            return await loadedSchedules.run(text, context)
          } catch {
            return UI_TEXT.scheduleV2.runtime.unavailable
          }
        },
      },
      playbookFor: (cwd) =>
        loadPlaybook().createPlaybookSurface(
          {
            agentDataFolder: agentDataFolder({
              platform: process.platform,
              env: process.env,
              homeDir: homedir(),
            }),
            workspaceFolder: cwd,
            teamId: 'panel',
            laneId: 'surface',
          },
          UI_TEXT,
          uiLocale(),
        ),
      reports: { format: 'md', execute: (args, context) => reports().acp.execute(args, context) },
      vault: acpVault,
      ...(options.backend === 'modelApi' && { accounts: loadAccounts().sessions('meta') }),
      legalScan: async (cwd, signal, isRegistryOn, allowsRegistryLookup) => {
        const bundle = agentLegalBundle()
        const handle = await bundle.runLegalScan({ workspaceRoot: cwd, input: {}, signal })
        const render = bundle.renderLegalMarkdown
        if (render === undefined) throw new Error(UI_TEXT.legalScanUnavailable)
        signal.throwIfAborted()
        const enrich = bundle.enrichInteractiveLegalScan
        if (enrich === undefined) throw new Error(UI_TEXT.legalScanUnavailable)
        const noticed = legalRegistryNotices.get(cwd) ?? new Set<string>()
        legalRegistryNotices.set(cwd, noticed)
        const result = await enrich(handle, {
          isOn: () => isRegistryOn,
          isNoticed: (host) => noticed.has(host),
          notice: allowsRegistryLookup,
          markNoticed: (hosts) => {
            for (const host of hosts) noticed.add(host)
            return Promise.resolve()
          },
          fetch: globalThis.fetch.bind(globalThis),
          signal,
        })
        return render(result)
      },

      onClientName: (name) => {
        clientName = name
      },
      backend: runtime.backend,
      version: packageVersion(),
      options: {
        canBypass: options.canBypass,
        allowsContributorModels: options.allowsContributorModels,
        initialMode: SETTING_DEFAULTS.initialPermissionMode,
        scheduleAuthorization: {
          scheduledPrompts: options.scheduledPrompts === true,
          ...(options.maxBudgetUsd !== undefined && { maxBudgetUsd: options.maxBudgetUsd }),
        },
        ...(options.questionsDeferAfterSeconds !== undefined && {
          questionsDeferAfterSeconds: options.questionsDeferAfterSeconds,
        }),
      },
      signIn: signInMethod(options),
      providerSignIns: providerCommands.signIns,
      defaultCwd: process.cwd(),
      sharing: {
        commands: acpSharingCommands,
        execute: (text, context) =>
          runtimeSharingLoader(path.join(distDir, 'sharingRuntime.js'), log)()
            .runtimeAcpSharing(sharingPorts(log, runtime), UI_TEXT, uiLocale())
            .execute(text, context),
      },
      paid: runtime.paid,
      playbookBundle: () => {
        const bundle = loadPlaybook()
        return {
          parsePlaybookCommand: (argv: readonly string[]) => bundle.parsePlaybookCommand(argv),
          runPlaybookCommand: (command: PlaybookCommand, port: PlaybookSurfacePort | undefined) =>
            bundle.runPlaybookCommand(command, port, UI_TEXT, uiLocale()),
        }
      },
      estimate: createRuntimeEstimate({
        bundlePath: path.join(distDir, ESTIMATOR_BUNDLE_FILE),
        log,
      }),
      questions: (input) => {
        const registry = loadQuestions().createRuntimeQuestionRegistry(
          input,
          directory,
          options.backend,
          () => {
            log.warn('Question operation failed')
          },
          UI_TEXT,
          uiLocale(),
        )
        registries.push(registry)
        return registry
      },
      log,
      usage,
      resources,
      reportError: (fact) => {
        void journal.record(fact)
      },
    })
    const connection = agent.connect(
      boundedAcpStream(
        engine.ndJsonStream,
        Writable.toWeb(process.stdout),
        webReadable(process.stdin),
      ),
    )
    log.info(`${ACP_AGENT_NAME} ${packageVersion()} serving ACP on stdio (${options.backend})`)
    try {
      await connection.closed
    } finally {
      await Promise.allSettled(
        registries.map((registry) => {
          registry.dispose()
          return registry.flush()
        }),
      )
      try {
        await loadedSchedules?.close()
      } finally {
        try {
          await usage.dispose()
        } finally {
          try {
            resources.dispose()
          } finally {
            try {
              await runtime.close()
            } finally {
              await journal.shutdown()
            }
          }
        }
      }
    }
    return 0
  } finally {
    await recording.flush()
    restoreRecording()
  }
}

function sharingPorts(
  log: Logger,
  current?: Awaited<ReturnType<typeof runtimeFor>>,
): RuntimeSharingPorts {
  return {
    folders: { platform: process.platform, env: process.env, homeDir: homedir() },
    registeredSecrets: async () => {
      const values = sharingCredentials.map(({ value }) => value)
      if (current?.backend.kind !== 'modelApi') return values
      try {
        const key = await secrets.get(SECRET_KEYS.modelApiKey)
        return key === undefined || key === '' ? values : [...values, key]
      } catch {
        // A key refresh that cannot complete grants no share and discloses no store failure.
        throw new Error(UI_TEXT.sharePreviewExpired)
      }
    },
    read: async (cwd, sessionId, exportedAt) => {
      const parsed = parseCommandLine(['serve'])
      if (parsed.command !== 'serve') throw new Error(UI_TEXT.exportHistoryUnavailable)
      const runtime = current ?? (await runtimeFor(parsed.options, log))
      try {
        const host = await runtime.backend.hostFor(cwd)
        const history = await host.readSession(sessionId)
        if (history.mode === 'none') throw new Error(UI_TEXT.exportHistoryUnavailable)
        return {
          sessionId,
          title: history.name ?? UI_TEXT.exportDefaultTitle,
          exportedAt,
          items: history.items,
        }
      } finally {
        if (current === undefined) await runtime.close()
      }
    },
  }
}

function logLevel(command: RuntimeCommand | SharingCommand): LogLevel {
  if (command.command !== 'serve') {
    return 'warn'
  }
  return command.options.isVerbose ? 'trace' : 'info'
}

async function main(): Promise<number> {
  if (process.argv[2] === 'share' || process.argv[2] === 'prompts')
    await loadUiTable({
      language: displayLanguage(process.env, new Intl.DateTimeFormat().resolvedOptions().locale),
      readExtensionFile: (segments) => readUiTableFile(packageRoot, segments),
      log: stderrLogger((line) => {
        writeLine(process.stderr, line)
      }, 'warn'),
    })
  const command = parseCommandLine(process.argv.slice(2), parseSharingArgs)
  const servicesInput: RuntimeAccountServicesInput = {
    dataDir: agentDataFolder({
      platform: process.platform,
      env: process.env,
      homeDir: homedir(),
    }),
    openEntry: openKeyringEntry,
  }
  let cachedBundle: RuntimeAccountsBundle | undefined
  const loadAccountsBundle = (log: Logger): RuntimeAccountsBundle => {
    cachedBundle ??= runtimeAccountsLoader({
      bundlePath: path.join(distDir, RUNTIME_ACCOUNTS_BUNDLE_FILE),
      log,
    })()
    return cachedBundle
  }
  let cachedAccounts: RuntimeAccountServices | undefined
  const loadAccounts = (log: Logger): RuntimeAccountServices => {
    cachedAccounts ??= loadAccountsBundle(log).createRuntimeAccountServicesForLocale(
      UI_TEXT,
      uiLocale(),
      servicesInput,
    )
    return cachedAccounts
  }
  if (command.command === 'invalid' && command.exitCode === EXEC_EXIT.usage) {
    const stderr = createFdWriter(process.stderr.fd, () => {
      /* A usage error already owns exit 2; a closed pipe cannot turn it into success. */
    })
    stderr.write(`${redactWhole(command.reason, [])}\n`)
    const isFlushed = await stderr.flush(EXEC_FORCE_WRITE_MS)
    exitHeadless(EXEC_EXIT.usage, !isFlushed)
  }
  if (command.command !== 'share' && command.command !== 'prompts' && isHeadlessCommand(command)) {
    const closed = () => {
      lifecycle.latch({ kind: 'output_closed' })
    }
    const stdout = createFdWriter(process.stdout.fd, closed)
    const stderr = createFdWriter(process.stderr.fd, closed)
    const now = () => performance.timeOrigin + performance.now()
    const headlessTimeoutMs =
      command.command === 'exec'
        ? command.options.timeoutMs
        : HEADLESS_FIXED_TIMEOUT_MS[command.command]
    const lifecycle = createLifecycle({
      processStartMs: performance.timeOrigin,
      timeoutMs: headlessTimeoutMs,
      now,
      setTimer: (ms, callback) => {
        const timer = setTimeout(callback, ms)
        return () => {
          clearTimeout(timer)
        }
      },
      onSignal: (signal, callback) => {
        process.on(signal, callback)
        return () => {
          process.off(signal, callback)
        }
      },
      forceFinish: () => {
        void Promise.all([stdout.flush(EXEC_FORCE_WRITE_MS), stderr.flush(EXEC_FORCE_WRITE_MS)])
      },
      exit: (code) => exitHeadless(code, true),
    })
    const log = createExecLogger({
      stderr,
      literals: () => [],
      verbose: command.command === 'exec' && command.options.isVerbose,
    })
    let headlessCode: number = EXEC_EXIT.internal
    try {
      try {
        await lifecycle.race(
          loadUiTable({
            language: displayLanguage(
              process.env,
              new Intl.DateTimeFormat().resolvedOptions().locale,
            ),
            readExtensionFile: (segments) => readUiTableFile(packageRoot, segments),
            log,
          }),
        )
      } catch {
        /* The bundled English table is already installed; stop still owns the deadline. */
      }
      setProviderPolicyText(UI_TEXT, uiLocale())
      if (command.command === 'scan-secrets') {
        try {
          headlessCode = await lifecycle.race(
            runSecretScan({
              file: command.file,
              keyFromStdin: command.keyFromStdin,
              stdin: process.stdin,
              signal: lifecycle.signal,
              readFile: readBoundedFile,
              out: stdout,
            }),
          )
          return headlessCode
        } catch {
          headlessCode = EXEC_EXIT.usage
          return headlessCode
        }
      }
      // The reserved read-only scan (M97 lane R): no backend, no auth, no
      // model. stdout carries only the rendered report; every other word
      // goes to stderr, as the sign-in commands' own output does.
      if (command.command === 'legal') {
        try {
          const outcome = await lifecycle.race(
            runLegalCommand({
              options: command.options,
              deps: {
                scan: (scanInput) =>
                  loadLegalScanner({ distDir }).scan({
                    workspaceRoot: process.cwd(),
                    input: scanInput,
                    signal: lifecycle.signal,
                  }),
                fetch: globalThis.fetch.bind(globalThis),
                writeFile: (file, data) => writeFile(file, data, 'utf8'),
                signal: lifecycle.signal,
              },
            }),
          )
          if (outcome.out !== '') stdout.write(outcome.out)
          if (outcome.err !== '') stderr.write(`${outcome.err}\n`)
          const [outFlushed, errFlushed] = await Promise.all([
            stdout.flush(EXEC_STOP_GRACE_MS),
            stderr.flush(EXEC_STOP_GRACE_MS),
          ])
          headlessCode =
            outFlushed && errFlushed && !lifecycle.signal.aborted
              ? outcome.exitCode
              : LEGAL_EXIT.incomplete
          return headlessCode
        } catch (error: unknown) {
          log.error(error instanceof Error ? error.message : String(error))
          headlessCode = LEGAL_EXIT.incomplete
          return headlessCode
        }
      }
      const { runHeadless } = await import('./exec/execEntry.js')
      headlessCode = await runHeadless(
        lifecycle,
        {
          ...((command.options.accountPool === true ||
            execAccountSelection(command.options).account !== ACCOUNT_DEFAULT_ID) && {
            accounts: loadAccounts(log).exec,
          }),
          vault: {
            open: async (context) => {
              const binding = await loadVault()
              return await binding.exec.open(context)
            },
          },
          options: command.options,
          version: packageVersion(),
          distDir,
          platform: process.platform,
          env: process.env,
          homeDir: homedir(),
          processCwd: process.cwd(),
          stdin: process.stdin,
          stdout,
          stderr,
          storeSecrets: secrets,
          runGit: processGitRunner(),
          fetch: globalThis.fetch.bind(globalThis),
          sleep,
          now,
          readFile: readBoundedFile,
          randomHex: (bytes) => randomBytes(bytes).toString('hex'),
          log,
          resourceOverrides: command.resourceOverrides,
          createResources: (overrides) => resourcesFor(log, overrides),
        },
        referenceTable,
        uiLocale(),
      )
      return headlessCode
    } catch (error: unknown) {
      log.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
      await stderr.flush(lifecycle.remainingGraceMs())
      headlessCode =
        command.command === 'exec' ? EXEC_EXIT.internal : HEADLESS_WIRING_EXIT[command.command]
      return headlessCode
    } finally {
      if (command.command === 'scan-secrets')
        await Promise.all([
          stdout.flush(lifecycle.remainingGraceMs()),
          stderr.flush(lifecycle.remainingGraceMs()),
        ])
      lifecycle.dispose()
      exitHeadless(
        headlessCode,
        stdout.isClosed || stderr.isClosed || stdout.queuedBytes > 0 || stderr.queuedBytes > 0,
      )
    }
  }
  const log = stderrLogger((line) => {
    writeLine(process.stderr, line)
  }, logLevel(command))
  // The language's table goes in before anything reads the text (D33).
  await loadUiTable({
    language: displayLanguage(process.env, new Intl.DateTimeFormat().resolvedOptions().locale),
    readExtensionFile: (segments) => readUiTableFile(packageRoot, segments),
    log,
  })
  setProviderPolicyText(UI_TEXT, uiLocale())
  switch (command.command) {
    case 'resources': {
      const resources = resourcesFor(log)
      try {
        writeLine(process.stdout, await resources.command(command.action, command.json))
        return 0
      } catch {
        writeLine(process.stderr, UI_TEXT.resourceUnavailable)
        return EXIT_FAILED
      } finally {
        resources.dispose()
      }
    }
    case 'fontsInstall': {
      const manifest: unknown = JSON.parse(
        readFileSync(path.join(packageRoot, 'design', 'fonts', 'manifest.json'), 'utf8'),
      )
      const installed = await fontsBundle(
        path.join(distDir, FONT_INSTALL_BUNDLE_FILE),
        log,
      )().installFonts(
        {
          manifest,
          directory: path.join(
            agentDataFolder({ platform: process.platform, env: process.env, homeDir: homedir() }),
            FONT_PACK_SUBFOLDER,
          ),
          sourceDirectory: command.sourceDirectory,
          fetch: globalThis.fetch.bind(globalThis),
        },
        UI_TEXT,
        uiLocale(),
      )
      writeLine(process.stdout, fill(UI_TEXT.acpFontInstalled, { directory: installed }))
      return 0
    }
    case 'usage': {
      const usage = usageFor(log)
      const lines =
        command.options.action === 'stdio'
          ? createInterface({ input: process.stdin, crlfDelay: Infinity })
          : undefined
      let isPageOpen = false
      try {
        const result = await usage.runCommand(command.options, {
          usage: usage.access(),
          openPage: () => usage.openPage(),
          input: lines ?? [],
          openBrowser: openUsageBrowser,
          print: (text) =>
            new Promise<void>((resolve, reject) => {
              process.stdout.write(text, (error) => {
                if (error == null) resolve()
                else reject(error)
              })
            }),
          writeFile: (file, content) =>
            writeFile(file, content, { encoding: 'utf8', mode: MEMORY_STAGE_FILE_MODE }),
        })
        isPageOpen = command.options.action === 'open'
        return result
      } finally {
        lines?.close()
        // An open page's companion owns its 30-minute idle lifetime. Other
        // commands leave no server behind; ACP closes its server on disconnect.
        if (!isPageOpen) await usage.dispose()
      }
    }
    case 'share':
    case 'prompts': {
      return await runtimeSharingLoader(
        path.join(distDir, 'sharingRuntime.js'),
        log,
      )().runRuntimeSharing(command, sharingPorts(log), UI_TEXT, uiLocale())
    }
    case 'schedule': {
      const load = runtimeSchedulesBinding(path.join(distDir, 'schedules.js'), log)
      let afterWake: (() => Promise<void>) | undefined
      try {
        if (
          command.options.operation === 'run-due' ||
          command.options.operation === 'background-maintain'
        ) {
          try {
            const { createRuntimeScheduleBackground } = await import('./schedules/backgroundEntry')
            const { verifyScheduleWake, beginScheduleWake, waitForScheduleWake } =
              createRuntimeScheduleBackground(UI_TEXT, uiLocale())
            await verifyScheduleWake(
              process.execPath,
              __filename,
              undefined,
              command.options.registrationId,
            )
            if (process.platform === 'darwin') {
              const dataDir = agentDataFolder({
                platform: process.platform,
                env: process.env,
                homeDir: homedir(),
              })
              if (command.options.operation === 'run-due')
                afterWake = await beginScheduleWake(dataDir, process.execPath, __filename)
              else await waitForScheduleWake(dataDir)
            }
          } catch (error: unknown) {
            const reason =
              error instanceof Error ? error.message : UI_TEXT.scheduleV2.runtime.invalidRequest
            writeLine(
              command.options.isJson ? process.stdout : process.stderr,
              command.options.isJson ? JSON.stringify({ kind: 'refused', reason }) : reason,
            )
            return EXIT_FAILED
          }
        }
        const binding = await load()
        const result = await settleScheduleCommand(
          () =>
            binding.command(
              command.options,
              path.resolve(command.options.cwd ?? process.cwd()),
              process.stdin.isTTY,
            ),
          async () => {
            try {
              await binding.close()
            } finally {
              await afterWake?.()
            }
          },
        )
        writeLine(process.stdout, result.output)
        if (result.warning !== undefined) writeLine(process.stderr, result.warning)
        return result.exitCode
      } catch {
        const reason = UI_TEXT.scheduleV2.runtime.unavailable
        writeLine(
          command.options.isJson ? process.stdout : process.stderr,
          command.options.isJson ? JSON.stringify({ kind: 'refused', reason }) : reason,
        )
        return EXIT_FAILED
      }
    }
    case 'vault': {
      const controller = new AbortController()
      const abort = () => {
        controller.abort()
      }
      process.once('SIGINT', abort)
      process.once('SIGTERM', abort)
      try {
        return await runVaultCommand(command.options, {
          open: openVaultCommands,
          readMaterial: (signal) => readVaultMaterial(process.stdin, process.stderr, signal),
          choose: (title, choices, signal) =>
            chooseVaultDecision(process.stdin, process.stderr, title, choices, signal),
          print: (text) => {
            writeLine(process.stdout, text)
          },
          printError: (text) => {
            writeLine(process.stderr, text)
          },
          now: Date.now,
          signal: controller.signal,
        })
      } finally {
        process.off('SIGINT', abort)
        process.off('SIGTERM', abort)
      }
    }
    case 'setup': {
      return await setupHooks(command.options, command.maintenance, log)
    }
    case 'chatGptProvider': {
      const providers = await chatGptDeps()
      return await providers.run(command.action)
    }
    case 'serve': {
      return await serve(command.options, log, () => loadAccounts(log))
    }
    case 'login': {
      const { museCode } = await runtimeFor(command.options, log)
      return await login({
        resolveLaunch: () => museCode.resolveLaunch(),
        environment: () => museCode.childEnvironment(),
        spawnInTerminal: async (file, args, env) => {
          // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- `muse login` as `muse serve` is started: the CLI resolved from its install layout, PATH or an absolute --muse-binary (D1a, D4), its launcher's fixed prefix and MUSE_LOGIN_ARGS, as an argument array with no shell (PLAN.md §8)
          const { child } = await spawnResourceProcess('interactive', file, args, { env })
          return child
        },
        printError: (line) => {
          writeLine(process.stderr, line)
        },
      })
    }
    case 'authSet': {
      const { target } = command
      if (target === undefined) return await authSet(authDeps())
      if (target.provider !== 'meta' && target.account === ACCOUNT_DEFAULT_ID) {
        const providersFile = await userProvidersFile()
        return await authSetProvider(authDeps(), target.provider, providersFile.readUserFile)
      }
      return target.provider === 'meta' && target.account === ACCOUNT_DEFAULT_ID
        ? await authSet(authDeps())
        : await loadAccountsBundle(log).runAccountAuthSet(target, {
            ...loadAccounts(log).commands,
            ...authDeps(),
          })
    }
    case 'accounts': {
      return await loadAccountsBundle(log).runAccountsCommand(command.options, {
        ...loadAccounts(log).commands,
        print: (line) => {
          writeLine(process.stdout, line)
        },
        printError: (line) => {
          writeLine(process.stderr, line)
        },
      })
    }
    case 'developer': {
      const result = await loadAccountsBundle(log).runTerminalDeveloperCommand(
        UI_TEXT,
        uiLocale(),
        servicesInput,
        {
          readLine: (prompt) => readSecretLine(prompt, process.stdin, process.stderr),
          print: (line) => {
            writeLine(process.stdout, line)
          },
        },
        command.args,
        'terminal',
      )
      writeLine(result.exitCode === 0 ? process.stdout : process.stderr, result.text)
      return result.exitCode
    }
    case 'authStatus': {
      return command.provider === undefined
        ? await authStatus(authDeps())
        : await authStatusProvider(authDeps(), command.provider)
    }
    case 'authClear': {
      return command.provider === undefined
        ? await authClear(authDeps())
        : await authClearProvider(authDeps(), command.provider)
    }
    case 'providersList': {
      const { providersList } = await import('./providersCommands')
      return await providersList(await providersDeps())
    }
    case 'providersAdd': {
      const { providersAdd } = await import('./providersCommands')
      return await providersAdd(await providersDeps(), command.options)
    }
    case 'providersTest': {
      const { providersTest } = await import('./providersCommands')
      return await providersTest(await providersDeps(), command.provider)
    }
    case 'providersRemove': {
      const { providersRemove } = await import('./providersCommands')
      return await providersRemove(await providersDeps(), command.provider)
    }
    case 'estimate': {
      return await runRuntimeEstimateCommand(command.argv, {
        bundlePath: path.join(__dirname, ESTIMATOR_BUNDLE_FILE),
        log,
        write: (text) => {
          process.stdout.write(text)
        },
        error: (text) => {
          writeLine(process.stderr, text)
        },
      })
    }
    case 'report': {
      // No backend, no auth flow and no model startup: only local, capped
      // recorder data and allowlisted local facts (M93, D72).
      const homeDir = homedir()
      const nowMs = Date.now()
      return await runReportCommand({
        options: command.options,
        version: packageVersion(),
        nodeVersion: process.version,
        platform: process.platform,
        pathEntries: (process.env['PATH'] ?? '').split(path.delimiter),
        homeDir,
        localAppData: process.platform === 'win32' ? process.env['LOCALAPPDATA'] : undefined,
        xdgConfigHome: process.env['XDG_CONFIG_HOME'],
        museBinaryPath: '',
        fileExists: (file) => {
          try {
            return existsSync(file)
          } catch {
            return false
          }
        },
        readTextFile: (file): string | undefined => {
          try {
            return readFileSync(file, 'utf8')
          } catch {
            return undefined
          }
        },
        listDirectory: (directory) => {
          try {
            return readdirSync(directory)
          } catch {
            return []
          }
        },
        // The agent took its credential variables out of its environment at
        // start (rule 8): presence is read from what it took.
        hasEnvironmentApiKey: wasEnvironmentApiKeyPresent,
        readStoredKeyPresence: async () => {
          try {
            const stored = await secrets.get(SECRET_KEYS.modelApiKey)
            return stored !== undefined && stored !== ''
          } catch {
            // A store that cannot be read reads no (documented in docs/acp.md).
            return false
          }
        },
        nowMs,
        // Reading prunes expired records but sets and consumes no marker.
        readJournal: async () => {
          const journal = await reportJournal(log)
          const merged = await journal.readMerged()
          return {
            entries: reportEventsOf(merged.entries, nowMs),
            recordingUnavailable: !journal.isAvailable,
          }
        },
        writeStdout: (text) => {
          writeLine(process.stdout, text)
        },
        writeOutFile: async (file, text) => {
          await writeFile(file, text, 'utf8')
        },
        printError: (line) => {
          writeLine(process.stderr, line)
        },
      })
    }
    case 'reports': {
      try {
        return await runtimeReports(log)().run(command.args)
      } catch {
        writeLine(process.stderr, UI_TEXT.reportUi.generationFailed)
        return EXIT_FAILED
      }
    }
    case 'version': {
      writeLine(process.stdout, packageVersion())
      return 0
    }
    case 'playbook': {
      // No backend, no model startup: the journal-backed settings/record
      // surface for the current workspace (M116), loaded on first use.
      const homeDir = homedir()
      const playbook = playbookLoader(path.join(distDir, PLAYBOOK_BUNDLE_FILE), log)()
      return await playbook.runPlaybookCli(
        command.argv,
        {
          port: playbook.createPlaybookSurface(
            {
              agentDataFolder: agentDataFolder({
                platform: process.platform,
                env: process.env,
                homeDir,
              }),
              workspaceFolder: process.cwd(),
              teamId: 'panel',
              laneId: 'surface',
            },
            UI_TEXT,
            uiLocale(),
          ),
          writeStdout: (text) => {
            writeLine(process.stdout, text)
          },
          printError: (line) => {
            writeLine(process.stderr, line)
          },
        },
        UI_TEXT,
        uiLocale(),
      )
    }
    case 'vaultHelp': {
      writeLine(process.stdout, vaultUsage())
      return 0
    }
    case 'help': {
      if (command.all === true) {
        const reference = referenceLoader({
          bundlePath: path.join(distDir, REFERENCE_BUNDLE_FILE),
          log,
        })().createReference(referenceTable, uiLocale())
        const file = uiLocale() === 'en' ? 'package.nls.json' : `package.nls.${uiLocale()}.json`
        const nls: unknown = JSON.parse(await readUiTableFile(packageRoot, [file]))
        writeLine(process.stdout, reference.all(nls))
      } else {
        writeLine(process.stdout, formatAcpUsage(UI_TEXT, ACP_AGENT_NAME))
      }
      return 0
    }
    case 'invalid': {
      // Normal commands render after language installation; headless usage
      // errors keep their earlier bounded exit path (M80).
      const localized = parseCommandLine(process.argv.slice(2))
      writeLine(
        process.stderr,
        localized.command === 'invalid' ? localized.reason : UI_TEXT.accounts.unavailable,
      )
      writeLine(process.stderr, fill(UI_TEXT.acpUsage, { command: ACP_AGENT_NAME }))
      writeLine(process.stderr, UI_TEXT.acpChatGpt.usage)
      return command.exitCode ?? EXIT_FAILED
    }
  }
}

/** The process's exit code is the command's; a crash prints its stack and fails. */
async function run(): Promise<void> {
  const processResources = resourcesFor(
    stderrLogger((line) => {
      writeLine(process.stderr, line)
    }, 'warn'),
  )
  try {
    process.exitCode = await main()
  } catch (error: unknown) {
    writeLine(
      process.stderr,
      redactWhole(error instanceof Error ? (error.stack ?? error.message) : String(error), []),
    )
    process.exitCode = EXIT_FAILED
  } finally {
    processResources.dispose()
  }
}

void run()
