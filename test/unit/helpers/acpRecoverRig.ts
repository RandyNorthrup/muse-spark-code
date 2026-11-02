// A real `muse serve` owned by a test (RLF-ACPRECOVER): the spawn, the
// backend manager's own handshake, and a real `MuseCodeHost` over it,
// with the child kept so the test can kill it. Unsigned runs take a
// throwaway home with the given credential text (the echo provider then
// serves ephemeral sessions); signed-in runs take the person's real home
// so the CLI signs in on its own, exactly as for the product, and the
// test never runs a turn on a model provider there.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { Connection } from '@muse-code/sdk'
import { ChildStdioTransport } from '@muse-code/sdk/dist/src/connection/spawn.js'
import type { HostExit } from '../../../src/core/agent/agentBackend'
import type { CoreLogger } from '../../../src/core/logging'
import { MuseCodeHost } from '../../../src/core/backends/musecode/MuseCodeHost'
import { resolveMuseLaunch } from '../../../src/core/backends/musecode/launch'
import { credentialFilePath } from '../../../src/core/backends/musecode/credentialPath'
import {
  credentialFileVerdict,
  isSignedInByStructure,
} from '../../../src/core/backends/musecode/credentialFile'
import { withoutCredentials } from '../../../src/runtime/credentialVariables'
import { isolatedRuntimeEnvironment } from './isolatedRuntimeEnvironment'
import { MSP_CLIENT_NAME, MSP_REQUESTED_CAPABILITIES } from '../../../src/shared/constants'

/** The product's own CLI resolution; undefined where Muse Code is not installed. */
export function museCommand(): string | undefined {
  const resolution = resolveMuseLaunch({
    platform: process.platform,
    configuredPath: '',
    pathEntries: (process.env['PATH'] ?? '').split(path.delimiter),
    homeDir: homedir(),
    localAppData: process.env['LOCALAPPDATA'],
    fileExists: existsSync,
    readTextFile: (file) => (existsSync(file) ? readFileSync(file, 'utf8') : undefined),
    listDirectory: (directory) => (existsSync(directory) ? readdirSync(directory) : []),
    serveArgs: ['serve'],
    scope: { workspaceRoot: tmpdir(), realpath: realpathSync },
  })
  return resolution.ok ? resolution.launch.command : undefined
}

export const MUSE = museCommand()

// A genuinely long operation: a real `muse serve` start, its handshake, a
// session and a turn, then a kill and its settle, on a shared rig.
export const RECOVER_TEST_TIMEOUT_MS = 30_000

export function museOrThrow(): string {
  if (MUSE === undefined) {
    throw new Error('the Muse Code CLI is not installed on this machine')
  }
  return MUSE
}

/**
Whether the CLI is signed in, by the credential file's structure alone
(values never read): the suites that need a catalogue and durable
sessions skip without it.
*/
export function isCliSignedIn(): boolean {
  const file = credentialFilePath({
    platform: process.platform,
    homeDir: homedir(),
    xdgConfigHome: process.env['XDG_CONFIG_HOME'],
  })
  return (
    existsSync(file) &&
    isSignedInByStructure(credentialFileVerdict(readFileSync(file, 'utf8'), process.platform))
  )
}

export interface LoggedLine {
  readonly level: 'trace' | 'info' | 'warn' | 'error'
  readonly message: string
}

export function collectingCoreLog(into: LoggedLine[]): CoreLogger {
  return {
    trace: (message: string): void => {
      into.push({ level: 'trace', message })
    },
    info: (message: string): void => {
      into.push({ level: 'info', message })
    },
    warn: (message: string): void => {
      into.push({ level: 'warn', message })
    },
    error: (message: string): void => {
      into.push({ level: 'error', message })
    },
  }
}

export interface ServeHost {
  readonly host: MuseCodeHost
  readonly child: ChildProcessWithoutNullStreams
  readonly home: string
  readonly lines: LoggedLine[]
  readonly exits: HostExit[]
}

export type ServeHome =
  | { readonly kind: 'throwaway-unsigned'; readonly credentialText: string }
  | { readonly kind: 'real' }

export interface StartServeOptions {
  readonly muse: string
  readonly serveArgs: readonly string[]
  readonly stderrs: string[]
  readonly home: ServeHome
  readonly extraEnv?: NodeJS.ProcessEnv
}

const live: ServeHost[] = []
const scratchHomes: string[] = []

export function trackScratchHome(home: string): void {
  scratchHomes.push(home)
}

export async function productVersion(): Promise<string> {
  const raw = await readFile(new URL('../../../package.json', import.meta.url), 'utf8')
  return (JSON.parse(raw) as { version: string }).version
}

/**
A real host over a real `muse serve` the test owns (for the kill). The
SDK's own child transport carries the real bytes; the handshake mirrors
the backend manager's. A throwaway home is removed by
`cleanupRecoverRig`; the real home is never touched.
*/
export async function startServeHost(options: StartServeOptions): Promise<ServeHost> {
  const { muse, serveArgs, stderrs } = options
  let home: string
  let env: NodeJS.ProcessEnv
  if (options.home.kind === 'real') {
    home = homedir()
    env = { ...withoutCredentials(process.env), MUSE_NO_AUTO_UPDATE: '1', ...options.extraEnv }
  } else {
    home = await mkdtemp(path.join(tmpdir(), 'acp-recover-'))
    const configHome = path.join(home, 'config')
    await mkdir(path.join(configHome, 'muse'), { recursive: true })
    await writeFile(
      credentialFilePath({
        homeDir: home,
        xdgConfigHome: configHome,
        platform: process.platform,
      }),
      options.home.credentialText,
    )
    scratchHomes.push(home)
    env = {
      ...isolatedRuntimeEnvironment(home, tmpdir()),
      MUSE_NO_AUTO_UPDATE: '1',
      ...options.extraEnv,
    }
  }
  const child = spawn(muse, [...serveArgs], { env, stdio: ['pipe', 'pipe', 'pipe'] })
  const transport = new ChildStdioTransport(child, (chunk: string) => {
    stderrs.push(chunk)
  })
  const connection = new Connection(transport)
  const initializeResult = await connection.request('initialize', {
    clientInfo: { name: MSP_CLIENT_NAME, version: await productVersion() },
    capabilities: {
      userInputDialogs: true,
      requestedCapabilities: [...MSP_REQUESTED_CAPABILITIES],
      experimentalApi: true,
    },
  })
  connection.notify('initialized')
  await connection.flush()
  const lines: LoggedLine[] = []
  const exits: HostExit[] = []
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      resolve({ code, signal })
    })
  })
  const host = new MuseCodeHost(
    {
      connection,
      initializeResult,
      exited,
      close: () => transport.close(),
    },
    collectingCoreLog(lines),
  )
  host.onExit((exit: HostExit) => {
    exits.push(exit)
  })
  const serve = { host, child, home, lines, exits }
  live.push(serve)
  return serve
}

/** Kills every owned serve child, closes its host, and removes throwaway homes. */
export async function cleanupRecoverRig(): Promise<void> {
  for (const serve of live.splice(0)) {
    try {
      serve.child.kill('SIGKILL')
    } catch {
      // Already gone: the test killed it, which is the point.
    }
    try {
      await serve.host.close()
    } catch {
      // Already gone: closing a dead host is cleanup.
    }
  }
  for (const home of scratchHomes.splice(0)) {
    await rm(home, { recursive: true, force: true })
  }
}

/** A dead host's skip line: the session, the verb, and the named state. */
export function hasSkippedLine(
  lines: readonly LoggedLine[],
  sessionId: string,
  verb: string,
): boolean {
  return lines.some(
    (line) =>
      line.level === 'info' &&
      line.message.includes(sessionId) &&
      line.message.includes(verb) &&
      line.message.includes('exited'),
  )
}

/** Log lines that carry only `Error`, the finding's symptom, never allowed. */
export function bareErrorLines(lines: readonly LoggedLine[]): readonly LoggedLine[] {
  return lines.filter((line) => line.message === 'Error' || line.message.endsWith('failed: Error'))
}

/**
Polls until the condition holds, then returns; throws naming what never
happened when the budget runs out, so a hang fails instead of passing.
*/
export async function waitFor(what: string, isDone: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 500 && !isDone(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  if (!isDone()) {
    throw new Error(what)
  }
}
