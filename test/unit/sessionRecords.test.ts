import { describe, expect, it } from 'vitest'
import type { SessionRecord } from '../../src/core/agent/agentBackend'
import { toSessionRow } from '../../src/core/agent/sessionRows'
import {
  historyOutcome,
  type SessionEnvelope,
  sessionEnvelopeSchema,
  toSnapshot,
  wireItemSchema,
} from '../../src/core/backends/musecode/sessionRecords'

// The `session/list` row shape captured live 2026-09-22 (Muse Code 1.3.0).
const record: SessionRecord = {
  sessionId: '01a0c9d0-b97c-7793-881c-5dec5ceb1552',
  createdAt: '2026-09-22T15:51:34.524802Z',
  updatedAt: '2026-09-22T15:57:44.570806Z',
  lastActivityAt: '2026-09-22T15:52:21.65095Z',
  status: 'idle',
  turnCount: 1,
  forkedFrom: null,
  workspaceRoot: String.raw`C:\muse-live-ws`,
  // The person's words, as the record schema reads a derived title
  // (sessionTitles.test.ts reads the captured ones).
  title: 'Edit notes.md',
  firstUserPrompt: 'Edit notes.md',
}

const userItem = {
  itemId: 'u1',
  kind: 'userMessage',
  status: 'completed',
  turnId: 't1',
  text: 'what does this do?\n<ide_selection>lines</ide_selection>',
  displayText: 'what does this do?',
  attachments: [{ type: 'image', mediaType: 'image/png', width: 2, height: 3 }],
}

describe('toSessionRow', () => {
  it('builds the dialog row: title, activity, fork and name flags', () => {
    expect(toSessionRow(record)).toEqual({
      sessionId: record.sessionId,
      title: 'Edit notes.md',
      isNamed: false,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastActivityAt: record.lastActivityAt,
      status: 'idle',
      turnCount: 1,
      isFork: false,
    })
    const named = toSessionRow({
      ...record,
      name: 'Notes edit',
      branch: 'main',
      forkedFrom: { sessionId: 'parent' },
    })
    expect(named).toMatchObject({
      title: 'Notes edit',
      isNamed: true,
      branch: 'main',
      isFork: true,
    })
    expect(toSessionRow({ ...record, lastActivityAt: undefined })).not.toHaveProperty(
      'lastActivityAt',
    )
  })
})

describe('toSnapshot', () => {
  it('takes an item whatever its modelVisibleContent holds (the review of PR #29)', () => {
    const item = {
      itemId: 'r',
      kind: 'toolCall',
      status: 'completed',
      tool: 'read_file',
      modelVisibleContent: [
        42,
        { kind: 'image', base64_data: 'AA' },
        { type: 'image', path: 'a.png' },
      ],
    }
    expect(wireItemSchema.safeParse(item).success).toBe(true)
  })

  it('drops a null turn and shows the display text in place of the model-visible text', () => {
    expect(toSnapshot({ ...userItem, turnId: null })).not.toHaveProperty('turnId')
    const snapshot = toSnapshot(userItem)
    expect(snapshot.text).toBe('what does this do?')
    expect(snapshot).not.toHaveProperty('displayText')
    expect(snapshot.attachments).toEqual(userItem.attachments)
    expect(toSnapshot({ ...userItem, displayText: null }).text).toBe(userItem.text)
  })

  it('rebuilds a picked text-file chip from the durable Muse display marker', () => {
    const displayText = 'Inspect this\n[Muse Spark Code attached text files: ["notes.txt"]]'
    expect(toSnapshot({ ...userItem, displayText })).toMatchObject({
      text: displayText,
      attachments: [
        { type: 'image', mediaType: 'image/png', width: 2, height: 3 },
        { type: 'file', mediaType: 'text/plain', name: 'notes.txt' },
      ],
    })
  })

  it('keeps ordinary or malformed suffix text visible while flagging a damaged marker', () => {
    const ordinary = 'I typed [Attached text files: ["notes.txt"]]'
    expect(toSnapshot({ ...userItem, displayText: ordinary }).text).toBe(ordinary)
    const identical = 'I typed this\n[Muse Spark Code attached text files: ["notes.txt"]]'
    expect(toSnapshot({ ...userItem, text: identical, displayText: identical })).toMatchObject({
      text: identical,
      attachments: [
        { type: 'image', mediaType: 'image/png', width: 2, height: 3 },
        { type: 'file', mediaType: 'text/plain', name: 'notes.txt' },
      ],
    })
    const malformed = 'Inspect this\n[Muse Spark Code attached text files: broken]'
    expect(toSnapshot({ ...userItem, displayText: malformed })).toMatchObject({
      text: malformed,
      attachments: [
        { type: 'image', mediaType: 'image/png', width: 2, height: 3 },
        { type: 'file', mediaType: 'text/plain' },
      ],
    })
  })

  it('marks paid the images the extension’s ide server made with the key (M44)', () => {
    const call = { itemId: 'i', kind: 'toolCall', status: 'completed' }
    expect(toSnapshot({ ...call, tool: 'mcp__ide__generateImage' }).paid).toBe('imageGeneration')
    expect(toSnapshot({ ...call, tool: 'mcp__ide__editImage' }).paid).toBe('imageGeneration')
    expect(toSnapshot({ ...call, tool: 'mcp__ide__getDiagnostics' })).not.toHaveProperty('paid')
    expect(toSnapshot({ ...call, tool: 'mcp__other__generateImage' })).not.toHaveProperty('paid')
  })
})

/** A resumed snapshot's history with this folded state (M45: its goal, captured 2026-09-25). */
function snapshotWith(state: Record<string, unknown>) {
  return historyOutcome(
    sessionEnvelopeSchema.parse({
      session: record,
      history: { mode: 'snapshot', items: null, snapshot: { state: { items: [], ...state } } },
      pendingRequests: [],
      viewCursor: 'v',
    }),
  )
}

describe('historyOutcome', () => {
  const tool = { itemId: 'c1', kind: 'toolCall', status: 'completed', tool: 'read_file' }

  it('takes inline items and the record name', () => {
    const envelope = sessionEnvelopeSchema.parse({
      session: { ...record, name: 'Named' },
      history: { mode: 'inline', items: [userItem, tool], snapshot: null },
      pendingRequests: [],
      viewCursor: 'v',
    })
    const outcome = historyOutcome(envelope)
    expect(outcome.mode).toBe('inline')
    expect(outcome.items.map((item) => item.itemId)).toEqual(['u1', 'c1'])
    expect(outcome.items[0]?.text).toBe('what does this do?')
    expect(outcome.name).toBe('Named')
    expect(outcome.todos).toEqual([])
  })

  it('takes snapshot state items, name and todo list when the host served a snapshot', () => {
    const envelope: SessionEnvelope = {
      session: record,
      history: {
        mode: 'snapshot',
        items: null,
        snapshot: {
          state: {
            items: [tool],
            name: 'From snapshot',
            todoList: { items: [{ text: 'do it', status: 'pending' }] },
          },
        },
      },
      viewCursor: 'v',
    }
    const outcome = historyOutcome(envelope)
    expect(outcome.items).toEqual([tool])
    expect(outcome.name).toBe('From snapshot')
    expect(outcome.todos).toEqual([{ text: 'do it', status: 'pending' }])
  })

  it('yields nothing for a `none` history (paged later) and tolerates a null snapshot name', () => {
    const none = historyOutcome({
      session: record,
      history: { mode: 'none', items: null, snapshot: null, noneReason: 'budget' },
      viewCursor: 'v',
    })
    expect(none).toEqual({ mode: 'none', items: [], name: undefined, todos: [] })
    const nullName = historyOutcome({
      session: record,
      history: {
        mode: 'snapshot',
        items: null,
        snapshot: { state: { items: [], name: null, todoList: null } },
      },
      viewCursor: 'v',
    })
    expect(nullName.name).toBeUndefined()
  })

  it('takes the goal from a snapshot, null as none', () => {
    expect(
      snapshotWith({
        goal: {
          objective: 'Reply hello',
          status: 'paused',
          percentComplete: 0,
          currentWork: null,
        },
      }).goal,
    ).toEqual({ objective: 'Reply hello', status: 'paused', percentComplete: 0 })
    expect(snapshotWith({ goal: null }).goal).toBeNull()
  })

  it('cannot say without a snapshot goal, and a goal of another shape costs the goal only', () => {
    expect(snapshotWith({})).not.toHaveProperty('goal')
    const odd = snapshotWith({ goal: { objective: 'x' } })
    expect(odd).not.toHaveProperty('goal')
    expect(odd.mode).toBe('snapshot')
    const inline = historyOutcome({
      session: record,
      history: { mode: 'inline', items: [tool], snapshot: null },
      viewCursor: 'v',
    })
    expect(inline).not.toHaveProperty('goal')
  })
})

/**
The `session/resume` record captured live 2026-10-18 (Muse Code 1.4.7,
`muse-bin serve --provider echo`, worktree temp/probe0-shapes.ts): the
host serves the approval mode it runs beside the permission profile, so
a resumed handle starts knowing which mode to put back.
*/
const resumedRecord = {
  ...record,
  approvalMode: {
    lastCommandId: '01a15164-9def-7000-a3fc-278826e723ce',
    mode: 'onRequest',
    source: 'approvalReconfigure',
  },
  permissionState: {
    profileId: ':ask-me',
    reviewerAttached: true,
    reviewerAuthority: 'human',
  },
}

describe('resume envelope approval mode', () => {
  it('keeps the mode the host runs, and tolerates a record that serves none', () => {
    const resumed = sessionEnvelopeSchema.parse({
      session: resumedRecord,
      history: { mode: 'snapshot', items: null, snapshot: null },
      viewCursor: 'v',
    })
    expect(resumed.session.approvalMode?.mode).toBe('onRequest')
    // A 1.3.0 record or a `session/list` row serves no mode: the handle
    // starts unseeded and quarantines on the first failed profile step.
    const unseeded = sessionEnvelopeSchema.parse({
      session: record,
      history: { mode: 'inline', items: [], snapshot: null },
      viewCursor: 'v',
    })
    expect(unseeded.session.approvalMode).toBeUndefined()
  })
})
