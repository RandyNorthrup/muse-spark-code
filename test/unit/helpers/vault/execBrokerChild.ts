import {
  configureBrokerResources,
  createVaultBrokerProcess,
  guardBrokerProcessStreams,
  runVaultBrokerEntry,
} from '../../../../src/runtime/vault/vaultBrokerEntry'
import { createVaultBrokerBindings } from '../../../../src/runtime/vault/brokerBindings'
import {
  FileVaultAnchor,
  fileRecordEntries,
  vaultAnchorFile,
} from '../../../../src/runtime/vault/fileAnchor'
import {
  freshOsStoreSlot,
  openPlatformOsStoreSlot,
} from '../../../../src/runtime/vault/slots/slotEntries'
import type { VaultSlotProvider } from '../../../../src/core/vault/broker/repository'
import { announceBrokerFixture, parseBrokerFixtureContext } from './sessionBrokerHarness'
import process from 'node:process'

// Delegated-exec broker fixture: the installed entry's own governor wiring over
// the generated fixture paths, then the product's file anchor and its OS-store
// slot over file records (the same parts the broker uses where the OS binding
// is not installed), so the proof needs no keychain. Bundled into the fixture's
// dist, so the governor resolves its native helpers from that install root.
const lifecycle: { dispose?: () => void } = {}
guardBrokerProcessStreams()
void runVaultBrokerEntry(async () => {
  const context = parseBrokerFixtureContext()
  lifecycle.dispose = await configureBrokerResources(
    context,
    () => import('../../../../src/core/resources/resourceGovernorEntry'),
  )
  // The OS-store slot speaks byte secrets; the file records speak the
  // keyring's password strings. The adapter only changes encoding: the
  // records on disk are the product fallback's own.
  const entries = fileRecordEntries(context.dataDir)
  const openEntry = (service: string, account: string) => {
    const entry = entries(service, account)
    return {
      getSecret: async () => {
        const stored = await entry.getPassword()
        return stored === null || stored === undefined ? null : Buffer.from(stored, 'base64')
      },
      setSecret: async (secret: Uint8Array) => {
        await entry.setPassword(Buffer.from(secret).toString('base64'))
      },
      deleteCredential: async () => await entry.deletePassword(),
    }
  }
  const slots: VaultSlotProvider = {
    slotFor: (record) =>
      openPlatformOsStoreSlot(
        record,
        process.platform,
        process.platform === 'linux' ? 'secretService' : 'loginKeychain',
        openEntry,
        context.dataDir,
      ),
    osStore: (vaultId, slotId) =>
      freshOsStoreSlot(vaultId, slotId, process.platform, openEntry, context.dataDir),
    presence: () => Promise.resolve(false),
    // No screen-lock binding here, as LinuxVaultSlots: subscribing refuses.
    onScreenLock: () => {
      throw new Error('no screen-lock binding in this fixture')
    },
  }
  const bindings = await createVaultBrokerBindings(context, {
    keyring: entries,
    anchor: new FileVaultAnchor(vaultAnchorFile(context.dataDir)),
    slots,
  })
  const handle = await createVaultBrokerProcess(context, bindings)
  await announceBrokerFixture(handle)
  return handle
})
  .finally(() => {
    lifecycle.dispose?.()
  })
  .catch(() => {
    process.exitCode = 1
  })
