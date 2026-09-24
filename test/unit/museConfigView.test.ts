import { describe, expect, it } from 'vitest'
import { readHookSources, readMcpServers } from '../../src/core/backends/musecode/museConfigView'

const settings = (value: unknown) => JSON.stringify(value)

describe('readMcpServers', () => {
  it('reads the migrate skill’s camelCase shape, secrets reduced to names', () => {
    const view = readMcpServers(
      settings({
        schema_version: 1,
        mcpServers: {
          github: {
            type: 'stdio',
            command: String.raw`C:\Tools\npx.cmd`,
            args: ['-y', 'x'],
            env: { GITHUB_TOKEN: 'ghp_secret' },
            mode: 'optional',
          },
          docs: {
            type: 'streamable-http',
            url: 'https://user:pw@example.com:8443/mcp?token=abc',
            headers: { Authorization: 'Bearer secret' },
          },
        },
      }),
    )
    expect(view).toEqual({
      status: 'read',
      hasKeyConflict: false,
      isLegacy: false,
      servers: [
        {
          name: 'github',
          transport: 'stdio',
          target: 'npx.cmd',
          mode: 'optional',
          isEnabled: true,
          envNames: ['GITHUB_TOKEN'],
          headerNames: [],
          hasModeConflict: false,
        },
        {
          name: 'docs',
          transport: 'streamable-http',
          target: 'https://example.com:8443',
          mode: 'required',
          isEnabled: true,
          envNames: [],
          headerNames: ['Authorization'],
          hasModeConflict: false,
        },
      ],
    })
    expect(JSON.stringify(view)).not.toMatch(/secret|pw@|token=/)
  })

  it('reads the documented legacy shape and every transport spelling', () => {
    const view = readMcpServers(
      settings({
        mcp_servers: {
          a: { transport: 'streamable_http', url: 'http://localhost:9000/mcp', enabled: false },
          b: { transport: 'stdio', command: ['python3', '/srv/mcp/server.py'] },
          c: { url: 'https://c.example/mcp' },
          d: { command: '/usr/local/bin/tool' },
          e: { type: 'http', url: 'not a url' },
          f: { type: 'sse', command: '' },
          g: { type: 'stdio', command: [] },
          skipped: 'not an object',
        },
      }),
    )
    expect(view.status === 'read' && view.isLegacy).toBe(true)
    const servers = view.status === 'read' ? view.servers : []
    expect(
      servers.map((server) => [server.name, server.transport, server.target, server.isEnabled]),
    ).toEqual([
      ['a', 'streamable-http', 'http://localhost:9000', false],
      ['b', 'stdio', 'python3', true],
      ['c', 'streamable-http', 'https://c.example', true],
      ['d', 'stdio', 'tool', true],
      ['e', 'streamable-http', 'an invalid URL', true],
      ['f', 'sse', 'no command', true],
      ['g', 'stdio', 'no command', true],
    ])
  })

  it('reports the faults that make Muse Code load no server', () => {
    const both = readMcpServers(settings({ mcpServers: { a: { command: 'x' } }, mcp_servers: {} }))
    expect(both.status === 'read' && both.hasKeyConflict).toBe(true)
    const modes = readMcpServers(
      settings({ mcpServers: { a: { command: 'x', required: false, mode: 'optional' } } }),
    )
    expect(modes.status === 'read' && modes.servers[0]?.hasModeConflict).toBe(true)
    // `required: false` alone leaves the default: required.
    const alone = readMcpServers(settings({ mcpServers: { a: { command: 'x', required: false } } }))
    expect(alone.status === 'read' && alone.servers[0]?.mode).toBe('required')
  })

  it('tells a missing file from an unreadable one and from an empty list', () => {
    expect(readMcpServers(undefined)).toEqual({ status: 'missing' })
    expect(readMcpServers('{ nope').status).toBe('unreadable')
    expect(readMcpServers('[1, 2]')).toEqual({
      status: 'unreadable',
      reason: 'the file does not hold a JSON object',
    })
    expect(readMcpServers(settings({ schema_version: 1 }))).toEqual({
      status: 'read',
      servers: [],
      hasKeyConflict: false,
      isLegacy: false,
    })
  })
})

describe('readHookSources', () => {
  it('counts the settings’ own hooks and names the managed file', () => {
    expect(
      readHookSources(settings({ hooks: [{}, {}], managed_hooks_path: '/etc/muse/hooks.json' })),
    ).toEqual({ userHookCount: 2, managedHooksPath: '/etc/muse/hooks.json' })
    expect(readHookSources(settings({ hooks: { PreToolUse: [], Stop: [] } }))).toEqual({
      userHookCount: 2,
      managedHooksPath: undefined,
    })
    expect(readHookSources(settings({ hooks: 'x', managed_hooks_path: '' }))).toEqual({
      userHookCount: undefined,
      managedHooksPath: undefined,
    })
  })

  it('shows nothing from a missing or unreadable file', () => {
    const none = { userHookCount: undefined, managedHooksPath: undefined }
    expect(readHookSources(undefined)).toEqual(none)
    expect(readHookSources('not json')).toEqual(none)
  })
})
