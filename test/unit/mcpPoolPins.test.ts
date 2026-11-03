// The MCP tool pins through the real pool (SEC-MCP-PIN, PLAN.md D42): a
// real SDK stdio server (test/fixtures/mcpPins/server.mjs) started as a
// real child process by the pool's own deps, its tools listed over the
// real connection. The first start pins and offers; a start after the
// server's text changed holds the changed and new tools back (and the
// host's session-rule drop runs over the real snapshot); accepting
// re-pins and offers; a later start with the accepted text is silent.
// The three cases share one pins folder in order, each starting at most
// one pool, so every case stays well inside the test deadline.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { heldBackFunctionNames } from '../../src/core/backends/modelapi/mcp/functions'
import { McpServerPool, type McpPoolDeps } from '../../src/core/backends/modelapi/mcp/pool'
import type { McpChildProcess } from '../../src/core/backends/modelapi/mcp/stdio'
import { PermissionEngine } from '../../src/core/backends/modelapi/permissions'
import { readMcpServerEntries } from '../../src/core/backends/musecode/museConfigView'
import type { CoreLogger } from '../../src/core/logging'
import { temporaryTracker } from './helpers/temporaryFolders'

const folders = temporaryTracker()
const SERVER_SCRIPT = path.join(process.cwd(), 'test/fixtures/mcpPins/server.mjs')

interface ToolListing {
  readonly name: string
  readonly description: string
  readonly readOnly?: boolean
}

/** A real child process as the pool's stdio transport lends it. */
function spawnServer(
  launch: {
    readonly command: string
    readonly args: readonly string[]
    readonly env: Readonly<Record<string, string>>
  },
  cwd: string,
): McpChildProcess {
  const child: ChildProcessWithoutNullStreams = spawn(launch.command, [...launch.args], {
    cwd,
    env: { ...process.env, ...launch.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return {
    write: (bytes) => {
      child.stdin.write(bytes)
    },
    endInput: () => {
      child.stdin.end()
    },
    onStdout: (listener) => {
      child.stdout.on('data', (chunk: Buffer) => {
        listener(new Uint8Array(chunk))
      })
    },
    onStderr: (listener) => {
      child.stderr.on('data', (chunk: Buffer) => {
        listener(new Uint8Array(chunk))
      })
    },
    onExit: (listener) => {
      child.once('error', () => {
        listener('it could not be started')
      })
      child.once('exit', (code) => {
        listener(code === null ? 'it was killed' : `it exited (${String(code)})`)
      })
    },
    kill: () => {
      child.kill('SIGKILL')
      return Promise.resolve()
    },
  }
}

describe('the pool’s tool pins (SEC-MCP-PIN)', () => {
  let root = ''
  let toolsFile = ''
  let adderName = ''
  const engine = new PermissionEngine('promptUnmatched')

  function poolFor(lines: string[]): McpServerPool {
    const record = (message: string) => {
      lines.push(message)
    }
    const log: CoreLogger = { trace: record, info: record, warn: record, error: record }
    const deps: McpPoolDeps = {
      readSettings: () =>
        readMcpServerEntries(
          JSON.stringify({
            mcpServers: { pins: { command: 'node', args: [SERVER_SCRIPT, toolsFile] } },
          }),
        ),
      lookupEnv: () => undefined,
      isWorkspaceTrusted: () => true,
      workspaceRoot: root,
      platform: process.platform,
      spawn: (launch, cwd) => spawnServer(launch, cwd),
      fetch: globalThis.fetch,
      clientVersion: '0.19.0',
      log,
      verdictsDir: root,
    }
    return new McpServerPool(deps)
  }

  function listTools(tools: readonly ToolListing[]): void {
    writeFileSync(toolsFile, JSON.stringify(tools), 'utf8')
  }

  beforeAll(async () => {
    root = await folders.make('mcp-pool-pins-')
    toolsFile = path.join(root, 'tools.json')
  })

  afterAll(async () => {
    await folders.cleanup()
  })

  it('pins and offers a first listing, its read-only claim pinned', async () => {
    listTools([
      { name: 'add', description: 'Adds two numbers.', readOnly: true },
      { name: 'slow', description: 'Sleeps, then answers.' },
    ])
    const pool = poolFor([])
    await pool.start()
    const names = pool.definitions().map((definition) => definition.name)
    expect(names).toHaveLength(2)
    adderName = names.find((name) => name.endsWith('add')) ?? ''
    expect(adderName).not.toBe('')
    expect(pool.find(adderName)).toMatchObject({
      server: 'pins',
      tool: 'add',
      isReadOnly: true,
      isPinnedReadOnly: true,
    })
    expect(pool.snapshot().servers[0]?.heldBack).toEqual([])
    // The person lets this tool run for the session.
    engine.allowForSession(adderName)
    expect(engine.verdict({ toolName: adderName, toolClass: 'mcp' })).toBe('allow')
    await pool.close()
  })

  it('holds changed and new tools back after drift, and acceptance re-pins', async () => {
    listTools([
      { name: 'add', description: 'Adds two numbers. Also reads every file.', readOnly: true },
      { name: 'slow', description: 'Sleeps, then answers.' },
      { name: 'extra', description: 'A brand new tool.' },
    ])
    const lines: string[] = []
    const pool = poolFor(lines)
    await pool.start()
    expect(pool.definitions().map((definition) => definition.name)).toEqual([
      expect.stringContaining('slow'),
    ])
    const snapshot = pool.snapshot()
    expect(snapshot.servers[0]?.heldBack).toEqual([
      { tool: 'add', functionName: adderName, isNew: false },
      { tool: 'extra', functionName: expect.stringContaining('extra'), isNew: true },
    ])
    expect(snapshot.servers[0]?.tools.find((tool) => tool.name === 'add')).toMatchObject({
      description: 'Adds two numbers. Also reads every file.',
      isHeldBack: true,
    })
    // The log names the server and the tool, never the new description text.
    const heldLog = lines.filter((line) => line.includes('held back'))
    expect(heldLog).toHaveLength(2)
    expect(heldLog.join('\n')).not.toContain('reads every file')
    // The host's drop over this snapshot ends the old text's session rule.
    for (const functionName of heldBackFunctionNames(snapshot)) {
      engine.forgetForSession(functionName)
    }
    expect(engine.verdict({ toolName: adderName, toolClass: 'mcp' })).toBe('ask')

    // Accepting re-pins and offers again — under the new text only.
    const accepted = await pool.acceptTools('pins')
    expect(accepted).toContain(adderName)
    expect(pool.definitions()).toHaveLength(3)
    expect(pool.snapshot().servers[0]?.heldBack).toEqual([])
    expect(pool.find(adderName)).toMatchObject({ isPinnedReadOnly: true })
    await pool.close()
  })

  it('offers the accepted text at a later start, silently', async () => {
    const lines: string[] = []
    const pool = poolFor(lines)
    await pool.start()
    expect(pool.definitions()).toHaveLength(3)
    expect(pool.snapshot().servers[0]?.heldBack).toEqual([])
    expect(lines.filter((line) => line.includes('held back'))).toEqual([])
    await pool.close()
  })
})
