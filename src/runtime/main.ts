// `muse-spark-code-acp` (PLAN.md D62): the Muse Spark agent for editors that
// speak the Agent Client Protocol, and the sign-in commands their terminal
// sign-ins run (D61). stdout carries the protocol; everything the user or
// the log reads goes to stderr, except the sign-in commands' own output.
// Exercised through the built `dist/acp.js` by the stdio e2e test.

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { Writable } from 'node:stream'
import { ndJsonStream } from '@agentclientprotocol/sdk'
import { createAcpAgent, type SignInMethod } from '../acp/agent'
import { processGitRunner } from '../host/git'
import { loadUiTable } from '../host/l10n'
import {
  ACP_AGENT_NAME,
  ACP_AUTH_METHODS,
  EXEC_EXIT,
  EXEC_SCAN_TIMEOUT_MS,
  EXEC_FORCE_WRITE_MS,
  SECRET_KEYS,
  SETTING_DEFAULTS,
  UI_TEXT,
} from '../shared/constants'
import type { SecretStore } from '../host/auth/credentialStore'
import { fill } from '../shared/l10n/text'
import { authClear, type AuthCommandDeps, authSet, authStatus, login } from './authCommands'
import { createRuntimeBackend } from './backends'
import { parseCommandLine, type ServeOptions } from './cliArgs'
import { storeErrorCode } from '../host/backend/storeErrors'
import { appendReportJournalEntry, reportJournalPath, runReportCommand } from './reportCommand'
import { readSecretLine } from './hiddenInput'
import { credentialStoreName, keyringSecretStore } from './keyStore'
import { takeCredentials } from './credentialVariables'
import { displayLanguage } from './locale'
import { envProxyWarning } from './proxyWarning'
import type { Logger } from '../host/logger'
import { type LogLevel, stderrLogger } from './stderrLog'
import { webReadable } from './webStreams'
import { createLifecycle } from './exec/execLimits'
import { createFdWriter } from './exec/fdWriter'
import { createExecLogger, redactWhole } from './exec/execOutput'
import { runExec } from './exec/runExec'
import { runSecretScan } from './exec/scanSecrets'

const EXIT_FAILED = 1
// Credential variables leave the agent's own environment before anything
// starts a process; only Muse Code's processes get them back (rule 8).
const museCodeCredentials = takeCredentials(process.env)
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
const nativeStore: { value?: Promise<SecretStore> } = {}
async function loadSecrets(): Promise<SecretStore> {
  nativeStore.value ??= (async () => {
    const { AsyncEntry } = await import('@napi-rs/keyring')
    return keyringSecretStore(
      (service, account) =>
        new AsyncEntry(service, account, { linux: { store: 'secret-service' } }),
    )
  })()
  return await nativeStore.value
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

/** The report journal's bytes, or undefined when none was ever written. Other failures throw. */
async function readJournalBytes(file: string): Promise<Uint8Array | undefined> {
  try {
    return await readFile(file)
  } catch (error: unknown) {
    if (storeErrorCode(error) === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

/** A whole-file write through a temporary file plus rename, beside the target. */
async function writeJournalBytes(file: string, bytes: Uint8Array): Promise<void> {
  const temporary = `${file}.tmp-${String(process.pid)}`
  await writeFile(temporary, bytes)
  await rename(temporary, file)
}

/** Where this agent's ACP error observer records facts-only entries (M93 lane A, D72). */
function journalPath(): string {
  return reportJournalPath({ platform: process.platform, env: process.env, homeDir: homedir() })
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

function runtimeFor(options: ServeOptions, log: Logger) {
  return createRuntimeBackend({
    options,
    version: packageVersion(),
    distDir,
    platform: process.platform,
    env: process.env,
    homeDir: homedir(),
    secrets,
    runGit: processGitRunner(),
    museCodeCredentials,
    fetch: globalThis.fetch.bind(globalThis),
    sleep,
    log,
  })
}

async function serve(options: ServeOptions, log: Logger): Promise<number> {
  const runtime = runtimeFor(options, log)
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
  const agent = createAcpAgent({
    backend: runtime.backend,
    version: packageVersion(),
    options: {
      canBypass: options.canBypass,
      allowsContributorModels: options.allowsContributorModels,
      initialMode: SETTING_DEFAULTS.initialPermissionMode,
    },
    signIn: signInMethod(options),
    defaultCwd: process.cwd(),
    paid: runtime.paid,
    log,
    reportError: (fact) => {
      // Facts-only observation for `report` (M93 lane A, D72): it never
      // touches ACP stdout, and a failed journal write never reaches the session.
      void appendReportJournalEntry({
        journalPath: journalPath(),
        entry: fact,
        nowMs: Date.now(),
        readBytes: readJournalBytes,
        writeBytes: writeJournalBytes,
        ensureDir: async (directory) => {
          await mkdir(directory, { recursive: true })
        },
      })
    },
  })
  const connection = agent.connect(
    ndJsonStream(Writable.toWeb(process.stdout), webReadable(process.stdin)),
  )
  log.info(`${ACP_AGENT_NAME} ${packageVersion()} serving ACP on stdio (${options.backend})`)
  await connection.closed
  await runtime.close()
  return 0
}

function logLevel(command: ReturnType<typeof parseCommandLine>): LogLevel {
  if (command.command !== 'serve') {
    return 'warn'
  }
  return command.options.isVerbose ? 'trace' : 'info'
}

async function main(): Promise<number> {
  const command = parseCommandLine(process.argv.slice(2))
  if (command.command === 'invalid' && command.exitCode === EXEC_EXIT.usage) {
    const stderr = createFdWriter(process.stderr.fd, () => {
      /* A usage error already owns exit 2; a closed pipe cannot turn it into success. */
    })
    stderr.write(`${redactWhole(command.reason, [])}\n`)
    const isFlushed = await stderr.flush(EXEC_FORCE_WRITE_MS)
    exitHeadless(EXEC_EXIT.usage, !isFlushed)
  }
  if (command.command === 'exec' || command.command === 'scan-secrets') {
    const closed = () => {
      lifecycle.latch({ kind: 'output_closed' })
    }
    const stdout = createFdWriter(process.stdout.fd, closed)
    const stderr = createFdWriter(process.stderr.fd, closed)
    const now = () => performance.timeOrigin + performance.now()
    const lifecycle = createLifecycle({
      processStartMs: performance.timeOrigin,
      timeoutMs: command.command === 'exec' ? command.options.timeoutMs : EXEC_SCAN_TIMEOUT_MS,
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
            readExtensionFile: (segments) => readFile(path.join(packageRoot, ...segments), 'utf8'),
            log,
          }),
        )
      } catch {
        /* The bundled English table is already installed; stop still owns the deadline. */
      }
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
      headlessCode = await runExec(lifecycle, {
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
        museCodeCredentials,
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
      headlessCode = command.command === 'scan-secrets' ? EXEC_EXIT.usage : EXEC_EXIT.internal
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
    readExtensionFile: (segments) => readFile(path.join(packageRoot, ...segments), 'utf8'),
    log,
  })
  switch (command.command) {
    case 'serve': {
      return await serve(command.options, log)
    }
    case 'login': {
      const { museCode } = runtimeFor(command.options, log)
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
      return await authSet(authDeps())
    }
    case 'authStatus': {
      return await authStatus(authDeps())
    }
    case 'authClear': {
      return await authClear(authDeps())
    }
    case 'report': {
      // No backend, no auth flow and no model startup: only local, capped
      // recorder data and allowlisted local facts (M93 lane A, D72).
      const homeDir = homedir()
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
        hasEnvironmentApiKey: 'META_API_KEY' in process.env,
        readStoredKeyPresence: async () => {
          try {
            const stored = await secrets.get(SECRET_KEYS.modelApiKey)
            return stored !== undefined && stored !== ''
          } catch {
            // A store that cannot be read reads no (documented in docs/acp.md).
            return false
          }
        },
        nowMs: Date.now(),
        journalPath: journalPath(),
        readJournal: readJournalBytes,
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
      writeLine(process.stdout, fill(UI_TEXT.acpUsage, { command: ACP_AGENT_NAME }))
      return 0
    }
    case 'invalid': {
      writeLine(process.stderr, command.reason)
      writeLine(process.stderr, fill(UI_TEXT.acpUsage, { command: ACP_AGENT_NAME }))
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
