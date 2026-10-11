// Which consent answers a paid use (M108 lane P, PLAN.md D88.7). The
// provider's default account keeps the workspace consent in paidConsent.ts,
// exactly as before accounts existed; a use billed to any other account asks
// that account's own consent, loaded with dist/accountPaid.js on its first
// use. This file stays tiny: it is all that activation and the ACP engine carry.

import { ACCOUNT_DEFAULT_ID } from '../../shared/constants'
import type { PaidUseDecision, PaidUseRequest } from '../../shared/paid'
import type { PaidUseAnswer } from './paidConsent'

/** The provider and account a use is billed to; ids only, never a credential. */
export interface PaidBilling {
  readonly credentialRevision?: string | undefined
  readonly isCurrent?: () => boolean
  readonly provider: string
  readonly account: string
}

/** The host's popup: the use's own question, with the account's line added. */
export type AccountPaidHostAsk = (
  request: PaidUseRequest,
  canRemember: boolean,
  accountLine: string,
) => Promise<PaidUseAnswer>

/** The lazy service (dist/accountPaid.js) both editors bind. */
export interface AccountPaidService {
  /**
   * The use's decision under its billing account's consent: the frozen quote
   * for a search, true for others, or a refusal in the same shape. `ask`
   * replaces the popup for this use (an ACP session's own prompt).
   */
  decide(
    billing: PaidBilling,
    request: PaidUseRequest,
    requiresAsking: boolean,
    ask?: AccountPaidHostAsk,
  ): Promise<PaidUseDecision>
  /** Account & usage's Ask again: every account consent this window holds asks again. */
  revokeAll(): Promise<void>
}

/** Whether the use bills another account than the provider's default (D88.2). */
export function isBilledToAnotherAccount(billing: PaidBilling | undefined): billing is PaidBilling {
  return billing !== undefined && billing.account !== ACCOUNT_DEFAULT_ID
}

/**
 * The route every editor binds: undefined for the default account, so the
 * workspace consent answers; another account's use loads the service once
 * (a failed load is tried again on the next use) and asks there.
 */
export function accountPaidRoute(
  billing: () => PaidBilling | undefined,
  load: () => Promise<AccountPaidService>,
) {
  let loading: Promise<AccountPaidService> | undefined
  let loaded: AccountPaidService | undefined
  const decide = async (
    billed: PaidBilling,
    request: PaidUseRequest,
    requiresAsking: boolean,
    ask?: AccountPaidHostAsk,
  ) => {
    const pending = (loading ??= load())
    try {
      loaded = await pending
    } catch (error: unknown) {
      if (loading === pending) loading = undefined
      throw error
    }
    return await loaded.decide(billed, request, requiresAsking, ask)
  }
  return {
    route: (request: PaidUseRequest, requiresAsking: boolean, ask?: AccountPaidHostAsk) => {
      const billed = billing()
      return isBilledToAnotherAccount(billed)
        ? decide(billed, request, requiresAsking, ask)
        : undefined
    },
    // Ask again lapses kept account grants through the host's generation; a
    // consent this window holds also fences its open questions.
    forget: async () => {
      await loaded?.revokeAll()
    },
  }
}
