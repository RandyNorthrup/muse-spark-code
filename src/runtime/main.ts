import { legalScanLoader } from '../host/ide/legalScanBundle'
// `muse-spark-code-acp` (PLAN.md D62): the Muse Spark agent for editors that
// speak the Agent Client Protocol, and the sign-in commands their terminal
// sign-ins run (D61). stdout carries the protocol; everything the user or
// the log reads goes to stderr, except the sign-in commands' own output.
// Exercised through the built `dist/acp.js` by the stdio e2e test.

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { open, readFile, writeFile } from 'node:fs/promises'
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
  EXEC_STOP_GRACE_MS,
  LEGAL_EXIT,
  LEGAL_SCAN_TIMEOUT_MS,
  LEGAL_SCAN_BUNDLE_FILE,
  SETTING_DEFAULTS,
  UI_TEXT,
} from '../shared/constants'
import type { SecretStore } from '../host/auth/credentialStore'
import { fill } from '../shared/l10n/text'
import { authClear, type AuthCommandDeps, authSet, authStatus, login } from './authCommands'
import { createRuntimeBackend } from './backends'
import { isHeadlessCommand, parseCommandLine, type ServeOptions } from './cliArgs'
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
import { loadLegalScanner } from './legal/legalScanner'
import { runLegalCommand } from './legal/runLegal'

const EXIT_FAILED = 1
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
  const legalRegistryNotices = new Map<string, Set<string>>()
  const agentLegalBundle = legalScanLoader({
    bundlePath: path.join(distDir, LEGAL_SCAN_BUNDLE_FILE),
    log,
  })
  const agent = createAcpAgent({
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
  if (isHeadlessCommand(command)) {
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
