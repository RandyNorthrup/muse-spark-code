import type { AccountsSessionPort } from '../../acp/accounts'
import type { AccountPoolRequest } from '../../core/accounts/pool'
import { accountIdSchema } from '../../shared/accounts'
import { ACCOUNT_DEFAULT_ID, UI_TEXT } from '../../shared/constants'
import type { RuntimeBackend, RuntimeBackendDeps } from '../backends'
import type { ExecOptions } from './execArgs'

export interface ExecAccountSelection {
  readonly account: string
  readonly hasPoolFlag: boolean
  readonly isInteractive: false
}

/** H-M95-EXEC: create the runtime with the shared profile owner and supplied
 * bounded transport. Every model attempt, retry and paid call must use that
 * transport, P's request-boundary admission, and the original run budget.
 * No machine confirmation is minted here; P reads existing grants only.
 * CAPS017: the caller passes the engine's backend factory it already loaded,
 * so dist/runtimeAccounts.js never bundles the backends (PLAN.md D6). */
export interface ExecAccountsPort {
  create(
    deps: RuntimeBackendDeps,
    selection: ExecAccountSelection,
    createBackend: (deps: RuntimeBackendDeps) => RuntimeBackend,
  ): {
    readonly runtime: RuntimeBackend
    readonly accounts: AccountsSessionPort
  }
}

export function execAccountSelection(
  options: Pick<ExecOptions, 'account' | 'accountPool' | 'keyFromStdin'>,
): ExecAccountSelection {
  const account = accountIdSchema.parse(options.account ?? ACCOUNT_DEFAULT_ID)
  if (options.keyFromStdin && (account !== ACCOUNT_DEFAULT_ID || options.accountPool === true))
    throw new Error(UI_TEXT.accounts.credentialHelp)
  return { account, hasPoolFlag: options.accountPool === true, isInteractive: false }
}

/** The adapter calls this for every attempt. Parent identities, exact USD
 * estimates and recovery state survive unchanged; headless can never ask. */
export function execAccountRequest(
  options: Pick<ExecOptions, 'account' | 'accountPool' | 'keyFromStdin'>,
  request: AccountPoolRequest,
): AccountPoolRequest {
  const selection = execAccountSelection(options)
  return { ...request, ...selection }
}
