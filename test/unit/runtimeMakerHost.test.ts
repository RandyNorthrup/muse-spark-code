import { mkdtemp, mkdir, readFile, rm, link, symlink, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeMakerHost } from '../../src/runtime/maker/runtimeMakerHost'
import { MakerApproval } from '../../src/core/maker/ports'
import { askMakerPermission, makerPermissionOptions } from '../../src/acp/maker'
import type { ApprovalRequest } from '../../src/shared/makerProtocol'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})
function request(): ApprovalRequest {
  return {
    kind: 'command',
    id: randomUUID(),
    digest: createHash('sha256').update('payload').digest('hex'),
    expiresAt: Date.now() + 1000,
    action: 'program',
    target: { kind: 'workspace', workspace: path.resolve('.') },
    payload: 'payload',
  }
}
async function fixture(overrides: Partial<Parameters<typeof RuntimeMakerHost.create>[0]> = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'maker-host-'))
  directories.push(directory)
  const workspace = path.join(directory, 'workspace')
  await mkdir(workspace)
  const auditEnable = vi.fn<(reason: string) => Promise<void>>().mockResolvedValue(undefined)
  const deps = {
    dataDirectory: path.join(directory, 'data'),
    workspace,
    secrets: {
      get: vi.fn().mockResolvedValue(undefined),
      store: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    trusted: () => true,
    flagged: () => true,
    interactive: () => true,
    auditEnable,
    ...overrides,
  }
  return { host: await RuntimeMakerHost.create(deps), deps, workspace, auditEnable }
}
async function confirming() {
  const { host } = await fixture()
  await host.setHardware(true, 'bench')
  const snapshot = request()
  const engine = new MakerApproval(snapshot, () => host.hardwareEnabled())
  return { host, snapshot, engine, pending: host.confirm(snapshot) }
}
function grantFile(host: RuntimeMakerHost): string {
  return path.join(
    host.storage.workspace.directory,
    `${createHash('sha256').update('hardware').digest('hex')}.json`,
  )
}
describe('runtime maker host', () => {
  it('persists hardware by canonical workspace and audits the reason first', async () => {
    const { host, deps, auditEnable } = await fixture()
    expect(host.hardwareEnabled()).toBe(false)
    await host.setHardware(true, ' supervised bench ')
    expect(auditEnable).toHaveBeenCalledWith('supervised bench')
    const restored = await RuntimeMakerHost.create(deps)
    expect(restored.hardwareEnabled()).toBe(true)
    await host.setHardware(false)
    const revoked = await RuntimeMakerHost.create(deps)
    expect(revoked.hardwareEnabled()).toBe(false)
  })
  it.each(['trust', 'interactive', 'reason', 'audit'])(
    'refuses enabling without %s',
    async (guard) => {
      const { host } = await fixture({
        trusted: () => guard !== 'trust',
        interactive: () => guard !== 'interactive',
        ...(guard === 'audit' && { auditEnable: () => Promise.reject(new Error('audit')) }),
      })
      await expect(host.setHardware(true, guard === 'reason' ? ' ' : 'bench')).rejects.toThrow()
      expect(host.hardwareEnabled()).toBe(false)
    },
  )
  it('cannot use a repository folder as authority', async () => {
    const { deps, workspace } = await fixture()
    await expect(RuntimeMakerHost.create({ ...deps, dataDirectory: workspace })).rejects.toThrow(
      'maker-storage-in-workspace',
    )
  })
  it('flag and current admission refuse confirmations; Stop controls still update', async () => {
    let isInteractive = true
    let isFlagged = true
    const { host } = await fixture({ flagged: () => isFlagged, interactive: () => isInteractive })
    await host.setHardware(true, 'bench')
    isFlagged = false
    expect(await host.confirm(request())).toBeUndefined()
    isFlagged = true
    isInteractive = false
    expect(await host.confirm(request())).toBeUndefined()
    const messages: unknown[] = []
    host.subscribe((message) => {
      messages.push(message)
    })
    host.stopControls([])
    expect(messages).toHaveLength(2)
  })
  it('refuses trust lost after enabling and an already expired request', async () => {
    let isTrusted = true
    const { host } = await fixture({ trusted: () => isTrusted })
    await host.setHardware(true, 'bench')
    isTrusted = false
    expect(await host.confirm(request())).toBeUndefined()
    isTrusted = true
    expect(await host.confirm({ ...request(), expiresAt: Date.now() - 1 })).toBeUndefined()
  })
  it('uses the engine binding; changed digest, target and replay never dispatch', async () => {
    const { host } = await fixture()
    await host.setHardware(true, 'bench')
    const snapshot = request()
    const approval = new MakerApproval(snapshot, () => host.hardwareEnabled())
    const pending = host.confirm(snapshot)
    expect(
      host.answer({
        id: snapshot.id,
        digest: '0'.repeat(64),
        target: snapshot.target,
        decision: 'allow_once',
      }),
    ).toBe(true)
    expect(approval.answer(await pending)).toBeUndefined()
    expect(
      host.answer({
        id: snapshot.id,
        digest: snapshot.digest,
        target: snapshot.target,
        decision: 'allow_once',
      }),
    ).toBe(false)
    expect(approval.start(snapshot.target)).toBe(false)
  })
  it('revocation cancels an outstanding permission before dispatch', async () => {
    const { host } = await fixture()
    await host.setHardware(true, 'bench')
    const snapshot = request()
    const pending = host.confirm(snapshot)
    await host.setHardware(false)
    expect(await pending).toBeUndefined()
    expect(
      host.answer({
        id: snapshot.id,
        digest: snapshot.digest,
        target: snapshot.target,
        decision: 'allow_once',
      }),
    ).toBe(false)
  })
  it('burns a malformed correlated reply before a valid replay', async () => {
    const { host, snapshot, engine, pending } = await confirming()
    expect(host.answer({ id: snapshot.id, decision: 'allow_always' })).toBe(false)
    expect(engine.answer(await pending)).toBeUndefined()
    expect(host.answer({ ...snapshot, decision: 'allow_once' })).toBe(false)
  })
  it('passes a valid once answer to the engine and consumes only the live target', async () => {
    const { host, snapshot, engine, pending } = await confirming()
    expect(
      host.answer({
        id: snapshot.id,
        digest: snapshot.digest,
        target: snapshot.target,
        decision: 'allow_once',
      }),
    ).toBe(true)
    expect(
      host.answer({
        id: snapshot.id,
        digest: snapshot.digest,
        target: snapshot.target,
        decision: 'allow_once',
      }),
    ).toBe(false)
    const binding = engine.answer(await pending)
    expect(binding).toBeDefined()
    if (binding === undefined) throw new Error('missing-binding')
    expect(engine.consume(binding, snapshot.target)).toBe(true)
    expect(engine.consume(binding, snapshot.target)).toBe(false)
  })
  it('times out and closes the pending surface request', async () => {
    const { host } = await fixture()
    await host.setHardware(true, 'bench')
    const snapshot = { ...request(), expiresAt: Date.now() + 20 }
    const messages: unknown[] = []
    host.subscribe((message) => {
      messages.push(message)
    })
    expect(await host.confirm(snapshot)).toMatchObject({ decision: 'reject_once' })
    expect(messages.at(-1)).toEqual({ v: 1, type: 'makerApprovalClosed', id: snapshot.id })
  })
  it('rejects malformed persisted grants rather than enabling', async () => {
    const { host, deps } = await fixture()
    await host.storage.workspace.update('hardware', { enabled: true })
    const restored = await RuntimeMakerHost.create(deps)
    expect(restored.hardwareEnabled()).toBe(false)
  })
  it('turns off an unreadable hard-linked grant and keeps independent Stop controls', async () => {
    const { host } = await fixture()
    await host.setHardware(true, 'bench')
    const file = grantFile(host)
    await link(file, path.join(host.storage.workspace.directory, 'alias.json'))
    await host.refresh()
    expect(host.hardwareEnabled()).toBe(false)
    expect(() => {
      host.stopControls([])
    }).not.toThrow()
  })
  it('refuses a symbolic link to a grant before reading its authority', async () => {
    const { host } = await fixture()
    await host.setHardware(true, 'bench')
    const file = grantFile(host)
    const target = path.join(host.storage.workspace.directory, 'moved.json')
    await rename(file, target)
    await symlink(target, file, 'file')
    await expect(host.storage.workspace.get('hardware')).rejects.toThrow()
    await host.refresh()
    expect(host.hardwareEnabled()).toBe(false)
  })
  it('caps grant storage before writing oversized authority', async () => {
    const { host } = await fixture()
    await expect(host.storage.workspace.update('oversized', 'x'.repeat(70_000))).rejects.toThrow(
      'maker-storage-size',
    )
  })
  it('never persists a credential with a grant', async () => {
    const { host } = await fixture()
    await host.setHardware(true, 'bench')
    const file = grantFile(host)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      enabled: true,
      reason: 'bench',
      time: expect.any(Number),
    })
  })
})
describe('ACP maker permissions', () => {
  it('offers only allow/reject once and shows the full engine snapshot', async () => {
    const snapshot = request()
    const ask = vi
      .fn()
      .mockResolvedValue({ outcome: { outcome: 'selected', optionId: 'allow_once' } })
    expect(makerPermissionOptions().map((option) => option.kind)).toEqual([
      'allow_once',
      'reject_once',
    ])
    expect(await askMakerPermission(snapshot, ask)).toEqual({
      id: snapshot.id,
      digest: snapshot.digest,
      target: snapshot.target,
      decision: 'allow_once',
    })
    const text: unknown = ask.mock.calls[0]?.[1]
    expect(typeof text === 'string' ? JSON.parse(text) : undefined).toEqual(snapshot)
  })
  it.each(['allow_always', 'reject_once', 'foreign'])('does not honour %s', async (optionId) => {
    expect(
      await askMakerPermission(request(), () =>
        Promise.resolve({ outcome: { outcome: 'selected', optionId } }),
      ),
    ).toMatchObject({ decision: 'reject_once' })
  })
  it('rejects disconnect and cancellation', async () => {
    expect(
      await askMakerPermission(request(), () => Promise.reject(new Error('closed'))),
    ).toMatchObject({ decision: 'reject_once' })
    expect(
      await askMakerPermission(request(), () =>
        Promise.resolve({ outcome: { outcome: 'cancelled' } }),
      ),
    ).toMatchObject({ decision: 'reject_once' })
  })
})
