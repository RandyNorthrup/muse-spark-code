import type { AccountPolicy } from '../../core/providers/accountPolicy'
import { shouldRecheckAccountPolicy } from '../../core/providers/accountPolicy'
import { accountsRequestSchema } from '../../shared/hostApi/accounts'
import { accountsPolicyViewSchema, type AccountsPolicyView } from '../../shared/modelsPanel'

/** P injects ask; M104 sends show only on an authenticated local surface. */
export class AccountPolicyPrompt {
  private pending:
    | {
        readonly provider: string
        readonly row: AccountPolicy
        readonly resolve: (choice: 'confirm' | 'ownCapsOnly' | 'cancel') => void
      }
    | undefined

  public constructor(
    private readonly port: {
      show(provider: string, row: AccountsPolicyView | null): void
      policy(provider: string): AccountPolicy | undefined
      now(): number
    },
  ) {}

  public ask(
    provider: string,
    policy: AccountPolicy,
  ): Promise<'confirm' | 'ownCapsOnly' | 'cancel'> {
    // The surface has one modal owner. Overlap fails closed; P may retry.
    if (this.pending !== undefined) return Promise.resolve('cancel')
    const row = structuredClone(policy)
    const view = accountsPolicyViewSchema.parse({
      provider: row.provider,
      product: row.product,
      pooling: row.pooling,
      multipleAccounts: row.multipleAccounts,
      isCredentialHeld: row.isCredentialHeld,
      recovery: row.recovery,
      recordVersion: row.recordVersion,
      checkedAt: row.checkedAt,
      sources: row.sources,
      isStale: shouldRecheckAccountPolicy(row, new Date(this.port.now())),
    })
    return new Promise((resolve) => {
      this.pending = { provider, row, resolve }
      try {
        this.port.show(provider, view)
      } catch {
        this.close()
      }
    })
  }

  public answer(value: unknown): boolean {
    const parsed = accountsRequestSchema.safeParse(value)
    if (!parsed.success || parsed.data.type !== 'accounts/confirm') return false
    const request = parsed.data
    const pending = this.pending
    if (pending?.provider !== request.provider || request.product !== pending.row.product)
      return false
    if (JSON.stringify(this.port.policy(pending.provider)) !== JSON.stringify(pending.row)) {
      this.close()
      return false
    }
    this.pending = undefined
    pending.resolve(request.choice)
    this.port.show(pending.provider, null)
    return true
  }

  /** Closing/disposal cannot leave an admission waiting or grant consent. */
  public close(): void {
    const pending = this.pending
    if (pending === undefined) return
    this.pending = undefined
    pending.resolve('cancel')
    this.port.show(pending.provider, null)
  }
}
