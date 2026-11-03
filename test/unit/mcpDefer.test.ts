import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  fitCatalogEntries,
  type McpCatalogEntry,
  planDeferral,
  searchCatalog,
  sortedCatalog,
  toolSearchDefinition,
} from '../../src/core/backends/modelapi/mcp/deferredTools'
import {
  McpDeclarations,
  unconnectedMcpServers,
} from '../../src/core/backends/modelapi/mcp/declarations'
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
import {
  estimateDefinitionTokens,
  meterRequestPrefix,
} from '../../src/core/backends/modelapi/requestMeters'
import type { McpPoolSnapshot } from '../../src/core/backends/modelapi/mcp/pool'
import { estimatePackTokens } from '../../src/core/backends/modelapi/toolResultBound'
import { toolDefinitions } from '../../src/core/backends/modelapi/tools'
import { MODEL_API_TOOLS } from '../../src/shared/constants'

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
    const searchTokens = estimateDefinitionTokens([toolSearchDefinition(catalog)])
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
      [toolSearchDefinition(catalog), ...plan.declared.map((entry) => entry.definition)],
      undefined,
    ).definitionTokens
    expect(before).toBeGreaterThanOrEqual(55_000)
    expect(after).toBeLessThan(before / 20)
  })
})

// The session's declarations across user turns, as the host assembles
// each request: the real core tool list (tools.ts toolDefinitions),
// then what McpDeclarations declares. `live` plays the pool's
// catalogue at each moment, built from the captured frames.
describe('session declarations across turns (4-H4)', () => {
  const ALL_CONNECTED: McpPoolSnapshot = { isStarted: true, fault: undefined, servers: [] }
  const core = toolDefinitions('linux', { hasShell: true, hasSkills: false })
  const request = (declarations: McpDeclarations) => [...core, ...declarations.definitions(true)]

  it('declares tool_search alone past the threshold, then appends what a search loads', () => {
    const catalog = twoServerCatalog()
    const declarations = new McpDeclarations(
      { catalog: () => catalog, snapshot: () => ALL_CONNECTED },
      () => 1,
    )
    const start = declarations.beginTurn()
    expect(start.changed).toBeUndefined()
    expect(start.deferral?.deferredCount).toBe(catalog.length)
    // Said, never silent: one log line and one transcript notice.
    expect(start.log).toHaveLength(1)
    expect(start.log[0]).toMatch(/^MCP tools deferred: 30 of 30 tools load through tool_search/)
    expect(start.notice).toMatch(/^30 of 30 MCP tools now load on demand through Find Tools/)
    const first = request(declarations)
    expect(first.map((tool) => tool.name)).toEqual([
      ...core.map((tool) => tool.name),
      MODEL_API_TOOLS.toolSearch,
    ])
    // The search tool names each server and its tool count, nothing more.
    expect(first.at(-1)?.description).toContain('everything (16 tools), filesystem (14 tools).')
    const sum = catalog.find((entry) => entry.tool === 'get-sum')!
    const echo = catalog.find((entry) => entry.tool === 'echo')!
    // A deferred tool the model never loaded is not callable.
    expect(declarations.isUndiscovered(sum.functionName, true)).toBe(true)
    const found = declarations.search('sum of two numbers')
    expect(found).toMatchObject({ kind: 'searched', matches: [sum], loaded: [sum] })
    expect(found.kind === 'searched' && found.visibleOutput).toBe(
      `Loaded 1 MCP tool(s) for the next request: ${sum.functionName}`,
    )
    expect(declarations.isUndiscovered(sum.functionName, true)).toBe(false)
    expect(declarations.isUndiscovered(echo.functionName, true)).toBe(true)
    // Without tool_search reachable, nothing is held back.
    expect(declarations.isUndiscovered(echo.functionName, false)).toBe(false)
    const second = request(declarations)
    const firstBytes = JSON.stringify(first)
    // Append-only: the earlier request's tool bytes open the next one.
    expect(JSON.stringify(second).startsWith(firstBytes.slice(0, -1))).toBe(true)
    expect(second.at(-1)).toEqual(sum.definition)
    // A repeat search loads nothing new and the bytes stay.
    expect(declarations.search('get-sum')).toMatchObject({
      kind: 'searched',
      matches: [sum],
      loaded: [],
      visibleOutput: `Already loaded: ${sum.functionName}`,
    })
    expect(JSON.stringify(request(declarations))).toBe(JSON.stringify(second))
    // The next user turn keeps the discovery and says deferral only once.
    expect(declarations.beginTurn()).toEqual({
      changed: undefined,
      deferral: undefined,
      log: [],
      notice: undefined,
    })
    expect(JSON.stringify(request(declarations))).toBe(JSON.stringify(second))
  })

  it('applies a mid-turn tools/list change at the next user turn, said once', () => {
    const listed = capturedTools('everything-tools-list.json', 'toolsList')
    let live = catalogOf([[EVERYTHING, listed]])
    const declarations = new McpDeclarations(
      { catalog: () => live, snapshot: () => ALL_CONNECTED },
      () => 0,
    )
    const cacheKey = () =>
      promptCacheKey({
        model: 'muse-spark-1.3-contributor',
        instructions: 'instructions',
        tools: request(declarations),
      })
    declarations.beginTurn()
    const turnOneKey = cacheKey()
    const turnOneBytes = JSON.stringify(request(declarations))
    // A no-op refresh (the captured second tools/list) changes nothing.
    live = catalogOf([[EVERYTHING, capturedTools('everything-tools-list.json', 'toolsListAgain')]])
    expect(declarations.beginTurn()).toEqual({
      changed: undefined,
      deferral: undefined,
      log: [],
      notice: undefined,
    })
    expect(cacheKey()).toBe(turnOneKey)
    // The server drops a tool mid-turn: this turn's requests keep their bytes.
    live = catalogOf([[EVERYTHING, listed.filter((tool) => tool.name !== 'echo')]])
    expect(JSON.stringify(request(declarations))).toBe(turnOneBytes)
    expect(cacheKey()).toBe(turnOneKey)
    // The withdrawn tool was declared this turn: unavailable, not unknown.
    const echoName = catalogOf([[EVERYTHING, listed]]).find((entry) => entry.tool === 'echo')!
    expect(declarations.wasDeclared(echoName.functionName)).toBe(true)
    // The next user turn applies it, once, with counts only.
    const tokens = estimateDefinitionTokens(live.map((entry) => entry.definition))
    expect(declarations.beginTurn()).toEqual({
      changed: { toolCount: 15, definitionTokens: tokens },
      deferral: undefined,
      log: [
        `MCP tool catalogue changed for the next request prefix: 15 tools, about ${String(tokens)} definition tokens`,
      ],
      notice: undefined,
    })
    expect(cacheKey()).not.toBe(turnOneKey)
    expect(JSON.stringify(request(declarations))).toBe(
      JSON.stringify([...core, ...live.map((entry) => entry.definition)]),
    )
    expect(declarations.wasDeclared(echoName.functionName)).toBe(false)
    expect(declarations.beginTurn().changed).toBeUndefined()
  })

  it('declares the whole catalogue and loads nothing at threshold 0', () => {
    const catalog = twoServerCatalog()
    const declarations = new McpDeclarations(
      { catalog: () => catalog, snapshot: () => ALL_CONNECTED },
      () => 0,
    )
    expect(declarations.beginTurn().deferral).toBeUndefined()
    expect(declarations.definitions(true)).toEqual(catalog.map((entry) => entry.definition))
    expect(declarations.search('echo')).toEqual({ kind: 'notDeferred' })
    expect(declarations.isUndiscovered(catalog[0]!.functionName, true)).toBe(false)
  })

  it('names the servers not connected when a search finds nothing, leaving out a disabled one', () => {
    const catalog = twoServerCatalog()
    const snapshot: McpPoolSnapshot = {
      isStarted: true,
      fault: undefined,
      servers: [
        {
          name: EVERYTHING,
          isRequired: false,
          state: { status: 'connected', toolCount: 16, unofferedCount: 0 },
          heldBack: [],
          tools: [],
        },
        {
          name: 'github',
          isRequired: false,
          state: { status: 'failed', reason: 'exited' },
          heldBack: [],
          tools: [],
        },
        {
          name: 'slack',
          isRequired: false,
          state: { status: 'starting' },
          heldBack: [],
          tools: [],
        },
        {
          name: 'off',
          isRequired: false,
          state: { status: 'disabled' },
          heldBack: [],
          tools: [],
        },
      ],
    }
    expect(unconnectedMcpServers(snapshot)).toBe('github (failed), slack (starting)')
    const declarations = new McpDeclarations(
      { catalog: () => catalog, snapshot: () => snapshot },
      () => 1,
    )
    declarations.beginTurn()
    const answer = declarations.search('pull request review')
    expect(answer).toMatchObject({ kind: 'searched', matches: [], loaded: [] })
    expect(answer.kind === 'searched' && answer.output).toBe(
      'No deferred MCP tool matches "pull request review". Search again with other words from a tool name, description or argument name. These MCP servers are not connected now, so their tools are not in the catalogue: github (failed), slack (starting).',
    )
    expect(unconnectedMcpServers(ALL_CONNECTED)).toBe('')
  })
})
