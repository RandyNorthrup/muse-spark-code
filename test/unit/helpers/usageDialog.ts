import { vi } from 'vitest'
import { EMPTY_PAID_TALLY } from '../../../src/shared/paidBoundary'
import { initialUiState } from '../../../src/webview/state/uiState'

export function usageDialogCallbacks() {
  return {
    onInstallMuseCode: vi.fn(),
    onSetupSignIn: vi.fn(),
    onForgetPaidUse: vi.fn(),
    now: () => 0,
    onOpenExternal: vi.fn(),
    onClose: vi.fn(),
  }
}

export function emptySubscriptionUsageDialog() {
  return {
    report: {
      backend: 'museCode' as const,
      subscription: undefined,
      account: undefined,
      insights: undefined,
      providers: undefined,
    },
    usage: undefined,
    context: undefined,
    modelId: undefined,
    modelPricing: undefined,
    paid: { features: [], tally: EMPTY_PAID_TALLY, isKeyStored: false, alwaysAllowed: [] },
    auth: initialUiState.auth,
    ...usageDialogCallbacks(),
  }
}
