// RLF-SHUTDOWN, RLF-SHUTDOWN2: the served ACP agent ends when its client
// leaves, in every state, and the Muse Code process it started goes with it.
// Real processes only: the production build's `dist/acp.js` under the SDK's
// own ACP client, and, where the states need Muse Code, the real Muse Code CLI
// found the way the product finds it. No Muse request is ever made: every
// agent runs in its own home, with a dead proxy for every protocol, and no
// prompt is sent. Two real ways make the CLI hang or fail to finish here:
//   - a recorded placeholder sign-in (test/fixtures/maccred/v1-auth-set.json)
//     in a fresh home: macOS has no default keychain for that home, the CLI
//     writes a Keychain item at start, and the write waits for an
//     authorization dialog that a session without a screen can never show
//     (docs/certification/cc-int7.md 6.1). Muse Code never answers. Run only
//     where the login session has no screen, so no dialog can ever appear;
//   - the recorded empty sign-in (v2-empty.json): the CLI starts and answers
//     but cannot reach Muse through the dead proxy, so the session cannot
//     start (the agent says so) and the answered Muse Code is left idle.
// The SIGTERM case starts the same real CLI through three lines of shell that
// only ignore SIGTERM first: the ignored disposition survives the exec into the
// CLI, which is the real process throughout. The case with a tool of the CLI's
// in its process group is not kept: the CLI has no tool at start, and the
// product's fence keeps BASH_ENV out of its environment.
// Each case leaves one way a client does: it closes its input, signals the
// agent (SIGTERM, SIGINT, SIGHUP), or vanishes with its pipes (input and log
// both closed, an editor that crashed). Every case checks afterwards that the
// CLI wrote no Keychain item (its login keychain for the home, and the
// account's own, attributes only). Windows containment (the job helper) is not
// driven here: these cases need POSIX process groups. The states that need no
// Muse Code run wherever the suite runs; the real-CLI states say why they are
// skipped.
import {
  execFileSync,
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import net from 'node:net'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import * as acp from '@agentclientprotocol/sdk'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'
import { resolveMuseLaunch } from '../../src/core/backends/musecode/launch'
import {
  darwinDictationApp,
  MACOS_KEYCHAIN_LOOKUP_ARGS,
  MACOS_KEYCHAIN_LOOKUP_TIMEOUT_MS,
  MACOS_SECURITY_TOOL,
  MUSE_BIN_PREFIX,
  PROXY_VARIABLE_SPELLINGS,
  RESOURCE_MUSE_TERMINATE_GRACE_MS,
  UI_TEXT,
} from '../../src/shared/constants'
import { webReadable } from '../../src/runtime/webStreams'
import { assertCurrentProductionBuild } from './productionBuild'
import { isolatedRuntimeEnvironment } from './helpers/isolatedRuntimeEnvironment'
import { removeFolder } from './helpers/temporaryFolders'

const ROOT = process.cwd()
const AGENT = path.join(ROOT, 'dist', 'acp.js')
const FIXTURES = path.join(ROOT, 'test', 'fixtures', 'maccred')
// This suite's own folder, made in `beforeAll`: nothing is made where the suite is skipped.
const scratch = { folder: '' }
// A case starts the production agent and the real Muse Code CLI and waits for both to exit.
const CASE_MS = 30_000
// The agent and the CLI end far under the SDK's 30 s drain window, which
// belongs to a host that answered and has sessions to drain.
const PROMPT_MS = 10_000
const WAIT_MS = 15_000
// The TCP discard port: nothing listens on a workstation, so a connect is refused at once.
const DEAD_PORT = 9
// The CLI's log line once it answered `initialize`.
const ANSWERED = /Connected to muse /u

interface Process {
  readonly pid: number
  readonly ppid: number
  readonly pgid: number
  readonly command: string
}

interface Left {
  readonly agent: ChildProcessWithoutNullStreams
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  /** The Muse Code process the agent started, when the case started one. */
  readonly cli: number | undefined
  /** The agent's log so far: it names a case's failure. */
  readonly log: () => string
}

interface Start {
  /** The recorded sign-in file the agent's home holds; none when the case starts no Muse Code. */
  readonly signIn?: 'v1-auth-set.json' | 'v2-empty.json'
  /** The Muse Code the agent starts; the installed one by default. */
  readonly museBinary?: string
  /** Where the case leaves: before any session, while Muse Code starts, or after it answered. */
  readonly state: 'idle' | 'starting' | 'answered'
}

const STARTED = new Set<ChildProcessWithoutNullStreams>()
const CLIS = new Set<number>()
const HOMES = new Set<string>()

function processes(): readonly Process[] {
  const table = execFileSync('ps', ['-axo', 'pid=,ppid=,pgid=,command='], { encoding: 'utf8' })
  const rows: Process[] = []
  for (const line of table.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/u.exec(line)
    if (match !== null)
      rows.push({
        pid: Number(match[1]),
        ppid: Number(match[2]),
        pgid: Number(match[3]),
        command: match[4] ?? '',
      })
  }
  return rows
}

function isAlive(pid: number, isGroup = false): boolean {
  try {
    process.kill(isGroup ? -pid : pid, 0)
    return true
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false
    throw error
  }
}

async function waitFor(isDone: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + WAIT_MS
  while (!isDone()) {
    if (Date.now() > deadline) throw new Error(`${what} never held`)
    await delay(25)
  }
}

/** The Muse Code processes on the machine (the real CLI's `muse-bin-<version>`, each leading its group). */
function museProcesses(): readonly Process[] {
  return processes().filter((row) => row.pgid === row.pid && row.command.includes(MUSE_BIN_PREFIX))
}

/** The Muse Code the agent started, once it runs. */
async function startedMuse(agentPid: number): Promise<number> {
  const deadline = Date.now() + WAIT_MS
  for (;;) {
    const pid = museProcesses().find((row) => row.ppid === agentPid)?.pid
    if (pid !== undefined) return pid
    if (Date.now() > deadline) throw new Error('the Muse Code process never started')
    await delay(25)
  }
}

function cliOf(served: Left): number {
  if (served.cli === undefined) throw new Error('the case started no Muse Code')
  return served.cli
}

/** The real CLI the product would run, found as the product finds it; why not when it is not there. */
function installedMuse(): { readonly command: string } | { readonly missing: string } {
  if (process.platform !== 'darwin')
    return { missing: 'the real-CLI states are measured on macOS only' }
  const found = resolveMuseLaunch({
    platform: process.platform,
    configuredPath: '',
    pathEntries: (process.env['PATH'] ?? '').split(path.delimiter).filter((entry) => entry !== ''),
    homeDir: homedir(),
    localAppData: undefined,
    fileExists: (file) => existsSync(file),
    readTextFile: (file) => (existsSync(file) ? readFileSync(file, 'utf8') : undefined),
    listDirectory: (folder) => (existsSync(folder) ? readdirSync(folder) : []),
    serveArgs: [],
    scope: { workspaceRoot: ROOT, realpath: realpathSync },
  })
  if (!found.ok) return { missing: 'no Muse Code CLI is installed on this machine' }
  // The agent's process-identity reads need the signed helper that `native/darwin/build.sh` makes.
  const helper = darwinDictationApp(process.arch)
  return existsSync(path.join(ROOT, 'native', 'darwin', helper))
    ? { command: found.launch.command }
    : { missing: `native/darwin/${helper} is not built (native/darwin/build.sh)` }
}

const MUSE = installedMuse()
const SKIPPED_WITHOUT_CLI = 'missing' in MUSE ? ` (SKIPPED: ${MUSE.missing})` : ''
// `Background` is a session no dialog can ever appear in; any other can show the Keychain's.
const HAS_SCREEN =
  process.platform === 'darwin' &&
  spawnSync('/bin/launchctl', ['managername'], { encoding: 'utf8' }).stdout.trim() !== 'Background'
const SKIPPED_WITH_SCREEN = HAS_SCREEN
  ? ' (SKIPPED: this login session can show a Keychain dialog, and the blocked start waits for one)'
  : ''

/** The CLI's Keychain item as `security` reports it for a home: the exit status and its attributes only. */
function keychainFacts(home: string): {
  readonly status: number | null
  readonly attributes: string
} {
  const run = spawnSync(MACOS_SECURITY_TOOL, [...MACOS_KEYCHAIN_LOOKUP_ARGS], {
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
    timeout: MACOS_KEYCHAIN_LOOKUP_TIMEOUT_MS,
  })
  return { status: run.status, attributes: run.stdout }
}

/** Whether nothing listens on the port: the proxy that keeps every request off Muse. */
function nothingListensOn(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', (error: NodeJS.ErrnoException) => {
      resolve(error.code === 'ECONNREFUSED')
    })
  })
}

/**
The production agent in a home of its own. `idle`: no Muse Code started.
`starting`: `session/new` is sent and left pending while the CLI never answers.
`answered`: the CLI answered and the session could not start, said so.
*/
async function startedAgent(start: Start): Promise<Left> {
  const workspace = mkdtempSync(path.join(scratch.folder, 'workspace-'))
  const home = mkdtempSync(path.join(scratch.folder, 'home-'))
  // Owner-only, as a profile is.
  mkdirSync(path.join(home, 'config', 'muse'), { recursive: true, mode: 0o700 })
  if (start.signIn !== undefined)
    copyFileSync(path.join(FIXTURES, start.signIn), path.join(home, 'config', 'muse', 'auth.json'))
  if (start.state !== 'idle') HOMES.add(home)
  const proxy = `http://127.0.0.1:${String(DEAD_PORT)}`
  const env = {
    ...isolatedRuntimeEnvironment(home, scratch.folder),
    ...Object.fromEntries(PROXY_VARIABLE_SPELLINGS.map((name) => [name, proxy])),
    NO_PROXY: '',
    no_proxy: '',
    // The launcher touches nothing in its install folder.
    MUSE_NO_AUTO_UPDATE: '1',
  }
  const museBinary = start.museBinary ?? ('command' in MUSE ? MUSE.command : undefined)
  const agent = spawn(
    process.execPath,
    [
      AGENT,
      ...(museBinary !== undefined && start.state !== 'idle' ? ['--muse-binary', museBinary] : []),
    ],
    { cwd: workspace, env, stdio: 'pipe' },
  )
  const agentPid = agent.pid
  if (agentPid === undefined) throw new Error('the agent did not start')
  STARTED.add(agent)
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    agent.once('close', (code, signal) => {
      STARTED.delete(agent)
      resolve({ code, signal })
    })
  })
  // The agent's log: reading it keeps the pipe flowing, and it names a case's failure.
  let log = ''
  agent.stderr.setEncoding('utf8')
  agent.stderr.on('data', (chunk: string) => {
    log += chunk
  })
  const stream = acp.ndJsonStream(Writable.toWeb(agent.stdin), webReadable(agent.stdout))
  const client = acp.client({ name: 'acp-shutdown' })
  const ready = Promise.withResolvers<boolean>()
  // What the agent said to `session/new`; it says nothing while Muse Code starts.
  const said: { value?: string } = {}
  void (async () => {
    try {
      await client.connectWith(stream, async (ctx) => {
        await ctx.request('initialize', {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        })
        if (start.state !== 'idle') {
          // Sent and left pending: the agent's answer is the case's end, not its start.
          void ctx
            .request('session/new', { cwd: workspace, mcpServers: [] })
            .then(() => {
              said.value = ''
            })
            .catch((error: unknown) => {
              said.value = error instanceof Error ? error.message : String(error)
            })
        }
        ready.resolve(true)
        // Holds the client's connection open until the agent leaves.
        await exited
      })
    } catch (error: unknown) {
      // The connection ending with the agent is the case's own doing; a
      // failure before the client was ready fails the case.
      ready.reject(error instanceof Error ? error : new Error(String(error)))
    }
  })()
  await ready.promise
  if (start.state === 'idle') return { agent, exited, cli: undefined, log: () => log }
  try {
    if (start.state === 'answered') {
      await waitFor(() => said.value !== undefined, "the agent's answer to session/new")
      const answer = said.value ?? ''
      if (!answer.includes(UI_TEXT.acpNoModels)) throw new Error(`it said: ${answer}`)
    }
    const cli = await startedMuse(agentPid)
    CLIS.add(cli)
    return { agent, exited, cli, log: () => log }
  } catch (error: unknown) {
    throw new Error(`Muse Code did not start as the case needs; the agent's log: ${log}`, {
      cause: error,
    })
  }
}

/** The client leaves; the agent ends cleanly, with its log naming a failure. Returns how long it took. */
async function leaveAndEnd(served: Left, leave: (served: Left) => void): Promise<number> {
  const left = Date.now()
  leave(served)
  expect(await served.exited, served.log()).toEqual({ code: 0, signal: null })
  return Date.now() - left
}

/** The client leaves: the agent ends promptly and cleanly, and the Muse Code it started goes with its group. */
async function leaveAndGone(served: Left, leave: (served: Left) => void): Promise<void> {
  const cli = cliOf(served)
  // The CLI leads its own group (the SDK made it one), the agent's apart.
  expect(isAlive(cli, true)).toBe(true)
  expect(await leaveAndEnd(served, leave)).toBeLessThan(PROMPT_MS)
  await waitFor(() => !isAlive(cli, true), 'the end of the Muse Code process group')
  expect(isAlive(cli)).toBe(false)
}

const LEAVES = [
  {
    name: 'its input closing',
    leave: (served: Left) => {
      served.agent.stdin.end()
    },
  },
  {
    name: 'SIGTERM',
    leave: (served: Left) => {
      served.agent.kill('SIGTERM')
    },
  },
  {
    name: 'SIGINT',
    leave: (served: Left) => {
      served.agent.kill('SIGINT')
    },
  },
  {
    name: 'SIGHUP',
    leave: (served: Left) => {
      served.agent.kill('SIGHUP')
    },
  },
] as const

// An editor that crashes closes both pipes it holds: the input is read as the
// end, and the log pipe's writes fail with EPIPE.
const VANISHES = {
  name: 'the editor vanishing with its pipes',
  leave: (served: Left) => {
    served.agent.stderr.destroy()
    served.agent.stdin.end()
  },
} as const

describe.skipIf(process.platform === 'win32')('the served agent when its client leaves', () => {
  beforeAll(() => {
    assertCurrentProductionBuild(inject('productionBuildGeneration'), ROOT)
    scratch.folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'muse-shutdown-')))
  })

  afterEach(async () => {
    // A case that failed, or a Muse Code a leave did not end, is ended after it, and named.
    const left = [...CLIS].filter((pid) => isAlive(pid) || isAlive(pid, true))
    const named = processes().filter((row) => left.includes(row.pid))
    for (const pid of left) {
      if (isAlive(pid, true)) process.kill(-pid, 'SIGKILL')
      if (isAlive(pid)) process.kill(pid, 'SIGKILL')
    }
    CLIS.clear()
    const agents = [...STARTED]
    for (const agent of agents) agent.kill('SIGKILL')
    await Promise.all(agents.map((agent) => new Promise((resolve) => agent.once('close', resolve))))
    expect(
      named.map((row) => `${String(row.pid)} (parent ${String(row.ppid)}) ${row.command}`),
      'a Muse Code process was left running',
    ).toEqual([])
  })

  afterAll(async () => {
    await removeFolder(scratch.folder)
  })

  describe('before any backend started', () => {
    it.each(LEAVES)(
      '$name ends it with its work done',
      async ({ leave }) => {
        const before = new Set(museProcesses().map((row) => row.pid))
        const served = await startedAgent({ state: 'idle' })
        expect(await leaveAndEnd(served, leave)).toBeLessThan(PROMPT_MS)
        // No Muse Code was started, on the way or by the leave.
        expect(museProcesses().filter((row) => !before.has(row.pid))).toEqual([])
      },
      CASE_MS,
    )
  })

  describe.skipIf('missing' in MUSE)(`with the real Muse Code CLI${SKIPPED_WITHOUT_CLI}`, () => {
    // The account's own keychain, as the CLI's service is in it before the suite starts.
    const account: { before?: ReturnType<typeof keychainFacts> } = {}

    beforeAll(async () => {
      account.before = keychainFacts(process.env['HOME'] ?? homedir())
      // Every request the CLI makes goes to a proxy nothing answers: none reaches Muse.
      expect(await nothingListensOn(DEAD_PORT), 'something listens on the dead proxy port').toBe(
        true,
      )
    })

    afterEach(() => {
      // No case wrote the CLI's Keychain item: not in a home's own keychain, which no case made, nor the account's.
      for (const home of HOMES) {
        expect(keychainFacts(home).status, home).not.toBe(0)
        expect(existsSync(path.join(home, 'Library', 'Keychains')), home).toBe(false)
      }
      HOMES.clear()
      expect(keychainFacts(process.env['HOME'] ?? homedir())).toEqual(account.before)
    })

    describe.skipIf(HAS_SCREEN)(
      `while Muse Code is still starting, blocked in the Keychain${SKIPPED_WITH_SCREEN}`,
      () => {
        it.each([...LEAVES, VANISHES])(
          '$name ends the agent and the Muse Code it started, with its whole group',
          async ({ leave }) => {
            const served = await startedAgent({ state: 'starting', signIn: 'v1-auth-set.json' })
            await leaveAndGone(served, leave)
            // It was still starting when the client left: it never answered.
            expect(served.log()).not.toMatch(ANSWERED)
          },
          CASE_MS,
        )

        it(
          'ends a Muse Code that ignores SIGTERM after the grace, with SIGKILL',
          async () => {
            const real = 'command' in MUSE ? MUSE.command : ''
            const ignoring = path.join(scratch.folder, 'muse-ignoring-sigterm')
            // An ignored signal stays ignored through exec: the CLI that runs is the real one.
            writeFileSync(
              ignoring,
              `#!/bin/sh\ntrap '' TERM\nexec '${real.replaceAll("'", String.raw`'\''`)}' "$@"\n`,
              { mode: 0o755 },
            )
            const served = await startedAgent({
              state: 'starting',
              signIn: 'v1-auth-set.json',
              museBinary: ignoring,
            })
            const cli = cliOf(served)
            const took = await leaveAndEnd(served, (left) => {
              left.agent.kill('SIGTERM')
            })
            // Not at once: SIGTERM got its whole grace; and not the SDK's drain.
            expect(took).toBeGreaterThanOrEqual(RESOURCE_MUSE_TERMINATE_GRACE_MS - 100)
            expect(took).toBeLessThan(PROMPT_MS)
            await waitFor(() => !isAlive(cli, true), 'the end of the Muse Code process group')
            expect(isAlive(cli)).toBe(false)
          },
          CASE_MS,
        )

        it(
          'never touches a Muse Code another agent started, nor a process it did not start',
          async () => {
            const other = await startedAgent({ state: 'starting', signIn: 'v1-auth-set.json' })
            const mine = await startedAgent({ state: 'starting', signIn: 'v1-auth-set.json' })
            const bystander = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30)'], {
              stdio: 'ignore',
              detached: true,
            })
            const otherCli = cliOf(other)
            try {
              await leaveAndEnd(mine, (agent) => {
                agent.agent.kill('SIGTERM')
              })
              await waitFor(() => !isAlive(cliOf(mine)), 'the end of the Muse Code process')
              expect(isAlive(otherCli)).toBe(true)
              expect(other.agent.exitCode).toBeNull()
              expect(isAlive(bystander.pid ?? 0)).toBe(true)
            } finally {
              bystander.kill('SIGKILL')
            }
            // The other agent still ends its own, when its client leaves.
            other.agent.stdin.end()
            expect(await other.exited, other.log()).toEqual({ code: 0, signal: null })
            await waitFor(() => !isAlive(otherCli), 'the end of the other Muse Code process')
          },
          CASE_MS,
        )
      },
    )

    describe('after Muse Code answered and the session could not start', () => {
      it.each([...LEAVES, VANISHES])(
        '$name ends the agent and the Muse Code that answered',
        async ({ leave }) => {
          const served = await startedAgent({ state: 'answered', signIn: 'v2-empty.json' })
          expect(served.log()).toMatch(ANSWERED)
          await leaveAndGone(served, leave)
        },
        CASE_MS,
      )
    })
  })
})
