import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { makerTempRoot } from './helpers/makerTemp'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runRuntimeMaker } from '../../src/runtime/maker/entry'
import { parseMakerCommand } from '../../src/runtime/maker/commandArgs'
import { createUserPresence } from '../../src/runtime/maker/userPresence'
import { EN } from '../../src/shared/l10n/en'
import { RUNTIME_MAKER_AGENT_MARKERS, UI_TEXT } from '../../src/shared/constants'
import { createRuntimeMakerService } from '../../src/runtime/maker/service'
import { MakerApproval } from '../../src/core/maker/ports'
import { createHash, randomUUID } from 'node:crypto'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(path.join(makerTempRoot(), 'maker-presence-'))
  roots.push(root)
  const workspace = path.join(root, 'workspace')
  await mkdir(workspace)
  const presence = { check: vi.fn().mockResolvedValue('denied') }
  const deps = {
    dataDirectory: path.join(root, 'data'),
    distDirectory: path.join(root, 'dist'),
    workspace,
    platform: process.platform,
    env: {},
    presence,
    print: vi.fn(),
    readSecret: vi.fn(),
    secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() },
    done: AbortSignal.abort(),
    table: EN,
    locale: 'en',
  }
  return { deps, presence }
}
describe('terminal spoofing never supplies physical authority', () => {
  it.each(RUNTIME_MAKER_AGENT_MARKERS)(
    'refuses %s agent-shell enable, add and panel before asking for OS presence',
    async (marker) => {
      const { deps, presence } = await fixture()
      presence.check.mockResolvedValue('approved')
      for (const args of [
        ['hardware', 'enable', '--reason', 'agent claim', '--trust-workspace'],
        ['machines', 'add', '--registration', '{}', '--key-stdin', '--trust-workspace'],
        ['panel', '--trust-workspace'],
      ]) {
        const command = parseMakerCommand(args)
        if (command === undefined) throw new Error('command')
        await expect(runRuntimeMaker(command, { ...deps, env: { [marker]: '1' } })).rejects.toThrow(
          UI_TEXT.makerUnattendedDenied,
        )
      }
      expect(presence.check).not.toHaveBeenCalled()
      expect(deps.readSecret).not.toHaveBeenCalled()
      expect(deps.print).not.toHaveBeenCalled()
    },
  )
  it.each([
    ['remote SSH peer', 'linux', { SSH_CONNECTION: '203.0.113.5 3000 192.168.1.2 22' }],
    ['LD_PRELOAD forged ps', 'linux', { LD_PRELOAD: '/agent/forged-ps.so' }],
    ['subst fake SystemRoot', 'win32', { SystemRoot: String.raw`X:\windows` }],
    ['AppleScript driving Terminal', 'darwin', { TERM_PROGRAM: 'Apple_Terminal' }],
    ['multiplexer capture-pane', 'linux', { TMUX: '/tmp/agent-session' }],
  ] as const)('%s cannot enable hardware', async (_probe, platform, env) => {
    const { deps, presence } = await fixture()
    const command = parseMakerCommand([
      'hardware',
      'enable',
      '--reason',
      'agent claim',
      '--trust-workspace',
    ])
    if (command === undefined) throw new Error('command')
    await expect(runRuntimeMaker(command, { ...deps, platform, env })).rejects.toThrow(
      UI_TEXT.makerPresenceDenied,
    )
    expect(presence.check).toHaveBeenCalledOnce()
    expect(deps.readSecret).not.toHaveBeenCalled()
    expect(deps.print).not.toHaveBeenCalled()
  })
  it.each(['darwin', 'win32'] as const)(
    'M109 %s adapter uses the OS presence port and otherwise refuses',
    async (platform) => {
      const request = {
        id: randomUUID(),
        digest: 'a'.repeat(64),
        machine: 'Bench printer',
        summary: 'Send once',
      }
      expect(await createUserPresence(platform).check(request)).toBe('unavailable')
      const fake = { check: vi.fn().mockResolvedValue('approved') }
      expect(await createUserPresence(platform, fake).check(request)).toBe('approved')
      expect(fake.check).toHaveBeenCalledWith(request)
    },
  )
  it('denied presence sends no payload even if an ACP client automatically answers allow_once', async () => {
    const { deps, presence } = await fixture()
    presence.check.mockResolvedValue('approved')
    const service = await createRuntimeMakerService({
      ...deps,
      trusted: () => true,
      flagged: () => true,
      interactive: () => true,
      native: { platform: process.platform, env: {}, packageRoot: path.resolve('.') },
      ask: (request) =>
        Promise.resolve({
          id: request.id,
          digest: request.digest,
          target: request.target,
          decision: 'allow_once',
        }),
    })
    try {
      await service.host.setHardware(true, 'bench')
      presence.check.mockResolvedValue('denied')
      const snapshot = {
        kind: 'command' as const,
        id: randomUUID(),
        digest: createHash('sha256').update('flash.bin').digest('hex'),
        expiresAt: Date.now() + 1000,
        action: 'program' as const,
        target: { kind: 'workspace' as const, workspace: deps.workspace },
        payload: 'flash.bin',
      }
      const send = vi.fn()
      const engine = new MakerApproval(snapshot, () => service.host.hardwareEnabled())
      const answer = await service.host.confirm(snapshot, (raw) => engine.review(raw))
      if (engine.answer(answer) !== undefined) send()
      expect(send).not.toHaveBeenCalled()
      expect(engine.start(snapshot.target)).toBe(false)
      expect(presence.check).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: snapshot.id,
          digest: snapshot.digest,
          machine: deps.workspace,
        }),
      )
    } finally {
      await service.close()
    }
  })
})
