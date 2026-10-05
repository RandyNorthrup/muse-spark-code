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
import { runJudgeCommand, type JudgeCliDeps, type JudgeCliIo } from './commands'

const settingsSchema = z.strictObject({
  format: z.enum(['muse', 'claude', 'vscode', ...HOOK_FORMATS]),
  // Copilot's camelCase payload has no event name: G must obtain it explicitly.
  event: z.optional(z.string()),
})
export type JudgeHookCliSettings = z.infer<typeof settingsSchema>

/** P0/Z supply MODEL_TEXT and a localized UI_TEXT read at use time. */
export interface JudgeHookCliDeps extends JudgeCliDeps {
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

/** Preflight a caution through M91's existing schema/parser, never a new wire. */
function prepareOutput(
  settings: JudgeHookCliSettings,
  payload: z.infer<typeof payloadSchema>,
  text: string,
): string | undefined {
  const format = settings.format
  let eventField = 'hook_event_name'
  if (format === 'windsurf') eventField = 'agent_action_name'
  else if (format === 'cline') eventField = 'hookName'
  const supplied = pathValue(payload, eventField)
  if (
    format === 'muse' &&
    supplied !== undefined &&
    settings.event !== undefined &&
    supplied !== settings.event
  )
    throw new Error(UI_TEXT.execRequestShape)
  const event = supplied ?? settings.event
  if (typeof event !== 'string') throw new Error(UI_TEXT.execRequestShape)
  if (format === 'muse') {
    const name = nativeEventSchema.parse(event)
    if (
      ['PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure'].includes(name) &&
      (payload.tool_name === undefined || typeof payload.tool_input !== 'object')
    )
      throw new Error(UI_TEXT.execRequestShape)
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
    return isAccepted ? output : undefined
  }
  const vendor = format === 'claude' || format === 'vscode' ? 'copilot' : format
  const contract = HOOK_FORMAT_CONTRACTS[vendor]
  const flavor = format === 'claude' || format === 'vscode' ? 'vscode' : contract.defaultFlavor
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
    if (typeof value === 'string' && field.transform === 'json') JSON.parse(value)
  }
  const result = row.result
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
    ? serialized
    : undefined
}

/**
 * Answered safe/unsure verdicts emit nothing, never ALLOW. Refusals retain CLI
 * exit 4 under the CLI contract; native delivery limits are recorded in
 * docs/certification/m98-gh.md.
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
  try {
    if (io.stdout.isClosed || io.stderr.isClosed) return EXEC_EXIT.failed
    const settings = settingsSchema.parse(rawSettings)
    const raw: unknown = JSON.parse(await readPromptStdin(io.stdin, JUDGE_MAX_BODY_BYTES, signal))
    const payload = payloadSchema.parse(raw)
    const text = deps.cautionText()
    if (text.trim() === '' || text.length > HOOK_SYSTEM_MESSAGE_MAX_CHARS)
      throw new Error(UI_TEXT.execRequestShape)
    const output = prepareOutput(settings, payload, text)
    if (output === undefined) return EXEC_EXIT.failed
    // Complete, redacted state; no transcript/file reads or implicit model choice.
    const request = judgeRequestSchema.parse({
      state: redactSecrets(JSON.stringify(payload)),
      questions: { risk: deps.question },
    })
    if (request.questions['risk']?.type !== 'noul') throw new Error(UI_TEXT.execRequestShape)
    const outcomeState = { isValid: false }
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
        if (meta === undefined || answer?.type !== 'noul' || meta.partial) return
        outcomeState.isValid = true
        if (!signal.aborted && !io.stdout.isClosed && answer.noul >= JUDGE_ADVISORY_THRESHOLD)
          io.stdout.write(`${output}\n`)
      },
    }
    code = await runJudgeCommand(
      { command: 'judge', action: 'ask', options, surfaceArgs: [] },
      { ...io, stdin: Readable.from([JSON.stringify(request)]), stdout },
      deps,
      signal,
    )
    if (code === EXEC_EXIT.ok && !outcomeState.isValid) code = EXEC_EXIT.failed
  } catch {
    // Fixed words only: never private stdin, question, provider error or argv.
    code = signal.aborted ? EXEC_EXIT.failed : EXEC_EXIT.usage
    io.stderr.write(`${signal.aborted ? UI_TEXT.execTimedOut : UI_TEXT.execRequestShape}\n`)
  } finally {
    io.stdin.destroy()
  }
  const flushed = await Promise.all(
    [io.stdout, io.stderr].map((stream) => stream.flush(EXEC_FORCE_WRITE_MS)),
  )
  return !signal.aborted && flushed.every(Boolean) && !io.stdout.isClosed && !io.stderr.isClosed
    ? code
    : EXEC_EXIT.failed
}
