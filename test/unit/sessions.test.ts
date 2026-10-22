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
  bookmarks: [],
}

// What reaches sessionTitle is already the person's words: Muse Code's
// records are read so when parsed (promptWords.test.ts, sessionTitles.test.ts).
describe('sessionTitle', () => {
  it('prefers the allocated name, then the derived title, then the first prompt', () => {
    expect(sessionTitle({ name: ' Named ', title: 't', firstUserPrompt: 'p' })).toBe('Named')
    expect(sessionTitle({ name: '', title: 't' })).toBe('t')
    expect(sessionTitle({ firstUserPrompt: 'p' })).toBe('p')
    expect(sessionTitle({})).toBe('Untitled')
    expect(sessionTitle({ name: ' ', title: ' \n ' })).toBe('Untitled')
  })

  it('shows a prompt on one line', () => {
    expect(sessionTitle({ title: 'what does\n\nthis  do?' })).toBe('what does this do?')
    expect(sessionTitle({ title: 'Inspect this\n[Muse Spark Code attached text files: x]' })).toBe(
      'Inspect this [Muse Spark Code attached text files: x]',
    )
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

  it('groups newest-first into Today / Yesterday / Previous 7 Days / Older, hiding archived rows', () => {
    const groups = groupSessions(rows, { ...options, archivedIds: new Set(['hidden']) })
    expect(groups.map((group) => group.title)).toEqual([
      'Today',
      'Yesterday',
      'Previous 7 Days',
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

// M88 lane B: the Bookmarked group comes first, newest bookmark first. A
// bookmarked row shows there only; the stored title stands in for an id
// the list has not named yet.
describe('groupSessions bookmarks', () => {
  const rows = [
    row({ sessionId: 'today', updatedAt: at(HOUR), title: 'Recent' }),
    row({ sessionId: 'pinned', updatedAt: at(HOUR), title: 'Pinned chat' }),
    row({ sessionId: 'plain', updatedAt: at(2 * HOUR), title: 'Ordinary' }),
    row({ sessionId: 'old', updatedAt: at(30 * DAY), title: 'Ancient work' }),
  ]

  it('pins bookmarked rows first and shows them nowhere else', () => {
    const groups = groupSessions(rows, {
      ...options,
      bookmarks: [
        { sessionId: 'pinned', title: 'Stored', bookmarkedAtMs: NOW - 2000 },
        { sessionId: 'today', title: 'Stored', bookmarkedAtMs: NOW - 1000 },
      ],
    })
    expect(groups.map((group) => group.id)).toEqual(['bookmarked', 'today'])
    expect(groups[0]?.title).toBe('Bookmarked')
    // Newest bookmark first, with the listed rows' live titles.
    expect(groups[0]?.rows.map((r) => r.title)).toEqual(['Recent', 'Pinned chat'])
    expect(groups.flatMap((group) => group.rows.map((r) => r.sessionId))).toEqual([
      'today',
      'pinned',
      'plain',
    ])
  })

  it('stands the stored title in for ids the list never named', () => {
    const groups = groupSessions(rows, {
      ...options,
      bookmarks: [{ sessionId: 'gone', title: 'Stored title', bookmarkedAtMs: NOW }],
    })
    expect(groups[0]?.id).toBe('bookmarked')
    expect(groups[0]?.rows).toHaveLength(1)
    expect(groups[0]?.rows[0]).toMatchObject({ sessionId: 'gone', title: 'Stored title' })
  })

  it('pins stale rows by age but honours an explicit archive', () => {
    const bookmarks = [{ sessionId: 'old', title: 'Ancient work', bookmarkedAtMs: NOW }]
    const pinned = groupSessions(rows, { ...options, bookmarks })
    expect(pinned[0]?.rows.map((r) => r.sessionId)).toEqual(['old'])
    const archived = groupSessions(rows, {
      ...options,
      bookmarks,
      archivedIds: new Set(['old']),
    })
    expect(archived.flatMap((group) => group.rows.map((r) => r.sessionId))).not.toContain('old')
    const shown = groupSessions(rows, {
      ...options,
      bookmarks,
      archivedIds: new Set(['old']),
      isShowingArchived: true,
    })
    expect(shown[0]?.id).toBe('bookmarked')
    expect(shown[0]?.rows.map((r) => r.sessionId)).toEqual(['old'])
  })

  it('matches the query against stored titles and keeps one row per id', () => {
    const withDupes = groupSessions(rows, {
      ...options,
      query: 'stored',
      bookmarks: [
        { sessionId: 'gone', title: 'Stored title', bookmarkedAtMs: NOW },
        { sessionId: 'gone', title: 'Stored twice', bookmarkedAtMs: NOW },
        { sessionId: 'pinned', title: 'Stored', bookmarkedAtMs: NOW },
      ],
    })
    expect(withDupes).toHaveLength(1)
    expect(withDupes[0]?.rows).toHaveLength(1)
    expect(withDupes[0]?.rows[0]).toMatchObject({ sessionId: 'gone', title: 'Stored title' })
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
