import { mcpSecretReferences } from '../../../src/core/vault/mcpReferences'
import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  mcpVaultRoutes,
  moveMcpSecretToVault,
  type McpVaultRoutePorts,
} from '../../../src/core/vault/mcpSecrets'
import type { McpStdioLaunch } from '../../../src/core/backends/modelapi/mcp/servers'
import type { VaultUse } from '../../../src/shared/vault'
import { UI_TEXT } from '../../../src/shared/constants'

function inertRemote(): Promise<Response> {
  return Promise.resolve(Response.json({ ok: true }))
}

function fixture() {
  const args = ['--mode', 'safe']
  const launch: McpStdioLaunch = {
    transport: 'stdio',
    command: 'server',
    args,
    cwd: undefined,
    framing: 'auto',
    env: { API_TOKEN: '${secret:server-one}', OTHER: 'ordinary' },
  }
  const kill = vi.fn(() => Promise.resolve())
  const child = {
    write: vi.fn(),
    endInput: vi.fn(),
    onStdout: vi.fn(),
    onStderr: vi.fn(),
    onExit: vi.fn(),
    kill,
  }
  const ports: McpVaultRoutePorts = {
    resolveCommand: vi.fn<McpVaultRoutePorts['resolveCommand']>((input, cwd) =>
      Promise.resolve({ executable: '/usr/bin/server', argv: [...input.args], cwd }),
    ),
    start: vi.fn(() => Promise.resolve(child)),
    remote: vi.fn(() => Promise.resolve(Response.json({ ok: true }))),
  }
  return { launch, args, child, kill, ports, routes: mcpVaultRoutes(ports) }
}

describe('M109 O command-bound references', () => {
  it('refuses cancellation that arrives while resolving paths, before feeder admission', async () => {
    const f = fixture()
    let isCancelled = false
    vi.mocked(f.ports.resolveCommand).mockImplementationOnce((launch, cwd) => {
      isCancelled = true
      return Promise.resolve({ executable: '/usr/bin/server', argv: [...launch.args], cwd })
    })
    await expect(
      f.routes.startStdio('one', f.launch, '/workspace', () => isCancelled),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect(f.ports.start).not.toHaveBeenCalled()
  })

  it('passes only selected handles and resolved command identity to feeder; no raw secret in host', async () => {
    const f = fixture()
    expect(await f.routes.startStdio('one', f.launch, '/workspace', () => false)).toBe(f.child)
    expect(f.ports.start).toHaveBeenCalledWith(
      expect.objectContaining({
        server: 'one',
        secrets: new Map([['API_TOKEN', 'secret://server-one']]),
        use: {
          kind: 'mcp',
          server: 'one',
          command: { executable: '/usr/bin/server', argv: ['--mode', 'safe'], cwd: '/workspace' },
          names: ['API_TOKEN'],
        },
      }),
    )
  })

  it.each(['command', 'args', 'cwd', 'env', 'name'])(
    'refuses handle/reference in unsafe %s field',
    async (field) => {
      const f = fixture()
      const unsafe = {
        ...f.launch,
        ...(field === 'command' && { command: '${secret:server-one}' }),
        ...(field === 'args' && { args: ['secret://server-one'] }),
        ...(field === 'cwd' && { cwd: '${secret:server-one}' }),
        ...(field === 'env' && { env: { API_TOKEN: 'prefix ${secret:server-one}' } }),
        ...(field === 'name' && { env: { 'BAD-NAME': '${secret:server-one}' } }),
      }
      await expect(f.routes.startStdio('one', unsafe, '/workspace', () => false)).rejects.toThrow(
        UI_TEXT.vault.noAccess,
      )
      expect(f.ports.start).not.toHaveBeenCalled()
    },
  )

  it('takes a snapshot before path resolution; argv substitution fails closed', async () => {
    const f = fixture()
    vi.mocked(f.ports.resolveCommand).mockImplementationOnce((launch, cwd) => {
      f.args.push('changed')
      return Promise.resolve({
        executable: '/usr/bin/server',
        argv: [...launch.args, 'changed'],
        cwd,
      })
    })
    await expect(f.routes.startStdio('one', f.launch, '/workspace', () => false)).rejects.toThrow(
      UI_TEXT.vault.noAccess,
    )
    expect(f.ports.start).not.toHaveBeenCalled()
  })

  it('accepts Windows absolute command/cwd without conflating argument identity', async () => {
    const f = fixture()
    vi.mocked(f.ports.resolveCommand).mockResolvedValue({
      executable: String.raw`C:\tools\server.exe`,
      argv: [...f.launch.args],
      cwd: String.raw`C:\workspace`,
    })
    await f.routes.startStdio('one', f.launch, String.raw`C:\workspace`, () => false)
    expect(f.ports.start).toHaveBeenCalledWith(
      expect.objectContaining({
        use: expect.objectContaining({
          command: expect.objectContaining({ executable: String.raw`C:\tools\server.exe` }),
        }),
      }),
    )
  })

  it('cancels before resolution/start and kills a child admitted after cancellation', async () => {
    const f = fixture()
    await expect(f.routes.startStdio('one', f.launch, '/workspace', () => true)).rejects.toThrow(
      UI_TEXT.vault.noAccess,
    )
    expect(f.ports.resolveCommand).not.toHaveBeenCalled()
    let isCancelled = false
    vi.mocked(f.ports.start).mockImplementationOnce(() => {
      isCancelled = true
      return Promise.resolve(f.child)
    })
    await expect(
      f.routes.startStdio('one', f.launch, '/workspace', () => isCancelled),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect(f.kill).toHaveBeenCalledOnce()
  })
})

describe('M109 O origin-bound headers', () => {
  it('refuses routing/proxy credentials and ambiguous OAuth plus secret headers', () => {
    const f = fixture()
    for (const name of [
      'Host',
      'Proxy-Authorization',
      'Connection',
      'Content-Length',
      'Transfer-Encoding',
      'Upgrade',
      'TE',
      'Trailer',
    ]) {
      expect(() =>
        f.routes.fetchFor('one', 'https://mcp.example.test/mcp', {
          [name]: '${secret:server-one}',
        }),
      ).toThrow(UI_TEXT.vault.noAccess)
    }
    f.ports.oauth = () => inertRemote
    expect(() =>
      f.routes.fetchFor('one', 'https://mcp.example.test/mcp', { Token: '${secret:server-one}' }),
    ).toThrow(UI_TEXT.vault.noAccess)
  })

  it('sanitizes failures from trusted header transport', async () => {
    const f = fixture()
    const value = randomBytes(32).toString('base64url')
    vi.mocked(f.ports.remote).mockRejectedValueOnce(new Error(value))
    const headers = { Token: '${secret:server-one}' }
    const fetcher = f.routes.fetchFor('one', 'https://mcp.example.test/mcp', headers)!
    await expect(
      fetcher('https://mcp.example.test/mcp', { redirect: 'error', headers }),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
  })
  const url = 'https://mcp.example.test/mcp'
  const headers = {
    Authorization: 'Bearer ${secret:server-one}',
    'X-Token': '${secret:header-two}',
  }
  it('routes each header use by origin; transport receives handles only', async () => {
    const f = fixture()
    const fetcher = f.routes.fetchFor('one', url, headers)!
    await fetcher(url, { method: 'POST', redirect: 'error', headers })
    expect(f.ports.remote).toHaveBeenCalledWith(
      expect.objectContaining({
        server: 'one',
        url,
        uses: [
          {
            handle: 'secret://server-one',
            use: {
              kind: 'header',
              origin: 'https://mcp.example.test',
              headerName: 'Authorization',
            },
            bearer: true,
          },
          {
            handle: 'secret://header-two',
            use: { kind: 'header', origin: 'https://mcp.example.test', headerName: 'X-Token' },
            bearer: false,
          },
        ],
      }),
    )
    const request = vi.mocked(f.ports.remote).mock.calls[0]![0]
    expect(new Headers(request.init.headers).has('Authorization')).toBe(false)
    expect(new Headers(request.init.headers).has('X-Token')).toBe(false)
  })

  it.each(['origin', 'path', 'redirect', 'substitution', 'requestObject'])(
    'refuses %s before credential release',
    async (fault) => {
      const f = fixture()
      const fetcher = f.routes.fetchFor('one', url, headers)!
      let target = url
      if (fault === 'origin') target = 'https://other.test/mcp'
      else if (fault === 'path') target = `${url}/other`
      await expect(
        fetcher(fault === 'requestObject' ? new Request(target) : target, {
          redirect: fault === 'redirect' ? 'follow' : 'error',
          headers:
            fault === 'substitution'
              ? { ...headers, Authorization: '${secret:other-server}' }
              : headers,
        }),
      ).rejects.toThrow(UI_TEXT.vault.noAccess)
      expect(f.ports.remote).not.toHaveBeenCalled()
    },
  )

  it('refuses duplicate header aliases, plaintext downgrade and malformed references', () => {
    const f = fixture()
    for (const bad of [
      { ...headers, authorization: '${secret:other}' },
      { Authorization: '${secret:UPPER}' },
      { 'Bad Header': '${secret:server-one}' },
    ])
      expect(() => f.routes.fetchFor('one', url, bad)).toThrow(UI_TEXT.vault.noAccess)
    expect(() => f.routes.fetchFor('one', url.replace('https:', 'http:'), headers)).toThrow(
      UI_TEXT.vault.noAccess,
    )
    expect(() =>
      mcpSecretReferences({
        transport: 'streamable-http',
        url: 'https://x.test/${secret:server-one}',
        headers: {},
      }),
    ).toThrow(UI_TEXT.vault.noAccess)
    expect(f.routes.fetchFor('one', `https://local.test/mcp`, {})).toBeUndefined()
  })
})

describe('M109 O Move to vault review', () => {
  it('holds the selected name and key before awaiting live resolution', async () => {
    const use: VaultUse = {
      kind: 'header',
      origin: 'https://mcp.example.test',
      headerName: 'Token',
    }
    const mutable: Parameters<typeof moveMcpSecretToVault>[1] = {
      server: 'one',
      field: 'headers',
      key: 'Token',
      name: 'one',
      use,
    }
    const importSecret = vi.fn(() => Promise.resolve())
    const edit = await moveMcpSecretToVault(
      JSON.stringify({
        mcpServers: { one: { url: 'https://mcp.example.test/mcp', headers: { Token: 'literal' } } },
      }),
      mutable,
      {
        importSecret,
        resolveUse: () => {
          mutable.name = 'changed'
          return Promise.resolve(use)
        },
      },
    )
    expect(importSecret).toHaveBeenCalledWith('one', expect.any(Uint8Array), use)
    expect(edit.proposed).toContain('${secret:one}')
    expect(edit.handle).toBe('secret://one')
  })

  it('rejects a migration digest that differs from resolved live entry', async () => {
    const use: VaultUse = {
      kind: 'mcp',
      server: 'one',
      command: { executable: '/usr/bin/server', argv: [], cwd: '/workspace' },
      names: ['TOKEN'],
    }
    const importSecret = vi.fn(() => Promise.resolve())
    await expect(
      moveMcpSecretToVault(
        JSON.stringify({ mcpServers: { one: { command: 'server', env: { TOKEN: 'literal' } } } }),
        { server: 'one', field: 'env', key: 'TOKEN', name: 'one', use },
        {
          importSecret,
          resolveUse: () => Promise.resolve({ ...use, command: { ...use.command, cwd: '/other' } }),
        },
      ),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect(importSecret).not.toHaveBeenCalled()
  })

  it.each(['env', 'headers'] as const)(
    'imports and verifies selected %s literal; returns review edit, preserving unrelated config',
    async (field) => {
      const secret = randomBytes(32).toString('base64url')
      const use: VaultUse =
        field === 'env'
          ? {
              kind: 'mcp',
              server: 'one',
              command: { executable: '/usr/bin/server', argv: [], cwd: '/workspace' },
              names: ['API_TOKEN'],
            }
          : { kind: 'header', origin: 'https://mcp.example.test', headerName: 'API_TOKEN' }
      const source = JSON.stringify({
        mcpServers: {
          one: {
            command: 'server',
            url: 'https://mcp.example.test/mcp',
            [field]: { API_TOKEN: secret, OTHER: 'retain' },
          },
          other: { command: 'other' },
        },
        unrelated: true,
      })
      let owned: Uint8Array | undefined
      const importSecret = vi.fn((name: string, bytes: Uint8Array, target: VaultUse) => {
        expect(name).toBe('server-one')
        expect(new TextDecoder().decode(bytes)).toBe(secret)
        expect(target).toEqual(use)
        owned = bytes
        return Promise.resolve()
      })
      const edit = await moveMcpSecretToVault(
        source,
        { server: 'one', field, key: 'API_TOKEN', name: 'server-one', use },
        { importSecret, resolveUse: () => Promise.resolve(use) },
      )
      expect(edit.sourceDigest).toBe(createHash('sha256').update(source).digest('hex'))
      expect(edit.proposed).not.toContain(secret)
      expect(edit.proposed).toContain('${secret:server-one}')
      expect(edit.proposed).toContain('retain')
      expect(edit.proposed).toContain('unrelated')
      expect(owned?.every((byte) => byte === 0)).toBe(true)
      expect(edit.handle).toBe('secret://server-one')
    },
  )

  it('never edits settings when encrypted import fails, and erases imported bytes on failure', async () => {
    const value = randomBytes(32).toString('base64url')
    const source = JSON.stringify({
      mcpServers: { one: { headers: { Token: value }, url: 'https://mcp.example.test/mcp' } },
    })
    let bytes: Uint8Array | undefined
    const use: VaultUse = {
      kind: 'header',
      origin: 'https://mcp.example.test',
      headerName: 'Token',
    }
    const importSecret = vi.fn((_name: string, input: Uint8Array) => {
      bytes = input
      return Promise.reject(new Error('encrypted import failed'))
    })
    await expect(
      moveMcpSecretToVault(
        source,
        { server: 'one', field: 'headers', key: 'Token', name: 'one', use },
        { importSecret, resolveUse: () => Promise.resolve(use) },
      ),
    ).rejects.toThrow()
    expect(bytes?.every((byte) => byte === 0)).toBe(true)
    expect(source).toContain(value)
  })

  it.each(['alias', 'reference', 'wrongOrigin', 'wrongServer'])(
    'refuses unsafe migration selection: %s',
    async (fault) => {
      const use: VaultUse =
        fault === 'wrongServer'
          ? {
              kind: 'mcp',
              server: 'other',
              command: { executable: '/server', argv: [], cwd: '/workspace' },
              names: ['Token'],
            }
          : {
              kind: 'header',
              origin: fault === 'wrongOrigin' ? 'https://other.test' : 'https://mcp.example.test',
              headerName: 'Token',
            }
      const source = JSON.stringify({
        mcpServers: {
          one: {
            env: { Token: 'literal' },
            headers: { Token: fault === 'reference' ? '${TOKEN}' : 'literal' },
            url: 'https://mcp.example.test/mcp',
          },
        },
        ...(fault === 'alias' && { mcp_servers: {} }),
      })
      const importSecret = vi.fn(() => Promise.resolve())
      await expect(
        moveMcpSecretToVault(
          source,
          {
            server: 'one',
            field: fault === 'wrongServer' ? 'env' : 'headers',
            key: 'Token',
            name: 'one',
            use,
          },
          { importSecret, resolveUse: () => Promise.resolve(use) },
        ),
      ).rejects.toThrow()
      expect(importSecret).not.toHaveBeenCalled()
    },
  )
})
