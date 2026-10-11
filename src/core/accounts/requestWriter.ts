// M108's request writer: the pool chooses once, the registry constructs only
// that account's client, and every send checks the same credential epoch.
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import type { PaidBilling } from '../paid/accountPaidRoute'
import type { AccountPool, AccountPoolRequest } from './pool'
import { AccountPoolStoppedError } from './pool'
import { accountLimitIdentity, type AccountLimitBlock } from './limitBlock'
import { accountStopText } from '../usage/accountUsageText'
import type { AccountStore } from '../providers/accounts'
import type { AccountBinding, AccountCredential } from '../providers/accountCredentialRecord'
import type { ModelClient } from '../backends/modelapi/modelPolicy'
import { UI_TEXT } from '../../shared/constants'
import { parseUsd } from '../../shared/accountUsd'
import { usdAmountSchema, type UsdAmount } from '../../shared/usd'

const context = new AsyncLocalStorage<PaidBilling>()
export function activeAccountBilling(): PaidBilling | undefined {
  return context.getStore()
}

class AccountRequestBoundaryError extends Error {
  public readonly code = 'accountRequestBoundary'
  public constructor() {
    super(UI_TEXT.accounts.ownerBusy)
  }
}

export interface AccountRequestLease {
  readonly account: string
  readonly credentialRevision?: string | undefined
  readonly provider: string
  readonly origin: string
  readonly keyDigest: string
  readonly client: ModelClient
  readonly rateLimit: (resetAt: string) => void
  readonly isCurrent: () => boolean
  readonly beforeSend: () => void
  readonly settle: (
    cost: UsdAmount | null,
    usage?: { inputTokens: number; outputTokens: number },
  ) => Promise<void>
}

export interface AccountRequestPort {
  acquire(request: AccountPoolRequest, origin: string): Promise<AccountRequestLease>
  within<T>(lease: AccountRequestLease, run: () => Promise<T>): Promise<T>
  current(kind: AccountPoolRequest['kind'], owner: string): string | undefined
}

export class AccountRequestWriter implements AccountRequestPort {
  public constructor(
    private readonly deps: {
      readonly store: AccountStore
      readonly pool: AccountPool
      readonly refresh: () => Promise<void>
      readonly defaults?: () => { account: string; isInteractive: boolean; hasPoolFlag: boolean }
      readonly rateLimit?: (account: string, resetAt: string, identity: AccountLimitBlock) => void
      readonly receipt?: (
        request: AccountPoolRequest,
        usage: { inputTokens: number; outputTokens: number },
        cost: UsdAmount | null,
      ) => void
      readonly createClient: (
        binding: AccountBinding,
        apiKey: () => Promise<string>,
        request: AccountPoolRequest,
        isCurrent: () => boolean,
      ) => Promise<ModelClient>
    },
  ) {}

  public within<T>(lease: AccountRequestLease, run: () => Promise<T>): Promise<T> {
    return context.run(
      {
        provider: lease.provider,
        account: lease.account,
        credentialRevision: lease.credentialRevision,
        isCurrent: lease.isCurrent,
      },
      run,
    )
  }

  public current(kind: AccountPoolRequest['kind'], owner: string): string | undefined {
    return this.deps.pool.current(kind, owner)
  }

  public async acquire(request: AccountPoolRequest, origin: string): Promise<AccountRequestLease> {
    request = Object.freeze({
      ...request,
      ...this.deps.defaults?.(),
      estimate: Object.freeze({ ...request.estimate }),
    })
    await this.deps.refresh()
    let admission: Awaited<ReturnType<AccountPool['acquire']>>
    try {
      admission = await this.deps.pool.acquire(request)
    } catch (error: unknown) {
      if (error instanceof AccountPoolStoppedError && error.trigger !== undefined) {
        const account = this.current(request.kind, request.owner) ?? request.account
        const label =
          this.deps.pool.deps.accounts().find((row) => row.id === account)?.label ?? account
        error.message = accountStopText(
          {
            type: 'stop',
            provider: this.deps.pool.deps.provider,
            account,
            time: new Date(this.deps.pool.deps.now()).toISOString(),
            trigger: error.trigger,
          },
          label,
        )
      }
      throw error
    }

    try {
      const row = this.deps.pool.deps.accounts().find((account) => account.id === admission.account)
      if (row === undefined) throw new Error(UI_TEXT.accounts.invalidAccount)
      const limitIdentity = accountLimitIdentity(row, this.deps.pool.deps.policy())
      return await this.deps.store.useCredential(
        this.deps.pool.deps.provider,
        admission.account,
        origin,
        async (binding, credential, isCredentialCurrent) => {
          let isSettled = false
          const secret = requiredKey(credential)
          const apiKey = () =>
            this.deps.store.useCredential(
              binding.provider,
              binding.account,
              binding.origin,
              (_current, fresh, freshGuard) => {
                if (
                  isSettled ||
                  request.isCurrent?.() === false ||
                  !isCredentialCurrent() ||
                  freshGuard.revision !== isCredentialCurrent.revision ||
                  requiredKey(fresh) !== secret
                )
                  throw new Error(UI_TEXT.accounts.invalidAccount)
                return Promise.resolve(secret)
              },
            )
          const isCurrent = () =>
            !isSettled && request.isCurrent?.() !== false && isCredentialCurrent()
          const client = await this.deps.createClient(binding, apiKey, request, isCurrent)
          if (!isCurrent()) throw new Error(UI_TEXT.accounts.invalidAccount)
          let hasSent = false
          let wasRateLimited = false
          return {
            account: binding.account,
            credentialRevision: isCredentialCurrent.revision,
            provider: binding.provider,
            origin: binding.origin,
            keyDigest: createHash('sha256').update(secret).digest('hex'),
            client,
            isCurrent,
            rateLimit: (resetAt) => {
              wasRateLimited = true
              this.deps.rateLimit?.(binding.account, resetAt, {
                ...limitIdentity,
                expiresAt: Date.parse(resetAt),
              })
            },
            beforeSend: () => {
              if (!isCurrent()) throw new Error(UI_TEXT.accounts.invalidAccount)
              if (hasSent) throw new AccountRequestBoundaryError()
              admission.beforeSend()
              admission.check()
              hasSent = true
            },
            settle: async (cost, usage) => {
              if (isSettled) throw new Error(UI_TEXT.accounts.invalidAccount)
              isSettled = true
              if (wasRateLimited && cost === null) {
                cost = usdAmountSchema.parse('0')
                usage = { inputTokens: 0, outputTokens: 0 }
              }
              try {
                if (usage !== undefined) this.deps.receipt?.(request, usage, cost)
              } catch (error: unknown) {
                await admission.settle(null)
                throw error
              }
              await admission.settle(cost === null ? null : parseUsd(cost), hasSent)
            },
          }
        },
      )
    } catch (error: unknown) {
      await admission.settle(parseUsd(0))
      throw error
    }
  }
}

function requiredKey(credential: AccountCredential | undefined): string {
  if (credential?.auth !== 'apiKey') throw new Error(UI_TEXT.accounts.invalidAccount)
  return credential.secret
}
