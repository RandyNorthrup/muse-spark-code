import { describe, expect, it, vi } from 'vitest'
import { ResourceEvents } from '../../src/core/resources/events'
import {
  ResourceRelocator,
  canAdmitResourceRelocation,
  type ResourceRelocationOptions,
  type ResourceRelocationTarget,
  type ResourceRelocationWork,
} from '../../src/core/resources/relocate'
import {
  deviceResourceSchema,
  resourceEventSchema,
  resourceKindSchema,
  resourceRecordSchema,
  resourceSettingsSchema,
  type ResourceEvent,
  type ResourceKind,
  type ResourceLevel,
  type ResourceStatus,
} from '../../src/shared/resources'
import { FakeResourceClock, FakeResourceLinkedDevice } from './helpers/resources/fakes'

function setup(kind: ResourceKind = 'worker', phase: 'queued' | 'running' = 'queued') {
  const clock = new FakeResourceClock()
  const errors = vi.fn()
  const events = new ResourceEvents(errors)
  const seen: ResourceEvent[] = []
  events.subscribe((event) => {
    seen.push(event)
  })
  const status: ResourceStatus = {
    level: 'relocate',
    sample: null,
    settings: resourceSettingsSchema.parse({}),
    queued: [],
    overrideUntilMs: null,
  }
  let currentPhase = phase
  let isOwned = false
  const work: ResourceRelocationWork = {
    repository: 'approved-repository',
    kind,
    heavy: true,
    phase: () => currentPhase,
    claim: vi.fn(() => {
      if (isOwned) return false
      isOwned = true
      return true
    }),
    settle: vi.fn((result) => {
      if (result === 'kept') isOwned = false
    }),
    retire: vi.fn(() => Promise.resolve(true)),
  }
  const device = new FakeResourceLinkedDevice()
  device.offer(work.repository, ['worker', 'check'])
  const target: ResourceRelocationTarget = {
    id: 'paired-device',
    type: 'paired',
    resource: vi.fn(() => device.resource()),
    hasOffer: vi.fn<ResourceRelocationTarget['hasOffer']>((repository, offeredKind) =>
      device.hasOffer(repository, offeredKind),
    ),
    dispatch: vi.fn<ResourceRelocationTarget['dispatch']>(async (_metadata, signal) => {
      if (signal.aborted) return 'refused'
      return (await device.admit(work.repository, kind === 'worker' ? 'worker' : 'check'))
        ? 'admitted'
        : 'refused'
    }),
  }
  const options: ResourceRelocationOptions = {
    clock,
    events,
    status: () => status,
    headless: false,
    devicesEnabled: vi.fn(() => true),
    devices: vi.fn(() => [target]),
    runnersEnabled: vi.fn(() => false),
    runners: vi.fn(() => []),
    ask: vi.fn(() => Promise.resolve(true)),
    row: vi.fn(),
    notice: vi.fn(),
    traffic: vi.fn(),
    onError: errors,
  }
  const relocator = new ResourceRelocator(options)
  const attempt = relocator.create(work)
  return {
    clock,
    errors,
    events,
    seen,
    status,
    work,
    device,
    target,
    options,
    relocator,
    attempt,
    phase: (next: 'queued' | 'running') => {
      currentPhase = next
    },
    isOwned: () => isOwned,
  }
}

function askOnRecheck(f: ReturnType<typeof setup>): void {
  let reads = 0
  f.target.resource = vi.fn(() => {
    if (++reads === 2) f.status.settings.relocate = 'ask'
    return f.device.resource()
  })
}

async function keepDuringAdmission(f: ReturnType<typeof setup>) {
  const reply = Promise.withResolvers<Awaited<ReturnType<ResourceRelocationTarget['dispatch']>>>()
  const entered = Promise.withResolvers<AbortSignal>()
  f.target.dispatch = (_metadata, signal) => {
    entered.resolve(signal)
    return reply.promise
  }
  const moving = f.attempt.run()
  const signal = await entered.promise
  const keeping = f.attempt.keepHere()
  expect(signal.aborted).toBe(true)
  expect(f.work.settle).not.toHaveBeenCalled()
  return { reply, moving, keeping }
}

describe('resource relocation', () => {
  it('routes an offered queued worker with a row before dispatch and all move records', async () => {
    const f = setup()
    const order: string[] = []
    f.clock.advance(100)
    f.options.row = vi.fn(() => {
      order.push('row')
    })
    f.target.dispatch = vi.fn<ResourceRelocationTarget['dispatch']>((metadata) => {
      order.push('dispatch')
      expect(metadata).toEqual({ reason: 'machineBusy', level: 'relocate' })
      return Promise.resolve('admitted')
    })
    expect(await f.attempt.run()).toBe('admitted')
    expect(order).toEqual(['row', 'dispatch'])
    const event = {
      type: 'relocated',
      atMs: 100,
      kind: 'worker',
      level: 'relocate',
      reason: 'machineBusy',
    }
    expect(f.seen).toEqual([event])
    expect(f.options.traffic).toHaveBeenCalledExactlyOnceWith(f.target, event)
    expect(f.options.notice).toHaveBeenCalledExactlyOnceWith(f.target)
    expect(f.work.settle).toHaveBeenCalledExactlyOnceWith('admitted')
    expect(f.work.retire).not.toHaveBeenCalled()
  })

  it.each(['off', 'disabled', 'headless', 'devicesOff', 'noOffer'])(
    'has no device activity for %s',
    async (setting) => {
      const f = setup()
      switch (setting) {
        case 'off': {
          f.status.settings.relocate = 'off'
          break
        }
        case 'disabled': {
          f.status.settings.enabled = false
          break
        }
        case 'headless': {
          f.options.headless = true
          break
        }
        case 'devicesOff': {
          f.options.devicesEnabled = () => false
          break
        }
        case 'noOffer': {
          {
            f.device.revoke(f.work.repository)
            // No default
          }
          break
        }
      }
      expect(await f.attempt.run()).toBe('kept')
      if (setting !== 'noOffer') expect(f.options.devices).not.toHaveBeenCalled()
      expect(f.target.resource).not.toHaveBeenCalled()
      expect(f.target.dispatch).not.toHaveBeenCalled()
      expect(f.options.ask).not.toHaveBeenCalled()
      expect(f.options.row).not.toHaveBeenCalled()
      expect(f.seen).toEqual([])
    },
  )

  it.each<ResourceLevel>(['normal', 'throttle'])(
    'keeps automatic work local at %s',
    async (level) => {
      const f = setup()
      f.status.level = level
      expect(await f.attempt.run()).toBe('kept')
      expect(f.options.devices).not.toHaveBeenCalled()
      expect(f.work.claim).not.toHaveBeenCalled()
    },
  )

  it.each(resourceKindSchema.options.filter((kind) => kind !== 'worker' && kind !== 'check'))(
    'never relocates %s',
    async (kind) => {
      const f = setup(kind)
      expect(await f.attempt.run(f.target.id)).toBe('kept')
      expect(f.options.devices).not.toHaveBeenCalled()
      expect(f.work.claim).not.toHaveBeenCalled()
    },
  )

  it.each<ResourceLevel>(['throttle', 'relocate', 'pause'])(
    'refuses a receiver at %s even with an offer',
    async (level) => {
      const f = setup()
      f.device.setResource({ level, headroom: 'ample' })
      expect(await f.attempt.run()).toBe('kept')
      expect(f.target.dispatch).not.toHaveBeenCalled()
      expect(canAdmitResourceRelocation(level)).toBe(false)
    },
  )

  it('refuses no headroom and malformed peer status with planted private fields', async () => {
    const f = setup()
    f.device.setResource({ level: 'normal', headroom: 'none' })
    expect(await f.attempt.run()).toBe('kept')
    for (const payload of [
      { level: 'normal', headroom: 'ample', pid: 777, path: '/private/canary' },
      { level: 'unknown', headroom: 'ample' },
      { level: 'normal', headroom: 'unlimited' },
      null,
    ]) {
      f.target.resource = () => Promise.resolve(payload)
      expect(await f.relocator.create(f.work).run()).toBe('kept')
    }
    expect(f.target.dispatch).not.toHaveBeenCalled()
    expect(canAdmitResourceRelocation('normal')).toBe(true)
    expect(canAdmitResourceRelocation('unknown')).toBe(false)
  })

  it('prefers ample over some and preserves pool order for equal headroom', async () => {
    const f = setup()
    f.device.setResource({ level: 'normal', headroom: 'some' })
    const ample = {
      ...f.target,
      id: 'ample',
      resource: () => Promise.resolve({ level: 'normal', headroom: 'ample' }),
      dispatch: vi.fn<ResourceRelocationTarget['dispatch']>(() =>
        Promise.resolve('admitted' as const),
      ),
    }
    const later = {
      ...ample,
      id: 'later',
      resource: vi.fn(() => ample.resource()),
      dispatch: vi.fn<ResourceRelocationTarget['dispatch']>((metadata, signal) =>
        ample.dispatch(metadata, signal),
      ),
    }
    f.options.devices = () => [f.target, ample, later]
    expect(await f.attempt.run()).toBe('admitted')
    expect(ample.dispatch).toHaveBeenCalledOnce()
    expect(f.target.dispatch).not.toHaveBeenCalled()
    expect(later.resource).not.toHaveBeenCalled()
    const g = setup()
    g.device.setResource({ level: 'normal', headroom: 'some' })
    g.options.devices = () => [g.target, { ...g.target, id: 'second' }]
    expect(await g.attempt.run()).toBe('admitted')
    expect(g.options.row).toHaveBeenCalledWith(g.work, g.target, expect.anything())
  })

  it.each([true, false])('asks in ask mode and honors the answer %s', async (allowed) => {
    const f = setup()
    f.status.settings.relocate = 'ask'
    f.options.ask = vi.fn(() => Promise.resolve(allowed))
    expect(await f.attempt.run()).toBe(allowed ? 'admitted' : 'kept')
    expect(f.options.ask).toHaveBeenCalledExactlyOnceWith(f.work, f.target)
    expect(f.target.dispatch).toHaveBeenCalledTimes(allowed ? 1 : 0)
  })

  it('Keep here before a run is sticky and starts no pool activity', async () => {
    const f = setup()
    expect(await f.attempt.keepHere()).toBe(true)
    expect(await f.attempt.run()).toBe('kept')
    expect(f.options.devices).not.toHaveBeenCalled()
  })

  it.each(['keep', 'off', 'devicesOff', 'recovery', 'revoke', 'started'])(
    'rechecks %s after an asynchronous choice',
    async (change) => {
      const f = setup()
      f.status.settings.relocate = 'ask'
      const asked = Promise.withResolvers<boolean>()
      const entered = Promise.withResolvers<undefined>()
      f.options.ask = () => {
        entered.resolve(undefined)
        return asked.promise
      }
      const running = f.attempt.run()
      await entered.promise
      expect(f.target.resource).toHaveBeenCalledOnce()
      let keeping: Promise<boolean> | undefined
      switch (change) {
        case 'keep': {
          keeping = f.attempt.keepHere()
          break
        }
        case 'off': {
          f.status.settings.relocate = 'off'
          break
        }
        case 'devicesOff': {
          f.options.devicesEnabled = () => false
          break
        }
        case 'recovery': {
          f.status.level = 'normal'
          break
        }
        case 'revoke': {
          f.device.revoke(f.work.repository)
          break
        }
        case 'started': {
          {
            f.phase('running')
            // No default
          }
          break
        }
      }
      asked.resolve(true)
      expect(await running).toBe('kept')
      if (keeping !== undefined) expect(await keeping).toBe(true)
      expect(f.target.dispatch).not.toHaveBeenCalled()
      expect(f.options.row).not.toHaveBeenCalled()
      expect(f.errors).not.toHaveBeenCalled()
    },
  )

  it('requires new ask consent when mode changes during the headroom read', async () => {
    const f = setup()
    askOnRecheck(f)
    f.options.ask = vi.fn(() => Promise.resolve(false))
    expect(await f.attempt.run()).toBe('kept')
    expect(f.options.ask).toHaveBeenCalledOnce()
    expect(f.target.dispatch).not.toHaveBeenCalled()
  })

  it.each(['offer', 'level', 'headroom'])(
    'rechecks the receiver %s after selection',
    async (change) => {
      const f = setup()
      f.status.settings.relocate = 'ask'
      f.options.ask = () => {
        if (change === 'offer') f.device.revoke(f.work.repository)
        else if (change === 'level') f.device.setResource({ level: 'throttle', headroom: 'ample' })
        else f.device.setResource({ level: 'normal', headroom: 'none' })
        return Promise.resolve(true)
      }
      expect(await f.attempt.run()).toBe('kept')
      expect(f.target.dispatch).not.toHaveBeenCalled()
    },
  )

  it.each(['keep', 'off', 'revoke', 'started', 'level', 'ask'])(
    'refuses reentrant %s from the row before dispatch',
    async (change) => {
      const f = setup()
      let keeping: Promise<boolean> | undefined
      f.options.row = () => {
        switch (change) {
          case 'keep': {
            keeping = f.attempt.keepHere()
            break
          }
          case 'off': {
            f.status.settings.relocate = 'off'
            break
          }
          case 'revoke': {
            f.device.revoke(f.work.repository)
            break
          }
          case 'started': {
            f.phase('running')
            break
          }
          case 'level': {
            f.status.level = 'pause'
            break
          }
          case 'ask': {
            {
              f.status.settings.relocate = 'ask'
              // No default
            }
            break
          }
        }
      }
      expect(await f.attempt.run()).toBe('kept')
      if (keeping !== undefined) expect(await keeping).toBe(true)
      expect(f.target.dispatch).not.toHaveBeenCalled()
    },
  )

  it.each(['off', 'cancel', 'ask', 'level', 'started', 'disabled'])(
    'rechecks %s after the final synchronous offer callback',
    async (change) => {
      const f = setup()
      let keeping: Promise<boolean> | undefined
      let offers = 0
      f.target.hasOffer = vi.fn(() => {
        if (++offers === 3) {
          switch (change) {
            case 'off': {
              f.status.settings.relocate = 'off'
              break
            }
            case 'cancel': {
              keeping = f.attempt.keepHere()
              break
            }
            case 'ask': {
              f.status.settings.relocate = 'ask'
              break
            }
            case 'level': {
              f.status.level = 'pause'
              break
            }
            case 'started': {
              f.phase('running')
              break
            }
            default: {
              f.status.settings.enabled = false
            }
          }
        }
        return true
      })
      expect(await f.attempt.run()).toBe('kept')
      if (keeping !== undefined) expect(await keeping).toBe(true)
      expect(f.target.hasOffer).toHaveBeenCalledTimes(3)
      expect(f.options.row).toHaveBeenCalledOnce()
      expect(f.target.dispatch).not.toHaveBeenCalled()
      expect(f.work.settle).toHaveBeenCalledExactlyOnceWith('kept')
      expect(f.errors).not.toHaveBeenCalled()
    },
  )

  it('refuses invisible moves if the required row cannot be installed', async () => {
    const f = setup()
    f.options.row = () => {
      throw new Error('Row unavailable')
    }
    expect(await f.attempt.run()).toBe('kept')
    expect(f.errors).toHaveBeenCalledOnce()
    expect(f.target.dispatch).not.toHaveBeenCalled()
  })

  it.each(['worker', 'check'] as const)('never automatically moves a running %s', async (kind) => {
    const f = setup(kind, 'running')
    expect(await f.attempt.run()).toBe('kept')
    expect(f.work.retire).not.toHaveBeenCalled()
    expect(f.options.devices).not.toHaveBeenCalled()
    if (kind === 'worker') expect(await f.relocator.create(f.work).run(f.target.id)).toBe('kept')
  })

  it('Move to dispatches the named check target only after proved local retirement', async () => {
    const f = setup('check', 'running')
    f.status.level = 'throttle'
    f.status.settings.relocate = 'ask'
    const retired = Promise.withResolvers<boolean>()
    const entered = Promise.withResolvers<undefined>()
    f.work.retire = vi.fn(() => {
      entered.resolve(undefined)
      return retired.promise
    })
    const other = {
      ...f.target,
      id: 'other',
      resource: vi.fn(() => f.target.resource()),
      dispatch: vi.fn<ResourceRelocationTarget['dispatch']>((metadata, signal) =>
        f.target.dispatch(metadata, signal),
      ),
    }
    f.options.devices = () => [other, f.target]
    const moving = f.attempt.run(f.target.id)
    await entered.promise
    expect(f.target.dispatch).not.toHaveBeenCalled()
    expect(f.options.row).not.toHaveBeenCalled()
    expect(f.isOwned()).toBe(true)
    retired.resolve(true)
    expect(await moving).toBe('admitted')
    expect(f.work.retire).toHaveBeenCalledOnce()
    expect(f.options.ask).not.toHaveBeenCalled()
    expect(other.resource).not.toHaveBeenCalled()
    expect(other.dispatch).not.toHaveBeenCalled()
    expect(f.seen[0]).toMatchObject({ kind: 'check', level: 'throttle' })
  })

  it.each(['missing', 'false', 'throws'])(
    'does not move without retirement proof (%s)',
    async (proof) => {
      const f = setup('check', 'running')
      switch (proof) {
        case 'missing': {
          delete f.work.retire
          break
        }
        case 'false': {
          f.work.retire = () => Promise.resolve(false)
          break
        }
        case 'throws': {
          {
            f.work.retire = () => Promise.reject(new Error('Retirement unknown'))
            // No default
          }
          break
        }
      }
      expect(await f.attempt.run(f.target.id)).toBe(proof === 'missing' ? 'kept' : 'uncertain')
      expect(f.target.dispatch).not.toHaveBeenCalled()
      if (proof !== 'missing') expect(f.isOwned()).toBe(true)
    },
  )

  it('rechecks offer and Keep here after retirement without dispatching', async () => {
    const f = setup('check', 'running')
    f.work.retire = () => {
      f.device.revoke(f.work.repository)
      return Promise.resolve(true)
    }
    expect(await f.attempt.run(f.target.id)).toBe('kept')
    expect(f.target.dispatch).not.toHaveBeenCalled()
    const g = setup('check', 'running')
    let keeping: Promise<boolean> | undefined
    g.work.retire = () => {
      keeping = g.attempt.keepHere()
      return Promise.resolve(true)
    }
    expect(await g.attempt.run(g.target.id)).toBe('kept')
    expect(await keeping).toBe(true)
    expect(g.target.dispatch).not.toHaveBeenCalled()
  })

  it.each(['worker', 'light', 'disabled', 'heavy'])(
    'routes SSH only for an enabled offered heavy check (%s)',
    async (choice) => {
      const f = setup(choice === 'worker' ? 'worker' : 'check')
      const runner: ResourceRelocationTarget = { ...f.target, id: 'runner', type: 'ssh' }
      f.options.devicesEnabled = () => false
      f.options.runnersEnabled = () => choice !== 'disabled'
      f.options.runners = vi.fn(() => [runner])
      const work = choice === 'light' ? { ...f.work, heavy: false } : f.work
      expect(await f.relocator.create(work).run()).toBe(choice === 'heavy' ? 'admitted' : 'kept')
      expect(f.options.devices).not.toHaveBeenCalled()
      expect(f.options.runners).toHaveBeenCalledTimes(choice === 'heavy' ? 1 : 0)
      expect(f.target.dispatch).toHaveBeenCalledTimes(choice === 'heavy' ? 1 : 0)
    },
  )

  it('never replaces an explicitly requested missing or unavailable target', async () => {
    const f = setup('check', 'running')
    expect(await f.attempt.run('not-offered')).toBe('kept')
    expect(f.work.retire).not.toHaveBeenCalled()
    expect(f.target.dispatch).not.toHaveBeenCalled()
  })

  it.each(['refused', 'admitted', 'uncertain'] as const)(
    'Keep here waits for the receiver outcome %s',
    async (outcome) => {
      const f = setup()
      const { reply, moving, keeping } = await keepDuringAdmission(f)
      reply.resolve(outcome)
      expect(await moving).toBe(outcome === 'refused' ? 'kept' : outcome)
      expect(await keeping).toBe(outcome === 'refused')
      expect(f.seen).toHaveLength(outcome === 'admitted' ? 1 : 0)
      expect(f.isOwned()).toBe(outcome !== 'refused')
    },
  )

  it.each(['lost', 'refused'])(
    'never tries a second target after dispatch is %s',
    async (outcome) => {
      const f = setup()
      f.target.dispatch = vi.fn<ResourceRelocationTarget['dispatch']>(() =>
        outcome === 'lost' ? Promise.reject(new Error('Reply lost')) : Promise.resolve('refused'),
      )
      const alternate = {
        ...f.target,
        id: 'alternate',
        dispatch: vi.fn<ResourceRelocationTarget['dispatch']>(() =>
          Promise.resolve('admitted' as const),
        ),
      }
      f.options.devices = () => [f.target, alternate]
      const first = f.attempt.run()
      expect(f.attempt.run(alternate.id)).toBe(first)
      expect(await first).toBe(outcome === 'lost' ? 'uncertain' : 'kept')
      expect(await f.attempt.run()).toBe(outcome === 'lost' ? 'uncertain' : 'kept')
      expect(f.target.dispatch).toHaveBeenCalledOnce()
      expect(alternate.dispatch).not.toHaveBeenCalled()
      expect(f.work.settle).toHaveBeenCalledTimes(1)
      if (outcome !== 'lost') {
        return
      }

      expect(await f.attempt.keepHere()).toBe(false)
      expect(f.isOwned()).toBe(true)
      expect(await f.relocator.create(f.work).run()).toBe('kept')
      expect(f.work.settle).toHaveBeenCalledTimes(1)
    },
  )

  it('treats probe failure as unavailable and selects another already offered target', async () => {
    const f = setup()
    f.target.resource = () => Promise.reject(new Error('Probe unavailable'))
    const good = { ...f.target, id: 'good', resource: () => f.device.resource() }
    f.options.devices = () => [f.target, good]
    expect(await f.attempt.run()).toBe('admitted')
    expect(f.errors).toHaveBeenCalledOnce()
    expect(f.options.row).toHaveBeenCalledWith(f.work, good, expect.anything())
  })

  it('notifies once per conversation and records every move despite a failing observer', async () => {
    const f = setup()
    f.options.traffic = vi.fn(() => {
      throw new Error('Traffic observer failed')
    })
    expect(await f.attempt.run()).toBe('admitted')
    const next = { ...f.work, claim: () => true, settle: vi.fn() }
    expect(await f.relocator.create(next).run()).toBe('admitted')
    expect(f.options.notice).toHaveBeenCalledOnce()
    expect(f.options.traffic).toHaveBeenCalledTimes(2)
    expect(f.seen).toHaveLength(2)
    expect(f.errors).toHaveBeenCalledTimes(2)
    const other = new ResourceRelocator(f.options)
    expect(await other.create(next).run()).toBe('admitted')
    expect(f.options.notice).toHaveBeenCalledTimes(2)
  })

  it('only adds reason and level to dispatch; journal and Traffic exclude private canaries', async () => {
    const f = setup('check')
    const privateWork = {
      ...f.work,
      repository: String.raw`C:\private\canary`,
      pid: 777,
      processName: 'canary-process',
      command: 'canary-command',
      environment: { CANARY: 'private' },
    }
    f.device.offer(privateWork.repository, ['check'])
    f.target.dispatch = vi.fn<ResourceRelocationTarget['dispatch']>((metadata) => {
      expect(Object.keys(metadata).toSorted((a, b) => a.localeCompare(b))).toEqual([
        'level',
        'reason',
      ])
      expect(JSON.stringify(metadata)).not.toContain('canary')
      return Promise.resolve('admitted')
    })
    expect(await f.relocator.create(privateWork).run()).toBe('admitted')
    const event = f.seen[0]
    expect(resourceEventSchema.parse(event)).toEqual(event)
    const record = resourceRecordSchema.parse({
      type: 'resource',
      atMs: 0,
      minute: null,
      event,
      work: [],
    })
    expect(JSON.stringify(record)).not.toContain('canary')
    expect(f.options.traffic).toHaveBeenCalledWith(f.target, event)
    expect(deviceResourceSchema.parse(await f.target.resource())).toEqual({
      level: 'normal',
      headroom: 'ample',
    })
  })

  it('the receiver refuses a load change at final admission after a normal routing probe', async () => {
    const f = setup('check')
    f.options.row = () => {
      f.device.setResource({ level: 'throttle', headroom: 'ample' })
    }
    expect(await f.attempt.run()).toBe('kept')
    expect(f.device.admissions).toEqual([
      { repository: f.work.repository, kind: 'check', isAllowed: false },
    ])
    expect(f.seen).toEqual([])
  })

  it.each(['cancel', 'off'])(
    'rechecks %s from the exclusive claim before loading a pool',
    async (change) => {
      const f = setup()
      let keeping: Promise<boolean> | undefined
      f.work.claim = () => {
        if (change === 'cancel') keeping = f.attempt.keepHere()
        else f.status.settings.relocate = 'off'
        return true
      }
      expect(await f.attempt.run()).toBe('kept')
      if (keeping !== undefined) expect(await keeping).toBe(true)
      expect(f.options.devices).not.toHaveBeenCalled()
      expect(f.work.settle).toHaveBeenCalledExactlyOnceWith('kept')
    },
  )

  it('never settles an attempt whose exclusive claim belongs to another owner', async () => {
    const f = setup()
    f.work.claim = () => false
    expect(await f.attempt.run()).toBe('kept')
    expect(f.options.devices).not.toHaveBeenCalled()
    expect(f.work.settle).not.toHaveBeenCalled()
  })

  it('installs its shared promise before a synchronous port reenters run', async () => {
    const f = setup()
    let reentered: Promise<unknown> | undefined
    f.options.status = () => {
      reentered = f.attempt.run('another-target')
      return f.status
    }
    const running = f.attempt.run()
    expect(await running).toBe('admitted')
    expect(reentered).toBe(running)
    expect(f.target.dispatch).toHaveBeenCalledOnce()
    expect(f.work.claim).toHaveBeenCalledOnce()
  })

  it('aborts target iteration after Keep here instead of probing another device', async () => {
    const f = setup()
    let keeping: Promise<boolean> | undefined
    f.target.resource = () => {
      keeping = f.attempt.keepHere()
      return Promise.resolve({ level: 'normal', headroom: 'some' })
    }
    const other = { ...f.target, id: 'other', resource: vi.fn(() => f.device.resource()) }
    f.options.devices = () => [f.target, other]
    expect(await f.attempt.run()).toBe('kept')
    expect(await keeping).toBe(true)
    expect(other.resource).not.toHaveBeenCalled()
  })

  it('rechecks policy after retirement without another device probe', async () => {
    const f = setup('check', 'running')
    f.work.retire = () => {
      f.status.settings.relocate = 'off'
      return Promise.resolve(true)
    }
    expect(await f.attempt.run(f.target.id)).toBe('kept')
    expect(f.target.resource).toHaveBeenCalledOnce()
    expect(f.target.dispatch).not.toHaveBeenCalled()
  })

  it('does not treat a newly observed ask mode as implicit approval', async () => {
    const f = setup()
    askOnRecheck(f)
    f.options.ask = vi.fn(() => {
      f.phase('running')
      return Promise.resolve(true)
    })
    expect(await f.attempt.run()).toBe('kept')
    expect(f.options.ask).toHaveBeenCalledOnce()
    expect(f.target.dispatch).not.toHaveBeenCalled()
    expect(f.options.row).not.toHaveBeenCalled()
    expect(f.errors).not.toHaveBeenCalled()
  })

  it('a lost reply retains ownership even when Keep here requested cancellation', async () => {
    const f = setup()
    const { reply, moving, keeping } = await keepDuringAdmission(f)
    reply.reject(new DOMException('Cancellation reply lost', 'AbortError'))
    expect(await moving).toBe('uncertain')
    expect(await keeping).toBe(false)
    expect(f.attempt.run()).toBe(moving)
    expect(await f.attempt.run()).toBe('uncertain')
    expect(f.work.settle).toHaveBeenCalledExactlyOnceWith('uncertain')
    expect(f.isOwned()).toBe(true)
  })

  it('retries a failed notice on the next move while keeping Traffic and journal independent', async () => {
    const f = setup()
    f.options.notice = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('Notice unavailable')
      })
      .mockImplementation(() => undefined)
    expect(await f.attempt.run()).toBe('admitted')
    const next = { ...f.work, claim: () => true, settle: vi.fn() }
    expect(await f.relocator.create(next).run()).toBe('admitted')
    expect(await f.relocator.create(next).run()).toBe('admitted')
    expect(f.options.notice).toHaveBeenCalledTimes(2)
    expect(f.options.traffic).toHaveBeenCalledTimes(3)
    expect(f.seen).toHaveLength(3)
  })

  it('a Traffic observer cannot mutate the journal event', async () => {
    const f = setup()
    f.options.traffic = (_target, event) => {
      event.atMs = 777
    }
    expect(await f.attempt.run()).toBe('admitted')
    expect(f.seen[0]).toMatchObject({ atMs: 0 })
  })

  it.each(['worker', 'light', 'disabled'])(
    'refuses a misclassified SSH offer for %s',
    async (choice) => {
      const f = setup(choice === 'worker' ? 'worker' : 'check')
      const runner: ResourceRelocationTarget = { ...f.target, type: 'ssh' }
      f.options.devices = () => [runner]
      f.options.runnersEnabled = () => choice !== 'disabled'
      const work = { ...f.work, heavy: choice !== 'light' }
      expect(await f.relocator.create(work).run()).toBe('kept')
      expect(f.target.resource).not.toHaveBeenCalled()
      expect(f.target.dispatch).not.toHaveBeenCalled()
    },
  )

  it('refuses a task whose kind becomes ineligible while waiting for consent', async () => {
    const f = setup()
    const work = { ...f.work }
    f.status.settings.relocate = 'ask'
    f.target.hasOffer = () => true
    f.options.ask = () => {
      work.kind = 'backgroundTask'
      return Promise.resolve(true)
    }
    expect(await f.relocator.create(work).run()).toBe('kept')
    expect(f.target.dispatch).not.toHaveBeenCalled()
  })

  it('rechecks recovery after consent newly required during a headroom read', async () => {
    const f = setup()
    askOnRecheck(f)
    f.options.ask = () => {
      f.status.level = 'normal'
      return Promise.resolve(true)
    }
    expect(await f.attempt.run()).toBe('kept')
    expect(f.target.dispatch).not.toHaveBeenCalled()
    expect(f.options.row).not.toHaveBeenCalled()
    expect(f.errors).not.toHaveBeenCalled()
  })

  it('binds the pool factory to the exact task instead of treating a generic role offer as authority', async () => {
    const f = setup()
    f.options.devices = vi.fn<ResourceRelocationOptions['devices']>((work) => [
      {
        ...f.target,
        hasOffer: (repository, kind) => work === f.work && f.device.hasOffer(repository, kind),
      },
    ])
    const unapproved = { ...f.work }
    expect(await f.relocator.create(unapproved).run()).toBe('kept')
    expect(f.target.resource).not.toHaveBeenCalled()
    expect(f.target.dispatch).not.toHaveBeenCalled()
    expect(f.options.devices).toHaveBeenCalledExactlyOnceWith(unapproved)
    expect(await f.attempt.run()).toBe('admitted')
  })

  it('a row adapter cannot change the reason that will be dispatched', async () => {
    const f = setup()
    f.options.row = (_work, _target, metadata) => {
      Object.assign(metadata, { reason: 'canary-reason' })
    }
    expect(await f.attempt.run()).toBe('kept')
    expect(f.errors).toHaveBeenCalledOnce()
    expect(f.target.dispatch).not.toHaveBeenCalled()
  })

  it('Keep here confirms no remote admission even when local retirement remains uncertain', async () => {
    const f = setup('check', 'running')
    const retirement = Promise.withResolvers<boolean>()
    const entered = Promise.withResolvers<undefined>()
    f.work.retire = () => {
      entered.resolve(undefined)
      return retirement.promise
    }
    const moving = f.attempt.run(f.target.id)
    await entered.promise
    const keeping = f.attempt.keepHere()
    retirement.resolve(false)
    expect(await moving).toBe('uncertain')
    expect(await keeping).toBe(true)
    expect(f.work.settle).toHaveBeenCalledExactlyOnceWith('uncertain')
    expect(f.target.dispatch).not.toHaveBeenCalled()
    expect(f.isOwned()).toBe(true)
  })

  it('rechecks receiver headroom while waiting for newly required consent', async () => {
    const f = setup()
    askOnRecheck(f)
    f.options.ask = () => {
      f.device.setResource({ level: 'normal', headroom: 'none' })
      return Promise.resolve(true)
    }
    expect(await f.attempt.run()).toBe('kept')
    expect(f.target.resource).toHaveBeenCalledTimes(3)
    expect(f.options.row).not.toHaveBeenCalled()
    expect(f.target.dispatch).not.toHaveBeenCalled()
  })
})
