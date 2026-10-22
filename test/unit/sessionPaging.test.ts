// NOLIMITS4 B16: the session list pages through every record. Past the old
// fifty not even a cursor could reach; now each page names the next offset
// until none remains. Pure data in, through the real helper.
import { describe, expect, it } from 'vitest'
import {
  pageSessionsUntilFound,
  sessionRecordsPage,
  type SessionPage,
  type SessionRecord,
} from '../../src/core/agent/agentBackend'

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

function pager(pages: readonly (readonly string[])[]): {
  fetchPage: (cursor: string | undefined) => Promise<SessionPage>
  fetched: string[]
} {
  const fetched: string[] = []
  return {
    fetched,
    fetchPage: (cursor = '<start>') => {
      fetched.push(cursor)
      const at = cursor === '<start>' ? 0 : Number(cursor)
      const ids = pages[at] ?? []
      return Promise.resolve({
        sessions: ids.map((id) => record(id)),
        nextCursor: at + 1 < pages.length ? String(at + 1) : undefined,
      })
    },
  }
}

describe('pageSessionsUntilFound', () => {
  it('stops at the page that names every wanted id', async () => {
    const { fetchPage, fetched } = pager([['s-0'], ['s-1'], ['s-2']])
    const records = await pageSessionsUntilFound(fetchPage, new Set(['s-1']), '0', () => false)
    expect(records.map((row) => row.sessionId)).toEqual(['s-0', 's-1'])
    expect(fetched).toEqual(['0', '1'])
  })

  it('reads to the end when a wanted id never appears', async () => {
    const { fetchPage, fetched } = pager([['s-0'], ['s-1']])
    const records = await pageSessionsUntilFound(fetchPage, new Set(['gone']), '0', () => false)
    expect(records.map((row) => row.sessionId)).toEqual(['s-0', 's-1'])
    expect(fetched).toEqual(['0', '1'])
  })

  it('fetches nothing with no wanted ids or no further pages', async () => {
    const { fetchPage, fetched } = pager([['s-0']])
    expect(await pageSessionsUntilFound(fetchPage, new Set(), '0', () => false)).toEqual([])
    expect(
      await pageSessionsUntilFound(fetchPage, new Set(['s-0']), undefined, () => false),
    ).toEqual([])
    expect(fetched).toEqual([])
  })

  it('stops when the list stops advancing instead of looping', async () => {
    const fetched: string[] = []
    const records = await pageSessionsUntilFound(
      (cursor = '<start>') => {
        fetched.push(cursor)
        return Promise.resolve({ sessions: [record('s-0')], nextCursor: 'again' })
      },
      new Set(['gone']),
      'again',
      () => false,
    )
    expect(records.map((row) => row.sessionId)).toEqual(['s-0'])
    expect(fetched).toEqual(['again'])
  })

  it('keeps what it read when the listing is cancelled', async () => {
    let calls = 0
    const records = await pageSessionsUntilFound(
      (cursor = 'start') => {
        calls += 1
        return Promise.resolve({ sessions: [record(`s-${cursor}`)], nextCursor: '1' })
      },
      new Set(['gone']),
      '0',
      () => calls > 0,
    )
    expect(records.map((row) => row.sessionId)).toEqual(['s-0'])
  })
})
