import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { makerTempRoot } from './helpers/makerTemp'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { askMakerPermission } from '../../src/acp/maker'
import { MakerApproval } from '../../src/core/maker/ports'
import { createAcpMakerRuntime } from '../../src/runtime/maker/acpRuntime'
import * as makerService from '../../src/runtime/maker/service'
import { RuntimeMakerStorage } from '../../src/runtime/maker/storage'
import type { ApprovalRequest } from '../../src/shared/makerProtocol'
import { UI_TEXT } from '../../src/shared/constants'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).toReversed()) await close()
  vi.restoreAllMocks()
})
async function fixture(isHome = false, env: NodeJS.ProcessEnv = {}) {
  const root = await mkdtemp(path.join(makerTempRoot(), 'maker-acp-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const workspace = isHome ? root : path.join(root, 'workspace')
  await mkdir(workspace, { recursive: true })
  const services: Awaited<ReturnType<typeof makerService.createRuntimeMakerService>>[] = []
  const create = makerService.createRuntimeMakerService
  vi.spyOn(makerService, 'createRuntimeMakerService').mockImplementation(async (deps) => {
    const result = await create(deps)
    services.push(result)
    return result
  })
  const runtime = createAcpMakerRuntime({
    dataDirectory: path.join(root, 'data'),
    trusted: () => true,
    flagged: () => true,
    presence: { check: vi.fn().mockResolvedValue('approved') },
    secrets: { get: vi.fn().mockResolvedValue(undefined), store: vi.fn(), delete: vi.fn() },
    native: { platform: process.platform, env, packageRoot: path.resolve('.') },
  })
  cleanups.push(() => runtime.close())
  const permission = vi
    .fn<Parameters<typeof askMakerPermission>[1]>()
    .mockResolvedValue({ outcome: { outcome: 'selected', optionId: 'allow_once' } })
  const ask = vi
    .fn<(request: ApprovalRequest) => Promise<unknown>>()
    .mockImplementation((request) => askMakerPermission(request, permission))
  const first = await runtime.session(workspace, ask)
  cleanups.push(() => first.close())
  return { root, workspace, runtime, ask, permission, first, services }
}
async function enabledFixture() {
  const f = await fixture()
  f.first.setInteractive(true)
  await f.first.command('/hardware enable supervised bench')
  const host = f.services[0]?.host
  if (host === undefined) throw new Error('host')
  return { f, host }
}
function request(): ApprovalRequest {
  return {
    kind: 'command',
    id: randomUUID(),
    digest: createHash('sha256').update('test').digest('hex'),
    expiresAt: Date.now() + 60_000,
    action: 'program',
    target: { kind: 'workspace', workspace: path.resolve('.') },
    payload: 'test',
  }
}
async function tools(
  session: Awaited<ReturnType<ReturnType<typeof createAcpMakerRuntime>['session']>>,
) {
  if (!('url' in session.server)) throw new Error('http-endpoint')
  const response = await fetch(session.server.url, {
    method: 'POST',
    headers: session.server.headers,
    body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
  })
  const raw: unknown = await response.json()
  return JSON.stringify(raw)
}
describe('real ACP maker runtime admission', () => {
  it('home sessions always expose independent Stop, without constructing workspace authority', async () => {
    const f = await fixture(true)
    const create = vi.spyOn(RuntimeMakerStorage, 'create').mockRejectedValue(new Error('forbidden'))
    expect(await f.first.command(' /stop-machine --all')).toBe(UI_TEXT.makerSoftwareStopWarning)
    expect(create).not.toHaveBeenCalled()
    expect(f.services).toEqual([])
    expect(await f.first.command('ordinary chat')).toBeUndefined()
    expect(await f.first.command('/stop-machine')).toBe(UI_TEXT.makerSoftwareStopWarning)
  })
  it('exactly one active session reaches the real approval and losing exclusivity revokes pending approval', async () => {
    const { f, host } = await enabledFixture()
    const snapshot = request()
    const engine = new MakerApproval(snapshot, () => host.isInteractive())
    expect(engine.answer(await host.confirm(snapshot, (raw) => engine.review(raw)))).toBeDefined()
    expect(engine.start(snapshot.target)).toBe(true)
    expect(engine.start(snapshot.target)).toBe(false)
    expect(f.permission).toHaveBeenCalledWith(UI_TEXT.makerApprovalTitle, expect.any(String), [
      { optionId: 'allow_once', kind: 'allow_once', name: UI_TEXT.makerSendOnce },
      { optionId: 'reject_once', kind: 'reject_once', name: UI_TEXT.makerReject },
    ])
    const displayed: unknown = JSON.parse(f.permission.mock.calls[0]?.[1] ?? 'null')
    expect(displayed).toEqual(snapshot)
    expect(f.ask).toHaveBeenCalledTimes(1)
    f.ask.mockImplementation(
      () =>
        new Promise(() => {
          /* Hold the editor answer while another session joins. */
        }),
    )
    const pending = host.confirm(request())
    const second = await f.runtime.session(f.workspace, vi.fn())
    cleanups.push(() => second.close())
    second.setInteractive(true)
    expect(await pending).toBeUndefined()
    expect(host.isInteractive()).toBe(false)
    await expect(second.command('/hardware enable should refuse')).rejects.toThrow(
      UI_TEXT.makerUnattendedDenied,
    )
    expect(await host.confirm(request())).toBeUndefined()
    expect(await tools(f.first)).not.toContain('machine_status')
    expect(await tools(second)).not.toContain('machine_status')
    second.setInteractive(false)
    expect(host.isInteractive()).toBe(true)
    expect(await tools(f.first)).toContain('machine_status')
    expect(await tools(second)).not.toContain('machine_status')
  })
  it('the editor prompt is the review: only its exact allow reviews, and refusals never reach presence', async () => {
    const { f, host } = await enabledFixture()
    const authorize = vi.spyOn(host, 'authorize')
    const unreviewed = new MakerApproval(request(), () => host.isInteractive())
    expect(unreviewed.answer(await host.confirm(unreviewed.request))).toBeUndefined()
    f.ask.mockImplementationOnce(async (input) => ({
      ...(await askMakerPermission(input, f.permission)),
      digest: 'b'.repeat(64),
    }))
    const mismatched = new MakerApproval(request(), () => host.isInteractive())
    const answer = await host.confirm(mismatched.request, (raw) => mismatched.review(raw))
    expect(answer).toMatchObject({ decision: 'reject_once' })
    expect(mismatched.answer(answer)).toBeUndefined()
    expect(authorize).not.toHaveBeenCalled()
    f.permission.mockResolvedValueOnce({
      outcome: { outcome: 'selected', optionId: 'reject_once' },
    })
    const didReview = vi.fn(() => true)
    expect(await host.confirm(request(), didReview)).toMatchObject({ decision: 'reject_once' })
    expect(didReview).not.toHaveBeenCalled()
    expect(authorize).not.toHaveBeenCalled()
  })
  it('Muse Code MCP offers no physical action without captured top-level turn provenance, even during an attended turn', async () => {
    const f = await fixture()
    f.first.setInteractive(true)
    await f.first.command('/hardware enable bench')
    const offered = await tools(f.first)
    expect(offered).toContain('machine_status')
    expect(offered).not.toContain('machine_send')
    expect(offered).not.toContain('device_serial')
    if (!('url' in f.first.server)) throw new Error('http-endpoint')
    const response = await fetch(f.first.server.url, {
      method: 'POST',
      headers: f.first.server.headers,
      body: '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"machine_send","arguments":{"machineId":"printer","payload":"M104 S100"}}}',
    })
    expect(await response.json()).toMatchObject({ result: { isError: true } })
    expect(f.ask).not.toHaveBeenCalled()
  })
  it.each(['CI', 'MUSE_SPARK_AGENT_SHELL'])(
    'ACP marker %s refuses grants and tools even with one active client; Stop remains independent',
    async (marker) => {
      const f = await fixture(false, { [marker]: '1' })
      f.first.setInteractive(true)
      await expect(f.first.command('/hardware enable bench')).rejects.toThrow(
        UI_TEXT.makerUnattendedDenied,
      )
      expect(await tools(f.first)).not.toContain('machine_status')
      expect(f.ask).not.toHaveBeenCalled()
      expect(await f.first.command('/stop-machine')).toBe(UI_TEXT.makerSoftwareStopWarning)
    },
  )
  it('a failed authority initialization does not poison Stop or the next attempt', async () => {
    const f = await fixture()
    const create = vi.mocked(makerService.createRuntimeMakerService)
    create.mockRejectedValueOnce(new Error('temporary-storage-failure'))
    await expect(f.first.command('/hardware status')).rejects.toThrow(UI_TEXT.makerUnattendedDenied)
    expect(await f.first.command('/stop-machine')).toBe(UI_TEXT.makerSoftwareStopWarning)
    expect(create).toHaveBeenCalledTimes(1)
    expect(await f.first.command('/hardware status')).toBe(UI_TEXT.makerHardwareDisabled)
    expect(create).toHaveBeenCalledTimes(2)
  })
  it('two aliases of one workspace share the attended-session guard', async () => {
    const f = await fixture()
    const alias = path.join(f.root, 'alias')
    await symlink(f.workspace, alias, process.platform === 'win32' ? 'junction' : 'dir')
    f.first.setInteractive(true)
    await f.first.command('/hardware enable bench')
    const second = await f.runtime.session(alias, vi.fn())
    cleanups.push(() => second.close())
    second.setInteractive(true)
    expect(f.services[0]?.host.isInteractive()).toBe(false)
    await expect(second.command('/hardware enable refuse')).rejects.toThrow()
    expect(f.services).toHaveLength(1)
  })
})
