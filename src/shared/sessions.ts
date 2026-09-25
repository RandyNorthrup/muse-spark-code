// Session history (M6): the row the History dialog shows for one stored
// session, its title, the time groups and the archive policy. Shared by
// the host (which builds rows from `session/list`) and the webview (which
// groups and filters them). No `vscode`, Node or DOM imports.

import * as z from 'zod/mini'
import {
  IDE_CONTEXT_TAGS,
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_MINUTE,
  MINUTES_PER_HOUR,
  HOURS_PER_DAY,
  DAYS_PER_WEEK,
  UI_TEXT,
} from './constants'
import { formatDate, formatRelativeTime } from './l10n/text'

/** The activity fields a `session/list` row carries through to the dialog. */
export const sessionActivityFields = {
  /** RFC 3339 instants from the host. */
  createdAt: z.string(),
  updatedAt: z.string(),
  lastActivityAt: z.optional(z.string()),
  branch: z.optional(z.string()),
  /** `notLoaded`, `idle`, `running` (open on the wire). */
  status: z.string(),
  turnCount: z.number(),
} as const

export const sessionRowSchema = z.object({
  sessionId: z.string(),
  /** The allocated name, else the first prompt without IDE context, else "Untitled". */
  title: z.string(),
  /** True when the host allocated a name (renaming is then meaningful). */
  isNamed: z.boolean(),
  ...sessionActivityFields,
  isFork: z.boolean(),
})
export type SessionRow = z.infer<typeof sessionRowSchema>

const IDE_CONTEXT_BLOCKS = new RegExp(
  String.raw`<(${IDE_CONTEXT_TAGS.selection}|${IDE_CONTEXT_TAGS.openedFile})>[\s\S]*?</\1>`,
  'g',
)
const WHITESPACE_RUNS = /\s+/g

/** The prompt as the user typed it: the IDE reminders the host appended are dropped. */
export function stripIdeContext(text: string): string {
  return text.replaceAll(IDE_CONTEXT_BLOCKS, ' ').replaceAll(WHITESPACE_RUNS, ' ').trim()
}

export interface SessionTitleSource {
  readonly name?: string | undefined
  readonly title?: string | undefined
  readonly firstUserPrompt?: string | undefined
}

/** The dialog row label; `session/list` builds `title` from the whole prompt. */
export function sessionTitle(source: SessionTitleSource): string {
  if (source.name !== undefined && source.name.trim() !== '') {
    return source.name.trim()
  }
  const prompt = stripIdeContext(source.title ?? source.firstUserPrompt ?? '')
  return prompt === '' ? UI_TEXT.untitledConversation : prompt
}

/** The instant the row is grouped and aged by. */
export function activityOf(row: SessionRow): number {
  return Date.parse(row.lastActivityAt ?? row.updatedAt)
}

const MS_PER_MINUTE = MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE
const MS_PER_DAY = MS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY

/** Days of inactivity after which a session is hidden; 0 never hides. */
export function isStale(row: SessionRow, nowMs: number, archiveAfterDays: number): boolean {
  return archiveAfterDays > 0 && nowMs - activityOf(row) > archiveAfterDays * MS_PER_DAY
}

export type SessionGroupId = 'today' | 'yesterday' | 'week' | 'older'

export interface SessionGroup {
  readonly id: SessionGroupId
  readonly title: string
  readonly rows: readonly SessionRow[]
}

function startOfDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function groupIdOf(row: SessionRow, nowMs: number): SessionGroupId {
  const today = startOfDay(nowMs)
  const activity = activityOf(row)
  if (activity >= today) {
    return 'today'
  }
  if (activity >= today - MS_PER_DAY) {
    return 'yesterday'
  }
  return activity >= today - DAYS_PER_WEEK * MS_PER_DAY ? 'week' : 'older'
}

const GROUP_ORDER: readonly SessionGroupId[] = ['today', 'yesterday', 'week', 'older']

/** A group's heading, read when the list is built so it is in the installed table. */
function groupTitle(id: SessionGroupId): string {
  const titles: Readonly<Record<SessionGroupId, string>> = {
    today: UI_TEXT.historyToday,
    yesterday: UI_TEXT.historyYesterday,
    week: UI_TEXT.historyWeek,
    older: UI_TEXT.historyOlder,
  }
  return titles[id]
}

export interface SessionListOptions {
  readonly nowMs: number
  readonly query: string
  readonly archivedIds: ReadonlySet<string>
  readonly archiveAfterDays: number
  readonly isShowingArchived: boolean
}

/** Case-insensitive substring match on the title and the branch. */
export function isMatch(row: SessionRow, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return (
    needle === '' ||
    row.title.toLowerCase().includes(needle) ||
    (row.branch?.toLowerCase().includes(needle) ?? false)
  )
}

/** Whether the row is hidden from the default listing (archived or stale). */
export function isArchived(row: SessionRow, options: SessionListOptions): boolean {
  return (
    options.archivedIds.has(row.sessionId) || isStale(row, options.nowMs, options.archiveAfterDays)
  )
}

/** The rows to show, newest first inside Today / Yesterday / Previous 7 days / Older. */
export function groupSessions(
  rows: readonly SessionRow[],
  options: SessionListOptions,
): readonly SessionGroup[] {
  const shown = rows
    .filter((row) => isMatch(row, options.query))
    .filter((row) => options.isShowingArchived || !isArchived(row, options))
    .toSorted((a, b) => activityOf(b) - activityOf(a))
  return GROUP_ORDER.flatMap((id) => {
    const members = shown.filter((row) => groupIdOf(row, options.nowMs) === id)
    return members.length === 0 ? [] : [{ id, title: groupTitle(id), rows: members }]
  })
}

/**
 * How long ago, in the display language (PLAN.md D33): "now", "5 min. ago",
 * "3 hr. ago", "yesterday", "2 days ago"; past a week, the date. A time in
 * the future (a clock ahead of this one) reads as now.
 */
export function relativeTime(iso: string, nowMs: number): string {
  const thenMs = Date.parse(iso)
  const minutes = Math.floor(Math.max(0, nowMs - thenMs) / MS_PER_MINUTE)
  if (minutes < 1) {
    // Zero seconds is the language's "now"; zero minutes would read "this minute".
    return formatRelativeTime(0, 'second')
  }
  if (minutes < MINUTES_PER_HOUR) {
    return formatRelativeTime(-minutes, 'minute')
  }
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  if (hours < HOURS_PER_DAY) {
    return formatRelativeTime(-hours, 'hour')
  }
  const days = Math.floor(hours / HOURS_PER_DAY)
  return days < DAYS_PER_WEEK ? formatRelativeTime(-days, 'day') : formatDate(thenMs)
}
