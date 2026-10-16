import { describe, expect, it } from 'vitest'
import { planMcpServers, type McpServerSpec } from '../../src/core/backends/modelapi/mcp/servers'
import { readMcpServerEntries } from '../../src/core/backends/musecode/museConfigView'

const ENV: Readonly<Record<string, string>> = { TOKEN: 's3cret', HOME_DIR: '/home/u' }
const lookup = (name: string) => ENV[name]

function specs(settings: unknown): readonly McpServerSpec[] {
  const plan = planMcpServers(readMcpServerEntries(JSON.stringify(settings)), lookup)
  if (plan.kind !== 'servers') {
    throw new Error(`expected servers, got a ${plan.fault.kind} fault`)
  }
  return plan.specs
}

function only(entry: Record<string, unknown>): McpServerSpec {
  const [spec] = specs({ mcpServers: { s: entry } })
  if (spec === undefined) {
    throw new Error('expected one server')
  }
  return spec
}

function reason(entry: Record<string, unknown>): string | undefined {
  const { launch } = only(entry)
  return launch.ok ? undefined : launch.reason
}

function plan(text: string | undefined) {
  return planMcpServers(readMcpServerEntries(text), lookup)
}

describe('planMcpServers (M50)', () => {
  it('starts a stdio server as Muse Code would, ${VAR} expanded from the environment', () => {
    const spec = only({
      command: 'npx',
      args: ['-y', 'server', '--root=${HOME_DIR}'],
      env: { GITHUB_TOKEN: '${TOKEN}', PLAIN: 'x' },
      cwd: 'tools',
      framing: 'content_length',
      mode: 'optional',
      startup_timeout_sec: 5,
      tool_timeout_sec: 99_999,
      enabled_tools: ['a', 'b'],
      disabled_tools: ['b'],
    })
    expect(spec.launch).toEqual({
      ok: true,
      value: {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'server', '--root=/home/u'],
        env: { GITHUB_TOKEN: 's3cret', PLAIN: 'x' },
        cwd: 'tools',
        framing: 'content_length',
      },
    })
    expect(spec.isRequired).toBe(false)
    expect(spec.startupTimeoutMs).toBe(5000)
    // A named value past the old hour cap is honoured whole (NOLIMITS2 A18):
    // only the entry's own number bounds the wait.
    expect(spec.toolTimeoutMs).toBe(99_999_000)
    expect([...(spec.enabledTools ?? [])]).toEqual(['a', 'b'])
    expect([...spec.disabledTools]).toEqual(['b'])
  })

  it('starts a remote server with its headers, and takes the defaults', () => {
    const spec = only({
      type: 'streamable-http',
      url: 'https://mcp.example.test/mcp',
      headers: { Authorization: 'Bearer ${TOKEN}' },
    })
    expect(spec.launch).toEqual({
      ok: true,
      value: {
        transport: 'streamable-http',
        url: 'https://mcp.example.test/mcp',
        headers: { Authorization: 'Bearer s3cret' },
      },
    })
    expect(spec.isRequired).toBe(true)
    expect(spec.isEnabled).toBe(true)
    // No named timeout: the server is waited on until it answers or is
    // stopped (NOLIMITS2 A18), never killed at an invented default.
    expect(spec.startupTimeoutMs).toBeUndefined()
    expect(spec.toolTimeoutMs).toBeUndefined()
    expect(spec.enabledTools).toBeUndefined()
    expect(spec.disabledTools.size).toBe(0)
  })

  it('names an unset variable, never a value', () => {
    expect(reason({ command: 'srv', env: { KEY: '${MISSING}' } })).toBe(
      'the environment variable MISSING is not set',
    )
  })

  it('refuses the entries Muse Code refuses, each with its reason', () => {
    expect(reason({ command: 'srv', url: 'https://x.test' })).toBe(
      'a streamable-http server must not set command',
    )
    expect(reason({ type: 'stdio', command: 'srv', url: 'https://x.test' })).toBe(
      'a stdio server must not set url',
    )
    expect(reason({ type: 'http', url: 'https://x.test', args: [], framing: 'auto' })).toBe(
      'a streamable-http server must not set args, framing',
    )
    expect(reason({ type: 'sse', url: 'https://x.test' })).toBe(
      'the transport sse is not supported; use stdio or streamable_http',
    )
    expect(reason({ command: '  ' })).toBe('it has no command')
    expect(reason({ command: 42 })).toBe('"command" must be a string')
    expect(reason({ command: 'srv', args: 'a b' })).toBe('"args" must be a list of strings')
    expect(reason({ command: 'srv', args: [1] })).toBe('"args" must be a list of strings')
    expect(reason({ command: 'srv', env: [] })).toBe('"env" must be an object of strings')
    expect(reason({ command: 'srv', env: { A: 1 } })).toBe('"env" must be an object of strings')
    expect(reason({ command: 'srv', framing: 'xml' })).toBe(
      '"framing" must be one of auto, content_length, line_delimited_json',
    )
    expect(reason({ command: 'srv', startup_timeout_sec: -1 })).toBe(
      '"startup_timeout_sec" must be a positive number of seconds',
    )
    expect(reason({ type: 'streamable-http' })).toBe('it has no url')
    expect(reason({ type: 'streamable-http', url: 'not a url' })).toBe('its url is not a URL')
    expect(reason({ type: 'streamable-http', url: 'ftp://x.test' })).toBe(
      'its url must start with http:// or https://',
    )
    expect(only({ command: 'srv' }).startupTimeoutMs).toBeUndefined()
    expect(only({ command: 'srv' }).toolTimeoutMs).toBeUndefined()
  })

  it('leaves the name ide to the extension, and a server turned off stays off', () => {
    const [ide, alias, off] = specs({
      mcpServers: {
        ide: { command: 'srv' },
        _ide: { command: 'srv' },
        off: { command: 'srv', enabled: false },
      },
    })
    expect(ide?.launch).toEqual({
      ok: false,
      reason: "the name ide is the extension's own diagnostics server; rename this entry",
    })
    expect(alias?.launch).toEqual(ide?.launch)
    expect(off?.isEnabled).toBe(false)
  })

  it('loads none of the file when Muse Code would load none, and says why', () => {
    expect(plan(undefined)).toEqual({ kind: 'servers', specs: [] })
    expect(plan('{ nope')).toEqual({
      kind: 'fault',
      fault: { kind: 'unreadable', reason: expect.any(String) as string },
    })
    expect(plan(JSON.stringify({ mcpServers: {}, mcp_servers: {} }))).toEqual({
      kind: 'fault',
      fault: { kind: 'keys' },
    })
    expect(
      plan(
        JSON.stringify({
          mcp_servers: {
            a: { command: 'x', required: true, mode: 'optional' },
            b: { command: 'y' },
          },
        }),
      ),
    ).toEqual({ kind: 'fault', fault: { kind: 'mode', servers: ['a'] } })
  })
})
