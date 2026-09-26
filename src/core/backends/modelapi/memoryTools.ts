// Muse Code's memory tools on the Model API backend (M49, PLAN.md D41):
// `read_memory`, `add_memory` and `edit_memory` with Muse Code's own names,
// arguments, descriptions (its 1.3.0 binary's) and JSON results, so a row
// reads the same on both backends (M43) and both write one memory. The
// notes themselves are the store's (src/core/memory/memoryStore.ts).

import * as z from 'zod/mini'
import {
  DEFAULT_MEMORY_SCOPE,
  MEMORY_NOTE_TYPES,
  MEMORY_SCOPES,
  MODEL_API_TOOLS,
} from '../../../shared/constants'
import type { Located, MemoryNotePlace, MemoryStore } from '../../memory/memoryStore'
import { functionTool, type ToolOutcome } from './tools'
import type { FunctionToolDefinition } from './schemas'

const scopeArg = z.optional(z.enum(MEMORY_SCOPES))
const memoryReadArgs = z.object({
  scope: scopeArg,
  path: z.string(),
  offset: z.optional(z.int()),
  limit: z.optional(z.int()),
})
const memoryAddArgs = z.object({
  scope: scopeArg,
  path: z.string(),
  content: z.string(),
  type: z.optional(z.enum(MEMORY_NOTE_TYPES)),
  description: z.optional(z.string()),
})
const memoryEditArgs = z.object({
  scope: scopeArg,
  path: z.string(),
  old_str: z.string(),
  new_str: z.string(),
})

type MemoryCall =
  | { readonly tool: 'read'; readonly args: z.infer<typeof memoryReadArgs> }
  | { readonly tool: 'add'; readonly args: z.infer<typeof memoryAddArgs> }
  | { readonly tool: 'edit'; readonly args: z.infer<typeof memoryEditArgs> }

const MEMORY_TOOL_NAMES: ReadonlySet<string> = new Set([
  MODEL_API_TOOLS.readMemory,
  MODEL_API_TOOLS.addMemory,
  MODEL_API_TOOLS.editMemory,
])

const SCOPE_PROPERTY = {
  type: 'string',
  enum: [...MEMORY_SCOPES],
  description: 'Memory scope. Defaults to personal_project.',
}
const PATH_PROPERTY = {
  type: 'string',
  description: 'Relative Markdown path under the selected memory scope root.',
}

export function isMemoryTool(name: string): boolean {
  return MEMORY_TOOL_NAMES.has(name)
}

/** The three memory tools as Muse Code describes them to its model. */
export function memoryToolDefinitions(): readonly FunctionToolDefinition[] {
  return [
    functionTool(
      MODEL_API_TOOLS.readMemory,
      'Read a bounded line window from one local Markdown memory file. Use this when you need live memory content; reads never write to memory.',
      {
        path: PATH_PROPERTY,
        scope: SCOPE_PROPERTY,
        offset: {
          type: 'integer',
          description: '1-based line number where the read window starts. Defaults to 1.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of lines to return. Defaults to 500.',
        },
      },
      ['path'],
    ),
    functionTool(
      MODEL_API_TOOLS.addMemory,
      `Add Markdown content to local memory: creates the file when it is missing, appends to the end when it already exists, and does not overwrite existing content. A new note gets its line in the scope's MEMORY.md index. Use ${MODEL_API_TOOLS.editMemory} for exact replacements.`,
      {
        path: PATH_PROPERTY,
        scope: SCOPE_PROPERTY,
        content: {
          type: 'string',
          description: 'Markdown content to append. Existing file content is preserved.',
        },
        type: {
          type: 'string',
          enum: [...MEMORY_NOTE_TYPES],
          description: 'Optional memory note type for future recall.',
        },
        description: { type: 'string', description: 'Optional short summary for future recall.' },
      },
      ['path', 'content'],
    ),
    functionTool(
      MODEL_API_TOOLS.editMemory,
      `Replace one exact string in local Markdown memory. The edit fails unless old_str appears exactly once; use ${MODEL_API_TOOLS.addMemory} to append new content.`,
      {
        path: PATH_PROPERTY,
        scope: SCOPE_PROPERTY,
        old_str: {
          type: 'string',
          description: 'Exact text to replace. Must match exactly once.',
        },
        new_str: { type: 'string', description: 'Replacement text. May be empty.' },
      },
      ['path', 'old_str', 'new_str'],
    ),
  ]
}

function invalid(error: z.core.$ZodError): Located<MemoryCall> {
  return { ok: false, reason: `invalid arguments: ${z.prettifyError(error)}` }
}

function parsed(name: string, argsJson: string): Located<MemoryCall> {
  let raw: unknown
  try {
    raw = JSON.parse(argsJson)
  } catch {
    return { ok: false, reason: 'arguments are not valid JSON' }
  }
  switch (name) {
    case MODEL_API_TOOLS.readMemory: {
      const result = memoryReadArgs.safeParse(raw)
      return result.success
        ? { ok: true, value: { tool: 'read', args: result.data } }
        : invalid(result.error)
    }
    case MODEL_API_TOOLS.addMemory: {
      const result = memoryAddArgs.safeParse(raw)
      return result.success
        ? { ok: true, value: { tool: 'add', args: result.data } }
        : invalid(result.error)
    }
    case MODEL_API_TOOLS.editMemory: {
      const result = memoryEditArgs.safeParse(raw)
      return result.success
        ? { ok: true, value: { tool: 'edit', args: result.data } }
        : invalid(result.error)
    }
    default: {
      return { ok: false, reason: `unknown tool ${name}` }
    }
  }
}

/** A memory call ready to run: what it does and where. */
export interface PlacedMemoryCall {
  readonly call: MemoryCall
  readonly place: MemoryNotePlace
}

/**
 * The call's arguments checked and its note placed, before any card: a
 * refused path costs the user no question (as an edit's does, D24).
 */
export async function placeMemoryCall(
  store: MemoryStore,
  name: string,
  argsJson: string,
): Promise<Located<PlacedMemoryCall>> {
  const call = parsed(name, argsJson)
  if (!call.ok) {
    return call
  }
  const { args } = call.value
  const place = await store.locate(args.scope ?? DEFAULT_MEMORY_SCOPE, args.path)
  return place.ok ? { ok: true, value: { call: call.value, place: place.value } } : place
}

/** Runs a placed call; the result is Muse Code's JSON for the model and the row alike. */
export async function runMemoryCall(
  store: MemoryStore,
  placed: PlacedMemoryCall,
): Promise<ToolOutcome> {
  const { call, place } = placed
  let outcome: Located<string>
  switch (call.tool) {
    case 'read': {
      outcome = await store.read(place, call.args)
      break
    }
    case 'add': {
      outcome = await store.add(place, call.args)
      break
    }
    case 'edit': {
      outcome = await store.edit(place, call.args)
      break
    }
  }
  return outcome.ok
    ? { output: outcome.value, visibleOutput: outcome.value }
    : {
        output: `Error: ${outcome.reason}`,
        visibleOutput: outcome.reason,
        failureReason: outcome.reason,
      }
}
