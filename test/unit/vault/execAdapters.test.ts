import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  executeTool,
  toolDefinitions,
  type ToolContext,
  type ToolIo,
} from '../../../src/core/backends/modelapi/tools'
import { vaultExecTools } from '../../../src/core/vault/exec/tools'
import { vaultUseDigest } from '../../../src/core/vault/useDigest'
import { createToolIo } from '../../../src/host/backend/toolIo'
import { IdeMcpServer } from '../../../src/host/ide/ideMcpServer'
import { FakeLogOutputChannel } from '../helpers/fakes'
import { memoryToolIo } from '../helpers/fakeToolIo'
import { envelope, serviceFixture } from './execFixture'
import { UI_TEXT } from '../../../src/shared/constants'

const servers: IdeMcpServer[] = []
afterEach(() => {
  for (const server of servers.splice(0)) server.close()
})
function fixture() {
  const { port, service } = serviceFixture()
  vi.mocked(port.authorize).mockImplementation((_handle, use) =>
    Promise.resolve({ ...envelope().approvals[0]!.ticket, digest: vaultUseDigest(use) }),
  )
  return {
    port,
    service,
    tools: vaultExecTools(service, () => undefined, {
      refused: 'Credential use refused',
      list: 'List handles',
      request: 'Request credential entry',
      run: 'Execute a command with approved routes',
    }),
  }
}
function contextFor(io: ToolIo = memoryToolIo({}, '/workspace')): ToolContext {
  return { io, platform: 'linux', workspaceRoot: '/workspace', seen: new Map() }
}
describe('M109 X backend adapters', () => {
  it('routes the Model API shell secrets through the broker callback and never through ordinary shell', async () => {
    const io = memoryToolIo({}, '/workspace')
    const run = vi.fn(() =>
      Promise.resolve({
        stdout: 'scrubbed',
        stderr: '',
        exitCode: 0,
        isTimedOut: false,
        isCancelled: false,
      }),
    )
    const ordinary = vi.fn(io.runShell)
    const context = contextFor({ ...io, runShell: ordinary, runVaultShell: run })
    const result = await executeTool(
      'bash',
      JSON.stringify({
        command: 'echo safe',
        description: 'test',
        secrets: { env: { TOKEN: 'secret://test-secret' } },
      }),
      context,
    )
    expect(result.output).toContain('scrubbed')
    expect(run).toHaveBeenCalledOnce()
    expect(ordinary).not.toHaveBeenCalled()
    expect(toolDefinitions('linux').find((tool) => tool.name === 'bash')?.parameters).toMatchObject(
      { properties: { secrets: { type: 'object' } } },
    )
    const denied = await executeTool(
      'bash',
      JSON.stringify({ command: 'echo secret://test-secret' }),
      context,
    )
    expect(denied.visibleOutput).toContain(UI_TEXT.vault.noAccess)
    expect(ordinary).not.toHaveBeenCalled()
  })
  it('fails closed when the Model API shell broker route is unavailable', async () => {
    const context = contextFor(memoryToolIo({}, '/workspace'))
    const result = await executeTool(
      'bash',
      JSON.stringify({ command: 'echo safe', secrets: { stdin: 'secret://test-secret' } }),
      context,
    )
    expect(result.visibleOutput).toContain(UI_TEXT.vault.brokerBlocked)
  })
  it('offers and executes the same safe metadata tools in the Model API table', async () => {
    const { tools } = fixture()
    const context = contextFor({ ...memoryToolIo({}, '/workspace'), vaultTools: tools })
    expect(
      toolDefinitions('linux', { hasShell: true, hasSkills: false, vaultTools: tools }).map(
        ({ name }) => name,
      ),
    ).toContain('secret_list')
    expect(
      toolDefinitions('linux', { hasShell: false, hasSkills: false, vaultTools: tools }).map(
        ({ name }) => name,
      ),
    ).not.toContain('vault_run')
    const list = await executeTool('secret_list', '{}', context)
    expect(list.output).toContain('secret://test-secret')
    const requested = await executeTool('secret_request', '{"name":"test-secret"}', context)
    expect(requested.output).toBe('secret://test-secret')
    const forged = await executeTool('secret_list', '{"approval":"allow"}', context)
    expect(forged.visibleOutput).toContain(UI_TEXT.vault.noAccess)
  })
  it('withholds arbitrary broker errors from MCP and Model API results', async () => {
    const { tools, port } = fixture()
    const privateFailure = 'generated-private-broker-failure'
    vi.mocked(port.launch).mockRejectedValue(new Error(privateFailure))
    await expect(tools[2]!.call(envelope().run, new AbortController().signal)).rejects.toThrow(
      'Credential use refused',
    )
    const context: ToolContext = {
      io: {
        ...memoryToolIo({}, '/workspace'),
        runVaultShell: () => Promise.reject(new Error(privateFailure)),
      },
      platform: 'linux',
      workspaceRoot: '/workspace',
      seen: new Map(),
    }
    const result = await executeTool(
      'bash',
      JSON.stringify({ command: 'echo safe', secrets: { stdin: 'secret://test-secret' } }),
      context,
    )
    expect(result.failureReason).toBeDefined()
    expect(JSON.stringify(result)).not.toContain(privateFailure)
  })
  it('keeps host loading lazy and binds the exact interpreter argv and current native admission', async () => {
    const { service, port } = fixture()
    const load = vi.fn(() => Promise.resolve(service))
    const io = createToolIo({
      platform: 'linux',
      systemRoot: undefined,
      env: () => ({ PATH: '/bin:/usr/bin' }),
      searchWorkerPath: 'unused',
      listFiles: () => Promise.resolve([]),
      unsavedFiles: () => [],
      log: () => undefined,
      vault: load,
    })
    expect(load).not.toHaveBeenCalled()
    await io.runVaultShell!('echo safe', '/workspace', 4321, { stdin: 'secret://test-secret' })
    expect(port.authorize).toHaveBeenCalledWith(
      'secret://test-secret',
      expect.objectContaining({
        command: expect.objectContaining({ argv: ['--noprofile', '--norc', '-c', 'echo safe'] }),
      }),
      expect.any(AbortSignal),
    )
    expect(port.launch).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(AbortSignal),
      expect.any(Function),
      { timeoutMs: 4321, limit: undefined },
    )
    const denied = await io.runShell('echo secret://test-secret', process.cwd(), 1000)
    expect(denied.isWorkspaceShutdownProven).toBe(true)
    expect(denied.stderr).toBe(UI_TEXT.vault.noAccess)
  })
  it('does not log a requester binding exception', async () => {
    const log = new FakeLogOutputChannel()
    const failure = 'generated-private-failure'
    const server = new IdeMcpServer(
      () => [],
      log,
      () => Promise.reject(new Error(failure)),
    )
    servers.push(server)
    const endpoint = await server.start()
    const result = await fetch(endpoint.url, {
      method: 'POST',
      headers: endpoint.headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(result.status).toBe(500)
    expect(JSON.stringify(log.error.mock.calls)).not.toContain(failure)
  })
  it('adds IDE vault tools only through an authenticated requester binding', async () => {
    const { tools } = fixture()
    const pin = vi.fn(() => Promise.resolve(tools))
    const server = new IdeMcpServer(() => [], new FakeLogOutputChannel(), pin)
    servers.push(server)
    const endpoint = await server.start()
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const denied = await fetch(endpoint.url, { method: 'POST', body })
    expect(denied.status).toBe(401)
    expect(pin).not.toHaveBeenCalled()
    const accepted = await fetch(endpoint.url, { method: 'POST', headers: endpoint.headers, body })
    const response: unknown = await accepted.json()
    expect(JSON.stringify(response)).toContain('vault_run')
    expect(pin).toHaveBeenCalledOnce()
    const listing = await fetch(endpoint.url, {
      method: 'POST',
      headers: endpoint.headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'secret_list', arguments: {} },
      }),
    })
    expect(JSON.stringify(await listing.json())).toContain('secret://test-secret')
  })
})
