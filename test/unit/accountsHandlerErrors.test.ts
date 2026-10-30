// The accounts panel's failure boundary (src/host/models/accountsHandler.ts)
// is kept on purpose: raw adapter errors may contain a credential, so only
// fixed bridge codes ever leave — a foreign failure reads as unavailable,
// with none of its words, while known store codes pass through.
import { expect, it } from 'vitest'
import { AccountConfirmations } from '../../src/core/accounts/confirmations'
import { AccountStoreError } from '../../src/core/providers/accountCredentialRecord'
import { AccountStore } from '../../src/core/providers/accounts'
import {
  AccountsPanelHandler,
  type AccountsPanelHostPort,
} from '../../src/host/models/accountsHandler'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'

const SECRET_MARKER = 'synthetic-credential-marker'

function port(overrides: Partial<AccountsPanelHostPort>): AccountsPanelHostPort {
  const metadata = {
    read: () => Promise.resolve(undefined),
    writeAccounts: () => Promise.resolve(),
  }
  const vault = {
    read: () => Promise.resolve(undefined),
    readForRemoval: () => Promise.resolve(undefined),
    write: () => Promise.resolve(),
    remove: () => Promise.resolve(),
  }
  const confirmations = new AccountConfirmations({
    machineId: 'test-machine',
    store: {
      read: () => Promise.resolve(undefined),
      write: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    },
    now: () => 0,
    ask: () => Promise.resolve(undefined),
  })
  return {
    accounts: new AccountStore(metadata, vault),
    confirmations,
    provider: () => Promise.resolve(undefined),
    currentAccount: () => null,
    settings: () => ({ isSwapOn: false, isParallelOn: false }),
    capabilities: () => ({
      planWindows: [],
      hasRateHeadroom: false,
      usageUrl: null,
      label: 'test',
    }),
    credential: () => Promise.resolve(),
    use: () => Promise.resolve(),
    answer: () => false,
    now: () => 0,
    ...overrides,
  }
}

it('keeps a credential-carrying adapter failure behind unavailable', async () => {
  const handler = new AccountsPanelHandler(
    port({
      provider: () => Promise.reject(new Error(`adapter blew up on ${SECRET_MARKER}`)),
    }),
  )
  const reply = await handler.handle({ type: 'accounts/list', provider: 'p1' })
  expect(reply).toEqual({ type: 'accounts/error', code: 'unavailable' })
  expect(JSON.stringify(reply)).not.toContain(SECRET_MARKER)
})

it('passes the store not-offered code through', async () => {
  const handler = new AccountsPanelHandler(
    port({
      provider: () =>
        Promise.resolve({
          id: 'p1',
          policyProvider: 'unknown-provider',
          product: 'unknown-product',
          auth: 'none',
          origin: 'https://example.com/',
        }),
    }),
  )
  const reply = await handler.handle({ type: 'accounts/use', provider: 'p1', account: 'a1' })
  expect(reply).toEqual({ type: 'accounts/error', code: 'notOffered' })
})

it('passes the placement conflict through with its opaque ids', async () => {
  const conflict = new AccountStoreError(
    'placementConflict',
    fill(UI_TEXT.accounts.placementConflict, { provider: 'p1', device: 'd1' }),
    { placement: { provider: 'p1', device: 'd1' } },
  )
  const entry = {
    id: 'p1',
    policyProvider: 'meta',
    product: 'model-api',
    auth: 'apiKey' as const,
    origin: 'https://example.com/',
    accounts: [{ id: 'a1', label: 'A', order: 0, thresholds: {} }],
  }
  const vault = {
    read: () => Promise.resolve(undefined),
    readForRemoval: () => Promise.resolve(undefined),
    write: () => Promise.resolve(),
    remove: () => Promise.resolve(),
  }
  const handler = new AccountsPanelHandler(
    port({
      provider: () => Promise.resolve(entry),
      accounts: new AccountStore(
        {
          read: () => Promise.resolve(entry),
          writeAccounts: () => Promise.resolve(),
        },
        vault,
      ),
      use: () => Promise.reject(conflict),
    }),
  )
  const reply = await handler.handle({ type: 'accounts/use', provider: 'p1', account: 'a1' })
  expect(reply).toEqual({
    type: 'accounts/error',
    code: 'placementConflict',
    provider: 'p1',
    device: 'd1',
  })
})
