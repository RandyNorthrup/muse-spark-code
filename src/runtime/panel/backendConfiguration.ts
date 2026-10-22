import type { VerifiedPaidQuote } from '../../shared/portablePaid'
import type { PaidUseRequest } from '../../shared/paid'
import { createRuntimeHooks } from '../features/hooks'
import { createRuntimeMcp } from '../features/mcp'
import { createRuntimeBrowser } from '../features/browser'
import { createRuntimeAutoReviewer } from '../features/autoReviewer'
import { createRuntimePaidBudget } from '../features/paidBudget'
import { RuntimePaidUse } from '../features/paidUse'
import { runtimePaidRequestAdmission } from '../features/paidRequest'
import type { RuntimeBackendExtensions } from './backendEntry'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'

/** Exact native/catalog contracts. A missing attestation leaves its service unavailable. */
export interface RuntimeBackendConfiguration {
  readonly hooks?: (root: string) => Parameters<typeof createRuntimeHooks>[0]
  readonly hookSettings?: RuntimeBackendExtensions['hookSettings']
  readonly mcp?: (root: string) => Parameters<typeof createRuntimeMcp>[0]
  readonly browser?: (root: string) => Parameters<typeof createRuntimeBrowser>[0]
  readonly autoReviewer?: (root: string) => Parameters<typeof createRuntimeAutoReviewer>[0]
  readonly paid?: {
    readonly budget: Parameters<typeof createRuntimePaidBudget>[0]
    readonly policy: ConstructorParameters<typeof RuntimePaidUse>[0]
    readonly quote: (
      root: string,
      sessionId: string,
      request: PaidUseRequest,
    ) => VerifiedPaidQuote | undefined
    readonly price: Parameters<typeof runtimePaidRequestAdmission>[0]['price']
  }
}
export interface RuntimeConfiguredBackend {
  readonly quote?: NonNullable<RuntimeBackendConfiguration['paid']>['quote']
  readonly extensions: RuntimeBackendExtensions
  /** The root calls this after every backend/client/attempt has drained and settled. */
  readonly disposeAfterBackend: () => Promise<void>
}

export function createConfiguredPanelBackend(
  configuration: RuntimeBackendConfiguration,
  table: UiText,
  locale: string,
): RuntimeConfiguredBackend {
  setUiText(table, locale)
  const paid = configuration.paid
  const budget =
    paid === undefined ? undefined : createRuntimePaidBudget(paid.budget, table, locale)
  const policy = paid === undefined ? undefined : new RuntimePaidUse(paid.policy)
  const admission =
    paid === undefined || budget === undefined
      ? undefined
      : runtimePaidRequestAdmission({
          budget,
          price: paid.price,
          isOn: (feature) => policy?.isOn(feature) === true,
        })
  const extensions: RuntimeBackendExtensions = {
    ...(configuration.hooks !== undefined && {
      hooks: (root) => createRuntimeHooks(configuration.hooks?.(root) ?? missing(), table, locale),
    }),
    ...(configuration.hookSettings !== undefined && { hookSettings: configuration.hookSettings }),
    ...(configuration.mcp !== undefined && {
      mcp: (root, pool) => createRuntimeMcp(configuration.mcp?.(root) ?? missing(), pool),
    }),
    ...(configuration.browser !== undefined && {
      browser: (root) => createRuntimeBrowser(configuration.browser?.(root) ?? missing()),
    }),
    ...(configuration.autoReviewer !== undefined && {
      autoReviewer: (root) =>
        createRuntimeAutoReviewer(configuration.autoReviewer?.(root) ?? missing(), table, locale),
    }),
    ...(policy !== undefined &&
      paid !== undefined &&
      admission !== undefined && {
        interactivePaid: policy,
        paidUsage: paid.policy.usage,
        reservePaidRequest: admission,
        paidResponseCost: admission.responseCost,
      }),
  }
  let closing: Promise<void> | undefined
  return {
    extensions,
    ...(paid !== undefined && { quote: paid.quote }),
    disposeAfterBackend: () => {
      closing ??= budget?.dispose() ?? Promise.resolve()
      return closing
    },
  }
}
function missing(): never {
  throw new Error('MHP_NATIVE_CONFIGURATION_UNAVAILABLE')
}
