// RELOCATIONJOIN: the runner-route join switch and the governor step-down
// (M107 R). No SSH peer or paired device is involved: the join refuses
// registration until the teams wiring binds one, admission keeps work local
// with no route, and a governor left at relocate steps down to pause the
// moment its last route is lost. The governor samples this machine live.
import { afterEach, describe, expect, it } from 'vitest'
import {
  admitResource,
  configureResources,
  hasResourceRunnerRoutes,
  registerResourceRunnerRoutes,
} from '../../src/core/resources/admission'
import { ResourceEvents } from '../../src/core/resources/events'
import { ResourceGovernor } from '../../src/core/resources/governor'
import { resourceGovernorHost } from '../../src/core/resources/resourceGovernorEntry'
import { createMachineResourceSampler } from '../../src/core/resources/sampler/system'
import { RESOURCE_ESCALATE_MS, RESOURCE_MIN_DWELL_MS } from '../../src/shared/constants'
import { resourceSettingsSchema, type ResourceSettings } from '../../src/shared/resources'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { manualClock } from './resourceHarness'

setUiText(EN, 'en')

function liveSampler(settings: () => ResourceSettings) {
  return createMachineResourceSampler(settings, { timeoutMs: 1000, maxOutputBytes: 64 * 1024 })
}

const disposers: (() => void)[] = []

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
})

describe('runner-route join switch', () => {
  it('refuses registration until the teams wiring binds a route', () => {
    expect(hasResourceRunnerRoutes()).toBe(false)
    // Refused: no route was registered, so the returned unregister is a
    // no-op. The mid-assertion is the point: without it a registration
    // that succeeds and is then unregistered would pass this test too.
    const unregister = registerResourceRunnerRoutes(() => true)
    expect(hasResourceRunnerRoutes()).toBe(false)
    unregister()
    expect(hasResourceRunnerRoutes()).toBe(false)
  })

  it('keeps admitted work local with no route bound', async () => {
    const errors: unknown[] = []
    disposers.push(
      configureResources({
        inspect: () => ({}),
        onError: (error?: unknown) => {
          errors.push(error)
        },
      }),
    )
    const lease = await admitResource('check', undefined, 'background', false, undefined, true)
    expect(lease).not.toBeUndefined()
    lease?.complete(true)
    expect(errors).toEqual([])
  })
})

describe('governor step-down', () => {
  it('leaves relocate for pause at once when the last route is lost', async () => {
    const { clock, clear, advance } = manualClock()
    const errors: unknown[] = []
    const events = new ResourceEvents((error) => {
      errors.push(error)
    })
    // One percent of memory is always in use on a running machine, so this
    // governor starts pressured while a route exists.
    const settings = resourceSettingsSchema.parse({ memoryMaxPercent: 1 })
    let hasRoute = true
    const governor = new ResourceGovernor({
      clock,
      events,
      settings,
      sampler: liveSampler(() => settings),
      hasRelocationTarget: () => hasRoute,
      onError: (error) => {
        errors.push(error)
      },
    })
    try {
      await governor.refresh()
      expect(governor.status([]).level).toBe('normal')
      // Escalation respects the governor's dwell windows: normal -> throttle
      // on the first window, throttle -> relocate on the second.
      advance(RESOURCE_MIN_DWELL_MS)
      await governor.refresh()
      expect(governor.status([]).level).toBe('throttle')
      advance(RESOURCE_ESCALATE_MS)
      await governor.refresh()
      expect(governor.status([]).level).toBe('relocate')
      expect(governor.status([]).relocation).toBe('available')
      hasRoute = false
      governor.updateRelocationTarget(null)
      expect(governor.status([]).level).toBe('pause')
      expect(governor.status([]).relocation).not.toBe('available')
      expect(errors).toEqual([])
    } finally {
      governor.dispose()
      clear()
    }
  })

  it('rebinds a loaded host without stopping its work', async () => {
    const errors: unknown[] = []
    const host = resourceGovernorHost({
      inspect: () => ({}),
      onError: (error?: unknown) => {
        errors.push(error)
      },
    })
    try {
      const before = await host.admit('check', undefined, 'background', false, undefined, true)
      host.updateRelocationTarget(() => true)
      const after = await host.admit('check', undefined, 'background', false, undefined, true)
      expect(host.backgroundCount('check')).toBe(2)
      before.complete(true)
      after.complete(true)
      expect(host.backgroundCount('check')).toBe(0)
      expect(errors).toEqual([])
    } finally {
      host.dispose()
    }
  })
})
