// The text half of the MCP tool pins (SEC-MCP-PIN, PLAN.md D42): a tool
// definition written one canonical way, so two listings that say the same
// hash the same whatever order the server writes an object's keys in, and
// server text shown with every hidden character spelled out, so a person
// reviewing a changed description sees what is really there (a zero-width
// or bidi character can turn displayed text into a lie). Pure.

import { MCP_TOOL_TEXT_HEX_RADIX } from '../../../../shared/constants'
import type { McpToolInfo } from './protocol'

/**
A JSON value with every object's keys sorted; `undefined` object members
are dropped, as JSON itself drops them, and array order is kept (an enum
or a `required` list is order-bearing text the server chose).
*/
function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalValue(item))
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .toSorted(([a], [b]) => Number(a > b) - Number(a < b))
      .map(([key, item]) => [key, canonicalValue(item)] as const)
    return Object.fromEntries(entries)
  }
  return value
}

/**
One offered tool's definition as the pin reads it (name, title,
description, inputSchema, annotations), canonicalised: two listings of
the same definition give the same text, and any change to what the tool
says or accepts gives different text. Absent fields read as null, so a
field appearing or disappearing is itself a change.
*/
export function canonicalToolDefinition(tool: McpToolInfo): string {
  return JSON.stringify(
    canonicalValue({
      name: tool.name,
      title: tool.title ?? null,
      description: tool.description ?? null,
      inputSchema: tool.inputSchema ?? null,
      annotations: tool.annotations ?? null,
    }),
  )
}

/**
The characters invisible or steerable in rendered text, by Unicode
category: the controls (Cc), the format characters (Cf: zero-width and
directional marks, bidi controls and isolates, the word joiner, the
soft hyphen, the byte-order mark) and the line and paragraph separators
(Zl, Zp).
*/
const HIDDEN_CHAR = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

const LINE_FEED = '\n'

/**
Text with every hidden character written as a `\u{XXXX}` escape, so the
review surface shows exactly what the server sent. A newline stays a
line break; a tab, a carriage return and everything invisible become
escapes.
*/
export function escapeHiddenChars(text: string): string {
  let shown = ''
  for (const char of text) {
    shown +=
      char === LINE_FEED || !HIDDEN_CHAR.test(char)
        ? char
        : String.raw`\u{${(char.codePointAt(0) ?? 0).toString(MCP_TOOL_TEXT_HEX_RADIX).toUpperCase()}}`
  }
  return shown
}
