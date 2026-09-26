import { describe, expect, it } from 'vitest'
import {
  headerOf,
  parseStoredSession,
  recordOf,
  type StoredSession,
} from '../../src/core/backends/modelapi/sessionStore'

const full: StoredSession = {
  version: 1,
  sessionId: 's1',
  workspaceRoot: '/ws',
  modelId: 'muse-spark-1.3',
  approvalMode: 'promptUnmatched',
  effort: 'high',
  name: 'Parser fix',
  createdAt: '2026-09-22T10:00:00.000Z',
  lastActivityAt: '2026-09-22T10:05:00.000Z',
  turnIds: ['t1'],
  forkedFrom: 's0',
  firstPrompt: 'fix the parser',
  todos: [{ text: 'read', status: 'completed' }],
  // M45: the goal as Muse Code's tools return it.
  goal: {
    goal_id: 'goal-1',
    objective: 'Fix the parser',
    status: 'paused',
    percent_complete: 40,
    current_work: 'Tests',
    next_work: null,
    token_budget: null,
    tokens_used: 1200,
    created_at_ms: 1,
    updated_at_ms: 2,
    last_progress_at_ms: 2,
  },
  replay: [
    {
      turnId: 't1',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'fix the parser' }],
      },
    },
    { turnId: 't1', item: { type: 'reasoning', id: 'r1', summary: [], encrypted_content: 'enc' } },
    {
      turnId: 't1',
      item: {
        type: 'function_call',
        id: 'f1',
        call_id: 'c1',
        name: 'read_file',
        arguments: '{"path":"a"}',
      },
    },
    { turnId: 't1', item: { type: 'function_call_output', call_id: 'c1', output: 'ok' } },
    {
      turnId: 't1',
      item: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'done' }],
      },
    },
  ],
  transcript: [
    {
      turnId: 't1',
      item: {
        itemId: 'i1',
        kind: 'userMessage',
        status: 'completed',
        turnId: 't1',
        text: 'fix the parser',
      },
    },
  ],
  outputs: { 'tool_patch-i2': '{"files":[]}' },
  usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0, reasoningTokens: 2 },
}

describe('parseStoredSession', () => {
  it('accepts a full record unchanged after a JSON round trip', () => {
    const parsed = parseStoredSession(structuredClone(full))
    expect(parsed).toEqual({ ok: true, session: full })
  })

  it('reads a session saved before goals (M45) as one without a goal', () => {
    const { goal: _goal, ...older } = full
    const parsed = parseStoredSession(structuredClone(older))
    expect(parsed).toEqual({ ok: true, session: older })
    expect(parsed.ok && 'goal' in parsed.session).toBe(false)
    expect(parseStoredSession({ ...full, goal: { objective: 'x' } })).toMatchObject({ ok: false })
  })

  it('names what is wrong with a bad document', () => {
    expect(parseStoredSession({ ...full, version: 2 })).toMatchObject({ ok: false })
    expect(parseStoredSession({ ...full, approvalMode: 'yolo' })).toMatchObject({ ok: false })
    expect(parseStoredSession('garbage')).toMatchObject({ ok: false, reason: expect.any(String) })
    expect(
      parseStoredSession({ ...full, replay: [{ turnId: 't', item: { type: 'unknown' } }] }),
    ).toMatchObject({ ok: false })
  })
})

describe('recordOf', () => {
  it('shapes the history row of a stored session from its header', () => {
    expect(headerOf(full)).toEqual({
      sessionId: 's1',
      workspaceRoot: '/ws',
      name: 'Parser fix',
      createdAt: '2026-09-22T10:00:00.000Z',
      lastActivityAt: '2026-09-22T10:05:00.000Z',
      forkedFrom: 's0',
      firstPrompt: 'fix the parser',
      turnCount: 1,
    })
    expect(recordOf(headerOf(full))).toEqual({
      sessionId: 's1',
      name: 'Parser fix',
      title: 'fix the parser',
      firstUserPrompt: 'fix the parser',
      createdAt: '2026-09-22T10:00:00.000Z',
      updatedAt: '2026-09-22T10:05:00.000Z',
      lastActivityAt: '2026-09-22T10:05:00.000Z',
      status: 'idle',
      turnCount: 1,
      forkedFrom: { sessionId: 's0' },
      workspaceRoot: '/ws',
    })
    const { name: _name, firstPrompt: _prompt, forkedFrom: _fork, ...bare } = full
    expect(headerOf(bare)).not.toHaveProperty('name')
    expect(recordOf(headerOf(bare))).toMatchObject({ forkedFrom: null, turnCount: 1 })
    expect(recordOf(headerOf(bare))).not.toHaveProperty('name')
    expect(recordOf(headerOf(bare))).not.toHaveProperty('title')
  })
})
