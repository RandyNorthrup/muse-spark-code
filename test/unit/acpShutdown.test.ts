// RLF-SHUTDOWN: the served ACP agent ends when its client leaves, in every
// state, and the Muse Code process it started goes with it. Real processes
// only: the production build's `dist/acp.js` under the SDK's own ACP client,
// started with `--muse-binary` naming Node itself, so the "Muse Code" it
// spawns runs the folder's `serve.js`, a real process that never reads its
// input and never answers (the CLI blocked in a Keychain approval that
// cannot appear on a Mac without a screen, CC-INT7 §6.1, behaves the same to
// the agent). That child imitates no part of the protocol: it is only what the
// agent's process handling is proved against. Its own child shares its process
// group, as a CLI's tools do. Each case leaves by one way a client does: it
// closes its input, signals the agent (SIGTERM, SIGINT, SIGHUP), or vanishes
// with its pipes (input and log both closed, an editor that crashed).
// The state where the CLI already answered keeps the SDK's drain ladder, which
// this change does not touch; the packed agent with the real CLI is in
// docs/certification/rlf-shutdown.md. Windows containment (the job helper) is
// not driven here: these cases need POSIX process groups.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
} from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import * as acp from '@agentclientprotocol/sdk'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'
import { RESOURCE_MUSE_TERMINATE_GRACE_MS } from '../../src/shared/constants'
import { webReadable } from '../../src/runtime/webStreams'
import { assertCurrentProductionBuild } from './productionBuild'
import { isolatedRuntimeEnvironment } from './helpers/isolatedRuntimeEnvironment'
import { removeFolder } from './helpers/temporaryFolders'

const ROOT = process.cwd()
const AGENT = path.join(ROOT, 'dist', 'acp.js')
// This suite's own folder and home, made in `beforeAll`: nothing is made where the suite is skipped.
const scratch = { folder: '', home: '' }
// A case starts the production agent and a child and waits for both to exit.
const CASE_MS = 30_000
// The agent and its child end far under the SDK's 30 s drain window, which
// belongs to a host that answered and has sessions to drain.
const PROMPT_MS = 10_000
const WAIT_MS = 15_000

/** The never-answering "Muse Code": the pid files name it and the child sharing its group. */
const SERVE = (isDeaf: boolean): string =>
  [
    "const { writeFileSync } = require('node:fs')",
    "const { spawn } = require('node:child_process')",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30)'], { stdio: 'ignore' })",
    "writeFileSync('child.pid', String(child.pid))",
    "writeFileSync('cli.pid', String(process.pid))",
    ...(isDeaf ? ["process.on('SIGTERM', () => {})"] : []),
    'setInterval(() => {}, 1 << 30)',
  ].join('\n')

interface Left {
  readonly agent: ChildProcessWithoutNullStreams
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  readonly workspace: string
  /** The agent's log so far: it names a case's failure. */
  readonly log: () => string
}

const STARTED = new Set<ChildProcessWithoutNullStreams>()
const PID_FILES = new Set<string>()

function pidOf(file: string): number | undefined {
  return existsSync(file) ? Number(readFileSync(file, 'utf8')) : undefined
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

async function waitFor(isDone: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_MS
  while (!isDone()) {
    if (Date.now() > deadline) throw new Error('the condition never held')
    await delay(25)
  }
}

/** The client leaves; the agent ends cleanly, with its log naming a failure. Returns how long it took. */
async function leaveAndEnd(served: Left, leave: (served: Left) => void): Promise<number> {
  const left = Date.now()
  leave(served)
  expect(await served.exited, served.log()).toEqual({ code: 0, signal: null })
  return Date.now() - left
}

/**
The production agent signed in with the placeholder credential file, its
backend a never-answering process; `session/new` is sent and left pending.
*/
async function startedAgent(options: {
  readonly isDeaf?: boolean
  readonly withSession: boolean
}): Promise<Left> {
  const workspace = mkdtempSync(path.join(scratch.folder, 'workspace-'))
  await writeFile(path.join(workspace, 'serve.js'), SERVE(options.isDeaf === true))
  PID_FILES.add(path.join(workspace, 'cli.pid'))
  PID_FILES.add(path.join(workspace, 'child.pid'))
  const agent = spawn(process.execPath, [AGENT, '--muse-binary', process.execPath], {
    cwd: workspace,
    env: isolatedRuntimeEnvironment(scratch.home, scratch.folder),
    stdio: 'pipe',
  })
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
  // Holds the client's connection open until the agent leaves.
  const held = Promise.withResolvers<string>()
  const ready = Promise.withResolvers<boolean>()
  void (async () => {
    try {
      await client.connectWith(stream, async (ctx) => {
        await ctx.request('initialize', {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        })
        if (options.withSession) {
          // Sent and left pending: the agent's answer is the case's end, not its start.
          void ctx
            .request('session/new', { cwd: workspace, mcpServers: [] })
            .catch((error: unknown) => {
              held.resolve(error instanceof Error ? error.message : String(error))
            })
        }
        ready.resolve(true)
        await held.promise
      })
    } catch (error: unknown) {
      // The connection ending with the agent is the case's own doing; a
      // failure before the client was ready fails the case.
      ready.reject(error instanceof Error ? error : new Error(String(error)))
    }
  })()
  await ready.promise
  if (options.withSession) {
    try {
      await waitFor(() => existsSync(path.join(workspace, 'child.pid')))
    } catch (error: unknown) {
      throw new Error(`Muse Code never started; the agent's log: ${log}`, { cause: error })
    }
  }
  return { agent, exited, workspace, log: () => log }
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
    scratch.home = path.join(scratch.folder, 'home')
    // Owner-only, as a profile is.
    mkdirSync(path.join(scratch.home, 'config', 'muse'), { recursive: true, mode: 0o700 })
    // The recorded placeholder sign-in (test/fixtures/maccred/provenance.json):
    // read as `inline`, so the agent starts the backend instead of refusing.
    copyFileSync(
      path.join(ROOT, 'test', 'fixtures', 'maccred', 'v1-auth-set.json'),
      path.join(scratch.home, 'config', 'muse', 'auth.json'),
    )
  })

  afterEach(async () => {
    // A case that failed may leave processes: they are ended after it.
    for (const file of PID_FILES) {
      const pid = pidOf(file)
      if (pid !== undefined && isAlive(pid)) process.kill(pid, 'SIGKILL')
    }
    PID_FILES.clear()
    const left = [...STARTED]
    for (const agent of left) agent.kill('SIGKILL')
    await Promise.all(left.map((agent) => new Promise((resolve) => agent.once('close', resolve))))
  })

  afterAll(async () => {
    await removeFolder(scratch.folder)
  })

  describe('before any backend started', () => {
    it.each(LEAVES)(
      '$name ends it with its work done',
      async ({ leave }) => {
        const served = await startedAgent({ withSession: false })
        expect(await leaveAndEnd(served, leave)).toBeLessThan(PROMPT_MS)
        expect(existsSync(path.join(served.workspace, 'cli.pid'))).toBe(false)
      },
      CASE_MS,
    )
  })

  describe('while Muse Code is still starting', () => {
    it.each([...LEAVES, VANISHES])(
      '$name ends the agent and the process it started, with its whole group',
      async ({ leave }) => {
        const served = await startedAgent({ withSession: true })
        const cli = pidOf(path.join(served.workspace, 'cli.pid'))
        const child = pidOf(path.join(served.workspace, 'child.pid'))
        expect(cli).toBeDefined()
        expect(child).toBeDefined()
        // The CLI leads its own group (the SDK made it one), the agent's apart.
        expect(isAlive(cli ?? 0, true)).toBe(true)
        expect(await leaveAndEnd(served, leave)).toBeLessThan(PROMPT_MS)
        await waitFor(() => !isAlive(cli ?? 0, true))
        expect(isAlive(cli ?? 0)).toBe(false)
        expect(isAlive(child ?? 0)).toBe(false)
      },
      CASE_MS,
    )

    it(
      'ends a Muse Code that ignores SIGTERM after the grace, with SIGKILL',
      async () => {
        const served = await startedAgent({ withSession: true, isDeaf: true })
        const cli = pidOf(path.join(served.workspace, 'cli.pid'))
        const took = await leaveAndEnd(served, (agent) => {
          agent.agent.kill('SIGTERM')
        })
        // Not at once: SIGTERM got its whole grace; and not the SDK's drain.
        expect(took).toBeGreaterThanOrEqual(RESOURCE_MUSE_TERMINATE_GRACE_MS - 100)
        expect(took).toBeLessThan(PROMPT_MS)
        await waitFor(() => !isAlive(cli ?? 0, true))
        expect(isAlive(cli ?? 0)).toBe(false)
      },
      CASE_MS,
    )

    it(
      'never touches a Muse Code another agent started, nor a process it did not start',
      async () => {
        const other = await startedAgent({ withSession: true })
        const mine = await startedAgent({ withSession: true })
        const bystander = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30)'], {
          stdio: 'ignore',
          detached: true,
        })
        const otherCli = pidOf(path.join(other.workspace, 'cli.pid'))
        try {
          await leaveAndEnd(mine, (agent) => {
            agent.agent.kill('SIGTERM')
          })
          await waitFor(() => !isAlive(pidOf(path.join(mine.workspace, 'cli.pid')) ?? 0))
          expect(isAlive(otherCli ?? 0)).toBe(true)
          expect(other.agent.exitCode).toBeNull()
          expect(isAlive(bystander.pid ?? 0)).toBe(true)
        } finally {
          bystander.kill('SIGKILL')
        }
        // The other agent still ends its own, when its client leaves.
        other.agent.stdin.end()
        expect(await other.exited, other.log()).toEqual({ code: 0, signal: null })
        await waitFor(() => !isAlive(otherCli ?? 0))
      },
      CASE_MS,
    )
  })
})
