// Tab's paid-use consent (M94, PLAN.md D73): lane L's keyed question
// (Q-M94a, D48) for the request's own model and price. One key per
// (model, price); the paid gate's grants alone are necessary, never
// sufficient. Built inside the lazy bundle on the first Tab request, so
// activation carries none of it. Pure: no `vscode` import.

import { MODEL_API_PRICES_PER_MILLION, MODEL_API_PRICES_VERIFIED_ON } from '../../shared/constants'
import { modelApiPaidTier } from '../../shared/paidBoundary'
import type { Logger } from '../logger'

/**
What an allowing answer covers (RVM94KR2): `once` this request only,
`window` this window (memory only), `always` this workspace (persisted).
*/
export type TabConsentScope = 'once' | 'window' | 'always'

/**
A request's consent, bound to its key (feature `tab`, model id, price
fingerprint). `isCurrent` is read after every wait and last at the send:
a revoked grant, a lapsed price acceptance or a moved price sends nothing.
*/
export interface TabConsentGrant {
  readonly scope: TabConsentScope
  isCurrent(): boolean
}

/**
Lane L's question (Q-M94a, PLAN.md D48) for the request's own model and
price (RVM94KR 3, RVM94KR2): a grant proceeds, undefined sends nothing
(Deny snoozes the window).
*/
export interface TabUseConsent {
  requestUse(model: string): Promise<TabConsentGrant | undefined>
}

/** The model's price fingerprint: its tier's per-million rates; undefined when unpriced. */
export function tabPriceFingerprint(model: string): string | undefined {
  const tier = modelApiPaidTier(model)
  return tier === undefined
    ? undefined
    : JSON.stringify([tier, MODEL_API_PRICES_PER_MILLION[tier], MODEL_API_PRICES_VERIFIED_ON])
}

/** The persisted Always record (extension-private workspace state): one key, its scope. */
interface TabAlwaysRecord {
  readonly scope: 'always'
  readonly model: string
  readonly price: string
}

/** The record as stored, if it parses: anything else (a legacy model string) is no record. */
function alwaysRecordOf(value: unknown): TabAlwaysRecord | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const fields: Record<string, unknown> = Object.fromEntries(Object.entries(value))
  const { scope, model, price } = fields
  return scope === 'always' && typeof model === 'string' && typeof price === 'string'
    ? { scope, model, price }
    : undefined
}

/** What `createTabConsent` asks the paid gate and where it keeps Always. */
export interface TabConsentDeps {
  readonly priceOf: (model: string) => string | undefined
  /** D48's question for the model, always asked; the scope its answer granted. */
  readonly ask: (model: string) => Promise<TabConsentScope | undefined>
  /** The feature on with its price accepted. */
  readonly isOn: () => boolean
  /** The feature's workspace grant still stands (revocation and price lapses clear it). */
  readonly isRemembered: () => boolean
  /** The feature's window once as a token; it changes whenever that once is revoked. */
  readonly windowOnceToken: () => string | undefined
  /** Moves on Tab's price acceptance changes or the shared "Ask again". */
  readonly revocations: () => number
  readonly readAlways: () => unknown
  readonly writeAlways: (record: TabAlwaysRecord | undefined) => Promise<void>
  readonly log: Logger
}

/**
Tab's keyed consent (RVM94KR2, PLAN.md D73): one key per (model, price).
The paid gate's grants for the feature alone are necessary, never
sufficient: a kept "always" counts only for the key its record names, and
a window once only for the keys answered in this window. A legacy grant
with no record asks the migration question: only Always records its key,
so Allow once asks again in the next window. An open question is shared
only by requests with its full key.
*/
export function createTabConsent(deps: TabConsentDeps): TabUseConsent {
  const windowKeys = new Map<string, string>()
  const pending = new Map<string, Promise<TabConsentGrant | undefined>>()

  const grantFor = (
    scope: TabConsentScope,
    model: string,
    price: string,
    token?: string,
  ): TabConsentGrant => {
    const keyText = JSON.stringify([model, price])
    const revocations = deps.revocations()
    const isKeyCurrent = (): boolean =>
      deps.isOn() && deps.priceOf(model) === price && deps.revocations() === revocations
    const isScopeCurrent = (): boolean => {
      switch (scope) {
        case 'always': {
          const record = alwaysRecordOf(deps.readAlways())
          return record?.model === model && record.price === price && deps.isRemembered()
        }
        case 'window': {
          const current = deps.windowOnceToken()
          return current !== undefined && current === token && windowKeys.get(keyText) === token
        }
        case 'once': {
          return true
        }
      }
    }
    return { scope, isCurrent: () => isKeyCurrent() && isScopeCurrent() }
  }

  const kept = (model: string, price: string): TabConsentGrant | undefined => {
    const always = grantFor('always', model, price)
    if (always.isCurrent()) {
      return always
    }
    const token = windowKeys.get(JSON.stringify([model, price]))
    const window = token === undefined ? undefined : grantFor('window', model, price, token)
    return window?.isCurrent() === true ? window : undefined
  }

  const ask = async (model: string, price: string): Promise<TabConsentGrant | undefined> => {
    const revocations = deps.revocations()
    // A record left behind a revoked or lapsed grant goes before the
    // question, so an answer for another key never revives it.
    if (deps.readAlways() !== undefined && !deps.isRemembered()) {
      await deps.writeAlways(undefined)
    }
    const scope = await deps.ask(model)
    if (scope === undefined || !deps.isOn() || deps.priceOf(model) !== price) {
      return undefined
    }
    if (deps.revocations() !== revocations) {
      // Revoked while the question was open: this request sends nothing, and
      // the window is not snoozed (the user did not deny).
      await deps.writeAlways(undefined)
      return { scope: 'once', isCurrent: () => false }
    }
    if (scope === 'window') {
      const token = deps.windowOnceToken()
      if (token === undefined) {
        return grantFor('once', model, price)
      }
      windowKeys.set(JSON.stringify([model, price]), token)
      return grantFor('window', model, price, token)
    }
    if (scope === 'always') {
      try {
        await deps.writeAlways({ scope: 'always', model, price })
        if (deps.revocations() !== revocations) {
          await deps.writeAlways(undefined)
          return { scope: 'once', isCurrent: () => false }
        }
        return grantFor('always', model, price)
      } catch {
        deps.log.warn('Tab: "always" could not be kept, so this request is allowed once')
      }
    }
    return deps.revocations() === revocations
      ? grantFor('once', model, price)
      : { scope: 'once', isCurrent: () => false }
  }

  return {
    requestUse: async (model) => {
      const price = deps.priceOf(model)
      if (price === undefined || !deps.isOn()) {
        return
      }
      const found = kept(model, price)
      if (found !== undefined) {
        return found
      }
      const keyText = JSON.stringify([model, price])
      const open = pending.get(keyText)
      if (open !== undefined) {
        return await open
      }
      const question = ask(model, price)
      pending.set(keyText, question)
      try {
        return await question
      } finally {
        pending.delete(keyText)
      }
    },
  }
}
