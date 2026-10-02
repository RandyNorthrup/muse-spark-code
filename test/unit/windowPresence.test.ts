import { randomUUID } from 'node:crypto'
import { mkdtempSync, realpathSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { isLegacyWindow, WindowPresence } from '../../src/host/checkpoints/windowPresence'
import {
  CHECKPOINT_ACTIVITY_PREFIX,
  CHECKPOINT_FENCED_WINDOW,
  CHECKPOINT_LEGACY_FENCED_WINDOW,
  CHECKPOINT_NATIVE_WINDOW,
} from '../../src/shared/constants'
import { removeFolder } from './helpers/temporaryFolders'

// The wrappers remain real filesystem calls; this mutable ESM facade lets
// each race stop at one operation without mocking the filesystem state.
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof fs>()),
}))

const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-window-presence-')))
const GONE_PID = 424_242
const OLD_PRESENCE_MS = 10 * 60 * 1000
afterAll(() => removeFolder(base))
afterEach(() => {
  vi.restoreAllMocks()
})

function windowIn(storageDir = path.join(base, randomUUID()), instance = 'self') {
  const presence = new WindowPresence({
    storageDir,
    instance,
    pid: process.pid,
    isProcessAlive: (pid) => pid !== GONE_PID,
    sleep: () => Promise.resolve(),
    signal: new AbortController().signal,
  })
  const file = path.join(storageDir, 'windows', `${instance}.json`)
  return { presence, storageDir, file }
}

async function makeStale(file: string): Promise<void> {
  const old = new Date(Date.now() - OLD_PRESENCE_MS - 1000)
  await fs.utimes(file, old, old)
}

async function writePresence(file: string, pid: number, running: readonly string[]): Promise<void> {
  await fs.writeFile(
    file,
    JSON.stringify({ instance: 'other', pid, running: [CHECKPOINT_FENCED_WINDOW, ...running] }),
  )
}

async function stalePeer() {
  const one = windowIn()
  const two = windowIn(one.storageDir, 'other')
  await one.presence.publish([])
  await writePresence(two.file, GONE_PID, ['old'])
  await makeStale(two.file)
  return { one, two }
}

describe('WindowPresence (M72, M86)', () => {
  it('keeps a known live process even when its heartbeat is old', async () => {
    const one = windowIn()
    const two = windowIn(one.storageDir, 'other')
    await one.presence.publish([])
    await two.presence.publish([CHECKPOINT_FENCED_WINDOW, 'running'])
    await makeStale(two.file)
    const live = await one.presence.liveWindows()
    expect(live.get('other')).toEqual([CHECKPOINT_FENCED_WINDOW, 'running'])
    const files = await fs.readdir(path.join(one.storageDir, 'windows'))
    expect(files.toSorted((left, right) => left.localeCompare(right))).toEqual([
      'other.json',
      'self.json',
    ])
  })
  it('keeps unknown unreadable presence closed even after it ages', async () => {
    const one = windowIn()
    await one.presence.publish([])
    const unreadable = path.join(one.storageDir, 'windows', 'unreadable.json')
    await fs.writeFile(unreadable, '{bad json')
    const fresh = await one.presence.liveWindows()
    expect(fresh.get('unreadable')).toEqual(['unreadable-presence'])
    await makeStale(unreadable)
    const stale = await one.presence.liveWindows()
    expect(stale.get('unreadable')).toEqual(['unreadable-presence'])
  })
  it('publishes independent windows and running turns, then removes only itself', async () => {
    const one = windowIn()
    const two = windowIn(one.storageDir, 'other')
    await one.presence.publish([CHECKPOINT_FENCED_WINDOW, 'first'])
    await two.presence.publish([CHECKPOINT_FENCED_WINDOW, 'second'])
    expect([...(await one.presence.liveWindows())]).toEqual([
      ['self', [CHECKPOINT_FENCED_WINDOW, 'first']],
      ['other', [CHECKPOINT_FENCED_WINDOW, 'second']],
    ])
    one.presence.leave()
    expect([...(await two.presence.liveWindows())]).toEqual([
      ['other', [CHECKPOINT_FENCED_WINDOW, 'second']],
    ])
    expect(await fs.readdir(path.join(one.storageDir, 'windows'))).toEqual(['other.json'])
  })

  it('rewrites a presence removed while the window still runs', async () => {
    const one = windowIn()
    await one.presence.publish(['first'])
    await fs.rm(one.file)
    await one.presence.beat()
    expect(JSON.parse(await fs.readFile(one.file, 'utf8'))).toMatchObject({ running: ['first'] })
  })

  it('cleans a dead process’s presence', async () => {
    const one = windowIn()
    await one.presence.publish([])
    const other = path.join(one.storageDir, 'windows', 'dead.json')
    await fs.writeFile(
      other,
      JSON.stringify({
        instance: 'dead',
        pid: GONE_PID,
        running: [CHECKPOINT_FENCED_WINDOW, 'old'],
      }),
    )
    const live = await one.presence.liveWindows()
    expect(live.has('dead')).toBe(false)
    await expect(fs.stat(other)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps a heartbeat that refreshed the file just before its stale cleanup move', async () => {
    const { one, two } = await stalePeer()
    const original = fs.rename
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (from === two.file && String(to).endsWith('.aside')) {
        await writePresence(two.file, process.pid, ['fresh'])
      }
      await original(from, to)
    })
    const refreshed = await one.presence.liveWindows()
    expect(refreshed.get('other')).toEqual([CHECKPOINT_FENCED_WINDOW, 'fresh'])
    expect(JSON.parse(await fs.readFile(two.file, 'utf8'))).toMatchObject({
      running: [CHECKPOINT_FENCED_WINDOW, 'fresh'],
    })
  })

  it('keeps a fresh replacement written while the stale presence is aside', async () => {
    const { one, two } = await stalePeer()
    const original = fs.rename
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      await original(from, to)
      if (from === two.file && String(to).endsWith('.aside')) {
        await writePresence(two.file, process.pid, ['fresh'])
      }
    })
    const refreshed = await one.presence.liveWindows()
    expect(refreshed.get('other')).toEqual([CHECKPOINT_FENCED_WINDOW, 'fresh'])
  })

  it('keeps native or legacy unknown presence despite owner death and age', async () => {
    const one = windowIn()
    await one.presence.publish([CHECKPOINT_FENCED_WINDOW])
    for (const running of [[CHECKPOINT_FENCED_WINDOW, CHECKPOINT_NATIVE_WINDOW], []]) {
      const file = path.join(one.storageDir, 'windows', `${randomUUID()}.json`)
      await fs.writeFile(file, JSON.stringify({ instance: 'unsafe', pid: GONE_PID, running }))
      await makeStale(file)
      const live = await one.presence.liveWindows()
      expect(live.get(path.basename(file, '.json'))).toEqual(running)
      expect(await fs.stat(file)).toBeDefined()
    }
  })

  it('keeps an active command after owner death or leave without claiming shutdown', async () => {
    const one = windowIn()
    const running = [CHECKPOINT_FENCED_WINDOW, `${CHECKPOINT_ACTIVITY_PREFIX}owned`]
    await one.presence.publish(running)
    one.presence.leave()
    expect(await fs.stat(one.file)).toBeDefined()
    const other = path.join(one.storageDir, 'windows', 'dead-activity.json')
    await fs.writeFile(other, JSON.stringify({ instance: 'dead-activity', pid: GONE_PID, running }))
    await makeStale(other)
    const live = await one.presence.liveWindows()
    expect(live.get('dead-activity')).toEqual([CHECKPOINT_NATIVE_WINDOW, ...running])
    expect(await fs.stat(other)).toBeDefined()
  })

  it('does not resurrect a window that leaves during an in-flight write', async () => {
    const one = windowIn()
    const original = fs.mkdir
    const resumed = Promise.withResolvers<undefined>()
    const waiting = Promise.withResolvers<undefined>()
    vi.spyOn(fs, 'mkdir').mockImplementation(async (folder, options) => {
      waiting.resolve(undefined)
      await resumed.promise
      return await original(folder, options)
    })
    const writing = one.presence.publish([CHECKPOINT_FENCED_WINDOW, 'old'])
    await waiting.promise
    one.presence.leave()
    resumed.resolve(undefined)
    await writing
    await one.presence.beat()
    await expect(fs.stat(one.file)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

/** A 0.10.0 window's presence: the v1 fence only. */
async function legacyPresence(storageDir: string, pid: number): Promise<string> {
  const file = path.join(storageDir, 'windows', 'legacy.json')
  await fs.writeFile(
    file,
    JSON.stringify({ instance: 'legacy', pid, running: [CHECKPOINT_LEGACY_FENCED_WINDOW] }),
  )
  return file
}

describe('windows of 0.10.0 (M86, spec 7)', () => {
  it('tells a 0.10.0 window by its v1 fence alone', () => {
    expect(isLegacyWindow([CHECKPOINT_LEGACY_FENCED_WINDOW, 'turn'])).toBe(true)
    expect(isLegacyWindow([CHECKPOINT_FENCED_WINDOW])).toBe(false)
    expect(isLegacyWindow([CHECKPOINT_FENCED_WINDOW, CHECKPOINT_LEGACY_FENCED_WINDOW])).toBe(false)
    expect(isLegacyWindow([])).toBe(false)
  })

  it('P: leaves its file when it closes after seeing a live 0.10.0 window, so that window stays fenced', async () => {
    const one = windowIn()
    await one.presence.publish([CHECKPOINT_FENCED_WINDOW])
    await legacyPresence(one.storageDir, process.pid)
    const seen = await one.presence.liveWindows()
    expect(seen.get('legacy')).toEqual([CHECKPOINT_LEGACY_FENCED_WINDOW])
    one.presence.leave()
    expect(JSON.parse(await fs.readFile(one.file, 'utf8'))).toMatchObject({
      running: [CHECKPOINT_FENCED_WINDOW],
    })
  })

  it('P: removes a gone window’s left file only once no 0.10.0 window is live', async () => {
    const one = windowIn()
    await one.presence.publish([CHECKPOINT_FENCED_WINDOW])
    const left = path.join(one.storageDir, 'windows', 'left.json')
    await fs.writeFile(
      left,
      JSON.stringify({ instance: 'left', pid: GONE_PID, running: [CHECKPOINT_FENCED_WINDOW] }),
    )
    const legacy = await legacyPresence(one.storageDir, process.pid)
    const withLegacy = await one.presence.liveWindows()
    // Gone for this version, kept on disk for the 0.10.0 window.
    expect(withLegacy.has('left')).toBe(false)
    expect(await fs.stat(left)).toBeDefined()
    await fs.rm(legacy)
    await one.presence.liveWindows()
    await expect(fs.stat(left)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('P: counts a 0.10.0 window whose process is gone as gone', async () => {
    const one = windowIn()
    await one.presence.publish([CHECKPOINT_FENCED_WINDOW])
    const legacy = await legacyPresence(one.storageDir, GONE_PID)
    const live = await one.presence.liveWindows()
    expect(live.has('legacy')).toBe(false)
    await expect(fs.stat(legacy)).rejects.toMatchObject({ code: 'ENOENT' })
    one.presence.leave()
    await expect(fs.stat(one.file)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
