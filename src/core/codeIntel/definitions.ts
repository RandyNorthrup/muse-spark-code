// The code intelligence tools as the model sees them (M67, PLAN.md D49):
// one description and one argument schema per tool, shared by the Model
// API's native tools (`find_definition`, …) and the `ide` server's
// (`mcp__ide__findDefinition`, …). Only `rename_symbol` differs: on the
// Model API it writes the files through the edit path; on `ide` it returns
// the edits for Muse Code's own edit tool.

import * as z from 'zod/mini'
import { CODE_INTEL_TOOLS, type CodeIntelTool } from '../../shared/constants'

export const CALL_DIRECTIONS = ['incoming', 'outgoing'] as const

export const locateArgs = z.object({
  path: z.optional(z.string()),
  line: z.optional(z.number()),
  column: z.optional(z.number()),
  symbol: z.optional(z.string()),
})
export type LocateArgs = z.infer<typeof locateArgs>
export const workspaceSymbolsArgs = z.object({ query: z.string() })
export const documentSymbolsArgs = z.object({ path: z.string() })
export const callHierarchyArgs = z.extend(locateArgs, {
  direction: z.optional(z.enum(CALL_DIRECTIONS)),
})
export const repoMapArgs = z.object({ max_tokens: z.optional(z.number()) })
export const renameArgs = z.extend(locateArgs, { new_name: z.string() })

const HOW_TO_NAME =
  'Name the symbol by path, line and column (1-based); by path and line plus its name in symbol; by path and symbol (its first use in that file); or by symbol alone (looked up among the workspace symbols).'

const LOCATE_PROPERTIES = {
  path: { type: 'string', description: 'Workspace-relative path of the file' },
  line: { type: 'integer', description: '1-based line' },
  column: { type: 'integer', description: '1-based column: the character in the line' },
  symbol: {
    type: 'string',
    description:
      "The symbol's name: found on line in path, its first use in path, or a workspace symbol when no path is given",
  },
} as const

export interface CodeIntelDefinition {
  readonly tool: CodeIntelTool
  readonly description: string
  readonly properties: Readonly<Record<string, unknown>>
  readonly required: readonly string[]
}

const RENAME_PROPERTIES = {
  ...LOCATE_PROPERTIES,
  new_name: { type: 'string', description: 'The new name' },
} as const

const READ_DEFINITIONS: readonly CodeIntelDefinition[] = [
  {
    tool: 'findDefinition',
    description: `Find where a symbol is defined, from VS Code's language service (Go to Definition). ${HOW_TO_NAME} Answers workspace-relative path:line:column with the line's text.`,
    properties: LOCATE_PROPERTIES,
    required: [],
  },
  {
    tool: 'findReferences',
    description: `Find every use of a symbol, its declaration included, from VS Code's language service (Find All References). ${HOW_TO_NAME} Answers workspace-relative path:line:column with each line's text.`,
    properties: LOCATE_PROPERTIES,
    required: [],
  },
  {
    tool: 'workspaceSymbols',
    description:
      "Search the workspace's symbols (classes, functions, methods, variables…) by name, from VS Code's language services (Go to Symbol in Workspace).",
    properties: { query: { type: 'string', description: 'The name or part of it' } },
    required: ['query'],
  },
  {
    tool: 'documentSymbols',
    description:
      "A file's symbols as an outline (classes, their members, functions…) with line:column, from VS Code's language service.",
    properties: { path: LOCATE_PROPERTIES.path },
    required: ['path'],
  },
  {
    tool: 'hover',
    description: `A symbol's type and documentation, as VS Code's hover shows them. ${HOW_TO_NAME}`,
    properties: LOCATE_PROPERTIES,
    required: [],
  },
  {
    tool: 'callHierarchy',
    description: `Who calls a function or method (incoming, the default) or what it calls (outgoing), from VS Code's language service where the language supports it. ${HOW_TO_NAME}`,
    properties: {
      ...LOCATE_PROPERTIES,
      direction: { type: 'string', enum: [...CALL_DIRECTIONS] },
    },
    required: [],
  },
  {
    tool: 'repoMap',
    description:
      'A compact map of the workspace: the files other files use most, ranked by how often the names they define are used elsewhere, each with its most used definitions, within a token budget. Use it to get your bearings in an unfamiliar codebase.',
    properties: {
      max_tokens: {
        type: 'integer',
        description:
          'The budget in tokens for the whole answer, notes included (default 1024, at most 8192)',
      },
    },
    required: [],
  },
]

/** The Model API's tools: `rename_symbol` writes through the edit path and asks like an edit. */
export const MODEL_API_CODE_INTEL_DEFINITIONS: readonly CodeIntelDefinition[] = [
  ...READ_DEFINITIONS,
  {
    tool: 'renameSymbol',
    description: `Rename a symbol everywhere it is used, through VS Code's language service (Rename Symbol), and write the changed files; it asks like an edit. ${HOW_TO_NAME}`,
    properties: RENAME_PROPERTIES,
    required: ['new_name'],
  },
]

/** The `ide` server's tools: `renameSymbol` changes nothing and returns the edits. */
export const IDE_CODE_INTEL_DEFINITIONS: readonly CodeIntelDefinition[] = [
  ...READ_DEFINITIONS,
  {
    tool: 'renameSymbol',
    description: `Compute the edits that rename a symbol everywhere it is used, through VS Code's language service (Rename Symbol). It changes nothing: it returns a unified diff per file for you to apply with your own edit tool. ${HOW_TO_NAME}`,
    properties: RENAME_PROPERTIES,
    required: ['new_name'],
  },
]

const TOOL_BY_NAME: ReadonlyMap<string, CodeIntelTool> = new Map(
  MODEL_API_CODE_INTEL_DEFINITIONS.map((definition) => [
    CODE_INTEL_TOOLS[definition.tool],
    definition.tool,
  ]),
)

/** Which code intelligence tool a Model API function name is; undefined for any other. */
export function codeIntelToolOf(name: string): CodeIntelTool | undefined {
  return TOOL_BY_NAME.get(name)
}
