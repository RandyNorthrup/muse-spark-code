import { describe, expect, it, vi } from 'vitest'
import {
  ControllerRegistry,
  type SessionController,
} from '../../src/runtime/panel/controllerRegistry'
import { FakeAgentHost, FakeAgentSession } from './helpers/fakeAgent'

function setup() {
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const registry = new ControllerRegistry<SessionController>(log)
  const host = new FakeAgentHost()
  registry.watch(host)
  const session = new FakeAgentSession('session-one', 'muse-spark-1.3')
  const controller = {
    sessionId: session.sessionId,
    host,
    isReleased: false,
    hostExited: vi.fn(),
    release: vi.fn(() => {
      controller.isReleased = true
      session.dispose()
      return Promise.resolve()
    }),
  }
  const claim = registry.claimSession(session.sessionId)
  return { registry, host, session, controller, claim, log }
}

describe('controller registry', () => {
  it('waits for a host-exit release already draining when the registry closes', async () => {
    const t = setup()
    await t.registry.adopt(
      t.host,
      t.session,
      t.claim,
      () => t.controller,
      () => Promise.resolve(),
    )
    const stopped = Promise.withResolvers<boolean>()
    t.controller.release.mockImplementation(async () => {
      t.controller.isReleased = true
      await stopped.promise
    })
    t.host.exit('stopped')
    const closed = vi.fn()
    const closing = (async () => {
      await t.registry.close()
      closed()
    })()
    await Promise.resolve()
    await Promise.resolve()
    expect(closed).not.toHaveBeenCalled()
    stopped.resolve(true)
    await closing
    expect(closed).toHaveBeenCalledOnce()
  })
  it('releases the remaining controllers even when an earlier release fails', async () => {
    const t = setup()
    await t.registry.adopt(
      t.host,
      t.session,
      t.claim,
      () => t.controller,
      () => Promise.resolve(),
    )
    const session = new FakeAgentSession('session-two', 'muse-spark-1.3')
    const release = vi.fn(() => Promise.resolve())
    await t.registry.adopt(
      t.host,
      session,
      t.registry.claimSession(session.sessionId),
      () => ({ ...t.controller, sessionId: session.sessionId, release }),
      () => Promise.resolve(),
    )
    t.controller.release.mockRejectedValue(new Error('release failed'))
    await expect(t.registry.close()).rejects.toThrow('MHP_REGISTRY_RELEASE_FAILED')
    expect(release).toHaveBeenCalledOnce()
    expect([...t.registry.controllers()]).toEqual([])
  })
  it('closes every owned controller and refuses late claims/adoption', async () => {
    const t = setup()
    await t.registry.adopt(
      t.host,
      t.session,
      t.claim,
      () => t.controller,
      () => Promise.resolve(),
    )
    expect([...t.registry.controllers()]).toEqual([t.controller])
    await t.registry.close()
    expect(t.controller.release).toHaveBeenCalledTimes(1)
    expect([...t.registry.controllers()]).toEqual([])
    expect(() => t.registry.claimSession('late')).toThrow('MHP_SESSION_NOT_FOUND')
    await expect(
      t.registry.adopt(
        t.host,
        t.session,
        t.claim,
        () => t.controller,
        () => Promise.resolve(),
      ),
    ).rejects.toThrow('MHP_SESSION_NOT_FOUND')
  })
  it('refuses a session or controller that does not match its claimed binding', async () => {
    const t = setup()
    const wrong = t.registry.claimSession('other-session')
    await expect(
      t.registry.adopt(
        t.host,
        t.session,
        wrong,
        () => t.controller,
        () => Promise.resolve(),
      ),
    ).rejects.toThrow()
    const mismatch = setup()
    const wrongController = {
      ...mismatch.controller,
      sessionId: 'other-session',
      release: vi.fn(() => Promise.resolve()),
    }
    await expect(
      mismatch.registry.adopt(
        mismatch.host,
        mismatch.session,
        mismatch.claim,
        () => wrongController,
        () => Promise.resolve(),
      ),
    ).rejects.toThrow()
    expect(mismatch.session.dispose).toHaveBeenCalledOnce()
    expect(wrongController.release).toHaveBeenCalledOnce()
    expect(mismatch.registry.held(mismatch.session.sessionId)).toBeUndefined()
    expect(t.registry.held('other-session')).toBeUndefined()
    expect(t.registry.held(t.session.sessionId)).toBeUndefined()

    const other = setup()
    const wrongHostController = { ...other.controller, host: new FakeAgentHost() }
    await expect(
      other.registry.adopt(
        other.host,
        other.session,
        other.claim,
        () => wrongHostController,
        () => Promise.resolve(),
      ),
    ).rejects.toThrow()
    expect(other.registry.held(other.session.sessionId)).toBeUndefined()
  })
  it('publishes only after preparation and cleans up a failed adoption', async () => {
    const t = setup()
    const ready = Promise.withResolvers<boolean>()
    const adoption = t.registry.adopt(
      t.host,
      t.session,
      t.claim,
      () => t.controller,
      async () => {
        await ready.promise
      },
    )
    await vi.waitFor(() => {
      expect(t.registry.held(t.session.sessionId)).toBeUndefined()
    })
    ready.reject(new Error('prepare failed'))
    await expect(adoption).rejects.toThrow('prepare failed')
    expect(t.registry.held(t.session.sessionId)).toBeUndefined()
    expect(t.session.dispose).toHaveBeenCalledOnce()
    await expect(t.registry.closeSession(t.session.sessionId)).rejects.toThrow()
  })

  it('a close invalidates a request still preparing', async () => {
    const t = setup()
    const entered = Promise.withResolvers<boolean>()
    const ready = Promise.withResolvers<boolean>()
    const adoption = t.registry.adopt(
      t.host,
      t.session,
      t.claim,
      () => t.controller,
      async () => {
        entered.resolve(true)
        await ready.promise
      },
    )
    const refused = expect(adoption).rejects.toThrow()
    await entered.promise
    await t.registry.closeSession(t.session.sessionId)
    ready.resolve(true)
    await refused
    expect(t.registry.held(t.session.sessionId)).toBeUndefined()
  })

  it('a newer claim prevents an older load from adopting', async () => {
    const t = setup()
    t.registry.claimSession(t.session.sessionId)
    await expect(
      t.registry.adopt(
        t.host,
        t.session,
        t.claim,
        () => t.controller,
        () => Promise.resolve(),
      ),
    ).rejects.toThrow()
    expect(t.controller.release).not.toHaveBeenCalled()
    expect(t.session.dispose).toHaveBeenCalledOnce()
  })

  it('replacement waits until the old controller has stopped its turn', async () => {
    const t = setup()
    await t.registry.adopt(
      t.host,
      t.session,
      t.claim,
      () => t.controller,
      () => Promise.resolve(),
    )
    const stop = Promise.withResolvers<boolean>()
    t.controller.release.mockImplementation(async () => {
      t.controller.isReleased = true
      await stop.promise
    })
    const replacement = { ...t.controller, isReleased: false }
    const create = vi.fn(() => replacement)
    const newer = t.registry.claimSession(t.session.sessionId)
    const adoption = t.registry.adopt(t.host, t.session, newer, create, () => Promise.resolve())
    await vi.waitFor(() => {
      expect(t.controller.release).toHaveBeenCalledOnce()
    })
    expect(create).not.toHaveBeenCalled()
    expect(t.registry.held(t.session.sessionId)).toBeUndefined()
    stop.resolve(true)
    await adoption
    expect(t.registry.held(t.session.sessionId)).toBe(replacement)
  })

  it('host exit retires its controllers and rejects future adoption', async () => {
    const t = setup()
    await t.registry.adopt(
      t.host,
      t.session,
      t.claim,
      () => t.controller,
      () => Promise.resolve(),
    )
    t.registry.watch(t.host)
    t.host.exit('stopped')
    expect(t.controller.hostExited).toHaveBeenCalledOnce()
    expect(t.registry.held(t.session.sessionId)).toBeUndefined()
    const next = t.registry.claimSession(t.session.sessionId)
    expect(() => {
      t.registry.ensureClaim(next, t.host)
    }).toThrow()
    await expect(
      t.registry.adopt(
        t.host,
        t.session,
        next,
        () => t.controller,
        () => Promise.resolve(),
      ),
    ).rejects.toThrow()
  })
})
