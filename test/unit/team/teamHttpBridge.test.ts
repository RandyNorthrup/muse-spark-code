// D250: the shipped stdio bridge (`dist/teamHttpBridge.js`) forwarding to
// the real team MCP endpoint. Real code throughout: the built bridge
// process, the loopback server behind the real window binding, and the
// real team host bundle's runner behind the roster call. Proves the three
// claims the bridge exists for: the server's `instructions` reach a stdio
// client, the five tools answer through it, and a wrong token is refused
// as a JSON-RPC error, never silently passed.

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TEAM_MODEL_TEXT } from '../../../src/shared/constants'
import { openExternalLeadBinding } from '../helpers/teamMcpBinding'
import type { TeamHostBinding } from '../../../src/host/teamHostBinding'
import { assertCurrentProductionBuild } from '../productionBuild'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BRIDGE = path.join(ROOT, 'dist', 'teamHttpBridge.js')

const state: { binding: TeamHostBinding | undefined } = { binding: undefined }

beforeAll(async () => {
  assertCurrentProductionBuild(inject('productionBuildGeneration'), ROOT)
  state.binding = await openExternalLeadBinding()
})

afterAll(async () => {
  await state.binding?.dispose()
})

interface Bridge {
  readonly ask: (body: Record<string, unknown>) => Promise<Record<string, unknown>>
  readonly close: () => void
}

function startBridge(url: string, headers: Record<string, string>): Bridge {
  const child: ChildProcess = spawn(process.execPath, [BRIDGE], {
    env: {
      ...process.env,
      MUSE_TEAM_BRIDGE_URL: url,
      MUSE_TEAM_BRIDGE_HEADERS: JSON.stringify(headers),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const waiters = new Map<number, (value: Record<string, unknown>) => void>()
  let buffer = ''
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (text: string) => {
    buffer += text
    let index = buffer.indexOf('\n')
    while (index !== -1) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      const parsed = JSON.parse(line) as Record<string, unknown>
      const id = parsed['id']
      if (typeof id === 'number') waiters.get(id)?.(parsed)
      index = buffer.indexOf('\n')
    }
  })
  return {
    ask: (body) =>
      new Promise((resolveAsk) => {
        waiters.set(body['id'] as number, resolveAsk)
        child.stdin?.write(`${JSON.stringify(body)}\n`)
      }),
    close: () => {
      child.kill()
    },
  }
}

describe('the team HTTP bridge', () => {
  it('carries initialize instructions, the five tools, a roster answer — and refuses a wrong token', async () => {
    if (state.binding === undefined) throw new Error('binding not open')
    const endpoint = await state.binding.teamMcp.endpointForConversation()
    if (endpoint === undefined) throw new Error('team endpoint missing')
    await state.binding.teamMcp.rememberMode('bridge-session', 'team')

    const bridge = startBridge(endpoint.url, endpoint.headers)
    try {
      const initialized = await bridge.ask({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't' } },
      })
      const result = initialized['result'] as Record<string, unknown>
      expect(result['instructions']).toBe(TEAM_MODEL_TEXT.mcpInstructions)
      expect(result['instructions']).toContain('roster')

      const listed = await bridge.ask({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
      const tools = (listed['result'] as { tools: { name: string; description: string }[] }).tools
      expect(tools.map((tool) => tool.name)).toEqual([
        'roster',
        'delegate',
        'collect',
        'cancel',
        'merge',
      ])
      expect(tools.every((tool) => tool.description.length > 0)).toBe(true)

      const roster = await bridge.ask({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'roster', arguments: {} },
      })
      const content = (roster['result'] as { content: { text: string }[] }).content
      expect(content[0]?.text).toContain('engineering')
    } finally {
      bridge.close()
    }

    const forged = startBridge(endpoint.url, { Authorization: `Bearer ${'0'.repeat(64)}` })
    try {
      const refused = await forged.ask({ jsonrpc: '2.0', id: 4, method: 'tools/list' })
      const error = refused['error'] as { code: number; message: string } | undefined
      expect(error?.message).toContain('401')
      expect(refused['result']).toBeUndefined()
    } finally {
      forged.close()
    }
  })

  it('answers a down endpoint with an error naming why, and stays up for the next call', async () => {
    // A port that was open a moment ago and is closed now: a real refusal.
    const closed = await new Promise<number>((resolvePort, rejectPort) => {
      const probe = createServer()
      probe.once('error', rejectPort)
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address()
        const port = typeof address === 'object' && address !== null ? address.port : 0
        probe.close(() => {
          resolvePort(port)
        })
      })
    })
    const bridge = startBridge(`http://127.0.0.1:${String(closed)}/mcp`, {})
    try {
      const first = await bridge.ask({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      expect((first['error'] as { message: string }).message).toContain('ECONNREFUSED')
      const second = await bridge.ask({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
      expect((second['error'] as { message: string }).message).toContain('ECONNREFUSED')
    } finally {
      bridge.close()
    }
  })
})
