// `muse-spark-code-acp` (PLAN.md D62): the Muse Spark agent for editors that
// speak the Agent Client Protocol, and the sign-in commands their terminal
// sign-ins run (D61). stdout carries the protocol; everything the user or
// the log reads goes to stderr, except the sign-in commands' own output.
// Exercised through the built `dist/acp.js` by the stdio e2e test.

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { Writable } from 'node:stream'
import { ndJsonStream } from '@agentclientprotocol/sdk'
import { AsyncEntry } from '@napi-rs/keyring'
import { createAcpAgent, type SignInMethod } from '../acp/agent'
import { processGitRunner } from '../host/git'
import { loadUiTable } from '../host/l10n'
import { ACP_AGENT_NAME, ACP_AUTH_METHODS, SETTING_DEFAULTS, UI_TEXT } from '../shared/constants'
import { fill } from '../shared/l10n/text'
import { authClear, type AuthCommandDeps, authSet, authStatus, login } from './authCommands'
import { createRuntimeBackend } from './backends'
import { parseCommandLine, type ServeOptions } from './cliArgs'
import { readSecretLine } from './hiddenInput'
import { credentialStoreName, keyringSecretStore } from './keyStore'
import { displayLanguage } from './locale'
import type { Logger } from '../host/logger'
import { type LogLevel, stderrLogger } from './stderrLog'
import { webReadable } from './webStreams'

const EXIT_FAILED = 1
// The package root holds `package.json` and `l10n/`; this file runs from `dist/`.
const distDir = __dirname
const packageRoot = path.dirname(distDir)

function writeLine(stream: NodeJS.WriteStream, line: string): void {
  stream.write(`${line}\n`)
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
const secrets = keyringSecretStore(
  (service, account) => new AsyncEntry(service, account, { linux: { store: 'secret-service' } }),
)

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
    fetch: globalThis.fetch.bind(globalThis),
    log,
  })
}

async function serve(options: ServeOptions, log: Logger): Promise<number> {
  const runtime = runtimeFor(options, log)
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
        spawnInTerminal: (file, args, env) => spawn(file, [...args], { env, stdio: 'inherit' }),
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
      return EXIT_FAILED
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
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    )
    process.exitCode = EXIT_FAILED
  }
}

void run()
