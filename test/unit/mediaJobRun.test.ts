import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { McpJobLaunch } from '../../src/host/backend/mcpJobLaunch'
import {
  ConversionJobFailed,
  conversionJobFailure,
  jobMemoryLimitedRun,
  type JobEncoderRunOptions,
  type OutputStat,
} from '../../src/host/backend/mediaJobRun'
import { fixtureJobLifecycle } from './helpers/jobLifecycle'
import { expectEnded, isRunning, markedPid } from './helpers/processes'
import { removeFolder } from './helpers/temporaryFolders'

const KIB = 1024
const MIB = KIB * KIB
const EXECUTABLE = String.raw`C:\Users\someone\storage\MuseSparkMcpJob-abc.exe`
const CAP = 256 * MIB
const OUTPUT_CAP = 64 * KIB
const DEADLINE_MS = 20_000
const FAILED = { code: 'EMEDIA_JOB_FAILED' }

const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) await removeFolder(folder)
})

async function workspace(): Promise<{ cwd: string; output: string; marker: string }> {
  const cwd = await fs.mkdtemp(path.join(tmpdir(), 'muse-vb-job-test-'))
  folders.push(cwd)
  const output = path.join(cwd, 'converted.wav')
  await fs.writeFile(output, '')
  return { cwd, output, marker: path.join(cwd, 'pid') }
}

/** The encoder's minimal environment: this Node and, on Windows, its system root. */
function encoderEnv(): NodeJS.ProcessEnv {
  return {
    PATH: path.dirname(process.execPath),
    ...(process.env['SystemRoot'] !== undefined && { SystemRoot: process.env['SystemRoot'] }),
  }
}

function options(
  where: { cwd: string; output: string },
  overrides: Partial<JobEncoderRunOptions> = {},
): JobEncoderRunOptions {
  return {
    cwd: where.cwd,
    env: encoderEnv(),
    timeoutMs: DEADLINE_MS,
    outputPath: where.output,
    maxOutputBytes: OUTPUT_CAP,
    maxRssBytes: CAP,
    ...overrides,
  }
}

type Ending = 'exit0' | 'exit3' | 'hang'

/** A Node stand-in encoder: writes `bytes` of output and its PID, then ends as told. */
function encoder(
  where: { output: string; marker: string },
  bytes: number,
  ending: Ending,
  allocateMib = 0,
): readonly string[] {
  const end = {
    exit0: 'process.exitCode = 0',
    exit3: 'process.exitCode = 3',
    hang: 'setInterval(() => {}, 1000)',
  }[ending]
  return [
    '-e',
    [
      `const fs = require('node:fs')`,
      `fs.writeFileSync(${JSON.stringify(where.marker)}, String(process.pid))`,
      allocateMib > 0 ? `const held = Buffer.alloc(${String(allocateMib)} * 1024 * 1024, 1)` : '',
      `fs.writeFileSync(${JSON.stringify(where.output)}, Buffer.alloc(${String(bytes)}, 1))`,
      end,
    ].join('\n'),
  ]
}

/** An output stat on a stalled share: it never answers. */
function stalled(): Promise<OutputStat> {
  return new Promise<OutputStat>(() => {
    // Never settles.
  })
}

/** The encoder itself, with no job, recording each launch and its child. */
function directLauncher() {
  const calls: McpJobLaunch[] = []
  const children: ReturnType<typeof spawn>[] = []
  const spawnJob = (launch: McpJobLaunch) => {
    calls.push(launch)
    const child = spawn(launch.file, [...launch.args], {
      cwd: launch.cwd,
      env: launch.env,
      stdio: 'pipe',
      windowsHide: true,
    })
    children.push(child)
    return child
  }
  return { spawnJob, calls, children }
}

/** One direct (jobless) encoder run through the real bounded runner. */
function directRun(
  where: { cwd: string; output: string; marker: string },
  bytes: number,
  ending: Ending,
  overrides: Partial<JobEncoderRunOptions> = {},
) {
  return jobMemoryLimitedRun({
    jobExecutable: () => Promise.resolve(EXECUTABLE),
    spawnJob: directLauncher().spawnJob,
  })(process.execPath, encoder(where, bytes, ending), options(where, overrides))
}

describe('jobMemoryLimitedRun', () => {
  it('starts the encoder through the job launcher with the memory cap as the job limit', async () => {
    const where = await workspace()
    const { spawnJob, calls: spawnCalls } = directLauncher()
    const run = jobMemoryLimitedRun({ jobExecutable: () => Promise.resolve(EXECUTABLE), spawnJob })
    const args = encoder(where, KIB, 'exit0')
    const env = encoderEnv()
    await run(process.execPath, args, options(where, { env }))
    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0]).toMatchObject({
      executablePath: EXECUTABLE,
      file: process.execPath,
      args,
      isVerbatim: false,
      cwd: where.cwd,
      env,
      jobMemoryLimit: CAP,
    })
    const converted = await fs.stat(where.output)
    expect(converted.size).toBe(KIB)
  })

  it.each<[string, Partial<JobEncoderRunOptions> & { command?: string }]>([
    ['a zero memory cap (no limit at all)', { maxRssBytes: 0 }],
    ['a negative memory cap', { maxRssBytes: -1 }],
    ['a fractional memory cap', { maxRssBytes: 1.5 }],
    ['a memory cap past the safe integers', { maxRssBytes: Number.MAX_SAFE_INTEGER + 2 }],
    ['no output allowance', { maxOutputBytes: 0 }],
    ['no deadline', { timeoutMs: 0 }],
    ['a relative encoder', { command: 'ffmpeg.exe' }],
    ['a relative folder', { cwd: 'media' }],
  ])('refuses %s before preparing or starting anything', async (_label, overrides) => {
    const where = await workspace()
    const { spawnJob, calls: spawnCalls } = directLauncher()
    const preparedPaths: string[] = []
    const jobExecutable = () => {
      preparedPaths.push(EXECUTABLE)
      return Promise.resolve(EXECUTABLE)
    }
    const { command = process.execPath, ...rest } = overrides
    const starting = jobMemoryLimitedRun({ jobExecutable, spawnJob })(
      command,
      encoder(where, KIB, 'exit0'),
      options(where, rest),
    )
    await expect(starting).rejects.toBeInstanceOf(ConversionJobFailed)
    await expect(starting).rejects.toMatchObject(FAILED)
    expect(preparedPaths).toHaveLength(0)
    expect(spawnCalls).toHaveLength(0)
  })

  it.each([
    ['no launcher on this machine', () => Promise.resolve(undefined)],
    ['a failed launcher preparation', () => Promise.reject(new Error(String.raw`C:\private\csc`))],
  ])('refuses %s and never starts the encoder unbounded', async (_label, jobExecutable) => {
    const where = await workspace()
    const { spawnJob, calls: spawnCalls } = directLauncher()
    const starting = jobMemoryLimitedRun({ jobExecutable, spawnJob })(
      process.execPath,
      encoder(where, KIB, 'exit0'),
      options(where),
    )
    await expect(starting).rejects.toMatchObject(FAILED)
    await expect(starting).rejects.not.toThrow(/private|csc/u)
    expect(spawnCalls).toHaveLength(0)
  })

  it.each([
    ['before it is prepared', 0],
    ['while the launcher is prepared', 1],
  ] as const)('refuses a conversion cancelled %s, never starting it', async (_moment, prepared) => {
    const where = await workspace()
    const { spawnJob, calls: spawnCalls } = directLauncher()
    const stop = new AbortController()
    if (prepared === 0) stop.abort()
    const preparations: string[] = []
    const jobExecutable = () => {
      preparations.push(EXECUTABLE)
      stop.abort()
      return Promise.resolve(EXECUTABLE)
    }
    await expect(
      jobMemoryLimitedRun({ jobExecutable, spawnJob })(
        process.execPath,
        encoder(where, KIB, 'exit0'),
        options(where, { signal: stop.signal }),
      ),
    ).rejects.toMatchObject(FAILED)
    expect(preparations).toHaveLength(prepared)
    expect(spawnCalls).toHaveLength(0)
  })

  it.each([
    ['a running encoder', 'hang'],
    ['an encoder that exits cleanly', 'exit0'],
  ] as const)(
    'settles %s whose output stat never answers (a stalled share)',
    async (_label, ending) => {
      const where = await workspace()
      const { spawnJob, children: spawnChildren } = directLauncher()
      const statCalls: true[] = []
      const statOutput = () => {
        statCalls.push(true)
        return stalled()
      }
      const running = jobMemoryLimitedRun({
        jobExecutable: () => Promise.resolve(EXECUTABLE),
        spawnJob,
        statOutput,
      })(process.execPath, encoder(where, KIB, ending), options(where))
      await expect(running).rejects.toMatchObject(FAILED)
      expect(statCalls.length).toBeGreaterThan(0)
      // The bounded sample may end the child before its Node script writes
      // the marker. The actual spawn handle still identifies the owned PID.
      const child = spawnChildren[0]
      if (child?.pid === undefined) throw new Error('Expected the owned encoder PID')
      await expectEnded(child.pid)
    },
  )

  it('fails a launcher that cannot start, or one that throws', async () => {
    const where = await workspace()
    const missing = jobMemoryLimitedRun({
      jobExecutable: () => Promise.resolve(EXECUTABLE),
      spawnJob: (launch) =>
        spawn(path.join(where.cwd, 'missing-launcher.exe'), [], { cwd: launch.cwd, stdio: 'pipe' }),
    })
    await expect(missing(process.execPath, [], options(where))).rejects.toMatchObject(FAILED)
    const throwing = jobMemoryLimitedRun({
      jobExecutable: () => Promise.resolve(EXECUTABLE),
      spawnJob: () => {
        throw new Error('synthetic spawn failure')
      },
    })
    await expect(throwing(process.execPath, [], options(where))).rejects.toMatchObject(FAILED)
  })

  it('fails a non-zero exit as a plain job failure (the memory cap included, until M109)', async () => {
    const where = await workspace()
    await expect(directRun(where, KIB, 'exit3')).rejects.toMatchObject(FAILED)
  })

  it('stops an encoder whose output passes the cap', async () => {
    const where = await workspace()
    const running = directRun(where, OUTPUT_CAP + 1, 'hang')
    await expect(running).rejects.toMatchObject(FAILED)
    await expectEnded(await markedPid(where.marker))
  })

  it('fails a clean exit whose final output is over the cap', async () => {
    const where = await workspace()
    await expect(directRun(where, OUTPUT_CAP + 1, 'exit0')).rejects.toMatchObject(FAILED)
  })

  it('stops the encoder at its deadline', async () => {
    const where = await workspace()
    const running = directRun(where, KIB, 'hang', { timeoutMs: 3000 })
    const pid = await markedPid(where.marker)
    await expect(running).rejects.toMatchObject(FAILED)
    await expectEnded(pid)
  }, 20_000)

  it('stops the encoder when the conversion is cancelled', async () => {
    const where = await workspace()
    const stop = new AbortController()
    const running = directRun(where, KIB, 'hang', { signal: stop.signal })
    const pid = await markedPid(where.marker)
    expect(isRunning(pid)).toBe(true)
    stop.abort()
    await expect(running).rejects.toMatchObject(FAILED)
    await expectEnded(pid)
  })
})

describe('conversionJobFailure (the M109 seam)', () => {
  it('names the memory cap only when the job record says the kernel enforced it', () => {
    expect(conversionJobFailure(['jobMemory'])).toMatchObject({ code: 'EMEDIA_MEMORY_CAP' })
    expect(conversionJobFailure(['activeProcess', 'jobMemory'])).toMatchObject({
      code: 'EMEDIA_MEMORY_CAP',
    })
    for (const limits of [[], ['activeProcess'], ['processMemory']] as const)
      expect(conversionJobFailure(limits)).toMatchObject(FAILED)
  })

  it('carries a fixed message, never a path or OS output', () => {
    for (const limits of [[], ['jobMemory']] as const) {
      const failure = conversionJobFailure(limits)
      expect(failure).toBeInstanceOf(ConversionJobFailed)
      expect(failure.message).not.toMatch(/[\\/:]/u)
    }
  })
})

describe.runIf(process.platform === 'win32')('jobMemoryLimitedRun in a real Windows job', () => {
  const job = fixtureJobLifecycle()
  beforeAll(job.setup, 120_000)
  afterAll(job.dispose)
  const jobExecutable = () => Promise.resolve(job.path)

  it('runs the encoder inside the job and keeps its output', async () => {
    const where = await workspace()
    await jobMemoryLimitedRun({ jobExecutable })(
      process.execPath,
      encoder(where, KIB, 'exit0'),
      options(where),
    )
    const converted = await fs.stat(where.output)
    expect(converted.size).toBe(KIB)
  }, 60_000)

  it('the kernel cap fails an encoder that commits past it, and only past it', async () => {
    const where = await workspace()
    const run = jobMemoryLimitedRun({ jobExecutable })
    const args = encoder(where, KIB, 'exit0', 384)
    await expect(run(process.execPath, args, options(where))).rejects.toMatchObject(FAILED)
    await expect(
      run(process.execPath, args, options(where, { maxRssBytes: 1024 * MIB })),
    ).resolves.toBeUndefined()
  }, 60_000)

  it('the deadline ends the encoder and everything it started', async () => {
    const where = await workspace()
    const worker = path.join(where.cwd, 'worker')
    const running = jobMemoryLimitedRun({ jobExecutable })(
      process.execPath,
      [
        '-e',
        [
          `const fs = require('node:fs')`,
          `const { spawn } = require('node:child_process')`,
          `const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: true, windowsHide: true })`,
          `child.unref()`,
          `fs.writeFileSync(${JSON.stringify(worker)}, String(child.pid))`,
          `fs.writeFileSync(${JSON.stringify(where.marker)}, String(process.pid))`,
          `setInterval(() => {}, 1000)`,
        ].join('\n'),
      ],
      options(where, { timeoutMs: 4000 }),
    )
    const [encoderPid, workerPid] = [await markedPid(where.marker), await markedPid(worker)]
    await expect(running).rejects.toMatchObject(FAILED)
    await expectEnded(encoderPid)
    await expectEnded(workerPid)
  }, 60_000)

  it('stops an encoder whose output passes the cap', async () => {
    const where = await workspace()
    const running = jobMemoryLimitedRun({ jobExecutable })(
      process.execPath,
      encoder(where, OUTPUT_CAP + 1, 'hang'),
      options(where),
    )
    await expect(running).rejects.toMatchObject(FAILED)
    await expectEnded(await markedPid(where.marker))
  }, 60_000)
})
