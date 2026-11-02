import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  estimateDefinitionTokens,
  fitCatalogEntries,
  type McpCatalogEntry,
  planDeferral,
  searchCatalog,
  sortedCatalog,
  TOOL_SEARCH_DEFINITION,
} from '../../src/core/backends/modelapi/mcp/deferredTools'
import {
  listToolsResultSchema,
  type McpToolInfo,
  toolInfoSchema,
} from '../../src/core/backends/modelapi/mcp/protocol'
import {
  changedComponents,
  prefixComponentHashes,
  promptCacheKey,
} from '../../src/core/backends/modelapi/promptCache'
import { meterRequestPrefix } from '../../src/core/backends/modelapi/requestMeters'
import { estimatePackTokens } from '../../src/core/backends/modelapi/toolResultBound'

// Real tools/list frames, captured 2026-11-02 from locally run reference
// servers (test/fixtures/mcpDefer/manifest.json has the servers and the
// capture commands). Replayed through the same boundary parsers and
// fitting functions the pool runs: listToolsResultSchema/toolInfoSchema
// (connection.listTools), then fitCatalogEntries (pool.offer).
function capturedTools(file: string, frame: 'toolsList' | 'toolsListAgain'): McpToolInfo[] {
  const raw: unknown = JSON.parse(
    readFileSync(new URL(`../fixtures/mcpDefer/${file}`, import.meta.url), 'utf8'),
  )
  const capture = raw as Record<string, { result: unknown }>
  const parsed = listToolsResultSchema.parse(capture[frame]?.result)
  return parsed.tools.map((candidate) => toolInfoSchema.parse(candidate))
}

const EVERYTHING = 'everything'
const FILESYSTEM = 'filesystem'

function catalogOf(
  servers: readonly (readonly [string, readonly McpToolInfo[]])[],
): readonly McpCatalogEntry[] {
  const taken = new Set<string>()
  return sortedCatalog(
    servers.flatMap(([server, listed]) =>
      fitCatalogEntries(server, listed, taken).map((fitted) => fitted.entry),
    ),
  )
}

function byText(a: string, b: string): number {
  if (a < b) return -1
  return a > b ? 1 : 0
}

function prefixKey(catalog: readonly McpCatalogEntry[]): string {
  return promptCacheKey({
    model: 'muse-spark-1.3-contributor',
    instructions: 'instructions',
    tools: catalog.map((entry) => entry.definition),
  })
}

function prefixHashes(catalog: readonly McpCatalogEntry[], instructions: string) {
  return prefixComponentHashes({
    model: 'muse-spark-1.3-contributor',
    instructions,
    tools: catalog.map((entry) => entry.definition),
  })
}

// The >=55k-token catalogue: the captured everything tools replicated
// under 32 server ids (512 tools; manifest.json says why).
function largeCatalog(): readonly McpCatalogEntry[] {
  const listed = capturedTools('everything-tools-list.json', 'toolsList')
  return catalogOf(
    Array.from(
      { length: 32 },
      (_, index) => [`catalog-${String(index).padStart(2, '0')}`, listed] as const,
    ),
  )
}

function twoServerCatalog(): readonly McpCatalogEntry[] {
  return catalogOf([
    [EVERYTHING, capturedTools('everything-tools-list.json', 'toolsList')],
    [FILESYSTEM, capturedTools('filesystem-tools-list.json', 'toolsList')],
  ])
}

describe('deterministic MCP catalogue order (4-H4)', () => {
  it('orders by server id, then tool name, whatever order servers list in', () => {
    const catalog = twoServerCatalog()
    const pairs = catalog.map((entry) => `${entry.server}\0${entry.tool}`)
    expect(pairs).toEqual(pairs.toSorted(byText))
    expect(catalog).toHaveLength(30)
  })

  it('gives byte-identical definitions for a reversed listing and reversed servers', () => {
    const everything = capturedTools('everything-tools-list.json', 'toolsList')
    const filesystem = capturedTools('filesystem-tools-list.json', 'toolsList')
    const forward = catalogOf([
      [EVERYTHING, everything],
      [FILESYSTEM, filesystem],
    ])
    const reversed = catalogOf([
      [FILESYSTEM, filesystem.toReversed()],
      [EVERYTHING, everything.toReversed()],
    ])
    expect(JSON.stringify(reversed.map((entry) => entry.definition))).toBe(
      JSON.stringify(forward.map((entry) => entry.definition)),
    )
  })

  it('keeps the prompt-cache prefix digest across a no-op tools/list refresh', () => {
    const first = catalogOf([
      [EVERYTHING, capturedTools('everything-tools-list.json', 'toolsList')],
    ])
    const refreshed = catalogOf([
      [EVERYTHING, capturedTools('everything-tools-list.json', 'toolsListAgain')],
    ])
    expect(prefixKey(refreshed)).toBe(prefixKey(first))
  })

  it('changes the prefix digest when a tool really leaves, and only in tools', () => {
    const listed = capturedTools('everything-tools-list.json', 'toolsList')
    const before = catalogOf([[EVERYTHING, listed]])
    const after = catalogOf([[EVERYTHING, listed.filter((tool) => tool.name !== 'echo')]])
    expect(changedComponents(prefixHashes(before, 'rules'), prefixHashes(after, 'rules'))).toEqual([
      'tools',
    ])
    expect(
      changedComponents(prefixHashes(before, 'rules'), prefixHashes(before, 'rules v2')),
    ).toEqual(['instructions'])
    expect(changedComponents(prefixHashes(before, 'rules'), prefixHashes(before, 'rules'))).toEqual(
      [],
    )
  })
})

describe('deferral plan (4-H4)', () => {
  it('measures the large catalogue past 55k definition tokens and defers it at 10k', () => {
    const catalog = largeCatalog()
    const plan = planDeferral(catalog, 10_000, [])
    expect(plan.definitionTokens).toBeGreaterThanOrEqual(55_000)
    expect(plan.isDeferred).toBe(true)
    expect(plan.declared).toEqual([])
    expect(plan.deferredCount).toBe(catalog.length)
    // What a deferred request declares for MCP (the search tool alone)
    // is a small fraction of the full surface.
    const searchTokens = estimateDefinitionTokens([TOOL_SEARCH_DEFINITION])
    expect(searchTokens).toBeLessThan(plan.definitionTokens / 20)
  })

  it('never defers at threshold 0, and not under the threshold', () => {
    const catalog = twoServerCatalog()
    const full = estimateDefinitionTokens(catalog.map((entry) => entry.definition))
    expect(planDeferral(catalog, 0, []).isDeferred).toBe(false)
    const under = planDeferral(catalog, full + 1, [])
    expect(under.isDeferred).toBe(false)
    expect(under.declared).toHaveLength(catalog.length)
    expect(under.declaredTokens).toBe(full)
  })

  it('appends discoveries in discovery order and keeps them (prefix only grows)', () => {
    const catalog = largeCatalog()
    const last = catalog.at(-1)!
    const first = catalog.at(0)!
    const one = planDeferral(catalog, 10_000, [last.functionName])
    const two = planDeferral(catalog, 10_000, [last.functionName, first.functionName])
    expect(one.declared.map((entry) => entry.functionName)).toEqual([last.functionName])
    expect(two.declared.map((entry) => entry.functionName)).toEqual([
      last.functionName,
      first.functionName,
    ])
    expect(two.declared.slice(0, one.declared.length)).toEqual(one.declared)
    expect(two.deferredCount).toBe(catalog.length - 2)
    // A discovered name that left the catalogue is skipped, not declared.
    const gone = planDeferral(catalog, 10_000, ['mcp__gone__tool', first.functionName])
    expect(gone.declared.map((entry) => entry.functionName)).toEqual([first.functionName])
  })
})

describe('catalogue search (4-H4)', () => {
  it('finds tools by description words', () => {
    const matches = searchCatalog(twoServerCatalog(), 'sum of two numbers')
    expect(matches.map((entry) => entry.tool)).toEqual(['get-sum'])
  })

  it('finds tools by argument name', () => {
    const matches = searchCatalog(twoServerCatalog(), 'excludePatterns')
    expect(matches.map((entry) => entry.tool)).toEqual(['directory_tree', 'search_files'])
  })

  it('finds tools by name fragment, in catalogue order', () => {
    const matches = searchCatalog(twoServerCatalog(), 'trigger')
    // The toggle tools' captured descriptions also say "trigger".
    expect(matches.map((entry) => entry.tool)).toEqual([
      'toggle-simulated-logging',
      'toggle-subscriber-updates',
      'trigger-list-changed',
      'trigger-log-messages',
      'trigger-long-running-operation',
      'trigger-resource-update',
    ])
  })

  it('needs every query word, and a wordless query matches nothing', () => {
    const catalog = twoServerCatalog()
    expect(searchCatalog(catalog, 'directory sizes').map((entry) => entry.tool)).toEqual([
      'list_directory_with_sizes',
    ])
    expect(searchCatalog(catalog, '')).toEqual([])
    expect(searchCatalog(catalog, '---')).toEqual([])
    expect(searchCatalog(catalog, 'no such tool anywhere')).toEqual([])
  })
})

describe('request meters (4-H4)', () => {
  it('meters definitions and rules at the chars-per-token rule', () => {
    const catalog = twoServerCatalog()
    const definitions = catalog.map((entry) => entry.definition)
    const rules = 'Always run the tests.'
    const meters = meterRequestPrefix(definitions, rules)
    expect(meters.definitionTokens).toBe(estimateDefinitionTokens(definitions))
    expect(meters.rulesTokens).toBe(estimatePackTokens(rules.length))
    expect(meterRequestPrefix(definitions, undefined).rulesTokens).toBe(0)
  })

  it('shows deferral cutting declared MCP tokens before and after', () => {
    const catalog = largeCatalog()
    const before = meterRequestPrefix(
      catalog.map((entry) => entry.definition),
      undefined,
    ).definitionTokens
    const plan = planDeferral(catalog, 10_000, [])
    const after = meterRequestPrefix(
      [...plan.declared.map((entry) => entry.definition), TOOL_SEARCH_DEFINITION],
      undefined,
    ).definitionTokens
    expect(before).toBeGreaterThanOrEqual(55_000)
    expect(after).toBeLessThan(before / 20)
  })
})
