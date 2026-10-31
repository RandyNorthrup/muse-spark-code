// A team worker's Windows launch (M96 K, `windowsTeamDriver` in
// src/host/team/processLifetime.ts): the shipped job helper run as a program
// of its own (MuseSparkJobHost's `run-team`, which runs `MuseSparkJob.RunTeam`)
// where the launch used to start Windows PowerShell to load the same type. The
// helper is built through the product's own builder; every launch starts a
// real Node payload (or a real batch file through cmd.exe) and is read back
// from the operating system: the launch's named job, the processes' priority,
// whether they still run.
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os, { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { windowsJobHost } from '../../src/core/execGuard'
import { runTreeProgram } from '../../src/core/resources/trees/run'
import { runProgram } from '../../src/host/processTree'
import {
  createNativeTeamProcessDriver,
  windowsTeamPayloadEnvironment,
  type ContainedTeamChild,
  type TeamLaunchRequest,
  type TeamProcessDriver,
} from '../../src/host/team/processLifetime'
import { readJobSource } from './helpers/jobSource'
import { expectEnded, isRunning, markedPid } from './helpers/processes'
import { buildShellJobHelper } from './helpers/shellJobBuild'
import { removeFolder } from './helpers/temporaryFolders'

const BUILD_MS = 120_000
/** How long a held payload is watched for not having run. */
const HELD_WATCH_MS = 500
const SYSTEM_ROOT = process.env['SystemRoot'] ?? String.raw`C:\Windows`

/** What the payload reports about itself before anything else. */
const reportSchema = z.object({
  args: z.array(z.string()),
  cwd: z.string(),
  env: z.record(z.string(), z.string()),
})
const querySchema = z.object({ members: z.array(z.object({ pid: z.number() })) })

// The payload: writes its report first, then exits with a code, echoes its
// standard input, or starts a detached grandchild and stays.
const PAYLOAD = `const fs = require('node:fs')
const [mode, report, ...rest] = process.argv.slice(2)
fs.writeFileSync(report, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), env: process.env }))
if (mode === 'exit') process.exit(Number(rest[0]))
else if (mode === 'echo') process.stdin.pipe(process.stdout)
else if (mode === 'tree') {
  const grandchild = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore', windowsHide: true })
  grandchild.unref()
  fs.writeFileSync(report + '.grandchild', String(grandchild.pid))
  setInterval(() => {}, 1000)
}
`

// Arguments a shell or a script would read differently: each must reach the
// payload as exactly one argument, byte for byte.
const HOSTILE_ARGUMENTS = [
  'two  spaces',
  'say "hi"',
  String.raw`C:\dir with space\\`,
  '',
  '%PATH%',
  '^&|<>()',
  "it's $(Get-Date) `n",
  'naïve ✓ 日本語',
  String.raw`\"\\`,
]

/** The helper's process id: a launch whose helper never started has none. */
function helperPid(started: ContainedTeamChild): number {
  if (started.child.pid === undefined) throw new Error('the helper did not start')
  return started.child.pid
}

function report(file: string) {
  return reportSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
}

describe.runIf(process.platform === 'win32')('a team worker launch on Windows', () => {
  const state = { root: '', storage: '', workspace: '', payload: '', batch: '', assembly: '' }
  const launched: ContainedTeamChild[] = []
  let driver: TeamProcessDriver | undefined

  beforeAll(async () => {
    state.root = realpathSync(await mkdtemp(path.join(tmpdir(), 'muse-team-launch-')))
    state.workspace = path.join(state.root, 'workspace')
    await mkdir(state.workspace)
    await mkdir(path.join(state.root, 'bin'))
    state.payload = path.join(state.root, 'bin', 'payload.cjs')
    await writeFile(state.payload, PAYLOAD)
    state.batch = path.join(state.root, 'bin', 'exit with.cmd')
    // Each batch argument arrives quoted (`cmdQuoted`): `%~1` is the value.
    await writeFile(state.batch, '@exit /b %~1\r\n')
    const built = await buildShellJobHelper('muse-team-launch-job-', SYSTEM_ROOT)
    state.storage = built.storageDir
    state.assembly = built.assembly
    driver = await createNativeTeamProcessDriver({
      killGraceMs: 2000,
      windows: {
        storageDir: built.storageDir,
        systemRoot: SYSTEM_ROOT,
        log: () => undefined,
        readJobSource,
        run: runProgram,
      },
    })
  }, BUILD_MS)

  afterEach(async () => {
    // Nothing a case started outlives it: a helper still there is killed,
    // and its kill-on-close job takes the rest.
    for (const launch of launched.splice(0)) {
      if (launch.child.exitCode !== null || launch.child.signalCode !== null) continue
      const closed = new Promise((resolve) => launch.child.once('close', resolve))
      launch.child.kill()
      await closed
    }
  })

  afterAll(async () => {
    await removeFolder(state.root)
    await removeFolder(state.storage)
  })

  function request(args: readonly string[], change: Partial<TeamLaunchRequest> = {}) {
    return {
      command: process.execPath,
      args: [state.payload, ...args],
      cwd: state.workspace,
      taskId: 'task',
      env: { SystemRoot: SYSTEM_ROOT, PATH: process.env['PATH'] },
      priority: 'normal' as const,
      ...change,
    }
  }

  function launch(value: TeamLaunchRequest): {
    readonly launch: ContainedTeamChild
    readonly closed: Promise<number | null>
  } {
    if (driver === undefined) throw new Error('the team driver did not start')
    const started = driver.launch(value, randomUUID())
    launched.push(started)
    const closed = new Promise<number | null>((resolve) => {
      started.child.once('close', (code) => {
        resolve(code)
      })
    })
    return { launch: started, closed }
  }

  async function run(value: TeamLaunchRequest) {
    const started = launch(value)
    await started.launch.resume?.(await started.launch.confirmation)
    return started
  }

  function reportFile(name: string): string {
    return path.join(state.root, `${name}-${randomUUID()}.json`)
  }

  /** The launch's named job's members, as the operating system lists them. */
  async function members(group: string): Promise<readonly number[]> {
    const host = windowsJobHost(state.assembly, SYSTEM_ROOT)
    const listed = querySchema.parse(
      JSON.parse(await runTreeProgram(host.file, ['query', group], host.env)),
    )
    return listed.members.map((member) => member.pid)
  }

  it('starts the job helper itself, holds the command until released, then runs it exactly', async () => {
    const file = reportFile('exact')
    const env = {
      SystemRoot: SYSTEM_ROOT,
      PATH: process.env['PATH'],
      MUSE_TEAM_PROBE: 'a "quoted" value = 100% ^& naïve',
    }
    const started = launch(request(['exit', file, '37', ...HOSTILE_ARGUMENTS], { env }))
    // The helper is the compiled job helper, never Windows PowerShell.
    expect(started.launch.child.spawnfile).toBe(state.assembly)
    const confirmation = await started.launch.confirmation
    expect(confirmation).toMatchObject({
      container: 'windowsJob',
      group: expect.stringMatching(/^Local\\MuseSparkTeam-[0-9a-f-]{36}$/u),
      uid: expect.stringMatching(/^S-1-[0-9-]+$/u),
    })
    expect(confirmation.executable?.toLowerCase()).toBe(
      realpathSync.native(process.execPath).toLowerCase(),
    )
    // Created suspended inside the named job with its helper; nothing ran yet.
    expect(await members(confirmation.group)).toEqual(
      expect.arrayContaining([confirmation.pid, helperPid(started.launch)]),
    )
    await delay(HELD_WATCH_MS)
    expect(existsSync(file)).toBe(false)
    await started.launch.resume?.(confirmation)
    expect(await started.closed).toBe(37)
    expect(await started.launch.ended).toEqual({ childExited: true, descendants: 'proved' })
    const seen = report(file)
    expect(seen.args).toEqual(['exit', file, '37', ...HOSTILE_ARGUMENTS])
    expect(seen.cwd).toBe(state.workspace)
    // The payload's whole environment is the guarded block, entry for entry.
    const block = windowsTeamPayloadEnvironment(env, state.workspace)
    expect(Object.entries(seen.env).map(([name, value]) => `${name}=${value}`)).toEqual(
      expect.arrayContaining(block),
    )
    expect(Object.keys(seen.env)).toHaveLength(block.length)
    expect(seen.env['MUSE_TEAM_PROBE']).toBe(env.MUSE_TEAM_PROBE)
  })

  it('passes on the exact exit code of the command, whatever it is', async () => {
    for (const code of [0, 1, 2, 255, 1000, 3_221_225_477]) {
      const started = await run(request(['exit', reportFile('code'), String(code)]))
      expect(await started.closed).toBe(code)
      expect(await started.launch.ended).toEqual({ childExited: true, descendants: 'proved' })
    }
  })

  it('runs a batch file through cmd.exe with its arguments as built, and its exit code', async () => {
    const started = await run(request([], { command: state.batch, args: ['42'] }))
    expect(await started.closed).toBe(42)
    expect(await started.launch.ended).toEqual({ childExited: true, descendants: 'proved' })
  })

  it('gives the command its standard streams', async () => {
    const started = await run(request(['echo', reportFile('echo')]))
    started.launch.child.stdout.setEncoding('utf8')
    let echoed = ''
    started.launch.child.stdout.on('data', (chunk: string) => {
      echoed += chunk
    })
    started.launch.child.stdin.end('ping over the team pipe\n')
    expect(await started.closed).toBe(0)
    expect(echoed).toBe('ping over the team pipe\n')
  })

  it('runs the helper and the command below normal priority when asked, and normal otherwise', async () => {
    const below = launch(request(['exit', reportFile('below'), '0'], { priority: 'belowNormal' }))
    const held = await below.launch.confirmation
    expect(os.getPriority(held.pid)).toBe(os.constants.priority.PRIORITY_BELOW_NORMAL)
    expect(os.getPriority(helperPid(below.launch))).toBe(
      os.constants.priority.PRIORITY_BELOW_NORMAL,
    )
    await below.launch.resume?.(held)
    expect(await below.closed).toBe(0)
    const normal = launch(request(['exit', reportFile('normal'), '0']))
    const confirmation = await normal.launch.confirmation
    expect(os.getPriority(confirmation.pid)).toBe(os.getPriority(process.pid))
    await normal.launch.resume?.(confirmation)
    expect(await normal.closed).toBe(0)
  })

  it('stops the command and everything it started, and proves the job empty', async () => {
    const file = reportFile('tree')
    const started = await run(request(['tree', file]))
    const grandchild = await markedPid(`${file}.grandchild`)
    const confirmation = await started.launch.confirmation
    expect(await members(confirmation.group)).toEqual(
      expect.arrayContaining([confirmation.pid, grandchild, helperPid(started.launch)]),
    )
    expect(await started.launch.retire()).toEqual({ childExited: true, descendants: 'proved' })
    // STOP ends the command with code 1, and the helper passes it on.
    expect(await started.closed).toBe(1)
    await expectEnded(confirmation.pid)
    await expectEnded(grandchild)
  })

  it('a lost helper takes its whole job with it', async () => {
    const file = reportFile('lost')
    const started = await run(request(['tree', file]))
    const grandchild = await markedPid(`${file}.grandchild`)
    const confirmation = await started.launch.confirmation
    expect(isRunning(confirmation.pid)).toBe(true)
    started.launch.child.kill()
    await started.closed
    await expectEnded(confirmation.pid)
    await expectEnded(grandchild)
    expect(await started.launch.ended).toEqual({ childExited: true, descendants: 'uncertain' })
  })

  it('a launch retired before it was released never runs its command', async () => {
    const file = reportFile('retired')
    const started = launch(request(['exit', file, '0']))
    const confirmation = await started.launch.confirmation
    expect(await started.launch.retire()).toEqual({ childExited: true, descendants: 'uncertain' })
    await started.closed
    await expectEnded(confirmation.pid)
    expect(existsSync(file)).toBe(false)
  })
})
