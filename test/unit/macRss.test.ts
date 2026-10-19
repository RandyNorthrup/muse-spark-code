import { spawn } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
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
const STARTED = 'Thu Oct  8 21:01:05 2026'
type RowField = 'pid' | 'ppid' | 'state' | 'rss' | 'started'
const row = (fields: Partial<Record<RowField, string>> = {}) =>
  `${fields.pid ?? String(PID)} ${fields.ppid ?? String(PARENT)} ${String(PARENT)} ${fields.state ?? 'S'} 0:01.25 ${fields.rss ?? '2048'} ${fields.started ?? STARTED}\n`

/** The encoder's handle: its PID (`null`: none), and its exit as Node reports it. */
function fakeChild(pid: number | null = PID) {
  const events = new EventEmitter()
  const child = {
    pid: pid ?? undefined,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    once: (event: 'exit', listener: () => void) => events.once(event, listener),
    exit: () => {
      child.exitCode = 0
      events.emit('exit')
    },
  }
  return child
}

function clock() {
  let time = 1000
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

/** A ps runner that records its calls and answers through the given body. */
function recordingRun(body: () => Promise<string>) {
  const calls: (readonly [string, readonly string[]])[] = []
  const run: ResourceTreeRun = (file, args) => {
    calls.push([file, args])
    return body()
  }
  return { run, calls }
}

/** A sampler whose ps runs settle only when the test says; the first has answered 2 MiB. */
async function withHeldRuns() {
  const time = clock()
  const child = fakeChild()
  const runs: ReturnType<typeof deferred>[] = []
  const { run, calls } = recordingRun(() => {
    const next = deferred()
    runs.push(next)
    return next.promise
  })
  const read = macRssSampler(child, { run, parentPid: PARENT, now: time.now })
  const first = read(PID)
  runs[0]?.resolve(row())
  await expect(first).resolves.toBe(2 * MIB)
  return { time, child, runs, calls, read }
}

describe('macRssSampler', () => {
  it('reads its child through the absolute /bin/ps, numeric columns and start time', async () => {
    const { run, calls } = recordingRun(() => Promise.resolve(row()))
    const read = macRssSampler(fakeChild(), { run, parentPid: PARENT })
    await expect(read(PID)).resolves.toBe(2 * MIB)
    expect(calls).toEqual([
      ['/bin/ps', ['-o', 'pid=,ppid=,pgid=,state=,time=,rss=,lstart=', '-p', String(PID)]],
    ])
  })

  it.each([
    ['a failed ps run (missing or reaped PID)', () => Promise.reject(new Error('exit 1'))],
    ['empty output', () => Promise.resolve('')],
    ['malformed output', () => Promise.resolve('not a process row\n')],
    ['a row without its start time', () => Promise.resolve(row({ started: '' }))],
    ['a malformed start time', () => Promise.resolve(row({ started: 'yesterday' }))],
    ['two rows', () => Promise.resolve(row() + row())],
    ['another PID', () => Promise.resolve(row({ pid: '4243' }))],
    ['a reused PID under another parent', () => Promise.resolve(row({ ppid: '1' }))],
    ['a zombie', () => Promise.resolve(row({ state: 'Z' }))],
    ['zero resident memory', () => Promise.resolve(row({ rss: '0' }))],
  ] as const)('refuses %s and never answers 0', async (_label, output) => {
    const read = macRssSampler(fakeChild(), {
      run: output,
      parentPid: PARENT,
    })
    const reading = read(PID)
    await expect(reading).rejects.toBeInstanceOf(RssSampleRefused)
    await expect(reading).rejects.toMatchObject({ code: 'EMEDIA_RSS_UNAVAILABLE' })
  })

  it.each([0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 2, PID + 1])(
    'refuses the PID %d, which is not its child’s, without running ps',
    async (pid) => {
      const { run, calls } = recordingRun(() => Promise.resolve(row()))
      await expect(macRssSampler(fakeChild(), { run })(pid)).rejects.toBeInstanceOf(
        RssSampleRefused,
      )
      expect(calls).toHaveLength(0)
    },
  )

  it('refuses a child without a PID and one that had already exited', async () => {
    const { run, calls } = recordingRun(() => Promise.resolve(row()))
    await expect(macRssSampler(fakeChild(null), { run })(PID)).rejects.toBeInstanceOf(
      RssSampleRefused,
    )
    const exited = fakeChild()
    exited.exitCode = 1
    await expect(macRssSampler(exited, { run })(PID)).rejects.toBeInstanceOf(RssSampleRefused)
    expect(calls).toHaveLength(0)
  })

  it('keeps a failure final for the child it watches', async () => {
    const time = clock()
    let shouldFail = true
    const { run, calls } = recordingRun(() =>
      shouldFail ? Promise.reject(new Error('exit 1')) : Promise.resolve(row()),
    )
    const read = macRssSampler(fakeChild(), { run, parentPid: PARENT, now: time.now })
    await expect(read(PID)).rejects.toBeInstanceOf(RssSampleRefused)
    shouldFail = false
    time.advance(MEDIA_RSS_SAMPLE_MAX_AGE_MS + 1)
    await expect(read(PID)).rejects.toBeInstanceOf(RssSampleRefused)
    expect(calls).toHaveLength(1)
  })

  it('drops its reading when the child exits, even inside the refresh interval', async () => {
    const { child, calls, read } = await withHeldRuns()
    child.exit()
    await expect(read(PID)).rejects.toMatchObject({ code: 'EMEDIA_RSS_UNAVAILABLE' })
    expect(calls).toHaveLength(1)
  })

  it('refuses a run that finished after the child exited', async () => {
    const { time, child, runs, read } = await withHeldRuns()
    time.advance(MEDIA_RSS_SAMPLE_MAX_AGE_MS)
    const waiting = read(PID)
    child.exit()
    runs[1]?.resolve(row())
    await expect(waiting).rejects.toBeInstanceOf(RssSampleRefused)
  })

  it('refuses a PID reused under the same parent: its start time differs', async () => {
    const { time, runs, read } = await withHeldRuns()
    time.advance(MEDIA_RSS_SAMPLE_MAX_AGE_MS)
    const waiting = read(PID)
    runs[1]?.resolve(row({ started: 'Thu Oct  8 21:01:06 2026' }))
    await expect(waiting).rejects.toBeInstanceOf(RssSampleRefused)
  })

  it('runs ps at most once per interval and refreshes before the reading expires', async () => {
    const { time, runs, calls, read } = await withHeldRuns()
    for (let step = 0; step < 4; step += 1) {
      time.advance(MEDIA_RSS_SAMPLE_INTERVAL_MS / 5)
      await expect(read(PID)).resolves.toBe(2 * MIB)
    }
    expect(calls).toHaveLength(1)
    // Past the interval: a fresh run starts and the still-young reading answers.
    time.advance(MEDIA_RSS_SAMPLE_INTERVAL_MS / 5)
    await expect(read(PID)).resolves.toBe(2 * MIB)
    expect(calls).toHaveLength(2)
    await expect(read(PID)).resolves.toBe(2 * MIB)
    expect(calls).toHaveLength(2)
    runs[1]?.resolve(row({ rss: '4096' }))
    // The refresh lands on a later microtask turn; poll the real sampler.
    let refreshed = 0
    for (let attempt = 0; attempt < 50 && refreshed !== 4 * MIB; attempt += 1) {
      refreshed = await read(PID)
    }
    expect(refreshed).toBe(4 * MIB)
  })

  it('waits for a fresh reading past the maximum age and refuses a late one', async () => {
    const { time, runs, calls, read } = await withHeldRuns()
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
    expect(calls).toHaveLength(2)
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

  /** A live Node child, sampled once it runs: right after exec the image is barely mapped. */
  async function liveChild() {
    const child = spawn(
      process.execPath,
      ['-e', "process.stdout.write('ready'); setInterval(() => {}, 1000)"],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
    children.push(child)
    await once(child.stdout, 'data')
    if (child.pid === undefined) throw new Error('the child has no PID')
    return { child, pid: child.pid }
  }

  it('reads a live child encoder’s resident memory', async () => {
    const { child, pid } = await liveChild()
    const bytes = await macRssSampler(child)(pid)
    expect(Number.isSafeInteger(bytes)).toBe(true)
    expect(bytes).toBeGreaterThan(MIB)
  })

  it('a warm sampler refuses its child once it is killed and closed', async () => {
    const { child, pid } = await liveChild()
    const read = macRssSampler(child)
    await expect(read(pid)).resolves.toBeGreaterThan(MIB)
    const closed = once(child, 'close')
    child.kill('SIGKILL')
    await closed
    // Well inside the refresh interval: no ps run, and still no stale answer.
    await expect(read(pid)).rejects.toMatchObject({ code: 'EMEDIA_RSS_UNAVAILABLE' })
  })

  it('refuses a live process that is not this process’s child', async () => {
    const parent = fakeChild(process.ppid)
    await expect(macRssSampler(parent)(process.ppid)).rejects.toBeInstanceOf(RssSampleRefused)
    const self = fakeChild(process.pid)
    await expect(
      macRssSampler(self, { parentPid: process.ppid })(process.pid),
    ).resolves.toBeGreaterThan(MIB)
  })
})
