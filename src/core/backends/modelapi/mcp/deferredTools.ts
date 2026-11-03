// Deferred MCP loading (4-H4): the deterministic catalogue order, the
// definition-token estimate, the deferral plan and the local catalogue
// search behind `tool_search`. Pure: the pool builds the catalogue, the
// host plans each turn's declarations from it.
//
// Why: every MCP schema declared up front taxes every request (a
// five-server setup measured ~55k definition tokens; Anthropic reports
// tool search cutting them ~85% and raising MCP accuracy —
// docs/research/harness-science-2026-11-02.md 1.4) and any order churn
// rewrites the cached prefix (1.2). So the catalogue is always sorted
// (server id, then tool name, code-unit order — never locale order,
// which differs by machine), and above the person's threshold only
// `tool_search` plus already-discovered tools are declared. Discovery
// appends: a discovered tool joins the end of the declared list and
// stays for the session, so the prefix only ever grows, never moves.
// The search runs over the local catalogue only; it executes nothing.

import { MODEL_API_TOOLS } from '../../../../shared/constants'
import type { FunctionToolDefinition } from '../schemas'
import { estimateDefinitionTokens } from '../requestMeters'
import { mcpFunctionDefinition, mcpFunctionName } from './functions'
import type { McpToolInfo } from './protocol'

/** One offered MCP tool with everything deferral and search need. */
export interface McpCatalogEntry {
  /** The server's settings name (its id for ordering). */
  readonly server: string
  /** The tool's raw MCP name. */
  readonly tool: string
  /** The fitted function name the model calls (`mcp__<server>__<tool>`). */
  readonly functionName: string
  readonly definition: FunctionToolDefinition
  /** The fitted description (the definition's own). */
  readonly description: string
  /** Top-level argument names of the fitted parameters, sorted. */
  readonly argumentNames: readonly string[]
  readonly isReadOnly: boolean
}

/** Code-unit order (never locale order, which differs by machine). */
export function compareText(a: string, b: string): number {
  if (a < b) {
    return -1
  }
  return a > b ? 1 : 0
}

/** The one catalogue order: server id, then tool name, then function name. */
export function compareCatalogEntries(a: McpCatalogEntry, b: McpCatalogEntry): number {
  return (
    compareText(a.server, b.server) ||
    compareText(a.tool, b.tool) ||
    compareText(a.functionName, b.functionName)
  )
}

/** The catalogue in its deterministic order (a copy; the input is untouched). */
export function sortedCatalog(entries: readonly McpCatalogEntry[]): readonly McpCatalogEntry[] {
  return entries.toSorted(compareCatalogEntries)
}

/** One fitted tool with its raw listing and what fitting cut (for the pool's log). */
export interface FittedTool {
  readonly entry: McpCatalogEntry
  readonly tool: McpToolInfo
  readonly notes: readonly string[]
}

/**
Fit one server's (already entry-filtered) listing into catalogue
entries: sorted by tool name before function names are assigned, so
neither the listing order nor collision resolution can vary between
listings of the same tools. `taken` collects every function name in
use across servers and is extended in place.
*/
export function fitCatalogEntries(
  server: string,
  listed: readonly McpToolInfo[],
  taken: Set<string>,
): readonly FittedTool[] {
  const ordered = listed.toSorted((a, b) => compareText(a.name, b.name))
  return ordered.map((tool) => {
    const functionName = mcpFunctionName(server, tool.name, taken)
    taken.add(functionName)
    const { definition, notes } = mcpFunctionDefinition(functionName, tool)
    return {
      entry: {
        server,
        tool: tool.name,
        functionName,
        definition,
        description: definition.description,
        argumentNames: argumentNamesOf(definition),
        isReadOnly: tool.annotations?.readOnlyHint === true,
      },
      tool,
      notes,
    }
  })
}

/** The top-level argument names a fitted definition declares, sorted. */
export function argumentNamesOf(definition: FunctionToolDefinition): readonly string[] {
  const properties = definition.parameters['properties']
  return typeof properties !== 'object' || properties === null || Array.isArray(properties)
    ? []
    : Object.keys(properties).toSorted(compareText)
}

/** What one request declares of the MCP catalogue. */
export interface DeferralPlan {
  /** True while the full catalogue passes the person's threshold. */
  readonly isDeferred: boolean
  /**
  The MCP entries to declare. Not deferred: the whole sorted
  catalogue. Deferred: the discovered subset, in discovery order
  (append-only; the prefix never moves).
  */
  readonly declared: readonly McpCatalogEntry[]
  /** Catalogue entries held back for discovery. */
  readonly deferredCount: number
  /** Estimated tokens of the whole catalogue's definitions. */
  readonly definitionTokens: number
  /** Estimated tokens of the declared subset's definitions. */
  readonly declaredTokens: number
}

/**
The plan for a sorted catalogue. `thresholdTokens <= 0` never defers
(the person's 0). `discoveredOrder` is the session's discovered
function names in the order they were found; names no longer in the
catalogue are skipped, duplicates collapse to first sight.
*/
export function planDeferral(
  catalog: readonly McpCatalogEntry[],
  thresholdTokens: number,
  discoveredOrder: readonly string[],
): DeferralPlan {
  const definitionTokens = estimateDefinitionTokens(catalog.map((entry) => entry.definition))
  if (thresholdTokens <= 0 || definitionTokens <= thresholdTokens) {
    return {
      isDeferred: false,
      declared: catalog,
      deferredCount: 0,
      definitionTokens,
      declaredTokens: definitionTokens,
    }
  }
  const byName = new Map(catalog.map((entry) => [entry.functionName, entry]))
  const declared: McpCatalogEntry[] = []
  const seen = new Set<string>()
  for (const name of discoveredOrder) {
    const entry = byName.get(name)
    if (entry === undefined || seen.has(name)) {
      continue
    }

    seen.add(name)
    declared.push(entry)
  }
  return {
    isDeferred: true,
    declared,
    deferredCount: catalog.length - declared.length,
    definitionTokens,
    declaredTokens: estimateDefinitionTokens(declared.map((entry) => entry.definition)),
  }
}

const QUERY_SEPARATORS = /[^a-z0-9]+/

function searchHaystack(entry: McpCatalogEntry): string {
  return [entry.functionName, entry.tool, entry.server, entry.description, ...entry.argumentNames]
    .join('\n')
    .toLowerCase()
}

/**
Catalogue entries whose function name, tool name, server, description
or argument names hold every word of `query` (words split on anything
but letters and digits, case-insensitive), in catalogue order. An
empty or wordless query matches nothing.
*/
export function searchCatalog(
  catalog: readonly McpCatalogEntry[],
  query: string,
): readonly McpCatalogEntry[] {
  const words = query
    .toLowerCase()
    .split(QUERY_SEPARATORS)
    .filter((word) => word !== '')
  if (words.length === 0) {
    return []
  }
  return catalog.filter((entry) => {
    const haystack = searchHaystack(entry)
    return words.every((word) => haystack.includes(word))
  })
}

/**
Each server in the catalogue with its tool count, in catalogue order
(`everything (16 tools), filesystem (14 tools)`): what a deferred
request tells the model exists. One entry per server, so it stays
small however many tools a server lists.
*/
export function catalogServers(catalog: readonly McpCatalogEntry[]): string {
  const counts = new Map<string, number>()
  for (const entry of catalog) {
    counts.set(entry.server, (counts.get(entry.server) ?? 0) + 1)
  }
  return [...counts]
    .map(([server, count]) => `${server} (${String(count)} ${count === 1 ? 'tool' : 'tools'})`)
    .join(', ')
}

const TOOL_SEARCH_BASE: FunctionToolDefinition = {
  type: 'function',
  name: MODEL_API_TOOLS.toolSearch,
  description:
    'Find MCP tools whose schemas are not loaded yet. Searches the local tool catalogue by words from a server name, a tool name, its description or its argument names; matching tools become callable from the next request and stay loaded for the session. It runs nothing: call it before calling a tool you cannot see yet.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Words from a server name, tool name, description or argument name',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  strict: false,
}

/**
`tool_search`, declared only while MCP tools are deferred. Its
description names the frozen catalogue's servers, so it changes only
when the catalogue does (at a user turn), never on a discovery.
*/
export function toolSearchDefinition(catalog: readonly McpCatalogEntry[]): FunctionToolDefinition {
  return {
    ...TOOL_SEARCH_BASE,
    description: `${TOOL_SEARCH_BASE.description} MCP servers with tools to load: ${catalogServers(catalog)}.`,
  }
}
