// NOLIMITS4 B16: the session list pages through every record. Past the old
// fifty not even a cursor could reach; now each page names the next offset
// until none remains. Pure data in, through the real helper.
import { describe, expect, it } from 'vitest'
import { sessionRecordsPage, type SessionRecord } from '../../src/core/agent/agentBackend'

function record(id: string): SessionRecord {
  return {
    sessionId: id,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-16T00:00:00.000Z',
    status: 'idle',
    turnCount: 1,
  }
}

describe('sessionRecordsPage', () => {
  it('pages past the old fifty through every record', () => {
    const ordered = Array.from({ length: 55 }, (_, index) => record(`s-${String(index)}`))
    const first = sessionRecordsPage(ordered, 50, undefined)
    expect(first.sessions).toHaveLength(50)
    expect(first.nextCursor).toBe('50')
    const second = sessionRecordsPage(ordered, 50, first.nextCursor)
    expect(second.sessions.map((session) => session.sessionId)).toEqual([
      's-50',
      's-51',
      's-52',
      's-53',
      's-54',
    ])
    expect(second.nextCursor).toBeUndefined()
  })

  it('starts over on a cursor that is not an offset, never empty', () => {
    const ordered = [record('s-0'), record('s-1')]
    const page = sessionRecordsPage(ordered, 50, 'nope')
    expect(page.sessions).toHaveLength(2)
    expect(page.nextCursor).toBeUndefined()
  })
})
