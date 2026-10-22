// Removes every OS-store record a fixture vault wrote (RLVAULTANCHOR): the
// scoped rollback anchor, the scoped audit checkpoint and pending intent,
// and each stored slot key. The broker is already dead when this runs, so
// no writer can race the read-then-delete; a record that is already gone is
// left alone, and any other store failure is loud so a leaking fixture
// fails instead of polluting the person's store. The pre-scoping records
// are never touched: a fixture vault only ever reads them.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { AsyncEntry } from '@napi-rs/keyring'
import { KEYRING_SERVICE } from '../../../../src/shared/constants'
import { peekVaultSlotFiles } from '../../../../src/core/vault/store'
import { isVaultFileMissing } from '../../../../src/core/vault/broker/files'
import {
  vaultAnchorAccount,
  vaultAuditAccount,
  vaultAuditPendingAccount,
  vaultBrokerDataDir,
} from '../../../../src/runtime/vault/vaultStoreScope'

function openEntry(account: string): AsyncEntry {
  return process.platform === 'linux'
    ? new AsyncEntry(KEYRING_SERVICE, account, { linux: { store: 'secret-service' } })
    : new AsyncEntry(KEYRING_SERVICE, account)
}

async function removePassword(account: string): Promise<void> {
  const entry = openEntry(account)
  if ((await entry.getPassword()) != null) await entry.deletePassword()
}

async function removeSecret(account: string): Promise<void> {
  const entry = openEntry(account)
  if ((await entry.getSecret()) != null) await entry.deleteCredential()
}

async function readVaultFile(brokerDataDir: string, name: string): Promise<Buffer | null> {
  try {
    return await readFile(path.join(brokerDataDir, name))
  } catch (error: unknown) {
    // A vault that never set up has no files; anything else keeps its failure.
    if (!isVaultFileMissing(error)) throw error
    return null
  }
}

/**
Deletes the OS-store records of the vault at one fixture client's root:
the scoped anchor always, and the scoped audit records and stored slot
keys of the vault its files name. Reads the files directly — the broker
that owned them is dead — and parses them with the product's own peek.
*/
export async function removeVaultStoreRecords(clientDataDir: string): Promise<void> {
  const brokerDataDir = vaultBrokerDataDir(clientDataDir)
  await removePassword(vaultAnchorAccount(brokerDataDir))
  const slots = await readVaultFile(brokerDataDir, 'slots.v1')
  const pending = slots === null ? await readVaultFile(brokerDataDir, 'pending.v1') : null
  try {
    const peeked = peekVaultSlotFiles(slots, pending)
    if (peeked === null) return
    await removePassword(vaultAuditAccount(brokerDataDir, peeked.vaultId))
    await removePassword(vaultAuditPendingAccount(brokerDataDir, peeked.vaultId))
    for (const reference of peeked.keyReferences) await removeSecret(reference)
  } finally {
    slots?.fill(0)
    pending?.fill(0)
  }
}
