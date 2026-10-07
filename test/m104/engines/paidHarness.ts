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

/** Callers own release order: drain dependent paid features before closing this journal. */
export function enginePaidBudget(directory: string) {
  return createRuntimePaidBudget(
    {
      directory,
      now: Date.now,
      capUsd: () => 1,
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
  costOf?: ConstructorParameters<typeof PaidUsage>[1],
  gateOverrides: Partial<PaidFeatureGateDeps> = {},
) {
  const state = { isOn: true, isAvailable: true, isCurrent: true, canRemember: true }
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
    isSettingOn: (feature) => state.isOn && features.includes(feature),
    isAvailable: () => state.isAvailable,
    isDefaultOn: () => true,
    setSetting: () => Promise.resolve(),
    readAccepted: () => new Set(PAID_FEATURES),
    writeAccepted: () => Promise.resolve(),
    confirm: () => Promise.resolve(false),
    isWindowFocused: () => true,
    log,
    ...gateOverrides,
  })
  const usage = new PaidUsage(log, costOf)
  const paid = new RuntimePaidUse({
    gate,
    usage,
    grants,
    isSettingOn: (feature) => state.isOn && features.includes(feature),
    canRemember: () => state.canRemember,
    isCurrent: () => state.isCurrent,
    log,
  })
  const ask = vi.fn<PaidUseAsker>(() => Promise.resolve('once'))
  paid.attach(ask)
  return { paid, ask, usage, state, granted, grants }
}
