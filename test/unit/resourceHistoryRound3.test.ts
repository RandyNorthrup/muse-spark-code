// RVM107W2G: regressions for the third review round, each through the
// production path the reviewer used.
import * as fsPromises from 'node:fs/promises'
import type * as FsPromises from 'node:fs/promises'
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { admitResource, configureResources } from '../../src/core/resources/admission'
import { RESOURCE_JOURNAL_ROOT, ResourceJournal } from '../../src/core/usage/resourceJournal'
import { resourceHistoryReader } from '../../src/runtime/resources/history'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'
import { readResourceReset, writeResourceReset } from '../../src/runtime/usage/resourceResetFile'
import { createUsageAccess } from '../../src/runtime/usage/usageServiceEntry'
import { RESOURCE_JOURNAL_VERSION } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import type { ResourceRecord } from '../../src/shared/resources'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'

vi.mock('node:fs/promises', async (original) => {
  const real = await original<typeof FsPromises>()
  return { ...real, rm: vi.fn(real.rm), rename: vi.fn(real.rename) }
})
const actual = await vi.importActual<typeof FsPromises>('node:fs/promises')
const TRASH = '.removing-'

const folders: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.mocked(fsPromises.rm).mockImplementation(actual.rm)
  vi.mocked(fsPromises.rename).mockImplementation(actual.rename)
  for (const folder of folders.splice(0)) await removeFolder(folder)
})
async function temporary(): Promise<string> {
  await mkdir('temp', { recursive: true })
  const folder = await mkdtemp(path.resolve('temp/rvm107w2g-'))
  folders.push(folder)
  return folder
}
function resourcesRoot(folder: string): string {
  return path.join(folder, ...RESOURCE_JOURNAL_ROOT.split('/'))
}
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
function access(folder: string) {
  return createUsageAccess({
    dataFolder: folder,
    packageRoot: process.cwd(),
    host: 'VS Code',
    locale: 'en',
    uiText: EN,
    log: new FakeLogOutputChannel(),
  })
}
/** Delete history through the production usage page connection. */
function deleteThroughPage(folder: string): { posted: unknown[]; done: Promise<void> } {
  const posted: unknown[] = []
  const connection = access(folder).connect({
    post: (message) => {
      posted.push(message)
    },
    confirmDelete: () => Promise.resolve(true),
  })
  return { posted, done: connection.receive({ type: 'usage/deleteHistory', requestId: 'delete' }) }
}
async function waitUntil(isDone: () => Promise<boolean>, limitMs: number): Promise<void> {
  const deadline = Date.now() + limitMs
  while (Date.now() < deadline) {
    if (await isDone()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('RVM107W2G P2-1: a failed quarantine delete is never reported as removed', () => {
  it('fails, then succeeds only once the target and its own quarantine are both gone', async () => {
    const folder = await temporary()
    const day = path.join(resourcesRoot(folder), '2026-01-01')
    await mkdir(day, { recursive: true })
    await writeFile(path.join(day, 'w.0.jsonl'), 'secret-history\n')
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
    const writer = new ResourceJournal(new NodeUsageFs(folder), {
      writerId: 'window',
      now: Date.now,
      isEnabled: () => true,
    })
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
    const day = path.join(resourcesRoot(folder), '2026-01-01')
    await mkdir(day, { recursive: true })
    await writeFile(path.join(day, 'w.0.jsonl'), 'secret-history\n')
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
    expect(await journalLines(folder)).toEqual([])
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
    const writer = new ResourceJournal(new NodeUsageFs(folder), {
      writerId: 'window',
      now: Date.now,
      isEnabled: () => true,
      resetAtMs: () => readResourceReset(folder),
    })
    await writer.append(minute(Date.now() - 120_000))
    const deletion = deleteThroughPage(folder)
    await deletion.done
    expect(deletion.posted).toContainEqual(expect.objectContaining({ outcome: 'completed' }))
    await writer.append(minute(Date.now() - 60_000))
    await writer.writeLive(minute(Date.now() - 1000))
    expect(await journalLines(folder)).toEqual([])
    expect(await liveFiles(folder)).toEqual([])
  })

  it('hides records at or before the boundary even when their removal never happened', async () => {
    const folder = await temporary()
    const writer = new ResourceJournal(new NodeUsageFs(folder), {
      writerId: 'window',
      now: Date.now,
      isEnabled: () => true,
    })
    await writer.append(minute(Date.now() - 60_000))
    await writer.writeLive(minute(Date.now() - 1000))
    // A boundary written, then the process stopped before removing the folder.
    await writeResourceReset(folder, Date.now())
    const history = await resourceHistoryReader(folder).read()
    expect(history.minutes).toEqual([])
  })

  it('keeps a disposed window append that outlives the 2 s flush wait from surviving a delete', async () => {
    const folder = await temporary()
    const { promise: blocked, resolve: release } = Promise.withResolvers<undefined>()
    let isBlocking = true
    const realAppend = NodeUsageFs.prototype.append
    vi.spyOn(NodeUsageFs.prototype, 'append').mockImplementation(async function (
      this: NodeUsageFs,
      relative,
      line,
      isDurable,
    ) {
      if (isBlocking && relative.endsWith('.jsonl')) {
        isBlocking = false
        await blocked
      }
      await realAppend.call(this, relative, line, isDurable)
    })
    const dispose = configureResources({
      inspect: () => undefined,
      onError: vi.fn(),
      history: { dataFolder: folder, isEnabled: () => true },
      tempRoots: {
        create: (owner) =>
          Promise.resolve({
            root: path.join(folder, owner),
            profile: path.join(folder, owner, 'profile'),
            cache: path.join(folder, owner, 'cache'),
            environment: {},
            finish: () => Promise.resolve(),
          }),
      },
    })
    const lease = await admitResource('other', undefined, 'foreground')
    lease?.complete(true)
    await waitUntil(async () => {
      const live = await liveFiles(folder)
      return live.length > 0
    }, 3000)
    dispose()
    // The disposal flush is now blocked inside its append.
    await waitUntil(() => Promise.resolve(!isBlocking), 3000)
    expect(isBlocking).toBe(false)
    const deletion = deleteThroughPage(folder)
    await new Promise((resolve) => setTimeout(resolve, 300))
    release(undefined)
    await deletion.done
    expect(deletion.posted).toContainEqual(expect.objectContaining({ outcome: 'completed' }))
    await new Promise((resolve) => setTimeout(resolve, 300))
    // The delete waited for the append's lock, so it removed that line too.
    expect(await journalLines(folder)).toEqual([])
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
/** Minute lines in every day file, read straight from disk. */
async function journalLines(folder: string): Promise<string[]> {
  const lines: string[] = []
  let days: string[]
  try {
    days = await readdir(resourcesRoot(folder))
  } catch {
    return []
  }
  for (const day of days) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) continue
    const files = await readdir(path.join(resourcesRoot(folder), day))
    for (const file of files) {
      const text = await readFile(path.join(resourcesRoot(folder), day, file), 'utf8')
      lines.push(...text.split('\n').filter((line) => line.includes('"minute":{')))
    }
  }
  return lines
}
async function liveFiles(folder: string): Promise<string[]> {
  try {
    return await readdir(path.join(resourcesRoot(folder), 'live'))
  } catch {
    return []
  }
}
