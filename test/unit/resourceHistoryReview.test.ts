// RVM107W2 (P1/P2) and RVM107W2G (round 3): regressions for the reviewed
// findings, each through the production path the reviewer used.
import * as fsPromises from 'node:fs/promises'
import type * as FsPromises from 'node:fs/promises'
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { admitResource } from '../../src/core/resources/admission'
import type { UsageFs } from '../../src/core/usage/journalStore'
import { RESOURCE_JOURNAL_ROOT, ResourceJournal } from '../../src/core/usage/resourceJournal'
import { ResourceRecords } from '../../src/core/usage/resourceRecords'
import { resourceHistoryReader, resourceHistoryRecorder } from '../../src/runtime/resources/history'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'
import { readResourceReset, writeResourceReset } from '../../src/runtime/usage/resourceResetFile'
import { createUsageAccess } from '../../src/runtime/usage/usageServiceEntry'
import {
  RESOURCE_JOURNAL_FILE_MAX_BYTES,
  RESOURCE_JOURNAL_READ_MAX_BYTES,
  RESOURCE_JOURNAL_VERSION,
  USAGE_SETTINGS_FILE,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import type { ResourceRecord } from '../../src/shared/resources'
import { FakeLogOutputChannel } from './helpers/fakes'
import { restoreRemovalSpies } from './helpers/resources/fsSpies'
import { historyStatus } from './helpers/resources/history'
import {
  configureWindowHistory,
  journalMinuteLines,
  liveFiles,
  resourcesRoot,
  deleteThroughPage,
  storedDay,
  temporaryFolders,
  waitUntil,
  windowJournal,
} from './helpers/resources/journalFixtures'

vi.mock('node:fs/promises', async (original) => {
  const { withRemovalSpies } = await import('./helpers/resources/fsSpies')
  return withRemovalSpies(await original())
})
const actual = await vi.importActual<typeof FsPromises>('node:fs/promises')
const NOW = Date.UTC(2026, 9, 7, 12)
const TRASH = '.removing-'

const folders = temporaryFolders('rvm107w2')
const temporary = folders.create
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  restoreRemovalSpies(fsPromises, actual)
  await folders.cleanup()
})
/** Retention removes an expired day while an attacker swaps the history folder for a link. */
async function swapScene() {
  const root = await temporary()
  const data = path.join(root, 'data')
  const other = path.join(root, 'unrelated')
  await mkdir(path.join(other, '2026-01-01'), { recursive: true })
  await writeFile(path.join(other, '2026-01-01', 'proof'), 'keep')
  const day = path.join(resourcesRoot(data), '2026-01-01')
  await mkdir(day, { recursive: true })
  await writeFile(path.join(day, 'w.0.jsonl'), '')
  const journal = new ResourceJournal(new NodeUsageFs(data, () => NOW), {
    writerId: 'w',
    now: () => NOW,
    isEnabled: () => false,
    historyDays: () => 1,
  })
  const swap = async () => {
    await actual.rename(resourcesRoot(data), path.join(root, 'moved'))
    await symlink(other, resourcesRoot(data), 'junction')
  }
  return { data, other, journal, swap }
}
/** The production recorder on its own data folder, recording with the host's consent on. */
function windowRecorder(folder: string) {
  return resourceHistoryRecorder(
    { dataFolder: folder, isEnabled: () => true },
    { read: () => Promise.resolve([]) },
    vi.fn(),
  )
}

describe('RVM107W2 P1: removal is confined to the validated directory', () => {
  it('refuses, and deletes nothing outside, when the history folder is swapped right before rm', async () => {
    const { other, journal, swap } = await swapScene()
    vi.mocked(fsPromises.rm).mockImplementationOnce(async (...args) => {
      await swap()
      await actual.rm(...args)
    })
    await expect(journal.retain()).rejects.toThrow()
    expect(await readFile(path.join(other, '2026-01-01', 'proof'), 'utf8')).toBe('keep')
  })

  it('makes the shared removal primitive itself refuse a swap right before rm', async () => {
    const { data, other, swap } = await swapScene()
    vi.mocked(fsPromises.rm).mockImplementationOnce(async (...args) => {
      await swap()
      await actual.rm(...args)
    })
    const fs = new NodeUsageFs(data)
    // Windows pins the entry's ancestors (RVM107W2G P2-3), so the swap itself is refused.
    await expect(fs.remove(`${RESOURCE_JOURNAL_ROOT}/2026-01-01`)).rejects.toThrow(
      process.platform === 'win32' ? 'EPERM' : 'usagePathChanged',
    )
    expect(await readFile(path.join(other, '2026-01-01', 'proof'), 'utf8')).toBe('keep')
  })

  it('refuses and puts the entry back when the swap comes right before the quarantine rename', async () => {
    const { other, journal, swap } = await swapScene()
    let isSwapped = false
    vi.mocked(fsPromises.rename).mockImplementation(async (from, to) => {
      if (!isSwapped && String(to).includes('.removing-')) {
        isSwapped = true
        await swap()
      }
      await actual.rename(from, to)
    })
    await expect(journal.retain()).rejects.toThrow()
    expect(await readdir(other)).toEqual(['2026-01-01'])
    expect(await readFile(path.join(other, '2026-01-01', 'proof'), 'utf8')).toBe('keep')
  })
})

describe('RVM107W2 P2: consent, delete boundary, retries, disposal and read bounds', () => {
  it('never writes a reading collected while history was off after history is turned on', async () => {
    const folder = await temporary()
    await writeFile(path.join(folder, USAGE_SETTINGS_FILE), '{"enabled":false,"days":365}')
    const recorder = windowRecorder(folder)
    // The reviewer's sequence: an open minute collected while off, then consent, then a flush.
    recorder.sample(historyStatus(Date.now()))
    await writeFile(path.join(folder, USAGE_SETTINGS_FILE), '{"enabled":true,"days":365}')
    await recorder.flush()
    const history = await resourceHistoryReader(folder).read()
    expect(history.minutes).toEqual([])
  })

  it('drops a collector open minute when Delete history completes through the usage page', async () => {
    const folder = await temporary()
    const recorder = windowRecorder(folder)
    // Collected before the delete and still open in the collector.
    recorder.sample(historyStatus(Date.now() - 1000))
    const posted: unknown[] = []
    const connection = createUsageAccess({
      dataFolder: folder,
      packageRoot: process.cwd(),
      host: 'VS Code',
      locale: 'en',
      uiText: EN,
      log: new FakeLogOutputChannel(),
    }).connect({
      post: (message) => {
        posted.push(message)
      },
      confirmDelete: () => Promise.resolve(true),
    })
    await connection.receive({ type: 'usage/deleteHistory', requestId: 'delete' })
    expect(posted).toContainEqual(expect.objectContaining({ outcome: 'completed' }))
    await recorder.flush()
    const after = await resourceHistoryReader(folder).read()
    expect(after.minutes).toEqual([])
  })

  it('reads one event when a complete line reached disk before the write reported an error', async () => {
    const folder = await temporary()
    const fs = new NodeUsageFs(folder)
    const real = fs.append.bind(fs)
    vi.spyOn(fs, 'append').mockImplementationOnce(async (file, line, isDurable) => {
      await real(file, line, isDurable)
      throw new Error('EIO after write')
    })
    const now = Date.now()
    const journal = new ResourceJournal(fs, {
      writerId: 'w',
      now: () => now,
      isEnabled: () => true,
    })
    const records = new ResourceRecords(journal, { read: () => Promise.resolve([]) })
    await expect(records.event({ type: 'override', atMs: now, untilMs: now + 1 })).rejects.toThrow(
      'EIO after write',
    )
    await records.flush()
    const read = await resourceHistoryReader(folder).read()
    expect(read.events).toHaveLength(1)
    expect(read.counts).toEqual([{ type: 'override', kind: null, count: 1 }])
  })

  it('writes the window open minute to the journal when the window is disposed', async () => {
    const folder = await temporary()
    const dispose = configureWindowHistory(folder)
    const lease = await admitResource('other', undefined, 'foreground')
    lease?.complete(true)
    // The governor sampled at admission; its open minute is not in the journal yet.
    expect(await journalMinuteLines(folder)).toEqual([])
    dispose()
    await vi.waitFor(async () => {
      expect(await journalMinuteLines(folder)).toHaveLength(1)
    })
  })

  it('charges the bytes actually read against the 32 MiB cap, before and after each read', async () => {
    const day = new Date().toISOString().slice(0, 10)
    // Valid newer-version lines of exactly 128 bytes fill each grown file to 4 MiB.
    const empty = JSON.stringify({ v: RESOURCE_JOURNAL_VERSION + 1, padding: '' }).length
    const line = `${JSON.stringify({ v: RESOURCE_JOURNAL_VERSION + 1, padding: 'x'.repeat(127 - empty) })}\n`
    const full = new TextEncoder().encode(
      line.repeat(RESOURCE_JOURNAL_FILE_MAX_BYTES / line.length),
    )
    expect(full.byteLength).toBe(RESOURCE_JOURNAL_FILE_MAX_BYTES)
    let bytesRead = 0
    const files = Array.from({ length: 9 }, (_, index) => `w${String(index)}.0.jsonl`)
    const fs: UsageFs = {
      list: (relative) => {
        if (relative === RESOURCE_JOURNAL_ROOT) return Promise.resolve([day])
        return Promise.resolve(relative.endsWith(day) ? files : [])
      },
      // Measured at 3.5 MiB; each file has grown to 4 MiB by the time it is read.
      stat: () => Promise.resolve({ size: 3.5 * 1024 * 1024, mtimeMs: 1 }),
      read: () => {
        bytesRead += full.byteLength
        return Promise.resolve(full)
      },
      append: () => Promise.resolve(),
      writeFileAtomically: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      acquireLock: () => Promise.resolve(undefined),
    }
    expect(9 * RESOURCE_JOURNAL_FILE_MAX_BYTES).toBeGreaterThan(RESOURCE_JOURNAL_READ_MAX_BYTES)
    const journal = new ResourceJournal(fs, {
      writerId: 'r',
      now: Date.now,
      isEnabled: () => false,
    })
    await expect(journal.read()).rejects.toMatchObject({ code: 'resourceHistoryTooLarge' })
    expect(bytesRead).toBeLessThanOrEqual(RESOURCE_JOURNAL_READ_MAX_BYTES)
  })
})

// RVM107W2G (round 3).
function utcDay(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 10)
}
function minute(atMs: number): ResourceRecord {
  return {
    type: 'resource',
    atMs,
    event: null,
    minute: {
      cpuPercent: 25,
      memoryUsedPercent: 50,
      availableMemory: 'ample',
      gpuPercent: null,
      diskBusyPercent: null,
      level: 'normal',
      thresholds: { cpuMaxPercent: 85, memoryMaxPercent: 90, memoryMinFreeGiB: 2 },
    },
    work: [],
  }
}
/** Fails the delete of a quarantined entry for `name` once, as an EBUSY would. */
function failQuarantineOnce(name: string): void {
  let hasFailed = false
  vi.mocked(fsPromises.rm).mockImplementation(async (...args) => {
    if (
      !hasFailed &&
      path.basename(String(args[0])).startsWith(TRASH) &&
      String(args[0]).endsWith(name)
    ) {
      hasFailed = true
      throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' })
    }
    await actual.rm(...args)
  })
}
async function quarantined(folder: string): Promise<string[]> {
  try {
    const names = await readdir(folder)
    return names.filter((name) => name.startsWith(TRASH))
  } catch {
    return []
  }
}
describe('RVM107W2G P2-1: a failed quarantine delete is never reported as removed', () => {
  it('fails, then succeeds only once the target and its own quarantine are both gone', async () => {
    const folder = await temporary()
    await storedDay(folder)
    const fs = new NodeUsageFs(folder)
    failQuarantineOnce('2026-01-01')
    await expect(fs.remove(`${RESOURCE_JOURNAL_ROOT}/2026-01-01`)).rejects.toThrow('EBUSY')
    // Hidden from listings, and the retry removes it rather than reporting success over it.
    expect(await fs.list(RESOURCE_JOURNAL_ROOT)).toEqual([])
    await fs.remove(`${RESOURCE_JOURNAL_ROOT}/2026-01-01`)
    expect(await quarantined(resourcesRoot(folder))).toEqual([])
  })

  it('replies writeFailed, then completed with nothing left, when Delete history is retried', async () => {
    const folder = await temporary()
    const writer = windowJournal(folder)
    await writer.append(minute(Date.now() - 120_000))
    failQuarantineOnce('usage')
    const first = deleteThroughPage(folder)
    await first.done
    expect(first.posted).toContainEqual(expect.objectContaining({ code: 'writeFailed' }))
    const second = deleteThroughPage(folder)
    await second.done
    expect(second.posted).toContainEqual(expect.objectContaining({ outcome: 'completed' }))
    expect(await quarantined(folder)).toEqual([])
    await expect(readdir(resourcesRoot(folder))).rejects.toThrow()
  })

  it('refuses to report a removal when the delete returns but the entry stays', async () => {
    const folder = await temporary()
    await storedDay(folder)
    const fs = new NodeUsageFs(folder)
    // As a Windows delete-pending entry would: rm resolves, the name is still there.
    vi.mocked(fsPromises.rm).mockImplementationOnce(() => Promise.resolve())
    await expect(fs.remove(`${RESOURCE_JOURNAL_ROOT}/2026-01-01`)).rejects.toThrow(
      'usageRemoveIncomplete',
    )
    await fs.remove(`${RESOURCE_JOURNAL_ROOT}/2026-01-01`)
    expect(await quarantined(resourcesRoot(folder))).toEqual([])
  })

  it('reports a retention failure and removes the orphan on a later pass', async () => {
    const folder = await temporary()
    vi.useFakeTimers({ toFake: ['Date'] })
    const expired = utcDay(Date.now() - 3 * 86_400_000)
    const dayFolder = path.join(resourcesRoot(folder), expired)
    await mkdir(dayFolder, { recursive: true })
    await writeFile(
      path.join(dayFolder, 'w.0.jsonl'),
      `${JSON.stringify({ v: RESOURCE_JOURNAL_VERSION, record: minute(Date.parse(`${expired}T12:00:00Z`)) })}\n`,
    )
    const onRetentionError = vi.fn()
    const reader = resourceHistoryReader(folder, () => 1, onRetentionError)
    failQuarantineOnce(expired)
    await reader.read()
    expect(onRetentionError).toHaveBeenCalledTimes(1)
    expect(await quarantined(resourcesRoot(folder))).toHaveLength(1)
    // Two hours later the orphan is stale. The strict sweep runs before any
    // listing, so a failure to delete it is reported again, never swallowed.
    vi.setSystemTime(Date.now() + 2 * 3_600_000)
    failQuarantineOnce(expired)
    await reader.read()
    expect(onRetentionError).toHaveBeenCalledTimes(2)
    // The listing and the next pass retry the cleanup; nothing is left.
    await reader.read()
    expect(await quarantined(resourcesRoot(folder))).toEqual([])
    expect(onRetentionError).toHaveBeenCalledTimes(2)
  })
})

describe('RVM107W2G P2-2: no write can land between Delete history and its boundary', () => {
  it('refuses an append whose delete lands during its retention pass', async () => {
    const folder = await temporary()
    // A first line, so retention runs (it skips an empty journal).
    const seed = new ResourceJournal(new NodeUsageFs(folder), {
      writerId: 'seed',
      now: Date.now,
      isEnabled: () => true,
    })
    await seed.append(minute(Date.now() - 300_000))
    const fs = new NodeUsageFs(folder)
    const writer = new ResourceJournal(fs, {
      writerId: 'window',
      now: Date.now,
      isEnabled: () => true,
      resetAtMs: () => readResourceReset(folder),
    })
    const realList = fs.list.bind(fs)
    let isArmed = true
    vi.spyOn(fs, 'list').mockImplementation(async (relative) => {
      if (isArmed && relative === RESOURCE_JOURNAL_ROOT) {
        isArmed = false
        const deletion = deleteThroughPage(folder)
        await deletion.done
        expect(deletion.posted).toContainEqual(expect.objectContaining({ outcome: 'completed' }))
      }
      return await realList(relative)
    })
    await writer.append(minute(Date.now() - 60_000))
    // Refused at the write, not only hidden by the read filter.
    expect(await journalMinuteLines(folder)).toEqual([])
    const history = await resourceHistoryReader(folder).read()
    expect(history.minutes).toEqual([])
  })

  it('makes Delete history wait for a live write already in flight, then removes it', async () => {
    const folder = await temporary()
    const fs = new NodeUsageFs(folder)
    const writer = new ResourceJournal(fs, {
      writerId: 'window',
      now: Date.now,
      isEnabled: () => true,
      resetAtMs: () => readResourceReset(folder),
    })
    // Stored history, so an unlocked delete has a usage folder to remove.
    await writer.append(minute(Date.now() - 120_000))
    const realWrite = fs.writeFileAtomically.bind(fs)
    let deletion: ReturnType<typeof deleteThroughPage> | undefined
    vi.spyOn(fs, 'writeFileAtomically').mockImplementation(async (relative, text) => {
      if (deletion === undefined && relative.includes('/live/')) {
        deletion = deleteThroughPage(folder)
        // Unlocked, the delete would remove the folder now; locked, it must wait.
        await waitUntil(async () => !(await isPresent(path.join(folder, 'usage'))), 500)
      }
      await realWrite(relative, text)
    })
    await writer.writeLive(minute(Date.now() - 1000))
    await deletion?.done
    expect(deletion?.posted).toContainEqual(expect.objectContaining({ outcome: 'completed' }))
    // The delete ran after the write, so it removed it: nothing is left on disk.
    expect(await liveFiles(folder)).toEqual([])
    const history = await resourceHistoryReader(folder).read()
    expect(history.minutes).toEqual([])
  })

  it('writes nothing stamped before a completed Delete history, journal or live', async () => {
    const folder = await temporary()
    const writer = windowJournal(folder, () => readResourceReset(folder))
    await writer.append(minute(Date.now() - 120_000))
    const deletion = deleteThroughPage(folder)
    await deletion.done
    expect(deletion.posted).toContainEqual(expect.objectContaining({ outcome: 'completed' }))
    await writer.append(minute(Date.now() - 60_000))
    await writer.writeLive(minute(Date.now() - 1000))
    expect(await journalMinuteLines(folder)).toEqual([])
    expect(await liveFiles(folder)).toEqual([])
  })

  it('never writes once the write lock is no longer held', async () => {
    const folder = await temporary()
    const fs = new NodeUsageFs(folder)
    const acquire = fs.acquireLock.bind(fs)
    vi.spyOn(fs, 'acquireLock').mockImplementation(async (relative, staleMs) => {
      const lock = await acquire(relative, staleMs)
      return lock === undefined ? undefined : { ...lock, isHeld: () => Promise.resolve(false) }
    })
    const writer = new ResourceJournal(fs, {
      writerId: 'window',
      now: Date.now,
      isEnabled: () => true,
    })
    await expect(writer.append(minute(Date.now() - 60_000))).rejects.toThrow(
      'resourceHistoryLockLost',
    )
    expect(await journalMinuteLines(folder)).toEqual([])
  })

  it('rolls nothing up from before the boundary when the delete never removed it', async () => {
    const folder = await temporary()
    const day = utcDay(Date.now() - 2 * 86_400_000)
    const dayFolder = path.join(resourcesRoot(folder), day)
    await mkdir(dayFolder, { recursive: true })
    await writeFile(
      path.join(dayFolder, 'w.0.jsonl'),
      `${JSON.stringify({ v: RESOURCE_JOURNAL_VERSION, record: minute(Date.parse(`${day}T12:00:00Z`)) })}\n`,
    )
    await writeResourceReset(folder, Date.now())
    const journal = new ResourceJournal(new NodeUsageFs(folder), {
      writerId: 'reader',
      now: Date.now,
      isEnabled: () => false,
      resetAtMs: () => readResourceReset(folder),
    })
    await journal.retain()
    const read = await journal.read()
    // The completed day is rolled up, with nothing from before the boundary in it.
    expect(read.days.find((row) => row.day === day)?.minutes).toBe(0)
  })

  it('hides records at or before the boundary even when their removal never happened', async () => {
    const folder = await temporary()
    const writer = windowJournal(folder)
    await writer.append(minute(Date.now() - 60_000))
    await writer.writeLive(minute(Date.now() - 1000))
    // A boundary written, then the process stopped before removing the folder.
    await writeResourceReset(folder, Date.now())
    const history = await resourceHistoryReader(folder).read()
    expect(history.minutes).toEqual([])
  })
})

describe('RVM107W2G P2-3: a swap during the quarantine rename never loses an outside entry', () => {
  it('leaves the outside entry intact; Linux pins the parent so it is not even renamed', async () => {
    const root = await temporary()
    const data = path.join(root, 'data')
    const outside = path.join(root, 'outside')
    await mkdir(path.join(outside, '2026-01-01'), { recursive: true })
    await writeFile(path.join(outside, '2026-01-01', 'proof'), 'keep')
    const ours = path.join(resourcesRoot(data), '2026-01-01')
    await mkdir(ours, { recursive: true })
    await writeFile(path.join(ours, 'w.0.jsonl'), '')
    let isSwapped = false
    vi.mocked(fsPromises.rename).mockImplementation(async (from, to) => {
      if (!isSwapped && path.basename(String(to)).startsWith(TRASH)) {
        isSwapped = true
        // Swap the parent for a link to outside data, rename, then swap back.
        const real = path.join(root, 'real-resources')
        await actual.rename(resourcesRoot(data), real)
        await symlink(outside, resourcesRoot(data), 'junction')
        try {
          await actual.rename(from, to)
        } finally {
          await actual.rm(resourcesRoot(data), { force: true })
          await actual.rename(real, resourcesRoot(data))
        }
        return
      }
      await actual.rename(from, to)
    })
    const fs = new NodeUsageFs(data)
    let outcome = 'removed'
    try {
      await fs.remove(`${RESOURCE_JOURNAL_ROOT}/2026-01-01`)
    } catch (error) {
      outcome = error instanceof Error ? error.message : 'failed'
    }
    // Whatever the platform: the outside bytes survive and nothing outside is deleted.
    const outsideNames = await readdir(outside)
    expect(outsideNames).toHaveLength(1)
    expect(await readFile(path.join(outside, outsideNames[0] ?? '', 'proof'), 'utf8')).toBe('keep')
    if (process.platform === 'linux') {
      expect(outcome).toBe('removed')
      expect(outsideNames).toEqual(['2026-01-01'])
      expect(await isPresent(ours)).toBe(false)
    } else if (process.platform === 'win32') {
      // The handle on our entry pins every ancestor: the swap itself is refused.
      expect(outcome).toMatch(/EPERM/u)
      expect(outsideNames).toEqual(['2026-01-01'])
      expect(await isPresent(ours)).toBe(true)
    } else {
      // macOS, path-based rename: the documented residual. Refused, ours untouched.
      expect(outcome).toBe('usagePathChanged')
      expect(await isPresent(ours)).toBe(true)
    }
  })

  it('puts our entry back under its own name when the parent changes after the rename', async () => {
    const root = await temporary()
    const data = path.join(root, 'data')
    const outside = path.join(root, 'outside')
    const moved = path.join(root, 'moved')
    await mkdir(outside, { recursive: true })
    const ours = path.join(resourcesRoot(data), '2026-01-01')
    await mkdir(ours, { recursive: true })
    await writeFile(path.join(ours, 'w.0.jsonl'), 'ours')
    let swap = 'none'
    vi.mocked(fsPromises.rename).mockImplementation(async (from, to) => {
      await actual.rename(from, to)
      if (swap !== 'none' || !path.basename(String(to)).startsWith(TRASH)) return
      // Right after the quarantine rename, the parent's path becomes a link.
      try {
        await actual.rename(resourcesRoot(data), moved)
        await symlink(outside, resourcesRoot(data), 'junction')
        swap = 'swapped'
      } catch {
        swap = 'refused'
      }
    })
    let outcome = 'removed'
    try {
      await new NodeUsageFs(data).remove(`${RESOURCE_JOURNAL_ROOT}/2026-01-01`)
    } catch (error) {
      outcome = error instanceof Error ? error.message : 'failed'
    }
    expect(await readdir(outside)).toEqual([])
    if (process.platform === 'linux') {
      // The pinned parent: the quarantine is ours, the path changed, so it goes back.
      expect(swap).toBe('swapped')
      expect(outcome).toBe('usagePathChanged')
      expect(await readdir(moved)).toEqual(['2026-01-01'])
      expect(await readFile(path.join(moved, '2026-01-01', 'w.0.jsonl'), 'utf8')).toBe('ours')
    } else if (process.platform === 'win32') {
      // The handle on our entry pins the parent: no swap, a normal removal.
      expect(swap).toBe('refused')
      expect(outcome).toBe('removed')
    } else {
      // macOS: unreachable through the swapped path, so it stays quarantined, never deleted.
      expect(outcome).toBe('usagePathChanged')
      expect(await quarantined(moved)).toHaveLength(1)
    }
  })

  it('keeps a swap during a quarantine sweep from deleting outside (Linux, Windows)', async () => {
    const root = await temporary()
    const data = path.join(root, 'data')
    const outside = path.join(root, 'outside')
    const stale = `.removing-1000.00000000-0000-0000-0000-000000000000.2026-01-01`
    // An outside entry that already carries the quarantine name.
    await mkdir(path.join(outside, stale), { recursive: true })
    await writeFile(path.join(outside, stale, 'proof'), 'keep')
    await mkdir(path.join(resourcesRoot(data), stale), { recursive: true })
    await writeFile(path.join(resourcesRoot(data), stale, 'w.0.jsonl'), '')
    let swap = 'none'
    vi.mocked(fsPromises.rm).mockImplementation(async (...args) => {
      if (swap !== 'none' || path.basename(String(args[0])) !== stale) {
        await actual.rm(...args)
        return
      }
      // Swap the parent for a link to outside data right before the delete.
      const real = path.join(root, 'real-resources')
      try {
        await actual.rename(resourcesRoot(data), real)
      } catch {
        swap = 'refused'
        await actual.rm(...args)
        return
      }
      swap = 'swapped'
      await symlink(outside, resourcesRoot(data), 'junction')
      try {
        await actual.rm(...args)
      } finally {
        await actual.rm(resourcesRoot(data), { force: true })
        await actual.rename(real, resourcesRoot(data))
      }
    })
    let outcome = 'swept'
    try {
      await new NodeUsageFs(data).sweep(RESOURCE_JOURNAL_ROOT)
    } catch (error) {
      outcome = error instanceof Error ? error.message : 'failed'
    }
    if (process.platform === 'darwin') {
      // The documented macOS residual: the delete follows the swapped path.
      expect(swap).toBe('swapped')
      expect(outcome).toBe('usageRemoveIncomplete')
      return
    }
    expect(swap).toBe(process.platform === 'win32' ? 'refused' : 'swapped')
    expect(outcome).toBe('swept')
    expect(await readFile(path.join(outside, stale, 'proof'), 'utf8')).toBe('keep')
    expect(await quarantined(resourcesRoot(data))).toEqual([])
  })
})

describe('Windows profile links: a link above the data folder is normal', () => {
  it('reads, writes and removes through a data folder reached by a junction or symlink', async () => {
    const root = await temporary()
    const real = path.join(root, 'D-drive', 'AppData')
    await mkdir(real, { recursive: true })
    const linked = path.join(root, 'profile-AppData')
    await symlink(real, linked, 'junction')
    const fs = new NodeUsageFs(linked)
    const journal = new ResourceJournal(fs, {
      writerId: 'window',
      now: Date.now,
      isEnabled: () => true,
    })
    const atMs = Date.now() - 60_000
    await journal.append(minute(atMs))
    const read = await journal.read()
    expect(read.records.map((record) => record.atMs)).toEqual([atMs])
    await fs.remove(`${RESOURCE_JOURNAL_ROOT}/${utcDay(atMs)}`)
    expect(await fs.list(RESOURCE_JOURNAL_ROOT)).not.toContain(utcDay(atMs))
    await fs.remove('usage')
    expect(await isPresent(path.join(real, 'usage'))).toBe(false)
    expect(await isPresent(linked)).toBe(true)
  })
})

async function isPresent(file: string): Promise<boolean> {
  try {
    await actual.lstat(file)
    return true
  } catch {
    return false
  }
}
