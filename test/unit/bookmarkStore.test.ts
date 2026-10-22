// M88 lane B: the bookmark store over an in-memory `globalState`. One state
// key holds every workspace's list under its URI digest; a damaged list is
// reported and kept as found while the other workspaces work as usual.
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { BookmarkStore, type BookmarkState } from '../../src/core/prompts/bookmarkStore'
import { BOOKMARK_SYNC_KEY } from '../../src/shared/constants'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { bookmarkRecordSchema, type BookmarkRecord } from '../../src/shared/protocol'

const FIRST_URI = 'file:///Users/person/first.code-workspace'
const SECOND_URI = 'file:///Users/person/second'

function memoryState(): BookmarkState & {
  values: Map<string, unknown>
  writes: () => number
} {
  const values = new Map<string, unknown>()
  let writes = 0
  return {
    values,
    writes: () => writes,
    get: (key) => Promise.resolve(values.get(key)),
    update: (key, value) => {
      writes += 1
      values.set(key, value)
      return Promise.resolve()
    },
  }
}

function storedUris(values: Map<string, unknown>): string {
  return JSON.stringify(values.get(BOOKMARK_SYNC_KEY))
}

/** Seeds s-1 at 1000 and s-2 at 2000; the clock stays the caller's. */
async function seedTwo(store: BookmarkStore, setNow: (now: number) => void): Promise<void> {
  await store.set({ backend: 'modelApi', sessionId: 's-1', title: 'First', isBookmarked: true })
  setNow(2000)
  await store.set({ backend: 'modelApi', sessionId: 's-2', title: 'Second', isBookmarked: true })
}

function unbook(
  store: BookmarkStore,
  sessionId: string,
  title: string,
): Promise<readonly BookmarkRecord[]> {
  return store.set({ backend: 'modelApi', sessionId, title, isBookmarked: false })
}

/** A store seeded with s-1: exactly one write so far. */
async function seededOnce(): Promise<{
  state: ReturnType<typeof memoryState>
  store: BookmarkStore
}> {
  const state = memoryState()
  const store = new BookmarkStore(state, FIRST_URI, () => 1000)
  await store.set({ backend: 'modelApi', sessionId: 's-1', title: 'First', isBookmarked: true })
  expect(state.writes()).toBe(1)
  return { state, store }
}

/** Two workspaces sharing one state, each seeded with its first bookmark. */
async function twoWorkspaces(secondInput: {
  backend: BookmarkRecord['backend']
  sessionId: string
  title: string
}): Promise<{
  state: ReturnType<typeof memoryState>
  first: BookmarkStore
  second: BookmarkStore
}> {
  const state = memoryState()
  const first = new BookmarkStore(state, FIRST_URI, () => 1000)
  const second = new BookmarkStore(state, SECOND_URI, () => 2000)
  await first.set({ backend: 'modelApi', sessionId: 's-1', title: 'First', isBookmarked: true })
  await second.set({ ...secondInput, isBookmarked: true })
  return { state, first, second }
}

describe('bookmark store', () => {
  it('sets, lists oldest first, finds and removes one workspace', async () => {
    const state = memoryState()
    let now = 1000
    const store = new BookmarkStore(state, FIRST_URI, () => now)
    await seedTwo(store, (at) => {
      now = at
    })
    expect(await store.list()).toEqual([
      { backend: 'modelApi', sessionId: 's-1', title: 'First', bookmarkedAtMs: 1000 },
      { backend: 'modelApi', sessionId: 's-2', title: 'Second', bookmarkedAtMs: 2000 },
    ])
    expect(await store.has('modelApi', 's-1')).toBe(true)
    expect(await store.has('modelApi', 's-9')).toBe(false)
    expect(await store.has('museCode', 's-1')).toBe(false)
    const after = await unbook(store, 's-1', 'First')
    expect(after.map((record) => record.sessionId)).toEqual(['s-2'])
    expect(await store.has('modelApi', 's-1')).toBe(false)
  })

  it('files each workspace under its own digest and stores no path', async () => {
    const { state, first, second } = await twoWorkspaces({
      backend: 'museCode',
      sessionId: 's-1',
      title: 'Other',
    })
    const firstList = await first.list()
    const secondList = await second.list()
    expect(firstList.map((record) => record.title)).toEqual(['First'])
    expect(secondList.map((record) => record.title)).toEqual(['Other'])
    expect(storedUris(state.values)).not.toContain('file:///')
    expect(storedUris(state.values)).not.toContain('person')
  })

  it('offers no bookmark without a folder', async () => {
    const state = memoryState()
    const store = new BookmarkStore(state, undefined, () => 1000)
    await expect(
      store.set({ backend: 'modelApi', sessionId: 's-1', title: 'First', isBookmarked: true }),
    ).rejects.toThrow(UI_TEXT.bookmarkNoWorkspace)
    expect(await store.list()).toEqual([])
    expect(await store.has('modelApi', 's-1')).toBe(false)
    expect(await store.refreshTitles([{ sessionId: 's-1', title: 'First' }])).toEqual([])
    expect(state.values.has(BOOKMARK_SYNC_KEY)).toBe(false)
  })

  it('re-setting keeps the bookmark time and its place, with the new title', async () => {
    const state = memoryState()
    let now = 1000
    const store = new BookmarkStore(state, FIRST_URI, () => now)
    await seedTwo(store, (at) => {
      now = at
    })
    now = 3000
    const after = await store.set({
      backend: 'modelApi',
      sessionId: 's-1',
      title: 'Renamed',
      isBookmarked: true,
    })
    expect(after).toEqual([
      { backend: 'modelApi', sessionId: 's-1', title: 'Renamed', bookmarkedAtMs: 1000 },
      { backend: 'modelApi', sessionId: 's-2', title: 'Second', bookmarkedAtMs: 2000 },
    ])
  })

  it('writes nothing when the set changes nothing', async () => {
    const { state, store } = await seededOnce()
    await store.set({ backend: 'modelApi', sessionId: 's-1', title: 'First', isBookmarked: true })
    await unbook(store, 's-9', 'Gone')
    expect(state.writes()).toBe(1)
  })

  it('refreshes titles from listed rows and keeps the missing ones', async () => {
    const state = memoryState()
    const store = new BookmarkStore(state, FIRST_URI, () => 1000)
    await store.set({ backend: 'modelApi', sessionId: 's-1', title: 'Old', isBookmarked: true })
    await store.set({ backend: 'modelApi', sessionId: 's-2', title: 'Stored', isBookmarked: true })
    const after = await store.refreshTitles([{ sessionId: 's-1', title: 'New' }])
    expect(after.map((record) => record.title)).toEqual(['New', 'Stored'])
    const relisted = await store.list()
    expect(relisted.map((record) => record.title)).toEqual(['New', 'Stored'])
  })

  it('refreshes nothing when the titles match', async () => {
    const { state, store } = await seededOnce()
    await store.refreshTitles([{ sessionId: 's-1', title: 'First' }])
    expect(state.writes()).toBe(1)
  })

  it('reports a damaged list, keeps it as found, and serves the other workspaces', async () => {
    const { state, first, second } = await twoWorkspaces({
      backend: 'modelApi',
      sessionId: 's-2',
      title: 'Second',
    })
    const before = storedUris(state.values)
    // Damage arrives through sync: this workspace's list is no longer a list.
    // The cast names the envelope this test's own sets wrote, to forge the damage.
    const damaged = JSON.parse(before) as { workspaces: Record<string, unknown> }
    const digests = Object.keys(damaged.workspaces)
    expect(digests).toHaveLength(2)
    const ownDigest = digests.find((digest) => {
      const parsed = z.array(bookmarkRecordSchema).safeParse(damaged.workspaces[digest])
      return parsed.success && parsed.data.some((record) => record.sessionId === 's-1')
    })
    expect(ownDigest).toBeDefined()
    if (ownDigest !== undefined) {
      damaged.workspaces[ownDigest] = { sessionId: 's-1' }
    }
    await state.update(BOOKMARK_SYNC_KEY, damaged)
    await expect(first.list()).rejects.toThrow(UI_TEXT.bookmarksUnavailable)
    await expect(first.has('modelApi', 's-1')).rejects.toThrow(UI_TEXT.bookmarksUnavailable)
    await expect(
      first.set({ backend: 'modelApi', sessionId: 's-3', title: 'Third', isBookmarked: true }),
    ).rejects.toThrow(UI_TEXT.bookmarksUnavailable)
    await expect(first.refreshTitles([])).rejects.toThrow(UI_TEXT.bookmarksUnavailable)
    // The other workspace reads and writes through, and the damaged bytes
    // pass through its write untouched.
    const secondList = await second.list()
    expect(secondList.map((record) => record.sessionId)).toEqual(['s-2'])
    await second.set({
      backend: 'modelApi',
      sessionId: 's-2',
      title: 'Renamed',
      isBookmarked: true,
    })
    // The cast names the envelope to prove the damaged bytes passed through untouched.
    const after = JSON.parse(storedUris(state.values)) as { workspaces: Record<string, unknown> }
    expect(ownDigest === undefined ? undefined : after.workspaces[ownDigest]).toEqual({
      sessionId: 's-1',
    })
  })

  it('reports a damaged envelope and refuses to write over it', async () => {
    const state = memoryState()
    await state.update(BOOKMARK_SYNC_KEY, { version: 2, workspaces: {} })
    const store = new BookmarkStore(state, FIRST_URI, () => 1000)
    await expect(store.list()).rejects.toThrow(UI_TEXT.bookmarksUnavailable)
    await expect(
      store.set({ backend: 'modelApi', sessionId: 's-1', title: 'First', isBookmarked: true }),
    ).rejects.toThrow(UI_TEXT.bookmarksUnavailable)
    expect(state.values.get(BOOKMARK_SYNC_KEY)).toEqual({ version: 2, workspaces: {} })
  })
})
