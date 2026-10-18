import { describe, expect, it } from 'vitest'
import { offeredTools } from '../../src/core/backends/modelapi/mcp/pool'
import type { McpToolInfo } from '../../src/core/backends/modelapi/mcp/protocol'

function tools(count: number): McpToolInfo[] {
  return Array.from({ length: count }, (_, index) => ({ name: `tool-${String(index)}` }))
}

describe('offeredTools', () => {
  it('offers all 200 tools of a server: no per-server cap', () => {
    const listed = tools(200)
    expect(offeredTools(listed, { enabledTools: undefined, disabledTools: new Set() })).toEqual(
      listed,
    )
  })

  it('still honours the entry enabled/disabled filter', () => {
    const listed = tools(10)
    const kept = offeredTools(listed, {
      enabledTools: new Set(['tool-1', 'tool-2']),
      disabledTools: new Set(['tool-2']),
    })
    expect(kept.map((tool) => tool.name)).toEqual(['tool-1'])
  })
})
