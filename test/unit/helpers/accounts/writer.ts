import { vi } from 'vitest'
import {
  AccountRequestWriter,
  type AccountRequestLease,
} from '../../../../src/core/accounts/requestWriter'
import { AccountStore } from '../../../../src/core/providers/accounts'
import type { AccountCredentialVault } from '../../../../src/core/providers/accountCredentialRecord'
import type { CreateResponseBody } from '../../../../src/core/backends/modelapi/schemas'
import type { CoreLogger } from '../../../../src/core/logging'
import { poolMetadata } from './metadata'
import { poolRig } from './pool'
import { fakeModelApi, fakeModelApiClient, type FakeModelApi } from '../fakeModelApi'

/** One account pool, vault, store and lease writer on the fake Model API. */
export function writerRig(
  origin: string,
  configure?: (api: FakeModelApi) => void,
  log?: CoreLogger,
) {
  const t = poolRig()
  const secrets = new Map(t.rows.map((row) => [row.id, `fake-only-${row.id}`]))
  const api = fakeModelApi({ keys: t.rows.map((row) => `fake-only-${row.id}`) })
  configure?.(api)
  const vault: AccountCredentialVault = {
    read: (binding) =>
      Promise.resolve({
        ...binding,
        v: 1,
        auth: 'apiKey',
        secret: secrets.get(binding.account) ?? '',
      }),
    readForRemoval: () => Promise.resolve(undefined),
    write: (binding, credential) => {
      secrets.set(binding.account, credential.secret)
      return Promise.resolve()
    },
    remove: (binding) => {
      secrets.delete(binding.account)
      return Promise.resolve()
    },
  }
  const store = new AccountStore(poolMetadata(t.rows, origin), vault)
  const client = fakeModelApiClient(
    api,
    log ?? { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  )
  const rateLimit = vi.fn()
  // Production createClient (accountRequestOwner.ts): the lease's paid client
  // is the account-keyed client itself.
  const createClient = vi.fn<ConstructorParameters<typeof AccountRequestWriter>[0]['createClient']>(
    (_binding, apiKey, _request, isCurrent) => {
      const selected = client.withAccountKey(apiKey, isCurrent)
      return Promise.resolve(Object.assign(selected, { paidClient: selected }))
    },
  )
  const writer = new AccountRequestWriter({
    store,
    pool: t.pool,
    refresh: () => Promise.resolve(),
    rateLimit: (account, resetAt, identity) => {
      rateLimit(account, resetAt, identity)
      // Production feedback (accountRequestOwner/journal.block): a 429
      // observation durably blocks the account, so a same-lease retry must
      // survive its own block. A detached spy would hide that fence.
      t.blocks.set(account, { blocked: { reason: 'rateLimited', resetAt } })
    },
    createClient,
  })
  // Persisted selections: production writes one file per adopting owner
  // (journal.select); a transient per-send owner must write none. Suites
  // count these writes to prove no per-send residue.
  const selectionWrites: { owner: string; account: string }[] = []
  t.deps.writeSelection = (owner, account) => {
    selectionWrites.push({ owner, account })
  }
  t.deps.readSelection = (owner) =>
    selectionWrites.findLast((entry) => entry.owner === owner)?.account
  // Live leases: every acquired lease counts until it settles. A repeated
  // settle after a successful one is not a second lease: only the first
  // settlement counts down. Suites assert zero after each test, so any
  // leaked lease fails somewhere.
  let liveLeases = 0
  const acquired = writer.acquire.bind(writer)
  writer.acquire = async (...args: Parameters<typeof acquired>): Promise<AccountRequestLease> => {
    const lease = await acquired(...args)
    liveLeases += 1
    const settled = lease.settle.bind(lease)
    let isCounted = true
    const counted: AccountRequestLease['settle'] = async (...settleArgs) => {
      try {
        await settled(...settleArgs)
      } finally {
        if (isCounted) {
          isCounted = false
          liveLeases -= 1
        }
      }
    }
    // Escape hatch (PLAN.md §8): the rig counts live leases by wrapping the
    // readonly settle; production code never reassigns it.
    ;(lease as { settle: AccountRequestLease['settle'] }).settle = counted
    return lease
  }
  return {
    ...t,
    api,
    store,
    client,
    writer,
    createClient,
    rateLimit,
    selectionWrites,
    liveLeases: () => liveLeases,
  }
}

/** A priced request body for paid-helper stream tests. */
export function paidHelperBody(): CreateResponseBody {
  return {
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Review this change.' }],
      },
    ],
    model: 'muse-spark-1.3',
    instructions: 'Lease review',
    tools: [],
    max_output_tokens: 32,
    reasoning: { effort: 'low' },
    prompt_cache_key: 'lease-test-prefix',
    prompt_cache_retention: '24h',
    tool_choice: 'auto',
    stream: true,
    store: false,
    include: [],
  }
}
