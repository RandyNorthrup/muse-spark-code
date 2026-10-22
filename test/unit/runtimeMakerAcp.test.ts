import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { makerTempRoot } from './helpers/makerTemp'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { askMakerPermission } from '../../src/acp/maker'
import { createAcpMakerRuntime } from '../../src/runtime/maker/acpRuntime'
import type { ApprovalRequest } from '../../src/shared/makerProtocol'
import { UI_TEXT } from '../../src/shared/constants'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).toReversed()) await close()
})
async function fixture(isHome = false, env: NodeJS.ProcessEnv = {}) {
  const root = await mkdtemp(path.join(makerTempRoot(), 'maker-acp-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const workspace = isHome ? root : path.join(root, 'workspace')
  await mkdir(workspace, { recursive: true })
  const runtime = createAcpMakerRuntime({
    dataDirectory: path.join(root, 'data'),
    trusted: () => true,
    flagged: () => true,
    presence: { check: () => Promise.resolve('approved' as const) },
    secrets: {
      get: () => Promise.resolve(undefined),
      store: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    },
    native: { platform: process.platform, env, packageRoot: path.resolve('.') },
  })
  cleanups.push(() => runtime.close())
  const permissionCalls: Parameters<Parameters<typeof askMakerPermission>[1]>[] = []
  const permission: Parameters<typeof askMakerPermission>[1] = (...args) => {
    permissionCalls.push(args)
    return Promise.resolve({ outcome: { outcome: 'selected', optionId: 'allow_once' } })
  }
  const asked: ApprovalRequest[] = []
  const ask = (request: ApprovalRequest): Promise<unknown> => {
    asked.push(request)
    return askMakerPermission(request, permission)
  }
  const first = await runtime.session(workspace, ask)
  cleanups.push(() => first.close())
  return { root, workspace, runtime, ask, asked, permission, permissionCalls, first }
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
    expect(await f.first.command(' /stop-machine --all')).toBe(UI_TEXT.makerSoftwareStopWarning)
    expect(await f.first.command('ordinary chat')).toBeUndefined()
    expect(await f.first.command('/stop-machine')).toBe(UI_TEXT.makerSoftwareStopWarning)
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
    expect(f.asked).toEqual([])
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
      expect(f.asked).toEqual([])
      expect(await f.first.command('/stop-machine')).toBe(UI_TEXT.makerSoftwareStopWarning)
    },
  )
  it('a failed authority initialization does not poison Stop or the next attempt', async () => {
    const f = await fixture()
    // A regular file where the data directory belongs makes the real grant
    // store fail to initialize; removing it lets the next attempt succeed.
    const data = path.join(f.root, 'data')
    await writeFile(data, 'not a directory')
    await expect(f.first.command('/hardware status')).rejects.toThrow(UI_TEXT.makerUnattendedDenied)
    await rm(data)
    expect(await f.first.command('/stop-machine')).toBe(UI_TEXT.makerSoftwareStopWarning)
    expect(await f.first.command('/hardware status')).toBe(UI_TEXT.makerHardwareDisabled)
  })
  it('two aliases of one workspace share the attended-session guard', async () => {
    const f = await fixture()
    const alias = path.join(f.root, 'alias')
    await symlink(f.workspace, alias, process.platform === 'win32' ? 'junction' : 'dir')
    f.first.setInteractive(true)
    await f.first.command('/hardware enable bench')
    const second = await f.runtime.session(alias, f.ask)
    cleanups.push(() => second.close())
    second.setInteractive(true)
    await expect(second.command('/hardware enable refuse')).rejects.toThrow()
    expect(await tools(f.first)).not.toContain('machine_status')
    expect(await tools(second)).not.toContain('machine_status')
    second.setInteractive(false)
    expect(await tools(f.first)).toContain('machine_status')
  })
})
