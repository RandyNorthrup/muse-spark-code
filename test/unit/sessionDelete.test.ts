// History's Delete, proven against the real session store on the real file
// system: a saved conversation lists, `remove` takes its file for good, and
// the list no longer names it; removing an id that is already gone resolves.
// The Muse Code side stays refused wherever the CLI cannot answer
// `session/delete` (PLAN.md D26): the version gate pins that refusal to the
// measured probes (1.4.4's `methodNotFound`, 1.4.10's probe and schema
// export of 2026-10-18).

import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SessionMemory } from '../../src/host/conversation/conversationController'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import type {
  AgentSession,
  SessionListEvent,
  SessionRecord,
} from '../../src/core/agent/agentBackend'
import type { StoredSession } from '../../src/core/backends/modelapi/sessionStore'
import { canDeleteMuseSession } from '../../src/core/backends/musecode/museDeleteGate'
import { createFileSessionStore } from '../../src/host/backend/fileSessionStore'
import { DEFAULT_MODEL_ID, MILLISECONDS_PER_DAY } from '../../src/shared/constants'
import { fill, UI_TEXT } from '../../src/shared/l10n/text'
import { sessionTitle } from '../../src/shared/sessions'
import {
  awaitSaved,
  conversationPanel,
  modelApiRig,
  panelNotices,
  type ModelApiRig,
} from './helpers/conversationPanel'
import { removeFolder } from './helpers/temporaryFolders'

// A conversation as the product saves it, kept minimal: the store validates
// the shape, so only a shape the product itself accepts reaches the file.
const session: StoredSession = {
  version: 1,
  sessionId: 's1',
  workspaceRoot: '/ws',
  modelId: 'muse-spark-1.3',
  approvalMode: 'promptUnmatched',
  effort: 'high',
  name: 'Parser fix',
  createdAt: '2026-09-22T10:00:00.000Z',
  lastActivityAt: '2026-09-22T10:05:00.000Z',
  turnIds: [],
  firstPrompt: 'fix the parser',
  todos: [],
  replay: [],
  transcript: [],
  outputs: {},
  usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
}

describe('History delete against the real session store', () => {
  let directory = ''
  const store = () =>
    createFileSessionStore({
      directory,
      log: {
        trace: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
      retentionDays: () => 0,
      now: () => Date.now(),
      sleep: () => Promise.resolve(),
    })

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'muse-session-delete-'))
  })
  afterAll(async () => {
    await removeFolder(directory)
  })

  it('lists a saved conversation, then loses its file and its row on remove', async () => {
    const sessions = store()
    await sessions.save(session)
    const before = await sessions.list()
    expect(before.map((header) => header.sessionId)).toContain('s1')
    expect(await sessions.load('s1')).toBeDefined()

    await sessions.remove('s1')

    const after = await sessions.list()
    expect(after.map((header) => header.sessionId)).not.toContain('s1')
    expect(await sessions.load('s1')).toBeUndefined()
    expect(await readdir(directory)).not.toContain('s1.json')
  })

  it('resolves removing an id that is already gone', async () => {
    await expect(store().remove('never-saved')).resolves.toBeUndefined()
  })
})

// The product's own host against the real file store
// (helpers/conversationPanel.ts), shared by the host and panel delete tests
// below. No turn runs, so any network use would fail loudly through its
// missing key.
describe('ModelApiHost.deleteSession keeps a deleted conversation deleted', () => {
  let directory = ''

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'muse-host-session-delete-'))
  })
  afterAll(async () => {
    await removeFolder(directory)
  })

  it('drains the in-flight save, removes the file, and stops the live handle', async () => {
    const rig = modelApiRig(directory)
    const { host, store } = rig
    const live = await host.startSession({
      workspaceRoot: directory,
      modelId: DEFAULT_MODEL_ID,
      approvalMode: 'promptUnmatched',
    })
    const sessionId = live.sessionId
    // Queue a real save and delete before it must have finished: the removal
    // has to win over the write, not race it.
    await live.rename('Parser fix')
    await awaitSaved(rig, sessionId)
    expect(rig.warnings).toEqual([])
    // Queue another real save and delete before it must have finished: the
    // removal has to win over the write, not race it.
    await live.rename('Parser fix again')
    await host.deleteSession(sessionId)
    await host.flush()

    expect(await store.load(sessionId)).toBeUndefined()
    const listed = await host.listSessions({ workspaceRoot: directory, limit: 50 })
    expect(listed.sessions.map((record) => record.sessionId)).not.toContain(sessionId)

    // The live handle is stopped with the conversation: neither resume nor
    // fork may bring a session back for the deleted id.
    await expect(host.resumeSession(sessionId, DEFAULT_MODEL_ID)).rejects.toThrow()
    await expect(host.forkSession(sessionId, DEFAULT_MODEL_ID)).rejects.toThrow()

    // Touching the stopped handle afterwards writes nothing back.
    await live.rename('A rename after the delete')
    await host.flush()
    expect(await store.load(sessionId)).toBeUndefined()

    // Deleting again resolves: the removal stays idempotent.
    await expect(host.deleteSession(sessionId)).resolves.toBeUndefined()
    await host.flush()
    expect(await store.load(sessionId)).toBeUndefined()
    expect(await readdir(directory)).not.toContain(`${sessionId}.json`)
  })
})

// The panel's delete path, driven through the same `handle` entry the
// webview uses, against the real controller, the real host and the real
// file store. What the editor does around it is the test operator's part:
// answering the confirm dialog the way the person would, and capturing the
// posted messages. Everything the delete itself touches — the host removal,
// the file, the saves, the archived ids, the checkpoints, the re-list — is
// production code.
interface PanelRig extends ModelApiRig {
  readonly controller: ReturnType<typeof conversationPanel>['controller']
  readonly posted: HostToWebviewMessage[]
  readonly releaseConfirm: () => ((isConfirmed: boolean) => void) | undefined
  readonly armArchivedIdsFailure: (error: Error) => void
}

function makePanel(directory: string, confirm: 'yes' | 'no' | 'deferred'): PanelRig {
  const rig = modelApiRig(directory)
  let releaseConfirm: ((isConfirmed: boolean) => void) | undefined
  let archivedIds: readonly string[] = []
  let archivedIdsFailure: Error | undefined
  const sessions: SessionMemory = {
    archivedIds: () => [...archivedIds],
    setArchivedIds: (ids) => {
      if (archivedIdsFailure !== undefined) {
        return Promise.reject(archivedIdsFailure)
      }
      archivedIds = [...ids]
      return Promise.resolve()
    },
    damagedIds: () => [],
    setDamagedIds: () => Promise.resolve(),
    lastSession: () => undefined,
    setLastSession: () => Promise.resolve(),
  }
  const { controller, posted } = conversationPanel({
    rig,
    directory,
    sessions,
    confirmFileAction: () =>
      new Promise<boolean>((resolve) => {
        if (confirm === 'yes') {
          resolve(true)
          return
        }
        if (confirm === 'no') {
          resolve(false)
          return
        }
        releaseConfirm = resolve
      }),
  })
  return {
    ...rig,
    controller,
    posted,
    releaseConfirm: () => releaseConfirm,
    armArchivedIdsFailure: (error: Error) => {
      archivedIdsFailure = error
    },
  }
}

function panelSessionLists(posted: readonly HostToWebviewMessage[]): string[][] {
  return posted
    .filter((message) => message.type === 'sessionList')
    .map((message) => message.sessions.map((row) => row.sessionId))
}

async function waitForConfirm(
  releaseConfirm: () => ((isConfirmed: boolean) => void) | undefined,
): Promise<void> {
  for (let attempt = 0; attempt < 200 && releaseConfirm() === undefined; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  if (releaseConfirm() === undefined) {
    throw new Error('the delete confirm dialog never opened')
  }
}

// A live conversation with a save on disk: every panel test starts from
// this real state, then drives its own delete through the controller. The
// live handle stays out for tests that touch the stopped session after the
// delete (a turn settling late touches the same path).
async function startNamedSession(
  panel: PanelRig,
  directory: string,
): Promise<{ readonly live: AgentSession; readonly sessionId: string }> {
  const live = await panel.host.startSession({
    workspaceRoot: directory,
    modelId: DEFAULT_MODEL_ID,
    approvalMode: 'promptUnmatched',
  })
  const sessionId = live.sessionId
  await live.rename('Parser fix')
  await awaitSaved(panel, sessionId)
  return { live, sessionId }
}

// The listed row every History test starts from: the host really lists the
// saved conversation, or the test fails before it proves anything.
async function listedRecord(
  panel: PanelRig,
  directory: string,
  sessionId: string,
): Promise<SessionRecord> {
  const listed = await panel.host.listSessions({ workspaceRoot: directory, limit: 50 })
  const record = listed.sessions.find((entry) => entry.sessionId === sessionId)
  if (record === undefined) {
    throw new Error(`session ${sessionId} was never listed`)
  }
  return record
}

// The open History dialog really shows the row: the controller lists through
// the same `handle` entry the webview uses, and the last posted list names it.
async function expectListed(panel: PanelRig, sessionId: string): Promise<void> {
  await panel.controller.handle({ type: 'listSessions' })
  const lists = panelSessionLists(panel.posted)
  expect(lists.length).toBeGreaterThan(0)
  expect(lists.at(-1)).toContain(sessionId)
}

// Deletes through the panel and proves the file is gone.
async function deleteThroughPanel(panel: PanelRig, sessionId: string): Promise<void> {
  await panel.controller.handle({ type: 'deleteSession', sessionId })
  await panel.host.flush()
  expect(await panel.store.load(sessionId)).toBeUndefined()
}

// The one success notice a confirmed delete says.
function deletedNotice(record: SessionRecord): string {
  return fill(UI_TEXT.historyDeleted, { name: sessionTitle(record) })
}

describe('ConversationController.deleteSession tells one true story', () => {
  it('says Deleted once and the re-listed History loses the row', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-panel-session-delete-'))
    try {
      const panel = makePanel(directory, 'yes')
      const { sessionId } = await startNamedSession(panel, directory)
      expect(panel.warnings).toEqual([])
      const record = await listedRecord(panel, directory, sessionId)
      await expectListed(panel, sessionId)

      await deleteThroughPanel(panel, sessionId)

      expect(panelNotices(panel.posted)).toEqual([{ level: 'info', text: deletedNotice(record) }])
      const after = panelSessionLists(panel.posted)
      expect(after.at(-1)).not.toContain(sessionId)
    } finally {
      await removeFolder(directory)
    }
  })

  it('a touch that lands after the delete does not put the row back', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-panel-session-late-touch-'))
    try {
      const panel = makePanel(directory, 'yes')
      const { live, sessionId } = await startNamedSession(panel, directory)
      const record = await listedRecord(panel, directory, sessionId)
      await expectListed(panel, sessionId)

      await deleteThroughPanel(panel, sessionId)

      // A turn settling after the removal touches the stopped handle: its
      // change callback persists nothing and must publish nothing either, or
      // the row comes back with its file gone. A rename drives the same
      // onChanged persist-and-announce path a turn exit takes; no provider
      // turn can run on this rig, and a hand-answered one would be a fake.
      // The listener below subscribes after the delete, so only a late
      // publish can fill it.
      const heard: SessionListEvent[] = []
      const unlisten = panel.host.onSessionListEvent((event) => {
        heard.push(event)
      })
      try {
        await live.rename('A rename after the delete')
        await panel.host.flush()
      } finally {
        unlisten()
      }

      expect(heard).toEqual([])
      expect(await panel.store.load(sessionId)).toBeUndefined()
      expect(panelNotices(panel.posted)).toEqual([{ level: 'info', text: deletedNotice(record) }])
      expect(panelSessionLists(panel.posted).at(-1)).not.toContain(sessionId)
    } finally {
      await removeFolder(directory)
    }
  })

  it('keeps the row and says nothing when the person declines', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-panel-session-decline-'))
    try {
      const panel = makePanel(directory, 'no')
      const { sessionId } = await startNamedSession(panel, directory)

      await panel.controller.handle({ type: 'deleteSession', sessionId })
      await panel.host.flush()

      expect(await panel.store.load(sessionId)).toBeDefined()
      expect(panelNotices(panel.posted)).toEqual([])
    } finally {
      await removeFolder(directory)
    }
  })

  it('still says Deleted with the real cause when the archived-ids cleanup fails', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-panel-session-cleanup-'))
    try {
      const panel = makePanel(directory, 'yes')
      panel.armArchivedIdsFailure(new Error('archived ids storage is down'))
      const { sessionId } = await startNamedSession(panel, directory)

      await panel.controller.handle({ type: 'deleteSession', sessionId })
      await panel.host.flush()

      // The conversation is gone even though its cleanup failed.
      expect(await panel.store.load(sessionId)).toBeUndefined()
      const notices = panelNotices(panel.posted)
      expect(notices).toHaveLength(2)
      expect(notices[0]?.level).toBe('info')
      const deletedText = notices[0]?.text ?? ''
      expect(notices[1]).toEqual({
        level: 'error',
        text: expect.stringContaining('archived ids storage is down'),
      })
      expect(notices[1]?.text.startsWith(deletedText)).toBe(true)
      expect(notices[1]?.text).not.toContain('Could not delete')
    } finally {
      await removeFolder(directory)
    }
  })

  it('drops the row and still says Deleted when the epoch moves mid-delete', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-panel-session-epoch-'))
    try {
      const panel = makePanel(directory, 'deferred')
      const { sessionId } = await startNamedSession(panel, directory)

      // The delete is parked at its confirm dialog. Once the person confirms,
      // the hosts stop (a real epoch invalidator) while the removal is still
      // in flight, so it lands on a stale generation.
      const deleting = panel.controller.handle({ type: 'deleteSession', sessionId })
      await waitForConfirm(panel.releaseConfirm)
      panel.releaseConfirm()?.(true)
      // Let the confirmed delete pass its generation check, then stop the
      // hosts before the removal settles: the file writes below still take
      // real I/O, so this always lands first.
      await Promise.resolve()
      await panel.controller.backendStopping(false)
      await deleting
      await panel.host.flush()

      expect(await panel.store.load(sessionId)).toBeUndefined()
      const deletedText = fill(UI_TEXT.historyDeleted, { name: sessionId })
      expect(panelNotices(panel.posted)).toEqual([{ level: 'info', text: deletedText }])
    } finally {
      await removeFolder(directory)
    }
  })

  it('a new conversation mid-delete still drops the row from the posted list', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-panel-session-stale-list-'))
    try {
      const panel = makePanel(directory, 'deferred')
      const { sessionId } = await startNamedSession(panel, directory)
      const record = await listedRecord(panel, directory, sessionId)
      await expectListed(panel, sessionId)

      // The delete is parked at its confirm dialog. The person starts a new
      // conversation while the removal is still in flight: a real epoch
      // invalidator that posts no list of its own, so the stale delete must
      // post one itself or the row stays on screen with its file gone.
      const deleting = panel.controller.handle({ type: 'deleteSession', sessionId })
      await waitForConfirm(panel.releaseConfirm)
      panel.releaseConfirm()?.(true)
      // Let the confirmed delete pass its generation check, then start the
      // new conversation before the removal settles: the file writes below
      // still take real I/O, so this always lands first.
      await Promise.resolve()
      await panel.controller.handle({ type: 'clearConversation' })
      await deleting
      await panel.host.flush()

      expect(await panel.store.load(sessionId)).toBeUndefined()
      expect(panelNotices(panel.posted)).toEqual([{ level: 'info', text: deletedNotice(record) }])
      // The newer generation posts no list: the last posted list is the
      // stale delete's own, and it omits the row. Without that post the
      // last list still names it and History keeps showing it.
      const lists = panelSessionLists(panel.posted)
      expect(lists.length).toBeGreaterThan(1)
      expect(lists.at(-1)).not.toContain(sessionId)
    } finally {
      await removeFolder(directory)
    }
  })
})

// M88 lane B: a bookmarked session is kept past `cleanupPeriodDays` — the
// retention asks the bookmark store's ids, skips them, and takes the
// session at the next listing once the bookmark is gone.
describe("retention keeps the bookmark store's ids", () => {
  const NOW = Date.parse('2026-10-21T00:00:00.000Z')
  const RETENTION_DAYS = 30
  let directory = ''

  const store = (isRetained: (sessionId: string) => Promise<boolean>, asked: string[]) =>
    createFileSessionStore({
      directory,
      log: {
        trace: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
      retentionDays: () => RETENTION_DAYS,
      now: () => NOW,
      sleep: () => Promise.resolve(),
      isRetained: (sessionId) => {
        asked.push(sessionId)
        return isRetained(sessionId)
      },
    })

  const aged = (sessionId: string, idleDays: number): StoredSession => ({
    ...session,
    sessionId,
    name: `Aged ${sessionId}`,
    lastActivityAt: new Date(NOW - idleDays * MILLISECONDS_PER_DAY).toISOString(),
  })

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'muse-session-retain-'))
  })
  afterAll(async () => {
    await removeFolder(directory)
  })

  it('keeps a retained session past its idle period, then takes it when released', async () => {
    const asked: string[] = []
    const retained = new Set(['old-kept'])
    const sessions = store((id) => Promise.resolve(retained.has(id)), asked)
    await sessions.save(aged('old-kept', 45))
    await sessions.save(aged('old-taken', 45))
    const listed = await sessions.list()
    expect(listed.map((header) => header.sessionId)).toEqual(['old-kept'])
    expect(await sessions.load('old-kept')).toBeDefined()
    expect(await sessions.load('old-taken')).toBeUndefined()
    expect(asked.toSorted((left, right) => left.localeCompare(right))).toEqual([
      'old-kept',
      'old-taken',
    ])

    // The bookmark is removed: retention takes the session at the next listing.
    retained.delete('old-kept')
    const relisted = await sessions.list()
    expect(relisted.map((header) => header.sessionId)).toEqual([])
    expect(await sessions.load('old-kept')).toBeUndefined()
    expect(await readdir(directory)).not.toContain('old-kept.json')
  })

  it('never asks about a session young enough to keep', async () => {
    const asked: string[] = []
    const sessions = store(() => Promise.resolve(false), asked)
    await sessions.save(aged('young', 2))
    const listed = await sessions.list()
    expect(listed.map((header) => header.sessionId)).toEqual(['young'])
    expect(asked).toEqual([])
  })
})

describe('canDeleteMuseSession', () => {
  it('opens Delete only where the CLI serves session/delete and the reader is injected', () => {
    const rows: [version: string, hasReader: boolean, expected: boolean][] = [
      ['1.4.0', true, true],
      ['1.4.3', true, true],
      ['1.4.3-R5018.1', true, true],
      ['1.4.4', true, false],
      ['1.4.4-R5419.1', true, false],
      ['1.4.10', true, false],
      ['1.4.10-R6427.1', true, false],
      ['1.3.0', true, false],
      ['not-a-version', true, false],
      ['', true, false],
      ['1.4.3', false, false],
      ['1.4.10', false, false],
    ]
    for (const [version, hasReader, expected] of rows) {
      expect(canDeleteMuseSession(version, hasReader)).toBe(expected)
    }
  })
})
