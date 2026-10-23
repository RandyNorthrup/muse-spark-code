import type { SourceReadContext } from '../core/reporting/sources/types'
import { legalScanLoader } from '../host/ide/legalScanBundle'
import { failureForLog } from '../core/backends/musecode/logText'
import { isErrno } from '../core/fs/errno'
import { abortableSleep } from '../core/backends/modelapi/transport'
// `muse-spark-code-acp` (PLAN.md D62): the Muse Spark agent for editors that
// speak the Agent Client Protocol, and the sign-in commands their terminal
// sign-ins run (D61). stdout carries the protocol; everything the user or
// the log reads goes to stderr, except the sign-in commands' own output.
// Exercised through the built `dist/acp.js` by the stdio e2e test.

import { spawnResourceProcess, handoffResourceFile } from '../core/resources/launcher'
import { isResourcePaused } from '../core/resources/launch'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { open, writeFile, realpath, lstat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { createInterface as createPromisedInterface } from 'node:readline/promises'
import { homedir, hostname, tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { Writable } from 'node:stream'
import { setTimeout as nodeSleep } from 'node:timers/promises'
import type { SignInMethod } from '../acp/agent'
import { runtimeQuestionsLoader } from './questions/questionRegistryBundle'
import { voiceCompanionLoader } from './companion/voiceLoader'
import type { VoiceCompanionContext } from './companion/voiceEntry'
import { COMPANION_VOICE_RELEASE } from '../shared/companionVoice'
import { processGitRunner } from '../host/git'
import { loadUiTable, readUiTableFile } from '../host/l10n'
import {
  ACP_AGENT_NAME,
  OPTIONAL_RUNTIME_AVAILABILITY,
  ESTIMATOR_BUNDLE_FILE,
  PLAN_SNAPSHOT_BUNDLE_FILE,
  RUNTIME_QUESTIONS_BUNDLE_FILE,
  PLAYBOOK_BUNDLE_FILE,
  RUNTIME_ACCOUNTS_BUNDLE_FILE,
  ACP_AUTH_METHODS,
  EXEC_EXIT,
  EXEC_FORCE_WRITE_MS,
  MEMORY_STAGE_FILE_MODE,
  EXTENSION_HOOKS_BUNDLE_FILE,
  FONT_INSTALL_BUNDLE_FILE,
  FONT_PACK_SUBFOLDER,
  SEARCH_WORKER_FILE,
  SECRET_KEYS,
  EXEC_STOP_GRACE_MS,
  USAGE_ERROR_LOCALE_MS,
  LEGAL_EXIT,
  LEGAL_SCAN_BUNDLE_FILE,
  PROVIDERS_CONFIG_DIR_NAME,
  PROVIDERS_FILE_NAME,
  SETTING_DEFAULTS,
  UI_TEXT,
  REFERENCE_BUNDLE_FILE,
  BOUNDED_FILE_READ_CHUNK_BYTES,
  SCHEDULE_STORE_SUBFOLDER,
  CONNECTOR_BUNDLE_FILE,
  USAGE_PAGE_OPEN_TIMEOUT_MS,
  CONNECTOR_FOLDER,
  CONNECTOR_STORE_GUARD_BUNDLE_FILE,
  NODE_BUNDLE_FILE,
} from '../shared/constants'
import {
  cliEvidenceRoot,
  filePhase2EvidenceStore,
  type Phase2EvidenceStore,
} from '../core/judge/evidencePaths'
import type { SecretStore } from '../host/auth/credentialStore'
import { fill, uiLocale, UI_TEXT as referenceTable } from '../shared/l10n/text'
import { Usd } from '../shared/usd'
import { setUiText as setProviderPolicyText } from '../host/backend/providerPolicyEntry'
import { authClear, type AuthCommandDeps, authSet, login } from './authCommands'
import { authGitHub } from './authCommands'
import {
  authSetProviderId,
  isHeadlessCommand,
  parseCommandLine,
  type RuntimeCommand,
  type ServeOptions,
} from './cliArgs'
import { parseSharingArgs, type SharingCommand } from './sharing/args'
import { deviceFlowSource } from './github/deviceFlowSource'
import { runtimeSharingLoader } from './sharing/sharingBundle'
import { defaultServeOptions, sharingPorts, type SharingPortsDeps } from './sharing/sharingPorts'
import { acpSharingCommands } from '../acp/sharing'
import { boundedAcpStream } from '../shared/acpStream'
import type { PlaybookCommand, PlaybookSurfacePort } from './playbook/command'
import { formatCommandHelp, formatAcpUsage } from './cliOptions'
import { helpTopicNamed, renderTopicHelp } from './cliHelp'
import { referenceLoader } from '../host/referenceLoader'
import {
  createRuntimeEstimate,
  runRuntimeEstimateCommand,
  runtimeEstimatorPorts,
} from './estimator/ports'
import { lazyEstimator } from '../host/estimator/estimatorBundle'
import { isProcessAlive } from '../host/checkpoints/windowPresence'
import type { ReportJournal } from '../host/support/reportJournal'
import { reportEventsOf } from '../core/support/journalEvents'
import {
  agentDataFolder,
  nodeDataFolder,
  workspaceKey,
  workspaceSessionsFolder,
} from './dataFolder'
import { fontsBundle } from './fonts/bundle'
import { playbookLoader } from './playbook/playbookBundle'
import { nodeModule } from './node/bundle'
import { runReportCommand } from './reportCommand'
import { readSecretLine } from './hiddenInput'
import {
  credentialStoreName,
  keyringSecretStore,
  parseStoredProviderSecret,
  providerSecretAccount,
  StoreUnavailableError,
  type KeyringEntry,
} from './keyStore'
import type { ChatGptProviderAction } from './chatGptProviderCommands'
import type { GrokProviderAction } from './grokProviderCommands'
import type { ProvidersDeps } from './providersCommands'
import type { SpendEstimate } from '../core/providers/providerSpend'
import { takeCredentials } from './credentialVariables'
import { keepGitCredentialRoutes } from './gitUserEnvironment'
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
  currentOwnedLimitSnapshots,
  isUsageWriterBundle,
  type UsageRecording,
} from '../core/usage/recording'
import type { UsageBudgetRead } from '../core/usage/usageService'
import { USAGE_CLI_CLIENT_ID } from '../shared/usageJournal'
import { requireFile } from '../host/lazyBundle'
import { isSetupAction } from './judge/args'
import { judgeFeaturesLoader, setupFeaturesLoader } from './judge/judgeBundle'
import { cliJudgeBinding } from './judge/cliBinding'
import { extensionHooksBundle } from '../host/extensionHooksBundle'
import { fileContextIo } from '../host/backend/contextIo'
import { createToolIo } from '../host/backend/toolIo'
import { museSettingsPath } from '../host/backend/museSettings'
import { walkFiles } from './fileWalk'
import { shellJobAssembly } from '../host/backend/shellJob'
import { jobSourceReader } from '../host/backend/jobSource'
import { reportsLoader } from './reporting/reportsLoader'
import { reportInputsLoader } from './reporting/reportInputsLoader'
import { runtimeReportsPlanMaxBytes } from './runtimeReportsPlan'
import { playbookSchedulesInputsLoader } from './reporting/playbookSchedulesInputsLoader'
import type { createRuntimeReports } from './reporting/reportsEntry'
import { runtimeSchedulesBinding, type RuntimeSchedulesBinding } from './schedules/binding'
import { connectorLoader } from './connector/connectorBundle'
import { storageGuardLoader } from './connector/storageGuardBundle'
import type { ScheduleWakeAuthorization } from './schedules/registration'
import { runtimeScheduleSessionFactory } from './schedules/sessionFactory'
import { settleScheduleCommand } from './schedules/settle'

import {
  ResourceUnavailableError,
  lazyRuntimeResources,
  type ProcessResources,
} from './resources/load'
import { resourceFailureReporter } from './resources/text'
import { createAcpAccounting } from './acpAccounting'
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
import { chooseVaultDecision, readVaultLine, readVaultMaterial } from './vault/vaultInput'

const EXIT_FAILED = 1
// Keep only presence for reports, before credential variables leave the process.
const META_API_KEY_VARIABLE = 'META_API_KEY'

/** What a headless command answers when its own wiring fails (D76: 2 for the scan). */
const HEADLESS_WIRING_EXIT = {
  'scan-secrets': EXEC_EXIT.usage,
  legal: LEGAL_EXIT.incomplete,
} as const
const wasEnvironmentApiKeyPresent = process.env[META_API_KEY_VARIABLE] !== undefined
// Credential variables leave the agent's own environment before anything
// starts a process; no child gets them back (FIXM95X). Removed values remain
// in memory for D98 sharing redaction, and their Git routes (no model or
// provider key) for D104's named exception only: the user's confirmed push
// and pull request fetch (M123, gitUserEnvironment.ts). No other child.
const sharingCredentials = takeCredentials(process.env)
keepGitCredentialRoutes(sharingCredentials)
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

function loadDisplayLanguage(log: Logger) {
  return loadUiTable({
    language: displayLanguage(process.env, new Intl.DateTimeFormat().resolvedOptions().locale),
    readExtensionFile: (segments) => readUiTableFile(packageRoot, segments),
    log,
  })
}

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

// Lane PR225FIX2: a Stop clears the wait's own timer, so an abandoned
// wait leaves none behind.
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return abortableSleep(ms, signal)
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
  } catch (error: unknown) {
    throw new StoreUnavailableError({ cause: error })
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

/**
A held regular-file descriptor bounds both stat size and growth while
reading. NOLIMITS1FIX: an infinite `maxBytes` reads to end-of-file —
the removed 16 MiB report-source bound was invented. Finite callers
(exec's own file bounds) behave exactly as before.
*/
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
    if (!Number.isFinite(maxBytes)) {
      const parts: Buffer[] = []
      for (;;) {
        signal.throwIfAborted()
        const chunk = Buffer.alloc(BOUNDED_FILE_READ_CHUNK_BYTES)
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, null)
        if (bytesRead === 0) break
        parts.push(chunk.subarray(0, bytesRead))
      }
      return Buffer.concat(parts)
    }
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
This agent process's flight recorder (M93, PLAN.md D72): the extension's
own ReportJournal, with the same policy, under the agent's data folder
(no workspace needed). Each process writes only its own journal; `report`
reads them all.
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
    confirmKeyUse: async (message) => {
      // Piped stdin cannot answer: name the value and proceed to the
      // provider, exactly as before (PLAN.md D123 never dead-ends a
      // pipe). A terminal asks and waits for the answer.
      if (!process.stdin.isTTY) {
        writeLine(process.stderr, message)
        return true
      }
      const input = createPromisedInterface({ input: process.stdin, output: process.stderr })
      try {
        return (await input.question(`${message} (y/N): `)) === 'y'
      } finally {
        input.close()
      }
    },
    print: (line) => {
      writeLine(process.stdout, line)
    },
    printError: (line) => {
      writeLine(process.stderr, line)
    },
  }
}

/** The terminal's shared subscription-command base: store, fetch, file and printing. */
function terminalSubscriptionBase() {
  return {
    uiText: UI_TEXT,
    locale: uiLocale(),
    secrets,
    fetch: globalThis.fetch.bind(globalThis),
    configFile: path.join(
      process.env['XDG_CONFIG_HOME'] ?? path.join(homedir(), '.config'),
      PROVIDERS_CONFIG_DIR_NAME,
      PROVIDERS_FILE_NAME,
    ),
    openBrowser: (url: string) => {
      writeLine(process.stdout, url)
      return Promise.resolve()
    },
    print: (line: string) => {
      writeLine(process.stdout, line)
    },
    printError: (line: string) => {
      writeLine(process.stderr, line)
    },
  }
}

async function chatGptDeps() {
  const bundle = await import('./chatGptProviderCommands')
  const commands = bundle.runtimeChatGptCommandDeps({
    ...terminalSubscriptionBase(),
    callbackText: () => UI_TEXT.acpChatGpt.callback,
  })
  return {
    signIns: bundle.chatGptAuthenticationMethods(() =>
      Promise.resolve(commands.binding.createHost({ clientId: undefined, scopes: undefined })),
    ),
    run: (action: ChatGptProviderAction) => bundle.runChatGptProviderCommand(action, commands),
  }
}

async function grokDeps() {
  const bundle = await import('./grokProviderCommands')
  const commands = bundle.runtimeGrokCommandDeps({
    ...terminalSubscriptionBase(),
    callbackText: () => UI_TEXT.acpGrok.callback,
    presentDeviceCode: (prompt) => {
      writeLine(
        process.stdout,
        fill(UI_TEXT.acpGrok.code, { url: prompt.verificationUri, code: prompt.userCode }),
      )
      return Promise.resolve()
    },
  })
  return {
    // The agent lists the same commands the terminal runs; verification
    // only reads the stored grant, so no client configuration is needed.
    signIns: bundle.grokAuthenticationMethods(
      () =>
        Promise.resolve(commands.binding.createHost({ clientId: undefined, scopes: undefined })),
      {},
    ),
    run: (action: GrokProviderAction) => bundle.runGrokProviderCommand(action, commands),
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
  const { readFile } = await import('node:fs/promises')
  return {
    ...authDeps(),
    ...(await userProvidersFile()),
    resolveHost: resolveEndpointHost,
    fetch: globalThis.fetch.bind(globalThis),
    // D4: runnable-model warnings read the priced catalogue beside the bundle.
    readCatalog: async (): Promise<unknown> =>
      JSON.parse(await readFile(path.join(__dirname, 'providerCatalog.json'), 'utf8')),
  }
}

async function openRouterApi() {
  const entry = await import('../host/backend/configuredProvidersEntry')
  entry.setUiText(UI_TEXT, uiLocale())
  return entry.createConfiguredProviderServices(undefined, {
    configFile: path.join(
      process.env['XDG_CONFIG_HOME'] ?? path.join(homedir(), '.config'),
      PROVIDERS_CONFIG_DIR_NAME,
      PROVIDERS_FILE_NAME,
    ),
    catalogFile: path.join(distDir, 'providerCatalog.json'),
    secrets,
  })
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
  accounts?: RuntimeAccountServices,
) {
  const engine = await import('./runtimeEngineEntry')
  engine.setUiText(UI_TEXT, uiLocale())
  return engine.createRuntimeBackend({
    hostKind: questions === undefined ? 'cli' : 'acp',
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
    ...(accounts !== undefined && {
      accountRequests: (client) => accounts.requests(client),
      accountBilling: accounts.billing,
    }),
  })
}

/**
The process's one governor (H–C1), made once by `run()`. The ACP agent adds
its usage-history consent and headless its run flags through `configure`.
*/
function resourcesFor(log: Logger): ProcessResources {
  return lazyRuntimeResources({
    distDir,
    machineDir: agentDataFolder({
      platform: process.platform,
      env: process.env,
      homeDir: homedir(),
    }),
    sleep,
    log,
    onError: resourceFailureReporter(log),
    // A damaged usage-history choice on stderr once, with what is damaged,
    // what the product does, and what to do (the noter announces once per
    // distinct damage).
    onDamagedChoice: (text) => {
      log.error(text)
    },
  })
}

/**
Owned LocalSourceError brand (localFailureOf), like the conversation
bundle's: a failed report read is a failure with its reason, never a
silent miss (RVCM1132B finding 4).
*/
function reportReadFailed(): Error {
  return Object.assign(new Error('failed'), { isLocalSourceError: true, code: 'failed' })
}

/**
No account or backend is touched; W ships this entry in its own lazy chunk.
The connector's reads keep no history and make no network request (M124).
*/
interface ReportsPolicy {
  readonly keepHistory: boolean
  readonly allowEgress: () => Promise<boolean>
}
const CLI_REPORTS: ReportsPolicy = {
  keepHistory: true,
  allowEgress: () => Promise.resolve(process.env['CI'] === undefined),
}

function runtimeReports(
  log: Logger,
  current?: Awaited<ReturnType<typeof runtimeFor>>,
  recording?: UsageRecording,
  /** One-shot CLI reports have no live runtime but still show the shared daily budget. */
  reportBudgets?: () => Promise<readonly UsageBudgetRead[]>,
  policy: ReportsPolicy = CLI_REPORTS,
): () => ReturnType<typeof createRuntimeReports> {
  const load = reportsLoader({ bundlePath: path.join(distDir, 'reporting.js'), log })
  // M113 C-M113-2: the session and usage inputs ride their own lazy chunk.
  const inputs = reportInputsLoader({
    bundlePath: path.join(distDir, 'reportInputs.js'),
    log,
  })
  // M113 C-M113-4: the playbook and schedules inputs ride a second chunk
  // beside it; the journal replay and schedule store would overflow the
  // session/usage chunk's budget.
  const playbookSchedules = playbookSchedulesInputsLoader({
    bundlePath: path.join(distDir, 'playbookSchedulesInputs.js'),
    log,
  })
  // M113 C-M113-4: one estimator per requesting workspace root, like the
  // headless estimate command; the estimate report kind runs the same run.
  const reportEstimators = new Map<string, ReturnType<typeof lazyEstimator>>()
  const reportEstimatorFor = (cwd: string): ReturnType<typeof lazyEstimator> => {
    const known = reportEstimators.get(cwd)
    if (known !== undefined) return known
    const estimator = lazyEstimator({
      bundlePath: path.join(distDir, ESTIMATOR_BUNDLE_FILE),
      log,
      ports: () =>
        runtimeEstimatorPorts({
          snapshotBundlePath: path.join(distDir, PLAN_SNAPSHOT_BUNDLE_FILE),
          log,
          root: cwd,
          // The report runtime has no account registry: the same agent data
          // folder feeds the governor's thresholds while the fleet names the
          // runtime no-reader seam for account limits.
          machineDir: agentDataFolder({
            platform: process.platform,
            env: process.env,
            homeDir: homedir(),
          }),
        }),
    })
    reportEstimators.set(cwd, estimator)
    return estimator
  }
  let reports: ReturnType<typeof createRuntimeReports> | undefined
  return () => {
    reports ??= load().createRuntimeReports({
      cwd: process.cwd(),
      locale: uiLocale(),
      table: UI_TEXT,
      now: () => new Date().toISOString(),
      roots: [homedir()],
      servicesFor: (cwd, _sessionId, language) => {
        const l10n = language ?? { table: UI_TEXT, locale: uiLocale() }
        const dataFolder = agentDataFolder({
          platform: process.platform,
          env: process.env,
          homeDir: homedir(),
        })
        let journalReader:
          ReturnType<ReturnType<typeof inputs>['createReportJournalReader']> | undefined
        const readJournal = (context: SourceReadContext) => {
          const readBudgets = reportBudgets ?? current?.readUsageBudgets
          journalReader ??= inputs().createReportJournalReader({
            dataFolder,
            ...(recording !== undefined && { beforeRead: () => recording.flush() }),
            ...(readBudgets !== undefined && { readBudgets }),
            // One offset per report: the budget stamp shares the usage
            // period's sample through the run, like M102's page (RVCM1132B
            // finding 2, RVCM1132C finding 3).
            timezoneOffsetMins: inputs().reportTimezoneOffset,
          })
          return journalReader(context)
        }
        return Promise.resolve({
          keepHistory: policy.keepHistory,
          services: load().createReportingServices({
            workspaceRoot: cwd,
            log,
            storageRoot: dataFolder,
            l10n,
            generatorVersion: packageVersion(),
            keepHistory: policy.keepHistory,
            // D121: the person's own plan byte limit from the agent data
            // folder's settings.json; 0 (the default) reads whole.
            planMaxBytes: runtimeReportsPlanMaxBytes(dataFolder),
            enabledAgents: [],
            session: {
              read: (context) =>
                inputs()
                  .createSessionReportReader(
                    {
                      resolveSession: async (sessionId, reportContext) => {
                        if (sessionId === undefined) return null
                        // A failed read is a failure with its reason, never a
                        // silent miss: precise stored/host brands propagate,
                        // and anything else becomes a failure (RVCM1132B
                        // finding 4). Only null means no session was found.
                        try {
                          const stored = await inputs().readStoredReportSession(
                            workspaceSessionsFolder(
                              { platform: process.platform, env: process.env, homeDir: homedir() },
                              cwd,
                            ),
                            sessionId,
                          )
                          if (stored !== null) return stored
                          // Default serve options for the on-demand CLI runtime;
                          // ACP serve reuses its live runtime through `current`.
                          const parsed = parseCommandLine([])
                          if (parsed.command !== 'serve') return null
                          let runtime = current
                          try {
                            runtime ??= await runtimeFor(parsed.options, log)
                            const host = await runtime.backend.hostFor(cwd)
                            return await inputs().readHostReportSession(
                              host,
                              sessionId,
                              reportContext.reportText,
                            )
                          } finally {
                            if (current === undefined) await runtime?.close()
                          }
                        } catch (error) {
                          if (
                            typeof error === 'object' &&
                            error !== null &&
                            (error as { isLocalSourceError?: unknown }).isLocalSourceError === true
                          )
                            throw error
                          throw reportReadFailed()
                        }
                      },
                      readJournal,
                    },
                    l10n.table,
                    l10n.locale,
                  )
                  .read(context),
            },
            usage: (context) =>
              inputs().createUsageReportReader(
                {
                  dataFolder,
                  readJournal,
                  // The machine-local day, like M102's page and the journal's
                  // own day stamps; the contract carries it explicitly (D93).
                  // The shared per-run sample keeps the period on the budget
                  // stamp's day (RVCM1132C finding 3).
                  timezoneOffsetMins: inputs().reportTimezoneOffset,
                },
                l10n.table,
                l10n.locale,
              )(context),
            // M113 C-M113-5: this install's manifest, like the panel's, so
            // the CLI and the ACP agent report the same installed bindings.
            keybindings: () =>
              inputs().keybindingsManifestReader(path.join(packageRoot, 'package.json'))(),

            // C-M113-3: the registry and developer audit read from the same
            // data folder. M108's use/swaps adapters and an unlock-capable
            // vault view bind here when their owning lanes land; until then
            // those facets stay empty and named.
            accounts: {
              read: (context) =>
                inputs()
                  .createAccountsReportReader({ dataDir: dataFolder }, l10n.table, l10n.locale)
                  .read(context),
            },
            security: {
              read: (context) =>
                inputs()
                  .createSecurityReportReader({ dataDir: dataFolder }, l10n.table, l10n.locale)
                  .read(context),
            },
            // M113 C-M113-4: the playbook journal and the schedules store
            // live under the same agent data folder as the usage journal.
            // The schedules key matches the delivery engine's own workspace
            // key (schedulesBridge keyFor), not the report storage key.
            playbook: {
              read: (context) =>
                playbookSchedules()
                  .createPlaybookReportReader(
                    { agentDataFolder: dataFolder, workspaceRoot: cwd },
                    l10n.table,
                    l10n.locale,
                  )
                  .read(context),
            },
            schedules: {
              read: (context) =>
                playbookSchedules()
                  .createSchedulesReportReader(
                    {
                      storeRoot: path.join(dataFolder, SCHEDULE_STORE_SUBFOLDER),
                      workspaceKey: workspaceKey(path.resolve(cwd)),
                    },
                    l10n.table,
                    l10n.locale,
                  )
                  .read(context),
            },
            // M113 C-M113-4: the estimate report kind runs the headless
            // estimator for the report's workspace root. Only estimate
            // reports load it; networked reads stay off headless (D65).
            estimate: {
              read: (request, context) =>
                inputs()
                  .createEstimateReportReader(
                    {
                      run: (runRequest, signal) =>
                        reportEstimatorFor(cwd).estimate(runRequest, signal),
                    },
                    l10n.table,
                    l10n.locale,
                  )
                  .read(request, context),
            },
            network: {
              policy: {
                surface: 'terminal',
                mode: 'always',
                githubSignedIn: false,
                allowEgress: policy.allowEgress,
              },
            },
          }),
        })
      },
      resolveSaved: async (cwd, file) => {
        const target = path.resolve(cwd, file)
        const info = await lstat(target)
        if (info.isSymbolicLink()) throw new Error(UI_TEXT.reportUi.generationFailed)
        return await realpath(target)
      },
      readSaved: async (cwd, file) => {
        // NOLIMITS1FIX: a saved report reads whole at any size — the
        // removed 16 MiB bound was invented. No deadline of ours either
        // (D121/D208): the read runs to end-of-file, and the person's
        // interrupt of this command is what stops it.
        const bytes = await readBoundedFile(
          path.resolve(cwd, file),
          Infinity,
          new AbortController().signal,
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
    // Setup hooks run in this workspace: their `sh` lookup excludes it, so
    // a planted `sh` there never becomes the interpreter.
    workspaceRoot,
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
    hookMaxRunningCommands: () => SETTING_DEFAULTS.hooksMaxRunningCommands,
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

/**
The stored credential's identity for a provider id, or undefined when none
is stored, unreadable or damaged. The usage service shows only the budgets
of the key in use, so a rotated or removed key's numbers disappear.
*/
async function currentProviderCredentialId(providerId: string): Promise<string | undefined> {
  const account = providerSecretAccount(providerId)
  if (account === undefined) return undefined
  let stored: string | undefined
  try {
    stored = await secrets.get(account)
  } catch {
    return undefined
  }
  if (stored === undefined) return undefined
  let value: unknown
  try {
    value = JSON.parse(stored)
  } catch {
    return undefined
  }
  const parsed = parseStoredProviderSecret(value)
  return parsed === undefined ? undefined : createHash('sha256').update(parsed.key).digest('hex')
}

function usageFor(
  log: Logger,
  recording?: UsageRecording,
  runtime?: Pick<Awaited<ReturnType<typeof runtimeFor>>, 'readUsageBudgets'>,
  isHistoryEnabled = true,
  generation?: () => string,
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
    // NOLIMITSSET (PLAN.md D121): null keeps history — no day count of ours.
    historySettings: () => ({ enabled: isHistoryEnabled, days: null as number | null }),
    ...(recording !== undefined && {
      beforeRead: () => recording.flush(),
    }),
    live: {
      readBudgets:
        recording === undefined
          ? () => Promise.resolve([])
          : (runtime?.readUsageBudgets ?? (() => Promise.resolve([]))),
      // Account & usage reads only owned observations of the live owner:
      // a retired generation's rows never show as the current limit.
      readLiveLimits: () =>
        Promise.resolve(
          recording === undefined
            ? []
            : currentOwnedLimitSnapshots(
                recording.ownedLimits?.() ?? [],
                { accountId: ACCOUNT_DEFAULT_ID, generation: generation?.() ?? 'unknown' },
                { at: Date.now(), newId: () => randomUUID(), client: USAGE_CLI_CLIENT_ID },
              ),
        ),
      providerConsoles: () => [],
      currentCredentialId: currentProviderCredentialId,
    },
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
    // A valid xdg-open handler may stay in the foreground with the browser: it
    // is launched once started, and its lifetime never holds the CLI or the page.
    await handoffResourceFile(executable, args, {
      env: process.env,
      workspaceRoot: process.cwd(),
      ...(process.platform === 'linux' && { until: 'spawn' as const }),
      timeoutMs: USAGE_PAGE_OPEN_TIMEOUT_MS,
    })
  } catch (error: unknown) {
    if (isResourcePaused(error)) throw error
    // Opener output goes to the null device; only fixed words are reported.
    throw new Error(UI_TEXT.actionFailed, { cause: error })
  }
}

function runtimeRecording(
  log: Logger,
  client: () => string,
  isEnabled: () => boolean,
): UsageRecording {
  return createUsageRecording({
    client,
    now: Date.now,
    newId: randomUUID,
    isEnabled,
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
        isEnabled,
        onWriteError,
        onInvalidSettings: () => {
          log.warn(
            'Usage history settings are invalid, so usage history is paused. Delete usage-settings.json in the agent data folder or turn usage history off and on again to record history again.',
          )
        },
      })
    },
  })
}

async function serve(
  options: ServeOptions,
  log: Logger,
  loadAccounts: () => RuntimeAccountServices,
  processResources: ProcessResources,
): Promise<number> {
  let clientName = 'ACP'
  const recording = runtimeRecording(
    log,
    () => clientName,
    () => options.usageHistory ?? true,
  )
  const engine = await import('./runtimeEngineEntry')
  engine.setUiText(UI_TEXT, uiLocale())
  let limitGeneration = randomUUID()
  const limitScope = (): { accountId: string; generation: string } => ({
    accountId: ACCOUNT_DEFAULT_ID,
    generation: limitGeneration,
  })
  let restoreRecording = engine.installUsageRecording(
    recording.scopeLimits?.({
      accountId: ACCOUNT_DEFAULT_ID,
      generation: limitGeneration,
      backend: options.backend,
    }) ?? recording,
    limitScope,
  )
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
    const accountServices = options.backend === 'modelApi' ? loadAccounts() : undefined
    const runtime = await runtimeFor(
      options,
      log,
      {
        remove: (id) => loadQuestions().removeRuntimeQuestions(directory, id, UI_TEXT, uiLocale()),
      },
      accountServices,
    )
    const isUsageHistoryOn = options.usageHistory ?? true
    // H–C1: the process's one governor records the agent's samples and launches.
    const resources = processResources.configure({ isRecordingHistory: () => isUsageHistoryOn })
    const scheduleSessions = runtimeScheduleSessionFactory({
      current: runtime,
      create: (backend) => runtimeFor({ ...options, backend }, log),
      distDir,
      dataDir: agentDataFolder({
        platform: process.platform,
        env: process.env,
        homeDir: homedir(),
      }),
      log,
      allowsContributorModels: options.allowsContributorModels,
    })
    // The ACP-side engine module; the schedules bundle never loads it from
    // VS Code, so the VSIX need not carry the runtime engine for schedules.
    // Its members are read by name so the bundle-split gate can compare them
    // with the engine bundle's exports; the module never crosses whole.
    const engineModule = await import('./runtimeEngineEntry')
    engineModule.setUiText(UI_TEXT, uiLocale())
    const scheduleEngine = {
      createRuntimeScheduleDelivery: engineModule.createRuntimeScheduleDelivery,
      setUiText: engineModule.setUiText,
    }
    const loadSchedules = runtimeSchedulesBinding(
      path.join(distDir, 'schedules.js'),
      log,
      undefined,
      undefined,
      scheduleSessions.ports,
      undefined,
      scheduleEngine,
    )
    let loadedSchedules: Awaited<ReturnType<typeof loadSchedules>> | undefined
    const usage = usageFor(log, recording, runtime, isUsageHistoryOn, () => limitGeneration)
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
    const grokCommands = await grokDeps()
    const openRouterCommands = await import('./openRouterCommands')
    const openRouterSignIns = openRouterCommands.openRouterAuthenticationMethods(
      await providersDeps(),
    )
    const legalRegistryNotices = new Map<string, Set<string>>()
    const agentLegalBundle = legalScanLoader({
      bundlePath: path.join(distDir, LEGAL_SCAN_BUNDLE_FILE),
      log,
    })
    const reports = runtimeReports(log, runtime, recording)
    // Model API sessions only: the Muse Code backend runs on its
    // subscription. Meta's entry is built in, so the metadata reads without
    // a providers file; a refused file or a loader failure leaves the
    // session working without accounts instead of refusing `serve`.
    let accounts: Awaited<ReturnType<RuntimeAccountServices['sessionsIfPresent']>>
    if (options.backend === 'modelApi') {
      try {
        accounts = await loadAccounts().sessionsIfPresent('meta')
      } catch (error: unknown) {
        log.warn(`ACP accounts unavailable: ${failureForLog(error)}`)
      }
    }
    const dictationLifetime = new AbortController()
    const agent = engine.createAcpAgent({
      accounting: createAcpAccounting({
        recording,
        runtime,
        isEnabled: () => isUsageHistoryOn && options.backend === 'modelApi',
        dataFolder: agentDataFolder({
          platform: process.platform,
          env: process.env,
          homeDir: homedir(),
        }),
        now: Date.now,
        sleep,
      }),
      schedules: {
        isAvailable: OPTIONAL_RUNTIME_AVAILABILITY.schedules,
        async holdWorkspace(cwd, session) {
          loadedSchedules ??= await loadSchedules()
          return await loadedSchedules.holdWorkspace(cwd, session)
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
      // The account picker serves Model API sessions (list, current,
      // thresholds). Switching stays refused (no adoption transaction).
      ...(accounts !== undefined && { accounts }),
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
      backend: {
        ...runtime.backend,
        readiness: async (isRecheck) => {
          if (isRecheck) {
            // The generation retires: surviving backend managers and hosts
            // read the live owner per observation, so nothing keeps
            // publishing under the retired generation.
            restoreRecording()
            limitGeneration = randomUUID()
            restoreRecording = engine.installUsageRecording(
              recording.scopeLimits?.({
                accountId: ACCOUNT_DEFAULT_ID,
                generation: limitGeneration,
                backend: options.backend,
              }) ?? recording,
              limitScope,
            )
          }
          return await runtime.backend.readiness(isRecheck)
        },
      },
      // Lane V seam 5: `/attach`, resource links and embedded media, bound
      // to the same registry the Model API sessions resolve.
      ...(runtime.media !== undefined && { media: runtime.media }),
      // M105 lane F: /uploads over the runtime's account ledger.
      ...(runtime.uploads !== undefined && { uploads: runtime.uploads }),
      version: packageVersion(),
      options: {
        canBypass: options.canBypass,
        allowsContributorModels: options.allowsContributorModels,
        initialMode: SETTING_DEFAULTS.initialPermissionMode,
        ...(options.initialModelId !== undefined && { initialModelId: options.initialModelId }),
        scheduleAuthorization: {
          scheduledPrompts: options.scheduledPrompts === true,
          ...(options.maxBudgetUsd !== undefined && { maxBudgetUsd: options.maxBudgetUsd }),
        },
        ...(options.questionsDeferAfterSeconds !== undefined && {
          questionsDeferAfterSeconds: options.questionsDeferAfterSeconds,
        }),
      },
      signIn: signInMethod(options),
      providerSignIns: [...providerCommands.signIns, ...grokCommands.signIns, ...openRouterSignIns],
      // `logout` on the Model API backend removes the stored key, the same
      // entry `auth clear` deletes. The Muse Code CLI's sign-in is the
      // user's to end, so that backend offers no credential removal.
      ...(options.backend === 'modelApi' && {
        signOut: async (): Promise<void> => {
          await secrets.delete(SECRET_KEYS.modelApiKey)
        },
      }),
      defaultCwd: process.cwd(),
      sharing: {
        commands: acpSharingCommands,
        execute: (text, context) =>
          runtimeSharingLoader(path.join(distDir, 'sharingRuntime.js'), log)()
            .runtimeAcpSharing(sharingPorts(log, runtime, sharingDeps()), UI_TEXT, uiLocale())
            .execute(text, context),
      },
      paid: runtime.paid,
      maker: runtime.maker,
      // The vault's asker: broker approvals route back as
      // session/request_permission, and /vault commands work in sessions.
      vault: acpVault,
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
        // The ACP agent's own fleet owners (M117 C-M117-3R3): the same agent
        // data folder the running governor reads resources.json from, and
        // the runtime's account registry (identity only, read lazily).
        machineDir: agentDataFolder({
          platform: process.platform,
          env: process.env,
          homeDir: homedir(),
        }),
        currentOwner: () => ({ accountId: ACCOUNT_DEFAULT_ID, generation: limitGeneration }),
        readOwnedLimits: () =>
          (recording.ownedLimits?.() ?? []).filter(
            (row) => row.snapshot.backend === options.backend,
          ),
        accounts: {
          list: async (provider: string) => {
            const owner = loadAccounts()
            return (await owner.metadata.read(provider)) === undefined
              ? []
              : await owner.store.list(provider)
          },
        },
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
      ...(COMPANION_VOICE_RELEASE.isReady && {
        dictation: async (context: VoiceCompanionContext) =>
          await runtimeDictation(
            log,
            options.companionVoice === true,
            options.trustWorkspace,
            recording,
          )({
            ...context,
            signal: AbortSignal.any([context.signal, dictationLifetime.signal]),
            isCurrent: () => !dictationLifetime.signal.aborted && context.isCurrent(),
          }),
      }),
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
      dictationLifetime.abort()
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
          await scheduleSessions.close()
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
    }
    return 0
  } finally {
    await recording.flush()
    restoreRecording()
  }
}

/** The sharing ports' live dependencies: the engine, taken credentials, the OS store. */
function sharingDeps(): SharingPortsDeps {
  return {
    createRuntime: (options, rtLog) => runtimeFor(options, rtLog),
    credentialValues: sharingCredentials.map(({ value }) => value),
    readModelApiKey: () => secrets.get(SECRET_KEYS.modelApiKey),
  }
}

function runtimeDictation(
  log: Logger,
  isOn: boolean,
  isWorkspaceTrusted: boolean,
  recording?: UsageRecording,
) {
  return voiceCompanionLoader({
    packageRoot,
    dataFolder: agentDataFolder({
      platform: process.platform,
      env: process.env,
      homeDir: homedir(),
    }),
    temporaryRoot: tmpdir(),
    platform: process.platform,
    systemRoot: process.env['SystemRoot'],
    programFiles: process.env['ProgramFiles'],
    isVoiceOn: () => isOn,
    canRemember: () => isWorkspaceTrusted,
    getKey: async () => await secrets.get(SECRET_KEYS.modelApiKey),
    fetch: globalThis.fetch.bind(globalThis),
    sleep: (ms) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms)
      }),
    log,
    ...(recording !== undefined && { recording }),
  })
}

function logLevel(command: RuntimeCommand | SharingCommand): LogLevel {
  if (command.command !== 'serve') {
    return 'warn'
  }
  return command.options.isVerbose ? 'trace' : 'info'
}

async function main(processResources: ProcessResources): Promise<number> {
  // Parse first, on the bundled English table: a stalled package
  // filesystem must not hang argument parsing past exec --timeout or the
  // fixed scan/legal deadlines. Parser refusals read English until the
  // loads below install the display language. Localization runs under the
  // headless lifecycle further down (unbounded for the interactive
  // commands after it), and scan-secrets does no localization work at all
  // (Codex on PR #213).
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
  if (command.command === 'judge') {
    const controller = new AbortController()
    const stop = () => {
      controller.abort()
    }
    const stdout = createFdWriter(process.stdout.fd, stop)
    const stderr = createFdWriter(process.stderr.fd, stop)
    const log = stderrLogger((line) => {
      stderr.write(`${redactWhole(line, [])}\n`)
    }, 'warn')
    const loadJudge = judgeFeaturesLoader({
      bundlePath: path.join(distDir, 'judgeP2.js'),
      log,
    })
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    if (isSetupAction(command.action)) {
      // M125 lane W: the local-only text steps, outside the priced
      // pipeline (no binding, no admission, no request deadline). The
      // abort signal still cancels; anything unexpected keeps the
      // judge command's fixed words and codes.
      const loadSetup = setupFeaturesLoader({
        bundlePath: path.join(distDir, 'judgeSetup.js'),
        log,
      })
      try {
        await loadDisplayLanguage(log)
        const setup = loadSetup()
        const io = { stdin: process.stdin, stdout, stderr }
        const setupPorts = setup.productionSetupPorts()
        const setupPaths = {
          storageRoot: agentDataFolder({
            platform: process.platform,
            env: process.env,
            homeDir: homedir(),
          }),
          tableFile: path.join(distDir, 'judgeModels.json'),
        }
        let code: number
        if (command.action === 'scan') {
          code = await setup.runJudgeScan(io, command.surfaceArgs, setupPorts, setupPaths)
        } else if (command.action === 'setup') {
          code = await setup.runJudgeSetup(
            io,
            command.surfaceArgs,
            setupPorts,
            setupPaths,
            controller.signal,
          )
        } else {
          code = await setup.runJudgeRemove(io, command.surfaceArgs, setupPorts, setupPaths)
        }
        const flushed = await Promise.all([
          stdout.flush(EXEC_FORCE_WRITE_MS),
          stderr.flush(EXEC_FORCE_WRITE_MS),
        ])
        exitHeadless(
          flushed.every(Boolean) && !stdout.isClosed && !stderr.isClosed ? code : EXEC_EXIT.failed,
          stdout.queuedBytes > 0 || stderr.queuedBytes > 0,
        )
      } catch (error: unknown) {
        // Fixed words to the person: no paths, payloads or argv echo.
        // The record keeps the redacted kind.
        log.warn(`Judge setup step failed (${failureForLog(error)})`)
        stderr.write(
          `${controller.signal.aborted ? UI_TEXT.execTimedOut : UI_TEXT.execRequestShape}\n`,
        )
        exitHeadless(EXEC_EXIT.failed, stderr.queuedBytes > 0)
      } finally {
        process.off('SIGINT', stop)
        process.off('SIGTERM', stop)
      }
    }
    try {
      // Available source/offline/surface adapters are required before those
      // commands can succeed; missing dependencies retain explicit refusals.
      const features = loadJudge()
      const evidenceRoot = cliEvidenceRoot({
        evidenceDir: process.env['MUSE_JUDGE_EVIDENCE_DIR'],
        configHome: process.env['XDG_CONFIG_HOME'] ?? path.join(homedir(), '.config'),
      })
      const store: Phase2EvidenceStore = filePhase2EvidenceStore({
        root: evidenceRoot,
        readFile: (file: string): string | undefined => {
          try {
            return readFileSync(file, 'utf8')
          } catch (error: unknown) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
            return undefined
          }
        },
      })
      // Production phase-2 binding (M98 P2B, redesign), the window's own
      // policy and side-factory port: explicit modes bypass only the
      // automatic readiness default, never consent, confidentiality,
      // provenance or admission. The factory runs inside `dist/judgeP2.js`,
      // so judge schemas stay lazy for ordinary commands.
      const commandDeps = await features.createCommandDeps({
        binding: await cliJudgeBinding({
          features,
          options: command.options,
          store,
          readSecret: async (name) => await secrets.get(name),
          // The same D78 daily journal every paid headless use settles into.
          daily: async () => {
            const accounting = await import('./runtimeAccountingEntry.js')
            return accounting.createRuntimeDailyBudget({
              dataFolder: agentDataFolder({
                platform: process.platform,
                env: process.env,
                homeDir: homedir(),
              }),
              now: () => Date.now(),
              sleep: (ms) =>
                new Promise((resolve) => {
                  setTimeout(resolve, ms)
                }),
            })
          },
        }),
        billing: 'free',
        worstCaseUsd: () => Usd.from(0).toAmount(),
      })
      const code = await features.runJudgeCommand(
        command,
        { stdin: process.stdin, stdout, stderr },
        {
          log,
          initialize: async (signal) => {
            await loadDisplayLanguage(log)
            signal.throwIfAborted()
            // Node bundles have separate language state; install the table
            // read above before the lazy command renders its first response.
            loadJudge()
          },
          ...commandDeps,
        },
        controller.signal,
      )
      exitHeadless(code, stdout.queuedBytes > 0 || stderr.queuedBytes > 0)
    } finally {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
    }
  }
  if (command.command === 'invalid' && command.exitCode === EXEC_EXIT.usage) {
    // The refusal was built from the bundled English table at parse time.
    // Install the display language first, then re-parse so the refusal
    // reads in it instead of always in English (Codex on PR #227). A
    // stalled package filesystem must not hang the refusal: the wait is
    // bounded, and a stall keeps the English parse above.
    let reason = command.reason
    const quiet = (): undefined => undefined
    const installed = (async (): Promise<void> => {
      try {
        await loadUiTable({
          language: displayLanguage(
            process.env,
            new Intl.DateTimeFormat().resolvedOptions().locale,
          ),
          readExtensionFile: (segments) => readUiTableFile(packageRoot, segments),
          surface: 'terminal',
          log: { trace: quiet, info: quiet, warn: quiet, error: quiet },
        })
      } catch {
        // An unreadable table keeps the bundled English parse above.
      }
    })()
    await Promise.race([installed, sleep(USAGE_ERROR_LOCALE_MS)])
    const reparsed = parseCommandLine(process.argv.slice(2), parseSharingArgs)
    if (reparsed.command === 'invalid') reason = reparsed.reason
    const stderr = createFdWriter(process.stderr.fd, () => {
      /* A usage error already owns exit 2; a closed pipe cannot turn it into success. */
    })
    stderr.write(`${redactWhole(reason, [])}\n`)
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
    // Only `exec` (its own option) and `scan-secrets` (its `--timeout` flag)
    // name a deadline; without one — and the `legal` scan always — the run
    // continues until it is done or a signal stops it.
    let headlessTimeoutMs: number | undefined
    if (command.command === 'exec') {
      headlessTimeoutMs = command.options.timeoutMs
    } else if (command.command === 'scan-secrets') {
      headlessTimeoutMs = command.timeoutMs
    }
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
      // The scanner has no translated output: stdout is a count, and even
      // its refusal is exit-only. Do not emit panel language diagnostics.
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
      try {
        await lifecycle.race(
          loadUiTable({
            language: displayLanguage(
              process.env,
              new Intl.DateTimeFormat().resolvedOptions().locale,
            ),
            readExtensionFile: (segments) => readUiTableFile(packageRoot, segments),
            surface: 'terminal',
            log,
          }),
        )
      } catch {
        /* The bundled English table is already installed; stop still owns the deadline. */
      }
      setProviderPolicyText(UI_TEXT, uiLocale())
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
          ...(((command.options.backend === 'modelApi' &&
            !command.options.keyFromStdin &&
            command.options.provider === undefined) ||
            command.options.accountPool === true ||
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
          // H–C1: the run's flags configure the process's one governor and its v2 sink.
          createResources: (overrides) => processResources.configure({ overrides }),
        },
        referenceTable,
        uiLocale(),
      )
      return headlessCode
    } catch (error: unknown) {
      log.error(`Run failed: ${failureForLog(error)}`)
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
    surface: 'terminal',
    log,
  })
  setProviderPolicyText(UI_TEXT, uiLocale())
  switch (command.command) {
    case 'dictate': {
      const recording = runtimeRecording(
        log,
        () => 'CLI',
        () => true,
      )
      const openPage = runtimeDictation(log, command.paid, command.trustWorkspace, recording)
      let complete!: () => void
      // eslint-disable-next-line unicorn/prefer-promise-with-resolvers -- Host type project targets Node 20; the resolver is assigned synchronously (PLAN.md §8).
      const sent = new Promise<void>((resolve) => {
        complete = resolve
      })
      const outcome = { hasSent: false }
      const server = await openPage({
        cwd: process.cwd(),
        signal: new AbortController().signal,
        isCurrent: () => !outcome.hasSent,
        send: async (text, signal) => {
          signal.throwIfAborted()
          await new Promise<void>((resolve, reject) => {
            process.stdout.write(`${text}\n`, (error) => {
              if (error == null) resolve()
              else reject(error)
            })
          })
          outcome.hasSent = true
          setImmediate(complete)
        },
      })
      try {
        writeLine(process.stderr, `${UI_TEXT.companionVoiceOpen}: ${server.launchUrl()}`)
        await Promise.race([sent, server.closed])
        return outcome.hasSent ? 0 : EXIT_FAILED
      } finally {
        try {
          await server.close()
        } finally {
          await recording.flush()
        }
      }
    }
    case 'resources': {
      try {
        writeLine(process.stdout, await processResources.command(command.action, command.json))
        return 0
      } catch (error: unknown) {
        // An unreadable journal is named as such; it is never printed as
        // empty history. Only a corrupt or missing journal reads that way.
        if (command.action === 'history') {
          if (error instanceof SyntaxError) {
            writeLine(process.stderr, UI_TEXT.resourceHistoryInvalid)
            return EXIT_FAILED
          }
          if (!isErrno(error)) throw error
          writeLine(process.stderr, UI_TEXT.resourceHistoryInvalid)
          return EXIT_FAILED
        }
        // Any other reading names itself unavailable only when it is.
        if (!(error instanceof ResourceUnavailableError)) throw error
        writeLine(process.stderr, UI_TEXT.resourceUnavailable)
        return EXIT_FAILED
      } finally {
        processResources.dispose()
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
      // A chat target reads the real session through the active runtime; other
      // targets never touch a backend, so they keep today's lazy ports.
      const requiresSession = command.command === 'share' && command.request.target === 'chat'
      const runtime = requiresSession ? await runtimeFor(defaultServeOptions(), log) : undefined
      try {
        return await runtimeSharingLoader(
          path.join(distDir, 'sharingRuntime.js'),
          log,
        )().runRuntimeSharing(
          command,
          sharingPorts(log, runtime, sharingDeps()),
          UI_TEXT,
          uiLocale(),
          log,
        )
      } finally {
        await runtime?.close()
      }
    }
    case 'node': {
      const controller = new AbortController()
      const stop = () => {
        controller.abort()
      }
      process.on('SIGTERM', stop)
      process.on('SIGINT', stop)
      try {
        const loaded = nodeModule(path.join(distDir, NODE_BUNDLE_FILE))
        return await loaded.runNodeArgs(
          command.argv,
          {
            root: nodeDataFolder({
              platform: process.platform,
              env: process.env,
              homeDir: homedir(),
            }),
            signal: controller.signal,
            binding: loaded.productionNodeBinding(),
            now: Date.now,
            print: (line) => {
              writeLine(process.stdout, line)
            },
            readSecret: () =>
              readSecretLine(UI_TEXT.nodeLabels.unlock, process.stdin, process.stderr),
          },
          UI_TEXT,
          uiLocale(),
        )
      } finally {
        process.off('SIGTERM', stop)
        process.off('SIGINT', stop)
      }
    }
    case 'schedule': {
      let scheduleAuthorization: ScheduleWakeAuthorization = {
        scheduledPrompts: command.options.scheduledPrompts === true,
        ...(command.options.maxBudgetUsd !== undefined && {
          maxBudgetUsd: command.options.maxBudgetUsd,
        }),
      }
      const scheduleSessions = runtimeScheduleSessionFactory({
        create: (backend) => {
          const parsed = parseCommandLine([
            'serve',
            '--backend',
            backend,
            ...(backend === 'modelApi' && scheduleAuthorization.scheduledPrompts
              ? [
                  '--scheduled-prompts',
                  '--max-budget-usd',
                  scheduleAuthorization.maxBudgetUsd ?? '0',
                ]
              : []),
          ])
          if (parsed.command !== 'serve') throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
          return runtimeFor(parsed.options, log)
        },
        distDir,
        dataDir: agentDataFolder({
          platform: process.platform,
          env: process.env,
          homeDir: homedir(),
        }),
        log,
        allowsContributorModels: false,
      })
      // As above: read the engine's members by name for the split gate.
      const engineModule = await import('./runtimeEngineEntry')
      engineModule.setUiText(UI_TEXT, uiLocale())
      const scheduleEngine = {
        createRuntimeScheduleDelivery: engineModule.createRuntimeScheduleDelivery,
        setUiText: engineModule.setUiText,
      }
      // The person's stop for the command's store waits (D121): Ctrl-C
      // ends a wait with the abort in words instead of killing the process
      // mid-write. The journal is crash-safe either way.
      const stopController = new AbortController()
      const stopCommand = () => {
        stopController.abort()
      }
      process.once('SIGINT', stopCommand)
      process.once('SIGTERM', stopCommand)
      const load = runtimeSchedulesBinding(
        path.join(distDir, 'schedules.js'),
        log,
        undefined,
        undefined,
        scheduleSessions.ports,
        undefined,
        scheduleEngine,
        undefined,
        stopController.signal,
      )
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
            scheduleAuthorization = await verifyScheduleWake(
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
            const reason = redactWhole(
              error instanceof Error ? error.message : UI_TEXT.scheduleV2.runtime.invalidRequest,
              [],
            )
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
              try {
                await scheduleSessions.close()
              } finally {
                await afterWake?.()
              }
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
      } finally {
        process.off('SIGINT', stopCommand)
        process.off('SIGTERM', stopCommand)
        await scheduleSessions.close()
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
          readLine: (prompt, signal) =>
            readVaultLine(process.stdin, process.stderr, prompt, signal),
          // The one-time recovery code must reach a person, never a redirected file.
          isInteractive: process.stdin.isTTY && process.stdout.isTTY,
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
    case 'grokProvider': {
      const providers = await grokDeps()
      return await providers.run(command.action)
    }
    case 'serve': {
      return await serve(command.options, log, () => loadAccounts(log), processResources)
    }
    case 'login': {
      const { museCode } = await runtimeFor(command.options, log)
      // The login child keeps this directory: the shared manager guards its
      // environment and lookup for it, and the spawn names it outright.
      const cwd = process.cwd()
      return await login({
        resolveLaunch: () => museCode.resolveLaunch(),
        environment: () => museCode.childEnvironment(),
        cwd,
        spawnInTerminal: async (file, args, env, spawnCwd) => {
          // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- `muse login` as `muse serve` is started: the CLI resolved from its install layout, PATH or an absolute --muse-binary (D1a, D4), its launcher's fixed prefix and MUSE_LOGIN_ARGS, as an argument array with no shell (PLAN.md §8)
          const { child } = await spawnResourceProcess('interactive', file, args, {
            env,
            cwd: spawnCwd,
          })
          return child
        },
        printError: (line) => {
          writeLine(process.stderr, line)
        },
      })
    }
    case 'authSet': {
      if (command.admin === true && command.provider !== undefined) {
        const providersFile = await userProvidersFile()
        const { runAuthSetProvider } = await import('./providerAuth')
        return await runAuthSetProvider(
          authDeps(),
          command.provider,
          providersFile.readUserFile,
          providersFile.withUserFileLock,
          { admin: true },
        )
      }
      // A provider-only set (`auth set --provider <id>`, the ACP paste-key
      // method) routes to the provider's own key shape, never Meta's.
      const providerId = authSetProviderId(command)
      if (providerId !== undefined) {
        const providersFile = await userProvidersFile()
        const { runAuthSetProvider } = await import('./providerAuth')
        return await runAuthSetProvider(
          authDeps(),
          providerId,
          providersFile.readUserFile,
          providersFile.withUserFileLock,
        )
      }
      const { target } = command
      return target === undefined ||
        (target.provider === 'meta' && target.account === ACCOUNT_DEFAULT_ID)
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
    case 'authGitHub': {
      const controller = new AbortController()
      const abort = () => {
        controller.abort()
      }
      process.once('SIGINT', abort)
      try {
        const network = globalThis.fetch.bind(globalThis)
        return await authGitHub(command.action, {
          // The terminal is this sign-in's surface: the code and GitHub's
          // address are printed; the token never is.
          source: deviceFlowSource({
            store: secrets,
            flow: {
              fetch: network,
              now: Date.now,
              sleep: (ms, signal) => nodeSleep(ms, undefined, { signal }),
            },
            present: (prompt) => {
              writeLine(
                process.stdout,
                fill(UI_TEXT.githubSignIn.code, {
                  url: prompt.verificationUri,
                  code: prompt.userCode,
                }),
              )
              return Promise.resolve()
            },
            openExternal: (url) => {
              writeLine(process.stdout, fill(UI_TEXT.githubSignIn.signedOut, { url }))
              return Promise.resolve()
            },
            fetch: network,
          }),
          storeName: credentialStoreName(process.platform),
          signal: controller.signal,
          print: (line) => {
            writeLine(process.stdout, line)
          },
          printError: (line) => {
            writeLine(process.stderr, line)
          },
        })
      } finally {
        process.off('SIGINT', abort)
      }
    }
    case 'authStatus': {
      // Every provider command and `auth status` runs the crashed-Connect
      // recovery first and reports it (R5). Bare status answers every
      // credential; the exit code names whether anything is stored (D6).
      const providersFile = await userProvidersFile()
      const { runAuthStatusProvider, runAuthStatusWithRecovery } = await import('./providerAuth')
      const deps = authDeps()
      return command.provider === undefined
        ? await runAuthStatusWithRecovery(
            deps,
            providersFile.withUserFileLock,
            providersFile.readUserFile,
          )
        : await runAuthStatusProvider(
            deps,
            command.provider,
            providersFile.withUserFileLock,
            command.admin === true ? { admin: true } : undefined,
          )
    }
    case 'authClear': {
      if (command.provider === undefined) return await authClear(authDeps())
      const providersFile = await userProvidersFile()
      const { runAuthClearProvider } = await import('./providerAuth')
      return await runAuthClearProvider(
        authDeps(),
        command.provider,
        providersFile.withUserFileLock,
        command.admin === true ? { admin: true } : undefined,
      )
    }
    case 'providersList': {
      const { providersList } = await import('./providersCommands')
      return await providersList(await providersDeps())
    }
    case 'openRouterConnect': {
      const { runOpenRouterConnect } = await import('./openRouterCommands')
      return await runOpenRouterConnect(await providersDeps(), await openRouterApi())
    }
    case 'providersUsageTargets': {
      const { providersUsageTargets } = await import('./providersCommands')
      return await providersUsageTargets(await providersDeps())
    }
    case 'providersAdd': {
      const { providersAdd } = await import('./providersCommands')
      return await providersAdd(await providersDeps(), command.options)
    }
    case 'providersModels': {
      const { providersModels } = await import('./providersModelsCommand')
      return await providersModels(await providersDeps(), command.options)
    }
    case 'providersTest': {
      const { providersTest } = await import('./providersCommands')
      return await providersTest(await providersDeps(), command.provider)
    }
    case 'providersRefresh': {
      const { providersRefresh } = await import('./providersCommands')
      return await providersRefresh(await providersDeps(), command.provider)
    }
    case 'providersRemove': {
      const { providersRemove } = await import('./providersCommands')
      return await providersRemove(await providersDeps(), command.provider)
    }
    case 'providersUsage': {
      const { providersUsage, spendEstimateFromBreakdown } = await import('./providersSpend')
      const { usageLocalDay } = await import('../core/usage/localDay')
      const deps = await providersDeps()
      return await providersUsage(
        {
          ...deps,
          // Our own estimate comes from the local usage journal: the same
          // provider-grouped read the usage page serves. A journal failure
          // shows the provider's figures alone, never against a zero.
          readSpendEstimate: (provider, startMs, endMs) =>
            (async (): Promise<SpendEstimate | undefined> => {
              try {
                const access = usageFor(log).access()
                const state = await access.read({
                  range: 'custom',
                  from: usageLocalDay(startMs),
                  to: usageLocalDay(endMs),
                  groupBy: 'provider',
                  metric: 'cost',
                })
                return spendEstimateFromBreakdown(state.breakdown, [provider])
              } catch (error: unknown) {
                log.warn(
                  `Spend estimate unreadable (${failureForLog(error)}); showing provider figures alone`,
                )
                return undefined
              }
            })(),
        },
        { provider: command.provider, days: command.days, json: command.json },
      )
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
        // The same owners as the ACP agent: the agent data folder the
        // headless governor reads resources.json from, and the runtime's
        // account registry (identity only, read lazily).
        machineDir: servicesInput.dataDir,
        accounts: {
          list: async (provider: string) => {
            const owner = loadAccounts(log)
            return (await owner.metadata.read(provider)) === undefined
              ? []
              : await owner.store.list(provider)
          },
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
        // The one-shot CLI has no live runtime, but its usage reports still
        // show the shared daily paid budget, exactly like VS Code and ACP
        // serve (RVCM1132B finding 3). The ledger read never starts a backend.
        const dataFolder = agentDataFolder({
          platform: process.platform,
          env: process.env,
          homeDir: homedir(),
        })
        const { readRuntimeDailyBudget } = await import('./runtimeAccountingEntry.js')
        return await runtimeReports(log, undefined, undefined, () =>
          readRuntimeDailyBudget({ dataFolder, now: () => Date.now() }),
        )().run(command.args)
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
    case 'mcp': {
      // M124: stdout is the MCP stream from here on; words go to stderr.
      const loadSchedules = runtimeSchedulesBinding(path.join(distDir, 'schedules.js'), log)
      let schedules: RuntimeSchedulesBinding | undefined
      const scheduleAnswer = async (
        root: string,
        options: Parameters<RuntimeSchedulesBinding['command']>[0],
      ): Promise<unknown> => {
        schedules ??= await loadSchedules()
        const result = await schedules.command(options, root, false)
        const answer: unknown = JSON.parse(result.output)
        return answer
      }
      const reports = runtimeReports(log, undefined, undefined, undefined, {
        keepHistory: false,
        allowEgress: () => Promise.resolve(false),
      })
      const dataFolder = agentDataFolder({
        platform: process.platform,
        env: process.env,
        homeDir: homedir(),
      })
      // Finding 15: storage that cannot be verified is not served; a guard
      // that cannot load fails the command before the connector starts.
      const storageGuard = storageGuardLoader(
        path.join(distDir, CONNECTOR_STORE_GUARD_BUNDLE_FILE),
        log,
      )().connectorStorageGuard(path.join(dataFolder, CONNECTOR_FOLDER))
      try {
        return await connectorLoader(path.join(distDir, CONNECTOR_BUNDLE_FILE), log)().runConnector(
          {
            argv: command.argv,
            table: UI_TEXT,
            locale: uiLocale(),
            dataFolder,
            homeDir: homedir(),
            version: packageVersion(),
            stdin: process.stdin,
            stdout: process.stdout,
            stderr: process.stderr,
            isInteractive: process.stdin.isTTY,
            registered: () => sharingCredentials.map((variable) => variable.value),
            openBrowser: openUsageBrowser,
            schedules: {
              list: (root) => scheduleAnswer(root, { operation: 'list', isJson: true }),
              pause: (root, id) => scheduleAnswer(root, { operation: 'pause', id, isJson: true }),
            },
            storageGuard,
            reports: {
              generate: async (root, kind, subjectId, signal) => {
                // M113's own grammar: a positional subject, except playbook's --milestone.
                let subject: string[] = []
                if (subjectId !== undefined)
                  subject = kind === 'playbook' ? ['--milestone', subjectId] : [subjectId]
                const result = await reports().acp.execute([kind, ...subject].join(' '), {
                  cwd: root,
                  sessionId: 'connector',
                  format: 'md',
                  signal,
                })
                if (result.code !== 0) throw new Error(UI_TEXT.reportUi.generationFailed)
                return result.text
              },
            },
          },
        )
      } finally {
        await schedules?.close()
      }
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
        writeLine(
          process.stdout,
          command.route === undefined
            ? formatAcpUsage(UI_TEXT, ACP_AGENT_NAME)
            : formatCommandHelp(UI_TEXT, ACP_AGENT_NAME, command.route),
        )
      }
      return 0
    }
    case 'helpTopic': {
      const topic = helpTopicNamed(command.topic)
      if (topic === undefined) {
        writeLine(
          process.stderr,
          fill(UI_TEXT.cliHelp.unknownTopic, {
            topic: command.topic,
            command: ACP_AGENT_NAME,
          }),
        )
        return 2
      }
      writeLine(process.stdout, renderTopicHelp(UI_TEXT, ACP_AGENT_NAME, topic))
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
      writeLine(process.stderr, formatAcpUsage(UI_TEXT, ACP_AGENT_NAME))
      return command.exitCode ?? EXIT_FAILED
    }
  }
}

/** The process's exit code is the command's; a crash prints its failure word and fails. */
async function run(): Promise<void> {
  const log = stderrLogger((line) => {
    writeLine(process.stderr, line)
  }, 'warn')
  const processResources = resourcesFor(log)
  try {
    process.exitCode = await main(processResources)
  } catch (error: unknown) {
    // A crash names its failure word, never its text: raw stacks stay out
    // of the log.
    log.error(`Run failed: ${failureForLog(error)}`)
    process.exitCode = EXIT_FAILED
  } finally {
    processResources.dispose()
  }
}

void run()
