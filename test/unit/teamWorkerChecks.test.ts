// A team worker's `run_checks` (RLF-TEAMWORKERS3, M96c check slots): the
// worker's side is the MCP protocol a Muse Code session speaks to a session
// server (JSON-RPC over HTTP with the task's token), and everything behind it
// is real: the worker check route and its loopback server, `bridgeRunChecks`
// and `routeWorkerCheck`, the runners runtime's governed `CheckSlots`, the
// window's real governor host reading this machine's sampler under a limit
// the person set (`resourceMemoryMaxPercent` of 0 holds it at throttle),
// real git repositories and clones, and a real process per check. The test
// process runner reads a clean exit as the container's proof (this rig has no
// OS container for a bare process group); the product's own runner is
// `checkProcessOver`.
import { realpath, mkdtemp, readFile, rm, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runnerEnvironment } from '../../src/core/runners/runnerConfig'
import type { WorkerRolePolicy } from '../../src/core/team/workers/workerTypes'
import { createTeamRunnersRuntime } from '../../src/host/runners/teamRunnersEntry'
import type { CheckSlots } from '../../src/host/team/checkSlots'
import {
  createWorkerChecks,
  type WorkerCheckEndpoint,
  type WorkerCheckTask,
} from '../../src/host/team/workerChecks'
import {
  MODEL_API_MODEL_TEXT,
  TEAM_CHECKS_SERVER,
  TEAM_MODEL_TEXT,
  type CheckCommandSetting,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { fill, setUiText } from '../../src/shared/l10n/text'
import { checkProcessProvedByExit } from './helpers/checkProcessProvedByExit'
import { fixtureGitEnvironment } from './helpers/fixtureGit'
import { governorWindow } from './helpers/governorWindow'
import { silentCoreLog } from './helpers/memoryLogs'
import { resolveGitBinary } from './helpers/realGit'
import { realTeamGit } from './helpers/realTeamGit'
import { initRigFolders } from './helpers/teamRealRig'
import { fixtureGit } from './helpers/teamLandingFixture'

setUiText(EN, 'en')

// Real clones, a real governor window and processes that pause on purpose.
const LONG_MS = 60_000
/** How long a check pauses between its start and its end. */
const PAUSE_MS = 800
/** How long "not started" is watched: well past a check's own start-up. */
const WATCH_MS = 1500

/** The check script: it logs its start, pauses, logs its end and prints what it was given. */
const CHECK_SCRIPT = String.raw`const fs = require('node:fs')
const [log, name, pause, ...rest] = process.argv.slice(2)
fs.appendFileSync(log, 'start ' + name + '\n')
setTimeout(() => {
  fs.appendFileSync(log, 'end ' + name + '\n')
  console.log('ran ' + name + ' on ' + rest.join(' '))
}, Number(pause))
`

const ENGINEERING: WorkerRolePolicy = {
  roleId: 'engineering',
  workspaceMode: 'own-branch',
  toolGroups: ['read', 'write', 'checks', 'report'],
  reportShape: 'summary',
}
const READER: WorkerRolePolicy = {
  roleId: 'research',
  workspaceMode: 'read-only',
  toolGroups: ['read', 'report'],
  reportShape: 'summary',
}

interface Reply {
  readonly status: number
  readonly body?: {
    result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[] }
  }
}

/** The worker's side: one JSON-RPC request to its session server. */
async function rpc(
  endpoint: WorkerCheckEndpoint,
  method: string,
  params: unknown = {},
  signal?: AbortSignal,
): Promise<Reply> {
  const server = endpoint.servers[TEAM_CHECKS_SERVER]
  if (server === undefined || !('url' in server)) throw new Error('the endpoint has no server')
  const response = await fetch(server.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...server.headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    ...(signal !== undefined && { signal }),
  })
  const text = await response.text()
  return {
    status: response.status,
    ...(text !== '' && { body: JSON.parse(text) as NonNullable<Reply['body']> }),
  }
}

/** The log's lines: each check's start and end, in the order they happened. */
async function lines(log: string): Promise<string[]> {
  const text = await readFile(log, 'utf8')
  return text.split('\n').filter((line) => line !== '')
}

/** The person's check: the script, logging as `name`, over the files a task changed. */
function check(log: string, name: string, pauseMs = PAUSE_MS): CheckCommandSetting {
  return {
    name,
    command: `'${process.execPath}' check.js '${log}' ${name} ${String(pauseMs)}`,
    changedFiles: true,
  }
}

const call = async (endpoint: WorkerCheckEndpoint, args: unknown = {}, signal?: AbortSignal) =>
  await rpc(endpoint, 'tools/call', { name: 'run_checks', arguments: args }, signal)

const text = (reply: Reply) => reply.body?.result?.content?.[0]?.text ?? ''

describe.skipIf(process.platform === 'win32')('a team worker’s run_checks', () => {
  let root: string
  let repo: string
  let git: string
  let counter = 0
  const folders: string[] = []
  const disposers: (() => void)[] = []

  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'worker-checks-')))
    const rig = await initRigFolders(root)
    repo = rig.repo
    git = await resolveGitBinary()
    await writeFile(path.join(repo, 'check.js'), CHECK_SCRIPT)
    await fixtureGit(repo, ['add', 'check.js'])
    await fixtureGit(repo, ['commit', '-m', 'the check script'])
  })
  afterAll(async () => {
    for (const dispose of disposers.splice(0)) dispose()
    await rm(root, { recursive: true, force: true })
  })

  /** A task's working copy: the checks run against a snapshot of it, never in the person's repository. */
  async function taskCopy(name: string): Promise<string> {
    const copy = path.join(root, `copy-${name}`)
    await fixtureGit(root, ['clone', repo, copy])
    folders.push(copy)
    return copy
  }

  async function logOf(name: string): Promise<string> {
    const log = path.join(root, `${name}.log`)
    await appendFile(log, '')
    return log
  }

  /**
  The window's own governor, as the person's settings leave it, and the route
  over the slots the runners runtime builds from it. `limited` holds the
  machine at throttle with a memory limit of 0%.
  */
  async function route(options: {
    readonly isLimited: boolean
    readonly checks: () => readonly CheckCommandSetting[]
  }) {
    const { window, errors, dispose } = await governorWindow({ isLimited: options.isLimited })
    disposers.push(dispose)
    counter += 1
    const slots: CheckSlots = await createTeamRunnersRuntime(EN, 'en').createGovernedCheckSlots({
      file: git,
      run: checkProcessProvedByExit(),
      env: fixtureGitEnvironment(runnerEnvironment(process.env)),
      root: path.join(root, `slots-${String(counter)}`),
      repositoryRoot: repo,
      platform: process.platform,
      count: 2,
      setupCommand: '',
      cacheKey: 'worker-checks',
      installPaths: [],
      shell: '/bin/sh',
      shellArgs: (command) => ['-c', command],
      isTrusted: () => true,
      isHostBusy: () => false,
    })
    const workerChecks = createWorkerChecks({
      platform: process.platform,
      isTrusted: () => true,
      checks: options.checks,
      localSlot: (job) => slots.run(job),
      runGit: realTeamGit,
      log: silentCoreLog(),
    })
    disposers.push(() => {
      void workerChecks.close()
    })
    return { workerChecks, errors, level: () => window.port.status().level }
  }

  async function serve(
    workerChecks: ReturnType<typeof createWorkerChecks>,
    copy: string,
    isCurrent: () => boolean = () => true,
  ): Promise<WorkerCheckEndpoint> {
    const task: WorkerCheckTask = { folder: copy, workspaceRoot: repo, role: ENGINEERING }
    const endpoint = await workerChecks.serve(task, isCurrent)
    if (endpoint === undefined) throw new Error('the task got no check endpoint')
    return endpoint
  }

  it(
    'waits for the governed check slot, runs against its task’s changed files, and gives the slot back',
    async () => {
      const log = await logOf('governed')
      const rig = await route({
        isLimited: true,
        checks: () => [check(log, 'one'), check(log, 'two')],
      })
      expect(rig.level()).toBe('throttle')
      const copyA = await taskCopy('a')
      const copyB = await taskCopy('b')
      await writeFile(path.join(copyA, 'edited-in-a.txt'), 'a\n')
      await writeFile(path.join(copyB, 'edited-in-b.txt'), 'b\n')
      const a = await serve(rig.workerChecks, copyA)
      const b = await serve(rig.workerChecks, copyB)

      // The worker lists the person's checks as a tool.
      const listed = await rpc(a, 'tools/list')
      expect(listed.body?.result?.tools?.map((tool) => tool.name)).toEqual(['run_checks'])

      // Two workers each ask for one check at once; the machine allows one at a time.
      const [first, second] = await Promise.all([
        call(a, { names: ['one'] }),
        call(b, { names: ['two'] }),
      ])
      const order = await lines(log)
      expect(order).toHaveLength(4)
      expect(order[0]?.startsWith('start')).toBe(true)
      expect(order[1]?.startsWith('end')).toBe(true)
      expect(order[0]?.slice('start '.length)).toBe(order[1]?.slice('end '.length))
      expect(order[2]?.startsWith('start')).toBe(true)
      expect(order[3]?.startsWith('end')).toBe(true)
      // Each check ran on the files its own task changed, and said how it ended.
      expect(text(first)).toContain('one: exit code 0')
      expect(text(first)).toContain('edited-in-a.txt')
      expect(text(first)).not.toContain('edited-in-b.txt')
      expect(text(second)).toContain('edited-in-b.txt')
      expect(first.body?.result?.isError).not.toBe(true)
      expect(second.body?.result?.isError).not.toBe(true)

      // The slot was given back: a later check still runs.
      const third = await call(a, { names: ['one'] })
      expect(text(third)).toContain('exit code 0')
      expect(rig.errors).toEqual([])
    },
    LONG_MS,
  )

  it(
    'lets the same two checks overlap when the person set no limit',
    async () => {
      const log = await logOf('open')
      const rig = await route({
        isLimited: false,
        checks: () => [check(log, 'one'), check(log, 'two')],
      })
      const a = await serve(rig.workerChecks, await taskCopy('open-a'))
      const b = await serve(rig.workerChecks, await taskCopy('open-b'))
      await Promise.all([call(a, { names: ['one'] }), call(b, { names: ['two'] })])
      const order = await lines(log)
      expect(order.findLastIndex((line) => line.startsWith('start'))).toBeLessThan(
        order.findIndex((line) => line.startsWith('end')),
      )
    },
    LONG_MS,
  )

  it(
    'never starts a check whose caller stopped waiting for the slot',
    async () => {
      const log = await logOf('stopped')
      const rig = await route({
        isLimited: true,
        checks: () => [check(log, 'long', 2 * PAUSE_MS), check(log, 'never')],
      })
      const a = await serve(rig.workerChecks, await taskCopy('stop-a'))
      const b = await serve(rig.workerChecks, await taskCopy('stop-b'))
      const holding = call(a, { names: ['long'] })
      await expect
        .poll(
          async () => {
            const logged = await lines(log)
            return logged.length
          },
          { timeout: 15_000 },
        )
        .toBe(1)
      const stop = new AbortController()
      const waiting = call(b, { names: ['never'] }, stop.signal)
      await new Promise((resolve) => setTimeout(resolve, WATCH_MS / 3))
      stop.abort()
      await expect(waiting).rejects.toThrow()
      await holding
      await new Promise((resolve) => setTimeout(resolve, WATCH_MS))
      expect(await lines(log)).toEqual(['start long', 'end long'])
    },
    LONG_MS,
  )

  it(
    'serves only the task it was made for, only while the task runs, and only a role that has the checks',
    async () => {
      const log = await logOf('refused')
      const rig = await route({ isLimited: false, checks: () => [check(log, 'one')] })
      const copy = await taskCopy('refused')
      let isCurrent = true
      const endpoint = await serve(rig.workerChecks, copy, () => isCurrent)

      // No token, or another one, is refused before any check could start.
      const server = endpoint.servers[TEAM_CHECKS_SERVER]
      if (server === undefined || !('url' in server)) throw new Error('no endpoint')
      const anonymous = await fetch(server.url, { method: 'POST', body: '{}' })
      expect(anonymous.status).toBe(401)
      const forged = await fetch(server.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${'0'.repeat(64)}` },
        body: '{}',
      })
      expect(forged.status).toBe(401)

      // A task whose attempt is over is answered with a refusal, and runs nothing.
      isCurrent = false
      const ended = await call(endpoint, { names: ['one'] })
      expect(ended.body?.result?.isError).toBe(true)
      expect(ended.body?.result?.content?.[0]?.text).toContain(
        MODEL_API_MODEL_TEXT.agentToolNotOffered,
      )
      expect(await lines(log)).toEqual([])

      // Once its endpoint is closed the token is no longer known.
      endpoint.close()
      const closed = await rpc(endpoint, 'tools/list')
      expect(closed.status).toBe(401)

      // A role without the checks group, and a person with no check, get no endpoint at all.
      expect(
        await rig.workerChecks.serve(
          { folder: copy, workspaceRoot: repo, role: READER },
          () => true,
        ),
      ).toBeUndefined()
      const none = await route({ isLimited: false, checks: () => [] })
      expect(
        await none.workerChecks.serve(
          { folder: copy, workspaceRoot: repo, role: ENGINEERING },
          () => true,
        ),
      ).toBeUndefined()
    },
    LONG_MS,
  )

  it(
    'refuses a check that moves a git ref, as a worker never does, and runs nothing',
    async () => {
      const log = await logOf('ref')
      const moving: CheckCommandSetting = {
        name: 'publish',
        command: `'${process.execPath}' check.js '${log}' publish 0 && git push origin HEAD`,
      }
      const rig = await route({ isLimited: false, checks: () => [moving] })
      const endpoint = await serve(rig.workerChecks, await taskCopy('ref'))
      const reply = await call(endpoint, { names: ['publish'] })
      expect(reply.body?.result?.isError).toBe(true)
      expect(text(reply)).toBe(TEAM_MODEL_TEXT.hostCheckMovesRef)
      expect(await lines(log)).toEqual([])
    },
    LONG_MS,
  )

  it(
    'refuses a file the task’s copy does not hold, naming it',
    async () => {
      const log = await logOf('missing')
      const rig = await route({ isLimited: false, checks: () => [check(log, 'one')] })
      const endpoint = await serve(rig.workerChecks, await taskCopy('missing'))
      const reply = await call(endpoint, { names: ['one'], paths: ['../outside.txt'] })
      expect(reply.body?.result?.isError).toBe(true)
      expect(reply.body?.result?.content?.[0]?.text).toBe(
        fill(MODEL_API_MODEL_TEXT.runChecksMissingPath, { path: '../outside.txt' }),
      )
      expect(await lines(log)).toEqual([])
    },
    LONG_MS,
  )
})
