// M117 confirmed provisioning run without a provider: the budget,
// advice-only gating, request validation and funded-duration math run
// before any provider contact, so tripwire bindings prove the refusals
// make no port calls. Quotes past the tariff read, confirmation, cloud-init
// and execution need a connected provider and stay unrun until the M109
// broker and M110d/M110f bindings land; see
// docs/certification/m117-p-spin-it-up.md. Repository default timeout.
import { describe, expect, it } from 'vitest'
import { EstimateProvisionClock } from '../../src/core/estimator/provision/clock'
import { EstimateServerLifecycle } from '../../src/core/estimator/provision/lifecycle'
import {
  EstimateProvisionRun,
  type EstimateProvisionBindings,
  type EstimateServerRequest,
} from '../../src/core/estimator/provision/run'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { tripwireNode, tripwireProvider, unreachablePort } from './helpers/provisionTripwires'

function bindings(overrides: Partial<EstimateProvisionBindings> = {}): EstimateProvisionBindings {
  setUiText(EN, BASE_LOCALE)
  const node = tripwireNode()
  return {
    providers: [tripwireProvider()],
    nodes: {
      node,
      lifecycle: new EstimateServerLifecycle({
        node,
        now: () => Date.now(),
        notice: () => {
          throw unreachablePort('notice')
        },
      }),
      cloudInit: () => {
        throw unreachablePort('cloudInit')
      },
    },
    now: () => Date.now(),
    showPrices: () => {
      throw unreachablePort('showPrices')
    },
    confirmServer: () => {
      throw unreachablePort('confirmServer')
    },
    ...overrides,
  }
}

const REQUEST: EstimateServerRequest = {
  id: 'one',
  providerId: 'tripwire',
  sizeId: 'large',
  imageId: 'container',
  billedHours: 3,
}

describe('M117 confirmed run without a provider', () => {
  it.each([undefined, -1, NaN, Infinity])(
    'requires an explicit valid budget %s before reading a provider',
    (budget) => {
      expect(() => new EstimateProvisionRun(bindings(), budget)).toThrow(
        UI_TEXT.estimateBudgetRequired,
      )
    },
  )

  it('refuses a duplicated provider without contacting it', () => {
    expect(
      () =>
        new EstimateProvisionRun(
          bindings({ providers: [tripwireProvider(), tripwireProvider()] }),
          1,
        ),
    ).toThrow('duplicate-provider')
  })

  it('stays advice-only without nodes or providers and refuses quotes', async () => {
    const full = bindings()
    const advice = new EstimateProvisionRun(
      {
        providers: full.providers,
        now: full.now,
        showPrices: full.showPrices,
        confirmServer: full.confirmServer,
      },
      1,
    )
    expect(advice.availability()).toBe('adviceOnly')
    expect(advice.reservedUsd()).toBe(0)
    expect(advice.snapshots()).toEqual([])
    await expect(advice.quote([REQUEST])).rejects.toThrow(UI_TEXT.estimateAdvice)
    const empty = new EstimateProvisionRun(bindings({ providers: [] }), 1)
    expect(empty.availability()).toBe('adviceOnly')
    await expect(empty.quote([REQUEST])).rejects.toThrow(UI_TEXT.estimateAdvice)
  })

  it('refuses unknown providers and malformed requests before any port call', async () => {
    const run = new EstimateProvisionRun(bindings(), 1)
    await expect(run.quote([{ ...REQUEST, providerId: 'unconnected' }])).rejects.toThrow(
      'provider-not-connected',
    )
    expect(() => run.quote([{ ...REQUEST }, { ...REQUEST }])).toThrow()
    expect(() => run.quote([{ ...REQUEST, billedHours: 0 }])).toThrow()
    await expect(run.quote([{ ...REQUEST, billedHours: 1e300 }])).rejects.toThrow(
      'invalid-funded-duration',
    )
  })
})

describe('M117 provision clock', () => {
  it('reads a monotonic real clock', () => {
    const clock = new EstimateProvisionClock(() => Date.now(), 'invalid-clock')
    const first = clock.now()
    expect(clock.now()).toBeGreaterThanOrEqual(first)
  })

  it('refuses non-monotonic and unrepresentable reads', () => {
    let now = 100
    const clock = new EstimateProvisionClock(() => now, 'invalid-clock')
    expect(clock.now()).toBe(100)
    now = 99
    expect(() => clock.now()).toThrow('invalid-clock')
    const broken = new EstimateProvisionClock(() => NaN, 'invalid-clock')
    expect(() => broken.now()).toThrow('invalid-clock')
  })
})
