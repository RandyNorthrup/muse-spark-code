// M117 provisioning lifecycle, Slice 2: exact quotes, the hard run budget,
// one frozen confirmation per spend, and liability discipline — all without
// a provider. The provider and node ports below are tripwires that fail the
// test on contact: no provider exists until M109/M110d/M110f land, so every
// create/install/teardown path stays unrun and is named as waiting in
// docs/certification/m117-p-spin-it-up.md. Repository default timeout.
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { compareUsdNanos, usdNanos, type UsdNanos } from '../../src/shared/usd'
import type { ProvisionQuote, ProvisionRequest } from '../../src/core/estimator/provision/lifecycle'
import {
  EstimateProvisioner,
  quoteProvisioning,
} from '../../src/core/estimator/provision/lifecycle'
import type {
  EstimateNodePort,
  EstimateProviderPort,
  ProviderImage,
  ProviderSize,
} from '../../src/shared/estimate'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'

const CLOUD_INIT = '#cloud-config\nruncmd: [echo installed]'
const SIZE: ProviderSize = { id: 'large', classId: 'linux-x64-large', hourlyUsd: 0.07 }
const IMAGE: ProviderImage = { id: 'container', os: 'linux', architecture: 'x64' }
const REQUEST: ProvisionRequest = {
  size: SIZE,
  image: IMAGE,
  cloudInit: CLOUD_INIT,
  maxBilledHours: 3,
}

function unreachable(what: string): Error {
  return new Error(`under test without a provider: ${what} must never be contacted`)
}

/** Ports that fail loudly on contact: the paths under test make no port calls. */
function tripwires(): {
  provider: EstimateProviderPort
  node: EstimateNodePort
} {
  const provider: EstimateProviderPort = {
    id: 'tripwire',
    apiOrigin: 'https://provider.invalid',
    endpoints: [],
    sizes: () => {
      throw unreachable('sizes')
    },
    images: () => {
      throw unreachable('images')
    },
    create: () => {
      throw unreachable('create')
    },
    status: () => {
      throw unreachable('status')
    },
    delete: () => {
      throw unreachable('delete')
    },
  }
  const node: EstimateNodePort = {
    install: () => {
      throw unreachable('install')
    },
    pair: () => {
      throw unreachable('pair')
    },
    teardownAndWipe: () => {
      throw unreachable('teardownAndWipe')
    },
  }
  return { provider, node }
}

function provisioner(
  budget = '1',
  isSpendConfirmed: (message: string, quote: ProvisionQuote) => Promise<boolean> = () =>
    Promise.resolve(false),
): EstimateProvisioner {
  setUiText(EN, BASE_LOCALE)
  const { provider, node } = tripwires()
  return new EstimateProvisioner(provider, node, isSpendConfirmed, budget)
}

function isNanos(value: unknown): value is UsdNanos {
  return (
    value !== null && typeof value === 'object' && typeof (value as UsdNanos).numerator === 'bigint'
  )
}

describe('M117 provisioning lifecycle without a provider', () => {
  it('quotes exact nano-USD fractions per server with the batch total', () => {
    const preview = quoteProvisioning([{ ...REQUEST }, { ...REQUEST, maxBilledHours: 0.5 }])
    expect(preview.quotes).toHaveLength(2)
    // Decimal fractions stay exact: no binary hourly arithmetic.
    expect(compareUsdNanos(preview.quotes[0]!.cost, usdNanos(0.21))).toBe(0)
    expect(compareUsdNanos(preview.quotes[1]!.cost, usdNanos(0.035))).toBe(0)
    expect(compareUsdNanos(preview.total, usdNanos(0.245))).toBe(0)
    expect(preview.totalUsd).toBe(0.245)
    for (const quote of preview.quotes) {
      expect(isNanos(quote.cost)).toBe(true)
      expect(quote.costUsd).toBeGreaterThan(0)
    }
  })

  it('refuses an empty batch, a blank cloud-init and non-positive hours', () => {
    expect(() => quoteProvisioning([])).toThrow()
    expect(() => quoteProvisioning([{ ...REQUEST, cloudInit: '  ' }])).toThrow()
    expect(() => quoteProvisioning([{ ...REQUEST, maxBilledHours: 0 }])).toThrow()
    expect(() => quoteProvisioning([{ ...REQUEST, maxBilledHours: -2 }])).toThrow()
  })

  it('requires a representable budget before reading anything', () => {
    expect(() => provisioner('nope')).toThrow(UI_TEXT.estimateBudgetRequired)
    expect(() => provisioner('')).toThrow(UI_TEXT.estimateBudgetRequired)
    // Nine liability decimals: a tenth of a nano-USD is not representable,
    // which is a different failure from a missing budget.
    expect(() => provisioner('0.0000000001')).toThrow('budget-unrepresentable')
  })

  it('refuses a server past the cap before any confirmation', async () => {
    let confirmed = 0
    const provision = provisioner('0.05', () => {
      confirmed += 1
      return Promise.resolve(true)
    })
    await expect(provision.provision([{ ...REQUEST }])).rejects.toThrow(UI_TEXT.estimateCapExceeded)
    expect(confirmed).toBe(0)
  })

  it('shows every price and the total in the confirmation, then denies', async () => {
    const messages: string[] = []
    const provision = provisioner('1', (message) => {
      messages.push(message)
      return Promise.resolve(false)
    })
    await expect(provision.provision([{ ...REQUEST }])).rejects.toThrow(UI_TEXT.estimateDenied)
    expect(messages).toHaveLength(1)
    // One server at 0.07 USD/h for 3 h: price and total are both 0.21.
    expect(messages[0]).toContain('0.21')
    expect(messages[0]).toContain('1')
  })

  it('hands the confirmation a frozen copy the admission never follows', async () => {
    let isFrozen = false
    const provision = provisioner('1', (_message, quote) => {
      try {
        quote.size.id = 'mutated'
      } catch {
        isFrozen = true
      }
      return Promise.resolve(false)
    })
    await expect(provision.provision([{ ...REQUEST }])).rejects.toThrow(UI_TEXT.estimateDenied)
    expect(isFrozen).toBe(true)
  })

  it('starts with no liability and names unknown servers', async () => {
    const provision = provisioner()
    expect(compareUsdNanos(provision.liability(), usdNanos(0))).toBe(0)
    expect(provision.liabilityUsd()).toBe(0)
    expect(provision.servers()).toEqual([])
    expect(() => provision.describeIdle('missing', '1h')).toThrow('unknown-server:missing')
    await expect(provision.decommission('missing')).rejects.toThrow('unknown-server:missing')
    await expect(provision.settleIdle('missing', 'keep', () => true)).rejects.toThrow(
      'unknown-server:missing',
    )
  })
})
