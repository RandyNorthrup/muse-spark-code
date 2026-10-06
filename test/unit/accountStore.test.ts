import { describe, expect, it, vi } from 'vitest'
import {
  AccountStore,
  accountClientLookup,
  type AccountProvider,
  type AccountsMetadataPort,
} from '../../src/core/providers/accounts'
import type {
  AccountBinding,
  AccountCredential,
  AccountCredentialVault,
} from '../../src/core/providers/credentialRecord'
import type { Account } from '../../src/shared/accounts'
import { UI_TEXT } from '../../src/shared/constants'

const work: Account = { id: 'work', label: 'Work', order: 1, thresholds: {} }
const personal: Account = { id: 'personal', label: 'Personal', order: 2, thresholds: {} }
const origin = 'https://provider.invalid'
const workBinding: AccountBinding = { provider: 'vendor', account: 'work', origin }
const workRecord: AccountCredential = { ...workBinding, v: 1, auth: 'apiKey', secret: 'only-work' }

function harness(overrides: Partial<AccountProvider> = {}) {
  let provider: AccountProvider = {
    id: 'vendor',
    policyProvider: 'openai',
    product: 'api',
    auth: 'apiKey',
    origin,
    ...overrides,
  }
  const saved: Account[][] = []
  const metadata: AccountsMetadataPort = {
    read: vi.fn<AccountsMetadataPort['read']>((id) =>
      Promise.resolve(id === provider.id ? provider : undefined),
    ),
    writeAccounts: vi.fn<AccountsMetadataPort['writeAccounts']>((_id, accounts) => {
      const rows = structuredClone([...accounts])
      provider = { ...provider, accounts: rows }
      saved.push(rows)
      return Promise.resolve()
    }),
  }
  const secrets = new Map<string, AccountCredential>()
  const vault: AccountCredentialVault = {
    read: vi.fn<AccountCredentialVault['read']>((binding) =>
      Promise.resolve(secrets.get(binding.account)),
    ),
    write: vi.fn<AccountCredentialVault['write']>((binding, record) => {
      secrets.set(binding.account, record)
      return Promise.resolve()
    }),
    remove: vi.fn<AccountCredentialVault['remove']>((binding) => {
      secrets.delete(binding.account)
      return Promise.resolve()
    }),
  }
  const store = new AccountStore(metadata, vault)
  return { store, metadata, vault, secrets, saved }
}

describe('M108 account metadata and clients', () => {
  it('validates provider ids before configuration reads', async () => {
    const h = harness()
    await expect(h.store.list('invalid/id')).rejects.toMatchObject({ code: 'invalidAccount' })
    expect(h.metadata.read).not.toHaveBeenCalled()
  })

  it('migrates the legacy credential identity without reading or moving its secret', async () => {
    const h = harness()
    expect(await h.store.list('vendor')).toEqual([
      { id: 'default', label: UI_TEXT.accounts.defaultLabel, order: 0, thresholds: {} },
    ])
    expect(h.vault.read).not.toHaveBeenCalled()
    expect(h.vault.write).not.toHaveBeenCalled()
    expect(h.saved).toEqual([])
    await h.store.add('vendor', work)
    expect(h.saved[0]?.map((row) => row.id)).toEqual(['default', 'work'])
  })

  it('does not resurrect an explicitly removed default, and can re-add it', async () => {
    const h = harness()
    await h.store.remove('vendor', 'default')
    expect(await h.store.list('vendor')).toEqual([])
    expect(h.vault.remove).toHaveBeenCalledWith({ provider: 'vendor', account: 'default', origin })
    await h.store.add('vendor', { ...work, id: 'default' })
    const pool = await h.store.list('vendor')
    expect(pool.map((row) => row.id)).toEqual(['default'])
  })

  it('adds, labels, groups, sets thresholds and orders accounts with no secret in metadata', async () => {
    const h = harness()
    await h.store.add('vendor', work)
    await h.store.add('vendor', personal)
    await h.store.update('vendor', { ...work, label: 'Team', limitGroup: 'organisation' })
    await h.store.thresholds('vendor', 'work', { spendUsd: { day: 20 }, requests: { month: 100 } })
    await h.store.order('vendor', ['personal', 'work', 'default'])
    const ordered = await h.store.list('vendor')
    expect(ordered.map((row) => [row.id, row.order])).toEqual([
      ['personal', 0],
      ['work', 1],
      ['default', 2],
    ])
    expect(ordered.find((row) => row.id === 'work')).toMatchObject({
      label: 'Team',
      limitGroup: 'organisation',
      thresholds: { spendUsd: { day: 20 } },
    })
    await h.store.setCredential('vendor', 'work', workRecord)
    expect(JSON.stringify(h.saved)).not.toContain(workRecord.secret)
    expect(h.secrets.get('work')).toEqual(workRecord)
  })

  it('rejects duplicate ids, unknown rows, malformed metadata and incomplete order without writes', async () => {
    const h = harness({ accounts: [work, personal] })
    for (const operation of [
      () => h.store.add('vendor', work),
      () => h.store.add('vendor', { ...work, id: 'invalid/id' }),
      () => h.store.add('vendor', { ...work, id: 'new', label: ' ' }),
      () => h.store.update('vendor', { ...work, id: 'absent' }),
      () => h.store.update('vendor', { ...work, label: ' ' }),
      () => h.store.thresholds('vendor', 'absent', {}),
      () => h.store.thresholds('vendor', 'work', { requests: { day: -1 } }),
      () => h.store.order('vendor', ['work']),
      () => h.store.order('vendor', ['work', 'work']),
      () => h.store.order('vendor', ['work', 'absent']),
      () => h.store.remove('vendor', 'absent'),
      () => h.store.list('invalid/id'),
      () => h.store.list('absent'),
    ]) {
      await expect(operation()).rejects.toThrow()
    }
    expect(h.saved).toEqual([])
    expect(h.vault.remove).not.toHaveBeenCalled()
  })

  it.each([
    ['anthropic', 'claude-plan'],
    ['google', 'consumer'],
    ['zai', 'coding-plan'],
    ['github', 'copilot'],
    ['github', 'free'],
  ])('rejects credentials this harness does not hold: %s/%s', async (policyProvider, product) => {
    const h = harness({ policyProvider, product })
    await expect(h.store.add('vendor', work)).rejects.toMatchObject({ code: 'notOffered' })
    expect(h.saved).toEqual([])
  })

  it('keeps Muse Code multi-account off until the capture-owned lane supplies it', async () => {
    const h = harness({ policyProvider: 'meta', product: 'muse-code' })
    await expect(h.store.add('vendor', work)).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('serializes concurrent adds and recovers after a failed mutation', async () => {
    const h = harness()
    await expect(h.store.add('vendor', { ...work, id: 'default' })).rejects.toThrow()
    await Promise.all([h.store.add('vendor', work), h.store.add('vendor', personal)])
    const pool = await h.store.list('vendor')
    expect(pool.map((row) => row.id)).toEqual(['default', 'work', 'personal'])
  })

  it('does not hold accounts or send an old credential on an unauthenticated local provider', async () => {
    const h = harness({ auth: 'none', accounts: [work] })
    h.secrets.set('work', workRecord)
    await expect(h.store.add('vendor', personal)).rejects.toThrow('notOffered')
    await expect(h.store.setCredential('vendor', 'work', workRecord)).rejects.toThrow('notOffered')
    const use = vi.fn((_binding: AccountBinding, credential: AccountCredential | undefined) =>
      Promise.resolve(credential),
    )
    expect(await h.store.useCredential('vendor', 'work', origin, use)).toBeUndefined()
    expect(h.vault.read).not.toHaveBeenCalled()
  })

  it('refuses a notOffered product even when its accounts were planted in the file', async () => {
    const h = harness({ policyProvider: 'anthropic', product: 'claude-plan', accounts: [work] })
    h.secrets.set('work', workRecord)
    await expect(h.store.setCredential('vendor', 'work', workRecord)).rejects.toThrow('notOffered')
    await expect(
      h.store.useCredential('vendor', 'work', origin, () => Promise.resolve()),
    ).rejects.toThrow('notOffered')
    expect(h.vault.read).not.toHaveBeenCalled()
    expect(h.vault.write).not.toHaveBeenCalled()
  })

  it('rejects a secret field and an overfull pool before persisting metadata', async () => {
    const h = harness()
    const extraField = { ...work, apiKey: workRecord.secret }
    await expect(h.store.add('vendor', extraField)).rejects.toThrow()
    expect(h.saved).toEqual([])
    const full = harness({
      accounts: Array.from({ length: 64 }, (_, i) => ({ ...work, id: `a${String(i)}` })),
    })
    await expect(full.store.add('vendor', personal)).rejects.toThrow()
    expect(full.saved).toEqual([])
  })

  it('does not remove metadata when secret deletion or revocation fails', async () => {
    const h = harness({ accounts: [work] })
    vi.mocked(h.vault.remove).mockRejectedValue(new Error('revocation failed'))
    await expect(h.store.remove('vendor', 'work')).rejects.toThrow()
    expect(h.saved).toEqual([])
    expect(await h.store.list('vendor')).toEqual([work])
  })

  it('reports metadata failure after deleting a secret instead of claiming removal succeeded', async () => {
    const h = harness({ accounts: [work] })
    h.secrets.set('work', workRecord)
    vi.mocked(h.metadata.writeAccounts).mockRejectedValue(new Error('disk full'))
    await expect(h.store.remove('vendor', 'work')).rejects.toThrow('disk full')
    expect(h.secrets.has('work')).toBe(false)
  })

  it.each([
    'https://different.invalid/v1',
    ['http:', '//provider.invalid/v1'].join(''),
    'https://provider.invalid:8443/v1',
  ])('refuses a request origin change before reading any credential: %s', async (url) => {
    const h = harness({ accounts: [work] })
    const dispatch = vi.fn(() => Promise.resolve())
    await expect(h.store.useCredential('vendor', 'work', url, dispatch)).rejects.toMatchObject({
      code: 'originMismatch',
    })
    expect(h.vault.read).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('validates configured provider identity and canonical origin before vault I/O', async () => {
    const h = harness({ id: 'other' })
    vi.mocked(h.metadata.read).mockResolvedValue({
      id: 'other',
      policyProvider: 'openai',
      product: 'api',
      auth: 'apiKey',
      origin,
    })
    await expect(h.store.list('vendor')).rejects.toMatchObject({ code: 'unavailable' })
    const invalid = harness({ origin: `${origin}/path`, accounts: [work] })
    await expect(invalid.store.setCredential('vendor', 'work', workRecord)).rejects.toThrow()
    expect(invalid.vault.write).not.toHaveBeenCalled()
  })

  it('validates credentials even when an injected vault returns the wrong account', async () => {
    const h = harness({ accounts: [work] })
    h.secrets.set('work', { ...workRecord, account: 'personal' })
    const dispatch = vi.fn(() => Promise.resolve())
    await expect(
      h.store.useCredential('vendor', 'work', `${origin}/v1`, dispatch),
    ).rejects.toMatchObject({ code: 'originMismatch' })
    await expect(
      h.store.setCredential('vendor', 'work', { ...workRecord, account: 'personal' }),
    ).rejects.toMatchObject({ code: 'originMismatch' })
    expect(dispatch).not.toHaveBeenCalled()
    expect(h.vault.write).not.toHaveBeenCalled()
  })

  it('builds separate clients and scans from each account, with no A header on B', async () => {
    const h = harness({ accounts: [work, personal] })
    h.secrets.set('work', workRecord)
    h.secrets.set('personal', { ...workRecord, account: 'personal', secret: 'only-personal' })
    const frames: { account: string; header: string | undefined }[] = []
    const lookup = accountClientLookup(h.store, {
      create: (binding, credential) =>
        Promise.resolve({
          account: binding.account,
          header: credential?.secret,
        }),
      scan: (binding, client) => {
        frames.push(client)
        return Promise.resolve([binding.account === 'work' ? 'private-model' : 'public-model'])
      },
    })
    expect(await lookup.client('vendor', 'work', origin)).toEqual({
      account: 'work',
      header: 'only-work',
    })
    expect(await lookup.client('vendor', 'personal', origin)).toEqual({
      account: 'personal',
      header: 'only-personal',
    })
    expect(await lookup.scan('vendor', 'work', origin)).toEqual(['private-model'])
    expect(await lookup.scan('vendor', 'personal', origin)).toEqual(['public-model'])
    expect(frames).toEqual([
      { account: 'work', header: 'only-work' },
      { account: 'personal', header: 'only-personal' },
    ])
    await h.store.remove('vendor', 'work')
    await expect(lookup.client('vendor', 'work', origin)).rejects.toThrow()
    h.secrets.delete('personal')
    await expect(lookup.client('vendor', 'personal', origin)).rejects.toThrow('unavailable')
  })
})
