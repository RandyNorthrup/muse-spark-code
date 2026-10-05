import { describe, expect, it, vi } from 'vitest'
import { handleMcpMessage } from '../../src/core/mcp'
import { teamServerToolList } from '../../src/host/team/teamMcpServer'

function tools() {
  return ['roster', 'delegate', 'collect', 'cancel', 'merge', 'reschedule'].map((name) => ({
    name,
    description: `Fixed description for ${name}`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false },
    call: vi.fn(() => Promise.resolve('tool data')),
  }))
}

describe('team server fixed declarations', () => {
  it('offers six tools to the orchestrator and only four to a delegating worker', () => {
    const base = tools()
    expect(teamServerToolList(base, 'orchestrator').map((tool) => tool.name)).toEqual([
      'roster',
      'delegate',
      'collect',
      'cancel',
      'merge',
      'reschedule',
    ])
    expect(teamServerToolList(base, 'worker').map((tool) => tool.name)).toEqual([
      'roster',
      'delegate',
      'collect',
      'cancel',
    ])
    for (const name of ['roster', 'collect'])
      expect(
        teamServerToolList(base, 'orchestrator').find((tool) => tool.name === name)?.annotations?.[
          'readOnlyHint'
        ],
      ).toBe(true)
    expect(base[0]!.annotations.readOnlyHint).toBe(false)
    expect(
      teamServerToolList([...base, { ...base[0]!, name: 'unexpected_tool' }], 'worker').map(
        (tool) => tool.name,
      ),
    ).toEqual(['roster', 'delegate', 'collect', 'cancel'])
  })

  it('keeps MCP tools/list byte-identical after upstream metadata changes and dispatches only to the bound list', async () => {
    const base = tools()
    const frozen = teamServerToolList(base, 'orchestrator')
    const info = { name: 'team', version: 'test' }
    const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const before = JSON.stringify(await handleMcpMessage(request, frozen, info))
    base[0]!.inputSchema.additionalProperties = true
    base[1]!.annotations.readOnlyHint = true
    base[0]!.description = 'Changed mid-conversation'
    expect(JSON.stringify(await handleMcpMessage(request, frozen, info))).toBe(before)
    await handleMcpMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'reschedule', arguments: { task_ids: ['a'] } },
      }),
      frozen,
      info,
    )
    expect(base[5]!.call).toHaveBeenCalledWith({ task_ids: ['a'] }, expect.any(AbortSignal))
    const refused = await handleMcpMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'merge', arguments: { task_id: 'a' } },
      }),
      teamServerToolList(base, 'worker'),
      info,
    )
    expect(refused).toMatchObject({ kind: 'response', body: { result: { isError: true } } })
    expect(base[4]!.call).not.toHaveBeenCalled()
  })

  it('keeps nested roster and collect annotations byte-identical for both callers', async () => {
    const base = tools().map((tool) => ({
      ...tool,
      annotations: {
        ...tool.annotations,
        customHint: { budget: 1, scope: { roles: ['engineering'] } },
      },
    }))
    const info = { name: 'team', version: 'test' }
    const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const lists = [teamServerToolList(base, 'orchestrator'), teamServerToolList(base, 'worker')]
    const before = []
    for (const list of lists)
      before.push(JSON.stringify(await handleMcpMessage(request, list, info)))
    for (const tool of base) {
      if (tool.name !== 'roster' && tool.name !== 'collect') continue
      tool.annotations.customHint.budget = 2
      tool.annotations.customHint.scope.roles.push('research')
      tool.annotations.readOnlyHint = false
    }
    for (const [index, list] of lists.entries()) {
      expect(JSON.stringify(await handleMcpMessage(request, list, info))).toBe(before[index])
      for (const tool of list) {
        if (tool.name === 'roster' || tool.name === 'collect')
          expect(tool.annotations?.['readOnlyHint']).toBe(true)
      }
    }
  })
})
