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
import type { ProviderClient, ResponseAttemptGuard } from '../backends/modelapi/client'
import type { ResponseObservation } from '../backends/modelapi/transport'
import type { PaidUseRequest, PaidUseDecision } from '../../shared/paid'
import { PAID_PRICES_USD } from '../../shared/constants'
import { Usd } from '../../shared/usd'
import { estimateInput, requestParts } from '../backends/modelapi/sessionBudget'
import { modelPolicyFor, modelPricedUsage } from '../backends/modelapi/modelPolicy'
import { estimateCostUsd } from '../usage/insights'
import type { CreateImageBody, EditImageBody, ImagesResponse } from '../backends/modelapi/schemas'
import { isTerminalResponseEvent } from '../backends/modelapi/schemas'
import type { ModelClient } from '../backends/modelapi/modelPolicy'
import { UI_TEXT } from '../../shared/constants'
import { rateLimitResetAt } from '../../shared/retryPolicy'
import { parseUsd } from '../../shared/accountUsd'
import { usdAmountSchema, type UsdAmount } from '../../shared/usd'

const context = new AsyncLocalStorage<PaidBilling>()
export function activeAccountBilling(): PaidBilling | undefined {
  return context.getStore()
}

export interface AccountRequestLease {
  readonly account: string
  readonly credentialRevision?: string | undefined
  readonly provider: string
  readonly origin: string
  readonly keyDigest: string
  readonly paidClient?: ProviderClient | undefined
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
  paidClient?(
    client: ProviderClient,
    request: AccountPoolRequest,
    origin: string,
    paid: PaidUseRequest,
    requiresAsking: boolean,
    allows: (paid: PaidUseRequest, requiresAsking: boolean) => Promise<PaidUseDecision>,
  ): ProviderClient
  withinRequest?<T>(
    kind: AccountPoolRequest['kind'],
    owner: string,
    run: () => Promise<T>,
  ): Promise<T>
  acquire(request: AccountPoolRequest, origin: string): Promise<AccountRequestLease>
  within<T>(lease: AccountRequestLease, run: () => Promise<T>): Promise<T>
  current(kind: AccountPoolRequest['kind'], owner: string): string | undefined
}

function paidGuard(
  lease: AccountRequestLease,
  originalGuard: ResponseAttemptGuard | undefined,
  digest: string,
  now: () => number,
): ResponseAttemptGuard {
  // The original fence owns the unchanged shared budget; this fence owns
  // the actual credential and its account reservation. A retry is a new send
  // on this same lease: the fence rechecks the payer instead of refusing it,
  // and every 429 observation reaches this lease's durable block and refund.
  return Object.assign(
    (actual: string | undefined) => {
      if (actual !== lease.keyDigest || !lease.isCurrent())
        throw new Error(UI_TEXT.accounts.invalidAccount)
      originalGuard?.(digest)
    },
    {
      ...originalGuard,
      beforeRequestStarted: () => {
        lease.beforeSend()
      },
      observe: (observation: ResponseObservation) => {
        if (observation.rateLimited === true) {
          lease.rateLimit(rateLimitResetAt(observation.headers?.['retry-after'] ?? null, now()))
        }
        originalGuard?.observe?.(observation)
      },
    },
  )
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
      ) => Promise<ModelClient & { readonly paidClient?: ProviderClient }>
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

  /** Each extra HTTP request chooses its payer before consent, independently
   * of the main response; repairs/agent steps get their own claims. */
  public paidClient(
    original: ProviderClient,
    request: AccountPoolRequest,
    origin: string,
    paid: PaidUseRequest,
    requiresAsking: boolean,
    allows: (paid: PaidUseRequest, requiresAsking: boolean) => Promise<PaidUseDecision>,
  ): ProviderClient {
    const within = this.within.bind(this)
    const now = () => this.deps.pool.deps.now()
    const acquire = async (estimate: AccountPoolRequest['estimate']) => {
      const account =
        activeAccountBilling()?.account ??
        this.current(request.kind, request.owner) ??
        request.account
      const lease = await this.acquire(
        { ...request, owner: `${request.owner}:${paid.feature}`, retryAccount: account, estimate },
        origin,
      )
      try {
        if (
          (await within(lease, () => allows(paid, requiresAsking))) !== true ||
          !lease.isCurrent()
        )
          throw new Error(UI_TEXT.accounts.unavailable)
        return lease
      } catch (error: unknown) {
        await lease.settle(Usd.from(0).toAmount())
        throw error
      }
    }
    const image = async (
      body: CreateImageBody | EditImageBody,
      signal: AbortSignal,
      admit?: ResponseAttemptGuard,
    ): Promise<ImagesResponse> => {
      const lease = await acquire({
        costUsd: parseUsd(PAID_PRICES_USD.imageGeneration),
        inputTokens: 0,
        outputTokens: 0,
        requests: 1,
      })
      let cost: UsdAmount | null = null
      try {
        const client = lease.paidClient
        if (client === undefined) throw new Error(UI_TEXT.accounts.unavailable)
        const digest = await original.currentKeyDigest()
        const fence = paidGuard(lease, admit, digest, now)
        const result = await within(lease, () =>
          'images' in body
            ? client.editImage(body, signal, fence)
            : client.createImage(body, signal, fence),
        )
        cost = Usd.from(PAID_PRICES_USD.imageGeneration).times(result.data.length).toAmount()
        return result
      } finally {
        await lease.settle(cost)
      }
    }
    const stream: ProviderClient['streamResponse'] = async function* (
      body,
      signal,
      onRetry,
      budget,
      admit,
      confirmed,
    ) {
      const price = modelPolicyFor(body.model).pricing
      if (price.kind !== 'priced') throw new Error(UI_TEXT.execModelUnpriced)
      const inputTokens = estimateInput(requestParts(body), undefined).inputTokens
      const outputTokens = body.max_output_tokens
      const reservation = Usd.from(price.card.input)
        .times(inputTokens)
        .add(Usd.from(price.card.output).times(outputTokens))
        .toAmount()
      const lease = await acquire({
        costUsd: parseUsd(reservation),
        inputTokens,
        outputTokens,
        requests: 1,
      })
      let cost: UsdAmount | null = null
      let usage: { inputTokens: number; outputTokens: number } | undefined
      const digest = await original.currentKeyDigest()
      const events = lease.client.streamResponse(
        body,
        signal,
        onRetry,
        budget,
        paidGuard(lease, admit, digest, now),
        confirmed === undefined
          ? undefined
          : {
              ...confirmed,
              keyDigest: lease.keyDigest,
              isStillAllowed: () => confirmed.isStillAllowed() && lease.isCurrent(),
            },
      )
      try {
        for (;;) {
          const event = await within(lease, () => events.next())
          if (event.done) break
          // The settlement comes from whichever terminal event carries usage:
          // completed, incomplete or failed. Only truly unknown cost stays an
          // upper bound.
          if (isTerminalResponseEvent(event.value) && event.value.response.usage != null) {
            const counted = event.value.response.usage
            const priced = modelPricedUsage(counted)
            if (
              [priced.inputTokens, priced.outputTokens, priced.cachedTokens ?? 0].some(
                (value) => !(Number.isSafeInteger(value) && value >= 0),
              ) ||
              (priced.cachedTokens ?? 0) > priced.inputTokens
            )
              throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
            cost =
              counted.provider_cost_usd === undefined
                ? Usd.from(
                    estimateCostUsd(
                      {
                        inputTokens: priced.inputTokens,
                        outputTokens: priced.outputTokens,
                        cachedTokens: priced.cachedTokens ?? 0,
                      },
                      body.model,
                    ),
                  ).toAmount()
                : Usd.from(counted.provider_cost_usd).toAmount()
            usage = { inputTokens: counted.input_tokens, outputTokens: counted.output_tokens }
          }
          yield event.value
        }
      } finally {
        // The lease releases the underlying generator and stream on every
        // exit, including a consumer that throws mid-stream: nothing stays
        // suspended. Settlement still runs afterwards.
        try {
          await events.return(undefined)
        } finally {
          await lease.settle(cost, usage)
        }
      }
    }
    return {
      ...original,
      hasPaidDailyBudget: original.hasPaidDailyBudget,
      currentKeyDigest: original.currentKeyDigest.bind(original),
      retryDelayMs: original.retryDelayMs.bind(original),
      waitBeforeRetry: original.waitBeforeRetry.bind(original),
      listModels: original.listModels.bind(original),
      countInputTokens: original.countInputTokens.bind(original),
      createImage: image,
      editImage: image,
      streamResponse: stream,
    }
  }

  public withinRequest<T>(
    kind: AccountPoolRequest['kind'],
    owner: string,
    run: () => Promise<T>,
  ): Promise<T> {
    return this.deps.pool.withinRequest(kind, owner, run)
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
        // The stop event belongs to this lease's own payer: a retry admission
        // pinned to A names A even while B is queued for the next request.
        const account =
          request.retryAccount ?? this.current(request.kind, request.owner) ?? request.account
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
            paidClient: client.paidClient,
            isCurrent,
            rateLimit: (resetAt) => {
              wasRateLimited = true
              this.deps.rateLimit?.(binding.account, resetAt, {
                ...limitIdentity,
                expiresAt: Date.parse(resetAt),
              })
            },
            beforeSend: () => {
              // A retry is a new send on this same lease: recheck the payer's
              // currency and caps instead of refusing a second send.
              if (!isCurrent()) throw new Error(UI_TEXT.accounts.invalidAccount)
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
