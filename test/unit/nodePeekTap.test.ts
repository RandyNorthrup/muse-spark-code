// M110b K: the peek tap rings each stream, paces each viewer, marks every
// gap, and scrubs every event on the way out — or delivers nothing.
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { VaultScrubService } from '../../src/core/vault/scrub'
import { createPeekScrubHook } from '../../src/core/peek/scrubHook'
import { PeekTap } from '../../src/core/peek/tap'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { REDACTED_MARK, UI_TEXT } from '../../src/shared/constants'

const STATUS: AgentEvent = { type: 'sessionStatus', status: 'working' }

async function openTap(values: readonly string[] = []): Promise<PeekTap> {
  const service = new VaultScrubService()
  await service.unlock(() => Promise.resolve(values.map((value) => Buffer.from(value))))
  return new PeekTap(createPeekScrubHook(service))
}

describe('peek tap', () => {
  it('names its streams, drops them with their viewers, and refuses caller bugs', async () => {
    const tap = await openTap()
    tap.register('agent-1', 'main conversation')
    tap.register('agent-2', 'team worker 3')
    expect(tap.list()).toEqual([
      { streamId: 'agent-1', label: 'main conversation' },
      { streamId: 'agent-2', label: 'team worker 3' },
    ])
    expect(() => {
      tap.register('agent-1', 'again')
    }).toThrow(/duplicate peek stream/)
    expect(() => {
      tap.offer('no-such-stream', STATUS)
    }).toThrow(/unknown stream/)
    expect(tap.subscribe('no-such-stream', 0)).toBeUndefined()
    await expect(tap.tail('no-such-stream', 5)).resolves.toBeUndefined()
    const viewer = tap.subscribe('agent-1', 0)
    expect(viewer).toBeDefined()
    expect(tap.unregister('agent-1')).toBe(true)
    expect(tap.unregister('agent-1')).toBe(false)
    await expect(viewer?.drain(0)).resolves.toEqual([])
    expect(tap.list()).toEqual([{ streamId: 'agent-2', label: 'team worker 3' }])
  })
  it('streams versioned events in order, paced per viewer, and stops at unsubscribe', async () => {
    const tap = await openTap()
    tap.register('agent-1', 'main')
    const viewer = tap.subscribe('agent-1', 1000)
    expect(viewer).toBeDefined()
    for (let index = 0; index < 3; index += 1) tap.offer('agent-1', STATUS)
    const first = await viewer?.drain(1000)
    expect(first?.map((entry) => entry.seq)).toEqual([0, 1, 2])
    expect(first?.[0]).toMatchObject({ v: 1, streamId: 'agent-1', body: STATUS })
    tap.offer('agent-1', { type: 'skillsChanged' })
    // The fresh bucket held four updates and spent three: one left.
    const fourth = await viewer?.drain(1000)
    expect(fourth?.map((entry) => entry.seq)).toEqual([3])
    tap.offer('agent-1', STATUS)
    expect(await viewer?.drain(1000)).toEqual([])
    // A second later the bucket refills and the paced event lands.
    const refilled = await viewer?.drain(2000)
    expect(refilled?.map((entry) => entry.seq)).toEqual([4])
    viewer?.unsubscribe()
    tap.offer('agent-1', STATUS)
    expect(await viewer?.drain(3000)).toEqual([])
  })
  it('a viewer behind the overwrite gets a skip marker, never the missing events', async () => {
    const tap = await openTap()
    tap.register('agent-1', 'main')
    for (let index = 0; index < 502; index += 1) tap.offer('agent-1', STATUS)
    const viewer = tap.subscribe('agent-1', 0, 0)
    const drained = await viewer?.drain(0)
    expect(drained?.[0]).toMatchObject({ v: 1, streamId: 'agent-1', seq: 0, body: { skipped: 2 } })
    expect(drained?.map((entry) => entry.seq)).toEqual([0, 2, 3, 4])
  })
  it('tails the recent events newest-last for one-shot readers', async () => {
    const tap = await openTap()
    tap.register('agent-1', 'main')
    for (let index = 0; index < 5; index += 1) tap.offer('agent-1', STATUS)
    const tailed = await tap.tail('agent-1', 3)
    expect(tailed?.map((entry) => entry.seq)).toEqual([2, 3, 4])
    const all = await tap.tail('agent-1', 50)
    expect(all?.length).toBe(5)
  })
  it('the byte bound keeps memory in check but never swallows the newest offer', async () => {
    const tap = await openTap()
    tap.register('agent-1', 'main')
    tap.offer('agent-1', STATUS)
    tap.offer('agent-1', {
      type: 'backendNotice',
      level: 'info',
      text: 'x'.repeat(2 * 1024 * 1024),
    })
    const tailed = await tap.tail('agent-1', 10)
    expect(tailed?.map((entry) => entry.seq)).toEqual([1])
  })
  it('streams stay apart: one agent never sees another', async () => {
    const tap = await openTap()
    tap.register('agent-1', 'main')
    tap.register('agent-2', 'worker')
    const viewer = tap.subscribe('agent-2', 0)
    tap.offer('agent-1', STATUS)
    expect(await viewer?.drain(0)).toEqual([])
  })
  it('every drained event passes the scrub service then the redactor', async () => {
    const secret = `peek-test-${randomBytes(16).toString('hex')}`
    const tap = await openTap([secret])
    tap.register('agent-1', 'main')
    tap.offer('agent-1', { type: 'backendNotice', level: 'info', text: `token ${secret} here` })
    const tailed = await tap.tail('agent-1', 5)
    expect(tailed?.[0]?.body).toEqual({
      type: 'backendNotice',
      level: 'info',
      text: `token ${REDACTED_MARK} here`,
    })
  })
  it('without an unlocked scrub service nothing is delivered, with the vault words', async () => {
    const locked = new VaultScrubService()
    const tap = new PeekTap(createPeekScrubHook(locked))
    tap.register('agent-1', 'main')
    tap.offer('agent-1', STATUS)
    await expect(tap.tail('agent-1', 5)).rejects.toThrow(UI_TEXT.vaultScrubUnavailable)
    const viewer = tap.subscribe('agent-1', 0, 0)
    await expect(viewer?.drain(0)).rejects.toThrow(UI_TEXT.vaultScrubUnavailable)
    const missing = new PeekTap(createPeekScrubHook(undefined))
    missing.register('agent-1', 'main')
    missing.offer('agent-1', STATUS)
    await expect(missing.tail('agent-1', 5)).rejects.toThrow(UI_TEXT.vaultScrubUnavailable)
  })
})
