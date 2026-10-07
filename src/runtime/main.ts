import { legalScanLoader } from '../host/ide/legalScanBundle'
// `muse-spark-code-acp` (PLAN.md D62): the Muse Spark agent for editors that
// speak the Agent Client Protocol, and the sign-in commands their terminal
// sign-ins run (D61). stdout carries the protocol; everything the user or
// the log reads goes to stderr, except the sign-in commands' own output.
// Exercised through the built `dist/acp.js` by the stdio e2e test.

import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { open, writeFile } from 'node:fs/promises'
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
  RUNTIME_QUESTIONS_BUNDLE_FILE,
  RUNTIME_ACCOUNTS_BUNDLE_FILE,
  ACP_AUTH_METHODS,
  EXEC_EXIT,
  EXEC_SCAN_TIMEOUT_MS,
  EXEC_FORCE_WRITE_MS,
  MEMORY_STAGE_FILE_MODE,
  EXTENSION_HOOKS_BUNDLE_FILE,
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
} from '../shared/constants'
import type { SecretStore } from '../host/auth/credentialStore'
import { fill, uiLocale } from '../shared/l10n/text'
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
import type { RuntimeSharingPorts } from './sharing/sharingEntry'
import { formatAcpUsage } from './cliOptions'
import { referenceLoader } from '../host/referenceLoader'
import { REFERENCE_BUNDLE_FILE } from '../shared/constants'
import { UI_TEXT as referenceTable } from '../shared/l10n/text'
import { isProcessAlive } from '../host/checkpoints/windowPresence'
import type { ReportJournal } from '../host/support/reportJournal'
import { reportEventsOf } from '../core/support/journalEvents'
import { agentDataFolder } from './dataFolder'
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

import { runProgram } from '../host/processTree'
import { lazyUsageAdapter, usageCompanionUrl } from './usage/usageAdapter'
import type { UsageAdapter } from './usage/usageAdapter'
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
import { execAccountSelection } from './exec/execAccounts'
import { ACCOUNT_DEFAULT_ID } from '../shared/constants'
import { runtimeAccountsLoader, type RuntimeAccountsBundle } from './providers/accountsBundle'
import type {
  RuntimeAccountServices,
  RuntimeAccountServicesInput,
} from './providers/runtimeServices'

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
    listFiles: () => walkFiles(workspaceRoot, 1, log),
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
    if (process.platform === 'linux') {
      await new Promise<void>((resolve, reject) => {
        // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- Fixed OS opener, validated loopback URL, credential-stripped environment and shell-free arguments (D82, PLAN.md §8).
        const handler = spawn(executable, args, {
          env: process.env,
          detached: true,
          stdio: 'ignore',
        })
        handler.once('error', reject)
        handler.once('spawn', () => {
          // A valid xdg-open handler may stay foreground with the browser.
          // Its lifetime cannot hold the launcher or decide the page's lifetime.
          handler.unref()
          resolve()
        })
      })
    } else await runProgram(executable, args, process.env)
  } catch {
    // Opener stderr can repeat the private fragment; it never reaches a log.
    throw new Error(UI_TEXT.actionFailed)
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
    const registries: { flush(): Promise<void>; dispose(): void }[] = []
    const runtime = await runtimeFor(options, log, {
      remove: (id) => loadQuestions().removeRuntimeQuestions(directory, id, UI_TEXT, uiLocale()),
    })
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
    const agent = engine.createAcpAgent({
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
      reportError: (fact) => {
        void journal.record(fact)
      },
    })
    const connection = agent.connect(
      engine.ndJsonStream(Writable.toWeb(process.stdout), webReadable(process.stdin)),
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
      await usage.dispose()
      await runtime.close()
      await journal.shutdown()
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
      const headless = await import('./exec/runExec')
      headless.setUiText(UI_TEXT, uiLocale())
      headlessCode = await headless.runExec(lifecycle, {
        ...((command.options.accountPool === true ||
          execAccountSelection(command.options).account !== ACCOUNT_DEFAULT_ID) && {
          accounts: loadAccounts(log).exec,
        }),
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
      })
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
        spawnInTerminal: (file, args, env) =>
          // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- `muse login` as `muse serve` is started: the CLI resolved from its install layout, PATH or an absolute --muse-binary (D1a, D4), its launcher's fixed prefix and MUSE_LOGIN_ARGS, as an argument array with no shell (PLAN.md §8)
          spawn(file, [...args], { env, stdio: 'inherit' }),
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
    case 'version': {
      writeLine(process.stdout, packageVersion())
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
        writeLine(process.stdout, fill(UI_TEXT.accounts.cliUsage, { command: ACP_AGENT_NAME }))
        writeLine(process.stdout, fill(UI_TEXT.accounts.execHelp, { command: ACP_AGENT_NAME }))
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
  try {
    process.exitCode = await main()
  } catch (error: unknown) {
    writeLine(
      process.stderr,
      redactWhole(error instanceof Error ? (error.stack ?? error.message) : String(error), []),
    )
    process.exitCode = EXIT_FAILED
  }
}

void run()
