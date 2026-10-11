// The playbook's Windows containment (M116, PLAN.md §9
// FIXM116P3-Windows-job-binding): the argument quoting and the helper's text
// on every OS; the real helper, its job and the parent/grandchild timeout
// fixture on Windows, with the shipped MuseSparkJob type compiled as the
// extension compiles it. On macOS and Linux, the equivalent bound: a lost
// supervisor's process group is ended by its caller.
import {
  execFileSync,
  spawn,
  spawnSync,
  type SpawnSyncOptionsWithBufferEncoding,
} from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import { posixQuoted } from '../../src/core/shellQuote'
import {
  ContainedJob,
  containedJobScript,
  endJobScript,
  windowsArgument,
} from '../../src/host/playbook/containedJob'
import { runTreeSync, windowsPowerShell } from '../../src/host/processTree'
import { shellEnvironment } from '../../src/host/backend/toolIo'
import { withoutHostVariables } from '../../src/core/hostVariables'
import { renamedFiles } from '../../src/core/orchestration/playbook/modules'
import type { PlaybookHookEffect } from '../../src/core/orchestration/playbook/outcomes'
import {
  PLAYBOOK_JOB_ENVIRONMENT,
  PLAYBOOK_JOB_NAME_PREFIX,
  PLAYBOOK_JOB_PIPE_ROOT,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
} from '../../src/shared/constants'
import { expectEnded } from './helpers/processes'
import { EXTENSION_HOST_VARIABLES, hostNames } from './helpers/playbook/hostVariables'
import { compiledJobAssembly, SYSTEM_ROOT } from './helpers/playbook/jobAssembly'
import { removeFolder } from './helpers/temporaryFolders'

// The job type compiles under the bootstrap runner; only its admission is a fixture.
vi.mock('../../src/core/resources/admission', async (original) => {
  const { withFixtureBootstrap } = await import('./helpers/resources/fixtureLaunch')
  return withFixtureBootstrap(await original())
})

const IS_WINDOWS = process.platform === 'win32'
const RUN_AS_NODE = 'ELECTRON_RUN_AS_NODE'
/** A shell call that prints every `ELECTRON_*` and `VSCODE_*` variable it was given, or `none`. */
const SAYS_HOST = "env | grep -E '^(ELECTRON|VSCODE)_' || printf none"
/** What a contained fixture process reports about itself. */
const seenSchema = z.object({
  cwd: z.string(),
  marker: z.string(),
  helper: z.array(z.string()),
  args: z.array(z.string()),
})
const treeSchema = z.object({ parent: z.number(), child: z.number() })

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** The process group of a process, as the POSIX process table gives it. */
function groupOf(pid: number): number {
  return Number(
    execFileSync('/bin/ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim(),
  )
}

async function hasHappened(isDone: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (isDone()) return true
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
  }
  return isDone()
}

/** What a contained call is given: nothing else of the host's reaches it. */
function environment(): NodeJS.ProcessEnv {
  return {
    SystemRoot: SYSTEM_ROOT,
    PATH: process.env['PATH'],
    MUSE_CONTAINED_MARKER: 'kept exactly',
  }
}

describe('windowsArgument', () => {
  it.each([
    ['plain', 'plain'],
    ['', '""'],
    ['a b', '"a b"'],
    ['say "hi"', String.raw`"say \"hi\""`],
    [String.raw`C:\dir with space\\`, String.raw`"C:\dir with space\\\\"`],
    [String.raw`back\"slash`, String.raw`"back\\\"slash"`],
    [
      String.raw`core.hooksPath=C:\Users\a b\.husky\_`,
      String.raw`"core.hooksPath=C:\Users\a b\.husky\_"`,
    ],
    ['C:\\no\\spaces\\', 'C:\\no\\spaces\\'],
  ])('quotes %j as the C runtime reads it', (argument, quoted) => {
    expect(windowsArgument(argument)).toBe(quoted)
  })
})

describe('containedJobScript', () => {
  const script = containedJobScript()

  it('names no cmdlet that module auto-loading would have to find', () => {
    expect(script).not.toMatch(
      /\b(?:New-Object|Add-Type|ConvertFrom-Json|ConvertTo-Json|Write-Output|Write-Host|Start-Process|Get-\w+|Where-Object|ForEach-Object|Out-\w+)\b/u,
    )
  })

  it('clears every value it was given from its own environment before any call', () => {
    for (const name of Object.values(PLAYBOOK_JOB_ENVIRONMENT))
      expect(script).toContain(`$env:${name} = $null`)
    expect(script.indexOf(`$env:${PLAYBOOK_JOB_ENVIRONMENT.job} = $null`)).toBeLessThan(
      script.indexOf('[Diagnostics.Process]::Start'),
    )
  })

  it('binds the job to its own life before any pipe can serve a call', () => {
    // Kill-on-close on the handle the helper holds: the job cannot outlive it.
    const bound = script.indexOf("GetMethod('SetInformationJobObject'")
    expect(bound).toBeGreaterThan(script.indexOf('::Join($j)'))
    expect(script.indexOf('WriteInt32($info, 16, 8192)')).toBeGreaterThan(-1)
    expect(script.indexOf("{ throw 'limit' }")).toBeGreaterThan(bound)
    expect(script.indexOf('NamedPipeServerStream')).toBeGreaterThan(
      script.indexOf("{ throw 'limit' }"),
    )
  })

  it('binds through members the shipped job type still has', () => {
    // The helper reaches these two by name; a rename there must fail here, on every OS.
    const source = readFileSync(path.resolve('native/windows/MuseSparkJob.cs'), 'utf8')
    expect(source).toContain('static IntPtr held = IntPtr.Zero;')
    expect(source).toContain(
      'static extern bool SetInformationJobObject(IntPtr job, int kind, IntPtr info, uint length);',
    )
  })

  it('answers a call only after the sweep, and always ends its job', () => {
    expect(script.indexOf('::Query($j)')).toBeGreaterThan(script.indexOf('WaitForExit'))
    expect(script.indexOf('$pipe.Write($header')).toBeGreaterThan(script.indexOf('::Query($j)'))
    expect(script.trimEnd().endsWith('::Terminate($j, 0)')).toBe(true)
  })
})

describe('ContainedJob', () => {
  const VERSION = { kind: 'git', cwd: process.cwd(), command: 'git', args: ['--version'] } as const

  it('fails the call, never runs it uncontained, when the helper cannot be reached', () => {
    const published: string[][] = []
    const end = vi.fn(() => true)
    const job = new ContainedJob({
      assemblyPath: 'missing.dll',
      systemRoot: SYSTEM_ROOT,
      onJob: (names) => {
        published.push([...names])
      },
      // A helper that never started: no process, no pipe, and so no job.
      start: () => ({ pid: undefined, unref: () => undefined }),
      end,
    })
    const result = job.run(VERSION, { cwd: process.cwd(), env: {} })
    expect(result.status).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
    expect(result.stdout).toHaveLength(0)
    expect(published).toHaveLength(2)
    expect(published[0]?.[0]).toMatch(
      new RegExp(`^${PLAYBOOK_JOB_NAME_PREFIX.replaceAll('\\', '\\\\')}`, 'u'),
    )
    expect(published[1]).toEqual([])
    // A helper that is gone took its job with it: nothing is left to end by name.
    expect(end).not.toHaveBeenCalled()
  })

  it('never forgets a job whose end it has not seen', () => {
    const published: string[][] = []
    let isEnded = false
    const end = vi.fn((_name: string) => isEnded)
    const job = new ContainedJob({
      assemblyPath: 'missing.dll',
      systemRoot: SYSTEM_ROOT,
      onJob: (names) => {
        published.push([...names])
      },
      // A helper that is alive (this very process) and never serves its pipe.
      start: () => ({ pid: process.pid, unref: () => undefined }),
      end,
      connectMs: 50,
    })
    const first = job.run(VERSION, { cwd: process.cwd(), env: {} })
    expect(first.status).toBeNull()
    const [stuck] = published.at(-1) ?? []
    // It was ended by name, the end was not seen, and its name is still published.
    expect(end).toHaveBeenCalledExactlyOnceWith(stuck)
    expect(published.at(-1)).toEqual([stuck])
    // The next call fails the same way, and the first job is still not forgotten.
    expect(job.run(VERSION, { cwd: process.cwd(), env: {} }).status).toBeNull()
    expect(published.at(-1)).toHaveLength(2)
    expect(published.at(-1)).toContain(stuck)
    // Once ending by name is seen to work, every kept name is let go.
    isEnded = true
    expect(job.run(VERSION, { cwd: process.cwd(), env: {} }).status).toBeNull()
    expect(published.at(-1)).toEqual([])
    expect(end).toHaveBeenCalledWith(stuck)
  })
})

describe('the environment of a playbook command', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('holds none of the editor host’s own variables, by the shell tools’ one list', () => {
    const kept = { PATH: '/bin', VSCODE_PORTABLE: '/portable' }
    // The five names VS Code's own terminal keeps for the person stay, as for a shell tool.
    expect(withoutHostVariables({ ...kept, ...EXTENSION_HOST_VARIABLES })).toEqual(kept)
    // The shell tools' environment is made with the same list.
    expect(
      hostNames(shellEnvironment({ ...kept, ...EXTENSION_HOST_VARIABLES }, 'linux', undefined)),
    ).toEqual(['VSCODE_PORTABLE'])
  })

  it('is what the policy gives git when it looks for moved files, whatever its host holds', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'muse-playbook-environment-'))
    try {
      await mkdir(path.join(workspace, '.git'))
      // Everything a VS Code extension host's environment was seen to carry.
      for (const [name, value] of Object.entries(EXTENSION_HOST_VARIABLES)) vi.stubEnv(name, value)
      const given: NodeJS.ProcessEnv[] = []
      const nothing = Buffer.alloc(0)
      renamedFiles(workspace, {
        admit: () => true,
        // Stands in for the contained runner on every OS: the call's options are the test.
        runContained: (_effect, options) => {
          given.push(options.env ?? {})
          return {
            pid: 1,
            output: [null, nothing, nothing],
            stdout: nothing,
            stderr: nothing,
            status: 0,
            signal: null,
          }
        },
      })
      expect(given.length).toBeGreaterThan(0)
      for (const env of given) expect(hostNames(env)).toEqual([])
    } finally {
      await removeFolder(workspace)
    }
  })
})

describe.runIf(!IS_WINDOWS)('a lost supervisor on macOS and Linux', () => {
  const storage = { dir: '' }
  const bystanders: { kill: () => boolean }[] = []
  /** A process of the caller's own, in the caller's own group: no call may reach it. */
  const bystander = (): number => {
    const waiting = spawn('/bin/sleep', ['60'], { stdio: 'ignore' })
    bystanders.push(waiting)
    if (waiting.pid === undefined) throw new Error('The bystander never started')
    return waiting.pid
  }
  const call = () => ({ cwd: storage.dir, env: { PATH: process.env['PATH'] }, timeout: 30_000 })

  beforeAll(async () => {
    storage.dir = await mkdtemp(path.join(tmpdir(), 'muse-playbook-supervisor-'))
  })
  afterEach(() => {
    for (const waiting of bystanders.splice(0)) waiting.kill()
  })
  afterAll(() => removeFolder(storage.dir))

  it('starts each call in a new process group that its supervisor leads', () => {
    // The call says which group it is in, and who its parent (the supervisor) is.
    const result = runTreeSync('/bin/sh', ['-c', '/bin/ps -o pgid= -p $$; echo $PPID'], call())
    expect(result.status).toBe(0)
    const [group, supervisor] = result.stdout.toString('utf8').trim().split(/\s+/u).map(Number)
    // This runtime's synchronous spawn honoured `detached`: the supervisor's pid,
    // which the caller has, names the call's group. It is never the caller's own.
    expect(supervisor).toBe(result.pid)
    expect(group).toBe(result.pid)
    expect(group).not.toBe(groupOf(process.pid))
  })

  it('refuses the call and starts nothing under a runtime that ignores detached', () => {
    const marker = path.join(storage.dir, 'started-anyway')
    const beside = bystander()
    const result = runTreeSync('/bin/sh', ['-c', `echo started > ${posixQuoted(marker)}`], call(), {
      // The same spawn with the option dropped, as such a runtime would drop it.
      start: (file, args, options) => {
        const dropped: SpawnSyncOptionsWithBufferEncoding & { detached: boolean } = {
          ...options,
          detached: false,
        }
        return spawnSync(file, args, dropped)
      },
    })
    expect(result.status).toBe(1)
    expect(result.stderr.toString('utf8')).toContain('does not lead its process group')
    expect(existsSync(marker)).toBe(false)
    // That supervisor sat in the caller's own group; ending "its" group reached nobody.
    expect(isRunning(beside)).toBe(true)
  })

  /** A call under a host environment that carries all nine, and what its supervisor was given. */
  const underHost = (versions: Readonly<Record<string, string | undefined>>) => {
    const given: string[][] = []
    const result = runTreeSync(
      '/bin/sh',
      ['-c', SAYS_HOST],
      { ...call(), env: { PATH: process.env['PATH'], ...EXTENSION_HOST_VARIABLES } },
      {
        versions,
        start: (file, args, options) => {
          given.push(hostNames(options.env))
          return spawnSync(file, args, options)
        },
      },
    )
    return { given, status: result.status, said: result.stdout.toString('utf8') }
  }

  it('gives its supervisor Electron’s run-as-Node switch inside VS Code, and the call none of the host’s variables', () => {
    // VS Code's binary runs the supervisor's source only with the switch. Of the
    // nine, that is all the supervisor is given, and the call is given none.
    expect(underHost({ ...process.versions, electron: '43.7.3' })).toEqual({
      given: [[RUN_AS_NODE]],
      status: 0,
      said: 'none',
    })
  })

  it('gives neither the supervisor nor the call any of them outside Electron', () => {
    const versions = Object.fromEntries(
      Object.entries(process.versions).filter(([name]) => name !== 'electron'),
    )
    expect(underHost(versions)).toEqual({ given: [[]], status: 0, said: 'none' })
  })

  it('ends the call’s process group when its supervisor is lost, and fails the call', async () => {
    const pids = path.join(storage.dir, 'group-pids')
    const beside = bystander()
    // The call's own shell starts a second process, kills its supervisor at the
    // first moment it can (before a supervisor could have said anything), and stays.
    const result = runTreeSync(
      '/bin/sh',
      ['-c', `sleep 60 & echo "$$ $!" > ${posixQuoted(pids)}; kill -9 $PPID; sleep 60`],
      call(),
    )
    expect(result.status).toBeNull()
    expect(result.signal).toBe('SIGKILL')
    const [shell, sleeper] = readFileSync(pids, 'utf8').trim().split(' ').map(Number)
    if (shell === undefined || sleeper === undefined) throw new Error('The group never started')
    // The call has returned: its caller has ended both, with no supervisor left to.
    await expectEnded(shell)
    await expectEnded(sleeper)
    // And nothing else: a process of the caller's, in the caller's group, is untouched.
    expect(isRunning(beside)).toBe(true)
  })

  it('ends a process of the call’s group that no parent leads to any more, and keeps the call’s status', async () => {
    const stray = path.join(storage.dir, 'stray-pid')
    // The stray names itself and holds the call's output open. The shell that
    // started it does nothing else and is gone at once, so no look at the
    // process table finds a parent that leads from the call to the stray.
    await writeFile(path.join(storage.dir, 'stray.sh'), 'echo $$ > "$1"\nexec sleep 60\n')
    await writeFile(path.join(storage.dir, 'middle.sh'), '/bin/sh "$1/stray.sh" "$1/stray-pid" &\n')
    const result = runTreeSync(
      '/bin/sh',
      [
        '-c',
        '/bin/sh "$0/middle.sh" "$0"; while [ ! -s "$0/stray-pid" ]; do sleep 0.01; done; printf done; exit 3',
        storage.dir,
      ],
      call(),
    )
    expect(result.status).toBe(3)
    expect(result.signal).toBeNull()
    expect(result.stdout.toString('utf8')).toBe('done')
    await expectEnded(Number(readFileSync(stray, 'utf8')))
  })

  it('leaves a call whose supervisor finished exactly as it was', () => {
    const result = runTreeSync('/bin/sh', ['-c', 'printf done; exit 3'], call())
    expect(result.status).toBe(3)
    expect(result.signal).toBeNull()
    expect(result.stdout.toString('utf8')).toBe('done')
  })
})

describe.runIf(IS_WINDOWS)('ContainedJob on Windows (native)', () => {
  const storage = { dir: '', assembly: '' }
  /** Each publication: the jobs whose end had not been seen. */
  const published: string[][] = []
  const open: ContainedJob[] = []
  const everNamed = () => [...new Set(published.flat())]
  const node = (script: string): PlaybookHookEffect => ({
    kind: 'hook',
    cwd: storage.dir,
    command: process.execPath,
    args: ['-e', script],
  })
  const contained = (): ContainedJob => {
    const job = new ContainedJob({
      assemblyPath: storage.assembly,
      systemRoot: SYSTEM_ROOT,
      onJob: (names) => {
        published.push([...names])
      },
    })
    open.push(job)
    return job
  }

  beforeAll(async () => {
    storage.dir = await mkdtemp(path.join(tmpdir(), 'muse-playbook-job-'))
    storage.assembly = await compiledJobAssembly(storage.dir)
  })
  afterEach(() => {
    for (const job of open.splice(0)) job.close()
    published.length = 0
  })
  afterAll(() => removeFolder(storage.dir))

  it('returns the exit status and the exact bytes of both streams', () => {
    const job = contained()
    const result = job.run(
      node(
        'process.stdout.write(Buffer.from([0,255,10,13,0,65])); process.stderr.write("warned"); process.exitCode = 7',
      ),
      { cwd: storage.dir, env: environment() },
    )
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(7)
    expect([...result.stdout]).toEqual([0, 255, 10, 13, 0, 65])
    expect(result.stderr.toString('utf8')).toBe('warned')
  })

  it('gives the call exactly the environment, directory and arguments it was asked with', () => {
    const job = contained()
    const result = job.run(
      {
        kind: 'git',
        cwd: storage.dir,
        command: process.execPath,
        args: [
          '-e',
          'process.stdout.write(JSON.stringify({ cwd: process.cwd(), marker: process.env.MUSE_CONTAINED_MARKER, helper: Object.keys(process.env).filter((name) => name.startsWith("MUSE_SPARK_PLAYBOOK_")), args: process.argv.slice(1) }))',
          'two words',
          String.raw`quote " and \ slash\\`,
        ],
      },
      { cwd: storage.dir, env: environment() },
    )
    expect(result.status).toBe(0)
    const seen = seenSchema.parse(JSON.parse(result.stdout.toString('utf8')))
    expect(path.resolve(seen.cwd).toLowerCase()).toBe(path.resolve(storage.dir).toLowerCase())
    expect(seen.marker).toBe('kept exactly')
    expect(seen.helper).toEqual([])
    expect(seen.args).toEqual(['two words', String.raw`quote " and \ slash\\`])
  })

  it('ends a timed-out parent and its detached grandchild before the call returns', async () => {
    const pids = path.join(storage.dir, 'timeout-pids.json')
    const job = contained()
    const started = Date.now()
    const result = job.run(
      node(
        `const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' }); child.unref(); require('node:fs').writeFileSync(${JSON.stringify(pids)}, JSON.stringify({ parent: process.pid, child: child.pid })); setInterval(() => {}, 1000)`,
      ),
      { cwd: storage.dir, env: environment(), timeout: 1500 },
    )
    expect(result.status).toBeNull()
    expect(result.error?.message).toBe('ETIMEDOUT')
    expect(Date.now() - started).toBeLessThan(10_000)
    const tree = treeSchema.parse(JSON.parse(await readFile(pids, 'utf8')))
    // The call has returned: neither process may still be running.
    expect(isRunning(tree.parent)).toBe(false)
    expect(isRunning(tree.child)).toBe(false)
  })

  it('ends what a successful call left running, and keeps serving the same job', () => {
    const pidFile = path.join(storage.dir, 'background-pid.txt')
    const job = contained()
    const first = job.run(
      node(
        `const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' }); child.unref(); require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid)); process.stdout.write('done')`,
      ),
      { cwd: storage.dir, env: environment() },
    )
    expect(first.status).toBe(0)
    expect(first.stdout.toString('utf8')).toBe('done')
    // Read without yielding: the decision, and so its job, is still open.
    expect(isRunning(Number(readFileSync(pidFile, 'utf8')))).toBe(false)
    const second = job.run(node('process.stdout.write("again")'), {
      cwd: storage.dir,
      env: environment(),
    })
    expect(second.stdout.toString('utf8')).toBe('again')
    // One decision, one job.
    expect(everNamed()).toHaveLength(1)
  })

  it('refuses output past the bound instead of returning a cut result', () => {
    const job = contained()
    const result = job.run(node('process.stdout.write("x".repeat(200000))'), {
      cwd: storage.dir,
      env: environment(),
      maxBuffer: 1024,
    })
    expect(result.status).toBeNull()
    expect(result.error?.message).toBe('ENOBUFS')
    expect(result.stdout).toHaveLength(0)
  })

  it('reports a program that cannot start as a failure of that call only', () => {
    const job = contained()
    const missing = job.run(
      { kind: 'git', cwd: storage.dir, command: 'muse-no-such-program.exe', args: [] },
      { cwd: storage.dir, env: environment() },
    )
    expect(missing.status).toBeNull()
    expect(missing.error?.message).toBe('ENOENT')
    expect(job.run(node('process.exit(0)'), { cwd: storage.dir, env: environment() }).status).toBe(
      0,
    )
  })

  it('terminates the job when the decision closes, and starts a fresh one afterwards', () => {
    const helperPid = path.join(storage.dir, 'helper-pid.txt')
    const job = contained()
    job.run(
      node(`require('node:fs').writeFileSync(${JSON.stringify(helperPid)}, String(process.ppid))`),
      { cwd: storage.dir, env: environment() },
    )
    // Read without yielding: the job closes itself once this stretch ends.
    const helper = Number(readFileSync(helperPid, 'utf8'))
    expect(isRunning(helper)).toBe(true)
    job.close()
    // Closing returns only once the job's end was seen: the helper is gone already.
    expect(isRunning(helper)).toBe(false)
    expect(published.at(-1)).toEqual([])
    expect(job.run(node('process.exit(0)'), { cwd: storage.dir, env: environment() }).status).toBe(
      0,
    )
    expect(everNamed()).toHaveLength(2)
  })

  it('ends the whole tree when the helper is lost, fails the call, and forgets the job only then', () => {
    const pids = path.join(storage.dir, 'lost-helper-pids.json')
    const job = contained()
    // The call starts a detached grandchild, kills the helper it runs under, and stays.
    const result = job.run(
      node(
        `const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' }); child.unref(); require('node:fs').writeFileSync(${JSON.stringify(pids)}, JSON.stringify({ parent: process.pid, child: child.pid })); process.kill(process.ppid); setInterval(() => {}, 1000)`,
      ),
      { cwd: storage.dir, env: environment(), timeout: 30_000 },
    )
    expect(result.status).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
    const tree = treeSchema.parse(JSON.parse(readFileSync(pids, 'utf8')))
    // The call has returned: the operating system ended the job with its helper.
    expect(isRunning(tree.parent)).toBe(false)
    expect(isRunning(tree.child)).toBe(false)
    // The job was named while it lived, and let go only after its end was seen.
    expect(everNamed()).toHaveLength(1)
    expect(published.at(-1)).toEqual([])
  })

  it('keeps the name of a job whose helper stayed and whose end was not seen', () => {
    let isEnded = false
    let isStaying = true
    const end = vi.fn((_name: string) => isEnded)
    const helpers: { kill: () => boolean }[] = []
    // A helper that serves its pipe, drops whoever connects, and stays.
    const stays = String.raw`require('node:net').createServer((socket) => { socket.destroy() }).listen(process.env.MUSE_TEST_PIPE_ROOT + '\\' + process.env.${PLAYBOOK_JOB_ENVIRONMENT.pipe})`
    const job = new ContainedJob({
      assemblyPath: storage.assembly,
      systemRoot: SYSTEM_ROOT,
      onJob: (names) => {
        published.push([...names])
      },
      start: (_file, _args, env) => {
        if (!isStaying) return { pid: undefined, unref: () => undefined }
        const helper = spawn(process.execPath, ['-e', stays], {
          env: { ...env, MUSE_TEST_PIPE_ROOT: PLAYBOOK_JOB_PIPE_ROOT },
          stdio: 'ignore',
          windowsHide: true,
        })
        helpers.push(helper)
        return helper
      },
      end,
    })
    open.push(job)
    try {
      const call = { cwd: storage.dir, env: environment() }
      expect(job.run(node('process.exit(0)'), call).status).toBeNull()
      const [kept] = published.at(-1) ?? []
      // Its pipe was closed and it stayed; ending its job by name was not seen to work.
      expect(end).toHaveBeenCalledExactlyOnceWith(kept)
      expect(published.at(-1)).toEqual([kept])
      // The next decision ends it by name first, sees that, and only then lets the name go.
      isEnded = true
      isStaying = false
      expect(job.run(node('process.exit(0)'), call).status).toBeNull()
      expect(end).toHaveBeenLastCalledWith(kept)
      expect(published.at(-1)).toEqual([])
    } finally {
      for (const helper of helpers) helper.kill()
    }
  })

  it('ends a job by its name and sees it empty, for a helper that cannot be asked', async () => {
    const name = String.raw`Local\MuseSparkPlaybookTest-${String(Date.now())}`
    const powershell = windowsPowerShell(SYSTEM_ROOT)
    // A process that joins a job the plain way: no kill-on-close, nobody serving it.
    const member = spawn(
      powershell.file,
      [
        ...WINDOWS_POWERSHELL_COMMAND_ARGS,
        `[void][Reflection.Assembly]::LoadFrom($env:MUSE_TEST_ASSEMBLY); [MuseSparkJob]::Join($env:MUSE_TEST_JOB); [Console]::Out.WriteLine('joined'); [Threading.Thread]::Sleep(60000)`,
      ],
      {
        env: { ...powershell.env, MUSE_TEST_ASSEMBLY: storage.assembly, MUSE_TEST_JOB: name },
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      },
    )
    try {
      await new Promise<void>((resolve, reject) => {
        member.stdout.once('data', () => {
          resolve()
        })
        member.once('exit', () => {
          reject(new Error('The member never joined its job'))
        })
      })
      const end = (job: string) =>
        spawnSync(
          powershell.file,
          [...WINDOWS_POWERSHELL_COMMAND_ARGS, endJobScript(storage.assembly, job)],
          { env: powershell.env, stdio: 'ignore', windowsHide: true },
        ).status
      expect(end(name)).toBe(0)
      expect(await hasHappened(() => !isRunning(member.pid ?? 0), 5000)).toBe(true)
      // A job that does not exist is a job seen to be over.
      expect(end(`${name}-never`)).toBe(0)
    } finally {
      member.kill()
    }
  })

  it('closes its job by itself at the end of the synchronous stretch that used it', async () => {
    const helperPid = path.join(storage.dir, 'stretch-pid.txt')
    const job = contained()
    job.run(
      node(`require('node:fs').writeFileSync(${JSON.stringify(helperPid)}, String(process.ppid))`),
      { cwd: storage.dir, env: environment() },
    )
    const helper = Number(await readFile(helperPid, 'utf8'))
    expect(await hasHappened(() => !isRunning(helper), 5000)).toBe(true)
  })

  it('cannot be reached without the real job type: a file that is not an assembly fails closed', async () => {
    const bogus = path.join(storage.dir, 'not-an-assembly.dll')
    await writeFile(bogus, 'not an assembly')
    const names: string[][] = []
    const job = new ContainedJob({
      assemblyPath: bogus,
      systemRoot: SYSTEM_ROOT,
      onJob: (unended) => {
        names.push([...unended])
      },
    })
    const result = job.run(node('process.stdout.write("ran")'), {
      cwd: storage.dir,
      env: environment(),
    })
    expect(result.status).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
    expect(result.stdout).toHaveLength(0)
    expect(names.at(-1)).toEqual([])
  })
})
