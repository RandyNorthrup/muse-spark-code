// Installed Model API account owner. Shared by ACP/headless; graphical hosts
// can provide the same store and event ports without moving credentials.
import path from 'node:path'
import { loadDeveloperMachineId } from '../../core/developer/machineId'
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import type {
  AccountStore,
  AccountsMetadataPort,
  AccountProvider,
} from '../../core/providers/accounts'
import { AccountPool, accountColdCacheEstimate } from '../../core/accounts/pool'
import { AccountPolicyGate } from '../../core/accounts/policyGate'
import { AccountConfirmations } from '../../core/accounts/confirmations'
import { accountPolicyFor } from '../../core/providers/accountPolicy'
import { AccountRequestWriter } from '../../core/accounts/requestWriter'
import { modelPolicyFor } from '../../core/backends/modelapi/modelPolicy'
import type { ProviderClient } from '../../core/backends/modelapi/client'
import type { Account, AccountEvent } from '../../shared/accounts'
import {
  ACCOUNT_DEFAULT_ID,
  ACCOUNT_REQUEST_STORE,
  TOKENS_PER_MILLION,
  UI_TEXT,
} from '../../shared/constants'
import { Usd } from '../../shared/usd'
import { AccountRequestJournal } from './accountRequestJournal'

/** Runtime policy grants come from the machine store. Without the provider
 * terms surface, a vendor-limit confirmation stops instead of inventing one. */
class RuntimePolicyGate extends AccountPolicyGate {
  public override authorize(request: Parameters<AccountPolicyGate['authorize']>[0]) {
    return super.authorize({ ...request, isInteractive: false })
  }
}

export async function createAccountRequestOwner(deps: {
  readonly provider: string
  readonly store: AccountStore
  readonly metadata: AccountsMetadataPort
  readonly directory: string
  readonly now: () => number
  readonly publish: (owner: string, event: AccountEvent) => void
}) {
  let rows: Account[] = []
  let entry: AccountProvider | undefined
  const journal = new AccountRequestJournal(
    path.join(deps.directory, ACCOUNT_REQUEST_STORE.directory),
    deps.now,
  )
  const refresh = async () => {
    rows = []
    entry = undefined
    entry = await deps.metadata.read(deps.provider)
    rows = await deps.store.list(deps.provider)
  }
  const confirmations = new AccountConfirmations({
    machineId: await loadDeveloperMachineId(deps.directory),
    now: deps.now,
    ask: () => Promise.reject(new Error(UI_TEXT.accounts.unavailable)),
    store: {
      read: async (provider, product) => {
        try {
          const parsed: unknown = JSON.parse(
            await readFile(
              path.join(deps.directory, `confirmation-${provider}-${product}.json`),
              'utf8',
            ),
          )
          return parsed
        } catch (error: unknown) {
          if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'ENOENT'
          )
            return
          throw error
        }
      },
      write: async (provider, product, value) => {
        await mkdir(deps.directory, { recursive: true, mode: ACCOUNT_REQUEST_STORE.directoryMode })
        await writeFile(
          path.join(deps.directory, `confirmation-${provider}-${product}.json`),
          JSON.stringify(value),
          { mode: ACCOUNT_REQUEST_STORE.fileMode },
        )
      },
      remove: (provider, product) =>
        rm(path.join(deps.directory, `confirmation-${provider}-${product}.json`), { force: true }),
    },
  })
  const pool = new AccountPool({
    provider: deps.provider,
    accounts: () => deps.metadata.readNow?.(deps.provider)?.accounts ?? rows,
    policy: () => {
      const current =
        deps.metadata.readNow === undefined ? entry : deps.metadata.readNow(deps.provider)
      return current === undefined
        ? undefined
        : accountPolicyFor(current.policyProvider, current.product)
    },
    journal,
    limits: () => ({
      read: (provider, account) =>
        journal.limits(
          provider,
          account,
          rows.find((row) => row.id === account),
        ),
    }),
    gate: new RuntimePolicyGate(confirmations),
    now: deps.now,
    usageUrl: '',
    headroom: (account) => journal.headroom(account, deps.provider),
    // Meta's captured native model list is checked on the actual account
    // before creating its client; no capability is invented for a BYO row.
    canUseModel: (_account, request) =>
      modelPolicyFor(request.modelId).identity.provider === deps.provider,
    coldCache: (_previous, _next, request) => {
      const pricing = modelPolicyFor(request.modelId).pricing
      if (pricing.kind !== 'priced') throw new Error(UI_TEXT.execModelUnpriced)
      return accountColdCacheEstimate(
        request.estimate.inputTokens,
        Usd.from(pricing.card.input).times(TOKENS_PER_MILLION).toAmount(),
      )
    },
    reserve: (account, estimate, request) => {
      const claim = journal.reserve(deps.provider, account.id, estimate, request)
      return Promise.resolve(claim)
    },
    record: (event) => {
      journal.record(event)
      return Promise.resolve()
    },
    commit: (event, adopt, request) => {
      if (request === undefined) throw new Error(UI_TEXT.accounts.invalidAccount)
      journal.commit(event, adopt)
      deps.publish(request.owner, event)
    },
    sharedGroupNotice: () => Promise.reject(new Error(UI_TEXT.accounts.vendorLimit)),
  })
  return {
    pool,
    refresh,
    requests: (
      client: ProviderClient,
      options: { account?: string; isInteractive: boolean; hasPoolFlag: boolean },
    ) =>
      new AccountRequestWriter({
        store: deps.store,
        pool,
        refresh,
        defaults: () => ({
          account: options.account ?? ACCOUNT_DEFAULT_ID,
          isInteractive: options.isInteractive,
          hasPoolFlag: options.hasPoolFlag,
        }),
        receipt: (request, usage, cost) => {
          journal.receipt(request, usage, cost)
        },
        rateLimit: (account, resetAt, identity) => {
          journal.block(deps.provider, account, resetAt, identity)
        },
        createClient: async (_binding, apiKey, request, isCurrent) => {
          if (client.withAccountKey === undefined) throw new Error(UI_TEXT.accounts.unavailable)
          const selected = client.withAccountKey(apiKey, isCurrent)
          const models = await selected.listModels()
          if (!models.includes(request.modelId)) throw new Error(UI_TEXT.execUnknownModel)
          return selected
        },
      }),
  }
}
