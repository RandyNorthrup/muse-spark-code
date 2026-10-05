import { type EXTENSION_HOOK_EVENTS } from '../../../../shared/constants'
import { type HookAnswer, type HookEvent } from '../hooks'

/** The events an adapter accepts: Muse Code's plus the extension-only ones. */
export type AdapterEvent = HookEvent | (typeof EXTENSION_HOOK_EVENTS)[number]

/** What building a foreign stdin decided: run it, skip it, or refuse it. */
export type ForeignStdinResult =
  | { readonly outcome: 'run'; readonly stdin: string }
  /** The hook does not run, and that is not a failure (Kiro's path filter). */
  | { readonly outcome: 'skip'; readonly reason: string }
  /**
   * The event + payload cannot be translated faithfully. The caller records
   * a hook failure; it never runs the command with a guessed shape.
   */
  | { readonly outcome: 'refused'; readonly reason: string }

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function hasExtraFields(value: unknown, allowed: ReadonlySet<string>): boolean {
  return isRecord(value) && Object.keys(value).some((key) => !allowed.has(key))
}

export function textField(
  payload: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

export function recordField(
  payload: Readonly<Record<string, unknown>>,
  key: string,
): Record<string, unknown> | undefined {
  const value = payload[key]
  return isRecord(value) ? value : undefined
}

/** Copy our payload's text field into the foreign stdin when it is present. */
export function copyText(
  stdin: Record<string, unknown>,
  payload: Readonly<Record<string, unknown>>,
  key: string,
): void {
  const value = payload[key]
  if (typeof value === 'string' && value !== '') {
    stdin[key] = value
  }
}

export function toolNameOf(payload: Readonly<Record<string, unknown>>): string | undefined {
  return textField(payload, 'tool_name')
}

export function toolInputOf(payload: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return recordField(payload, 'tool_input') ?? {}
}

export function fileOf(input: Record<string, unknown>): string | undefined {
  const direct = input['file_path']
  if (typeof direct === 'string' && direct !== '') {
    return direct
  }
  const nested = input['path']
  return typeof nested === 'string' && nested !== '' ? nested : undefined
}

/** Prefer stderr, then stdout, then a fixed fallback; never an empty reason. */
export function blockReason(stderr: string, stdout: string, fallback: string): string {
  const fromStderr = stderr.trim()
  if (fromStderr !== '') {
    return fromStderr
  }
  const fromStdout = stdout.trim()
  return fromStdout === '' ? fallback : fromStdout
}

export function failed(reason: string): HookAnswer {
  return { status: 'failed', reason }
}

export function cleanReason(reason: string | undefined, fallback: string): string {
  const trimmed = reason?.trim()
  return trimmed === undefined || trimmed === '' ? fallback : trimmed
}

/** Our `mcp__<server>__<tool>` name split at its first boundary. */
export function splitMcpName(name: string): { server: string; tool: string } | undefined {
  const prefix = 'mcp__'
  if (!name.startsWith(prefix)) {
    return undefined
  }
  const rest = name.slice(prefix.length)
  const boundary = rest.indexOf('__')
  return boundary === -1
    ? undefined
    : { server: rest.slice(0, boundary), tool: rest.slice(boundary + 2) }
}

export function isShellTool(tool: string): boolean {
  return tool === 'bash' || tool === 'powershell'
}

/** Preserve the runtime's already bounded preview, never fabricate an empty result. */
export function resultPreview(payload: Readonly<Record<string, unknown>>): string | undefined {
  return textField(payload, 'tool_response')
}

export function run(stdin: Record<string, unknown>): ForeignStdinResult {
  return { outcome: 'run', stdin: JSON.stringify(stdin) }
}

export function jsonOutput(stdout: string): unknown {
  try {
    return JSON.parse(stdout)
  } catch {
    return undefined
  }
}

export function copyFields(
  target: Record<string, unknown>,
  payload: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): void {
  for (const field of fields) {
    if (payload[field] !== undefined) target[field] = payload[field]
  }
}
