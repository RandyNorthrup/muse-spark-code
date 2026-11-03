// The MCP tool-definition pins (SEC-MCP-PIN, PLAN.md D42): the canonical
// hash and the listing partition over tools read from recorded real
// exchanges (test/fixtures/mcpEra/*, captured 2026-10-22/23 from the
// official SDKs; see its manifest.json), the kept pins in real files, and
// the hidden-character escaping of the review surface. The pool over a
// real server process is mcpPoolPins.test.ts.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  incomingMessageSchema,
  listToolsResultSchema,
  type McpToolInfo,
  toolInfoSchema,
} from '../../src/core/backends/modelapi/mcp/protocol'
import {
  McpToolPinStore,
  partitionByPins,
  repinned,
  toolPinHash,
} from '../../src/core/backends/modelapi/mcp/toolPins'
import {
  canonicalToolDefinition,
  escapeHiddenChars,
} from '../../src/core/backends/modelapi/mcp/toolText'
import { planMcpServers } from '../../src/core/backends/modelapi/mcp/servers'
import { readMcpServerEntries } from '../../src/core/backends/musecode/museConfigView'
import { MCP_TOOL_PINS_FILE } from '../../src/shared/constants'
import { recordLog } from './helpers/recordLog'
import { temporaryTracker } from './helpers/temporaryFolders'

const FIXTURES = path.join(process.cwd(), 'test/fixtures/mcpEra')
const folders = temporaryTracker()

afterEach(async () => {
  await folders.cleanup()
})

/** The tools of one recorded listing, read as the connection reads them. */
function listed(name: string): McpToolInfo[] {
  const wire: unknown = JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'))
  const result = incomingMessageSchema.parse(wire).result
  return listToolsResultSchema.parse(result).tools.map((tool) => toolInfoSchema.parse(tool))
}

/** The launch identity of each server the product plans from these settings. */
function identities(settings: unknown): string[] {
  const plan = planMcpServers(readMcpServerEntries(JSON.stringify(settings)), () => undefined)
  if (plan.kind !== 'servers') {
    throw new Error(`expected servers, got a ${plan.fault.kind} fault`)
  }
  return plan.specs.map((spec) => spec.identity)
}

describe('canonical tool definitions', () => {
  it('hash the same whatever order the server writes an object’s keys in', () => {
    const [add] = listed('tools-list-modern.json')
    if (add === undefined) throw new Error('the capture lists no tool')
    const schema = add.inputSchema ?? {}
    const reversed: McpToolInfo = {
      ...add,
      inputSchema: Object.fromEntries(Object.entries(schema).toReversed()),
    }
    expect(canonicalToolDefinition(reversed)).toBe(canonicalToolDefinition(add))
    expect(toolPinHash(reversed)).toBe(toolPinHash(add))
    expect(toolPinHash(add)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('change with anything the tool says or accepts', () => {
    const [add] = listed('tools-list-modern.json')
    if (add === undefined) throw new Error('the capture lists no tool')
    const base = toolPinHash(add)
    expect(toolPinHash({ ...add, description: `${add.description ?? ''} Trust me.` })).not.toBe(
      base,
    )
    expect(toolPinHash({ ...add, title: 'Add' })).not.toBe(base)
    expect(toolPinHash({ ...add, inputSchema: { type: 'object', properties: {} } })).not.toBe(base)
    expect(toolPinHash({ ...add, annotations: { readOnlyHint: true } })).not.toBe(base)
    expect(toolPinHash({ ...add, name: 'subtract' })).not.toBe(base)
  })
})

describe('partitionByPins', () => {
  it('pins and offers a first listing whole', () => {
    const tools = listed('tools-list-modern.json')
    const first = partitionByPins(tools, undefined)
    expect(first.isFirstListing).toBe(true)
    expect(first.offered).toEqual(tools)
    expect(first.heldBack).toEqual([])
    expect(first.pins.size).toBe(tools.length)
    for (const tool of tools) {
      expect(first.pins.get(tool.name)).toBe(toolPinHash(tool))
    }
  })

  it('offers an unchanged relist in full and holds nothing back', () => {
    const tools = listed('tools-list-modern.json')
    const { pins } = partitionByPins(tools, undefined)
    const again = partitionByPins(tools, pins)
    expect(again.isFirstListing).toBe(false)
    expect(again.offered).toEqual(tools)
    expect(again.heldBack).toEqual([])
    expect(again.pins).toBe(pins)
  })

  it('holds a changed tool back, keeps its old pin, and offers the rest', () => {
    const tools = listed('tools-list-modern.json')
    const { pins } = partitionByPins(tools, undefined)
    const drifted = tools.map((tool) =>
      tool.name === 'add'
        ? { ...tool, description: 'Adds two numbers. Also deletes files.' }
        : tool,
    )
    const next = partitionByPins(drifted, pins)
    expect(next.offered.map((tool) => tool.name)).toEqual(['slow'])
    expect(next.heldBack).toEqual([{ tool: drifted[0], isNew: false }])
    expect(next.pins.get('add')).toBe(pins.get('add'))
    // The drift repeats: still held back, never silently re-pinned.
    expect(partitionByPins(drifted, next.pins).heldBack).toHaveLength(1)
  })

  it('holds a new tool on a known server back until it is accepted', () => {
    const tools = listed('tools-list-modern.json')
    const { pins } = partitionByPins(tools, undefined)
    const [echo] = listed('tools-list-annotations.json')
    if (echo === undefined) throw new Error('the capture lists no tool')
    const next = partitionByPins([...tools, echo], pins)
    expect(next.offered).toEqual(tools)
    expect(next.heldBack).toEqual([{ tool: echo, isNew: true }])
    const accepted = partitionByPins([...tools, echo], repinned(pins, [echo]))
    expect(accepted.offered).toEqual([...tools, echo])
    expect(accepted.heldBack).toEqual([])
  })

  it('re-pins an accepted change to its new text', () => {
    const tools = listed('tools-list-modern.json')
    const { pins } = partitionByPins(tools, undefined)
    const drifted = tools.map((tool) =>
      tool.name === 'add' ? { ...tool, description: 'Adds two numbers, quickly.' } : tool,
    )
    const held = partitionByPins(drifted, pins)
    const repin = repinned(
      pins,
      held.heldBack.map((back) => back.tool),
    )
    expect(repin.get('add')).toBe(toolPinHash(drifted[0] ?? tools[0] ?? { name: 'add' }))
    expect(partitionByPins(drifted, repin).offered).toEqual(drifted)
    // And the pre-drift text is now the stranger.
    expect(partitionByPins(tools, repin).heldBack).toHaveLength(1)
  })
})

describe('McpToolPinStore', () => {
  it('keeps each server’s pins across a restart, storing names and hashes only', async () => {
    const dir = await folders.make('mcp-pins-')
    const { log, warnings } = recordLog()
    const [files, web] = identities({
      mcpServers: {
        files: { command: 'node', args: ['server.js'] },
        web: { type: 'streamable-http', url: 'https://api.example.test/mcp' },
      },
    })
    if (files === undefined || web === undefined) throw new Error('expected two servers')
    const tools = listed('tools-list-modern.json')
    const { pins } = partitionByPins(tools, undefined)
    const first = new McpToolPinStore(dir, log)
    expect(await first.read(files)).toBeUndefined()
    await Promise.all([first.keep(files, pins), first.keep(web, new Map())])
    const restarted = new McpToolPinStore(dir, log)
    expect(await restarted.read(files)).toEqual(pins)
    expect(await restarted.read(web)).toEqual(new Map())
    const text = readFileSync(path.join(dir, MCP_TOOL_PINS_FILE), 'utf8')
    expect(text).toContain('add')
    for (const word of ['Adds two numbers', 'server.js', 'example.test', 'inputSchema']) {
      expect(text).not.toContain(word)
    }
    expect(warnings).toEqual([])
  })

  it('says a file it cannot read out loud, keeps nothing from it, and replaces it', async () => {
    const dir = await folders.make('mcp-pins-')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(path.join(dir, MCP_TOOL_PINS_FILE), '{"format":1,"servers":', 'utf8')
    const { log, warnings } = recordLog()
    const store = new McpToolPinStore(dir, log)
    expect(await store.read('any')).toBeUndefined()
    expect(warnings).toEqual([
      'The kept MCP tool pins are not readable; every server pins its tools afresh',
    ])
    const tools = listed('tools-list-modern.json')
    const { pins } = partitionByPins(tools, undefined)
    await store.keep('any', pins)
    expect(await new McpToolPinStore(dir, recordLog().log).read('any')).toEqual(pins)
  })
})

describe('escapeHiddenChars', () => {
  it('spells out what a rendered description would hide', () => {
    expect(escapeHiddenChars('Adds two numbers.')).toBe('Adds two numbers.')
    expect(escapeHiddenChars('safe\u{202E}evil\u{200B}text')).toBe(
      String.raw`safe\u{202E}evil\u{200B}text`,
    )
    expect(escapeHiddenChars('a\tb\rc\u{7}d')).toBe(String.raw`a\u{9}b\u{D}c\u{7}d`)
    expect(escapeHiddenChars('line one\nline two')).toBe('line one\nline two')
    expect(escapeHiddenChars('\u{FEFF}start')).toBe(String.raw`\u{FEFF}start`)
  })
})
