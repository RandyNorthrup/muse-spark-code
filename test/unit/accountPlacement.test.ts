// M108 D placement over real modules: the file metadata, the account store
// with its placement port, the routing layer's AccountPlacements and the
// terminal commands, all against scratch dirs. The vault is a real
// in-memory store (no keychain on this rig); nothing is scripted.
import { readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AccountStoreError } from '../../src/core/providers/accountCredentialRecord'
import { AccountStore } from '../../src/core/providers/accounts'
import {
  createAccountPlacements,
  localPlacementDeviceMatcher,
  localPlacementId,
} from '../../src/core/accounts/placement'
import { AccountPlacementError } from '../../src/core/team/remotePool'
import { accountPolicyFor } from '../../src/core/providers/accountPolicy'
import { presetById } from '../../src/core/providers/presets'
import {
  parseAccountsCommand,
  runAccountsCommand,
  type AccountsCommandDeps,
} from '../../src/runtime/providers/accountsCommand'
import {
  fileAccountsMetadata,
  runtimeProvidersFile,
} from '../../src/runtime/providers/providersFileStore'
import { FileRemoteLimitStore } from '../../src/runtime/providers/accountRemoteLimits'
import { accountHeadroomBucket } from '../../src/core/accounts/headroomBucket'
import { ACCOUNT_HEADROOM_SCALE, MODEL_API_BASE_URL, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import type { Account } from '../../src/shared/accounts'
import { memoryVault } from './helpers/memoryVault'
import { useScratchFolders } from './helpers/scratchFolders'

const scratch = useScratchFolders('temp', 'account-placement-')

function byString(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

interface Harness {
  readonly folder: string
  readonly vault: ReturnType<typeof memoryVault>
  readonly store: AccountStore
  readonly localDevice: string
  readonly commands: AccountsCommandDeps
  readonly errors: string[]
}

async function setup(options?: {
  isRuleOn?: boolean
  known?: readonly string[]
}): Promise<Harness> {
  const folder = await scratch()
  const metadata = fileAccountsMetadata(folder)
  const vault = memoryVault()
  const localDevice = localPlacementId(folder)
  const peers = options?.known ?? []
  const isRuleOn = options?.isRuleOn ?? true
  const store = new AccountStore(metadata, vault, {
    localDevice: () => localDevice,
    isOnePerDevice: () => isRuleOn,
  })
  const placements = createAccountPlacements({
    store,
    metadata,
    listProviders: () => metadata.listProviders(),
    localDevice,
    isKnownDevice: (device) =>
      localPlacementDeviceMatcher(localDevice)(device) || peers.includes(device),
    isOnePerDevice: () => isRuleOn,
  })
  const errors: string[] = []
  return {
    folder,
    vault,
    store,
    localDevice,
    commands: {
      accounts: store,
      metadata,
      placements,
      print: () => undefined,
      printError: (line: string) => {
        errors.push(line)
      },
    },
    errors,
  }
}

function row(id: string, overrides?: Partial<Account>): Account {
  return { id, label: `Label ${id}`, order: 0, thresholds: {}, ...overrides }
}

/** Provider rows staged from production tables, as providerKeyConfirm does. */
async function stageProviders(
  folder: string,
  metaAccounts: readonly Account[] | undefined,
): Promise<void> {
  const preset = presetById('openai')
  const origin = preset?.origin.kind === 'fixed' ? preset.origin.origin : undefined
  if (origin === undefined || preset?.auth !== 'apiKey')
    throw new Error('openai preset unsuitable for the placement drill')
  const policy = accountPolicyFor('openai', 'api')
  if (policy?.pooling === 'notOffered' || !policy?.isCredentialHeld)
    throw new Error('openai/api pooling is not offered')
  await writeFile(
    runtimeProvidersFile(folder),
    JSON.stringify({
      providers: {
        meta: {
          id: 'meta',
          policyProvider: 'meta',
          product: 'model-api',
          auth: 'apiKey',
          origin: new URL(MODEL_API_BASE_URL).origin,
          ...(metaAccounts !== undefined && { accounts: metaAccounts }),
        },
        openai: {
          id: 'openai',
          policyProvider: 'openai',
          product: 'api',
          auth: 'apiKey',
          origin,
          accounts: [],
        },
      },
    }),
  )
}

async function runCommand(harness: Harness, argv: readonly string[]): Promise<number> {
  const command = parseAccountsCommand(argv)
  if (command === undefined) throw new Error(`no command parsed from ${argv.join(' ')}`)
  return await runAccountsCommand(command, harness.commands)
}

async function workDeviceOf(harness: Harness): Promise<string | undefined> {
  const rows = await harness.store.list('meta')
  return rows.find((entry) => entry.id === 'work')?.device
}

async function idsOf(harness: Harness): Promise<string[]> {
  const rows = await harness.store.list('meta')
  return rows.map((entry) => entry.id)
}

async function devicesOf(harness: Harness): Promise<(string | undefined)[]> {
  const rows = await harness.store.list('meta')
  return rows.map((entry) => entry.device)
}

async function failureOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work
  } catch (error: unknown) {
    return error
  }
  throw new Error('the refused call unexpectedly succeeded')
}

describe('M108 D account placement', () => {
  it('refuses a second account of one provider on this device, naming both ways forward', async () => {
    const harness = await setup()
    // The absent accounts field migrates the default account, which holds
    // this device: the second add refuses.
    expect(await idsOf(harness)).toEqual(['default'])
    const failure = (await failureOf(harness.store.add('meta', row('work')))) as AccountStoreError
    expect(failure).toBeInstanceOf(AccountStoreError)
    expect(failure.code).toBe('placementConflict')
    // Legacy rows carry no device field, yet read as this machine: the
    // refusal names the local device with only opaque ids.
    expect(await devicesOf(harness)).toEqual([undefined])
    expect(failure.message).toBe(
      fill(UI_TEXT.accounts.placementConflict, {
        provider: 'meta',
        device: harness.localDevice,
      }),
    )
    expect(failure.placement).toEqual({ provider: 'meta', device: harness.localDevice })
    expect(await harness.store.list('meta')).toHaveLength(1)
  })

  it('allows the second account when the rule is off', async () => {
    const harness = await setup({ isRuleOn: false })
    await harness.store.add('meta', row('work'))
    await harness.store.add('meta', row('personal'))
    expect(await harness.store.list('meta')).toHaveLength(3)
  })

  it('allows different providers on one device', async () => {
    const harness = await setup()
    await stageProviders(harness.folder, undefined)
    expect(await idsOf(harness)).toEqual(['default'])
    await harness.store.add('openai', row('work'))
    expect(await harness.store.list('openai')).toHaveLength(1)
  })

  it('pins an account to another known device and replaces the pin', async () => {
    const peerDevice = localPlacementId(await scratch())
    const movedDevice = localPlacementId(await scratch())
    const harness = await setup({ known: [peerDevice, movedDevice] })
    // Pinning a missing row through the routing layer refuses opaquely,
    // never resurrected; the terminal names the account first (below).
    const missing = (await failureOf(
      harness.commands.placements.pin({ provider: 'meta', account: 'work', device: peerDevice }),
    )) as Error
    expect(missing.message).toBe(UI_TEXT.accounts.routeUnavailable)
    await harness.store.add('meta', row('work', { device: peerDevice }))
    expect(await workDeviceOf(harness)).toBe(peerDevice)
    await harness.commands.placements.pin({
      provider: 'meta',
      account: 'work',
      device: movedDevice,
    })
    // Re-pinning replaces the previous pin: one row, on the new device.
    expect(await harness.store.list('meta')).toHaveLength(2)
    expect(await workDeviceOf(harness)).toBe(movedDevice)
  })

  it('refuses a pin where the provider already has an account, through the routing layer', async () => {
    const harness = await setup({ known: ['peer-1'] })
    await harness.store.add('meta', row('work', { device: 'peer-1' }))
    const failure = (await failureOf(
      harness.commands.placements.pin({
        provider: 'meta',
        account: 'work',
        device: harness.localDevice,
      }),
    )) as AccountPlacementError
    expect(failure).toBeInstanceOf(AccountPlacementError)
    expect(failure.message).toBe(
      fill(UI_TEXT.accounts.placementConflict, {
        provider: 'meta',
        account: 'work',
        device: harness.localDevice,
      }),
    )
    expect(await workDeviceOf(harness)).toBe('peer-1')
  })

  it('serializes competing adds so the first wins and the loser refuses', async () => {
    const harness = await setup()
    // An explicit empty pool removes the migrated default, so exactly one
    // of the two racing adds fits on this device.
    await stageProviders(harness.folder, [])
    const operations = await Promise.allSettled([
      harness.store.add('meta', row('a1')),
      harness.store.add('meta', row('a2')),
    ])
    expect(operations.map((operation) => operation.status).toSorted(byString)).toEqual([
      'fulfilled',
      'rejected',
    ])
    expect(await harness.store.list('meta')).toHaveLength(1)
    const rejected = operations.find((operation) => operation.status === 'rejected')
    expect(rejected?.status).toBe('rejected')
    if (rejected?.status === 'rejected')
      expect((rejected.reason as AccountStoreError).code).toBe('placementConflict')
  })

  it('adds to a known device through the terminal and refuses an unknown one with nothing stored', async () => {
    const harness = await setup({ known: ['peer-1'] })
    expect(
      await runCommand(harness, [
        'add',
        '--provider',
        'meta',
        '--account',
        'work',
        '--label',
        'Work',
        '--device',
        'peer-1',
      ]),
    ).toBe(0)
    expect(await workDeviceOf(harness)).toBe('peer-1')
    expect(
      await runCommand(harness, [
        'add',
        '--provider',
        'meta',
        '--account',
        'away',
        '--label',
        'Away',
        '--device',
        'unknown-9',
      ]),
    ).toBe(1)
    expect(harness.errors).toEqual([UI_TEXT.accounts.routeUnavailable])
    // The refused pin rolled back: no row, no credential, nothing half kept.
    const kept = await idsOf(harness)
    expect(kept.toSorted(byString)).toEqual(['default', 'work'])
    expect(harness.vault.size()).toBe(0)
  })

  it('places through the terminal and refuses an unknown account', async () => {
    const harness = await setup({ known: ['peer-1'] })
    await stageProviders(harness.folder, [])
    expect(
      await runCommand(harness, [
        'add',
        '--provider',
        'meta',
        '--account',
        'work',
        '--label',
        'Work',
      ]),
    ).toBe(0)
    const place = parseAccountsCommand([
      'place',
      'work',
      '--provider',
      'meta',
      '--device',
      'peer-1',
    ])
    expect(place).toMatchObject({ action: 'place', account: 'work', device: 'peer-1' })
    if (place === undefined) throw new Error('the place command did not parse')
    expect(await runAccountsCommand(place, harness.commands)).toBe(0)
    expect(await workDeviceOf(harness)).toBe('peer-1')
    const missing = parseAccountsCommand([
      'place',
      'gone',
      '--provider',
      'meta',
      '--device',
      'peer-1',
    ])
    if (missing === undefined) throw new Error('the missing place command did not parse')
    expect(await runAccountsCommand(missing, harness.commands)).toBe(1)
    expect(harness.errors).toEqual([UI_TEXT.accounts.invalidAccount])
  })
})

describe('M108 D offer headroom buckets', () => {
  it('maps journal capacity to the advertised bucket', () => {
    const scale = BigInt(ACCOUNT_HEADROOM_SCALE)
    expect(accountHeadroomBucket(scale, false)).toBe('ample')
    expect(accountHeadroomBucket(scale / 2n, false)).toBe('ample')
    expect(accountHeadroomBucket(scale / 2n - 1n, false)).toBe('some')
    expect(accountHeadroomBucket(1n, false)).toBe('some')
    expect(accountHeadroomBucket(0n, false)).toBe('none')
    expect(accountHeadroomBucket(-1n, false)).toBe('none')
    // A blocked account offers nothing, however much room its meters show.
    expect(accountHeadroomBucket(scale, true)).toBe('none')
  })
})

describe('M108 D remote limit blocks', () => {
  it('persists an owner block across instances', async () => {
    const folder = await scratch()
    const dir = path.join(folder, 'remote-limits')
    const store = new FileRemoteLimitStore(dir)
    const owner = JSON.stringify(['meta', 'worker', 'worker-1'])
    expect(await store.read(owner)).toBeUndefined()
    const block = { account: 'work', scope: 'account', expiresAt: 1_790_000_000_000 } as const
    await store.write(owner, block)
    const reopened = new FileRemoteLimitStore(dir)
    expect(await reopened.read(owner)).toEqual(block)
    const other = JSON.stringify(['meta', 'worker', 'worker-2'])
    await reopened.write(other, block)
    expect(await reopened.read(other)).toEqual(block)
  })

  it('keeps a malformed record loud', async () => {
    const folder = await scratch()
    const dir = path.join(folder, 'remote-limits')
    const store = new FileRemoteLimitStore(dir)
    const owner = JSON.stringify(['meta', 'worker', 'worker-1'])
    await store.write(owner, { account: 'work', scope: 'account', expiresAt: 1 })
    const names = await readdir(dir)
    const first = names.find((name) => name.startsWith('remote-limit-'))
    if (first === undefined) throw new Error('no limit record was written')
    await writeFile(path.join(dir, first), '{broken')
    await expect(store.read(owner)).rejects.toThrow()
  })
})
