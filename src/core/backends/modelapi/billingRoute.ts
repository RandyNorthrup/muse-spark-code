import { createHash } from 'node:crypto'
import path from 'node:path'

/** In-memory only: one credential and billing decision for one Meta attempt. */
export interface BillingRoute {
  readonly kind: 'payAsYouGo' | 'museCodePlan'
  readonly credential: string
  readonly accountId: string
}

export function billingKeyDigest(credential: string): string {
  return createHash('sha256').update(credential).digest('hex')
}

/** The captured sign-in file has no account id; rotation must not change ownership. */
export function subscriptionAccountId(file: string): string {
  const normalized = file.replaceAll('\\', '/')
  const resolved = /^[a-z]:\//iu.test(normalized)
    ? path.win32.resolve(normalized).replaceAll('\\', '/')
    : path.resolve(normalized)
  return billingKeyDigest(`muse-code-plan:${resolved}`)
}

export function billingRoute(
  kind: BillingRoute['kind'],
  credential: string,
  accountId = billingKeyDigest(credential),
): BillingRoute {
  return Object.freeze({ kind, credential, accountId })
}
