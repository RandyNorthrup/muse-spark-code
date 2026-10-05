import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { Server } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  startUsageCompanion,
  usageCompanionReplySchema,
  type UsageCompanion,
} from '../../src/runtime/usage/companionServer'
import { startUsageCompanion as entryStart } from '../../src/runtime/usage/usageCompanionEntry'
import { createUsageService } from '../../src/core/usage/usageService'
import { USAGE_COMPANION_IDLE_MS, USAGE_RECORD_MAX_BYTES } from '../../src/shared/constants'
import { usageFixtureDeps } from './helpers/usageFixture'

const servers: UsageCompanion[] = []
const directories: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(servers.splice(0).map((server) => server.close()))
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})
async function setup() {
  const folder = await mkdtemp(path.join(tmpdir(), 'm102-companion-'))
  directories.push(folder)
  const webviewDirectory = path.join(folder, 'webview')
  await mkdir(webviewDirectory)
  await writeFile(path.join(webviewDirectory, 'usage.js'), 'export const fixture = true')
  await mkdir(path.join(webviewDirectory, 'chunks'))
  await writeFile(
    path.join(webviewDirectory, 'chunks', 'chunk-test.js'),
    'export const chunk = true',
  )
  await writeFile(path.join(webviewDirectory, 'usage.css'), ':root { color: black; }')
  await writeFile(path.join(folder, 'outside.js'), 'private canary')
  await symlink(path.join(folder, 'outside.js'), path.join(webviewDirectory, 'escape.js'))
  const deps = usageFixtureDeps()
  const server = await entryStart({
    webviewDirectory,
    indexHtml:
      '<!doctype html><html><body><div id="root"></div><script type="module" src="/usage.js"></script></body></html>',
    createService: (ports) => createUsageService({ ...deps, ...ports }),
  })
  servers.push(server)
  return { server, deps, webviewDirectory }
}
function http(
  server: UsageCompanion,
  resource: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  return new Promise<{
    status: number
    headers: Record<string, string | string[] | undefined>
    body: string
  }>((resolve, reject) => {
    const req = request(
      `${server.origin}${resource}`,
      { method: options.method ?? 'GET', headers: options.headers },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )
    req.once('error', reject)
    req.end(options.body)
  })
}
function headers(server: UsageCompanion): Record<string, string> {
  return {
    authorization: `Bearer ${new URL(server.url).hash.slice(1)}`,
    origin: server.origin,
    'content-type': 'application/json',
  }
}
function rpc(server: UsageCompanion, message: unknown, extra: Record<string, string> = {}) {
  return http(server, '/rpc', {
    method: 'POST',
    headers: { ...headers(server), ...extra },
    body: JSON.stringify(message),
  })
}

async function timedCompanion(webviewDirectory: string): Promise<UsageCompanion> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const server = await startUsageCompanion({
    webviewDirectory,
    indexHtml: '<html></html>',
    createService: (ports) => createUsageService({ ...usageFixtureDeps(), ...ports }),
  })
  servers.push(server)
  return server
}

describe('usage companion security and editor parity', () => {
  it('listens only on IPv4 loopback with a random 256-bit fragment capability and policy on every reply', async () => {
    const { server } = await setup()
    expect(new URL(server.url).hostname).toBe('127.0.0.1')
    expect(new URL(server.url).hash.slice(1).length).toBe(64)
    expect(new URL(server.url).search).toBe('')
    const page = await http(server, '/')
    expect(page.status).toBe(200)
    expect(page.headers['content-security-policy']).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    )
    expect(page.headers['access-control-allow-origin']).toBeUndefined()
    expect(page.headers['referrer-policy']).toBe('no-referrer')
    expect(page.headers['x-content-type-options']).toBe('nosniff')
    expect(page.headers['cache-control']).toBe('no-store')
    expect(page.body).not.toContain(new URL(server.url).hash.slice(1))
    expect(await http(server, '/usage.js')).toHaveProperty('status', 200)
  })
  it('refuses missing, wrong and malformed capability headers', async () => {
    const { server } = await setup()
    for (const authorization of [
      '',
      'Bearer wrong',
      `Basic ${new URL(server.url).hash.slice(1)}`,
    ]) {
      const result = await rpc(server, { type: 'usage/ready' }, { authorization })
      expect(result.status).toBe(403)
      expect(result.body).toBe('')
    }
    const missing = await http(server, '/rpc', {
      method: 'POST',
      headers: { origin: server.origin, 'content-type': 'application/json' },
      body: '{"type":"usage/ready"}',
    })
    expect(missing.status).toBe(403)
  })
  it('refuses foreign or absent Origin and foreign Host even with the correct capability', async () => {
    const { server } = await setup()
    for (const extra of [
      { origin: 'https://attacker.invalid' },
      { origin: '' },
      { host: 'attacker.invalid' },
      { host: 'localhost' },
    ])
      expect(await rpc(server, { type: 'usage/ready' }, extra)).toHaveProperty('status', 403)
    const missingOrigin = headers(server)
    delete missingOrigin['origin']
    const result = await http(server, '/rpc', {
      method: 'POST',
      headers: missingOrigin,
      body: '{"type":"usage/ready"}',
    })
    expect(result.status).toBe(403)
    expect(await http(server, '/', { headers: { host: 'attacker.invalid' } })).toHaveProperty(
      'status',
      403,
    )
  })
  it('serves only packaged JS/CSS and shared chunks and refuses traversal, symlink escapes and unlisted extensions', async () => {
    const { server } = await setup()
    expect(await http(server, '/chunks/chunk-test.js')).toHaveProperty('status', 200)
    const css = await http(server, '/usage.css')
    expect(css.status).toBe(200)
    expect(css.headers['content-type']).toBe('text/css')
    for (const resource of [
      '/escape.js',
      '/%2e%2e/outside.js',
      '/outside.js',
      '/usage.js?token=x',
      '/usage.js.map',
      '/private.json',
      '/chunks/file.js',
    ]) {
      const result = await http(server, resource)
      expect([400, 404]).toContain(result.status)
      expect(result.body).not.toContain('private canary')
    }
  })
  it('validates RPC before the service and returns the same state in all surfaces', async () => {
    const { server, deps } = await setup()
    const result = await rpc(server, { type: 'usage/ready' })
    expect(result.status).toBe(200)
    const parsed: unknown = JSON.parse(result.body)
    const payload = usageCompanionReplySchema.parse(parsed)
    expect(payload.messages.map((message) => message.type)).toEqual(['usage/table', 'usage/state'])
    const service = createUsageService(deps)
    expect(payload.messages[1]).toEqual({ type: 'usage/state', state: await service.snapshot() })
    expect(
      await rpc(server, {
        type: 'usage/deleteHistory',
        requestId: 'reset',
        path: '../paid-daily',
        approved: true,
      }),
    ).toHaveProperty('status', 400)
    expect(
      await http(server, '/rpc', {
        method: 'POST',
        headers: headers(server),
        body: JSON.stringify({ type: 'usage/ready' }) + ' '.repeat(USAGE_RECORD_MAX_BYTES),
      }),
    ).toHaveProperty('status', 400)
    expect(deps.journal.deleteHistory).not.toHaveBeenCalled()
    expect(
      await http(server, '/rpc', { method: 'POST', headers: headers(server), body: 'not json' }),
    ).toHaveProperty('status', 400)
    expect(await http(server, '/rpc', { method: 'GET', headers: headers(server) })).toHaveProperty(
      'status',
      405,
    )
    expect(
      await rpc(server, { type: 'usage/ready' }, { 'content-type': 'text/plain' }),
    ).toHaveProperty('status', 400)
  })
  it('requires the authenticated browser confirmation header before reset and downloads only on export', async () => {
    const { server, deps } = await setup()
    const denied = await rpc(server, { type: 'usage/deleteHistory', requestId: 'reset' })
    const deniedJson: unknown = JSON.parse(denied.body)
    expect(usageCompanionReplySchema.parse(deniedJson).messages[0]).toEqual(
      expect.objectContaining({ outcome: 'cancelled' }),
    )
    expect(usageCompanionReplySchema.parse(deniedJson).confirmation).toMatchObject({
      count: 1,
      detail: expect.stringContaining('1 usage record'),
    })
    const stale = await rpc(
      server,
      { type: 'usage/deleteHistory', requestId: 'reset' },
      { 'x-usage-confirm-delete': 'confirmed', 'x-usage-confirm-count': '0' },
    )
    const staleJson: unknown = JSON.parse(stale.body)
    expect(usageCompanionReplySchema.parse(staleJson).messages[0]).toMatchObject({
      outcome: 'cancelled',
    })
    expect(deps.journal.deleteHistory).not.toHaveBeenCalled()
    const exported = await rpc(server, {
      type: 'usage/export',
      requestId: 'export',
      query: { range: 'today', groupBy: 'provider', metric: 'cost' },
      format: 'json',
    })
    const exportedJson: unknown = JSON.parse(exported.body)
    const payload = usageCompanionReplySchema.parse(exportedJson)
    expect(payload.download?.name).toBe('usage.json')
    const exportState = await createUsageService(deps).snapshot()
    expect(payload.download?.content).toBe(JSON.stringify(exportState.totals))
    const confirmed = await rpc(
      server,
      { type: 'usage/deleteHistory', requestId: 'reset' },
      { 'x-usage-confirm-delete': 'confirmed', 'x-usage-confirm-count': '1' },
    )
    const confirmedJson: unknown = JSON.parse(confirmed.body)
    expect(usageCompanionReplySchema.parse(confirmedJson).messages[0]).toEqual(
      expect.objectContaining({ outcome: 'completed' }),
    )
    expect(deps.journal.deleteHistory).toHaveBeenCalledExactlyOnceWith()
    expect(deps.confirmDelete).not.toHaveBeenCalled()
  })
  it('keeps the selected query for refresh and isolates concurrent export/confirmation contexts', async () => {
    const { server } = await setup()
    await rpc(server, {
      type: 'usage/query',
      query: { range: '7d', groupBy: 'model', metric: 'tokens' },
    })
    const response = await rpc(server, { type: 'usage/refresh' })
    const parsed: unknown = JSON.parse(response.body)
    const state = usageCompanionReplySchema.parse(parsed).messages[0]
    expect(state).toMatchObject({ type: 'usage/state', state: { query: { range: '7d' } } })
    const responses = await Promise.all([
      rpc(server, { type: 'usage/deleteHistory', requestId: 'reset' }),
      rpc(server, {
        type: 'usage/export',
        requestId: 'export',
        query: { range: 'today', groupBy: 'provider', metric: 'cost' },
        format: 'json',
      }),
    ])
    const first: unknown = JSON.parse(responses[0].body)
    const second: unknown = JSON.parse(responses[1].body)
    expect(usageCompanionReplySchema.parse(first).download).toBeUndefined()
    expect(usageCompanionReplySchema.parse(second).download).toBeDefined()
  })
  it('rejects a listener address outside loopback before offering a URL', async () => {
    const { webviewDirectory } = await setup()
    const address = vi
      .spyOn(Server.prototype, 'address')
      .mockReturnValueOnce({ address: '0.0.0.0', family: 'IPv4', port: 12_345 })
    try {
      let didRefuse = false
      try {
        const unsafe = await startUsageCompanion({
          webviewDirectory,
          indexHtml: '<html></html>',
          createService: (ports) => createUsageService({ ...usageFixtureDeps(), ...ports }),
        })
        servers.push(unsafe)
      } catch (error) {
        didRefuse = error instanceof Error && error.message.includes('non-loopback')
      }
      expect(didRefuse).toBe(true)
    } finally {
      address.mockRestore()
    }
  })
  it('extends idle lifetime only for authenticated page activity', async () => {
    const { webviewDirectory } = await setup()
    const server = await timedCompanion(webviewDirectory)
    await vi.advanceTimersByTimeAsync(USAGE_COMPANION_IDLE_MS - 1)
    expect(await rpc(server, { type: 'usage/refresh' })).toHaveProperty('status', 200)
    await vi.advanceTimersByTimeAsync(1)
    expect(await http(server, '/')).toHaveProperty('status', 200)
    expect(
      await rpc(server, { type: 'usage/refresh' }, { authorization: 'Bearer wrong' }),
    ).toHaveProperty('status', 403)
    await vi.advanceTimersByTimeAsync(USAGE_COMPANION_IDLE_MS - 1)
    await expect(http(server, '/')).rejects.toThrow()
  })
  it('closes after thirty idle minutes and close is idempotent', async () => {
    const { webviewDirectory } = await setup()
    const server = await timedCompanion(webviewDirectory)
    await vi.advanceTimersByTimeAsync(USAGE_COMPANION_IDLE_MS)
    await expect(http(server, '/')).rejects.toThrow()
    await server.close()
    await expect(server.close()).resolves.toBeUndefined()
  })
})
