// Required ports bind M95's panel/registry and P's single profile owner.
// No VS Code API or secret enters the shared page's message route.
import type { AccountStore, AccountProvider } from '../../core/providers/accounts'
import { AccountStoreError } from '../../core/providers/accountCredentialRecord'
import type { AccountConfirmations } from '../../core/accounts/confirmations'
import type { AccountPoolStoppedError } from '../../core/accounts/pool'
import { accountPolicyFor } from '../../core/providers/accountPolicy'
import {
  accountsRequestSchema,
  type AccountsRequest,
  type AccountsReply,
} from '../../shared/hostApi/accounts'
import {
  accountsNoticeSchema,
  modelsAccountsSliceSchema,
  type ModelsAccountsSlice,
} from '../../shared/modelsPanel'
import { accountPolicyViewFor } from './accountPolicyPrompt'
import type { AccountEvent } from '../../shared/accounts'

/** Project the exact failed pool admission; a trigger is never a retry estimate. */
export function accountNoticeFor(event: AccountEvent, stopped?: AccountPoolStoppedError) {
  return accountsNoticeSchema.parse({
    event,
    resetAt: event.type === 'stop' ? (stopped?.resetAt ?? null) : null,
  })
}

export interface AccountsPanelHostPort {
  readonly accounts: AccountStore
  readonly confirmations: AccountConfirmations
  provider(id: string): Promise<AccountProvider | undefined>
  currentAccount(provider: string): string | null
  settings(): { readonly isSwapOn: boolean; readonly isParallelOn: boolean }
  capabilities(provider: string): {
    readonly planWindows: readonly string[]
    readonly hasRateHeadroom: boolean
    readonly usageUrl: string | null
    readonly label: string
  }
  /** Password/OAuth flow stays on the host, bound to this exact account. */
  credential(provider: string, account: string): Promise<void>
  /** P's boundary selection/admission, never just a UI state assignment. */
  use(provider: string, account: string): Promise<void>
  /** Only resolves an outstanding, host-issued policy question. */
  answer(request: Extract<AccountsRequest, { type: 'accounts/confirm' }>): boolean
  now(): number
}

export class AccountsPanelHandler {
  public constructor(private readonly port: AccountsPanelHostPort) {}

  public async snapshot(provider: string): Promise<ModelsAccountsSlice> {
    const entry = await this.port.provider(provider)
    if (entry?.id !== provider) throw new AccountStoreError('unavailable')
    const row = accountPolicyFor(entry.policyProvider, entry.product)
    const grant = row === undefined ? undefined : await this.port.confirmations.read(row)
    const capabilities = this.port.capabilities(provider)
    const accounts = await this.port.accounts.list(provider)
    const current = this.port.currentAccount(provider)
    const policy = row === undefined ? null : accountPolicyViewFor(row, this.port.now())
    return modelsAccountsSliceSchema.parse({
      provider,
      providerLabel: capabilities.label,
      accounts,
      currentAccount: accounts.some((account) => account.id === current) ? current : null,
      ...this.port.settings(),
      policy,
      confirmation: grant?.isCurrent(row) === true ? grant.choice : null,
      usageUrl: capabilities.usageUrl,
      planWindows: [...capabilities.planWindows],
      hasRateHeadroom: capabilities.hasRateHeadroom,
    })
  }

  public async handle(value: unknown): Promise<ModelsAccountsSlice | AccountsReply> {
    const parsed = accountsRequestSchema.safeParse(value)
    if (!parsed.success) return { type: 'accounts/error', code: 'invalidAccount' }
    const request = parsed.data
    try {
      const entry = await this.port.provider(request.provider)
      if (entry?.id !== request.provider) throw new AccountStoreError('unavailable')
      if (
        entry.product === 'muse-code' &&
        request.type !== 'accounts/list' &&
        request.type !== 'accounts/revoke' &&
        request.type !== 'accounts/confirm'
      )
        throw new AccountStoreError('unavailable')
      switch (request.type) {
        case 'accounts/list': {
          break
        }
        case 'accounts/add': {
          const addition = await this.port.accounts.add(request.provider, request.account)
          let hasCredential = false
          try {
            await this.port.credential(request.provider, request.account.id)
            hasCredential = true
          } finally {
            // Compare the addition token before removing metadata or a partial credential.
            if (!hasCredential)
              await this.port.accounts.remove(request.provider, request.account.id, addition)
          }
          break
        }
        case 'accounts/remove': {
          await this.port.accounts.remove(request.provider, request.account)
          break
        }
        case 'accounts/update': {
          await this.port.accounts.update(request.provider, request.account)
          break
        }
        case 'accounts/order': {
          await this.port.accounts.order(request.provider, request.accounts)
          break
        }
        case 'accounts/thresholds': {
          await this.port.accounts.thresholds(request.provider, request.account, request.thresholds)
          break
        }
        case 'accounts/use': {
          if (
            accountPolicyFor(entry.policyProvider, entry.product)?.isCredentialHeld !== true ||
            accountPolicyFor(entry.policyProvider, entry.product)?.pooling === 'notOffered'
          )
            throw new AccountStoreError('notOffered')
          const accounts = await this.port.accounts.list(request.provider)
          if (accounts.every((row) => row.id !== request.account))
            throw new AccountStoreError('invalidAccount')
          await this.port.use(request.provider, request.account)
          break
        }
        case 'accounts/confirm': {
          if (request.product !== entry.product || !this.port.answer(request))
            return { type: 'accounts/error', code: 'consentRequired' }
          break
        }
        case 'accounts/revoke': {
          if (request.product !== entry.product) throw new AccountStoreError('invalidAccount')
          await this.port.confirmations.revoke(entry.policyProvider, entry.product)
          break
        }
      }
      return await this.snapshot(request.provider)
    } catch (error) {
      // Raw adapter errors may contain a credential. Only fixed bridge codes leave.
      return {
        type: 'accounts/error',
        code:
          error instanceof AccountStoreError &&
          (error.code === 'invalidAccount' || error.code === 'notOffered')
            ? error.code
            : 'unavailable',
      }
    }
  }
}
