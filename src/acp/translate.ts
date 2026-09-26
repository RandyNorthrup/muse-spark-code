// What an ACP client sees of a Muse Spark conversation (PLAN.md D62): the
// panel's AgentEvents become `session/update` notifications, a prompt's
// content blocks become turn parts, and the backend's approval choices
// become permission options. Pure; `agent.ts` sends what these return.

import { Buffer } from 'node:buffer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  ContentBlock,
  McpServer,
  PermissionOption,
  PermissionOptionKind,
  PlanEntry,
  PlanEntryStatus,
  RequestPermissionResponse,
  SessionUpdate,
  ToolCallContent,
  ToolCallLocation,
  ToolCallStatus,
  ToolCallUpdate,
  ToolKind,
} from '@agentclientprotocol/sdk'
import type { SessionMcpServer, TurnPart } from '../core/agent/agentBackend'
import { readImageInfo } from '../core/imageDimensions'
import type {
  AgentEvent,
  ApprovalChoice,
  ApprovalSubject,
  ItemSnapshot,
  TodoItem,
} from '../shared/agentEvents'
import {
  ACP_TOOL_OUTPUT_MAX_CHARS,
  FILE_EDIT_TOOLS,
  FILE_READ_TOOLS,
  IDE_CONTEXT_TAGS,
  IMAGE_MAKING_TOOLS,
  MAX_IMAGE_BYTES,
  MODEL_API_WEB_SEARCH_TOOL,
  SELECTION_TEXT_MAX_CHARS,
  SHELL_TOOLS,
  UI_TEXT,
} from '../shared/constants'
import { fill } from '../shared/l10n/text'
import { formatMention } from '../shared/mentions'

const TEXT_FIELD = 'text'
const OUTPUT_FIELD = 'output'
// A reasoning item streams its summary parts as `summary.0`, `summary.1`, …
const SUMMARY_FIELD = /^summary\.(\d+)$/
const PART_SEPARATOR = '\n\n'
const FILE_SCHEME = 'file:'
const APPROVED_DECISION_PREFIX = 'approved'
const ONCE_SCOPE = 'once'
const MCP_TOOL = /^mcp__(.+?)__(.+)$/
// The argument fields that say what a call is about, in the order a title prefers them.
const TITLE_FIELDS = [
  'description',
  'command',
  'path',
  'pattern',
  'query',
  'url',
  'objective',
  'prompt',
] as const
const SEARCH_TOOLS: ReadonlySet<string> = new Set([
  'search',
  'list_files',
  'tool_search',
  MODEL_API_WEB_SEARCH_TOOL,
])
const FETCH_TOOLS: ReadonlySet<string> = new Set(['web_fetch'])
const EXECUTE_TOOLS: ReadonlySet<string> = new Set(['code_exec'])
// A `!` command the user ran (`userShell` items) is shown as the shell tool.
const USER_SHELL_TOOL = 'shell'
const PLANNING_TOOLS: ReadonlySet<string> = new Set([
  'todo_write',
  'write_todos',
  'update_plan',
  'TodoWrite',
])
const READING_TOOLS: ReadonlySet<string> = new Set(['read_memory', 'read_skill'])
// Item statuses that ACP calls failed: MSP's `ItemStatus`, and the Model API
// backend's `rejected` for a call the user denied.
const FAILED_STATUSES: ReadonlySet<string> = new Set([
  'failed',
  'declined',
  'rejected',
  'cancelled',
  'interrupted',
])
const TODO_IN_PROGRESS: ReadonlySet<string> = new Set(['in_progress', 'inProgress'])
const TODO_DONE: ReadonlySet<string> = new Set(['completed', 'done'])
const PLAN_PRIORITY = 'medium'

type Arguments = Readonly<Record<string, unknown>>

/** A call's arguments as an object; undefined when they are not JSON (they show as text then). */
function parseArguments(raw: string | undefined): Arguments | undefined {
  if (raw === undefined || raw === '') {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Arguments)
      : undefined
  } catch {
    return undefined
  }
}

function stringField(args: Arguments | undefined, key: string): string | undefined {
  const value = args?.[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** The table's name for a wire tool, an MCP tool as "tool (server)", or the name as it came. */
export function toolName(tool: string): string {
  const labels: Readonly<Record<string, string>> = UI_TEXT.toolLabels
  if (Object.hasOwn(labels, tool)) {
    return labels[tool] ?? tool
  }
  const mcp = MCP_TOOL.exec(tool)
  return mcp === null
    ? tool
    : fill(UI_TEXT.mcpToolLabel, { server: mcp[1] ?? '', tool: mcp[2] ?? '' })
}

/** "Edit: src/app.ts", "Bash: Run the tests": the name, and what the call is about. */
function toolTitle(tool: string, args: Arguments | undefined): string {
  const name = toolName(tool)
  const detail = TITLE_FIELDS.map((key) => stringField(args, key)).find(
    (value) => value !== undefined,
  )
  return detail === undefined ? name : `${name}: ${detail}`
}

/** The icon family a client shows for a tool. */
export function toolKind(tool: string): ToolKind {
  if (SHELL_TOOLS.has(tool) || EXECUTE_TOOLS.has(tool)) {
    return 'execute'
  }
  if (FILE_EDIT_TOOLS.has(tool) || IMAGE_MAKING_TOOLS.has(tool)) {
    return 'edit'
  }
  if (FILE_READ_TOOLS.has(tool) || READING_TOOLS.has(tool)) {
    return 'read'
  }
  if (SEARCH_TOOLS.has(tool)) {
    return 'search'
  }
  if (FETCH_TOOLS.has(tool)) {
    return 'fetch'
  }
  return PLANNING_TOOLS.has(tool) ? 'think' : 'other'
}

/** The file a call names, as the absolute path ACP asks for. */
function toolLocations(args: Arguments | undefined, cwd: string): ToolCallLocation[] {
  const file = stringField(args, 'path')
  return file === undefined ? [] : [{ path: path.resolve(cwd, file) }]
}

function clippedOutput(text: string): string {
  return text.length > ACP_TOOL_OUTPUT_MAX_CHARS ? text.slice(0, ACP_TOOL_OUTPUT_MAX_CHARS) : text
}

function textContent(text: string): ToolCallContent {
  return { type: 'content', content: { type: 'text', text: clippedOutput(text) } }
}

/** An edit's change as a diff where the arguments carry it (edit and write), else nothing. */
function editDiff(tool: string, args: Arguments | undefined, cwd: string): ToolCallContent[] {
  const file = stringField(args, 'path')
  if (file === undefined || args === undefined || !FILE_EDIT_TOOLS.has(tool)) {
    return []
  }
  const absolute = path.resolve(cwd, file)
  const oldText = args['old_str'] ?? args['old_string']
  const newText = args['new_str'] ?? args['new_string'] ?? args['content']
  if (typeof newText !== 'string') {
    return []
  }
  return [
    {
      type: 'diff',
      path: absolute,
      oldText: typeof oldText === 'string' ? oldText : null,
      newText,
    },
  ]
}

function toolStatus(status: string, isCompleted: boolean): ToolCallStatus {
  if (FAILED_STATUSES.has(status)) {
    return 'failed'
  }
  return isCompleted ? 'completed' : 'in_progress'
}

/** What a finished call shows: its diff, then its output or why it failed. */
function toolContent(item: ItemSnapshot, output: string, cwd: string): ToolCallContent[] {
  const content = editDiff(item.tool ?? '', parseArguments(item.args), cwd)
  const text = item.visibleOutput ?? output
  if (text !== '') {
    content.push(textContent(text))
  }
  if (item.failureReason !== undefined && item.failureReason !== text) {
    content.push(textContent(item.failureReason))
  }
  return content
}

function planStatus(status: string): PlanEntryStatus {
  if (TODO_DONE.has(status)) {
    return 'completed'
  }
  return TODO_IN_PROGRESS.has(status) ? 'in_progress' : 'pending'
}

/** The todo list as an ACP plan: the whole list, every time. */
export function planEntries(items: readonly TodoItem[]): PlanEntry[] {
  return items.map((item) => ({
    content: TODO_IN_PROGRESS.has(item.status) ? (item.activeForm ?? item.text) : item.text,
    priority: PLAN_PRIORITY,
    status: planStatus(item.status),
  }))
}

/**
 * Turns one session's AgentEvents into ACP session updates. It remembers,
 * per item, how much text went out (an item can arrive whole after its
 * deltas, or whole on its own in a replayed history) and a tool call's
 * output so far, which ACP sends whole with the finished call.
 */
export class UpdateTranslator {
  private readonly sentText = new Map<string, number>()
  private readonly summaryParts = new Map<string, number>()
  private readonly toolOutput = new Map<string, string>()
  private readonly announced = new Set<string>()
  /** Each item's kind, so a delta is routed by what it belongs to. */
  private readonly kinds = new Map<string, string>()

  public constructor(
    private readonly cwd: string,
    /** Replaying a loaded history: the user's own messages go out too. */
    private readonly isReplay: boolean,
  ) {}

  private deltaUpdates(itemId: string, field: string, delta: string): SessionUpdate[] {
    if (field === OUTPUT_FIELD) {
      this.toolOutput.set(itemId, `${this.toolOutput.get(itemId) ?? ''}${delta}`)
      return []
    }
    const kind = this.kinds.get(itemId)
    const summary = SUMMARY_FIELD.exec(field)
    if (kind === 'reasoning' && summary !== null) {
      const index = Number(summary[1])
      const isNewPart = this.summaryParts.has(itemId) && this.summaryParts.get(itemId) !== index
      this.summaryParts.set(itemId, index)
      return [thoughtText(isNewPart ? `${PART_SEPARATOR}${delta}` : delta)]
    }
    if (field !== TEXT_FIELD || (kind !== 'reasoning' && kind !== 'agentMessage')) {
      return []
    }
    this.sentText.set(itemId, (this.sentText.get(itemId) ?? 0) + delta.length)
    return [kind === 'reasoning' ? thoughtText(delta) : agentText(delta)]
  }

  private remainingText(
    itemId: string,
    text: string | undefined,
    wrap: (text: string) => SessionUpdate,
  ): SessionUpdate[] {
    if (text === undefined || this.summaryParts.has(itemId)) {
      return []
    }
    const sent = this.sentText.get(itemId) ?? 0
    if (text.length <= sent) {
      return []
    }
    this.sentText.set(itemId, text.length)
    return [wrap(text.slice(sent))]
  }

  private toolUpdates(item: ItemSnapshot, isCompleted: boolean): SessionUpdate[] {
    const tool = item.kind === 'userShell' ? USER_SHELL_TOOL : (item.tool ?? item.kind)
    const args = parseArguments(item.args)
    const title =
      item.kind === 'subagent'
        ? `${toolName('subagent_spawn')}: ${item.objective ?? item.role ?? ''}`
        : toolTitle(tool, args)
    const status = toolStatus(item.status, isCompleted)
    const updates: SessionUpdate[] = []
    if (!this.announced.has(item.itemId)) {
      this.announced.add(item.itemId)
      updates.push({
        sessionUpdate: 'tool_call',
        toolCallId: item.itemId,
        title,
        kind: item.kind === 'subagent' ? 'other' : toolKind(tool),
        status,
        locations: toolLocations(args, this.cwd),
        rawInput: args ?? item.args,
      })
      if (!isCompleted) {
        return updates
      }
    }
    const content = isCompleted
      ? toolContent(item, this.toolOutput.get(item.itemId) ?? '', this.cwd)
      : undefined
    updates.push({
      sessionUpdate: 'tool_call_update',
      toolCallId: item.itemId,
      status,
      ...(content !== undefined && { content }),
      ...(item.kind === 'subagent' && item.result !== undefined && { rawOutput: item.result }),
    })
    if (isCompleted) {
      this.toolOutput.delete(item.itemId)
    }
    return updates
  }

  public updates(event: AgentEvent): SessionUpdate[] {
    switch (event.type) {
      case 'itemStarted':
      case 'itemUpdated': {
        return this.itemUpdates(event.item, false)
      }
      case 'itemCompleted': {
        return this.itemUpdates(event.item, true)
      }
      case 'textDelta': {
        return this.deltaUpdates(event.itemId, event.field, event.delta)
      }
      case 'todoChanged': {
        return [{ sessionUpdate: 'plan', entries: planEntries(event.items) }]
      }
      case 'sessionNamed': {
        return [{ sessionUpdate: 'session_info_update', title: event.name }]
      }
      case 'contextUsage': {
        return event.windowTokens === undefined
          ? []
          : [{ sessionUpdate: 'usage_update', used: event.usedTokens, size: event.windowTokens }]
      }
      case 'backendNotice': {
        return [agentText(`${event.text}${PART_SEPARATOR}`)]
      }
      default: {
        return []
      }
    }
  }

  /** A whole item: the text not yet sent, or a tool call announced or brought up to date. */
  public itemUpdates(item: ItemSnapshot, isCompleted: boolean): SessionUpdate[] {
    this.kinds.set(item.itemId, item.kind)
    switch (item.kind) {
      case 'agentMessage': {
        return this.remainingText(item.itemId, item.text, agentText)
      }
      case 'reasoning': {
        const text = item.text ?? (item.summary ?? []).join(PART_SEPARATOR)
        return this.remainingText(item.itemId, text, thoughtText)
      }
      case 'userMessage': {
        return this.isReplay ? this.remainingText(item.itemId, item.text, userText) : []
      }
      case 'toolCall':
      case 'userShell':
      case 'subagent': {
        return this.toolUpdates(item, isCompleted)
      }
      default: {
        return []
      }
    }
  }
}

function agentText(text: string): SessionUpdate {
  return { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }
}

function thoughtText(text: string): SessionUpdate {
  return { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text } }
}

function userText(text: string): SessionUpdate {
  return { sessionUpdate: 'user_message_chunk', content: { type: 'text', text } }
}

// --- approvals ---------------------------------------------------------------

function isApproval(choice: ApprovalChoice): boolean {
  return choice.decision.startsWith(APPROVED_DECISION_PREFIX)
}

function permissionKind(choice: ApprovalChoice): PermissionOptionKind {
  const isOnce = choice.scope === ONCE_SCOPE
  if (isApproval(choice)) {
    return isOnce ? 'allow_once' : 'allow_always'
  }
  return isOnce ? 'reject_once' : 'reject_always'
}

/** The backend's choices as the client's options, each by its own id and label. */
export function permissionOptions(choices: readonly ApprovalChoice[]): PermissionOption[] {
  return choices.map((choice) => ({
    optionId: choice.choiceId,
    name: choice.label,
    kind: permissionKind(choice),
  }))
}

/**
 * The choice to decide with (D62): the one the client picked when it was
 * offered, and otherwise (cancelled, unknown, no answer) the backend's own
 * deny choice, preferring "this once". Undefined only when the backend
 * offered no way to deny, and then the caller stops the turn instead.
 */
export function decidedChoice(
  response: RequestPermissionResponse | undefined,
  choices: readonly ApprovalChoice[],
): ApprovalChoice | undefined {
  const outcome = response?.outcome
  const picked =
    outcome?.outcome === 'selected'
      ? choices.find((choice) => choice.choiceId === outcome.optionId)
      : undefined
  if (picked !== undefined) {
    return picked
  }
  const denials = choices.filter((choice) => !isApproval(choice))
  return denials.find((choice) => choice.scope === ONCE_SCOPE) ?? denials[0]
}

/** What the approval is about, in one line: the command, the file, the host or the tool. */
function subjectDetail(subject: ApprovalSubject): string | undefined {
  const stages = subject.stages?.map((stage) => stage.argv.join(' ')).join(' ; ')
  return subject.command ?? stages ?? subject.path ?? subject.host ?? subject.target
}

/** The tool call a permission request is about, as the client shows it. */
export function approvalToolCall(
  event: Extract<AgentEvent, { type: 'approvalRequested' }>,
  cwd: string,
): ToolCallUpdate {
  const args = parseArguments(event.rawArgs)
  const detail = subjectDetail(event.subject)
  const name = toolName(event.toolName)
  return {
    toolCallId: event.itemId,
    title: detail === undefined ? toolTitle(event.toolName, args) : `${name}: ${detail}`,
    kind: toolKind(event.toolName),
    status: 'pending',
    locations: toolLocations(args, cwd),
    rawInput: args ?? event.rawArgs,
  }
}

// --- prompts -----------------------------------------------------------------

export type PromptResult =
  | { readonly ok: true; readonly parts: TurnPart[]; readonly displayText: string }
  | { readonly ok: false; readonly reason: string }

/** A file the client attached, as context the model reads (clipped like a selection). */
function attachedContext(uri: string, text: string): string {
  const body =
    text.length > SELECTION_TEXT_MAX_CHARS ? text.slice(0, SELECTION_TEXT_MAX_CHARS) : text
  const tag = IDE_CONTEXT_TAGS.attachedContext
  return `<${tag} uri="${uri}">\n${body}\n</${tag}>`
}

/** A `file:` link inside the folder as an @mention, anything else as its URI. */
function linkText(uri: string, cwd: string): string {
  if (!uri.startsWith(FILE_SCHEME)) {
    return uri
  }
  let absolute: string
  try {
    absolute = fileURLToPath(uri)
  } catch {
    // A `file:` URI this platform cannot map to a path (another host's share).
    return uri
  }
  const relative = path.relative(cwd, absolute)
  return relative.startsWith('..') || path.isAbsolute(relative)
    ? uri
    : formatMention(relative.split(path.sep).join('/'))
}

function imagePart(base64Data: string): TurnPart | string {
  const bytes = Buffer.from(base64Data, 'base64')
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return UI_TEXT.attachmentTooLarge
  }
  const info = readImageInfo(bytes)
  return info === undefined
    ? UI_TEXT.attachmentUnsupported
    : {
        type: 'image',
        base64Data,
        mediaType: info.mediaType,
        width: info.width,
        height: info.height,
      }
}

/** One content block as a turn part; a string is why it was refused. */
function blockPart(block: ContentBlock, cwd: string): TurnPart | string {
  switch (block.type) {
    case 'text': {
      return { type: 'text', text: block.text }
    }
    case 'image': {
      return imagePart(block.data)
    }
    case 'resource_link': {
      return { type: 'text', text: linkText(block.uri, cwd) }
    }
    case 'resource': {
      const { resource } = block
      return 'text' in resource
        ? { type: 'text', text: attachedContext(resource.uri, resource.text) }
        : imagePart(resource.blob)
    }
    default: {
      return UI_TEXT.attachmentUnsupported
    }
  }
}

/**
 * A prompt's blocks as the turn's parts; the first block the backend cannot
 * take refuses the whole prompt, so nothing is sent half. `displayText` is
 * what the user typed, for the stored transcript.
 */
export function promptParts(blocks: readonly ContentBlock[], cwd: string): PromptResult {
  const parts: TurnPart[] = []
  for (const block of blocks) {
    const part = blockPart(block, cwd)
    if (typeof part === 'string') {
      return { ok: false, reason: part }
    }
    parts.push(part)
  }
  const displayText = blocks
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join(PART_SEPARATOR)
  return { ok: true, parts, displayText }
}

/** The editor's MCP servers the backend can run, and the names of those it cannot. */
export interface ForwardedMcpServers {
  readonly servers: Readonly<Record<string, SessionMcpServer>>
  readonly skipped: readonly string[]
}

function pairs(entries: readonly { readonly name: string; readonly value: string }[]) {
  return Object.fromEntries(entries.map((entry) => [entry.name, entry.value]))
}

/**
 * An ACP client's MCP servers as the engine's (M63c): stdio and HTTP, keyed
 * by name. SSE and the unstable ACP transport are left out, as is a second
 * server under a name already taken.
 */
export function mcpServersFrom(requested: readonly McpServer[]): ForwardedMcpServers {
  const servers = new Map<string, SessionMcpServer>()
  const skipped: string[] = []
  for (const server of requested) {
    if (servers.has(server.name)) {
      skipped.push(server.name)
      continue
    }
    // A stdio server has no `type` in the schema; some clients send `stdio` anyway.
    if ('command' in server) {
      servers.set(server.name, {
        command: server.command,
        args: server.args,
        env: pairs(server.env),
      })
    } else if (server.type === 'http') {
      servers.set(server.name, { url: server.url, headers: pairs(server.headers) })
    } else {
      skipped.push(server.name)
    }
  }
  return { servers: Object.fromEntries(servers), skipped }
}
