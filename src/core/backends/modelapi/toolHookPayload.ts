// Tool hooks run user-configured processes. Pass bounded previews of tool
// traffic; the real tool call and Model API replay keep their original bytes.

import {
  HOOK_TOOL_ENTRIES_MAX,
  HOOK_TOOL_INPUT_PREVIEW_CHARS,
  HOOK_TOOL_NESTING_MAX,
  HOOK_TOOL_OUTPUT_PREVIEW_CHARS,
  HOOK_TOOL_VALUE_PREVIEW_CHARS,
} from '../../../shared/constants'

const SECRET_FIELD = /(?:auth|bearer|password|passwd|secret|token|credential|api[_-]?key)/i
const MEDIA_FIELD = /(?:^data$|base64|image|audio|blob|binary)/i
const DATA_URL = /data:[^\s"'<>]*/gi
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/-]+/gi
const REDACTED = '[redacted]'
const MEDIA_OMITTED = '[media omitted]'
const TRUNCATED = '[truncated]'

/** Drop inline media and bearer values before any hook-facing preview clips text. */
export function redactHookText(value: string): string {
  return value.replaceAll(DATA_URL, '[media omitted]').replaceAll(BEARER_VALUE, '[redacted]')
}

function takeText(value: string, budget: { left: number }, max: number): string {
  const safe = redactHookText(value)
  const length = Math.max(0, Math.min(max, budget.left))
  const taken = safe.slice(0, length)
  budget.left -= taken.length
  return taken.length < safe.length ? `${taken}${TRUNCATED}` : taken
}

function previewValue(value: unknown, budget: { left: number }, depth: number): unknown {
  if (budget.left <= 0 || depth >= HOOK_TOOL_NESTING_MAX) {
    return TRUNCATED
  }
  if (typeof value === 'string') {
    return takeText(value, budget, HOOK_TOOL_VALUE_PREVIEW_CHARS)
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, HOOK_TOOL_ENTRIES_MAX)
      .map((entry: unknown) => previewValue(entry, budget, depth + 1))
  }
  return typeof value === 'object' && value !== null
    ? previewObject(value, budget, depth + 1)
    : value
}

function previewObject(
  value: object,
  budget: { left: number },
  depth: number,
): Readonly<Record<string, unknown>> {
  const entries: [string, unknown][] = []
  for (const [name, item] of Object.entries(value).slice(0, HOOK_TOOL_ENTRIES_MAX)) {
    if (budget.left <= 0) {
      break
    }
    const key = takeText(name, budget, HOOK_TOOL_VALUE_PREVIEW_CHARS)
    let preview: unknown
    if (SECRET_FIELD.test(name)) {
      preview = REDACTED
    } else if (MEDIA_FIELD.test(name)) {
      preview = MEDIA_OMITTED
    } else {
      preview = previewValue(item, budget, depth)
    }
    entries.push([key, preview])
  }
  return Object.fromEntries(entries)
}

/** Hook-visible argument summary. Never use it to execute the tool. */
export function toolHookInput(
  args: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return previewObject(args, { left: HOOK_TOOL_INPUT_PREVIEW_CHARS }, 0)
}

/** Hook-visible result summary. Model replay still receives full MCP parts. */
export function toolHookOutput(value: string): string {
  return takeText(value, { left: HOOK_TOOL_OUTPUT_PREVIEW_CHARS }, HOOK_TOOL_OUTPUT_PREVIEW_CHARS)
}

/**
 * An extension hook's view of free text (a task subject, a thought, a display
 * message, an expansion): media and credentials scrubbed, then clipped with
 * `[truncated]`. The runtime keeps the original; the hook never sees it whole.
 */
export function boundedHookText(value: string, maxChars: number): string {
  const safe = redactHookText(value)
  return safe.length <= maxChars ? safe : `${safe.slice(0, maxChars)}${TRUNCATED}`
}
