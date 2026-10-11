import { removeTestFolders } from './helpers/tempFolders'
import { mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { accountPaidFiles } from '../../src/host/paid/accountPaidFiles'
import {
  StaleEpochError,
  accountBindingKey,
  type PaidAccountBinding,
  type AccountBindingGrants,
} from '../../src/core/paid/accountPaidConsent'
import { ACCOUNT_QUOTE_GRANT_VERSION, type PaidFeature } from '../../src/shared/constants'
import type { PaidGrant } from '../../src/core/paid/paidAuthority'
import { Usd } from '../../src/shared/usd'
import { FakeLogOutputChannel } from './helpers/fakes'
import { quotedSearch } from './helpers/paidQuote'

// M108 lane P: the production account consent store, over a real folder.
// Two store objects on one folder stand for two windows or agent processes.

const BINDING: PaidAccountBinding = {
  provider: 'meta',
  account: 'work',
  price: '$5 per 1,000 searches',
  tariff: '["webSearch","0.005"]',
  dailyBudgetUsd: Usd.from(5).toAmount(),
}
const KEY = accountBindingKey(BINDING)

const folders: string[] = []
afterEach(() => {
  removeTestFolders(folders)
})

function rig() {
  const folder = mkdtempSync(path.join(tmpdir(), 'm108p-account-paid-'))
  folders.push(folder)
  const generations = new Map<PaidFeature, string>()
  const log = new FakeLogOutputChannel()
  const open = () =>
    accountPaidFiles(
      {
        folder,
        featureGeneration: (feature) => generations.get(feature) ?? 'g1',
        sleep: () => Promise.resolve(),
        log,
      },
      KEY,
    )
  return { folder, generations, log, open, store: open() }
}

function quoteGrant(epoch: number, model = 'model-a', order = 1): PaidGrant {
  return {
    quote: quotedSearch('0.005', model).quote,
    order,
    generation: JSON.stringify({ v: ACCOUNT_QUOTE_GRANT_VERSION, epoch, hostGeneration: 'h' }),
  }
}

function bindingGrants(epoch: number, features: readonly PaidFeature[]): AccountBindingGrants {
  return {
    epoch,
    features: new Set(features),
    generations: new Map(features.map((feature) => [feature, 'g1'])),
  }
}

/** Keeps voice under epoch 0, then revokes to epoch 1; returns the binding's folder. */
async function voiceThenAdvanced(t: ReturnType<typeof rig>): Promise<string> {
  await t.store.saveGrantIf(KEY, 0, bindingGrants(0, ['voice']))
  await t.store.advanceEpoch(KEY, 0)
  const [binding] = readdirSync(t.folder)
  return path.join(t.folder, binding ?? '')
}

/** Every record file in the binding's folder (markers excluded). */
function records(folder: string): string[] {
  const [binding] = readdirSync(folder)
  return binding === undefined
    ? []
    : readdirSync(path.join(folder, binding))
        .filter((name) => !name.startsWith('epoch-'))
        .toSorted((left, right) => left.localeCompare(right))
}

describe('M108 lane P account consent store', () => {
  it('advances the epoch only from the current one, and only one writer wins', async () => {
    const t = rig()
    const other = t.open()
    expect(t.store.readRevocationEpoch(KEY)).toBeUndefined()
    await t.store.advanceEpoch(KEY, 0)
    await expect(other.advanceEpoch(KEY, 0)).rejects.toBeInstanceOf(StaleEpochError)
    // Two windows that both read epoch 1 race to 2: exactly one wins.
    const raced = await Promise.allSettled([
      t.store.advanceEpoch(KEY, 1),
      other.advanceEpoch(KEY, 1),
    ])
    expect(raced.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const lost = raced.find((result) => result.status === 'rejected')
    expect(lost?.reason).toBeInstanceOf(StaleEpochError)
    expect(other.readRevocationEpoch(KEY)).toBe(2)
  })

  it('never moves the epoch backwards: a delayed writer is refused', async () => {
    const t = rig()
    for (const expected of [0, 1, 2]) await t.store.advanceEpoch(KEY, expected)
    await expect(t.open().advanceEpoch(KEY, 1)).rejects.toBeInstanceOf(StaleEpochError)
    expect(t.store.readRevocationEpoch(KEY)).toBe(3)
  })

  it('reads only grants approved under the current epoch', async () => {
    const t = rig()
    await t.store.saveGrantIf(KEY, 0, bindingGrants(0, ['voice']))
    expect(t.open().readGrants(KEY)).toEqual(bindingGrants(0, ['voice']))
    await t.store.advanceEpoch(KEY, 0)
    expect(t.store.readGrants(KEY)).toBeUndefined()
    await t.store.saveGrantIf(KEY, 1, bindingGrants(1, ['judge']))
    expect(t.open().readGrants(KEY)).toEqual(bindingGrants(1, ['judge']))
  })

  it('refuses a save under an epoch that is no longer current, storing nothing current', async () => {
    const t = rig()
    await t.store.advanceEpoch(KEY, 0)
    await expect(t.store.saveGrantIf(KEY, 0, bindingGrants(0, ['voice']))).rejects.toBeInstanceOf(
      StaleEpochError,
    )
    await expect(t.store.saveQuoteGrantIf(KEY, 0, quoteGrant(0))).rejects.toBeInstanceOf(
      StaleEpochError,
    )
    expect(t.store.readGrants(KEY)).toBeUndefined()
    expect(t.store.readQuoteGrant(quoteGrant(0).quote)).toBeUndefined()
    expect(records(t.folder)).toEqual([])
  })

  it('never reads a grant written under an older epoch after a revoke landed', async () => {
    const t = rig()
    const folder = await voiceThenAdvanced(t)
    // A writer that passed its check before the advance lands its file late.
    writeFileSync(
      path.join(folder, 'grant-0-imageGeneration.json'),
      JSON.stringify({ generation: 'g1' }),
    )
    expect(t.store.readGrants(KEY)).toBeUndefined()
  })

  it('clears only grants and quotes approved before the cutoff', async () => {
    const t = rig()
    await t.store.saveGrantIf(KEY, 0, bindingGrants(0, ['voice']))
    await t.store.saveQuoteGrantIf(KEY, 0, quoteGrant(0))
    await t.store.advanceEpoch(KEY, 0)
    // Approved after the advance, before the older revoke's clears ran.
    await t.store.saveGrantIf(KEY, 1, bindingGrants(1, ['judge']))
    await t.store.saveQuoteGrantIf(KEY, 1, quoteGrant(1))
    await t.store.clearGrantsBefore(KEY, 1)
    await t.store.revokeQuoteGrants(KEY, 1)
    expect(records(t.folder).every((name) => /^(grant|quote)-1-/u.test(name))).toBe(true)
    expect(records(t.folder)).toHaveLength(2)
    expect(t.open().readGrants(KEY)).toEqual(bindingGrants(1, ['judge']))
    expect(t.open().readQuoteGrant(quoteGrant(1).quote)).toEqual(quoteGrant(1))
  })

  it('keeps each feature in its own record, so two windows never overwrite each other', async () => {
    const t = rig()
    await Promise.all([
      t.store.saveGrantIf(KEY, 0, bindingGrants(0, ['voice'])),
      t.open().saveGrantIf(KEY, 0, bindingGrants(0, ['judge'])),
    ])
    expect(t.open().readGrants(KEY)?.features).toEqual(new Set(['voice', 'judge']))
  })

  it('lapses a kept grant when its feature’s price acceptance changes', async () => {
    const t = rig()
    await t.store.saveGrantIf(KEY, 0, bindingGrants(0, ['voice', 'judge']))
    t.generations.set('voice', 'g2')
    expect(t.store.readGrants(KEY)).toEqual(bindingGrants(0, ['judge']))
  })

  it('refuses a captured grant after host revocation instead of stamping the new generation', async () => {
    const t = rig()
    const captured = bindingGrants(0, ['voice'])
    t.generations.set('voice', 'g2')
    await expect(t.store.saveGrantIf(KEY, 0, captured)).rejects.toBeInstanceOf(StaleEpochError)
    expect(t.store.readGrants(KEY)).toBeUndefined()
    expect(readdirSync(t.folder)).toEqual([])
  })

  it('refuses a grant without its question’s captured generations', async () => {
    const t = rig()
    await expect(
      t.store.saveGrantIf(KEY, 0, { ...bindingGrants(0, ['voice']), generations: new Map() }),
    ).rejects.toBeInstanceOf(StaleEpochError)
    expect(readdirSync(t.folder)).toEqual([])
  })

  it('returns the latest kept quote for the same feature, provider and model only', async () => {
    const t = rig()
    await t.store.saveQuoteGrantIf(KEY, 0, quoteGrant(0, 'model-a', 1))
    await t.store.saveQuoteGrantIf(KEY, 0, quoteGrant(0, 'model-a', 2))
    expect(t.open().readQuoteGrant(quoteGrant(0).quote)?.order).toBe(2)
    expect(t.store.readQuoteGrant(quoteGrant(0, 'model-b').quote)).toBeUndefined()
  })

  it('answers for its own binding only', async () => {
    const t = rig()
    const other = accountBindingKey({ ...BINDING, account: 'personal' })
    expect(() => t.store.readGrants(other)).toThrow(StaleEpochError)
    await expect(t.store.advanceEpoch(other, 0)).rejects.toBeInstanceOf(StaleEpochError)
    await expect(t.store.clearGrantsBefore(other, 1)).rejects.toBeInstanceOf(StaleEpochError)
    expect(t.store.readRevocationEpoch(KEY)).toBeUndefined()
  })

  it('ignores a damaged record and says so, granting nothing', async () => {
    const t = rig()
    await t.store.saveGrantIf(KEY, 0, bindingGrants(0, ['voice']))
    const [binding] = readdirSync(t.folder)
    writeFileSync(path.join(t.folder, binding ?? '', 'grant-0-voice.json'), 'not json')
    expect(t.store.readGrants(KEY)).toBeUndefined()
    expect(t.log.warn).toHaveBeenCalledWith(expect.stringContaining('grant-0-voice.json ignored'))
  })

  it.skipIf(process.platform === 'win32')(
    'keeps the binding folder and its records owner-only',
    async () => {
      const folder = await voiceThenAdvanced(rig())
      expect(statSync(folder).mode & 0o777).toBe(0o700)
      for (const name of readdirSync(folder))
        expect(statSync(path.join(folder, name)).mode & 0o777).toBe(0o600)
    },
  )
})
