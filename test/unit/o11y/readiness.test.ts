// M111 lane OB: the desktop is ready only when every component's probe
// says so and the compositor ping lands within 250 ms; a missing probe
// is not ready, never assumed.
import { describe, expect, it } from 'vitest'
import { O11Y_COMPOSITOR_PING_MAX_MS } from '../../../src/shared/constants'
import { evaluateDesktopReadiness } from '../../../src/core/o11y/readiness'

describe('desktop readiness', () => {
  it('is ready when every probe is ready and the ping lands in time', () => {
    const readiness = evaluateDesktopReadiness([
      { component: 'compositor', ready: true, detail: 'ping-ok', pingMs: 12 },
      { component: 'shell', ready: true, detail: 'surfaces-mapped' },
      { component: 'app', ready: true, detail: 'windows-responsive' },
      { component: 'sysd', ready: true, detail: 'services-connected' },
    ])
    expect(readiness.ready).toBe(true)
    expect(readiness.components.map((item) => item.component)).toEqual([
      'compositor',
      'shell',
      'app',
      'sysd',
    ])
  })

  it('is not ready on a slow ping, a failing probe, or a missing probe', () => {
    const probes = [
      { component: 'compositor', ready: true, detail: 'ping-ok', pingMs: 12 },
      { component: 'shell', ready: true, detail: 'surfaces-mapped' },
      { component: 'app', ready: true, detail: 'windows-responsive' },
      { component: 'sysd', ready: true, detail: 'services-connected' },
    ] as const
    expect(
      evaluateDesktopReadiness([
        { ...probes[0], pingMs: O11Y_COMPOSITOR_PING_MAX_MS + 1 },
        probes[1],
        probes[2],
        probes[3],
      ]).ready,
    ).toBe(false)
    expect(
      evaluateDesktopReadiness([probes[0], { ...probes[1], ready: false }, probes[2], probes[3]])
        .ready,
    ).toBe(false)
    const missing = evaluateDesktopReadiness([probes[0], probes[1], probes[2]])
    expect(missing.ready).toBe(false)
    expect(missing.components[3]).toEqual({
      component: 'sysd',
      ready: false,
      detail: 'no-probe',
    })
  })
})
