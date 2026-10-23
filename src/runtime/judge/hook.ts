// M98 GH: G registers this surface; the existing ask runner owns source,
// model, run-cap, consent and durable admission. No backend starts here.
import { Readable } from 'node:stream'
import * as z from 'zod/mini'
import { HOOK_FORMAT_CONTRACTS, parseForeignResult } from '../../core/backends/modelapi/hookFormats'
import { pathValue, setPath } from '../../core/backends/modelapi/hookFormats/engine'
import { HOOK_EVENTS, parseHookAnswer } from '../../core/backends/modelapi/hooks'
import { parseExtensionHookAnswer } from '../../core/backends/modelapi/extensionHooks'
import { judgeOutcomeSchema, judgeRequestSchema, type JudgeQuestion } from '../../core/judge/schema'
import { redactSecrets } from '../../core/redact'
import {
  EXEC_EXIT,
  EXEC_FORCE_WRITE_MS,
  EXTENSION_HOOK_EVENTS,
  HOOK_FORMATS,
  HOOK_SYSTEM_MESSAGE_MAX_CHARS,
  JUDGE_ADVISORY_THRESHOLD,
  JUDGE_MAX_BODY_BYTES,
  UI_TEXT,
} from '../../shared/constants'
import type { FdWriter } from '../exec/fdWriter'
import { readPromptStdin } from '../exec/keyInput'
import type { JudgeCliOptions } from './args'
import type { runJudgeCommand, JudgeCliDeps, JudgeCliIo } from './commands'

const settingsSchema = z.strictObject({
  format: z.enum(['muse', 'claude', 'vscode', ...HOOK_FORMATS]),
  // Copilot's camelCase payload has no event name: G must obtain it explicitly.
  event: z.optional(z.string()),
})
export type JudgeHookCliSettings = z.infer<typeof settingsSchema>

/** P0/Z supply MODEL_TEXT and a localized UI_TEXT read at use time. */
export interface JudgeHookCliDeps extends JudgeCliDeps {
  /** Supplied by the parent judge factory; preserves its source and admission policy. */
  readonly runAsk: typeof runJudgeCommand
  readonly question: Extract<JudgeQuestion, { type: 'noul' }>
  readonly cautionText: () => string
}

// M91 captures and contract tables own the shape; unknown additions remain data.
const payloadSchema = z.looseObject({
  hook_event_name: z.optional(z.string()),
  agent_action_name: z.optional(z.string()),
  hookName: z.optional(z.string()),
  tool_name: z.optional(z.string().check(z.minLength(1))),
  toolName: z.optional(z.string().check(z.minLength(1))),
  tool_input: z.optional(z.union([z.string(), z.record(z.string(), z.unknown())])),
  toolArgs: z.optional(z.string()),
})
const nativeEventSchema = z.enum([...HOOK_EVENTS, ...EXTENSION_HOOK_EVENTS])
// Claude 2.1.288: captured/manifest.json, Windows C:\workspace, three turns.
// Its events and object tool inputs are independent of VS Code Local's table.
const claudeEventSchema = z.enum([
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
])
const toolFieldsSchema = z.strictObject({
  tool_name: z.string().check(z.minLength(1)),
  tool_input: z.record(z.string(), z.unknown()),
})
const toolArgumentsSchema = z.record(z.string(), z.unknown())

// Cursor requires a grant/veto for these rows and has no advisory neutral.
// The owner's decision excludes them from judge registration permanently.
const cursorBlockingEvents: ReadonlySet<string> = new Set([
  'preToolUse',
  'beforeShellExecution',
  'beforeMCPExecution',
  'beforeReadFile',
  'beforeSubmitPrompt',
])

/** Only the captured/native contract's available advisory rows may be registered. */
export function judgeHookEvents(format: JudgeHookCliSettings['format']): readonly string[] {
  if (format === 'muse') return [...HOOK_EVENTS, ...EXTENSION_HOOK_EVENTS]
  if (format === 'claude') return [...claudeEventSchema.options]
  const vendor = format === 'vscode' ? 'copilot' : format
  const contract = HOOK_FORMAT_CONTRACTS[vendor]
  const flavor = format === 'vscode' ? 'vscode' : contract.defaultFlavor
  return contract.rows
    .filter(
      (row) =>
        (row.flavor ?? contract.defaultFlavor) === flavor &&
        !(format === 'cursor' && cursorBlockingEvents.has(row.vendor)),
    )
    .map((row) => row.vendor)
}

/** Preflight a caution through M91's existing schema/parser, never a new wire. */
function prepareOutput(
  settings: JudgeHookCliSettings,
  payload: z.infer<typeof payloadSchema>,
  text: string,
): { caution?: string; neutral: string } | undefined {
  const format = settings.format
  let eventField = 'hook_event_name'
  if (format === 'windsurf') eventField = 'agent_action_name'
  else if (format === 'cline') eventField = 'hookName'
  const supplied = pathValue(payload, eventField)
  if (
    supplied !== undefined &&
    settings.event !== undefined &&
    (format === 'muse' || format === 'claude') &&
    supplied !== settings.event
  )
    throw new Error(UI_TEXT.execRequestShape)
  const event = supplied ?? settings.event
  if (typeof event !== 'string') throw new TypeError(UI_TEXT.execRequestShape)
  if (format === 'muse' || format === 'claude') {
    const name =
      format === 'claude' ? claudeEventSchema.parse(event) : nativeEventSchema.parse(event)
    if (['PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure'].includes(name))
      toolFieldsSchema.parse({ tool_name: payload.tool_name, tool_input: payload.tool_input })
    // raw-claude.md SessionEnd: JSON output is discarded, including systemMessage.
    // Recognized capture, but no advisory delivery: do not initialize a source.
    if (format === 'claude' && name === 'SessionEnd') return { neutral: '' }
    const output = JSON.stringify({
      systemMessage: text,
      ...(name === 'PreToolUse' && {
        hookSpecificOutput: {
          hookEventName: name,
          permissionDecision: 'ask',
          permissionDecisionReason: text,
        },
      }),
    })
    const museEvent = HOOK_EVENTS.find((candidate) => candidate === name)
    const extensionEvent = EXTENSION_HOOK_EVENTS.find((candidate) => candidate === name)
    let isAccepted = false
    if (museEvent !== undefined)
      isAccepted = parseHookAnswer(museEvent, 0, output, '').status === 'completed'
    else if (extensionEvent !== undefined)
      isAccepted = parseExtensionHookAnswer(extensionEvent, 0, output, '').status === 'completed'
    return { ...(isAccepted && { caution: output }), neutral: '' }
  }
  const vendor = format === 'vscode' ? 'copilot' : format
  const contract = HOOK_FORMAT_CONTRACTS[vendor]
  const flavor = format === 'vscode' ? 'vscode' : contract.defaultFlavor
  const row = contract.rows.find(
    (candidate) =>
      (candidate.flavor ?? contract.defaultFlavor) === flavor &&
      (candidate.vendor === event || candidate.aliases?.includes(event) === true),
  )
  if (row === undefined) throw new Error(UI_TEXT.execRequestShape)
  if (
    settings.event !== undefined &&
    settings.event !== row.vendor &&
    row.aliases?.includes(settings.event) !== true
  )
    throw new Error(UI_TEXT.execRequestShape)
  // Validate the known tool slice strictly; preserve unknown envelope additions
  // as state. Cursor MCP/Copilot camelCase intentionally carry JSON strings.
  if (row.fields.some((field) => field.to === 'tool_input' && field.transform !== 'json'))
    toolFieldsSchema.parse({ tool_name: payload.tool_name, tool_input: payload.tool_input })
  for (const field of row.fields) {
    const value = pathValue(payload, field.to)
    if (
      (value === undefined && field.required === true) ||
      (value !== undefined && field.schema !== undefined && !field.schema.safeParse(value).success)
    )
      throw new Error(UI_TEXT.execRequestShape)
    if (
      typeof value !== 'string' &&
      value !== undefined &&
      ['text', 'toolName', 'json'].includes(field.transform ?? '')
    )
      throw new Error(UI_TEXT.execRequestShape)
    if (typeof value !== 'string' || field.transform !== 'json') continue
    const decoded: unknown = JSON.parse(value)
    if (field.to === 'tool_input' || field.to === 'toolArgs') toolArgumentsSchema.parse(decoded)
  }
  if (format === 'cursor' && !judgeHookEvents(format).includes(row.vendor)) return undefined
  const result = row.result
  // Cursor permission rows reject absent output. An empty object is neutral
  // only where its own schema accepts it. Rows requiring a decision remain
  // unavailable before inference, never filled with ALLOW.
  const neutral = format === 'cursor' ? '{}' : ''
  if (
    parseForeignResult(vendor, row.muse, 0, neutral, '', {
      sourceEvent: row.vendor,
      flavor,
      failClosed: true,
    }).status !== 'completed'
  )
    return undefined
  const output: Record<string, unknown> = {}
  for (const rule of result.rules) {
    if (rule.kind === 'ask') {
      for (const [key, value] of Object.entries(rule.match)) setPath(output, key, value)
    } else if (rule.kind === 'message' || rule.kind === 'context') {
      setPath(output, rule.field, text)
    } else if (format === 'cline' && rule.kind === 'custom' && rule.name === 'cappedContext') {
      // Cline's existing custom rule, docs/cline-hooks-901d1b5c97.md:253–267.
      output['contextModification'] = text
    }
  }
  const serialized = result.stdout === 'text' ? text : JSON.stringify(output)
  const answer = parseForeignResult(vendor, row.muse, 0, serialized, '', {
    sourceEvent: row.vendor,
    flavor,
  })
  return answer.status === 'completed' &&
    (answer.permissionDecision === 'ask' ||
      answer.context !== undefined ||
      answer.systemMessage !== undefined)
    ? { caution: serialized, neutral }
    : { neutral }
}

/**
Safe/absent verdicts use each supported host's preflighted neutral response,
never ALLOW. Hook abstention exits 0; the borrowed ask surface retains exit 4.
Cursor rows without advisory abstention stay unavailable before inference
(docs/certification/m98p2-gh.md), rather than blocking a safe judge result.
*/
export async function runJudgeHookCommand(
  options: JudgeCliOptions,
  rawSettings: JudgeHookCliSettings,
  io: JudgeCliIo,
  deps: JudgeHookCliDeps,
  parentSignal?: AbortSignal,
): Promise<number> {
  const deadline = AbortSignal.timeout(options.timeoutMs)
  const signal = parentSignal === undefined ? deadline : AbortSignal.any([parentSignal, deadline])
  let code: number
  let neutral: string | undefined
  const outcomeState = { hasCaution: false }
  try {
    const settings = settingsSchema.parse(rawSettings)
    neutral = settings.format === 'cursor' ? undefined : ''
    if (io.stdout.isClosed || io.stderr.isClosed)
      return neutral === undefined ? EXEC_EXIT.failed : EXEC_EXIT.ok
    const raw: unknown = JSON.parse(await readPromptStdin(io.stdin, JUDGE_MAX_BODY_BYTES, signal))
    const payload = payloadSchema.parse(raw)
    const text = deps.cautionText()
    if (text.trim() === '' || text.length > HOOK_SYSTEM_MESSAGE_MAX_CHARS)
      throw new Error(UI_TEXT.execRequestShape)
    const output = prepareOutput(settings, payload, text)
    if (output === undefined) return neutral === undefined ? EXEC_EXIT.failed : EXEC_EXIT.ok
    neutral = output.neutral
    const caution = output.caution
    if (caution === undefined) {
      code = EXEC_EXIT.ok
    } else {
      // Complete, redacted state; no transcript/file reads or implicit model choice.
      const request = judgeRequestSchema.parse({
        state: redactSecrets(JSON.stringify(payload)),
        questions: { risk: deps.question },
      })
      if (request.questions['risk']?.type !== 'noul') throw new Error(UI_TEXT.execRequestShape)
      const stdout: FdWriter = {
        get isClosed() {
          return io.stdout.isClosed
        },
        get queuedBytes() {
          return io.stdout.queuedBytes
        },
        flush: (withinMs) => io.stdout.flush(withinMs),
        write(chunk) {
          let rawOutcome: unknown
          try {
            rawOutcome = JSON.parse(chunk)
          } catch {
            return
          }
          const outcome = judgeOutcomeSchema.safeParse(rawOutcome)
          if (!outcome.success || outcome.data.outcome === 'no-answer') return
          const answer = outcome.data.result.answers['risk']
          const meta = outcome.data.result.muse['risk']
          if (
            meta === undefined ||
            answer?.type !== 'noul' ||
            meta.partial ||
            signal.aborted ||
            io.stdout.isClosed ||
            answer.noul < JUDGE_ADVISORY_THRESHOLD
          )
            return
          outcomeState.hasCaution = true
          io.stdout.write(`${caution}\n`)
        },
      }
      code = await deps.runAsk(
        { command: 'judge', action: 'ask', options, surfaceArgs: [] },
        { ...io, stdin: Readable.from([JSON.stringify(request)]), stdout },
        deps,
        signal,
      )
    }
  } catch {
    // Fixed words only: never private stdin, question, provider error or argv.
    code = signal.aborted ? EXEC_EXIT.failed : EXEC_EXIT.usage
    io.stderr.write(`${signal.aborted ? UI_TEXT.execTimedOut : UI_TEXT.execRequestShape}\n`)
  } finally {
    io.stdin.destroy()
  }
  // A source refusal/failure is no opinion to the hook consumer, not the
  // generic CLI's exit-4 outcome (Gemini/Copilot/worktree would veto on it).
  if (neutral !== undefined && code !== EXEC_EXIT.usage) {
    if (neutral !== '' && !outcomeState.hasCaution && !io.stdout.isClosed)
      io.stdout.write(`${neutral}\n`)
    if (code === EXEC_EXIT.failed) code = EXEC_EXIT.ok
  }
  const flushed = await Promise.all(
    [io.stdout, io.stderr].map((stream) => stream.flush(EXEC_FORCE_WRITE_MS)),
  )
  const noAnswerExit = neutral === undefined ? EXEC_EXIT.failed : EXEC_EXIT.ok
  return !signal.aborted && flushed.every(Boolean) && !io.stdout.isClosed && !io.stderr.isClosed
    ? code
    : noAnswerExit
}
