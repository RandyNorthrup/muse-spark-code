import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { macRssSampler, RssSampleRefused } from '../../src/core/media/macRss'
import type { ResourceTreeRun } from '../../src/core/resources/trees/run'
import {
  MEDIA_RSS_SAMPLE_INTERVAL_MS,
  MEDIA_RSS_SAMPLE_MAX_AGE_MS,
} from '../../src/shared/constants'

const PID = 4242
const PARENT = 777
const KIB = 1024
const MIB = KIB * KIB
const row = (fields: Partial<Record<'pid' | 'ppid' | 'state' | 'rss', string>> = {}) =>
  `${fields.pid ?? String(PID)} ${fields.ppid ?? String(PARENT)} ${String(PARENT)} ${fields.state ?? 'S'} 0:01.25 ${fields.rss ?? '2048'}\n`

function clock(start = 1000) {
  let time = start
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms
    },
  }
}

function deferred() {
  return Promise.withResolvers<string>()
}

describe('macRssSampler', () => {
  it('reads one PID through the absolute /bin/ps and its numeric columns', async () => {
    const run = vi.fn<ResourceTreeRun>(() => Promise.resolve(row()))
    const read = macRssSampler({ run, parentPid: PARENT })
    await expect(read(PID)).resolves.toBe(2 * MIB)
    expect(run).toHaveBeenCalledWith('/bin/ps', [
      '-o',
      'pid=,ppid=,pgid=,state=,time=,rss=',
      '-p',
      String(PID),
    ])
  })

  it.each([
    ['a failed ps run (missing or reaped PID)', () => Promise.reject(new Error('exit 1'))],
    ['empty output', () => Promise.resolve('')],
    ['malformed output', () => Promise.resolve('not a process row\n')],
    ['two rows', () => Promise.resolve(row() + row())],
    ['another PID', () => Promise.resolve(row({ pid: '4243' }))],
    ['a reused PID under another parent', () => Promise.resolve(row({ ppid: '1' }))],
    ['a zombie', () => Promise.resolve(row({ state: 'Z' }))],
    ['zero resident memory', () => Promise.resolve(row({ rss: '0' }))],
  ] as const)('refuses %s and never answers 0', async (_label, output) => {
    const read = macRssSampler({ run: vi.fn<ResourceTreeRun>(output), parentPid: PARENT })
    const reading = read(PID)
    await expect(reading).rejects.toBeInstanceOf(RssSampleRefused)
    await expect(reading).rejects.toMatchObject({ code: 'EMEDIA_RSS_UNAVAILABLE' })
  })

  it.each([0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 2])(
    'refuses the PID %d without running ps',
    async (pid) => {
      const run = vi.fn<ResourceTreeRun>(() => Promise.resolve(row()))
      await expect(macRssSampler({ run })(pid)).rejects.toBeInstanceOf(RssSampleRefused)
      expect(run).not.toHaveBeenCalled()
    },
  )

  it('keeps a failure final for the PID it watches', async () => {
    const time = clock()
    const run = vi.fn<ResourceTreeRun>(() => Promise.reject(new Error('exit 1')))
    const read = macRssSampler({ run, parentPid: PARENT, now: time.now })
    await expect(read(PID)).rejects.toBeInstanceOf(RssSampleRefused)
    run.mockImplementation(() => Promise.resolve(row()))
    time.advance(MEDIA_RSS_SAMPLE_INTERVAL_MS)
    await expect(read(PID)).rejects.toBeInstanceOf(RssSampleRefused)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('forgets a PID nobody asked about for longer than a reading lives', async () => {
    const time = clock()
    const run = vi.fn<ResourceTreeRun>(() => Promise.reject(new Error('exit 1')))
    const read = macRssSampler({ run, parentPid: PARENT, now: time.now })
    await expect(read(PID)).rejects.toBeInstanceOf(RssSampleRefused)
    time.advance(MEDIA_RSS_SAMPLE_MAX_AGE_MS + 1)
    run.mockImplementation(() => Promise.resolve(row()))
    await expect(read(PID)).resolves.toBe(2 * MIB)
  })

  it('runs ps at most once per interval and refreshes before the reading expires', async () => {
    const time = clock()
    const runs: ReturnType<typeof deferred>[] = []
    const run = vi.fn<ResourceTreeRun>(() => {
      const next = deferred()
      runs.push(next)
      return next.promise
    })
    const read = macRssSampler({ run, parentPid: PARENT, now: time.now })
    const first = read(PID)
    runs[0]?.resolve(row())
    await expect(first).resolves.toBe(2 * MIB)
    for (let step = 0; step < 4; step += 1) {
      time.advance(MEDIA_RSS_SAMPLE_INTERVAL_MS / 5)
      await expect(read(PID)).resolves.toBe(2 * MIB)
    }
    expect(run).toHaveBeenCalledTimes(1)
    // Past the interval: a fresh run starts and the still-young reading answers.
    time.advance(MEDIA_RSS_SAMPLE_INTERVAL_MS / 5)
    await expect(read(PID)).resolves.toBe(2 * MIB)
    expect(run).toHaveBeenCalledTimes(2)
    await expect(read(PID)).resolves.toBe(2 * MIB)
    expect(run).toHaveBeenCalledTimes(2)
    runs[1]?.resolve(row({ rss: '4096' }))
    await vi.waitFor(async () => {
      await expect(read(PID)).resolves.toBe(4 * MIB)
    })
  })

  it('waits for a fresh reading past the maximum age and refuses a late one', async () => {
    const time = clock()
    const runs: ReturnType<typeof deferred>[] = []
    const run = vi.fn<ResourceTreeRun>(() => {
      const next = deferred()
      runs.push(next)
      return next.promise
    })
    const read = macRssSampler({ run, parentPid: PARENT, now: time.now })
    const first = read(PID)
    runs[0]?.resolve(row())
    await first
    time.advance(MEDIA_RSS_SAMPLE_MAX_AGE_MS)
    let isSettled = false
    const waiting = (async () => {
      try {
        return await read(PID)
      } finally {
        isSettled = true
      }
    })()
    await Promise.resolve()
    expect(isSettled).toBe(false)
    expect(run).toHaveBeenCalledTimes(2)
    // The run finished, but only after its reading would already have expired.
    time.advance(MEDIA_RSS_SAMPLE_MAX_AGE_MS)
    runs[1]?.resolve(row())
    await expect(waiting).rejects.toBeInstanceOf(RssSampleRefused)
  })
})

describe.skipIf(process.platform === 'win32')('macRssSampler on the real /bin/ps', () => {
  const children: ReturnType<typeof spawn>[] = []
  afterEach(async () => {
    for (const child of children.splice(0)) {
      if (child.exitCode !== null || child.signalCode !== null) continue
      const closed = once(child, 'close')
      child.kill('SIGKILL')
      await closed
    }
  })

  it('reads a live child encoder’s resident memory', async () => {
    // Sampled once Node is running in it: right after exec the image is barely mapped.
    const child = spawn(
      process.execPath,
      ['-e', "process.stdout.write('ready'); setInterval(() => {}, 1000)"],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
    children.push(child)
    await once(child.stdout, 'data')
    if (child.pid === undefined) throw new Error('the child has no PID')
    const bytes = await macRssSampler()(child.pid)
    expect(Number.isSafeInteger(bytes)).toBe(true)
    expect(bytes).toBeGreaterThan(MIB)
  })

  it('refuses a reaped child rather than answering 0', async () => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
    await once(child, 'close')
    if (child.pid === undefined) throw new Error('the child has no PID')
    await expect(macRssSampler()(child.pid)).rejects.toBeInstanceOf(RssSampleRefused)
  })

  it('refuses a live process that is not this process’s child', async () => {
    await expect(macRssSampler()(process.ppid)).rejects.toBeInstanceOf(RssSampleRefused)
    await expect(macRssSampler({ parentPid: process.ppid })(process.pid)).resolves.toBeGreaterThan(
      MIB,
    )
  })
})
