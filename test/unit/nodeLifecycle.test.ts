import { nodeTempRoot, nodeNativeTest } from './helpers/nodeNative'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  NODE_APPROVAL_TTL_MS,
  NODE_STOP_TIMEOUT_MS,
  NODE_MAX_SESSIONS,
  NODE_MAX_CHALLENGES,
  NODE_SESSION_IDLE_MS,
  NODE_SESSION_MAX_MS,
} from '../../src/shared/constants'
import { NodeAttendance, type NodeRunPolicy } from '../../src/runtime/node/attendance'
import { nodeAuthenticate } from '../../src/runtime/node/listenerGuard'
import { NodeKillSwitch } from '../../src/runtime/node/killSwitch'
import { NodeAttempts, superviseNode } from '../../src/runtime/node/supervisor'
import { NodePrivateFiles } from '../../src/runtime/node/privateFiles'
import { nodeHealth } from '../../src/runtime/node/health'
import { NodeStateStore } from '../../src/runtime/node/state'
import { NODE_ZERO_DIGEST } from '../../src/shared/constants'
import { nodeBearer, nodeSession, nodeState } from './helpers/node/records'
import { listenerFixture } from './helpers/node/listener'
import { FakeNodeClock } from './helpers/node/clock'

const directories: string[] = []
async function directory() {
  const dir = await nodeTempRoot('m110-lifecycle-')
  directories.push(dir)
  return dir
}
const policy: NodeRunPolicy = {
  mode: 'acceptEdits',
  paid: false,
  budgetUsd: undefined,
  protectedPath: false,
  requiresAsking: false,
  makerAction: 'offline',
}
function attendance() {
  const clock = new FakeNodeClock()
  clock.shiftWall(1 - clock.now())
  return { clock, people: new NodeAttendance(clock, 'owner') }
}
function verifiedSession(clock: FakeNodeClock) {
  const now = clock.now()
  return {
    ...nodeSession(),
    createdAt: now,
    lastSeenAt: now,
    idleExpiresAt: now + NODE_SESSION_IDLE_MS,
    absoluteExpiresAt: now + NODE_SESSION_MAX_MS,
  }
}
afterEach(async () => {
  vi.useRealTimers()
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('M110-N attendance and headless floor', () => {
  it('H09 bounds sessions and asks and refuses conflicting session identities', async () => {
    const { people } = attendance()
    for (let index = 0; index < NODE_MAX_SESSIONS; index += 1)
      people.attach({ ...nodeSession(), id: `session-${String(index)}` })
    expect(() => {
      people.attach({ ...nodeSession(), id: 'overflow' })
    }).toThrow()
    expect(() => {
      people.attach({ ...nodeSession(), id: 'session-0', createdAt: 1 })
    }).toThrow()
    const answers: Promise<boolean>[] = []
    for (let index = 0; index < NODE_MAX_CHALLENGES; index += 1)
      answers.push(people.ask(`ask-${String(index)}`, 'digest', new AbortController().signal))
    expect(() => {
      void people.ask('overflow', 'digest', new AbortController().signal)
    }).toThrow()
    expect(() => {
      void people.ask('ask-0', 'digest', new AbortController().signal)
    }).toThrow()
    people.endAll()
    expect(await Promise.all(answers)).toEqual(
      Array.from({ length: NODE_MAX_CHALLENGES }, () => false),
    )
  })
  it('H12 names attendance only while an authenticated owner session is attached', () => {
    const { people, clock } = attendance()
    expect(people.sessions()).toEqual([])
    people.attach(nodeSession())
    expect(people.sessions().map((session) => session.id)).toEqual(['session-1'])
    clock.advance(1_800_000)
    expect(people.sessions()).toEqual([])
    expect(() => {
      people.attach(nodeSession())
    }).toThrow()
    expect(() => {
      people.attach({ ...nodeSession(), ownerId: 'other' })
    }).toThrow()
  })
  it('H08 a backward wall-clock step cannot extend idle attendance or bypass the unattended floor', () => {
    const { people, clock } = attendance()
    const session = verifiedSession(clock)
    people.attach(session)
    clock.advance(NODE_SESSION_IDLE_MS - 1)
    clock.shiftWall(-NODE_SESSION_MAX_MS)
    expect(people.sessions()).toHaveLength(1)
    clock.advance(1)
    expect(people.sessions()).toEqual([])
    expect(() => {
      people.assertRunAllowed({ ...policy, mode: 'bypass' })
    }).toThrow()
    expect(() => {
      people.attach(session)
    }).toThrow()
  })
  it('H08 idle time starts at verification and never comes from wall-clock expiry distances', () => {
    const { people, clock } = attendance()
    clock.advance(NODE_SESSION_IDLE_MS - 2)
    people.attach(nodeSession())
    clock.advance(NODE_SESSION_IDLE_MS - 1)
    expect(people.sessions()).toHaveLength(1)
    clock.advance(1)
    expect(people.sessions()).toEqual([])
  })
  it('H08 repeated verified activity refreshes idle time without restarting the absolute limit', () => {
    const { people, clock } = attendance()
    const session = verifiedSession(clock)
    people.attach(session)
    for (
      let elapsed = NODE_SESSION_IDLE_MS - 1;
      elapsed < NODE_SESSION_MAX_MS;
      elapsed += NODE_SESSION_IDLE_MS - 1
    ) {
      clock.advance(NODE_SESSION_IDLE_MS - 1)
      session.lastSeenAt = clock.now()
      session.idleExpiresAt = Math.min(
        clock.now() + NODE_SESSION_IDLE_MS,
        session.absoluteExpiresAt,
      )
      people.attach(session)
    }
    clock.shiftWall(-2)
    clock.advance(NODE_SESSION_MAX_MS - clock.monotonicMs() - 1)
    expect(people.sessions()).toHaveLength(1)
    clock.advance(1)
    expect(people.sessions()).toEqual([])
    // Wall metadata still appears live; neither querying nor reattaching may reset verification.
    expect(() => {
      people.attach(session)
    }).toThrow()
  })
  it('H08 refuses future verifier timestamps and a rollback before first attachment', async () => {
    const { people, clock } = attendance()
    const { verifier } = listenerFixture()
    const createdAt = clock.now() + NODE_SESSION_MAX_MS
    verifier.verifyBearer.mockResolvedValue({
      ...nodeSession(),
      createdAt,
      lastSeenAt: createdAt,
      idleExpiresAt: createdAt + NODE_SESSION_IDLE_MS,
      absoluteExpiresAt: createdAt + NODE_SESSION_MAX_MS,
    })
    const verified = await nodeAuthenticate(
      verifier,
      nodeBearer,
      'owner',
      new AbortController().signal,
    )
    expect(() => {
      people.attach(verified)
    }).toThrow()
    clock.shiftWall(-NODE_SESSION_MAX_MS)
    expect(() => {
      people.attach(nodeSession())
    }).toThrow()
    expect(people.sessions()).toEqual([])
  })
  it.each(['idleExpiresAt', 'absoluteExpiresAt'] as const)(
    'H08 refuses an over-long verifier %s',
    async (field) => {
      const { people } = attendance()
      const { verifier } = listenerFixture()
      const session = nodeSession()
      session[field] += 2
      verifier.verifyBearer.mockResolvedValue(session)
      await expect(
        nodeAuthenticate(verifier, nodeBearer, 'owner', new AbortController().signal),
      ).rejects.toThrow()
      expect(() => {
        people.attach(session)
      }).toThrow()
      expect(people.sessions()).toEqual([])
    },
  )
  it('H08 refuses an already expired verifier session at first attachment', async () => {
    const { people, clock } = attendance()
    const { verifier } = listenerFixture()
    clock.advance(NODE_SESSION_IDLE_MS)
    const verified = await nodeAuthenticate(
      verifier,
      nodeBearer,
      'owner',
      new AbortController().signal,
    )
    expect(() => {
      people.attach(verified)
    }).toThrow()
    expect(people.sessions()).toEqual([])
  })
  it.each([
    { mode: 'bypass' },
    { protectedPath: true },
    { requiresAsking: true },
    { makerAction: 'connect' },
    { makerAction: 'program' },
    { makerAction: 'actuate' },
    { paid: true },
    { paid: true, budgetUsd: 0 },
    { paid: true, budgetUsd: NaN },
  ] satisfies Partial<NodeRunPolicy>[])('H12 refuses unattended unsafe policy %j', (change) => {
    const { people } = attendance()
    expect(() => {
      people.assertRunAllowed({ ...policy, ...change })
    }).toThrow()
    expect(() => {
      people.assertRunAllowed(policy)
    }).not.toThrow()
    expect(() => {
      people.assertRunAllowed({ ...policy, paid: true, budgetUsd: 1 })
    }).not.toThrow()
  })
  it('H12 an unanswered ask expires as refusal, never as approval', async () => {
    vi.useFakeTimers()
    const { people } = attendance()
    const answer = people.ask('ask', 'digest', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(NODE_APPROVAL_TTL_MS)
    expect(await answer).toBe(false)
  })
  it('H12 rejects forged, detached, expired and replayed approval answers', async () => {
    const { people, clock } = attendance()
    const signal = new AbortController()
    const answer = people.ask('ask', 'digest', signal.signal)
    expect(() => {
      people.answer('session-1', 'ask', 'digest', true)
    }).toThrow()
    people.attach(nodeSession())
    expect(() => {
      people.answer('session-1', 'ask', 'other', true)
    }).toThrow()
    people.answer('session-1', 'ask', 'digest', true)
    expect(await answer).toBe(true)
    expect(() => {
      people.answer('session-1', 'ask', 'digest', true)
    }).toThrow()
    const expired = people.ask('expired', 'digest', signal.signal)
    clock.advance(NODE_APPROVAL_TTL_MS)
    expect(() => {
      people.answer('session-1', 'expired', 'digest', true)
    }).toThrow()
    expect(await expired).toBe(false)
    const pending = people.ask('abort', 'digest', signal.signal)
    signal.abort()
    expect(await pending).toBe(false)
    people.detach('session-1')
    expect(people.sessions()).toEqual([])
  })
  it('lock refuses outstanding asks and ends every attached session', async () => {
    const { people } = attendance()
    people.attach(nodeSession())
    const ask = people.ask('ask', 'digest', new AbortController().signal)
    people.endAll()
    expect(await ask).toBe(false)
    expect(people.sessions()).toEqual([])
  })
})

describe('M110-N kill switch and supervision', () => {
  it('H08 lock seals immediately and calls every cleanup even when one throws', async () => {
    const seal = vi.fn()
    const sessions = vi.fn()
    const tools = vi.fn(() => Promise.resolve())
    const failing = vi.fn(() => {
      throw new Error('test stop failure')
    })
    const kill = new NodeKillSwitch([{ stop: failing }, { stop: tools }], seal, sessions)
    const pending = kill.stop('locked')
    expect(kill.signal.aborted).toBe(true)
    expect(seal).toHaveBeenCalledOnce()
    expect(sessions).toHaveBeenCalledOnce()
    await expect(pending).rejects.toThrow()
    expect(tools).toHaveBeenCalledOnce()
    await expect(kill.stop('stopped')).rejects.toThrow()
    expect(tools).toHaveBeenCalledOnce()
  })
  it('H08 stop has a bounded deadline even if a cleanup never resolves', async () => {
    vi.useFakeTimers()
    const kill = new NodeKillSwitch(
      [
        {
          stop: () =>
            new Promise(() => {
              /* Deliberately wedged cleanup. */
            }),
        },
      ],
      vi.fn(),
      vi.fn(),
    )
    const stopped = expect(kill.stop('stopped')).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(NODE_STOP_TIMEOUT_MS)
    await stopped
  })
  nodeNativeTest(
    'H15 crash reconciliation blocks uncertain attempts instead of replaying them',
    async () => {
      const dir = await directory()
      const files = new NodePrivateFiles(dir)
      await files.write('attempts.v1.json', JSON.stringify([{ id: 'uncertain', state: 'running' }]))
      const { people } = attendance()
      const attempts = new NodeAttempts(files, people)
      await attempts.reconcile()
      expect(attempts.blocked()).toEqual(['uncertain'])
      const work = vi.fn(() => Promise.resolve('done'))
      await expect(
        attempts.run('uncertain', policy, new AbortController().signal, work),
      ).rejects.toThrow()
      expect(work).not.toHaveBeenCalled()
      expect(await attempts.run('fresh', policy, new AbortController().signal, work)).toBe('done')
      await expect(
        attempts.run('fresh', policy, new AbortController().signal, work),
      ).rejects.toThrow()
      const restarted = new NodeAttempts(files, people)
      await restarted.reconcile()
      expect(restarted.blocked()).toEqual(['uncertain'])
    },
  )
  nodeNativeTest(
    'failed or cancelled work remains blocked and malformed journal fails closed',
    async () => {
      const dir = await directory()
      const { people } = attendance()
      const attempts = new NodeAttempts(new NodePrivateFiles(dir), people)
      await attempts.reconcile()
      await expect(
        attempts.run('failed', policy, new AbortController().signal, () =>
          Promise.reject(new Error('test failure')),
        ),
      ).rejects.toThrow()
      expect(attempts.blocked()).toEqual(['failed'])
      await writeFile(
        path.join(dir, 'attempts.v1.json'),
        JSON.stringify([
          { id: 'duplicate', state: 'running' },
          { id: 'duplicate', state: 'completed' },
        ]),
      )
      await expect(attempts.reconcile()).rejects.toThrow()
    },
  )
  it('restarts with capped backoff and stops before an aborted restart', async () => {
    const controller = new AbortController()
    const delays: number[] = []
    const stop = vi.fn(() => Promise.resolve())
    const create = vi.fn(() =>
      Promise.resolve({ run: () => Promise.reject(new Error('test crash')), stop }),
    )
    await superviseNode(create, controller.signal, (ms) => {
      delays.push(ms)
      if (delays.length === 8) controller.abort()
      return Promise.resolve()
    })
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000])
    expect(create).toHaveBeenCalledTimes(8)
    expect(stop).toHaveBeenCalledTimes(8)
  })
  it('H08 an aborted restart delay finishes normally and never starts another instance', async () => {
    const controller = new AbortController()
    const create = vi.fn(() =>
      Promise.resolve({
        run: () => Promise.reject(new Error('test crash')),
        stop: () => Promise.resolve(),
      }),
    )
    await superviseNode(create, controller.signal, () => {
      controller.abort()
      return Promise.reject(new Error('test cancelled sleep'))
    })
    expect(create).toHaveBeenCalledOnce()
  })
  nodeNativeTest(
    'ready requires current writable state, readable journals and any needed key unsealed',
    async () => {
      const dir = await directory()
      const state = new NodeStateStore(dir)
      const value = nodeState()
      value.auditHead = { seq: 0, hash: NODE_ZERO_DIGEST }
      await state.initialize(value)
      const ports = {
        state,
        journalsReadable: () => Promise.resolve(true),
        isKeyStoreSealed: () => true,
        keysNeeded: () => true,
      }
      expect(await nodeHealth('/livez', ports)).toEqual({ status: 200, word: 'live' })
      expect(await nodeHealth('/readyz', ports)).toEqual({ status: 503, word: 'not-ready' })
      expect(await nodeHealth('/readyz', { ...ports, keysNeeded: () => false })).toEqual({
        status: 200,
        word: 'ready',
      })
      expect(
        await nodeHealth('/readyz', {
          ...ports,
          isKeyStoreSealed: () => false,
          journalsReadable: () => Promise.resolve(false),
        }),
      ).toEqual({ status: 503, word: 'not-ready' })
      vi.spyOn(state.files, 'write').mockRejectedValue(new Error('test disk failure'))
      expect(await nodeHealth('/readyz', { ...ports, keysNeeded: () => false })).toEqual({
        status: 503,
        word: 'not-ready',
      })
    },
  )
})
