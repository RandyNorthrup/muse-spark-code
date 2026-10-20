import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { macRssSampler, RssSampleRefused } from '../../src/core/media/macRss'
import { boundedTreeProgram, type ResourceTreeRun } from '../../src/core/resources/trees/run'
import { parseMacProcessTable, readMacProcess } from '../../src/core/resources/trees/posixTable'
import {
  MEDIA_RSS_SAMPLE_INTERVAL_MS,
  MEDIA_RSS_SAMPLE_MAX_AGE_MS,
  MEDIA_RSS_SAMPLE_MAX_BYTES,
  MEDIA_RSS_SAMPLE_RUN_TIMEOUT_MS,
} from '../../src/shared/constants'

const KIB = 1024
const MIB = KIB * KIB
const STARTED = 'Thu Oct  8 21:01:05 2026'
/** A program name no PATH entry provides, so the spawn really never starts. */
const MISSING_PROGRAM = 'muse-spark-definitely-missing-binary-xyz'
/** A PID above Linux's pid_max, so the real /bin/ps really exits 1 for it. */
const MISSING_PID = 2_147_483_647

type RowField = 'pid' | 'ppid' | 'pgid' | 'state' | 'time' | 'rss' | 'started'
/** Literal ps-row text for the pure parser: feeding a parser text is not a stand-in. */
const columns = (fields: Partial<Record<RowField, string>> = {}) =>
  `${fields.pid ?? '4242'} ${fields.ppid ?? '777'} ${fields.pgid ?? '777'} ${fields.state ?? 'S'} ${fields.time ?? '0:01.25'} ${fields.rss ?? '2048'}`
function row(fields: Partial<Record<RowField, string>> = {}): string {
  const started = fields.started === '' ? '' : ` ${fields.started ?? STARTED}`
  return `${columns(fields)}${started}\n`
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

/** The production ps runner: the real /bin/ps, bounded as conversion bounds it. */
const realRun: ResourceTreeRun = boundedTreeProgram(
  MEDIA_RSS_SAMPLE_RUN_TIMEOUT_MS,
  MEDIA_RSS_SAMPLE_MAX_BYTES,
)

/** A wrapper that forwards to the real runner and only records what it did. */
function countingRun() {
  const calls: (readonly [string, readonly string[]])[] = []
  const run: ResourceTreeRun = (file, args) => {
    calls.push([file, args])
    return realRun(file, args)
  }
  return { run, calls }
}

/**
A wrapper that forwards to the real runner once released, so a ps run can
be held in flight while the test arranges what it must outlive (a kill).
Every byte the sampler parses still comes from the real /bin/ps.
*/
function gatedRun() {
  const calls: (readonly [string, readonly string[]])[] = []
  let gate = Promise.withResolvers<undefined>()
  gate.resolve(undefined)
  const run: ResourceTreeRun = async (file, args) => {
    calls.push([file, args])
    await gate.promise
    return await realRun(file, args)
  }
  return {
    run,
    calls,
    hold: () => {
      gate = Promise.withResolvers<undefined>()
    },
    release: () => {
      gate.resolve(undefined)
    },
  }
}

interface TrackedChild {
  readonly child: ChildProcess
  /** Resolves when the child closes; registered at spawn, so it can never be missed. */
  readonly closed: Promise<unknown>
  readonly errors: unknown[]
}
const tracked: TrackedChild[] = []
afterEach(async () => {
  for (const { child, closed } of tracked.splice(0)) {
    // Only a live child of ours is ever signalled: a child that never
    // started, or one already reaped, is left alone.
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await closed
  }
})

/**
A real spawn, tracked from birth: the close waiter and the error listener
attach synchronously, so neither a fast exit nor a failed start is missed.
Never await a spawn-gated event the caller did not arrange first.
*/
function spawnTracked(file: string, args: readonly string[] = []): TrackedChild {
  const child = spawn(file, [...args], { stdio: ['pipe', 'pipe', 'ignore'] })
  const errors: unknown[] = []
  child.once('error', (error) => {
    errors.push(error)
  })
  // `close` fires for a failed start as well as an exit, so this waiter
  // settles either way; a failed start reports through `errors`.
  const closed = Promise.withResolvers<undefined>()
  child.once('close', () => {
    closed.resolve(undefined)
  })
  const entry = { child, closed: closed.promise, errors }
  tracked.push(entry)
  return entry
}

/** A live Node child that has printed its first line: mapped, with real RSS. */
async function liveChild(): Promise<TrackedChild> {
  const entry = spawnTracked(process.execPath, [
    '-e',
    String.raw`process.stdout.write('ready\n'); setInterval(() => {}, 1000)`,
  ])
  if (entry.child.stdout === null) throw new Error('the child has no stdout')
  const [line] = (await once(entry.child.stdout, 'data')) as [Buffer]
  expect(line.toString('utf8')).toContain('ready')
  if (entry.child.pid === undefined) throw new Error('the child has no PID')
  return entry
}

/** A live child that grows its resident set by 8 MiB on a stdin write. */
async function growingChild(): Promise<{
  entry: TrackedChild
  pid: number
  grow: () => Promise<void>
}> {
  const entry = spawnTracked(process.execPath, [
    '-e',
    [
      String.raw`process.stdout.write('ready\n')`,
      "process.stdin.on('data', () => {",
      '  globalThis.kept = Buffer.alloc(8 * 1024 * 1024, 1)',
      String.raw`  process.stdout.write('grown\n')`,
      '})',
      'setInterval(() => {}, 1000)',
    ].join('\n'),
  ])
  if (entry.child.stdout === null || entry.child.stdin === null)
    throw new Error('the child has no pipes')
  const [ready] = (await once(entry.child.stdout, 'data')) as [Buffer]
  expect(ready.toString('utf8')).toContain('ready')
  if (entry.child.pid === undefined) throw new Error('the child has no PID')
  const pid = entry.child.pid
  const { stdin, stdout } = entry.child
  return {
    entry,
    pid,
    grow: async () => {
      stdin.write('grow\n')
      const [grown] = (await once(stdout, 'data')) as [Buffer]
      expect(grown.toString('utf8')).toContain('grown')
    },
  }
}

describe('the ps-row parser, on literal rows', () => {
  it.each([
    ['a zombie', { state: 'Z' }, true],
    ['a running process', { state: 'S' }, false],
    ['a mid-transition row macOS reports as ?', { state: '?<' }, false],
  ] as const)('parses %s with exited=%s', (_label, fields, exited) => {
    const rows = parseMacProcessTable(`${columns(fields)}\n`)
    expect(rows).toHaveLength(1)
    expect(rows?.[0]).toMatchObject({ pid: 4242, parent: 777, pgid: 777, exited })
    expect(rows?.[0]?.residentBytes).toBe(2 * MIB)
  })

  it('parses zero resident memory as zero bytes (the sampler refuses those)', () => {
    expect(parseMacProcessTable(`${columns({ rss: '0' })}\n`)?.[0]?.residentBytes).toBe(0)
  })

  it.each([
    ['a non-row', 'not a process row\n'],
    ['a bad CPU time', `${columns({ time: 'abc' })}\n`],
    ['a bad RSS', `${columns({ rss: 'lots' })}\n`],
  ] as const)('returns null for %s', (_label, text) => {
    expect(parseMacProcessTable(text)).toBeNull()
  })
})

function literal(text: string): ResourceTreeRun {
  return () => Promise.resolve(text)
}

describe('readMacProcess, literal text through the real shape', () => {
  it.each([
    ['empty output', ''],
    ['malformed output', 'not a process row\n'],
    ['a row without its start time', row({ started: '' })],
    ['a malformed start time', row({ started: 'yesterday' })],
    ['two rows', row() + row()],
  ] as const)('returns null for %s', async (_label, text) => {
    await expect(readMacProcess(4242, literal(text))).resolves.toBeNull()
  })

  it('returns the row it found, so the sampler can tell a reused PID apart', async () => {
    const found = await readMacProcess(4242, literal(row({ started: 'Thu Oct  8 21:01:06 2026' })))
    expect(found?.started).toBe('Thu Oct  8 21:01:06 2026')
    expect(found?.row.pid).toBe(4242)
  })

  it('rejects when the real ps run fails, as for a PID past pid_max', async () => {
    await expect(readMacProcess(MISSING_PID, realRun)).rejects.toThrow()
  })
})

describe('macRssSampler on real children through the real /bin/ps', () => {
  it('reads its live child through the absolute /bin/ps with numeric columns and start time', async () => {
    const { child } = await liveChild()
    const pid = child.pid
    if (pid === undefined) throw new Error('the child has no PID')
    const { run, calls } = countingRun()
    const read = macRssSampler(child, { run })
    const bytes = await read(pid)
    expect(Number.isSafeInteger(bytes)).toBe(true)
    expect(bytes).toBeGreaterThan(MIB)
    expect(calls).toEqual([
      ['/bin/ps', ['-o', 'pid=,ppid=,pgid=,state=,time=,rss=,lstart=', '-p', String(pid)]],
    ])
  })

  it.each([0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1, 4243])(
    'refuses the PID %s, which is not its child’s, without running ps',
    async (pid) => {
      const { child } = await liveChild()
      if (child.pid === undefined) throw new Error('the child has no PID')
      const { run, calls } = countingRun()
      await expect(macRssSampler(child, { run })(pid)).rejects.toMatchObject({
        code: 'EMEDIA_RSS_UNAVAILABLE',
      })
      expect(calls).toHaveLength(0)
    },
  )

  it('refuses a live process that is not its child, and reads a real row of this process', async () => {
    // The premise, read live: our parent's parent is never us.
    const parent = await readMacProcess(process.ppid, realRun)
    expect(parent?.row.pid).toBe(process.ppid)
    expect(parent?.row.parent).not.toBe(process.pid)
    const { child } = await liveChild()
    const { run, calls } = countingRun()
    await expect(macRssSampler(child, { run })(process.ppid)).rejects.toBeInstanceOf(
      RssSampleRefused,
    )
    expect(calls).toHaveLength(0)
  })

  it('refuses a child that never started, without running ps or touching any other process', async () => {
    const { child, closed, errors } = spawnTracked(MISSING_PROGRAM)
    await closed
    expect(child.pid).toBeUndefined()
    expect(child.exitCode).toBe(-2)
    expect(errors.map((error) => (error as NodeJS.ErrnoException).code)).toEqual(['ENOENT'])
    const { run, calls } = countingRun()
    // The sampler is asked for this process's own PID with a handle that never
    // started: it refuses from the handle alone, before any ps run.
    await expect(macRssSampler(child, { run })(process.pid)).rejects.toMatchObject({
      code: 'EMEDIA_RSS_UNAVAILABLE',
    })
    expect(calls).toHaveLength(0)
  })

  it('refuses a child that had already exited, without running ps', async () => {
    const { child, closed } = spawnTracked(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
    if (child.pid === undefined) throw new Error('the child has no PID')
    const pid = child.pid
    child.kill('SIGKILL')
    await closed
    // A signalled child has no exit code: its signal does.
    expect(child.signalCode).toBe('SIGKILL')
    const { run, calls } = countingRun()
    await expect(macRssSampler(child, { run })(pid)).rejects.toBeInstanceOf(RssSampleRefused)
    expect(calls).toHaveLength(0)
  })

  it('keeps a failure final for the child it watches', async () => {
    const time = clock()
    const { child } = await liveChild()
    const pid = child.pid
    if (pid === undefined) throw new Error('the child has no PID')
    const { run, calls } = countingRun()
    // A live row under another parent: a real ps refusal, not a scripted one.
    const read = macRssSampler(child, { run, parentPid: 1, now: time.now })
    await expect(read(pid)).rejects.toBeInstanceOf(RssSampleRefused)
    time.advance(MEDIA_RSS_SAMPLE_MAX_AGE_MS + 1)
    await expect(read(pid)).rejects.toBeInstanceOf(RssSampleRefused)
    expect(calls).toHaveLength(1)
  })

  it('drops its reading when the child exits, even inside the refresh interval', async () => {
    const time = clock()
    const { child, closed } = await liveChild()
    const pid = child.pid
    if (pid === undefined) throw new Error('the child has no PID')
    const { run, calls } = countingRun()
    const read = macRssSampler(child, { run, now: time.now })
    await expect(read(pid)).resolves.toBeGreaterThan(MIB)
    child.kill('SIGKILL')
    await closed
    // Well inside the refresh interval: no ps run, and still no stale answer.
    await expect(read(pid)).rejects.toMatchObject({ code: 'EMEDIA_RSS_UNAVAILABLE' })
    expect(calls).toHaveLength(1)
  })

  it('refuses a run that finished after the child exited', async () => {
    const time = clock()
    const { child, closed } = await liveChild()
    const pid = child.pid
    if (pid === undefined) throw new Error('the child has no PID')
    const { run, calls, hold, release } = gatedRun()
    const read = macRssSampler(child, { run, now: time.now })
    await expect(read(pid)).resolves.toBeGreaterThan(MIB)
    time.advance(MEDIA_RSS_SAMPLE_MAX_AGE_MS)
    hold()
    const waiting = read(pid)
    // The exit lands while the ps run is still held: it entered live, so this
    // refusal can only come from the run-after-exit gate, not the entry check.
    child.kill('SIGKILL')
    await closed
    release()
    await expect(waiting).rejects.toBeInstanceOf(RssSampleRefused)
    expect(calls).toHaveLength(2)
  })

  it('runs ps at most once per interval and lands the refresh only after ps answers', async () => {
    const time = clock()
    const { entry, pid, grow } = await growingChild()
    const { run, calls, hold, release } = gatedRun()
    const read = macRssSampler(entry.child, { run, now: time.now })
    const first = await read(pid)
    expect(first).toBeGreaterThan(MIB)
    for (let step = 0; step < 4; step += 1) {
      time.advance(MEDIA_RSS_SAMPLE_INTERVAL_MS / 5)
      await expect(read(pid)).resolves.toBe(first)
    }
    expect(calls).toHaveLength(1)
    // Past the interval: a fresh run starts, but the still-young reading
    // answers at once, without waiting for ps.
    time.advance(MEDIA_RSS_SAMPLE_INTERVAL_MS / 5)
    hold()
    await expect(read(pid)).resolves.toBe(first)
    expect(calls).toHaveLength(2)
    // The refresh lands on the grown child only after the real ps answers.
    await grow()
    release()
    let refreshed = first
    for (let attempt = 0; refreshed === first && attempt < 50; attempt += 1) {
      refreshed = await read(pid)
      if (refreshed === first) await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(refreshed).toBeGreaterThan(first)
    expect(calls).toHaveLength(2)
  })

  it('waits for a fresh reading past the maximum age and refuses a late one', async () => {
    const time = clock()
    const { child } = await liveChild()
    const pid = child.pid
    if (pid === undefined) throw new Error('the child has no PID')
    const { run, calls } = countingRun()
    const read = macRssSampler(child, { run, now: time.now })
    await expect(read(pid)).resolves.toBeGreaterThan(MIB)
    time.advance(MEDIA_RSS_SAMPLE_MAX_AGE_MS)
    const waiting = read(pid)
    // The run is awaited, but its reading is already expired when it lands.
    time.advance(MEDIA_RSS_SAMPLE_MAX_AGE_MS)
    await expect(waiting).rejects.toBeInstanceOf(RssSampleRefused)
    // It went to ps and waited: the refusal is late, not instant.
    expect(calls).toHaveLength(2)
  })
})
