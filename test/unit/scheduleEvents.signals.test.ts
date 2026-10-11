import { describe, expect, it, vi } from 'vitest'
import {
  ScheduleHostEvents,
  ScheduleManualSource,
  ScheduleSignalSource,
} from '../../src/core/schedules/events/signals'
import { scheduleDependencySources } from '../../src/core/schedules/events/dependencies'
import type { ScheduleSignalPort, ScheduleWebhookPort } from '../../src/core/schedules/events/ports'
import type {
  ScheduleEvent,
  ScheduleEventKind,
  ScheduleSourceCapability,
} from '../../src/shared/scheduleEvents'

function signalPort() {
  let listener: ((input: unknown) => void) | undefined
  let capability: ScheduleSourceCapability = { available: true }
  const dispose = vi.fn()
  const port: ScheduleSignalPort = {
    capability: () => capability,
    subscribe: (next) => {
      listener = next
      return { dispose }
    },
  }
  return {
    port,
    dispose,
    emit: (event: unknown) => {
      listener?.(event)
    },
    revoke: () => {
      capability = { available: false, reason: 'disabled' }
    },
  }
}
const input = (source: string, kind: ScheduleEventKind) => ({
  source,
  kind,
  eventKey: 'one',
  observedAt: 1,
  fields: { status: 'finished' },
})

describe('host signals, manual fire and milestone capability bindings', () => {
  it.each(['turnFinished', 'laneFinished', 'questionAnswered'] as const)(
    'publishes %s with isolated validated data and disposes',
    async (kind) => {
      const source = new ScheduleHostEvents('agents', [kind])
      const first = vi.fn((event: ScheduleEvent) => {
        event.fields['status'] = 'changed'
      })
      const second = vi.fn()
      const disposable = source.subscribe(first)
      source.subscribe(second)
      source.publish(input('agents', kind))
      expect(second).toHaveBeenCalledWith(input('agents', kind))
      disposable.dispose()
      source.publish(input('agents', kind))
      expect(first).toHaveBeenCalledTimes(1)
      expect(source.capability()).toEqual({ available: true })
      await expect(source.history()).resolves.toMatchObject({ available: false })
      expect(() => {
        source.publish({ ...input('agents', kind), grant: 'shell' })
      }).toThrow()
    },
  )

  it('manual fire has a fresh opaque identity and names only the requested schedule', () => {
    const manual = new ScheduleManualSource('workspace', () => 1)
    const listener = vi.fn<(event: ScheduleEvent) => void>()
    manual.subscribe(listener)
    manual.fire('schedule')
    manual.fire('schedule')
    const [first, second] = listener.mock.calls.map((call) => call[0])
    expect(first).toMatchObject({
      source: 'manual',
      kind: 'manual',
      observedAt: 1,
      fields: { scheduleId: 'schedule' },
    })
    expect(first?.eventKey).not.toEqual(second?.eventKey)
    expect(() => {
      manual.fire('../escape')
    }).toThrow()
  })

  it.each([
    ['resources', 'resourceLevelChanged'],
    ['usage', 'usageThresholdCrossed'],
    ['team', 'taskFinished'],
    ['team', 'teamFinished'],
    ['questions', 'questionAnswered'],
  ] as const)('binds %s / %s without guessing a provider frame', (id, kind) => {
    const signal = signalPort()
    const reject = vi.fn()
    const source = new ScheduleSignalSource(id, [kind], 'milestone', signal.port, reject)
    const listener = vi.fn()
    const subscription = source.subscribe(listener)
    signal.emit(input(id, kind))
    signal.emit({ ...input(id, kind), source: 'foreign' })
    signal.emit({ ...input(id, kind), kind: 'manual' })
    signal.emit({ ...input(id, kind), grant: 'shell' })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(reject).toHaveBeenCalledTimes(3)
    signal.revoke()
    signal.emit(input(id, kind))
    expect(listener).toHaveBeenCalledTimes(1)
    subscription.dispose()
    expect(signal.dispose).toHaveBeenCalledTimes(1)
  })

  it('a disposed source refuses late callbacks even when the host watcher races', () => {
    const signal = signalPort()
    const source = new ScheduleSignalSource('team', ['teamFinished'], 'M96', signal.port, vi.fn())
    const listener = vi.fn()
    source.subscribe(listener).dispose()
    signal.emit(input('team', 'teamFinished'))
    expect(listener).not.toHaveBeenCalled()
  })

  it('lists all missing dependencies as unavailable and refuses subscription/polling', async () => {
    const sources = scheduleDependencySources({}, () => 0, vi.fn())
    expect(sources.map((source) => source.id)).toEqual([
      'plan',
      'github',
      'gitlab',
      'stores',
      'resources',
      'usage',
      'team',
      'questions',
      'webhooks',
    ])
    for (const source of sources) {
      expect(source.capability()).toMatchObject({ available: false, reason: expect.any(String) })
      await expect(source.history({ fromMs: 0, toMs: 1 })).resolves.toMatchObject({
        available: false,
      })
      if (source.subscribe) expect(() => source.subscribe(vi.fn())).toThrow()
      else await expect(source.poll(0)).rejects.toThrow()
    }
  })

  it('webhooks require authenticated M110 admission, including after subscription', () => {
    const signal = signalPort()
    let isAuthenticated = false
    const webhook: ScheduleWebhookPort = { ...signal.port, isAuthenticated: () => isAuthenticated }
    const source = scheduleDependencySources({ webhooks: webhook }, () => 0, vi.fn()).find(
      (entry) => entry.id === 'webhooks',
    )
    expect(source?.capability()).toMatchObject({
      available: false,
      reason: expect.stringContaining('authentication'),
    })
    if (!source?.subscribe) throw new Error('missing webhook source')
    expect(() => source.subscribe(vi.fn())).toThrow()
    isAuthenticated = true
    const listener = vi.fn()
    source.subscribe(listener)
    signal.emit(input('webhooks', 'issueOpened'))
    expect(listener).toHaveBeenCalledTimes(1)
    isAuthenticated = false
    signal.emit(input('webhooks', 'issueOpened'))
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
