import { type EXTENSION_HOOK_EVENTS } from '../../../../shared/constants'
import { type HookEvent } from '../hooks'

/** The events an adapter accepts: Muse Code's plus the extension-only ones. */
export type AdapterEvent = HookEvent | (typeof EXTENSION_HOOK_EVENTS)[number]

/** What building a foreign stdin decided: run it, skip it, or refuse it. */
export type ForeignStdinResult =
  | { readonly outcome: 'run'; readonly stdin: string }
  /** The hook does not run, and that is not a failure (Kiro's path filter). */
  | { readonly outcome: 'skip'; readonly reason: string }
  /**
   * The event + payload cannot be translated faithfully. For a blocking row,
   * blockOperation requires refusing the guarded operation before execution;
   * recording a discarded hook failure would lose the imported guard.
   */
  | { readonly outcome: 'refused'; readonly reason: string; readonly blockOperation?: true }

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

export function fileOf(input: Record<string, unknown>): string | undefined {
  const direct = input['file_path']
  if (typeof direct === 'string' && direct !== '') {
    return direct
  }
  const nested = input['path']
  return typeof nested === 'string' && nested !== '' ? nested : undefined
}

/** Prefer the first text, then the second, then a fixed fallback; never empty. */
export function blockReason(first: string, second: string, fallback: string): string {
  const fromFirst = first.trim()
  if (fromFirst !== '') {
    return fromFirst
  }
  const fromSecond = second.trim()
  return fromSecond === '' ? fallback : fromSecond
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

export function jsonOutput(stdout: string): unknown {
  try {
    return JSON.parse(stdout)
  } catch {
    return undefined
  }
}
