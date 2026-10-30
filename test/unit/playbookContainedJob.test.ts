// The playbook's Windows containment (M116, PLAN.md §9
// FIXM116P3-Windows-job-binding): the argument quoting and the helper's text
// on every OS; the real helper, its job and the parent/grandchild timeout
// fixture on Windows, with the shipped MuseSparkJob type compiled as the
// extension compiles it. On macOS and Linux the supervisor's own group sweep
// ends what a finished call left behind.
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { withoutCredentials } from '../../src/core/credentialEnvironment'
import {
  shellEnvironment,
  windowsPowerShell,
  workspaceChildEnvironment,
} from '../../src/core/execGuard'
import {
  ContainedJob,
  containedJobScript,
  endJobScript,
  windowsArgument,
} from '../../src/host/playbook/containedJob'
import { processGitPath } from '../../src/host/git'
import { runTreeSync } from '../../src/host/processTree'
import { withoutHostVariables } from '../../src/core/hostVariables'
import { renamedFiles } from '../../src/core/orchestration/playbook/renamedFiles'
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

const IS_WINDOWS = process.platform === 'win32'
/** Whether the machine's git answers: without it the rename proof runs on hosted CI. */
const IS_GIT_AVAILABLE = spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0
/**
Whether the process supervisor reports real statuses: sandboxes without
`ps` (this MacBook's lanes) break it, and the rename proof needs it, so
without it the proof runs on hosted CI.
*/
const IS_SUPERVISOR_HEALTHY =
  runTreeSync('/bin/sh', ['-c', 'exit 3'], {
    cwd: tmpdir(),
    env: workspaceChildEnvironment(process.platform, withoutCredentials(process.env), {
      workspaceRoot: tmpdir(),
      realpath: realpathSync,
    }),
  }).status === 3
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

/** How long a stray process has to be seen gone. */
const STRAY_GONE_MS = 5000

async function hasHappened(isDone: () => boolean): Promise<boolean> {
  const deadline = Date.now() + STRAY_GONE_MS
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
    // A helper dead before it could serve its pipe: a real process of the
    // test's own, spawned and reaped, whose pid the open finds gone. (Our
    // own exited child would stay a zombie under the open's blocked poll,
    // never looking dead; spawnSync reaps before the open runs.)
    const grave = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' })
    const job = new ContainedJob({
      assemblyPath: 'missing.dll',
      systemRoot: SYSTEM_ROOT,
      onJob: (names) => {
        published.push([...names])
      },
      // The requested PowerShell cannot run off Windows; what the open
      // answers to is the gone helper, not the program. The end by name
      // never runs (the gone-arm short-circuit), so the default stands:
      // were it consulted, its verdict would be false and the job
      // retained, failing the last assertion below.
      start: () => ({ pid: grave.pid, unref: () => undefined }),
      connectMs: 50,
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
  })

  it('never forgets a job whose end it has not seen', () => {
    const published: string[][] = []
    let isEnded = false
    const ended: string[] = []
    const recordEnd = (name: string): void => {
      ended.push(name)
    }
    // A helper that is alive and never serves its pipe: a real process of
    // the test's own, sleeping. The 30 s self-end is harness hygiene only:
    // the test kills it below, and a failure must not leave it behind.
    const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    try {
      const job = new ContainedJob({
        assemblyPath: 'missing.dll',
        systemRoot: SYSTEM_ROOT,
        onJob: (names) => {
          published.push([...names])
        },
        start: () => sleeper,
        end: (name: string): boolean => {
          recordEnd(name)
          return isEnded
        },
        connectMs: 50,
      })
      const first = job.run(VERSION, { cwd: process.cwd(), env: {} })
      expect(first.status).toBeNull()
      const [stuck] = published.at(-1) ?? []
      // It was ended by name, the end was not seen, and its name is still published.
      expect(ended).toEqual([stuck])
      expect(published.at(-1)).toEqual([stuck])
      // The next call fails the same way, and the first job is still not forgotten.
      expect(job.run(VERSION, { cwd: process.cwd(), env: {} }).status).toBeNull()
      expect(published.at(-1)).toHaveLength(2)
      expect(published.at(-1)).toContain(stuck)
      // Once ending by name is seen to work, every kept name is let go.
      isEnded = true
      expect(job.run(VERSION, { cwd: process.cwd(), env: {} }).status).toBeNull()
      expect(published.at(-1)).toEqual([])
      expect(ended).toContain(stuck)
    } finally {
      sleeper.kill()
    }
  })
})

describe('the environment of a playbook command', () => {
  it('holds none of the editor host’s own variables, by the shell tools’ one list', () => {
    const kept = { PATH: '/bin', VSCODE_PORTABLE: '/portable' }
    // The five names VS Code's own terminal keeps for the person stay, as for a shell tool.
    expect(withoutHostVariables({ ...kept, ...EXTENSION_HOST_VARIABLES })).toEqual(kept)
    // The shell tools' environment is made with the same list.
    expect(
      hostNames(
        shellEnvironment(
          { ...kept, ...EXTENSION_HOST_VARIABLES },
          'linux',
          undefined,
          [],
          false,
          {},
          {
            workspaceRoot: '/work',
            realpath: realpathSync,
          },
        ),
      ),
    ).toEqual(['VSCODE_PORTABLE'])
  })

  it.each(['linux', 'win32', 'darwin'] as const)(
    'is what the policy gives git on %s: the stripped host environment, by the one list',
    async (platform) => {
      // The exact expression renamedFiles feeds git: the hostile input is
      // plain data, never the process environment and never a runner.
      const workspace = await mkdtemp(path.join(tmpdir(), 'muse-playbook-environment-'))
      try {
        const given = workspaceChildEnvironment(
          platform,
          withoutHostVariables(
            withoutCredentials({
              PATH: '/bin',
              VSCODE_PORTABLE: '/portable',
              ...EXTENSION_HOST_VARIABLES,
            }),
            platform,
          ),
          { workspaceRoot: workspace, realpath: realpathSync },
        )
        expect(hostNames(given)).toEqual(['VSCODE_PORTABLE'])
      } finally {
        await removeFolder(workspace)
      }
    },
  )

  it.runIf(!IS_WINDOWS && IS_GIT_AVAILABLE && IS_SUPERVISOR_HEALTHY)(
    'finds a real rename with the host variables really present',
    async () => {
      // The wiring for real: host variables really in the process
      // environment, real git in a real repository, no contained runner
      // (off Windows the policy spawns git directly). Windows needs a
      // contained runner; its native block proves the real job carries
      // the environment through.
      const workspace = await mkdtemp(path.join(tmpdir(), 'muse-playbook-renames-'))
      try {
        const git = processGitPath(workspace)
        if (git === undefined) throw new Error('git is not installed')
        const runGit = (args: readonly string[]): void => {
          const result = spawnSync(git, [...args], { cwd: workspace, encoding: 'utf8' })
          if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
        }
        runGit(['-c', 'init.defaultBranch=main', 'init'])
        await writeFile(path.join(workspace, 'old.txt'), 'moved\n')
        runGit(['add', 'old.txt'])
        runGit([
          '-c',
          'user.email=playbook@test',
          '-c',
          'user.name=playbook',
          '-c',
          'commit.gpgsign=false',
          'commit',
          '-m',
          'before the move',
        ])
        runGit(['mv', 'old.txt', 'new.txt'])
        const previous = new Map<string, string | undefined>()
        for (const [name, value] of Object.entries(EXTENSION_HOST_VARIABLES)) {
          previous.set(name, process.env[name])
          process.env[name] = value
        }
        try {
          expect(renamedFiles(workspace, { admit: () => true })).toEqual([
            { from: 'old.txt', to: 'new.txt' },
          ])
        } finally {
          for (const [name, value] of previous) {
            if (value === undefined) Reflect.deleteProperty(process.env, name)
            else process.env[name] = value
          }
        }
      } finally {
        await removeFolder(workspace)
      }
    },
  )
})

describe.runIf(!IS_WINDOWS)('the supervisor’s group sweep on macOS and Linux', () => {
  const storage = { dir: '' }
  const call = () => ({
    cwd: storage.dir,
    env: workspaceChildEnvironment(process.platform, withoutCredentials(process.env), {
      workspaceRoot: storage.dir,
      realpath: realpathSync,
    }),
    timeout: 30_000,
  })

  beforeAll(async () => {
    storage.dir = await mkdtemp(path.join(tmpdir(), 'muse-playbook-supervisor-'))
  })
  afterAll(() => removeFolder(storage.dir))

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
    const ended: string[] = []
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
      end: (name: string): boolean => {
        ended.push(name)
        return isEnded
      },
    })
    open.push(job)
    try {
      const call = { cwd: storage.dir, env: environment() }
      expect(job.run(node('process.exit(0)'), call).status).toBeNull()
      const [kept] = published.at(-1) ?? []
      // Its pipe was closed and it stayed; ending its job by name was not seen to work.
      expect(ended).toEqual([kept])
      expect(published.at(-1)).toEqual([kept])
      // The next decision ends it by name first, sees that, and only then lets the name go.
      isEnded = true
      isStaying = false
      expect(job.run(node('process.exit(0)'), call).status).toBeNull()
      expect(ended.at(-1)).toBe(kept)
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
      expect(await hasHappened(() => !isRunning(member.pid ?? 0))).toBe(true)
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
    expect(await hasHappened(() => !isRunning(helper))).toBe(true)
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
