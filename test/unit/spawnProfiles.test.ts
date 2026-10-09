import * as childProcess from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as admission from '../../src/core/resources/admission'
import { spawnResourceProcess } from '../../src/core/resources/process'
import { execResourceFile, handoffResourceFile } from '../../src/core/resources/commands'
import * as jobLaunch from '../../src/host/backend/mcpJobLaunch'
import { isResourceCapRefused, isResourceMemoryLimit } from '../../src/core/resources/launch'
import {
  ResourceHelperChangedError,
  isResourceHelperChanged,
} from '../../src/host/backend/helperIntegrity'
import { PassThrough } from 'node:stream'
import { RESOURCE_HANDOFF_TIMEOUT_MS } from '../../src/shared/constants'
import { fakeResourceLease } from './helpers/resources/fakes'
import { removeFolder } from './helpers/temporaryFolders'

vi.mock('../../src/core/resources/admission', { spy: true })
vi.mock('../../src/host/backend/mcpJobLaunch', { spy: true })
vi.mock('node:child_process', { spy: true })
afterEach(() => vi.restoreAllMocks())

// Linux names the session; macOS ps has no portable session column.
const columns = process.platform === 'linux' ? ['sid', 'pgid', 'tty'] : ['pgid', 'tty']
const psArgs = columns.flatMap((column) => ['-o', `${column}=`])

function parentIdentity(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    childProcess.execFile('/bin/ps', [...psArgs, '-p', String(process.pid)], (error, stdout) => {
      if (error === null) resolve(stdout.trim().split(/\s+/u))
      else reject(new Error('ps failed', { cause: error }))
    })
  })
}

describe('explicit portable launch profiles', () => {
  it('keeps interactive login in the terminal session and observes its exit', async () => {
    const lease = fakeResourceLease()
    vi.mocked(admission.admitResource).mockResolvedValue(lease)
    const spawn = vi.spyOn(childProcess, 'spawn')
    const { child } = await spawnResourceProcess(
      'interactive',
      process.execPath,
      ['-e', 'process.exit(0)'],
      { env: process.env },
    )
    try {
      expect(spawn).toHaveBeenCalledWith(
        process.execPath,
        expect.any(Array),
        expect.objectContaining({ stdio: 'inherit', detached: false, shell: false }),
      )
      expect(child.stdin).toBeNull()
      expect(lease.register).toHaveBeenCalledWith(
        expect.objectContaining({ profile: 'interactive', stop: expect.any(Function) }),
      )
      await once(child, 'exit')
      expect(lease.complete).toHaveBeenCalledWith(true)
    } finally {
      child.kill('SIGKILL')
    }
  })

  it.runIf(process.platform !== 'win32')(
    'gives interactive login the terminal’s session, group and TTY; contained work gets its own',
    async () => {
      const folder = await mkdtemp(path.join(tmpdir(), 'l-SPAWN017C-'))
      try {
        const read = async (file: string) => {
          const text = await readFile(file, 'utf8')
          return text.trim().split(/\s+/u)
        }
        // The shell reports its own session, process group and controlling terminal.
        const probe = (file: string) => `/bin/ps ${psArgs.join(' ')} -p $$ > '${file}'`
        const parent = await parentIdentity()
        vi.mocked(admission.admitResource).mockResolvedValue(fakeResourceLease())
        const interactiveFile = path.join(folder, 'interactive')
        const interactive = await spawnResourceProcess(
          'interactive',
          '/bin/sh',
          ['-c', probe(interactiveFile)],
          { env: { PATH: '/usr/bin:/bin' } },
        )
        await once(interactive.child, 'exit')
        expect(await read(interactiveFile)).toEqual(parent)

        vi.mocked(admission.admitResource).mockResolvedValue(fakeResourceLease())
        const containedFile = path.join(folder, 'contained')
        const contained = await spawnResourceProcess(
          'contained',
          '/bin/sh',
          ['-c', probe(containedFile)],
          { env: { PATH: '/usr/bin:/bin' } },
        )
        contained.child.stdin.end()
        await once(contained.child, 'exit')
        const own = await read(containedFile)
        expect(own[columns.indexOf('pgid')]).toBe(String(contained.child.pid))
        expect(own[columns.indexOf('pgid')]).not.toBe(parent[columns.indexOf('pgid')])
        if (process.platform === 'linux') expect(own[0]).toBe(String(contained.child.pid))
      } finally {
        await removeFolder(folder)
      }
    },
  )

  it('ends this caller at its deadline while shared Windows helper preparation continues', async () => {
    const lease = fakeResourceLease()
    vi.mocked(admission.admitResource).mockResolvedValue(lease)
    const shared = Promise.withResolvers<undefined>()
    vi.mocked(admission.resourceWindowsJob).mockReturnValue(shared.promise)
    const spawn = vi.spyOn(childProcess, 'spawn')
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      const launch = spawnResourceProcess('probe', process.execPath, ['-e', ''], {
        env: {},
        signal: AbortSignal.timeout(30),
      })
      const outcome = (async () => {
        try {
          await launch
          return 'launched'
        } catch (error: unknown) {
          return error instanceof Error ? error.name : 'unknown'
        }
      })()
      // The caller settles at its 30 ms deadline while preparation is still pending.
      const early = await Promise.race([
        outcome,
        new Promise<string>((resolve) => {
          setTimeout(() => {
            resolve('still waiting')
          }, 1000)
        }),
      ])
      expect(early).toBe('TimeoutError')
      // Preparation finishes late (unavailable); nothing else follows for this caller.
      shared.resolve(undefined)
      expect(await outcome).toBe('TimeoutError')
      expect(spawn).not.toHaveBeenCalled()
      expect(lease.complete).toHaveBeenCalledWith(true)
    } finally {
      if (platform !== undefined) Object.defineProperty(process, 'platform', platform)
    }
  })

  it('skips the temp root only for a named probe, never for contained work', async () => {
    vi.mocked(admission.admitResource).mockRejectedValue(new Error('admission fixture stop'))
    const spawn = vi.spyOn(childProcess, 'spawn')
    for (const profile of ['contained', 'probe'] as const)
      await expect(
        spawnResourceProcess(profile, process.execPath, ['-e', ''], { env: {} }),
      ).rejects.toThrow('admission fixture stop')
    expect(vi.mocked(admission.admitResource).mock.calls).toEqual([
      ['other', undefined, undefined],
      ['other', undefined, undefined, undefined, undefined, true],
    ])
    expect(spawn).not.toHaveBeenCalled()
  })

  it('waits for a bounded handoff without allocating or killing a contained tree', async () => {
    const lease = fakeResourceLease()
    vi.mocked(admission.admitResource).mockResolvedValue(lease)
    const stop = vi.spyOn(admission, 'stopResourceTree')
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const spawn = vi.spyOn(childProcess, 'spawn')
    const { child } = await spawnResourceProcess(
      'handoff',
      process.execPath,
      ['-e', 'process.exit(0)'],
      { env: process.env },
    )
    child.stdin.end()
    await once(child, 'exit')
    expect(timeout).toHaveBeenCalledWith(RESOURCE_HANDOFF_TIMEOUT_MS)
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      expect.any(Array),
      expect.objectContaining({ detached: false, stdio: ['pipe', 'ignore', 'ignore'] }),
    )
    expect(stop).not.toHaveBeenCalled()
    expect(lease.complete).toHaveBeenCalledWith(true)
    expect(admission.admitResource).toHaveBeenCalledWith(
      'other',
      expect.any(AbortSignal),
      'background',
    )
  })

  it('kills only a hanging handoff root when its named deadline aborts', async () => {
    const lease = fakeResourceLease()
    vi.mocked(admission.admitResource).mockResolvedValue(lease)
    const deadline = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    const stop = vi.spyOn(admission, 'stopResourceTree')
    const { child } = await spawnResourceProcess(
      'handoff',
      process.execPath,
      ['-e', 'setInterval(()=>{},1000)'],
      { env: process.env },
    )
    try {
      const exited = once(child, 'exit')
      deadline.abort()
      await exited
      expect(child.signalCode).toBe('SIGKILL')
      expect(stop).not.toHaveBeenCalled()
    } finally {
      child.kill('SIGKILL')
    }
  })

  it('returns at the adapter’s exit while the program it opened keeps running', async () => {
    vi.mocked(admission.admitResource).mockResolvedValue(fakeResourceLease())
    const folder = await mkdtemp(path.join(tmpdir(), 'l-SPAWN017C-'))
    const marker = path.join(folder, 'browser.pid')
    let browserPid: number | undefined
    try {
      // The adapter starts a long-lived "browser" with its inherited stdio, then exits.
      const adapter = `const c=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'inherit',detached:true});require('node:fs').writeFileSync(${JSON.stringify(marker)},String(c.pid));c.unref();process.stdin.resume();process.stdin.on('end',()=>process.exit(0))`
      await expect(
        handoffResourceFile(process.execPath, ['-e', adapter], { env: process.env, input: 'x' }),
      ).resolves.toBeUndefined()
      browserPid = Number(await readFile(marker, 'utf8'))
      // Alive: signal 0 throws for a process that is gone.
      expect(() => process.kill(browserPid ?? 0, 0)).not.toThrow()
    } finally {
      if (browserPid !== undefined) process.kill(browserPid, 'SIGKILL')
      await removeFolder(folder)
    }
  })

  it('refuses a handoff the OS adapter failed', async () => {
    vi.mocked(admission.admitResource).mockResolvedValue(fakeResourceLease())
    await expect(
      handoffResourceFile(process.execPath, ['-e', 'process.exit(3)'], { env: process.env }),
    ).rejects.toThrow('Governed handoff failed')
  })
})

/** The rejection a promise settles with, or undefined when it resolves. */
async function rejectionOf(pending: Promise<unknown>): Promise<unknown> {
  try {
    await pending
    return undefined
  } catch (error: unknown) {
    return error
  }
}

const record = (changes: Partial<jobLaunch.JobRecord> = {}): jobLaunch.JobRecord => ({
  v: 1,
  ending: 'exit',
  exitCode: 0,
  emptied: true,
  cpuMs: 1500,
  peakJobMemoryBytes: 4096,
  totalProcesses: 1,
  capRefusals: 0,
  limits: [],
  activeProcessLimit: 128,
  ...changes,
})
/** `recordAfterMs`: the helper's record reaches Node that long after the launch. */
function setup(answer: jobLaunch.JobRecord | undefined, isAutoExit = false, recordAfterMs = 0) {
  const lease = { ...fakeResourceLease(), failed: vi.fn(), settle: vi.fn(), uncertain: vi.fn() }
  vi.mocked(admission.admitResource).mockResolvedValue(lease)
  const verify = vi.fn(() => Promise.resolve())
  vi.mocked(admission.resourceWindowsJob).mockResolvedValue({
    assemblyPath: 'fixture.dll',
    executablePath: 'fixture.exe',
    verify,
  })
  const child = Object.assign(new childProcess.ChildProcess(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  })
  Object.defineProperty(child, 'pid', { value: 4141 })
  const exit = (code: number) => {
    Object.defineProperty(child, 'exitCode', { value: code, configurable: true })
    child.emit('exit', code, null)
    child.stdout.end()
    child.stderr.end()
    child.emit('close', code, null)
  }
  // Module spies keep their calls across tests; each case reads only its own.
  vi.mocked(jobLaunch.spawnAttestedJob).mockClear()
  vi.mocked(jobLaunch.spawnAttestedJob).mockImplementation(() => {
    if (isAutoExit)
      setImmediate(() => {
        exit(0)
      })
    return {
      child,
      control: {
        root: Promise.resolve({ pid: 4242, startTime: '133' }),
        record: new Promise<jobLaunch.JobRecord | undefined>((resolve) => {
          setTimeout(() => {
            resolve(answer)
          }, recordAfterMs)
        }),
        stop: vi.fn(),
      },
    }
  })
  return { lease, exit, verify }
}
const asWindows = async (action: () => Promise<void>) => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  try {
    await action()
  } finally {
    if (platform !== undefined) Object.defineProperty(process, 'platform', platform)
  }
}

describe('attested Windows settlement (helper faked, any platform)', () => {
  it('proves retirement only from an emptied record', async () => {
    await asWindows(async () => {
      const { lease, exit } = setup(record())
      const launched = await spawnResourceProcess('contained', 'fixture', [], { env: {} })
      exit(0)
      expect(await launched.outcome()).toEqual({
        isRetirementProved: true,
        capRefusals: 0,
        limits: [],
      })
      expect(lease.complete).toHaveBeenCalledWith(true)
      expect(lease.uncertain).not.toHaveBeenCalled()
      expect(lease.settle).toHaveBeenCalledWith(
        expect.objectContaining({ usage: { cpuSeconds: 1.5, residentBytes: 4096 } }),
      )
    })
  })

  it.each([
    ['an undrained job (emptied: false)', record({ emptied: false })],
    ['a missing record', undefined],
  ])('takes the uncertain path for %s', async (_name, answer) => {
    await asWindows(async () => {
      const { lease, exit } = setup(answer)
      const launched = await spawnResourceProcess('contained', 'fixture', [], { env: {} })
      exit(0)
      expect(await launched.outcome()).toEqual({
        isRetirementProved: false,
        capRefusals: 0,
        limits: [],
      })
      expect(lease.uncertain).toHaveBeenCalledOnce()
      expect(lease.complete).not.toHaveBeenCalledWith(true)
      expect(lease.settle).toHaveBeenCalledWith(expect.objectContaining({ usage: null }))
    })
  })

  it('signals a cap refusal, typed, even when the root exits 0', async () => {
    await asWindows(async () => {
      const { lease } = setup(record({ capRefusals: 1, limits: ['activeProcess'] }), true)
      const failure = await rejectionOf(
        execResourceFile('contained', process.execPath, ['-v'], {
          encoding: 'utf8',
          env: {},
        }),
      )
      expect(isResourceCapRefused(failure)).toBe(true)
      expect(failure).toMatchObject({ refusals: 1 })
      expect(lease.failed).toHaveBeenCalled()
    })
  })

  it('reports an enforced job memory limit as a typed memory cap', async () => {
    await asWindows(async () => {
      const { lease } = setup(record({ exitCode: 134, limits: ['jobMemory'] }), true)
      const failure = await rejectionOf(
        execResourceFile('contained', process.execPath, ['-v'], {
          encoding: 'utf8',
          env: {},
        }),
      )
      expect(isResourceMemoryLimit(failure)).toBe(true)
      expect(failure).toMatchObject({ limit: 'jobMemory' })
      expect(lease.failed).toHaveBeenCalled()
    })
  })

  it('returns from stop only after the settlement retired the tree', async () => {
    await asWindows(async () => {
      // The record is read off the pipe after the helper's exit event.
      const { lease, exit } = setup(record(), false, 50)
      const launched = await spawnResourceProcess('contained', 'fixture', [], { env: {} })
      const launch = vi.mocked(jobLaunch.spawnAttestedJob).mock.results.at(-1)
      if (launch?.type !== 'return') throw new Error('attested launch missing')
      // The helper answers STOP by draining the job and exiting a moment later.
      vi.mocked(launch.value.control.stop).mockImplementation(() => {
        setImmediate(() => {
          exit(5)
        })
      })
      await launched.stop()
      // A dispatched STOP is not completion: the emptied record was settled first.
      expect(launch.value.control.stop).toHaveBeenCalledOnce()
      expect(lease.complete).toHaveBeenCalledWith(true)
    })
  })

  it('hands a memory cap to the attested job only', async () => {
    await asWindows(async () => {
      setup(record(), true)
      const launched = await spawnResourceProcess('contained', 'fixture', [], {
        env: {},
        jobMemoryBytes: 64 * 1024 * 1024,
      })
      await launched.outcome()
      expect(jobLaunch.spawnAttestedJob).toHaveBeenCalledWith(
        expect.objectContaining({ jobMemoryLimit: 64 * 1024 * 1024 }),
      )
    })
  })

  it('refuses a changed helper before launching it', async () => {
    await asWindows(async () => {
      const { lease, verify } = setup(record())
      verify.mockRejectedValueOnce(new ResourceHelperChangedError())
      const failure = await rejectionOf(
        spawnResourceProcess('contained', 'fixture', [], { env: {} }),
      )
      expect(isResourceHelperChanged(failure)).toBe(true)
      expect(jobLaunch.spawnAttestedJob).not.toHaveBeenCalled()
      expect(lease.complete).toHaveBeenCalledWith(true)
    })
  })
})
