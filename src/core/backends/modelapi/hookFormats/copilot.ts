// CLI: hooks-parity/gh/copilot_reference_hooks-configuration.md:293-839.
// Local harness: hooks-parity/vsc/hooks-reference.md:66-434. Separate contracts.
import path from 'node:path'
import * as z from 'zod/mini'
import { type HookAnswer } from '../hooks'
import {
  type AdapterEvent,
  type ForeignStdinResult,
  blockReason,
  cleanReason,
  copyFields,
  failed,
  isRecord,
  isShellTool,
  jsonOutput,
  recordField,
  resultPreview,
  run,
  textField,
} from './core'
const CLI_EVENTS: Readonly<Partial<Record<AdapterEvent, string>>> = {
  SessionStart: 'sessionStart',
  SessionEnd: 'sessionEnd',
  UserPromptSubmit: 'userPromptSubmitted',
  PreToolUse: 'preToolUse',
  PermissionRequest: 'permissionRequest',
  PostToolUse: 'postToolUse',
  PostToolUseFailure: 'postToolUseFailure',
  PreCompact: 'preCompact',
  Stop: 'agentStop',
  StopFailure: 'errorOccurred',
  SubagentStart: 'subagentStart',
  SubagentStop: 'subagentStop',
  Notification: 'notification',
}
const LOCAL_EVENTS = new Set<AdapterEvent>([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PreCompact',
  'SubagentStart',
  'SubagentStop',
  'Stop',
])
export interface CopilotAdapterOptions {
  readonly flavor?: 'copilot' | 'vscode' | undefined
  /** CLI PascalCase imports retain CLI output rules with snake_case inputs. */
  readonly sourceEvent?: string | undefined
  readonly workspaceRoot?: string | undefined
  readonly platform?: NodeJS.Platform | undefined
}
function isValidEvent(event: AdapterEvent, options: CopilotAdapterOptions | undefined): boolean {
  if (options?.flavor === 'vscode')
    return (
      LOCAL_EVENTS.has(event) &&
      (options.sourceEvent === undefined || options.sourceEvent === event)
    )
  const alias = event === 'StopFailure' ? 'ErrorOccurred' : event
  return (
    CLI_EVENTS[event] !== undefined &&
    (options?.sourceEvent === undefined ||
      options.sourceEvent === CLI_EVENTS[event] ||
      options.sourceEvent === alias)
  )
}
function confinedCwd(
  cwd: string,
  workspaceRoot: string | undefined,
  platform: NodeJS.Platform,
): string | undefined {
  const pick = platform === 'win32' ? path.win32 : path.posix
  if (platform === 'win32' && (/^[a-z]:($|[^\\/])/i.test(cwd) || /^[\\/]{2}/.test(cwd)))
    return undefined
  if (workspaceRoot === undefined) {
    if (pick.isAbsolute(cwd)) return undefined
    const normalized = pick.normalize(cwd)
    return normalized === '..' || normalized.startsWith(`..${pick.sep}`) ? undefined : normalized
  }
  if (!pick.isAbsolute(workspaceRoot)) return undefined
  // resolve removes trailing separators, preserving filesystem roots; win32
  // relative compares drives/segments without case sensitivity. This lexical
  // check is NOT physical containment: lane W must realpath-confine links and
  // junctions before using a hook's cwd to spawn its process.
  const root = pick.resolve(workspaceRoot)
  const absolute = pick.resolve(root, cwd)
  const relative = pick.relative(root, absolute)
  if (relative === '..' || pick.isAbsolute(relative) || relative.startsWith(`..${pick.sep}`))
    return undefined
  return relative === '' ? '.' : relative
}
function claudeToolName(tool: string): string {
  if (isShellTool(tool)) return 'Bash'
  if (tool === 'read_file') return 'Read'
  if (tool === 'write_file') return 'Write'
  return tool === 'edit_file' ? 'Edit' : tool
}
function copyMapped(
  target: Record<string, unknown>,
  payload: Readonly<Record<string, unknown>>,
  mappings: Readonly<Record<string, string>>,
): void {
  for (const [from, to] of Object.entries(mappings))
    if (payload[from] !== undefined) target[to] = payload[from]
}
export function buildCopilotStdin(
  event: AdapterEvent,
  payload: Readonly<Record<string, unknown>>,
  options?: CopilotAdapterOptions,
): ForeignStdinResult {
  if (!isValidEvent(event, options))
    return { outcome: 'refused', reason: `copilot: ${event} has no event in this flavor` }
  if (payload['env'] !== undefined || payload['environment'] !== undefined)
    return { outcome: 'refused', reason: 'copilot: env is refused' }
  const isLocal = options?.flavor === 'vscode'
  const isSnake =
    isLocal || options?.sourceEvent === event || options?.sourceEvent === 'ErrorOccurred'
  const stdin: Record<string, unknown> = {}
  if (isSnake) {
    stdin['hook_event_name'] = event === 'StopFailure' ? 'ErrorOccurred' : event
    copyFields(stdin, payload, ['session_id', 'transcript_path', 'timestamp'])
  } else
    copyMapped(stdin, payload, {
      session_id: 'sessionId',
      transcript_path: 'transcriptPath',
      timestamp: 'timestamp',
    })
  const cwd = textField(payload, 'cwd')
  if (cwd !== undefined) {
    const relative = confinedCwd(cwd, options?.workspaceRoot, options?.platform ?? process.platform)
    if (relative === undefined)
      return { outcome: 'refused', reason: 'copilot: cwd is not workspace-confined' }
    stdin['cwd'] = relative
  }
  // Dispatcher supplies timestamp; adapters never invent one.
  const stamp = payload['timestamp']
  if (stamp !== undefined) {
    const epoch = typeof stamp === 'string' ? Date.parse(stamp) : stamp
    if (typeof epoch !== 'number' || !Number.isFinite(epoch))
      return { outcome: 'refused', reason: 'copilot: invalid timestamp' }
    const date = new Date(epoch)
    if (!Number.isFinite(date.getTime()))
      return { outcome: 'refused', reason: 'copilot: invalid timestamp' }
    stdin['timestamp'] = isSnake ? date.toISOString() : epoch
  }
  switch (event) {
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure':
    case 'PermissionRequest': {
      const tool = textField(payload, 'tool_name')
      const input = recordField(payload, 'tool_input')
      if (tool === undefined || input === undefined)
        return { outcome: 'refused', reason: 'copilot: tool event needs a name and input' }
      stdin[isSnake ? 'tool_name' : 'toolName'] = isSnake && !isLocal ? claudeToolName(tool) : tool
      const inputKey = event === 'PermissionRequest' ? 'toolInput' : 'toolArgs'
      stdin[isSnake ? 'tool_input' : inputKey] = input
      if (isLocal) copyFields(stdin, payload, ['tool_use_id'])
      if (event === 'PostToolUse') {
        const response = resultPreview(payload)
        if (response === undefined)
          return { outcome: 'refused', reason: 'copilot: post-tool needs a string result preview' }
        if (isLocal) stdin['tool_response'] = response
        else if (isSnake)
          stdin['tool_result'] = { result_type: 'success', text_result_for_llm: response }
        else stdin['toolResult'] = { resultType: 'success', textResultForLlm: response }
      } else if (event === 'PostToolUseFailure') copyFields(stdin, payload, ['error'])

      break
    }
    case 'UserPromptSubmit': {
      copyFields(stdin, payload, ['prompt'])
      break
    }
    case 'SessionStart': {
      copyFields(stdin, payload, ['source'])
      copyMapped(stdin, payload, { initial_prompt: isSnake ? 'initial_prompt' : 'initialPrompt' })

      break
    }
    case 'SessionEnd': {
      copyFields(stdin, payload, ['reason'])
      break
    }
    case 'PreCompact': {
      copyFields(stdin, payload, ['trigger'])
      copyMapped(stdin, payload, {
        custom_instructions: isSnake ? 'custom_instructions' : 'customInstructions',
      })

      break
    }
    case 'Stop':
    case 'SubagentStart':
    case 'SubagentStop': {
      if (isSnake)
        copyFields(stdin, payload, [
          'stop_hook_active',
          'stop_reason',
          'agent_id',
          'agent_type',
          'agent_name',
          'agent_display_name',
          'last_assistant_message',
        ])
      else {
        copyFields(stdin, payload, ['stop_hook_active'])
        copyMapped(stdin, payload, {
          stop_reason: 'stopReason',
          agent_id: 'agentId',
          agent_type: 'agentType',
          agent_name: 'agentName',
          agent_display_name: 'agentDisplayName',
          agent_description: 'agentDescription',
          last_assistant_message: 'response',
        })
      }

      break
    }
    case 'Notification': {
      stdin['hook_event_name'] = 'Notification'
      copyFields(stdin, payload, ['message', 'title', 'notification_type'])
      break
    }
    case 'StopFailure': {
      copyFields(stdin, payload, ['error', 'recoverable'])
      copyMapped(stdin, payload, { error_context: isSnake ? 'error_context' : 'errorContext' })

      break
    }
    // No default
  }
  return run(stdin)
}
const cliToolShape = z.strictObject({
  permissionDecision: z.optional(z.enum(['allow', 'deny', 'ask'])),
  permissionDecisionReason: z.optional(z.string()),
  modifiedArgs: z.optional(z.record(z.string(), z.unknown())),
})
const cliPermissionShape = z.strictObject({
  behavior: z.optional(z.enum(['allow', 'deny'])),
  message: z.optional(z.string()),
  interrupt: z.optional(z.boolean()),
})
const stopShape = z.strictObject({
  decision: z.optional(z.enum(['block', 'allow'])),
  reason: z.optional(z.string()),
})
const contextShape = z.strictObject({ additionalContext: z.optional(z.string()) })
const localSpecific = z.strictObject({
  hookEventName: z.string(),
  permissionDecision: z.optional(z.enum(['allow', 'deny', 'ask'])),
  permissionDecisionReason: z.optional(z.string()),
  updatedInput: z.optional(z.record(z.string(), z.unknown())),
  additionalContext: z.optional(z.string()),
  decision: z.optional(z.literal('block')),
  reason: z.optional(z.string()),
})
const localShape = z.strictObject({
  continue: z.optional(z.boolean()),
  stopReason: z.optional(z.string()),
  systemMessage: z.optional(z.string()),
  decision: z.optional(z.literal('block')),
  reason: z.optional(z.string()),
  hookSpecificOutput: z.optional(localSpecific),
})
const cliControl = z.object({
  behavior: z.optional(z.string()),
  permissionDecision: z.optional(z.string()),
  decision: z.optional(z.string()),
})
const localControl = z.object({
  continue: z.optional(z.boolean()),
  stopReason: z.optional(z.string()),
  decision: z.optional(z.string()),
  reason: z.optional(z.string()),
  hookSpecificOutput: z.optional(
    z.object({
      hookEventName: z.string(),
      permissionDecision: z.optional(z.string()),
      permissionDecisionReason: z.optional(z.string()),
      decision: z.optional(z.string()),
      reason: z.optional(z.string()),
    }),
  ),
})
function parseLocal(event: AdapterEvent, value: unknown): HookAnswer {
  const veto = localControl.safeParse(value)
  if (veto.success) {
    const output = veto.data
    if (output.continue === false) {
      const reason = cleanReason(output.stopReason, 'vscode hook stopped the agent')
      return { status: 'blocked', reason, stopReason: reason }
    }
    const specific = output.hookSpecificOutput
    if (specific?.hookEventName === event) {
      if (event === 'PreToolUse' && specific.permissionDecision === 'deny') {
        return {
          status: 'blocked',
          reason: cleanReason(specific.permissionDecisionReason, 'vscode hook denied the call'),
        }
      }
      if (
        ['Stop', 'SubagentStop', 'PostToolUse'].includes(event) &&
        specific.decision === 'block'
      ) {
        return {
          status: 'blocked',
          reason: cleanReason(specific.reason, 'vscode hook blocked the operation'),
        }
      }
    }
    if (['SubagentStop', 'PostToolUse'].includes(event) && output.decision === 'block') {
      return {
        status: 'blocked',
        reason: cleanReason(output.reason, 'vscode hook blocked the operation'),
      }
    }
  }

  const parsed = localShape.safeParse(value)
  if (!parsed.success) return failed('vscode: invalid Local hook output')
  const output = parsed.data
  const specific = output.hookSpecificOutput
  if (specific !== undefined && specific.hookEventName !== event)
    return failed('vscode: output event does not match input')
  if (
    event !== 'PreToolUse' &&
    (specific?.permissionDecision !== undefined || specific?.updatedInput !== undefined)
  )
    return failed('vscode: tool decisions are only valid on PreToolUse')
  if (
    event !== 'Stop' &&
    event !== 'SubagentStop' &&
    event !== 'PostToolUse' &&
    (output.decision !== undefined || specific?.decision !== undefined)
  )
    return failed('vscode: block decision is not valid on this event')
  return {
    status: 'completed',
    context: specific?.additionalContext,
    systemMessage: output.systemMessage,
    ...(specific?.permissionDecision === 'ask' && { permissionDecision: 'ask' }),
    ...(specific?.updatedInput !== undefined && { updatedInput: specific.updatedInput }),
  }
}
export function parseCopilotResult(
  event: AdapterEvent,
  exitCode: number | null,
  stdout: string,
  stderr: string,
  options?: CopilotAdapterOptions,
): HookAnswer {
  if (!isValidEvent(event, options)) return failed('copilot: unsupported event/flavor')
  const isLocal = options?.flavor === 'vscode'
  if (!isLocal && event === 'PermissionRequest' && exitCode === 2) {
    // CLI explicitly ignores stderr here and merges a deny into stdout.
    const output = cliPermissionShape.safeParse(jsonOutput(stdout))
    const reason = cleanReason(
      output.success ? output.data.message : undefined,
      'copilot hook denied the call',
    )
    return {
      status: 'blocked',
      reason,
      approvalDecision: 'deny',
      ...(output.success && output.data.interrupt === true && { stopReason: reason }),
    }
  }
  const isGuard = event === 'PreToolUse' || event === 'PermissionRequest'
  if (exitCode !== 0) {
    if (isLocal)
      return exitCode === 2
        ? {
            status: 'blocked',
            reason: blockReason(stderr, '', 'vscode hook blocked the operation'),
          }
        : failed(stderr.trim() || `vscode: hook exited ${String(exitCode)}`)
    if (isGuard)
      return {
        status: 'blocked',
        reason: blockReason(stderr, '', 'copilot hook denied the call'),
        ...(event === 'PermissionRequest' && { approvalDecision: 'deny' }),
      }
    return failed(stderr.trim() || `copilot: hook exited ${String(exitCode)}`)
  }
  if (stdout.trim() === '') return { status: 'completed' }
  const value = jsonOutput(stdout)
  if (isLocal) return parseLocal(event, value)
  const control = cliControl.safeParse(value)
  if (control.success && isRecord(value)) {
    if (event === 'PermissionRequest' && control.data.behavior === 'deny') {
      const reason = cleanReason(textField(value, 'message'), 'copilot hook denied the call')
      return {
        status: 'blocked',
        reason,
        approvalDecision: 'deny',
        ...(value['interrupt'] === true && { stopReason: reason }),
      }
    }
    if (event === 'PreToolUse' && control.data.permissionDecision === 'deny')
      return {
        status: 'blocked',
        reason: cleanReason(
          textField(value, 'permissionDecisionReason'),
          'copilot hook denied the call',
        ),
      }
    if ((event === 'Stop' || event === 'SubagentStop') && control.data.decision === 'block')
      return {
        status: 'blocked',
        reason: cleanReason(textField(value, 'reason'), 'copilot hook requested continuation'),
      }
  }
  if (event === 'PermissionRequest') {
    const parsed = cliPermissionShape.safeParse(value)
    return parsed.success
      ? { status: 'completed' }
      : {
          status: 'blocked',
          reason: 'copilot: invalid permission response',
          approvalDecision: 'deny',
        }
  }
  if (event === 'PreToolUse') {
    const parsed = cliToolShape.safeParse(value)
    if (!parsed.success)
      return { status: 'blocked', reason: 'copilot: invalid tool permission response' }
    return {
      status: 'completed',
      ...(parsed.data.permissionDecision === 'ask' && { permissionDecision: 'ask' }),
      ...(parsed.data.modifiedArgs !== undefined && { updatedInput: parsed.data.modifiedArgs }),
    }
  }
  if (event === 'Stop' || event === 'SubagentStop')
    return stopShape.safeParse(value).success
      ? { status: 'completed' }
      : failed('copilot: unsupported stop output')
  const parsed = contextShape.safeParse(value)
  return parsed.success
    ? { status: 'completed', context: parsed.data.additionalContext }
    : failed('copilot: unsupported event output')
}
