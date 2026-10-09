import { vi } from 'vitest'
import { RuntimePaidUse } from '../../../src/runtime/features/paidUse'
import {
  PaidFeatureGate,
  PaidUsage,
  type PaidFeatureGateDeps,
} from '../../../src/core/paid/paidFeatures'
import type { PaidGrantStore, PaidUseAsker } from '../../../src/acp/paid'
import type { RuntimePaidGrantStore } from '../../../src/runtime/paidGrants'
import { PAID_FEATURES, UI_TEXT, type PaidFeature } from '../../../src/shared/constants'
import { createRuntimePaidBudget } from '../../../src/runtime/features/paidBudget'
import { FakeLogOutputChannel } from '../../unit/helpers/fakes'
import { Usd } from '../../../src/shared/usd'

/** Callers own release order: drain dependent paid features before closing this journal. */
export function enginePaidBudget(directory: string) {
  return createRuntimePaidBudget(
    {
      directory,
      now: Date.now,
      capUsd: () => Usd.from(1).toAmount(),
      sleep: () => Promise.resolve(),
      assertCurrent: () => undefined,
      isLocalStorage: () => true,
    },
    UI_TEXT,
    'en',
  )
}

export function paidHarness(
  features: readonly PaidFeature[] = PAID_FEATURES,
  costOf?: ConstructorParameters<typeof PaidUsage>[2],
  gateOverrides: Partial<PaidFeatureGateDeps> = {},
) {
  const state = { isOn: true, isAvailable: true, isCurrent: true, canRemember: true }
  const settings = new Map<PaidFeature, boolean>()
  const accepted = new Set<PaidFeature>(PAID_FEATURES)
  const granted = new Map<string, Set<PaidFeature>>()
  const grants: RuntimePaidGrantStore = {
    read: (root) => granted.get(root) ?? new Set(),
    add: vi.fn<PaidGrantStore['add']>((root, features) => {
      granted.set(root, new Set([...grants.read(root), ...features]))
      return Promise.resolve()
    }),
    forget: vi.fn<PaidGrantStore['forget']>((features) => {
      for (const [root, held] of granted)
        granted.set(root, new Set([...held].filter((feature) => !features.includes(feature))))
      return Promise.resolve()
    }),
    forgetWorkspace: vi.fn((root: string) => {
      granted.delete(root)
      return Promise.resolve()
    }),
  }
  const log = new FakeLogOutputChannel()
  const gate = new PaidFeatureGate({
    isSettingOn: (feature) => (settings.get(feature) ?? state.isOn) && features.includes(feature),
    isAvailable: () => state.isAvailable,
    isDefaultOn: () => true,
    setSetting: (feature, isOn) => {
      settings.set(feature, isOn)
      return Promise.resolve()
    },
    readAccepted: () => new Set(accepted),
    writeAccepted: (next) => {
      accepted.clear()
      for (const feature of next) accepted.add(feature)
      return Promise.resolve()
    },
    confirm: () => Promise.resolve(false),
    isWindowFocused: () => true,
    log,
    ...gateOverrides,
  })
  const usage = new PaidUsage(log, undefined, costOf)
  const paid = new RuntimePaidUse({
    gate,
    usage,
    grants,
    isSettingOn: (feature) => (settings.get(feature) ?? state.isOn) && features.includes(feature),
    canRemember: () => state.canRemember,
    isCurrent: () => state.isCurrent,
    log,
  })
  const ask = vi.fn<PaidUseAsker>(() => Promise.resolve('once'))
  paid.attach(ask)
  return { paid, ask, usage, state, granted, grants }
}
