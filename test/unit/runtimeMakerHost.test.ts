import { performance } from 'node:perf_hooks'
import { mkdtemp, mkdir, readFile, rm, link, symlink, rename } from 'node:fs/promises'
import { makerTempRoot } from './helpers/makerTemp'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import type { UserPresenceRequest } from '../../src/core/maker/userPresence'
import { RuntimeMakerHost } from '../../src/runtime/maker/runtimeMakerHost'
import { createRuntimeMakerService } from '../../src/runtime/maker/service'
import { createMakerStore } from '../../src/webview/maker/store'
import { MakerApproval } from '../../src/core/maker/ports'
import { askMakerPermission, makerPermissionOptions } from '../../src/acp/makerTools'
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
type PresenceResult = 'approved' | 'denied' | 'unavailable'
function presencePort() {
  const port = {
    calls: [] as UserPresenceRequest[],
    once: [] as Promise<PresenceResult>[],
    result: 'approved' as PresenceResult,
    impl: undefined as undefined | (() => Promise<PresenceResult>),
    check(request: UserPresenceRequest): Promise<PresenceResult> {
      port.calls.push(request)
      const next = port.once.shift()
      if (next !== undefined) return next
      return port.impl === undefined ? Promise.resolve(port.result) : port.impl()
    },
  }
  return port
}
// The grant clock is performance.now in production and test alike (both from
// node:perf_hooks); expiry cases assign an offset by plain assignment.
const nativeNow = performance.now
const GRANT_EXPIRY_OFFSET_MS = 6000
function offsetClock() {
  performance.now = () => nativeNow.call(performance) + GRANT_EXPIRY_OFFSET_MS
}
function restoreClock() {
  performance.now = nativeNow
}
async function fixture(overrides: Partial<Parameters<typeof RuntimeMakerHost.create>[0]> = {}) {
  const directory = await mkdtemp(path.join(makerTempRoot(), 'maker-host-'))
  directories.push(directory)
  const workspace = path.join(directory, 'workspace')
  await mkdir(workspace)
  const audits: string[] = []
  const auditEnable = (reason: string) => {
    audits.push(reason)
    return Promise.resolve()
  }
  const deps = {
    dataDirectory: path.join(directory, 'data'),
    workspace,
    secrets: {
      get: () => Promise.resolve(undefined),
      store: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    },
    trusted: () => true,
    flagged: () => true,
    presence: presencePort(),
    interactive: () => true,
    auditEnable,
    ...overrides,
  }
  return { host: await RuntimeMakerHost.create(deps), deps, workspace, audits }
}
async function confirming(overrides: Partial<Parameters<typeof RuntimeMakerHost.create>[0]> = {}) {
  const { host } = await fixture(overrides)
  await host.setHardware(true, 'bench')
  const snapshot = request()
  const engine = new MakerApproval(snapshot, () => host.hardwareEnabled())
  const pending = host.confirm(snapshot, (raw) => engine.review(raw))
  const didReview = () =>
    host.review({
      v: 1,
      type: 'makerPayloadReviewed',
      id: snapshot.id,
      digest: snapshot.digest,
      isComplete: true,
    })
  const answer = {
    id: snapshot.id,
    digest: snapshot.digest,
    target: snapshot.target,
    decision: 'allow_once',
  }
  return { host, snapshot, engine, pending, didReview, answer }
}
/**
RVM103W2 P2 (Windows): lifecycle tests inject the port probe. Real discovery needs
SystemRoot and PowerShell on Windows (and ioreg on macOS), which an empty test env lacks.
*/
async function lifecycleService({
  platform = process.platform,
  ...overrides
}: Partial<Parameters<typeof RuntimeMakerHost.create>[0]> & { platform?: NodeJS.Platform } = {}) {
  const { deps } = await fixture(overrides)
  const service = await createRuntimeMakerService({
    ...deps,
    native: { platform, env: {}, packageRoot: path.resolve('.') },
  })
  service.serial.ports = () => Promise.resolve([])
  return service
}
/** A pending request held by the real service, with its exact review and allow. */
async function pendingReview(service: Awaited<ReturnType<typeof lifecycleService>>) {
  await service.host.setHardware(true, 'bench')
  const snapshot = { ...request(), expiresAt: Date.now() + 30_000 }
  const engine = new MakerApproval(snapshot, () => service.host.hardwareEnabled())
  const pending = service.host.confirm(snapshot, (raw) => engine.review(raw))
  const { id, digest, target } = snapshot
  const review = {
    v: 1 as const,
    type: 'makerPayloadReviewed' as const,
    id,
    digest,
    isComplete: true,
  }
  return { engine, pending, review, answer: { id, digest, target, decision: 'allow_once' } }
}
function grantFile(host: RuntimeMakerHost): string {
  return path.join(
    host.storage.workspace.directory,
    `${createHash('sha256').update('hardware').digest('hex')}.json`,
  )
}
describe('runtime maker host', () => {
  it('persists hardware by canonical workspace and audits the reason first', async () => {
    const { host, deps, audits } = await fixture()
    expect(host.hardwareEnabled()).toBe(false)
    await host.setHardware(true, ' supervised bench ')
    expect(audits).toEqual(['supervised bench'])
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
  it('presence for payload A cannot approve payload B or a changed target', async () => {
    const { host, engine, pending, didReview, answer } = await confirming()
    expect(didReview()).toBe(true)
    const grant = await host.authorize(answer)
    expect(grant).toBeDefined()
    expect(host.answer({ ...answer, digest: '0'.repeat(64) }, grant)).toBe(false)
    expect(
      host.answer({ ...answer, target: { kind: 'workspace', workspace: '/other' } }, grant),
    ).toBe(false)
    expect(host.answer(answer, grant)).toBe(true)
    expect(engine.answer(await pending)).toBeDefined()
    expect(host.answer(answer, grant)).toBe(false)
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
  it('passes a presence-approved once answer and consumes only the live target', async () => {
    const { host, snapshot, engine, pending, didReview, answer } = await confirming()
    expect(didReview()).toBe(true)
    expect(host.answer(answer)).toBe(false)
    const grant = await host.authorize(answer)
    expect(host.answer(answer, grant)).toBe(true)
    expect(host.answer(answer, grant)).toBe(false)
    const binding = engine.answer(await pending)
    if (binding === undefined) throw new Error('missing-binding')
    expect(engine.consume(binding, snapshot.target)).toBe(true)
    expect(engine.consume(binding, snapshot.target)).toBe(false)
  })
  it('refuses an expired OS presence grant', async () => {
    const { host, snapshot, pending } = await confirming()
    const answer = {
      id: snapshot.id,
      digest: snapshot.digest,
      target: snapshot.target,
      decision: 'allow_once',
    }
    const grant = await host.authorize(answer)
    offsetClock()
    try {
      expect(host.answer(answer, grant)).toBe(false)
    } finally {
      restoreClock()
      host.cancelApprovals()
      await pending
    }
  })
  it.each(['denied', 'unavailable'] as const)(
    'OS presence %s cannot authorize a send or enable hardware',
    async (result) => {
      const presence = presencePort()
      const { host } = await fixture({ presence })
      await host.setHardware(true, 'bench')
      presence.result = result
      const snapshot = request()
      const pending = host.confirm(snapshot)
      const answer = {
        id: snapshot.id,
        digest: snapshot.digest,
        target: snapshot.target,
        decision: 'allow_once',
      }
      try {
        await expect(host.authorize(answer)).rejects.toThrow()
        expect(host.answer(answer)).toBe(false)
        await host.setHardware(false)
        await expect(host.setHardware(true, 'bench')).rejects.toThrow()
        expect(host.hardwareEnabled()).toBe(false)
        expect(await pending).toBeUndefined()
      } finally {
        host.cancelApprovals()
        await pending
      }
    },
  )
  it('a competing presence reply cannot mint a second grant for the same approval', async () => {
    const presence = presencePort()
    const { host } = await fixture({ presence })
    await host.setHardware(true, 'bench')
    const native = Promise.withResolvers<'approved'>()
    presence.impl = () => native.promise
    const snapshot = request()
    const pending = host.confirm(snapshot)
    const answer = {
      id: snapshot.id,
      digest: snapshot.digest,
      target: snapshot.target,
      decision: 'allow_once',
    }
    const first = host.authorize(answer),
      second = host.authorize(answer)
    native.resolve('approved')
    const [grant, replay] = await Promise.all([first, second])
    expect(grant).toBeDefined()
    expect(replay).toBeUndefined()
    expect(host.answer(answer, grant)).toBe(true)
    await pending
  })
  it('forwards a payload review only to the pending request it names', async () => {
    const { host } = await fixture()
    await host.setHardware(true, 'bench')
    const snapshot = request()
    const reviews: unknown[] = []
    const didReview = (raw: unknown) => {
      reviews.push(raw)
      return true
    }
    const pending = host.confirm(snapshot, didReview)
    const review = {
      v: 1 as const,
      type: 'makerPayloadReviewed' as const,
      id: snapshot.id,
      digest: snapshot.digest,
      isComplete: true,
    }
    expect(host.review({ ...review, id: randomUUID() })).toBe(false)
    expect(reviews).toEqual([])
    expect(host.review(review)).toBe(true)
    expect(reviews).toEqual([review])
    host.cancelApprovals()
    await pending
    expect(host.review(review)).toBe(false)
    expect(reviews).toHaveLength(1)
  })
  it.each([
    ['win32', false],
    ['win32', true],
    ['linux', false],
    ['linux', true],
    ['darwin', false],
    ['darwin', true],
  ] as const)(
    'RVM103W P2 a later document makerReady revokes the earlier review (%s, reviewed again: %s)',
    async (platform, isReviewedAgain) => {
      const service = await lifecycleService({ platform })
      const signal = new AbortController().signal
      try {
        const { engine, pending, review, answer } = await pendingReview(service)
        expect(await service.dispatch(review, signal)).toBe(true)
        await service.dispatch({ v: 1, type: 'makerReady' }, signal)
        if (isReviewedAgain) expect(await service.dispatch(review, signal)).toBe(true)
        const grant = await service.host.authorize(answer)
        expect(service.host.answer(answer, grant)).toBe(true)
        expect(engine.answer(await pending) !== undefined).toBe(isReviewedAgain)
      } finally {
        await service.close()
      }
    },
  )
  describe('document epoch transitions (PLAN M103 FIXM103W8)', () => {
    it('open: a confirmed request is replayed to a new document and allows only with a grant', async () => {
      const { host, snapshot, pending, answer } = await confirming()
      const messages: unknown[] = []
      const off = host.subscribe((message) => {
        messages.push(message)
      })
      try {
        expect(messages.at(-1)).toEqual({ v: 1, type: 'makerApproval', request: snapshot })
        expect(host.answer(answer)).toBe(false)
      } finally {
        off()
        host.cancelApprovals()
        await pending
      }
    })
    it('review: counts only in the epoch that made it; the new document reviews again', async () => {
      const { host, engine, pending, didReview, answer } = await confirming()
      expect(didReview()).toBe(true)
      host.newDocument()
      expect(didReview()).toBe(true)
      expect(host.answer(answer, await host.authorize(answer))).toBe(true)
      expect(engine.answer(await pending)).toBeDefined()
    })
    it('authenticate: a second Send once while the OS prompt is open does not prompt again', async () => {
      const presence = presencePort()
      const { host, pending, answer } = await confirming({ presence })
      const native = Promise.withResolvers<'approved'>()
      presence.impl = () => native.promise
      const first = host.authorize(answer)
      expect(await host.authorize(answer)).toBeUndefined()
      native.resolve('approved')
      expect(await first).toBeDefined()
      expect(presence.calls).toHaveLength(2)
      host.cancelApprovals()
      await pending
    })
    it('authenticated: an expired grant lets the same document authenticate again', async () => {
      const { host, engine, pending, didReview, answer } = await confirming()
      expect(didReview()).toBe(true)
      const old = await host.authorize(answer)
      expect(await host.authorize(answer)).toBeUndefined()
      offsetClock()
      try {
        const fresh = await host.authorize(answer)
        expect(fresh).toBeDefined()
        expect(host.answer(answer, old)).toBe(false)
        expect(host.answer(answer, fresh)).toBe(true)
      } finally {
        restoreClock()
      }
      expect(engine.answer(await pending)).toBeDefined()
    })
    it('authentication failed: a denied OS prompt leaves the request open for a retry', async () => {
      const presence = presencePort()
      const { host, pending, answer } = await confirming({ presence })
      presence.once.push(Promise.resolve('denied'))
      await expect(host.authorize(answer)).rejects.toThrow()
      const grant = await host.authorize(answer)
      expect(grant).toBeDefined()
      expect(host.answer(answer, grant)).toBe(true)
      await pending
    })
    it('answer: a grant minted in an earlier epoch is refused', async () => {
      const { host, pending, didReview, answer } = await confirming()
      expect(didReview()).toBe(true)
      const old = await host.authorize(answer)
      host.newDocument()
      expect(host.answer(answer, old)).toBe(false)
      host.cancelApprovals()
      await pending
    })
    it('newDocument: OS authentication started before it mints nothing; the new document can', async () => {
      const presence = presencePort()
      const { host, engine, pending, didReview, answer } = await confirming({ presence })
      const native = Promise.withResolvers<'approved'>()
      presence.once.push(native.promise)
      const inFlight = host.authorize(answer)
      host.newDocument()
      native.resolve('approved')
      expect(await inFlight).toBeUndefined()
      expect(didReview()).toBe(true)
      const fresh = await host.authorize(answer)
      expect(fresh).toBeDefined()
      expect(host.answer(answer, fresh)).toBe(true)
      expect(engine.answer(await pending)).toBeDefined()
    })
    it.each([
      [
        'editor ask: an answer resolving after a new document settles reject without prompting',
        false,
      ],
      ['RVM103W4 P3 no consumer can restore an old epoch; only newDocument advances it', true],
    ] as const)('%s', async (_name, checksReadonlyEpoch) => {
      const asked = Promise.withResolvers<unknown>()
      const presence = presencePort()
      const { host } = await fixture({ ask: () => asked.promise, presence })
      await host.setHardware(true, 'bench')
      const snapshot = { ...request(), expiresAt: Date.now() + 30_000 }
      const engine = new MakerApproval(snapshot, () => host.hardwareEnabled())
      const pending = host.confirm(snapshot, (raw) => engine.review(raw))
      const saved = host.epoch
      host.newDocument()
      if (checksReadonlyEpoch) {
        expect(host.epoch).toBe(saved + 1)
        expect(() => {
          // @ts-expect-error -- RVM103W4 P3: the epoch is read-only; this restore must not compile.
          host.epoch = saved
        }).toThrow(TypeError)
        expect(host.epoch).toBe(saved + 1)
      }
      asked.resolve({
        id: snapshot.id,
        digest: snapshot.digest,
        target: snapshot.target,
        decision: 'allow_once',
      })
      expect(await pending).toMatchObject({ id: snapshot.id, decision: 'reject_once' })
      expect(engine.answer(await pending)).toBeUndefined()
      expect(presence.calls).toHaveLength(1)
    })
    it('close: a cancelled request accepts no review, authentication or answer', async () => {
      const { host, pending, didReview, answer } = await confirming()
      host.cancelApprovals()
      expect(await pending).toBeUndefined()
      expect(didReview()).toBe(false)
      expect(await host.authorize(answer)).toBeUndefined()
      expect(host.answer(answer, 'a'.repeat(64))).toBe(false)
    })
    it.each(['grant before ready', 'presence in flight'] as const)(
      'RVM103W2 P2 a reloaded document gets its own grant; the old one is retired (%s)',
      async (variant) => {
        const presence = presencePort()
        const service = await lifecycleService({ presence, platform: 'win32' })
        const signal = new AbortController().signal
        try {
          const { engine, pending, review, answer } = await pendingReview(service)
          expect(await service.dispatch(review, signal)).toBe(true)
          const native = Promise.withResolvers<'approved'>()
          if (variant === 'presence in flight') presence.once.push(native.promise)
          const old = service.host.authorize(answer)
          if (variant === 'grant before ready') await old
          await service.dispatch({ v: 1, type: 'makerReady' }, signal)
          native.resolve('approved')
          const oldGrant = await old
          expect(await service.dispatch(review, signal)).toBe(true)
          const fresh = await service.host.authorize(answer)
          expect(fresh).toBeDefined()
          if (oldGrant !== undefined) expect(service.host.answer(answer, oldGrant)).toBe(false)
          expect(service.host.answer(answer, fresh)).toBe(true)
          expect(engine.answer(await pending)).toBeDefined()
        } finally {
          await service.close()
        }
      },
    )
  })
  it('a fresh document is admitted before the pending request it replays', async () => {
    const { host } = await fixture()
    await host.setHardware(true, 'bench')
    const snapshot = { ...request(), expiresAt: Date.now() + 30_000 }
    const pending = host.confirm(snapshot)
    const posted: unknown[] = []
    const post = (message: unknown) => {
      posted.push(message)
    }
    const store = createMakerStore({
      post,
      messages: new EventTarget(),
      savedState: () => undefined,
      saveState: () => undefined,
    })
    const unsubscribe = host.subscribe((message) => {
      store.receive(message)
    })
    try {
      expect(store.getState().approvals).toHaveLength(1)
      expect(posted).toEqual([])
    } finally {
      unsubscribe()
      store.dispose(false)
      host.cancelApprovals()
      await pending
    }
  })
  it('hardware disable during OS authentication revokes the pending enable', async () => {
    const presence = presencePort()
    const { host } = await fixture({ presence })
    const native = Promise.withResolvers<'approved'>()
    presence.impl = () => native.promise
    const enabling = host.setHardware(true, 'bench')
    await host.setHardware(false)
    native.resolve('approved')
    await expect(enabling).rejects.toThrow()
    expect(host.hardwareEnabled()).toBe(false)
    expect(await host.storage.workspace.get('hardware')).toBeUndefined()
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
    const asked: [string, string, unknown][] = []
    const ask = (title: string, text: string, options: unknown) => {
      asked.push([title, text, options])
      return Promise.resolve({ outcome: { outcome: 'selected' as const, optionId: 'allow_once' } })
    }
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
    const text: unknown = asked[0]?.[1]
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
