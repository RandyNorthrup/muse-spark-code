import { describe, expect, it, vi } from 'vitest'
import { ScheduleNetworkSource } from '../../src/core/schedules/events/network'
import { SchedulePlanSource } from '../../src/core/schedules/events/plan'
import type {
  ScheduleNetworkPort,
  ScheduleNetworkRead,
} from '../../src/core/schedules/events/ports'
import type {
  ScheduleEventHistory,
  ScheduleSourceCapability,
} from '../../src/shared/scheduleEvents'

const event = (source: string, kind = 'pullRequestMerged', observedAt = 1) => ({
  source,
  kind,
  observedAt,
  eventKey: 'one',
  fields: { repository: 'owner/repo', label: 'ready' },
})
function networkPort() {
  let isEnabled = true
  let response: ScheduleNetworkRead = { kind: 'events', etag: 'v1', events: [event('github')] }
  const read = vi.fn(() => Promise.resolve(response))
  const port: ScheduleNetworkPort = {
    capability: () => ({ available: true }),
    isNetworkEnabled: () => isEnabled,
    read,
    history: vi.fn(() => Promise.resolve({ available: true as const, events: [] })),
  }
  return {
    port,
    source: new ScheduleNetworkSource('github', ['pullRequestMerged'], port),
    read,
    disable: () => {
      isEnabled = false
    },
    enable: () => {
      isEnabled = true
    },
    setResponse: (next: ScheduleNetworkRead) => {
      response = next
    },
  }
}

describe('ETag network/store sources and the injected plan reader', () => {
  it.each(['github', 'gitlab', 'stores'] as const)(
    'polls %s with resource ETags, inclusive cursors and immutable cached events',
    async (id) => {
      const network = networkPort()
      const kind = id === 'stores' ? 'versionPublished' : 'pullRequestMerged'
      network.setResponse({
        kind: 'events',
        etag: 'v1',
        events: [event(id, kind), event(id, kind)],
      })
      const source = new ScheduleNetworkSource(id, [kind], network.port)
      expect(await source.poll(1)).toHaveLength(1)
      expect(network.read).toHaveBeenLastCalledWith(undefined)
      network.setResponse({ kind: 'unchanged' })
      const cached = await source.poll(1)
      expect(network.read).toHaveBeenLastCalledWith('v1')
      expect(cached).toHaveLength(1)
      if (cached[0]) cached[0].fields['label'] = 'corrupted'
      expect(await source.poll(1)).toEqual([event(id, kind)])
      expect(await source.poll(2)).toEqual([])
      const range = { fromMs: 0, toMs: 2 }
      await source.history(range)
      expect(network.port.history).toHaveBeenCalledWith(range)
    },
  )

  it('network OFF denies poll/history before IO and forgets its ETag', async () => {
    const network = networkPort()
    const source = network.source
    await source.poll(0)
    network.disable()
    await expect(source.poll(0)).rejects.toThrow('reports.network')
    await expect(source.history({ fromMs: 0, toMs: 1 })).resolves.toMatchObject({
      available: false,
    })
    expect(network.read).toHaveBeenCalledTimes(1)
    expect(network.port.history).not.toHaveBeenCalled()
    network.enable()
    await source.poll(0)
    expect(network.read).toHaveBeenLastCalledWith(undefined)
  })

  it('rejects unchanged without a cached ETag instead of an empty success', async () => {
    const network = networkPort()
    network.setResponse({ kind: 'unchanged' })
    await expect(
      new ScheduleNetworkSource('github', ['pullRequestMerged'], network.port).poll(0),
    ).rejects.toThrow('etagWithoutSnapshot')
  })

  it('revokes a history read while it is in flight', async () => {
    const network = networkPort()
    const pending = Promise.withResolvers<ScheduleEventHistory>()
    vi.spyOn(network.port, 'history').mockReturnValueOnce(pending.promise)
    const source = network.source
    const history = source.history({ fromMs: 0, toMs: 1 })
    network.disable()
    pending.resolve({ available: true, events: [] })
    expect(await history).toMatchObject({ available: false })
  })

  it('revocation during a network read returns no events and does not cache the response', async () => {
    const network = networkPort()
    const pending = Promise.withResolvers<ScheduleNetworkRead>()
    network.read.mockReturnValueOnce(pending.promise)
    const source = network.source
    const poll = source.poll(0)
    network.disable()
    pending.resolve({ kind: 'events', etag: 'secret-free-etag', events: [event('github')] })
    await expect(poll).rejects.toThrow('reports.network')
    network.enable()
    await source.poll(0)
    expect(network.read).toHaveBeenLastCalledWith(undefined)
  })

  it('shares concurrent reads and rejects malformed or foreign projected frames', async () => {
    const network = networkPort()
    const pending = Promise.withResolvers<ScheduleNetworkRead>()
    network.read.mockReturnValueOnce(pending.promise)
    const source = network.source
    const first = source.poll(0)
    const second = source.poll(2)
    expect(network.read).toHaveBeenCalledTimes(1)
    pending.resolve({ kind: 'events', events: [event('github')] })
    expect(await first).toHaveLength(1)
    expect(await second).toEqual([])
    for (const projected of [
      event('foreign'),
      event('github', 'manual'),
      { ...event('github'), grant: 'shell' },
    ]) {
      network.setResponse({ kind: 'events', events: [projected] })
      await expect(source.poll(0)).rejects.toThrow()
    }
  })

  it('rejects an unknown projected response field at the network boundary', async () => {
    const network = networkPort()
    const response = {
      kind: 'events' as const,
      etag: 'one',
      events: [event('github')],
      grant: 'shell',
    }
    network.setResponse(response)
    await expect(
      new ScheduleNetworkSource('github', ['pullRequestMerged'], network.port).poll(0),
    ).rejects.toThrow()
  })

  it('observes status and certification transitions using stable plan revisions', async () => {
    let rows = [{ milestoneId: 'M115', status: 'planned', certified: false, revision: 'one' }]
    let now = 0
    const read = vi.fn(() => Promise.resolve(rows))
    const source = new SchedulePlanSource(
      { capability: () => ({ available: true }), read },
      () => now,
    )
    expect(await source.poll(0)).toEqual([])
    now = 1
    rows = [{ milestoneId: 'M115', status: 'done', certified: true, revision: 'two' }]
    const events = await source.poll(1)
    expect(events.map((item) => item.kind)).toEqual([
      'milestoneStatusChanged',
      'milestoneCertified',
    ])
    expect(events[0]?.eventKey).not.toEqual(events[1]?.eventKey)
    expect(await source.poll(1)).toEqual(events)
    expect(await source.poll(2)).toEqual([])
    await expect(source.history({ fromMs: 0, toMs: 2 })).resolves.toMatchObject({
      available: false,
    })
    rows = [{ milestoneId: 'M115', status: 'done', certified: false, revision: 'three' }]
    expect(await source.poll(2)).toEqual([])
    now = 2
    rows = [{ milestoneId: 'M115', status: 'done', certified: true, revision: 'four' }]
    const recertified = await source.poll(2)
    expect(recertified.map((item) => item.kind)).toEqual(['milestoneCertified'])
    expect(recertified[0]?.eventKey).not.toEqual(events[1]?.eventKey)
    await expect(
      new SchedulePlanSource(
        {
          capability: () => ({ available: true }),
          read: () => Promise.resolve([{ ...rows[0], unsafe: 'field' }]),
        },
        () => now,
      ).poll(0),
    ).rejects.toThrow()
  })

  it('refuses a revoked plan read and does not advance its baseline', async () => {
    let capability: ScheduleSourceCapability = { available: true }
    const pending = Promise.withResolvers<unknown>()
    const source = new SchedulePlanSource(
      { capability: () => capability, read: () => pending.promise },
      () => 0,
    )
    const poll = source.poll(0)
    capability = { available: false, reason: 'plan disabled' }
    pending.resolve([])
    await expect(poll).rejects.toThrow('plan disabled')
  })
})
