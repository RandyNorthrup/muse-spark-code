// M88 lane B: bookmarked sessions older than the loaded pages. The panel's
// main listing stops after five pages of two hundred; a bookmark past that
// bound pulls further pages until its id is found, and the stored title
// stands in for an id no page names. One thousand and two real sessions in
// the real file store, through the product's own host and controller.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoredSession } from '../../src/core/backends/modelapi/sessionStore'
import { BookmarkStore, type BookmarkState } from '../../src/core/prompts/bookmarkStore'
import { DEFAULT_MODEL_ID } from '../../src/shared/constants'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import {
  conversationPanel,
  modelApiRig,
  TEST_ACCOUNT_ID,
  type ModelApiRig,
} from './helpers/conversationPanel'
import { removeFolder } from './helpers/temporaryFolders'

// Five pages of two hundred, plus two: the bookmarked oldest sorts last.
const SESSION_COUNT = 1002
const BOOKMARKED_ID = 'page-0'
const ACTIVITY_BASE_MS = Date.parse('2026-10-01T00:00:00.000Z')

function storedSession(directory: string, index: number): StoredSession {
  const at = new Date(ACTIVITY_BASE_MS + index * 1000).toISOString()
  return {
    version: 1,
    sessionId: `page-${String(index)}`,
    accountId: TEST_ACCOUNT_ID,
    workspaceRoot: directory,
    modelId: DEFAULT_MODEL_ID,
    approvalMode: 'promptUnmatched',
    effort: 'high',
    name: `Conversation ${String(index)}`,
    createdAt: at,
    lastActivityAt: at,
    turnIds: [],
    firstPrompt: `prompt ${String(index)}`,
    todos: [],
    replay: [],
    transcript: [],
    outputs: {},
    usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
  }
}

function memoryState(): BookmarkState {
  const values = new Map<string, unknown>()
  return {
    get: (key) => Promise.resolve(values.get(key)),
    update: (key, value) => {
      values.set(key, value)
      return Promise.resolve()
    },
  }
}

function listedIds(posted: readonly HostToWebviewMessage[]): string[] {
  const lists = posted.filter((message) => message.type === 'sessionList')
  expect(lists).toHaveLength(1)
  const list = lists[0]
  if (list?.type !== 'sessionList') throw new Error('the panel posted no session list')
  return list.sessions.map((row) => row.sessionId)
}

describe('bookmarked sessions past the loaded pages', () => {
  let directory = ''
  let rig: ModelApiRig | undefined

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'muse-bookmark-paging-'))
    const next = modelApiRig(directory)
    for (let index = 0; index < SESSION_COUNT; index += 1) {
      await next.store.save(storedSession(directory, index))
    }
    await next.host.load()
    rig = next
  })
  afterAll(async () => {
    await removeFolder(directory)
  })

  it('loads further pages until the bookmarked id is found', async () => {
    if (rig === undefined) throw new Error('the rig never loaded')
    const bookmarks = new BookmarkStore(memoryState(), `file://${directory}`, () => 1000)
    await bookmarks.set({
      backend: 'modelApi',
      sessionId: BOOKMARKED_ID,
      title: 'Conversation 0',
      isBookmarked: true,
    })
    const panel = conversationPanel({ rig, directory, bookmarks })
    await panel.controller.handle({ type: 'listSessions' })
    const ids = listedIds(panel.posted)
    expect(ids).toContain(BOOKMARKED_ID)
    expect(ids).toHaveLength(SESSION_COUNT)
  })

  it('stops at the bound without the bookmark, and ignores the other backend', async () => {
    if (rig === undefined) throw new Error('the rig never loaded')
    const bookmarks = new BookmarkStore(memoryState(), `file://${directory}`, () => 1000)
    await bookmarks.set({
      backend: 'museCode',
      sessionId: BOOKMARKED_ID,
      title: 'Conversation 0',
      isBookmarked: true,
    })
    const panel = conversationPanel({ rig, directory, bookmarks })
    await panel.controller.handle({ type: 'listSessions' })
    const ids = listedIds(panel.posted)
    expect(ids).not.toContain(BOOKMARKED_ID)
    expect(ids).toHaveLength(1000)
  })
})
