// The real management, repository, slot unlock and store over generated
// in-memory ports, shared by the C-M109-1 suites. Material is generated; no
// broker, OS store or network is used.

import { vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { type VaultStatus } from '../../../src/shared/vaultProtocol'
import { VaultManagement } from '../../../src/core/vault/broker/management'
import {
  VaultSlotUnlock,
  VaultStoreRepository,
  type VaultAnchorPort,
} from '../../../src/core/vault/broker/repository'
import { FakeVaultClock, FakeVaultSlot, fakeOsStoreProvider } from '../helpers/vault/core'
import { MemoryVaultAnchor, MemoryVaultFiles } from './storeFixtures'
import { VaultError } from '../../../src/core/vault/crypto'
import type { VaultGenerationState } from '../../../src/core/vault/store'

const homes: string[] = []
/** Removes only generated homes owned by this worker's completed tests. */
export async function cleanupTempHomes(): Promise<void> {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
}
/** Creates an isolated generated home, removed after the owning test. */
export async function tempHome(): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'cm1091-home-'))
  homes.push(home)
  return home
}

export class AnchorWithId extends MemoryVaultAnchor implements VaultAnchorPort {
  vaultId(): Promise<string | null> {
    const [first] = this.states.keys()
    return Promise.resolve(first ?? null)
  }
  reset(
    vaultId: string,
    expected: VaultGenerationState | null,
    authorize: () => void,
  ): Promise<void> {
    authorize()
    if (JSON.stringify(this.states.get(vaultId) ?? null) !== JSON.stringify(expected))
      return Promise.reject(new VaultError('rollback'))
    this.states.delete(vaultId)
    return Promise.resolve()
  }
}
export async function stateOf(management: VaultManagement): Promise<string> {
  const snapshot = await management.snapshot()
  return snapshot.status.state
}

/** `wrapHold` delays the OS-store wrap; the provider reads the key only after it. */
export function managementFixture(wrapHold?: Promise<void>, homeDir?: string) {
  const clock = new FakeVaultClock()
  const files = new MemoryVaultFiles()
  const anchor = new AnchorWithId()
  const repository = new VaultStoreRepository(files, anchor)
  const osStore = new FakeVaultSlot('osStore')
  const wrapped: Uint8Array[] = []
  const wrapping = { started: 0 }
  const slots = fakeOsStoreProvider(osStore, async (key) => {
    wrapping.started += 1
    await wrapHold
    wrapped.push(Uint8Array.from(key))
  })
  const unlock = new VaultSlotUnlock(files, anchor, slots)
  let status: VaultStatus = {
    state: 'locked',
    lockEpoch: 0,
    tier: null,
    provider: null,
    silentUnlock: true,
    itemCount: 0,
    reason: null,
  }
  const broker = {
    status: vi.fn(() => Promise.resolve(status)),
    unlock: vi.fn(async (slotId: string | null) => {
      const { key } = await unlock.unlock(slotId)
      try {
        await repository.open(key)
      } finally {
        key.fill(0)
      }
      status = { ...status, state: 'unlocked', tier: 'osStore' }
    }),
    lock: () => {
      repository.current().lock()
      status = { ...status, state: 'locked' }
    },
    policyChanged: vi.fn(() => Promise.resolve()),
  }
  const home = homeDir ?? '/nonexistent-generated-home'
  const management = new VaultManagement({
    files,
    anchor,
    repository,
    unlock,
    slots,
    broker,
    clock,
    home,
  })
  return {
    clock,
    files,
    anchor,
    repository,
    osStore,
    unlock,
    broker,
    management,
    wrapped,
    wrapping,
  }
}

/** Starts the confirmation and waits until it holds inside the OS-store wrap. */
export async function heldConfirmation(
  f: ReturnType<typeof managementFixture>,
  setupId: string,
): Promise<{ confirming: Promise<void> }> {
  const confirming = f.management.confirmSetup(setupId)
  await vi.waitFor(() => {
    if (f.wrapping.started !== 1) throw new Error('waiting for the wrap')
  })
  // Wrapped: an async function would otherwise flatten (and await) the confirmation.
  return { confirming }
}
/** Creates the vault, then locks it, returning an owned copy of its recovery code. */
export async function lockedVault(f: ReturnType<typeof managementFixture>): Promise<Buffer> {
  const shown = await f.management.setup()
  const code = Buffer.from(shown.code)
  shown.code.fill(0)
  await f.management.confirmSetup(shown.setupId)
  f.broker.lock()
  return code
}

/** Sets up a vault and holds its confirmation inside the delayed OS-store wrap. */
export async function heldSetupConfirmation(f: ReturnType<typeof managementFixture>) {
  const shown = await f.management.setup()
  const { confirming } = await heldConfirmation(f, shown.setupId)
  return { shown, confirming }
}

/** A .netrc written into a temp home and imported through an unlocked vault. */
export async function importedNetrc() {
  const home = await tempHome()
  const file = path.join(home, '.netrc')
  await writeFile(file, 'machine example.test login generated-user password generated-password\n')
  const f = managementFixture(undefined, home)
  const setup = await lockedVault(f)
  setup.fill(0)
  await f.broker.unlock(null)
  const report = await f.management.importFile(file, () => true)
  return { f, home, file, report, store: f.repository.current() }
}
