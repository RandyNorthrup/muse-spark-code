// RVM107W2: regressions for the reviewed P1/P2 findings, each through the
// production path the reviewer used.
import * as fsPromises from 'node:fs/promises'
import type * as FsPromises from 'node:fs/promises'
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { admitResource, configureResources } from '../../src/core/resources/admission'
import type { UsageFs } from '../../src/core/usage/journalStore'
import { RESOURCE_JOURNAL_ROOT, ResourceJournal } from '../../src/core/usage/resourceJournal'
import { ResourceRecords } from '../../src/core/usage/resourceRecords'
import { resourceHistoryReader, resourceHistoryRecorder } from '../../src/runtime/resources/history'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'
import { createUsageAccess } from '../../src/runtime/usage/usageServiceEntry'
import {
  RESOURCE_JOURNAL_FILE_MAX_BYTES,
  RESOURCE_JOURNAL_READ_MAX_BYTES,
  RESOURCE_JOURNAL_VERSION,
  USAGE_SETTINGS_FILE,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { FakeLogOutputChannel } from './helpers/fakes'
import { historyStatus } from './helpers/resources/history'
import { removeFolder } from './helpers/temporaryFolders'

vi.mock('node:fs/promises', async (original) => {
  const real = await original<typeof FsPromises>()
  return { ...real, rm: vi.fn(real.rm), rename: vi.fn(real.rename) }
})
const actual = await vi.importActual<typeof FsPromises>('node:fs/promises')
const DAY_NAME = /^\d{4}-\d{2}-\d{2}$/u
const NOW = Date.UTC(2026, 9, 7, 12)

const folders: string[] = []
afterEach(async () => {
  vi.mocked(fsPromises.rm).mockImplementation(actual.rm)
  vi.mocked(fsPromises.rename).mockImplementation(actual.rename)
  for (const folder of folders.splice(0)) await removeFolder(folder)
})
async function temporary(): Promise<string> {
  await mkdir('temp', { recursive: true })
  const folder = await mkdtemp(path.resolve('temp/rvm107w2-'))
  folders.push(folder)
  return folder
}
function resourcesRoot(folder: string): string {
  return path.join(folder, ...RESOURCE_JOURNAL_ROOT.split('/'))
}
async function names(folder: string): Promise<string[]> {
  try {
    return await readdir(folder)
  } catch {
    return []
  }
}
/** Every complete minute line in the journal's day files (not the live file). */
async function journalMinuteLines(folder: string): Promise<string[]> {
  const lines: string[] = []
  const days = await names(resourcesRoot(folder))
  for (const day of days) {
    if (!DAY_NAME.test(day)) continue
    const files = await readdir(path.join(resourcesRoot(folder), day))
    for (const file of files) {
      const text = await readFile(path.join(resourcesRoot(folder), day, file), 'utf8')
      lines.push(...text.split('\n').filter((line) => line.includes('"minute":{')))
    }
  }
  return lines
}
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
  return { other, journal, swap }
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
    const root = await temporary()
    const data = path.join(root, 'data')
    const other = path.join(root, 'unrelated')
    await mkdir(path.join(other, '2026-01-01'), { recursive: true })
    await writeFile(path.join(other, '2026-01-01', 'proof'), 'keep')
    await mkdir(path.join(resourcesRoot(data), '2026-01-01'), { recursive: true })
    vi.mocked(fsPromises.rm).mockImplementationOnce(async (...args) => {
      await actual.rename(resourcesRoot(data), path.join(root, 'moved'))
      await symlink(other, resourcesRoot(data), 'junction')
      await actual.rm(...args)
    })
    const fs = new NodeUsageFs(data)
    await expect(fs.remove(`${RESOURCE_JOURNAL_ROOT}/2026-01-01`)).rejects.toThrow(
      'usagePathChanged',
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
    const recorder = resourceHistoryRecorder(
      { dataFolder: folder, isEnabled: () => true },
      { read: () => Promise.resolve([]) },
      vi.fn(),
    )
    // The reviewer's sequence: an open minute collected while off, then consent, then a flush.
    recorder.sample(historyStatus(Date.now()))
    await writeFile(path.join(folder, USAGE_SETTINGS_FILE), '{"enabled":true,"days":365}')
    await recorder.flush()
    const history = await resourceHistoryReader(folder).read()
    expect(history.minutes).toEqual([])
  })

  it('drops a collector open minute when Delete history completes through the usage page', async () => {
    const folder = await temporary()
    const recorder = resourceHistoryRecorder(
      { dataFolder: folder, isEnabled: () => true },
      { read: () => Promise.resolve([]) },
      vi.fn(),
    )
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
