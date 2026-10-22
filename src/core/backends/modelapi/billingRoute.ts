import { createHash } from 'node:crypto'
import path from 'node:path'
import * as z from 'zod/mini'
import { UI_TEXT, type PaidFeature } from '../../../shared/constants'

export const conversationOwnerSchema = /* @__PURE__ */ z
  .string()
  .check(z.minLength(1))
  .brand<'ConversationOwner'>()
export const payerCredentialSchema = /* @__PURE__ */ z
  .string()
  .check(z.minLength(1))
  .brand<'PayerCredential'>()
export type ConversationOwner = z.infer<typeof conversationOwnerSchema>
export type PayerCredential = z.infer<typeof payerCredentialSchema>

const resolvedAttempt = Symbol('resolvedAttempt')
export interface AttemptBillingRoute {
  readonly [resolvedAttempt]: true
  readonly billing: BillingRoute | undefined
  readonly requiresCredentialCheck: boolean
}
export type AttemptFeature = PaidFeature | 'ordinary' | 'compaction' | 'catalogue' | 'tokenCount'

/** The only attempt resolver: admission flags always make the attempt paid. */
export async function resolveAttemptBillingRoute(input: {
  readonly feature: AttemptFeature
  readonly paidFeature?: PaidFeature | undefined
  readonly isMetaDirect: boolean
  readonly snapshot?: BillingRoute | undefined
  readonly readCredential?: ((isPaid: boolean) => Promise<string | undefined>) | undefined
  readonly resolve?: ((isPaid: boolean) => Promise<BillingRoute | undefined>) | undefined
}): Promise<AttemptBillingRoute> {
  const isPaid =
    input.paidFeature !== undefined ||
    !['ordinary', 'compaction', 'catalogue', 'tokenCount'].includes(input.feature)
  let billing = input.isMetaDirect ? (input.snapshot ?? (await input.resolve?.(isPaid))) : undefined
  if (isPaid && billing === undefined && input.resolve !== undefined && input.isMetaDirect)
    throw new Error(UI_TEXT.subscriptionKey.paidNeedsKey)
  if (billing === undefined && input.readCredential !== undefined && input.isMetaDirect) {
    const credential = await input.readCredential(isPaid)
    if (credential !== undefined) billing = billingRoute('payAsYouGo', credential)
  }
  if (isPaid && billing?.kind === 'museCodePlan')
    throw new Error(UI_TEXT.subscriptionKey.billingChanged)
  return Object.freeze({
    [resolvedAttempt]: true as const,
    billing,
    requiresCredentialCheck: input.snapshot === undefined && input.resolve === undefined,
  })
}

/** In-memory only: one credential and billing decision for one Meta attempt. */
export interface BillingRoute {
  readonly kind: 'payAsYouGo' | 'museCodePlan'
  readonly credential: string
  readonly accountId: ConversationOwner
  readonly payerCredential: PayerCredential
}

export function billingKeyDigest(credential: string): PayerCredential {
  return payerCredentialSchema.parse(createHash('sha256').update(credential).digest('hex'))
}

/** The captured sign-in file has no account id; rotation must not change ownership. */
export function subscriptionAccountId(
  file: string,
  platform: NodeJS.Platform = process.platform,
): ConversationOwner {
  const normalized = file.replaceAll('\\', '/')
  const resolved =
    platform === 'win32' || /^[a-z]:\//iu.test(normalized) || normalized.startsWith('//')
      ? path.win32.resolve(normalized).replaceAll('\\', '/').toLowerCase()
      : path.resolve(normalized)
  return conversationOwnerSchema.parse(billingKeyDigest(`muse-code-plan:${resolved}`))
}

export function billingRoute(
  kind: BillingRoute['kind'],
  credential: string,
  accountId: ConversationOwner = conversationOwnerSchema.parse(billingKeyDigest(credential)),
): BillingRoute {
  return Object.freeze({
    kind,
    credential,
    accountId,
    payerCredential: billingKeyDigest(credential),
  })
}
