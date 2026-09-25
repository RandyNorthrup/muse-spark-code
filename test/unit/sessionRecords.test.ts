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
  title: 'Edit notes.md <ide_opened_file>The user opened notes.md</ide_opened_file>',
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
  it('builds the dialog row: stripped title, activity, fork and name flags', () => {
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

  it('marks paid the images the extension’s ide server made with the key (M44)', () => {
    const call = { itemId: 'i', kind: 'toolCall', status: 'completed' }
    expect(toSnapshot({ ...call, tool: 'mcp__ide__generateImage' }).paid).toBe('imageGeneration')
    expect(toSnapshot({ ...call, tool: 'mcp__ide__editImage' }).paid).toBe('imageGeneration')
    expect(toSnapshot({ ...call, tool: 'mcp__ide__getDiagnostics' })).not.toHaveProperty('paid')
    expect(toSnapshot({ ...call, tool: 'mcp__other__generateImage' })).not.toHaveProperty('paid')
  })
})

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
})
