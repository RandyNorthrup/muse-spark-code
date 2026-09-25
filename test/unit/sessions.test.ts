import { afterEach, describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import {
  activityOf,
  groupSessions,
  isArchived,
  isMatch,
  isStale,
  relativeTime,
  type SessionListOptions,
  type SessionRow,
  sessionTitle,
  stripIdeContext,
} from '../../src/shared/sessions'

// A Tuesday afternoon, local time (the groups cut at local midnight).
const NOW = new Date(2026, 8, 22, 15, 30).getTime()
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function row(overrides: Partial<SessionRow> & { readonly sessionId: string }): SessionRow {
  return {
    title: overrides.sessionId,
    isNamed: false,
    createdAt: new Date(NOW - HOUR).toISOString(),
    updatedAt: new Date(NOW - HOUR).toISOString(),
    status: 'notLoaded',
    turnCount: 1,
    isFork: false,
    ...overrides,
  }
}

function at(msAgo: number): string {
  return new Date(NOW - msAgo).toISOString()
}

const options: SessionListOptions = {
  nowMs: NOW,
  query: '',
  archivedIds: new Set(),
  archiveAfterDays: 14,
  isShowingArchived: false,
}

describe('stripIdeContext / sessionTitle', () => {
  it('drops the IDE reminder blocks the M5 context appends and collapses whitespace', () => {
    const prompt =
      'what does this do?\n\n<ide_selection>The user selected lines 5-10 of src/a.ts:\nfoo\n</ide_selection>'
    expect(stripIdeContext(prompt)).toBe('what does this do?')
    expect(stripIdeContext('<ide_opened_file>x</ide_opened_file> hi  there')).toBe('hi there')
    expect(stripIdeContext('plain')).toBe('plain')
  })

  it('prefers the allocated name, then the derived title, then the first prompt', () => {
    expect(sessionTitle({ name: ' Named ', title: 't', firstUserPrompt: 'p' })).toBe('Named')
    expect(sessionTitle({ name: '', title: 't <ide_opened_file>a</ide_opened_file>' })).toBe('t')
    expect(sessionTitle({ firstUserPrompt: 'p' })).toBe('p')
    expect(sessionTitle({})).toBe('Untitled')
    expect(sessionTitle({ title: '<ide_selection>only</ide_selection>' })).toBe('Untitled')
  })
})

describe('activityOf / isStale / isMatch / isArchived', () => {
  it('ages rows by lastActivityAt when present, else updatedAt', () => {
    const withActivity = row({ sessionId: 'a', lastActivityAt: at(2 * HOUR), updatedAt: at(0) })
    expect(activityOf(withActivity)).toBe(NOW - 2 * HOUR)
    expect(activityOf(row({ sessionId: 'b', updatedAt: at(DAY) }))).toBe(NOW - DAY)
  })

  it('treats a row idle longer than the setting as stale, never when the setting is 0', () => {
    const old = row({ sessionId: 'old', updatedAt: at(15 * DAY) })
    expect(isStale(old, NOW, 14)).toBe(true)
    expect(isStale(old, NOW, 0)).toBe(false)
    expect(isStale(row({ sessionId: 'fresh', updatedAt: at(13 * DAY) }), NOW, 14)).toBe(false)
  })

  it('matches case-insensitively on the title or the branch, everything on an empty query', () => {
    const r = row({ sessionId: 'x', title: 'Fix the Parser', branch: 'feature/lexer' })
    expect(isMatch(r, '')).toBe(true)
    expect(isMatch(r, '  parser ')).toBe(true)
    expect(isMatch(r, 'LEXER')).toBe(true)
    expect(isMatch(r, 'nope')).toBe(false)
    expect(isMatch(row({ sessionId: 'y', title: 'z' }), 'branch')).toBe(false)
  })

  it('hides archived ids and stale rows alike', () => {
    const stale = row({ sessionId: 'stale', updatedAt: at(30 * DAY) })
    const archived = row({ sessionId: 'archived' })
    const opts = { ...options, archivedIds: new Set(['archived']) }
    expect(isArchived(stale, opts)).toBe(true)
    expect(isArchived(archived, opts)).toBe(true)
    expect(isArchived(row({ sessionId: 'live' }), opts)).toBe(false)
  })
})

describe('groupSessions', () => {
  const rows = [
    row({ sessionId: 'older', updatedAt: at(10 * DAY), title: 'Old work' }),
    row({ sessionId: 'today-late', updatedAt: at(10 * 60 * 1000), title: 'Recent' }),
    row({ sessionId: 'yesterday', updatedAt: at(DAY), title: 'Yesterday work' }),
    row({ sessionId: 'today-early', updatedAt: at(3 * HOUR), title: 'Morning' }),
    row({ sessionId: 'week', updatedAt: at(4 * DAY), title: 'Midweek', branch: 'fix/thing' }),
    row({ sessionId: 'stale', updatedAt: at(20 * DAY), title: 'Forgotten' }),
    row({ sessionId: 'hidden', updatedAt: at(HOUR), title: 'Archived by hand' }),
  ]

  it('groups newest-first into Today / Yesterday / Previous 7 days / Older, hiding archived rows', () => {
    const groups = groupSessions(rows, { ...options, archivedIds: new Set(['hidden']) })
    expect(groups.map((group) => group.title)).toEqual([
      'Today',
      'Yesterday',
      'Previous 7 days',
      'Older',
    ])
    expect(groups.map((group) => group.rows.map((r) => r.sessionId))).toEqual([
      ['today-late', 'today-early'],
      ['yesterday'],
      ['week'],
      ['older'],
    ])
  })

  it('shows archived and stale rows only with the switch on', () => {
    const shown = groupSessions(rows, {
      ...options,
      archivedIds: new Set(['hidden']),
      isShowingArchived: true,
    })
    const ids = shown.flatMap((group) => group.rows.map((r) => r.sessionId))
    expect(ids).toContain('hidden')
    expect(ids).toContain('stale')
    expect(shown.at(-1)?.rows.map((r) => r.sessionId)).toEqual(['older', 'stale'])
  })

  it('filters by the query and drops empty groups', () => {
    const groups = groupSessions(rows, { ...options, query: 'thing' })
    expect(groups).toHaveLength(1)
    expect(groups[0]?.rows[0]?.sessionId).toBe('week')
    expect(groupSessions(rows, { ...options, query: 'zzz' })).toEqual([])
  })
})

describe('relativeTime', () => {
  afterEach(() => {
    setUiText(EN, 'en')
  })

  it('reads now / minutes / hours / days, then the date', () => {
    expect(relativeTime(at(20 * 1000), NOW)).toBe('now')
    expect(relativeTime(at(5 * 60 * 1000), NOW)).toBe('5 min. ago')
    expect(relativeTime(at(3 * HOUR), NOW)).toBe('3 hr. ago')
    expect(relativeTime(at(DAY), NOW)).toBe('yesterday')
    expect(relativeTime(at(2 * DAY), NOW)).toBe('2 days ago')
    expect(relativeTime(at(9 * DAY), NOW)).toBe('Sep 13, 2026')
    // A clock that runs behind the host never reads as the future.
    expect(relativeTime(new Date(NOW + HOUR).toISOString(), NOW)).toBe('now')
  })

  it('reads in the display language once its table is installed (M40)', () => {
    setUiText(EN, 'de')
    expect(relativeTime(at(20 * 1000), NOW)).toBe('jetzt')
    expect(relativeTime(at(5 * 60 * 1000), NOW)).toBe('vor 5 Min.')
    expect(relativeTime(at(2 * DAY), NOW)).toBe('vorgestern')
    expect(relativeTime(at(9 * DAY), NOW)).toBe('13.09.2026')
  })

  it('titles the groups from the table installed when the list is built (M40)', () => {
    setUiText({ ...EN, historyToday: 'Heute' }, 'de')
    const groups = groupSessions([row({ sessionId: 'now', updatedAt: at(HOUR) })], options)
    expect(groups.map((group) => group.title)).toEqual(['Heute'])
  })
})
