// A worker's checks and what proves a command ended (CC-CHECKPROOF). Over real processes: the real
// lifetime, journal and container on this system, a real governor window, real git, and a worker's
// `run_checks` over its real MCP route. A folder whose processes are not proved ended is never
// reused. Where a container proves the end (a Windows job, a Linux scope) the shared slots stay;
// where nothing can (macOS, Linux with no user systemd) a check takes a folder of its own.
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { availableParallelism, tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { WorkerRolePolicy } from '../../src/core/team/workers/workerTypes'
import { checkProcessOver } from '../../src/host/team/checkProcess'
import { CheckSlots } from '../../src/host/team/checkSlots'
import {
  isSeenScopeGone,
  scopeGroupOf,
  seenScopeEvents,
  startNativeTeamLifetime,
  type TeamProcessLifetime,
} from '../../src/host/team/processLifetime'
import { createTeamJournal } from '../../src/host/team/teamJournal'
import { createWindowAuthority, createWindowIdentity } from '../../src/host/team/windowIdentity'
import {
  HOOK_CONFIG_MAX_BYTES,
  UI_TEXT,
  type CheckCommandSetting,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { checkProcessProvedByExit } from './helpers/checkProcessProvedByExit'
import { fixtureGitEnvironment } from './helpers/fixtureGit'
import { governorWindow } from './helpers/governorWindow'
import { realCheckPorts, doesSystemProveEnds } from './helpers/teamCheckPorts'
import { fixtureGit } from './helpers/teamLandingFixture'
import { isProcessAlive } from './helpers/teamRealRig'
import { callRunChecks, replyText } from './helpers/workerCheckRpc'
import { liveSamplerSuite } from './resourceHarness'

setUiText(EN, 'en')
const { memoryReader } = liveSamplerSuite()

const LONG_MS = 120_000
const doesProve = await doesSystemProveEnds()
const isPosix = process.platform !== 'win32'

const ENGINEERING: WorkerRolePolicy = {
  roleId: 'engineering',
  workspaceMode: 'own-branch',
  toolGroups: ['read', 'write', 'checks', 'report'],
  reportShape: 'summary',
}

/**
A command that starts one child and ends, leaving the child behind. `member` stays in its process
group, `stubborn` also ignores SIGTERM, `stranger` stays in it without the launch's marker, and
`escapee` leaves it with setsid.
*/
const LEAVES_A_CHILD = `const { spawn } = require('node:child_process')
const fs = require('node:fs')
const [mode, pidFile] = process.argv.slice(2)
const options = { stdio: 'ignore' }
if (mode === 'escapee' || mode === 'stubborn-escapee') options.detached = true
if (mode === 'stranger') options.env = { PATH: process.env.PATH }
const isStubborn = mode === 'stubborn' || mode === 'stubborn-escapee'
const body = (isStubborn ? "process.on('SIGTERM', () => undefined);" : '') + 'setInterval(() => undefined, 1000)'
const child = spawn(process.execPath, ['-e', body], options)
child.unref()
fs.writeFileSync(pidFile, String(child.pid))
setTimeout(() => process.exit(0), 300)
`
/** A person's check: logs the folder it ran in, and exits with the code it is told to. */
const CHECK = String.raw`const fs = require('node:fs')
const path = require('node:path')
const [code] = process.argv.slice(2)
fs.appendFileSync(path.join(__dirname, 'ran.log'), process.cwd() + '\n')
process.exit(Number(code))
`
const SETUP = String.raw`const fs = require('node:fs')
const path = require('node:path')
fs.appendFileSync(path.join(__dirname, 'setup.log'), 'setup\n')
`

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup()
}, LONG_MS)

async function scratch(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), prefix)))
  cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }))
  return root
}

async function realLifetime(root: string): Promise<TeamProcessLifetime> {
  const owner = createWindowIdentity(Date.now())
  const started = await startNativeTeamLifetime({
    journal: createTeamJournal({
      storageDirectory: path.join(root, 'storage'),
      authority: createWindowAuthority(owner, () => Promise.resolve()),
      owner,
      maxRecordBytes: HOOK_CONFIG_MAX_BYTES,
      platform: process.platform,
    }),
    isHostBusy: () => false,
    killGraceMs: 1000,
  })
  cleanups.push(async () => {
    await started.lifetime.dispose()
  })
  return started.lifetime
}

/** Ends a child this suite left, by a pid it read: never 0, which is this process's own group. */
function endIfAlive(pid: number): void {
  if (pid > 1 && isProcessAlive(pid)) process.kill(pid, 'SIGKILL')
}

async function untilGone(pid: number): Promise<void> {
  await expect.poll(() => isProcessAlive(pid), { timeout: 10_000 }).toBe(false)
}

/** The command that leaves a child behind, run to its end; returns the runner's answer and the child. */
async function leaveAChild(lifetime: TeamProcessLifetime, root: string, mode: string) {
  const script = path.join(root, 'leaves-a-child.js')
  const pidFile = path.join(root, `${mode}.pid`)
  await writeFile(script, LEAVES_A_CHILD)
  const result = await checkProcessOver(lifetime)({
    file: process.execPath,
    args: [script, mode, pidFile],
    cwd: root,
    env: process.env,
    timeoutMs: 30_000,
  })
  const pid = Number(await readFile(pidFile, 'utf8'))
  cleanups.push(() => {
    endIfAlive(pid)
  })
  return { result, pid }
}

describe('reading a scope that is gone', () => {
  const GROUP = '/user.slice/app.slice/muse-spark-a.scope'

  it('counts a scope as seen only when the child is in it', () => {
    expect(seenScopeEvents(GROUP, `0::${GROUP}\n`, '/cgroup')).toBe(`/cgroup${GROUP}/cgroup.events`)
    expect(seenScopeEvents(GROUP, '0::/user.slice/other.scope\n', '/cgroup')).toBeUndefined()
    expect(seenScopeEvents(GROUP, '', '/cgroup')).toBeUndefined()
  })

  it('reads gone only from the folder gone, under a hierarchy that is there', async () => {
    const root = await scratch('muse-proof-cgroup-')
    const events = `${root}${GROUP}/cgroup.events`
    // No hierarchy mounted: nothing can be said, though the folder is missing.
    expect(await isSeenScopeGone(events, root)).toBe(false)
    await writeFile(path.join(root, 'cgroup.controllers'), 'cpu memory\n')
    expect(await isSeenScopeGone(events, root)).toBe(true)
    // A missing cgroup.events alone says nothing: the folder is still there.
    await mkdir(path.dirname(events), { recursive: true })
    expect(await isSeenScopeGone(events, root)).toBe(false)
  })
})

describe.runIf(isPosix)('a retirement', () => {
  it(
    "reaches a command that exec'd after its identity was recorded",
    async () => {
      const root = await scratch('muse-proof-exec-')
      const lifetime = await realLifetime(root)
      const contained = await lifetime.launch({
        command: '/bin/sh',
        args: [
          '-c',
          `sleep 0.3; exec '${process.execPath}' -e 'setInterval(() => undefined, 1000)'`,
        ],
        cwd: root,
        taskId: 'exec',
        env: { PATH: process.env['PATH'] },
        priority: 'normal',
      })
      const { pid } = await contained.confirmation
      await new Promise((resolve) => setTimeout(resolve, 1000))
      expect(isProcessAlive(pid)).toBe(true)
      await contained.retire()
      await untilGone(pid)
    },
    LONG_MS,
  )
})

describe('which scope a process is in', () => {
  const UNIT = 'muse-spark-one.scope'
  const GROUP = `/user.slice/user-1000.slice/user@1000.service/app.slice/${UNIT}`

  it('is what the kernel says, once it says this unit', () => {
    expect(scopeGroupOf(UNIT, `0::${GROUP}\n`)).toBe(GROUP)
    // Still where it started: systemd has not moved it yet.
    expect(scopeGroupOf(UNIT, '0::/user.slice/user-1000.slice/session-1.scope\n')).toBeUndefined()
    // Another launch's, whose name ends the same way.
    expect(scopeGroupOf(UNIT, `0::/a/not-${UNIT}\n`)).toBeUndefined()
    expect(scopeGroupOf(UNIT, `0::/../${UNIT}\n`)).toBeUndefined()
    expect(scopeGroupOf(UNIT, '')).toBeUndefined()
    // A hybrid hierarchy names it on its own line, which proves no empty cgroup.
    const hybrid = `1:name=systemd:${GROUP}\n0::/\n`
    expect(scopeGroupOf(UNIT, hybrid)).toBe(GROUP)
    expect(seenScopeEvents(GROUP, hybrid)).toBeUndefined()
  })
})

describe.runIf(process.platform === 'linux' && doesProve)('a real Linux scope', () => {
  it(
    'confirms every launch a team can reach at once',
    async () => {
      const root = await scratch('muse-proof-many-')
      const lifetime = await realLifetime(root)
      // A team runs a worker and a check per logical CPU, at the most.
      const atOnce = 2 * availableParallelism()
      const launches = await Promise.allSettled(
        Array.from({ length: atOnce }, async () => {
          const launched = await lifetime.launch({
            command: process.execPath,
            args: ['-e', 'setInterval(() => undefined, 1000)'],
            cwd: root,
            taskId: 'many',
            env: { PATH: process.env['PATH'] },
            priority: 'normal',
          })
          return await launched.retire()
        }),
      )
      expect(launches.filter((launch) => launch.status === 'rejected')).toEqual([])
    },
    LONG_MS,
  )

  it(
    'proves a command that ended by itself, however long it ran',
    async () => {
      const root = await scratch('muse-proof-scope-')
      const run = checkProcessOver(await realLifetime(root))
      const commands = [
        ['git', ['--version']],
        ['sh', ['-c', 'true']],
        ['sh', ['-c', 'sleep 0.05']],
        ['sh', ['-c', 'sleep 0.3']],
        ['sh', ['-c', 'sleep 1; echo done']],
      ] as const
      for (const [file, args] of commands)
        for (let at = 0; at < 5; at += 1)
          expect(
            await run({ file, args, cwd: root, env: process.env, timeoutMs: 30_000 }),
          ).toMatchObject({ exitCode: 0, descendantsEnded: true })
    },
    LONG_MS,
  )

  it(
    'keeps the proof false while a setsid escapee is in the scope, until it ends',
    async () => {
      const root = await scratch('muse-proof-escapee-')
      const lifetime = await realLifetime(root)
      // Read from the first byte: the leader ends at once.
      const said: string[] = []
      const contained = await lifetime.launch({
        command: '/bin/sh',
        args: ['-c', 'setsid sleep 300 > /dev/null 2>&1 & echo $!'],
        cwd: root,
        taskId: 'escapee',
        env: { PATH: process.env['PATH'] },
        priority: 'normal',
        attach: (child) => {
          child.stdout.on('data', (chunk: Buffer) => {
            said.push(chunk.toString('utf8'))
          })
        },
      })
      const ended = await contained.ended
      await expect.poll(() => said.join('')).toMatch(/^\d+\n$/u)
      const pid = Number(said.join('').trim())
      expect(pid).toBeGreaterThan(1)
      cleanups.push(() => {
        endIfAlive(pid)
      })
      // The leader has ended, the escapee has not, and it is in another session.
      expect(ended).toMatchObject({ childExited: true, descendants: 'uncertain' })
      expect(isProcessAlive(pid)).toBe(true)
      const session = execFileSync('ps', ['-o', 'sid=', '-p', String(pid)], { encoding: 'utf8' })
      expect(Number(session)).toBe(pid)
      // So the kernel still holds the scope, and says it is populated.
      const confirmation = await contained.confirmation
      const group = /^0::(.+)$/mu.exec(confirmation.cgroup ?? '')?.[1]
      await new Promise((resolve) => setTimeout(resolve, 1000))
      expect(await readFile(`/sys/fs/cgroup${String(group)}/cgroup.events`, 'utf8')).toMatch(
        /^populated 1$/mu,
      )
      // It ends: only now is the proof true.
      endIfAlive(pid)
      await untilGone(pid)
      expect(await contained.retire()).toEqual({ childExited: true, descendants: 'proved' })
    },
    LONG_MS,
  )

  it(
    'ends what is in the scope at retirement, and proves it only after',
    async () => {
      const root = await scratch('muse-proof-retire-')
      const { result, pid } = await leaveAChild(await realLifetime(root), root, 'stubborn-escapee')
      expect(isProcessAlive(pid)).toBe(false)
      expect(result).toMatchObject({ exitCode: 0, descendantsEnded: true })
    },
    LONG_MS,
  )
})

// macOS's path, and a Linux with no user systemd: hosted CI's macOS and Linux runners both come here.
describe.runIf(isPosix && !doesProve)('a bare process group', () => {
  it(
    'proves nothing, and says when no one is left in it',
    async () => {
      const root = await scratch('muse-proof-group-')
      const run = checkProcessOver(await realLifetime(root))
      for (let at = 0; at < 5; at += 1)
        expect(
          await run({
            file: 'git',
            args: ['--version'],
            cwd: root,
            env: process.env,
            timeoutMs: 30_000,
          }),
        ).toMatchObject({ exitCode: 0, descendantsEnded: false, groupEnded: true })
    },
    LONG_MS,
  )

  it.each(['member', 'stubborn'])(
    'signals a %s left in the group, and says gone only once it is',
    async (mode) => {
      const root = await scratch('muse-proof-member-')
      const { result, pid } = await leaveAChild(await realLifetime(root), root, mode)
      expect(isProcessAlive(pid)).toBe(false)
      expect(result).toMatchObject({ exitCode: 0, descendantsEnded: false, groupEnded: true })
    },
    LONG_MS,
  )

  it(
    'signals no stranger in the group, and does not say gone',
    async () => {
      const root = await scratch('muse-proof-stranger-')
      const { result, pid } = await leaveAChild(await realLifetime(root), root, 'stranger')
      expect(isProcessAlive(pid)).toBe(true)
      expect(result).toMatchObject({ exitCode: 0, descendantsEnded: false, groupEnded: false })
    },
    LONG_MS,
  )

  it(
    'cannot see a setsid escapee: the named limit',
    async () => {
      const root = await scratch('muse-proof-limit-')
      const { result, pid } = await leaveAChild(await realLifetime(root), root, 'escapee')
      expect(isProcessAlive(pid)).toBe(true)
      expect(result).toMatchObject({ exitCode: 0, descendantsEnded: false, groupEnded: true })
    },
    LONG_MS,
  )
})

/** A worker's `run_checks` over its real route: its ports, its session server, its check slots. */
async function workerRoute(input: {
  readonly isLimited: boolean
  readonly checks: (root: string) => readonly CheckCommandSetting[]
  readonly setupCommand?: (root: string) => string
}) {
  const root = await scratch('muse-proof-route-')
  const governor = await governorWindow({ isLimited: input.isLimited, memoryReader })
  cleanups.push(() => {
    governor.dispose()
  })
  await writeFile(path.join(root, 'check.js'), CHECK)
  await writeFile(path.join(root, 'setup.js'), SETUP)
  await writeFile(path.join(root, 'leaves-a-child.js'), LEAVES_A_CHILD)
  const repo = path.join(root, 'repo')
  await mkdir(repo)
  await fixtureGit(repo, ['init', '-b', 'main'])
  await writeFile(path.join(repo, 'file.txt'), 'file\n')
  await fixtureGit(repo, ['add', '-A'])
  await fixtureGit(repo, ['commit', '-m', 'base'])
  const copy = path.join(root, 'copy')
  await fixtureGit(root, ['clone', repo, copy])
  const checks = input.checks(root)
  const ports = realCheckPorts({
    root,
    repo,
    checks: () => checks,
    ...(input.setupCommand !== undefined && { setupCommand: input.setupCommand(root) }),
  })
  cleanups.push(() => ports.dispose())
  const endpoint = await ports.serveWorkerChecks(
    { folder: copy, workspaceRoot: repo, role: ENGINEERING },
    () => true,
  )
  if (endpoint === undefined) throw new Error('the task got no check endpoint')
  return { root, endpoint, foldersIn: () => readdir(path.join(root, 'ports')) }
}

const aCheck = (root: string, name: string, code: number): CheckCommandSetting => ({
  name,
  command: `node '${path.join(root, 'check.js')}' ${String(code)}`,
})
const leaving = (root: string, mode: string): CheckCommandSetting => ({
  name: 'leaves',
  command: `node '${path.join(root, 'leaves-a-child.js')}' ${mode} '${path.join(root, `${mode}.pid`)}'`,
})

async function logLines(file: string): Promise<readonly string[]> {
  const text = await readFile(file, 'utf8')
  return text.split(/\r?\n/u).filter((line) => line !== '')
}

// No skip on any system: this is the fault itself.
describe("a worker's run_checks", () => {
  it(
    'answers a check that passes and one that fails, and never the sentence',
    async () => {
      const { endpoint } = await workerRoute({
        isLimited: false,
        checks: (root) => [aCheck(root, 'passes', 0), aCheck(root, 'fails', 3)],
      })
      const passed = await callRunChecks(endpoint, { names: ['passes'] })
      expect(passed.body?.result?.isError).not.toBe(true)
      expect(replyText(passed)).toContain('passes: exit code 0')
      const failed = await callRunChecks(endpoint, { names: ['fails'] })
      expect(replyText(failed)).toMatch(/fails: exit code [1-9]/u)
      for (const reply of [passed, failed])
        expect(replyText(reply)).not.toContain(UI_TEXT.teamTrafficNotices.uncertainAttempt)
    },
    LONG_MS,
  )

  it(
    'reuses a folder only where its end is proved, and runs setup every time where it is not',
    async () => {
      const { root, endpoint, foldersIn } = await workerRoute({
        isLimited: false,
        checks: (at) => [aCheck(at, 'passes', 0)],
        setupCommand: (at) => `node '${path.join(at, 'setup.js')}'`,
      })
      await callRunChecks(endpoint, { names: ['passes'] })
      await callRunChecks(endpoint, { names: ['passes'] })
      const folders = await logLines(path.join(root, 'ran.log'))
      expect(folders).toHaveLength(2)
      expect(new Set(folders).size).toBe(doesProve ? 1 : 2)
      expect(await logLines(path.join(root, 'setup.log'))).toHaveLength(doesProve ? 1 : 2)
      const made = await foldersIn()
      expect(made.includes('check-slots')).toBe(doesProve)
      // A folder used once does not stay.
      if (!doesProve) expect(await readdir(path.join(root, 'ports', 'one-use-checks'))).toEqual([])
    },
    LONG_MS,
  )

  it(
    'ends what a check left behind before the permit goes back, so the next check runs',
    async () => {
      const { root, endpoint } = await workerRoute({
        // One check at a time: a permit that did not go back would hold the next one for good.
        isLimited: true,
        checks: (at) => [leaving(at, 'member'), aCheck(at, 'next', 0)],
      })
      const left = await callRunChecks(endpoint, { names: ['leaves'] })
      expect(replyText(left)).toContain('leaves: exit code 0')
      const pid = Number(await readFile(path.join(root, 'member.pid'), 'utf8'))
      expect(isProcessAlive(pid)).toBe(false)
      const next = await callRunChecks(endpoint, { names: ['next'] })
      expect(replyText(next)).toContain('next: exit code 0')
    },
    LONG_MS,
  )

  it.runIf(isPosix && !doesProve)(
    'says the sentence when something really has not stopped, and it has not',
    async () => {
      const { root, endpoint } = await workerRoute({
        isLimited: false,
        checks: (at) => [leaving(at, 'stranger')],
      })
      const reply = await callRunChecks(endpoint, { names: ['leaves'] })
      const pid = Number(await readFile(path.join(root, 'stranger.pid'), 'utf8'))
      cleanups.push(() => {
        endIfAlive(pid)
      })
      expect(replyText(reply)).toContain(UI_TEXT.teamTrafficNotices.uncertainAttempt)
      expect(isProcessAlive(pid)).toBe(true)
    },
    LONG_MS,
  )
})

describe("the slots' refusals", () => {
  it(
    'do not say an attempt has not stopped when a check is pointed at the repository itself',
    async () => {
      const root = await scratch('muse-proof-guard-')
      const repo = path.join(root, 'repo')
      await mkdir(repo)
      const slots = new CheckSlots({
        file: 'git',
        run: checkProcessProvedByExit(),
        env: fixtureGitEnvironment(process.env),
        root: path.join(root, 'slots'),
        repositoryRoot: repo,
        platform: process.platform,
        count: 1,
        setupCommand: '',
        cacheKey: 'guard',
        installPaths: [],
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
        shellArgs: (command) => [process.platform === 'win32' ? '/c' : '-c', command],
        isTrusted: () => true,
        isHostBusy: () => false,
      })
      const job = {
        runId: 'guard',
        cwd: repo,
        command: 'true',
        timeoutMs: 30_000,
        commandClass: 'declared' as const,
        labels: [],
        preferredRunners: [],
        lockfiles: [],
        signal: new AbortController().signal,
        onOutput: () => undefined,
      }
      await expect(slots.run(job)).rejects.toThrow(UI_TEXT.teamRunners.testFailed)
      expect(slots.states()[0]).toMatchObject({ busy: false, uncertain: false })
    },
    LONG_MS,
  )
})
