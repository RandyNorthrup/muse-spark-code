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

/** A caller value cannot be represented by the frozen team contract. */
export class TeamContractError extends Error {
  override readonly name = 'TeamContractError'
}

/**
 * One entry snapshot of a caller's input (PLAN.md M96b): `structuredClone`
 * reads getters once, ignores overridden methods and custom iterators, and
 * refuses proxies, functions and symbols, so validation and the build below
 * see the same plain data the caller can no longer change. Anything the
 * clone cannot copy is a typed refusal, never a partial build.
 */
function snapshotInput<T>(value: T): T {
  try {
    return structuredClone(value)
  } catch {
    throw new TeamContractError('M96b: a team builder cannot copy its input')
  }
}

/** Validate the complete output, preserving D36's unknown additional fields. */
function checkedContract<T>(schema: z.ZodMiniType, value: T): T {
  const checked = schema.safeParse(value)
  if (!checked.success)
    throw new TeamContractError('M96b: a team builder rejected its frozen contract', {
      cause: checked.error,
    })
  return value
}

/** A `/` in an id would fake a hierarchy, so task and merge ids never hold one. */
function checkedId(kind: 'task' | 'merge', id: string): string {
  if (typeof id !== 'string' || id === '' || id.includes('/'))
    throw new TeamContractError(`M96b: the team ${kind} id is not addressable`)
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
    typeof value !== 'string' ||
    value === '' ||
    value.includes(TITLE_SEPARATOR.trim()) ||
    value.includes(AGENT_DETAIL_SEPARATOR) ||
    TITLE_LINE_BREAK.test(value)
  )
    throw new TeamContractError(`M96b: the team ${kind} cannot start a permission title`)
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
  const snap = snapshotInput(input)
  const role = checkedTitlePart('role', snap.role)
  const agent = checkedTitlePart('agent', snap.agent)
  if (snap.detail === '')
    throw new TeamContractError('M96b: a team permission title needs its detail')
  return fill(UI_TEXT.acpTeamPermissionTitle, { role, agent, detail: snap.detail })
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
  const snap = snapshotInput(input)
  if (typeof snap.path !== 'string') throw new TeamContractError('M96b: a team diff needs its path')
  return checkedContract(teamDiffSchema, {
    type: 'diff',
    path: normalizeTeamPath(snap.path),
    oldText: snap.oldText,
    newText: snap.newText,
  })
}

/** A task's report as its tool call's text content. */
export function teamReportContent(report: string): ToolCallContent {
  return checkedContract(teamToolContentSchema, {
    type: 'content',
    content: { type: 'text', text: report },
  })
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
  const snap = snapshotInput(input)
  return checkedContract(teamTaskUpdateSchema, {
    toolCallId: teamTaskToolCallId(snap.taskId),
    title: formatTeamPermissionTitle(snap),
    kind: TEAM_TASK_TOOL_KIND,
    status: 'in_progress',
  })
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
  const snap = snapshotInput(input)
  const diffs = checkedContract(z.array(teamToolContentSchema), snap.diffs ?? [])
  return checkedContract(teamTaskUpdateSchema, {
    toolCallId: teamTaskToolCallId(snap.taskId),
    status: 'completed',
    content: [teamReportContent(snap.report), ...diffs],
  })
}

/**
 * A permission or diff update shows a patch: at least one entry is a real
 * diff, so no accepted update asks for or shows a merge without its patch.
 */
function checkedDiffs(diffs: readonly ToolCallContent[]): ToolCallContent[] {
  return [...checkedContract(teamMergeContentSchema, diffs)]
}

/** A working task's file changes: its diffs are the call's content. */
export function teamTaskDiffUpdate(input: {
  readonly taskId: string
  readonly diffs: readonly ToolCallContent[]
}): ToolCallUpdate {
  const snap = snapshotInput(input)
  return checkedContract(teamTaskUpdateSchema, {
    toolCallId: teamTaskToolCallId(snap.taskId),
    status: 'in_progress',
    content: checkedDiffs(snap.diffs),
  })
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
  const snap = snapshotInput(tasks)
  return checkedContract(
    z.array(teamPlanEntrySchema).check(z.length(snap.length)),
    snap.map((task) => ({
      content: task.title,
      priority: TEAM_PLAN_PRIORITY,
      status: 'in_progress',
      _meta: { teamTask: checkedId('task', task.taskId) },
    })),
  )
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
  const snap = snapshotInput(input)
  const diffs = checkedDiffs(snap.diffs)
  const options = checkedContract(
    z.array(teamPermissionOptionSchema).check(z.minLength(1)),
    snap.options,
  )
  return checkedContract(teamMergeRequestSchema, {
    sessionId: snap.sessionId,
    toolCall: {
      toolCallId: teamMergeToolCallId(snap.mergeId),
      title: formatTeamPermissionTitle(snap),
      kind: TEAM_TASK_TOOL_KIND,
      status: 'pending',
      content: diffs,
    },
    options: [...options],
  })
}

/** The merge where asking is off: the same diffs as one completed call. */
export function teamMergeCompletedCall(input: {
  readonly mergeId: string
  readonly role: string
  readonly agent: string
  readonly detail: string
  readonly diffs: readonly ToolCallContent[]
}): ToolCallUpdate {
  const snap = snapshotInput(input)
  return checkedContract(teamTaskUpdateSchema, {
    toolCallId: teamMergeToolCallId(snap.mergeId),
    title: formatTeamPermissionTitle(snap),
    kind: TEAM_TASK_TOOL_KIND,
    status: 'completed',
    content: checkedDiffs(snap.diffs),
  })
}

/**
 * What a merge permission carries: the frozen content with at least one
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
  const snap = snapshotInput(input)
  if (snap.backend !== 'modelApi') return { ok: false, reason: UI_TEXT.execModelApiOnly }
  const isAcceptEdits = snap.mode === 'acceptEdits'
  return {
    ok: false,
    reason: isAcceptEdits ? UI_TEXT.execTeamNotReady : UI_TEXT.execTeamNeedsEdits,
  }
}
