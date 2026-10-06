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
