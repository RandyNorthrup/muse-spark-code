// M91b: Amp and OpenCode plugin hooks on Muse events, per PLAN.md M91's lane
// X mapping tables (binding). Each imported record names its source hook
// (`sourceEvent`); this module says which Muse event fires it, builds the
// plugin's own payload from the Muse payload, and reads the plugin's answer
// back by its source's rules. Sources are the saved research under
// hooks-parity/raw/: A = amp_plugin-api.md, AS = amp_cli_streaming-json.md,
// OI = oc_plugin_index.ts, OP = oc_plugins.mdx, OT = oc_sdk_types.gen.ts,
// OS = oc_config_schema.json, OC = oc_config.mdx.
//
// Tool names and arguments: a guard that tests `input.tool === "bash"` or
// reads `output.args.filePath` must see what its source shows, or it never
// fires (weaker) or throws (and blocks everything). Where a source shows no
// name, the runtime's own name is kept, never a guessed one (as lane P).

import {
  MODEL_API_TOOLS,
  PLUGIN_FAIL_CLOSED_SOURCE,
  type PLUGIN_FORMATS,
} from '../../../shared/constants'
import type { HookAnswer, HookEvent } from './hooks'
import type { PluginCall } from './pluginHost'

export type PluginFormat = (typeof PLUGIN_FORMATS)[number]

export interface PluginRoute {
  /** The Muse event the plugin hook fires on. */
  readonly event: HookEvent
  /** The child's hook: an Amp event, an OpenCode typed hook, or `event` for its bus. */
  readonly hook: string
  /** An OpenCode bus event's type, for `event` routes. */
  readonly busType?: string
  /** A fixed tool matcher for the record (OpenCode `file.edited`: edits only). */
  readonly matcher?: string
  /**
   * Whether any failure blocks: OpenCode's `tool.execute.before` blocks on a
   * throw (OI:266), so this child crashing counts as one. Amp logs a
   * handler's failure (the lead's rule, M91b), so its hooks fail open.
   */
  readonly failClosed: boolean
}

const BUS = 'event'
/** The prefix of a bus route's source event: `event:session.created`. */
export const PLUGIN_BUS_PREFIX = `${BUS}:`

function bus(type: string, event: HookEvent, matcher?: string): PluginRoute {
  return {
    event,
    hook: BUS,
    busType: type,
    failClosed: false,
    ...(matcher !== undefined && { matcher }),
  }
}

/** Every mapped source hook, by format, from the lane X tables. */
export const PLUGIN_ROUTES: Readonly<Record<PluginFormat, Readonly<Record<string, PluginRoute>>>> =
  {
    amp: {
      // A:1929-1936; A:1953-1979 (tool.call results); A:2044-2070; A:2074-2105; A:2109-2135.
      'session.start': { event: 'SessionStart', hook: 'session.start', failClosed: false },
      'tool.call': { event: 'PreToolUse', hook: 'tool.call', failClosed: false },
      'tool.result': { event: 'PostToolUse', hook: 'tool.result', failClosed: false },
      'agent.start': { event: 'UserPromptSubmit', hook: 'agent.start', failClosed: false },
      'agent.end': { event: 'Stop', hook: 'agent.end', failClosed: false },
    },
    opencode: {
      // OI:266 (a throw blocks), OI:274, OI:261, OI:234, OI:305.
      [PLUGIN_FAIL_CLOSED_SOURCE]: {
        event: 'PreToolUse',
        hook: PLUGIN_FAIL_CLOSED_SOURCE,
        failClosed: true,
      },
      'tool.execute.after': { event: 'PostToolUse', hook: 'tool.execute.after', failClosed: false },
      'permission.ask': { event: 'PermissionRequest', hook: 'permission.ask', failClosed: false },
      'chat.message': { event: 'UserPromptSubmit', hook: 'chat.message', failClosed: false },
      'experimental.session.compacting': {
        event: 'PreCompact',
        hook: 'experimental.session.compacting',
        failClosed: false,
      },
      // The bus subset (raw-kiro-amp-opencode-continue.md:36, OI:224): observation only.
      [`${PLUGIN_BUS_PREFIX}session.created`]: bus('session.created', 'SessionStart'),
      [`${PLUGIN_BUS_PREFIX}session.deleted`]: bus('session.deleted', 'SessionEnd'),
      [`${PLUGIN_BUS_PREFIX}session.compacted`]: bus('session.compacted', 'PostCompact'),
      [`${PLUGIN_BUS_PREFIX}permission.asked`]: bus('permission.asked', 'PermissionRequest'),
      [`${PLUGIN_BUS_PREFIX}session.error`]: bus('session.error', 'StopFailure'),
      [`${PLUGIN_BUS_PREFIX}file.edited`]: bus('file.edited', 'PostToolUse', 'Edit|Write'),
      [`${PLUGIN_BUS_PREFIX}tool.execute.before`]: bus('tool.execute.before', 'PreToolUse'),
      [`${PLUGIN_BUS_PREFIX}tool.execute.after`]: bus('tool.execute.after', 'PostToolUse'),
    },
  }

/** The route of one record, or undefined when the mapping has none. */
export function pluginRoute(format: PluginFormat, sourceEvent: string): PluginRoute | undefined {
  const routes = PLUGIN_ROUTES[format]
  return Object.hasOwn(routes, sourceEvent) ? routes[sourceEvent] : undefined
}

/**
 * Our tools by each source's name. Amp: the CLI's tool list (AS:51), `Bash`
 * also named `shell_command` by A:2275. OpenCode: its permission keys
 * (OS:117-160) and tools (OC:352, OC:520), `bash` and `read` as its plugins
 * test them (OP:94, OP:251). A tool not here keeps its runtime name (an MCP
 * tool is `mcp__<server>__<tool>` in both, A:903).
 */
const TOOL_NAMES: Readonly<Record<PluginFormat, Readonly<Record<string, string>>>> = {
  amp: {
    [MODEL_API_TOOLS.bash]: 'Bash',
    [MODEL_API_TOOLS.powershell]: 'Bash',
    [MODEL_API_TOOLS.readFile]: 'Read',
    [MODEL_API_TOOLS.writeFile]: 'create_file',
    [MODEL_API_TOOLS.editFile]: 'edit_file',
    [MODEL_API_TOOLS.search]: 'Grep',
    [MODEL_API_TOOLS.listFiles]: 'glob',
    [MODEL_API_TOOLS.todoWrite]: 'todo_write',
    [MODEL_API_TOOLS.webFetch]: 'read_web_page',
  },
  opencode: {
    [MODEL_API_TOOLS.bash]: 'bash',
    [MODEL_API_TOOLS.powershell]: 'bash',
    [MODEL_API_TOOLS.readFile]: 'read',
    [MODEL_API_TOOLS.writeFile]: 'write',
    [MODEL_API_TOOLS.editFile]: 'edit',
    [MODEL_API_TOOLS.search]: 'grep',
    [MODEL_API_TOOLS.listFiles]: 'glob',
    [MODEL_API_TOOLS.todoWrite]: 'todowrite',
    [MODEL_API_TOOLS.webFetch]: 'webfetch',
  },
}

/**
 * Argument names that differ, ours → theirs, per tool. Only what a source
 * shows: OpenCode's `read` takes `filePath` (OP:251) and `bash` takes
 * `command` (OP:94, the same as ours); Amp's `Read` takes `path` (AS:63, the
 * same as ours). Every other argument keeps the runtime's name.
 */
const ARGUMENT_NAMES: Readonly<
  Record<PluginFormat, Readonly<Record<string, Readonly<Record<string, string>>>>>
> = {
  amp: {},
  opencode: { [MODEL_API_TOOLS.readFile]: { path: 'filePath' } },
}

/** A tool's name as the plugin's source names it. */
export function pluginToolName(format: PluginFormat, tool: string): string {
  const names = TOOL_NAMES[format]
  return Object.hasOwn(names, tool) ? (names[tool] ?? tool) : tool
}

function renamed(
  input: Readonly<Record<string, unknown>>,
  names: Readonly<Record<string, string>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([name, value]) => [
      Object.hasOwn(names, name) ? (names[name] ?? name) : name,
      value,
    ]),
  )
}

function argumentNames(format: PluginFormat, tool: string): Readonly<Record<string, string>> {
  const tools = ARGUMENT_NAMES[format]
  return Object.hasOwn(tools, tool) ? (tools[tool] ?? {}) : {}
}

/** Our arguments as the plugin's source names them. */
export function pluginArguments(
  format: PluginFormat,
  tool: string,
  input: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return renamed(input, argumentNames(format, tool))
}

/** A plugin's arguments back under our names, for the same tool only. */
export function runtimeArguments(
  format: PluginFormat,
  tool: string,
  input: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const back = Object.fromEntries(
    Object.entries(argumentNames(format, tool)).map(([ours, theirs]) => [theirs, ours]),
  )
  return renamed(input, back)
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export type PluginRequest =
  | {
      readonly outcome: 'run'
      readonly call: Omit<PluginCall, 'pluginPath' | 'timeoutMs'>
      readonly route: PluginRoute
    }
  | { readonly outcome: 'refused'; readonly reason: string }

/** The Amp thread reference: its ids read `T-…` (A:1527). */
function ampThread(payload: Readonly<Record<string, unknown>>): { readonly id: string } {
  return { id: `T-${text(payload['session_id'])}` }
}

function toolFields(payload: Readonly<Record<string, unknown>>): {
  readonly tool: string
  readonly input: Readonly<Record<string, unknown>>
} {
  const input = payload['tool_input']
  return { tool: text(payload['tool_name']), input: isRecord(input) ? input : {} }
}

/** Amp's event payloads (A:1929-2135), from what the Muse payload carries. */
function ampPayload(
  sourceEvent: string,
  payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const thread = ampThread(payload)
  const turn = text(payload['turn_id'])
  const { tool, input } = toolFields(payload)
  switch (sourceEvent) {
    case 'tool.call': {
      return {
        toolUseID: text(payload['tool_use_id']),
        tool: pluginToolName('amp', tool),
        input: pluginArguments('amp', tool, input),
        thread,
      }
    }
    case 'tool.result': {
      // PostToolUse runs on success only, so the status is `done` (A:1995).
      return {
        toolUseID: text(payload['tool_use_id']),
        tool: pluginToolName('amp', tool),
        input: pluginArguments('amp', tool, input),
        status: 'done',
        output: text(payload['tool_response']),
        thread,
      }
    }
    case 'agent.start': {
      return { thread, message: text(payload['prompt']), id: turn }
    }
    case 'agent.end': {
      // The Stop payload carries the reply, not the prompt: `message` is
      // empty rather than guessed, and `messages` holds the reply as an
      // assistant message (A:1583-1590).
      const reply = text(payload['last_assistant_message'])
      return {
        thread,
        message: '',
        id: turn,
        status: 'done',
        messages:
          reply === ''
            ? []
            : [{ role: 'assistant', id: turn, content: [{ type: 'text', text: reply }] }],
      }
    }
    default: {
      return { thread }
    }
  }
}

/** OpenCode's Permission (OT:423-437) for a call that asks. */
function openCodePermission(
  payload: Readonly<Record<string, unknown>>,
  now: number,
): Readonly<Record<string, unknown>> {
  const { tool, input } = toolFields(payload)
  const name = pluginToolName('opencode', tool)
  return {
    id: text(payload['tool_use_id']),
    type: name,
    sessionID: text(payload['session_id']),
    messageID: text(payload['turn_id']),
    title: name,
    metadata: pluginArguments('opencode', tool, input),
    time: { created: now },
  }
}

/** A bus event's properties (OT:439-600), from what the Muse payload carries. */
function busProperties(
  type: string,
  payload: Readonly<Record<string, unknown>>,
  now: number,
): Readonly<Record<string, unknown>> {
  const sessionID = text(payload['session_id'])
  const { tool, input } = toolFields(payload)
  switch (type) {
    case 'session.created':
    case 'session.deleted': {
      // OT:562-588: the session's info; only its id is known here.
      return { info: { id: sessionID } }
    }
    case 'permission.asked': {
      return openCodePermission(payload, now)
    }
    case 'file.edited': {
      // OT:489-494.
      return { file: text(input['path']) }
    }
    case 'tool.execute.before':
    case 'tool.execute.after': {
      // The bus carries the typed hook's input (OI:266, OI:274).
      return {
        tool: pluginToolName('opencode', tool),
        sessionID,
        callID: text(payload['tool_use_id']),
      }
    }
    default: {
      // session.compacted (OT:482-487) and session.error (OT:591-596).
      return { sessionID }
    }
  }
}

/** OpenCode's hook inputs (OI:234-305), from what the Muse payload carries. */
function openCodePayload(
  route: PluginRoute,
  payload: Readonly<Record<string, unknown>>,
  now: number,
): Readonly<Record<string, unknown>> {
  if (route.busType !== undefined) {
    return {
      event: { type: route.busType, properties: busProperties(route.busType, payload, now) },
    }
  }
  const sessionID = text(payload['session_id'])
  const { tool, input } = toolFields(payload)
  switch (route.hook) {
    case 'tool.execute.before': {
      return {
        tool: pluginToolName('opencode', tool),
        sessionID,
        callID: text(payload['tool_use_id']),
        args: pluginArguments('opencode', tool, input),
      }
    }
    case 'tool.execute.after': {
      return {
        tool: pluginToolName('opencode', tool),
        sessionID,
        callID: text(payload['tool_use_id']),
        args: pluginArguments('opencode', tool, input),
        output: text(payload['tool_response']),
      }
    }
    case 'permission.ask': {
      return { permission: openCodePermission(payload, now) }
    }
    case 'chat.message': {
      const turn = text(payload['turn_id'])
      return {
        sessionID,
        message: { id: turn, sessionID, role: 'user' },
        parts: [
          { id: turn, sessionID, messageID: turn, type: 'text', text: text(payload['prompt']) },
        ],
      }
    }
    default: {
      return { sessionID }
    }
  }
}

/** One imported record's plugin call for this Muse event, or why it cannot run. */
export function pluginRequest(
  format: PluginFormat,
  sourceEvent: string,
  event: HookEvent,
  payload: Readonly<Record<string, unknown>>,
  now: number,
): PluginRequest {
  const route = pluginRoute(format, sourceEvent)
  if (route === undefined) {
    return { outcome: 'refused', reason: `${format}: ${sourceEvent} has no mapping here` }
  }
  if (route.event !== event) {
    return { outcome: 'refused', reason: `${format}: ${sourceEvent} does not fire on ${event}` }
  }
  return {
    outcome: 'run',
    route,
    call: {
      system: format,
      hook: route.hook,
      payload:
        format === 'amp' ? ampPayload(sourceEvent, payload) : openCodePayload(route, payload, now),
      failClosed: route.failClosed,
    },
  }
}

/** A replaced tool result as text: the output, else its JSON, else the error (A:2052-2070). */
function replacementText(value: string | Readonly<Record<string, unknown>>): string {
  if (typeof value === 'string') return value
  const output = value['output']
  if (typeof output === 'string') return output
  return output === undefined ? text(value['error']) : JSON.stringify(output)
}

/**
 * The plugin's answer by its source's rules, for the dispatcher: a narrowed
 * input under our argument names, for the same tool only; a replaced result
 * as text; Amp's `synthesize` (A:1974) as a refusal carrying its output,
 * since the tool must not run and a PreToolUse answer has no result of its
 * own here.
 */
export function pluginAnswer(
  format: PluginFormat,
  event: HookEvent,
  answer: HookAnswer,
  payload: Readonly<Record<string, unknown>>,
): HookAnswer {
  const { tool } = toolFields(payload)
  const { updatedInput, replacement, ...rest } = answer
  if (event === 'PreToolUse' && replacement !== undefined) {
    return { status: 'blocked', reason: replacementText(replacement.value) }
  }
  return {
    ...rest,
    ...(event === 'PreToolUse' &&
      updatedInput !== undefined && { updatedInput: runtimeArguments(format, tool, updatedInput) }),
    ...(event === 'PostToolUse' &&
      replacement !== undefined && {
        replacement: { target: 'toolResult', value: replacementText(replacement.value) },
      }),
  }
}
