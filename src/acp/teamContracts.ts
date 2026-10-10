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
 * One strict zod parse per public builder (PLAN.md M96b): the input is
 * parsed once at entry and the builder runs only on the parsed value, never
 * on the caller's object again. The parse reads each property once, ignores
 * overridden iterators and methods (arrays are read by index), and returns a
 * fresh plain value, so validation and the build below cannot disagree about
 * what the caller passed. Every refusal — a `ZodError` or any other value a
 * hostile getter, proxy or revoked handle throws while the parse reads — is
 * a `TeamContractError` naming the rejected path, never a raw `TypeError`
 * and never a partial build.
 */
function parseInput<Schema extends z.ZodMiniType>(
  schema: Schema,
  input: unknown,
  what: string,
): z.infer<Schema> {
  try {
    const result = schema.safeParse(input)
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.') || '(input)').join(', ')
      throw new TeamContractError(`M96b: a team builder rejected its ${what} at ${paths}`, {
        cause: result.error,
      })
    }
    return result.data
  } catch (error) {
    if (error instanceof TeamContractError) throw error
    throw new TeamContractError(`M96b: a team builder cannot read its ${what}`, { cause: error })
  }
}

/** A `/` in an id would fake a hierarchy, so task and merge ids never hold one. */
const idSchema = z.string().check(
  z.minLength(1),
  z.refine((id) => !id.includes('/'), 'M96b: a team id is addressable'),
)

/** A required free-form string input (a report, a path): any string, but a string. */
const textInputSchema = z.string()

/** Validate the complete output, preserving D36's unknown additional fields. */
function checkedContract<T>(schema: z.ZodMiniType, value: T): T {
  const checked = schema.safeParse(value)
  if (!checked.success)
    throw new TeamContractError('M96b: a team builder rejected its frozen contract', {
      cause: checked.error,
    })
  return value
}

/** The tool call id of a team task: `team/task/<taskId>`. */
export function teamTaskToolCallId(taskId: string): string {
  const parsed = parseInput(idSchema, taskId, 'team task id')
  return `${TEAM_TOOL_CALL_PREFIX}${TASK_SEGMENT}${parsed}`
}

/** The tool call id of a team merge: `team/merge/<mergeId>`. */
export function teamMergeToolCallId(mergeId: string): string {
  const parsed = parseInput(idSchema, mergeId, 'team merge id')
  return `${TEAM_TOOL_CALL_PREFIX}${MERGE_SEGMENT}${parsed}`
}

/** Whether the editor routed this tool call id back to the team. */
export function isTeamToolCallId(toolCallId: string): boolean {
  return typeof toolCallId === 'string' && toolCallId.startsWith(TEAM_TOOL_CALL_PREFIX)
}

/** The agent/detail delimiter of the installed title template (`{agent}: {detail}`). */
const AGENT_DETAIL_SEPARATOR = ': '
/** Every line break the permission-title parser cannot round-trip. */
const TITLE_LINE_BREAK = /[\r\n\u{2028}\u{2029}]/u

/**
 * A role or agent starting a permission title: non-empty, and holding none
 * of the delimiters the installed title parser splits on, so a built title
 * always parses back to exactly one triple (RVCM96B0 finding 3). The detail
 * keeps its greedy round-trip: any non-empty string, colons and line breaks
 * included (RVCM96B0F finding 1 refuses only the missing or non-string
 * detail, never the detail's own text).
 */
const titlePartSchema = z.string().check(
  z.minLength(1),
  z.refine(
    (part) =>
      !part.includes(TITLE_SEPARATOR.trim()) &&
      !part.includes(AGENT_DETAIL_SEPARATOR) &&
      !TITLE_LINE_BREAK.test(part),
    'M96b: a team title part cannot hold a title delimiter',
  ),
)

/** A permission title's fields: strict, so an unknown key fails rather than rides along. */
const titleInputSchema = z.strictObject({
  role: titlePartSchema,
  agent: titlePartSchema,
  detail: z.string().check(z.minLength(1)),
})

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
  const parsed = parseInput(titleInputSchema, input, 'permission title')
  return fill(UI_TEXT.acpTeamPermissionTitle, {
    role: parsed.role,
    agent: parsed.agent,
    detail: parsed.detail,
  })
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
  if (typeof title !== 'string') return undefined
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
  const parsed = parseInput(textInputSchema, path, 'team path')
  return parsed.replaceAll('\\', '/')
}

/** A team diff's fields: strict, so an unknown key fails rather than rides along. */
const teamDiffInputSchema = z.strictObject({
  path: z.string().check(z.minLength(1)),
  oldText: z.optional(z.nullable(z.string())),
  newText: z.string(),
})

/** One file modification as the ACP `diff` content both sides freeze on. */
export function teamDiff(input: {
  readonly path: string
  readonly oldText: string | null
  readonly newText: string
}): ToolCallContent {
  const parsed = parseInput(teamDiffInputSchema, input, 'team diff')
  const path = normalizeTeamPath(parsed.path)
  // `oldText` stays absent when the caller omits it (a new file says so with
  // explicit `null`): assigning `undefined` would lie to `exactOptionalPropertyTypes`.
  if (parsed.oldText === undefined)
    return checkedContract(teamDiffSchema, { type: 'diff', path, newText: parsed.newText })
  return checkedContract(teamDiffSchema, {
    type: 'diff',
    path,
    oldText: parsed.oldText,
    newText: parsed.newText,
  })
}

/** A task's report as its tool call's text content. */
export function teamReportContent(report: string): ToolCallContent {
  const parsed = parseInput(textInputSchema, report, 'team report')
  return checkedContract(teamToolContentSchema, {
    type: 'content',
    content: { type: 'text', text: parsed },
  })
}

// Frozen wire shapes (AGENTS.md rule 7): loose, so anything the wire adds
// later arrives rather than failing the parse (PLAN.md D36). The `z.json`
// catchall keeps that promise to plain wire data while refusing exotic
// smuggled values (functions, symbols, `undefined`, `bigint`): those are
// never wire fields, and keeping them would leak caller state into output.

/** Exactly the SDK `Diff`: an absolute path, the original (null for new files), the result. */
export const teamDiffSchema = z.catchall(
  z.looseObject({
    type: z.literal('diff'),
    path: z.string().check(z.minLength(1)),
    oldText: z.exactOptional(z.nullable(z.string())),
    newText: z.string(),
  }),
  z.json(),
)

const teamTextContentSchema = z.looseObject({
  type: z.literal('content'),
  content: z.catchall(z.looseObject({ type: z.literal('text'), text: z.string() }), z.json()),
})

/** What a team task's tool call may carry: a report, or file diffs. */
export const teamToolContentSchema = z.union([teamTextContentSchema, teamDiffSchema])

const teamStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'failed'])

/** A task announcement's fields: strict, so an unknown key fails rather than rides along. */
const teamTaskCallInputSchema = z.strictObject({
  taskId: idSchema,
  role: titlePartSchema,
  agent: titlePartSchema,
  detail: z.string().check(z.minLength(1)),
})

/** A running task as the editor first sees it: announced, without content. */
export function teamTaskToolCall(input: {
  readonly taskId: string
  readonly role: string
  readonly agent: string
  readonly detail: string
}): ToolCallUpdate {
  const parsed = parseInput(teamTaskCallInputSchema, input, 'task announcement')
  return checkedContract(teamTaskUpdateSchema, {
    toolCallId: `${TEAM_TOOL_CALL_PREFIX}${TASK_SEGMENT}${parsed.taskId}`,
    title: fill(UI_TEXT.acpTeamPermissionTitle, {
      role: parsed.role,
      agent: parsed.agent,
      detail: parsed.detail,
    }),
    kind: TEAM_TASK_TOOL_KIND,
    status: 'in_progress',
  })
}

/** A task completion's fields: strict; `diffs` stays optional, `null` is not a collection. */
const teamTaskReportUpdateInputSchema = z.strictObject({
  taskId: idSchema,
  report: z.string(),
  diffs: z.optional(z.array(teamToolContentSchema)),
})

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
  const parsed = parseInput(teamTaskReportUpdateInputSchema, input, 'task completion')
  const diffs = parsed.diffs ?? []
  return checkedContract(teamTaskUpdateSchema, {
    toolCallId: `${TEAM_TOOL_CALL_PREFIX}${TASK_SEGMENT}${parsed.taskId}`,
    status: 'completed',
    content: [teamReportContent(parsed.report), ...diffs],
  })
}

/**
 * A permission or diff update shows a patch: at least one entry is a real
 * diff, so no accepted update asks for or shows a merge without its patch.
 */
function checkedDiffs(diffs: readonly ToolCallContent[]): ToolCallContent[] {
  return [...checkedContract(teamMergeContentSchema, diffs)]
}

/** A task diff update's fields: strict, so an unknown key fails rather than rides along. */
const teamTaskDiffUpdateInputSchema = z.strictObject({
  taskId: idSchema,
  diffs: z.array(teamToolContentSchema),
})

/** A working task's file changes: its diffs are the call's content. */
export function teamTaskDiffUpdate(input: {
  readonly taskId: string
  readonly diffs: readonly ToolCallContent[]
}): ToolCallUpdate {
  const parsed = parseInput(teamTaskDiffUpdateInputSchema, input, 'task diff update')
  return checkedContract(teamTaskUpdateSchema, {
    toolCallId: `${TEAM_TOOL_CALL_PREFIX}${TASK_SEGMENT}${parsed.taskId}`,
    status: 'in_progress',
    content: checkedDiffs(parsed.diffs),
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
 * One agent-map task's fields: strict, so `null`, a hole (`undefined`), a
 * wrong-typed entry or an unknown key fails with the path (RVCM96B0F
 * finding 2 threw a raw `TypeError` reading `.title` off `null`).
 */
const teamPlanTaskInputSchema = z.strictObject({
  taskId: idSchema,
  title: z.string().check(z.minLength(1)),
})

/** The agent-map input: exactly the indexed entries, each one a strict task. */
const teamPlanEntriesInputSchema = z.array(teamPlanTaskInputSchema)

/**
 * The agent map has no view in an editor, so the running tasks go out as a
 * `plan` with one entry per running task (PLAN.md M96b). The entries are
 * mapped from the parser's own fresh array, so caller shadows and iterators
 * cannot change the count.
 */
export function teamPlanEntries(tasks: readonly TeamPlanTask[]): PlanEntry[] {
  const parsed = parseInput(teamPlanEntriesInputSchema, tasks, 'agent-map plan')
  const plans: PlanEntry[] = parsed.map((task) => ({
    content: task.title,
    priority: TEAM_PLAN_PRIORITY,
    status: 'in_progress',
    _meta: { teamTask: task.taskId },
  }))
  return checkedContract(z.array(teamPlanEntrySchema).check(z.length(parsed.length)), plans)
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

const teamPermissionOptionSchema = z.catchall(
  z.looseObject({
    optionId: z.string().check(z.minLength(1)),
    name: z.string(),
    kind: z.enum(TEAM_PERMISSION_OPTION_KINDS),
  }),
  z.json(),
)

/** A merge permission request's fields: strict, so an unknown key fails rather than rides along. */
const teamMergeRequestInputSchema = z.strictObject({
  sessionId: z.string().check(z.minLength(1)),
  mergeId: idSchema,
  role: titlePartSchema,
  agent: titlePartSchema,
  detail: z.string().check(z.minLength(1)),
  diffs: z.array(teamToolContentSchema),
  options: z.array(teamPermissionOptionSchema).check(z.minLength(1)),
})

/** A Bypass merge call's fields: strict, so an unknown key fails rather than rides along. */
const teamMergeCompletedCallInputSchema = z.strictObject({
  mergeId: idSchema,
  role: titlePartSchema,
  agent: titlePartSchema,
  detail: z.string().check(z.minLength(1)),
  diffs: z.array(teamToolContentSchema),
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
  const parsed = parseInput(teamMergeRequestInputSchema, input, 'merge permission request')
  const diffs = checkedDiffs(parsed.diffs)
  return checkedContract(teamMergeRequestSchema, {
    sessionId: parsed.sessionId,
    toolCall: {
      toolCallId: `${TEAM_TOOL_CALL_PREFIX}${MERGE_SEGMENT}${parsed.mergeId}`,
      title: fill(UI_TEXT.acpTeamPermissionTitle, {
        role: parsed.role,
        agent: parsed.agent,
        detail: parsed.detail,
      }),
      kind: TEAM_TASK_TOOL_KIND,
      status: 'pending',
      content: diffs,
    },
    options: [...parsed.options],
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
  const parsed = parseInput(teamMergeCompletedCallInputSchema, input, 'merge completed call')
  return checkedContract(teamTaskUpdateSchema, {
    toolCallId: `${TEAM_TOOL_CALL_PREFIX}${MERGE_SEGMENT}${parsed.mergeId}`,
    title: fill(UI_TEXT.acpTeamPermissionTitle, {
      role: parsed.role,
      agent: parsed.agent,
      detail: parsed.detail,
    }),
    kind: TEAM_TASK_TOOL_KIND,
    status: 'completed',
    content: checkedDiffs(parsed.diffs),
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

/** A team exec admission's fields: strict, so an unknown key fails rather than rides along. */
const teamExecAdmissionInputSchema = z.strictObject({
  mode: z.string(),
  backend: z.string(),
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
  const parsed = parseInput(teamExecAdmissionInputSchema, input, 'team exec admission')
  if (parsed.backend !== 'modelApi') return { ok: false, reason: UI_TEXT.execModelApiOnly }
  const isAcceptEdits = parsed.mode === 'acceptEdits'
  return {
    ok: false,
    reason: isAcceptEdits ? UI_TEXT.execTeamNotReady : UI_TEXT.execTeamNeedsEdits,
  }
}
