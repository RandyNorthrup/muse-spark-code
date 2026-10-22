// M88 lane P: the panel's bookmark messages against the real controller,
// the product's own Model API host and the real file session store
// (helpers/conversationPanel.ts). The bookmark port is the test operator's
// in-memory workspace, as `emptySessionMemory` keeps History's: the
// controller's cases, the posted messages and the webview reducer's reads
// of them are production code, and every posted message parses.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BookmarkPort } from '../../src/host/conversation/featurePorts'
import { DEFAULT_MODEL_ID } from '../../src/shared/constants'
import { UI_TEXT } from '../../src/shared/l10n/text'
import {
  parseHostToWebviewMessage,
  type BookmarkRecord,
  type HostToWebviewMessage,
} from '../../src/shared/protocol'
import { initialUiState, uiReducer } from '../../src/webview/state/uiState'
import {
  awaitSaved,
  conversationPanel,
  modelApiRig,
  panelNotices,
} from './helpers/conversationPanel'
import { removeFolder } from './helpers/temporaryFolders'

function memoryBookmarks(): BookmarkPort & { records: BookmarkRecord[] } {
  const records: BookmarkRecord[] = []
  return {
    records,
    list: () => Promise.resolve([...records]),
    set: (input) => {
      const at = records.findIndex(
        (record) => record.backend === input.backend && record.sessionId === input.sessionId,
      )
      if (at === -1 && input.isBookmarked) {
        records.push({
          backend: input.backend,
          sessionId: input.sessionId,
          title: input.title,
          bookmarkedAtMs: 1000,
        })
      } else if (at !== -1 && !input.isBookmarked) {
        records.splice(at, 1)
      }
      return Promise.resolve([...records])
    },
    has: (backend, sessionId) =>
      Promise.resolve(
        records.some((record) => record.backend === backend && record.sessionId === sessionId),
      ),
    refreshTitles: (rows) => {
      for (const record of records) {
        const row = rows.find((candidate) => candidate.sessionId === record.sessionId)
        if (row !== undefined) record.title = row.title
      }
      return Promise.resolve([...records])
    },
  }
}

function shownState(posted: readonly HostToWebviewMessage[]) {
  let state = initialUiState
  for (const raw of posted) {
    const parsed = parseHostToWebviewMessage(raw)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) state = uiReducer(state, { type: 'hostMessage', message: parsed.message, at: 0 })
  }
  return state
}

describe('bookmark messages through the panel', () => {
  let directory = ''

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'muse-bookmark-panel-'))
  })
  afterEach(async () => {
    await removeFolder(directory)
  })

  it('sets and removes a bookmark, and the panel reads both', async () => {
    const bookmarks = memoryBookmarks()
    const rig = modelApiRig(directory)
    const panel = conversationPanel({ rig, directory, bookmarks })
    const live = await rig.host.startSession({
      workspaceRoot: directory,
      modelId: DEFAULT_MODEL_ID,
      approvalMode: 'promptUnmatched',
    })
    await live.rename('Parser fix')
    await awaitSaved(rig, live.sessionId)

    await panel.controller.handle({
      type: 'bookmarkSet',
      backend: 'modelApi',
      sessionId: live.sessionId,
      title: 'Parser fix',
      isBookmarked: true,
    })
    let state = shownState(panel.posted)
    expect(state.bookmarks?.map((record) => record.sessionId)).toEqual([live.sessionId])

    await panel.controller.handle({
      type: 'bookmarkSet',
      backend: 'modelApi',
      sessionId: live.sessionId,
      title: 'Parser fix',
      isBookmarked: false,
    })
    state = shownState(panel.posted)
    expect(state.bookmarks).toEqual([])
    expect(panelNotices(panel.posted)).toEqual([])
    live.dispose()
  })

  it('lists the bookmarks with the sessions, titles refreshed from the rows', async () => {
    const bookmarks = memoryBookmarks()
    const rig = modelApiRig(directory)
    const panel = conversationPanel({ rig, directory, bookmarks })
    const live = await rig.host.startSession({
      workspaceRoot: directory,
      modelId: DEFAULT_MODEL_ID,
      approvalMode: 'promptUnmatched',
    })
    await live.rename('Parser fix')
    await awaitSaved(rig, live.sessionId)
    bookmarks.records.push({
      backend: 'modelApi',
      sessionId: live.sessionId,
      title: 'A stale title',
      bookmarkedAtMs: 500,
    })

    await panel.controller.handle({ type: 'listSessions' })
    const state = shownState(panel.posted)
    expect(state.sessions?.map((row) => row.sessionId)).toContain(live.sessionId)
    expect(state.bookmarks).toEqual([
      {
        backend: 'modelApi',
        sessionId: live.sessionId,
        title: 'Parser fix',
        bookmarkedAtMs: 500,
      },
    ])
    live.dispose()
  })

  it('refuses with an explicit error while the port is missing', async () => {
    const rig = modelApiRig(directory)
    const panel = conversationPanel({ rig, directory })
    await panel.controller.handle({
      type: 'bookmarkSet',
      backend: 'modelApi',
      sessionId: 's1',
      title: 'Parser fix',
      isBookmarked: true,
    })
    expect(panelNotices(panel.posted)).toEqual([
      { level: 'error', text: UI_TEXT.bookmarksUnavailable },
    ])
  })

  it('says a failing store in fixed words only', async () => {
    const rig = modelApiRig(directory)
    const failing: BookmarkPort = {
      ...memoryBookmarks(),
      set: () => Promise.reject(new Error('/private/tmp/bookmarks leaked by a bug')),
    }
    const panel = conversationPanel({ rig, directory, bookmarks: failing })
    await panel.controller.handle({
      type: 'bookmarkSet',
      backend: 'modelApi',
      sessionId: 's1',
      title: 'Parser fix',
      isBookmarked: true,
    })
    expect(panelNotices(panel.posted)).toEqual([
      { level: 'warning', text: UI_TEXT.bookmarksUnavailable },
    ])
  })
})
