// M96b (PLAN.md D75): the frozen ACP team mapping contracts. A worker's
// approval becomes the editor's `session/request_permission` with a title
// starting with the role and the agent; a task is a `tool_call` whose report
// is text content and whose diff is `diff` content; the merge is a permission
// request carrying the diff; the agent map's tree is a `plan` with one entry
// per running task. Pure: no `vscode`, no backend. C-M96b-1/2 do the wiring;
// what these build is validated here, and refused loudly where it cannot run.
import * as z from 'zod/mini'
import type {
  PermissionOption,
  PermissionOptionKind,
  PlanEntry,
  RequestPermissionRequest,
  ToolCallContent,
  ToolCallUpdate,
} from '@agentclientprotocol/sdk'
import { UI_TEXT } from '../shared/constants'
import { fill } from '../shared/l10n/text'

/** Every team tool call id lives under this prefix, so editors can route it. */
export const TEAM_TOOL_CALL_PREFIX = 'team/'
const TASK_SEGMENT = 'task/'
const MERGE_SEGMENT = 'merge/'
/** A team task is work, not a read or an edit: the `other` tool kind. */
export const TEAM_TASK_TOOL_KIND = 'other'
/** A running task's plan entry matters as much as any other: `medium`. */
export const TEAM_PLAN_PRIORITY = 'medium'
/** The separator between the role and the agent in a permission title. */
const TITLE_SEPARATOR = ' \u{B7} '

/** A `/` in an id would fake a hierarchy, so task and merge ids never hold one. */
function checkedId(kind: 'task' | 'merge', id: string): string {
  if (id === '' || id.includes('/')) throw new Error(`M96b: the team ${kind} id is not addressable`)
  return id
}

/** The tool call id of a team task: `team/task/<taskId>`. */
export function teamTaskToolCallId(taskId: string): string {
  return `${TEAM_TOOL_CALL_PREFIX}${TASK_SEGMENT}${checkedId('task', taskId)}`
}

/** The tool call id of a team merge: `team/merge/<mergeId>`. */
export function teamMergeToolCallId(mergeId: string): string {
  return `${TEAM_TOOL_CALL_PREFIX}${MERGE_SEGMENT}${checkedId('merge', mergeId)}`
}

/** Whether the editor routed this tool call id back to the team. */
export function isTeamToolCallId(toolCallId: string): boolean {
  return toolCallId.startsWith(TEAM_TOOL_CALL_PREFIX)
}

/** The agent/detail delimiter of the installed title template (`{agent}: {detail}`). */
const AGENT_DETAIL_SEPARATOR = ': '
/** Every line break the permission-title parser cannot round-trip. */
const TITLE_LINE_BREAK = /[\r\n\u{2028}\u{2029}]/u

function checkedTitlePart(kind: 'role' | 'agent', value: string): string {
  if (
    value === '' ||
    value.includes(TITLE_SEPARATOR.trim()) ||
    value.includes(AGENT_DETAIL_SEPARATOR) ||
    TITLE_LINE_BREAK.test(value)
  )
    throw new Error(`M96b: the team ${kind} cannot start a permission title`)
  return value
}

/**
 * A worker approval's title (PLAN.md M96b): it starts with the role and the
 * agent, then says what the approval is about. Read from the installed table
 * when it runs, so the editor shows its own language.
 */
export function formatTeamPermissionTitle(input: {
  readonly role: string
  readonly agent: string
  readonly detail: string
}): string {
  const role = checkedTitlePart('role', input.role)
  const agent = checkedTitlePart('agent', input.agent)
  if (input.detail === '') throw new Error('M96b: a team permission title needs its detail')
  return fill(UI_TEXT.acpTeamPermissionTitle, { role, agent, detail: input.detail })
}

const TITLE_SLOTS: ReadonlySet<string> = new Set(['role', 'agent', 'detail'])

function isSlot(slot: string): slot is 'role' | 'agent' | 'detail' {
  return TITLE_SLOTS.has(slot)
}

function templatePattern(): RegExp | undefined {
  const template = UI_TEXT.acpTeamPermissionTitle
  let pattern = ''
  let cursor = 0
  const seen = new Set<string>()
  for (;;) {
    const open = template.indexOf('{', cursor)
    if (open === -1) break
    const close = template.indexOf('}', open + 1)
    if (close === -1) return undefined
    const slot = template.slice(open + 1, close)
    if (!isSlot(slot) || seen.has(slot)) return undefined
    seen.add(slot)
    pattern += escapeRegExp(template.slice(cursor, open))
    pattern += slot === 'detail' ? String.raw`(?<detail>[\s\S]+)` : `(?<${slot}>.+?)`
    cursor = close + 1
  }
  if (seen.size !== TITLE_SLOTS.size) return undefined
  pattern += escapeRegExp(template.slice(cursor))
  return new RegExp(`^${pattern}$`)
}

const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/g

function escapeRegExp(text: string): string {
  return text.replaceAll(REGEXP_SPECIAL, String.raw`\$&`)
}

/**
 * The inverse of {@link formatTeamPermissionTitle}, read through the same
 * installed template so a translated order still round-trips. Undefined when
 * the title is not a team permission title.
 */
export function parseTeamPermissionTitle(
  title: string,
): { readonly role: string; readonly agent: string; readonly detail: string } | undefined {
  const pattern = templatePattern()
  const match = pattern?.exec(title)
  const role = match?.groups?.['role']
  const agent = match?.groups?.['agent']
  const detail = match?.groups?.['detail']
  if (role === undefined || agent === undefined || detail === undefined) return undefined
  const separator = TITLE_SEPARATOR.trim()
  return role === '' ||
    agent === '' ||
    detail === '' ||
    role.includes(separator) ||
    agent.includes(separator) ||
    role.includes(AGENT_DETAIL_SEPARATOR) ||
    agent.includes(AGENT_DETAIL_SEPARATOR) ||
    TITLE_LINE_BREAK.test(role) ||
    TITLE_LINE_BREAK.test(agent)
    ? undefined
    : { role, agent, detail }
}

/** A file path as ACP carries it: `/` separators on every OS (CI runs on Windows). */
export function normalizeTeamPath(path: string): string {
  return path.replaceAll('\\', '/')
}

/** One file modification as the ACP `diff` content both sides freeze on. */
export function teamDiff(input: {
  readonly path: string
  readonly oldText: string | null
  readonly newText: string
}): ToolCallContent {
  const path = normalizeTeamPath(input.path)
  if (path === '') throw new Error('M96b: a team diff needs its path')
  return { type: 'diff', path, oldText: input.oldText, newText: input.newText }
}

/** A task's report as its tool call's text content. */
export function teamReportContent(report: string): ToolCallContent {
  return { type: 'content', content: { type: 'text', text: report } }
}

// Frozen wire shapes (AGENTS.md rule 7): loose, so anything the wire adds
// later arrives rather than failing the parse (PLAN.md D36).

/** Exactly the SDK `Diff`: an absolute path, the original (null for new files), the result. */
export const teamDiffSchema = z.looseObject({
  type: z.literal('diff'),
  path: z.string().check(z.minLength(1)),
  oldText: z.optional(z.nullable(z.string())),
  newText: z.string(),
})

const teamTextContentSchema = z.looseObject({
  type: z.literal('content'),
  content: z.looseObject({ type: z.literal('text'), text: z.string() }),
})

/** What a team task's tool call may carry: a report, or file diffs. */
export const teamToolContentSchema = z.union([teamTextContentSchema, teamDiffSchema])

const teamStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'failed'])

/** A running task as the editor first sees it: announced, without content. */
export function teamTaskToolCall(input: {
  readonly taskId: string
  readonly role: string
  readonly agent: string
  readonly detail: string
}): ToolCallUpdate {
  return {
    toolCallId: teamTaskToolCallId(input.taskId),
    title: formatTeamPermissionTitle(input),
    kind: TEAM_TASK_TOOL_KIND,
    status: 'in_progress',
  }
}

/**
 * A finished task: its report is the call's content, after the diffs it
 * already showed. ACP updates replace content, so the completion re-sends
 * the displayed diffs or the final display loses the task's changes.
 */
export function teamTaskReportUpdate(input: {
  readonly taskId: string
  readonly report: string
  readonly diffs?: readonly ToolCallContent[]
}): ToolCallUpdate {
  return {
    toolCallId: teamTaskToolCallId(input.taskId),
    status: 'completed',
    content: [teamReportContent(input.report), ...(input.diffs ?? [])],
  }
}

/**
 * A permission or diff update shows a patch: at least one entry is a real
 * diff, so no accepted update asks for or shows a merge without its patch.
 */
function checkedDiffs(diffs: readonly ToolCallContent[], message: string): ToolCallContent[] {
  if (diffs.every((entry) => entry.type !== 'diff')) throw new Error(message)
  return [...diffs]
}

/** A working task's file changes: its diffs are the call's content. */
export function teamTaskDiffUpdate(input: {
  readonly taskId: string
  readonly diffs: readonly ToolCallContent[]
}): ToolCallUpdate {
  return {
    toolCallId: teamTaskToolCallId(input.taskId),
    status: 'in_progress',
    content: checkedDiffs(input.diffs, 'M96b: a team diff update carries its diffs'),
  }
}

/** The tool call identity every team announcement and update shares. */
const teamToolCallFields = {
  toolCallId: z.string().check(z.minLength(1)),
  title: z.optional(z.nullable(z.string())),
  kind: z.optional(z.nullable(z.string())),
  status: z.optional(z.nullable(teamStatusSchema)),
}

/** A team task announcement or update, as the editor shows it. */
export const teamTaskUpdateSchema = z.looseObject({
  ...teamToolCallFields,
  content: z.optional(z.nullable(z.array(teamToolContentSchema))),
})

/** One running task for the agent map's `plan`: its title, traced by its id. */
export interface TeamPlanTask {
  readonly taskId: string
  readonly title: string
}

/**
 * The agent map has no view in an editor, so the running tasks go out as a
 * `plan` with one entry per running task (PLAN.md M96b).
 */
export function teamPlanEntries(tasks: readonly TeamPlanTask[]): PlanEntry[] {
  return tasks.map((task) => ({
    content: task.title,
    priority: TEAM_PLAN_PRIORITY,
    status: 'in_progress',
    _meta: { teamTask: checkedId('task', task.taskId) },
  }))
}

/** One agent-map entry, exactly the SDK `PlanEntry` shape. */
export const teamPlanEntrySchema = z.looseObject({
  content: z.string().check(z.minLength(1)),
  priority: z.enum(['high', 'medium', 'low']),
  status: z.enum(['pending', 'in_progress', 'completed']),
})

/**
 * Exactly the SDK `PermissionOptionKind` (`zPermissionOptionKind` in the
 * installed SDK's generated schema): the frozen contract accepts no option
 * kind the editor would reject.
 */
export const TEAM_PERMISSION_OPTION_KINDS = [
  'allow_once',
  'allow_always',
  'reject_once',
  'reject_always',
] as const

function checkedOptionKind(kind: string): PermissionOptionKind {
  const found = TEAM_PERMISSION_OPTION_KINDS.find((candidate) => candidate === kind)
  if (found === undefined) throw new Error('M96b: a team merge offers options the editor can show')
  return found
}

const teamPermissionOptionSchema = z.looseObject({
  optionId: z.string().check(z.minLength(1)),
  name: z.string(),
  kind: z.enum(TEAM_PERMISSION_OPTION_KINDS),
})

/**
 * The merge as the editor is asked (PLAN.md M96b): a permission request
 * carrying the diff, in every mode. Bypass instead shows the merge as a
 * completed call ({@link teamMergeCompletedCall}).
 */
export function teamMergeRequest(input: {
  readonly sessionId: string
  readonly mergeId: string
  readonly role: string
  readonly agent: string
  readonly detail: string
  readonly diffs: readonly ToolCallContent[]
  readonly options: readonly PermissionOption[]
}): RequestPermissionRequest {
  if (input.sessionId === '') throw new Error('M96b: a team merge needs its session')
  const diffs = checkedDiffs(input.diffs, 'M96b: a team merge carries its diff')
  if (input.options.length === 0) throw new Error('M96b: a team merge offers its options')
  const options = input.options.map((option) => ({
    ...option,
    kind: checkedOptionKind(option.kind),
  }))
  return {
    sessionId: input.sessionId,
    toolCall: {
      toolCallId: teamMergeToolCallId(input.mergeId),
      title: formatTeamPermissionTitle(input),
      kind: TEAM_TASK_TOOL_KIND,
      status: 'pending',
      content: diffs,
    },
    options,
  }
}

/** The merge where asking is off: the same diffs as one completed call. */
export function teamMergeCompletedCall(input: {
  readonly mergeId: string
  readonly role: string
  readonly agent: string
  readonly detail: string
  readonly diffs: readonly ToolCallContent[]
}): ToolCallUpdate {
  return {
    toolCallId: teamMergeToolCallId(input.mergeId),
    title: formatTeamPermissionTitle(input),
    kind: TEAM_TASK_TOOL_KIND,
    status: 'completed',
    content: checkedDiffs(input.diffs, 'M96b: a team merge carries its diff'),
  }
}

/**
 * What a merge permission carries: the report-free content with at least one
 * real diff, so the editor never asks for a merge without showing its patch.
 * (The frozen task content above stays the SDK's own text-or-diff subset:
 * `ToolCallContent` is `content` | `diff` | `terminal`, and nothing frozen
 * here sends a terminal.)
 */
const teamMergeContentSchema = z.array(teamToolContentSchema).check(
  z.minLength(1),
  z.refine((content) => content.some((entry) => entry.type === 'diff')),
)

/** A merge permission request, as the agent sends it and the editor answers. */
export const teamMergeRequestSchema = z.looseObject({
  sessionId: z.string().check(z.minLength(1)),
  toolCall: z.looseObject({
    ...teamToolCallFields,
    content: teamMergeContentSchema,
  }),
  options: z.array(teamPermissionOptionSchema).check(z.minLength(1)),
})

/**
 * The `exec --team` flag contract (PLAN.md M96b): a team run needs the Model
 * API backend, `acceptEdits` and the hard budget, and only engine and local
 * workers run. The runner lane (C-M96b-2) admits; until it lands, a valid
 * request is refused out loud, never run as a single session.
 */
export function teamExecAdmission(input: {
  readonly mode: string
  readonly backend: string
}): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (input.backend !== 'modelApi') return { ok: false, reason: UI_TEXT.execModelApiOnly }
  const isAcceptEdits = input.mode === 'acceptEdits'
  return {
    ok: false,
    reason: isAcceptEdits ? UI_TEXT.execTeamNotReady : UI_TEXT.execTeamNeedsEdits,
  }
}
