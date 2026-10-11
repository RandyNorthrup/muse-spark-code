// The playbook's Windows containment (M116, PLAN.md §9
// FIXM116P3-Windows-job-binding): the argument quoting and the helper's text
// on every OS; the real helper, its job and the parent/grandchild timeout
// fixture on Windows, with the shipped MuseSparkJob type compiled as the
// extension compiles it.
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import {
  ContainedJob,
  containedJobScript,
  windowsArgument,
} from '../../src/host/playbook/containedJob'
import type { PlaybookHookEffect } from '../../src/core/orchestration/playbook/outcomes'
import { PLAYBOOK_JOB_ENVIRONMENT, PLAYBOOK_JOB_NAME_PREFIX } from '../../src/shared/constants'
import { compiledJobAssembly, SYSTEM_ROOT } from './helpers/playbook/jobAssembly'
import { removeFolder } from './helpers/temporaryFolders'

// The job type compiles under the bootstrap runner; only its admission is a fixture.
vi.mock('../../src/core/resources/admission', async (original) => {
  const { withFixtureBootstrap } = await import('./helpers/resources/fixtureLaunch')
  return withFixtureBootstrap(await original())
})

const IS_WINDOWS = process.platform === 'win32'
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

  it('answers a call only after the sweep, and always ends its job', () => {
    expect(script.indexOf('::Query($j)')).toBeGreaterThan(script.indexOf('WaitForExit'))
    expect(script.indexOf('$pipe.Write($header')).toBeGreaterThan(script.indexOf('::Query($j)'))
    expect(script.trimEnd().endsWith('::Terminate($j, 0)')).toBe(true)
  })
})

describe('ContainedJob', () => {
  it('fails the call, never runs it uncontained, when the helper cannot be reached', () => {
    const jobs: (string | undefined)[] = []
    const job = new ContainedJob({
      assemblyPath: 'missing.dll',
      systemRoot: SYSTEM_ROOT,
      onJob: (name) => {
        jobs.push(name)
      },
      // A helper that never started: no process, no pipe.
      start: () => ({ pid: undefined, unref: () => undefined }),
    })
    const result = job.run(
      { kind: 'git', cwd: process.cwd(), command: 'git', args: ['--version'] },
      { cwd: process.cwd(), env: {} },
    )
    expect(result.status).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
    expect(result.stdout).toHaveLength(0)
    expect(jobs).toHaveLength(2)
    expect(jobs[0]).toMatch(
      new RegExp(`^${PLAYBOOK_JOB_NAME_PREFIX.replaceAll('\\', '\\\\')}`, 'u'),
    )
    expect(jobs[1]).toBeUndefined()
  })
})

describe.runIf(IS_WINDOWS)('ContainedJob on Windows (native)', () => {
  const storage = { dir: '', assembly: '' }
  const jobs: (string | undefined)[] = []
  const open: ContainedJob[] = []
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
      onJob: (name) => {
        jobs.push(name)
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
    jobs.length = 0
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
    expect(jobs.filter((name) => name !== undefined)).toHaveLength(1)
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

  it('terminates the job when the decision closes, and starts a fresh one afterwards', async () => {
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
    expect(await hasHappened(() => !isRunning(helper), 5000)).toBe(true)
    expect(jobs.at(-1)).toBeUndefined()
    expect(job.run(node('process.exit(0)'), { cwd: storage.dir, env: environment() }).status).toBe(
      0,
    )
    const named = jobs.filter((name) => name !== undefined)
    expect(named).toHaveLength(2)
    expect(named[0]).not.toBe(named[1])
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
    const names: (string | undefined)[] = []
    const job = new ContainedJob({
      assemblyPath: bogus,
      systemRoot: SYSTEM_ROOT,
      onJob: (name) => {
        names.push(name)
      },
    })
    const result = job.run(node('process.stdout.write("ran")'), {
      cwd: storage.dir,
      env: environment(),
    })
    expect(result.status).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
    expect(result.stdout).toHaveLength(0)
    expect(names.at(-1)).toBeUndefined()
  })
})
