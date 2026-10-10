import { appendFile, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { aggregateResources } from '../../src/core/usage/aggregate'
import type { UsageFs } from '../../src/core/usage/journalStore'
import {
  RESOURCE_JOURNAL_ROOT,
  ResourceJournal,
  ResourceJournalError,
} from '../../src/core/usage/resourceJournal'
import { ResourceRecords } from '../../src/core/usage/resourceRecords'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'
import {
  MILLISECONDS_PER_DAY,
  RESOURCE_HISTORY_RETENTION_MS,
  RESOURCE_JOURNAL_FILE_MAX_BYTES,
  RESOURCE_JOURNAL_FUTURE_SKEW_MS,
  RESOURCE_JOURNAL_READ_MAX_BYTES,
  RESOURCE_JOURNAL_VERSION,
  USAGE_SETTINGS_FILE,
} from '../../src/shared/constants'
import type { ResourceRecord } from '../../src/shared/resources'
import { historyStatus } from './helpers/resources/history'
import { removeFolder } from './helpers/temporaryFolders'

// 2026-10-07T12:00:00Z: far from a UTC day edge.
const NOW = Date.UTC(2026, 9, 7, 12)
const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) await removeFolder(folder)
})
async function dataFolder(): Promise<string> {
  await mkdir('temp', { recursive: true })
  const folder = await mkdtemp(path.resolve('temp/m107-journal-'))
  folders.push(folder)
  return folder
}
function minute(atMs: number, cpuPercent = 50): ResourceRecord {
  return {
    type: 'resource',
    atMs,
    event: null,
    minute: {
      cpuPercent,
      memoryUsedPercent: 40,
      availableMemory: 'ample',
      gpuPercent: null,
      diskBusyPercent: null,
      level: 'normal',
      thresholds: { cpuMaxPercent: 85, memoryMaxPercent: 90, memoryMinFreeGiB: 2 },
    },
    work: [{ kind: 'check', cpuSeconds: 1, peakMemoryBytes: 10 }],
  }
}
function override(atMs: number): ResourceRecord {
  return {
    type: 'resource',
    atMs,
    minute: null,
    event: { type: 'override', atMs, untilMs: atMs + 1 },
    work: [],
  }
}
function journal(folder: string, writerId = 'writer-a', now = () => NOW, isEnabled = () => true) {
  return new ResourceJournal(new NodeUsageFs(folder, now), { writerId, now, isEnabled })
}
async function readAt(store: ResourceJournal): Promise<number[]> {
  const read = await store.read()
  return read.records.map((record) => record.atMs)
}
async function readFailure(store: ResourceJournal): Promise<unknown> {
  try {
    await store.read()
  } catch (error) {
    return error
  }
  return undefined
}
async function settled(action: Promise<void>): Promise<void> {
  try {
    await action
  } catch {
    // The scripted write failure is asserted through the journal's files.
  }
}
const day = (atMs: number) => new Date(atMs).toISOString().slice(0, 10)
const dayFolder = (folder: string, atMs: number) =>
  path.join(folder, ...RESOURCE_JOURNAL_ROOT.split('/'), day(atMs))

describe('M107 J/M102 durable resource journal', () => {
  it('appends flushed lines per collector and day under the usage folder and reads them back', async () => {
    const folder = await dataFolder()
    const fs = new NodeUsageFs(folder, () => NOW)
    const append = vi.spyOn(fs, 'append')
    const store = new ResourceJournal(fs, {
      writerId: 'writer-a',
      now: () => NOW,
      isEnabled: () => true,
    })
    await store.append(minute(NOW - 60_000))
    await store.append(override(NOW))
    // Every append asks the filesystem adapter to flush before resolving.
    const journalCalls = append.mock.calls.filter((call) => call[0].endsWith('.jsonl'))
    expect(journalCalls.map((call) => call[2])).toEqual([true, true])
    expect(await readdir(dayFolder(folder, NOW))).toEqual(['writer-a.0.jsonl'])
    const text = await readFile(path.join(dayFolder(folder, NOW), 'writer-a.0.jsonl'), 'utf8')
    const lines = text
      .trimEnd()
      .split('\n')
      .map((line): unknown => JSON.parse(line))
    expect(lines).toEqual([
      { v: RESOURCE_JOURNAL_VERSION, id: '1', record: minute(NOW - 60_000) },
      { v: RESOURCE_JOURNAL_VERSION, id: '2', record: override(NOW) },
    ])
    expect(await store.read()).toEqual({
      records: [minute(NOW - 60_000), override(NOW)],
      sources: ['writer-a', 'writer-a'],
      days: [],
    })
  })

  it('records nothing without consent and refuses a writer id that could name a path', async () => {
    const folder = await dataFolder()
    const store = journal(
      folder,
      'writer-a',
      () => NOW,
      () => false,
    )
    await store.append(minute(NOW))
    expect(await store.read()).toEqual({ records: [], sources: [], days: [] })
    await expect(readdir(path.join(folder, 'usage'))).rejects.toThrow()
    expect(() => journal(folder, '../escape')).toThrow('invalidResourceWriter')
    expect(() => journal(folder, 'a.b')).toThrow('invalidResourceWriter')
  })

  it('merges concurrent collectors sharing one machine journal without losing or mixing segments', async () => {
    const folder = await dataFolder()
    const first = journal(folder, 'window-one')
    const second = journal(folder, 'window-two')
    const reader = journal(
      folder,
      'reader',
      () => NOW,
      () => false,
    )
    const at = NOW - 120_000
    // Both windows write the same segment timestamp at once, and each later
    // replaces its own cumulative snapshot.
    await Promise.all([
      first.append(minute(at, 10)),
      second.append(minute(at, 70)),
      first.append(override(at + 1)),
      second.append(override(at + 2)),
    ])
    await Promise.all([first.append(minute(at, 20)), second.append(minute(at, 80))])
    const read = await reader.read()
    expect(new Set(read.sources)).toEqual(new Set(['window-one', 'window-two']))
    expect(read.records).toHaveLength(6)
    const history = aggregateResources(read.records, read.sources)
    expect(
      history.minutes.map((row) => row.minute?.cpuPercent ?? -1).toSorted((a, b) => a - b),
    ).toEqual([20, 80])
    expect(history.counts).toEqual([{ type: 'override', kind: null, count: 2 }])
    expect(history.work).toEqual([{ kind: 'check', cpuSeconds: 2, peakMemoryBytes: 10 }])
    // Without collector scope the two windows' segments would replace each other.
    expect(aggregateResources(read.records).minutes).toHaveLength(1)
  })

  it('ignores a torn final append but refuses any other unreadable line explicitly', async () => {
    const folder = await dataFolder()
    const store = journal(folder)
    await store.append(minute(NOW))
    const file = path.join(dayFolder(folder, NOW), 'writer-a.0.jsonl')
    await appendFile(file, '{"v":1,"record":{"type":"reso')
    expect(await readAt(store)).toEqual([NOW])
    for (const bad of [
      'not json\n',
      `${JSON.stringify({ v: RESOURCE_JOURNAL_VERSION, record: { ...minute(NOW), pid: 4 } })}\n`,
      `${JSON.stringify({ v: RESOURCE_JOURNAL_VERSION, record: minute(NOW - MILLISECONDS_PER_DAY) })}\n`,
      `${JSON.stringify({ v: RESOURCE_JOURNAL_VERSION, record: minute(NOW), extra: 1 })}\n`,
      `${'x'.repeat(5000)}\n`,
      '\n',
    ]) {
      await writeFile(
        file,
        `${JSON.stringify({ v: RESOURCE_JOURNAL_VERSION, record: minute(NOW) })}\n${bad}`,
      )
      const failure = await readFailure(store)
      expect(failure).toBeInstanceOf(ResourceJournalError)
      expect(failure).toMatchObject({ code: 'resourceHistoryCorrupt' })
    }
    // A newer build's line is skipped, not treated as corruption.
    await writeFile(
      file,
      `${JSON.stringify({ v: RESOURCE_JOURNAL_VERSION + 1, record: { future: true } })}\n`,
    )
    expect(await readAt(store)).toEqual([])
  })

  it('bounds each file and the whole read, dropping past the cap instead of retrying forever', async () => {
    const empty = JSON.stringify({ v: RESOURCE_JOURNAL_VERSION + 1, padding: '' }).length
    const newerLine = `${JSON.stringify({ v: RESOURCE_JOURNAL_VERSION + 1, padding: 'x'.repeat(127 - empty) })}\n`
    const newerLines = new TextEncoder().encode(
      newerLine.repeat(RESOURCE_JOURNAL_FILE_MAX_BYTES / newerLine.length),
    )
    const sizes = new Map<string, number>()
    const fake: UsageFs = {
      list: (relative) =>
        Promise.resolve(
          relative === RESOURCE_JOURNAL_ROOT
            ? [day(NOW)]
            : Array.from({ length: 9 }, (_, index) => `w${String(index)}.0.jsonl`),
        ),
      stat: (relative) =>
        Promise.resolve({
          size: sizes.get(relative) ?? RESOURCE_JOURNAL_FILE_MAX_BYTES,
          mtimeMs: 1,
        }),
      // Each file really holds its measured 4 MiB (valid lines from a newer build).
      read: () => Promise.resolve(newerLines),
      append: vi.fn(() => Promise.resolve()),
      writeFileAtomically: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      // The write lock is always free here; retention's rollup lock is never granted.
      acquireLock: (relative) =>
        Promise.resolve(
          relative.endsWith('/write.lock')
            ? {
                token: 't',
                generation: 1,
                isHeld: () => Promise.resolve(true),
                release: () => Promise.resolve(),
              }
            : undefined,
        ),
    }
    const onDropped = vi.fn()
    const store = new ResourceJournal(fake, {
      writerId: 'writer-a',
      now: () => NOW,
      isEnabled: () => true,
      onDropped,
    })
    // Each line carries its collector-scoped id, so line sizes grow with the id.
    let capacity = 0
    for (let used = 0; ; capacity++) {
      const record = { v: RESOURCE_JOURNAL_VERSION, id: String(capacity + 1), record: minute(NOW) }
      used += Buffer.byteLength(`${JSON.stringify(record)}\n`)
      if (used > RESOURCE_JOURNAL_FILE_MAX_BYTES) break
    }
    for (let index = 0; index < capacity + 2; index++) await store.append(minute(NOW))
    // Exactly the bytes that fit were written; the rest were dropped with one report.
    expect(fake.append).toHaveBeenCalledTimes(capacity)
    expect(onDropped).toHaveBeenCalledTimes(1)

    const big = new ResourceJournal(fake, {
      writerId: 'reader',
      now: () => NOW,
      isEnabled: () => false,
    })
    // 9 × 4 MiB passes every per-file check but exceeds the 32 MiB read bound.
    expect(9 * RESOURCE_JOURNAL_FILE_MAX_BYTES).toBeGreaterThan(RESOURCE_JOURNAL_READ_MAX_BYTES)
    await expect(big.read()).rejects.toMatchObject({ code: 'resourceHistoryTooLarge' })
    sizes.set(
      `${RESOURCE_JOURNAL_ROOT}/${day(NOW)}/w0.0.jsonl`,
      RESOURCE_JOURNAL_FILE_MAX_BYTES + 1,
    )
    await expect(big.read()).rejects.toMatchObject({ code: 'resourceHistoryTooLarge' })
  })

  it('keeps seven recorded days, removes expired day folders and rejects out-of-range dates', async () => {
    const folder = await dataFolder()
    let now = NOW - 10 * MILLISECONDS_PER_DAY
    const store = journal(folder, 'writer-a', () => now)
    await store.append(minute(now))
    const expired = dayFolder(folder, now)
    now = NOW - RESOURCE_HISTORY_RETENTION_MS + 60_000
    await store.append(minute(now))
    now = NOW
    // The writer's first append of a new UTC day removes folders past detail + margin.
    await store.append(minute(NOW))
    await expect(readdir(expired)).rejects.toThrow()
    // Records outside the readable window are never stored, and a record that
    // a wrong clock dated ahead is not shown.
    await store.append(minute(NOW - RESOURCE_HISTORY_RETENTION_MS - 1))
    await store.append(minute(NOW + RESOURCE_JOURNAL_FUTURE_SKEW_MS + 60_000))
    // An hour before the next day's seven-day edge, inside a folder that day still reads.
    const edge = NOW - 6 * MILLISECONDS_PER_DAY - 3_600_000
    await store.append(minute(edge))
    expect(await readAt(store)).toEqual([NOW - RESOURCE_HISTORY_RETENTION_MS + 60_000, edge, NOW])
    // A day later both older minutes fall out of the seven-day window on read,
    // including the one whose day folder is still inside it.
    now = NOW + MILLISECONDS_PER_DAY
    expect(await readAt(store)).toEqual([NOW])
    // Folders that are not ours, or are future-dated, are not read.
    await mkdir(path.join(folder, ...RESOURCE_JOURNAL_ROOT.split('/'), 'not-a-day'), {
      recursive: true,
    })
    const future = dayFolder(folder, NOW + 3 * MILLISECONDS_PER_DAY)
    await mkdir(future, { recursive: true })
    await writeFile(path.join(future, 'x.0.jsonl'), 'corrupt\n')
    expect(await readAt(store)).toEqual([NOW])
  })

  it('moves to a fresh file after a failed write so a partial line is never extended', async () => {
    const folder = await dataFolder()
    const fs = new NodeUsageFs(folder, () => NOW)
    const store = new ResourceJournal(fs, {
      writerId: 'writer-a',
      now: () => NOW,
      isEnabled: () => true,
    })
    const real = fs.append.bind(fs)
    vi.spyOn(fs, 'append').mockImplementationOnce(async (file, line, isDurable) => {
      await real(file, line.slice(0, 10), isDurable)
      throw new Error('ENOSPC')
    })
    // The collector keeps the failed minute pending and retries it first.
    const records = new ResourceRecords(store, { read: () => Promise.resolve([]) })
    await records.sample(historyStatus(NOW - 120_000))
    await settled(records.sample(historyStatus(NOW - 60_000)))
    await records.sample(historyStatus(NOW))
    await records.flush()
    const names = await readdir(dayFolder(folder, NOW))
    expect(names.toSorted((a, b) => a.localeCompare(b))).toEqual([
      'writer-a.0.jsonl',
      'writer-a.1.jsonl',
    ])
    const read = await store.read()
    expect(read.records.map((record) => record.atMs)).toEqual([NOW - 120_000, NOW])
    expect(read.sources).toEqual(['writer-a', 'writer-a'])
  })

  it('reads the shared usage-history choice for consent through the runtime binding', async () => {
    const folder = await dataFolder()
    await writeFile(path.join(folder, USAGE_SETTINGS_FILE), '{"enabled":false,"days":365}')
    const { resourceHistoryRecorder } = await import('../../src/runtime/resources/history')
    const onError = vi.fn()
    const recorder = resourceHistoryRecorder(
      { dataFolder: folder, isEnabled: () => true },
      { read: () => Promise.resolve([]) },
      onError,
    )
    const now = Date.now()
    recorder.sample(historyStatus(now))
    await vi.waitFor(async () => {
      await recorder.flush()
    })
    const empty = await recorder.history.read()
    expect(empty.minutes).toEqual([])
    await writeFile(path.join(folder, USAGE_SETTINGS_FILE), '{"enabled":true,"days":365}')
    recorder.event({ type: 'override', atMs: now, untilMs: now + 1 })
    await vi.waitFor(async () => {
      const recorded = await recorder.history.read()
      expect(recorded.events).toHaveLength(1)
    })
    // An unreadable choice is not consent.
    await writeFile(path.join(folder, USAGE_SETTINGS_FILE), 'nope')
    recorder.event({ type: 'override', atMs: now + 2, untilMs: now + 3 })
    await recorder.flush()
    const refused = await recorder.history.read()
    expect(refused.events).toHaveLength(1)
    expect(onError).not.toHaveBeenCalled()
  })
})

const DAY = MILLISECONDS_PER_DAY
function at(level: 'normal' | 'pause', atMs: number, cpu: number | null): ResourceRecord {
  const base = minute(atMs, cpu ?? 0)
  if (base.minute === null) throw new Error('minute')
  return { ...base, minute: { ...base.minute, cpuPercent: cpu, level } }
}
async function cpuReadings(store: ResourceJournal): Promise<(number | null | undefined)[]> {
  const read = await store.read()
  return read.records.map((record) => record.minute?.cpuPercent)
}

describe('M107 J/M102 daily rollups, live minute and delete count', () => {
  it('rolls completed days into daily rows from each collector latest snapshot, then removes old raw days', async () => {
    const folder = await dataFolder()
    let now = NOW - 10 * DAY
    const one = journal(folder, 'one', () => now)
    const two = journal(folder, 'two', () => now)
    await one.append(at('normal', now, 10))
    // The same segment's later cumulative snapshot replaces the earlier one.
    await one.append(at('normal', now, 30))
    await two.append(at('pause', now, null))
    await one.append(override(now + 1))
    now = NOW
    const reader = journal(
      folder,
      'reader',
      () => now,
      () => false,
    )
    await reader.retain()
    const read = await reader.read()
    expect(read.days).toEqual([
      {
        day: day(NOW - 10 * DAY),
        minutes: 2,
        cpuPercent: 30,
        memoryUsedPercent: 40,
        levels: { normal: 1, throttle: 0, relocate: 0, pause: 1 },
        events: 1,
        work: [{ kind: 'check', cpuSeconds: 2, peakMemoryBytes: 10 }],
      },
    ])
    // Rolled up first, so the raw day past the detail window could be removed.
    await expect(readdir(dayFolder(folder, NOW - 10 * DAY))).rejects.toThrow()
    const rollups = path.join(folder, ...RESOURCE_JOURNAL_ROOT.split('/'), 'rollups')
    expect(await readdir(rollups)).toEqual([`${day(NOW - 10 * DAY).slice(0, 7)}.json`])
  })

  it('re-rolls a day that changed, keeps unreadable days raw and drops rows past the history days', async () => {
    const folder = await dataFolder()
    let now = NOW - 3 * DAY
    let historyDays = 365
    const writer = new ResourceJournal(new NodeUsageFs(folder, () => now), {
      writerId: 'one',
      now: () => now,
      isEnabled: () => true,
      historyDays: () => historyDays,
    })
    await writer.append(at('normal', now, 20))
    now = NOW - 2 * DAY
    await writer.retain()
    const first = await writer.read()
    expect(first.days.map((row) => row.minutes)).toEqual([1])
    // A late append into the completed day (a resumed laptop) changes its size.
    await writer.append(at('normal', NOW - 3 * DAY + 60_000, 40))
    now += 3_600_000
    await writer.retain()
    const second = await writer.read()
    expect(second.days.map((row) => [row.minutes, row.cpuPercent])).toEqual([[2, 30]])
    // An unreadable day past the detail window is neither rolled up nor removed.
    const broken = dayFolder(folder, NOW - 12 * DAY)
    await mkdir(broken, { recursive: true })
    await writeFile(path.join(broken, 'x.0.jsonl'), 'garbage\n')
    now += 3_600_000
    await writer.retain()
    const third = await writer.read()
    expect(third.days.map((row) => row.day)).toEqual([day(NOW - 3 * DAY)])
    expect(await readdir(broken)).toEqual(['x.0.jsonl'])
    // Shortening the usage-history days drops older rows, raw days and month files.
    historyDays = 1
    now += 3_600_000
    await writer.retain()
    const fourth = await writer.read()
    expect(fourth.days).toEqual([])
    await expect(readdir(broken)).rejects.toThrow()
  })

  it('publishes the open minute for other processes until the journal holds its final snapshot', async () => {
    const folder = await dataFolder()
    const writer = journal(folder, 'window')
    const cli = journal(
      folder,
      'cli',
      () => NOW,
      () => false,
    )
    await writer.writeLive(at('normal', NOW - 10_000, 55))
    const live = await cli.read()
    expect(live.records).toEqual([at('normal', NOW - 10_000, 55)])
    expect(live.sources).toEqual(['window'])
    // The live file is replaced, never appended.
    await writer.writeLive(at('normal', NOW - 10_000, 65))
    expect(await cpuReadings(cli)).toEqual([65])
    await writer.append(at('normal', NOW - 10_000, 70))
    expect(await cpuReadings(cli)).toEqual([70])
    await expect(writer.writeLive(override(NOW))).rejects.toThrow()
    const liveFile = path.join(folder, ...RESOURCE_JOURNAL_ROOT.split('/'), 'live', 'window.json')
    await writeFile(liveFile, '{"v":1,"record":{"pid":1}}')
    await expect(cli.read()).rejects.toMatchObject({ code: 'resourceHistoryCorrupt' })
  })

  it('counts every stored entry Delete history removes, including unreadable lines', async () => {
    const folder = await dataFolder()
    const writer = journal(folder, 'window')
    await writer.append(minute(NOW - 60_000))
    await writer.append(override(NOW))
    await writer.writeLive(minute(NOW))
    const reader = journal(
      folder,
      'reader',
      () => NOW,
      () => false,
    )
    expect(await reader.count()).toBe(3)
    await appendFile(path.join(dayFolder(folder, NOW), 'window.0.jsonl'), 'garbage\n')
    expect(await reader.count()).toBe(4)
    expect(await journal(await dataFolder()).count()).toBe(0)
  })
})
