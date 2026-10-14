import type { AccountsSessionPort } from '../../acp/accounts'
import type { RuntimeBackend, RuntimeBackendDeps } from '../backends'

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
