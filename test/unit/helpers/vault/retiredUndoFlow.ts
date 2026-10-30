// D217 drives over the real broker, shared by the Windows and POSIX
// migration suites: a retired slot's Undo (the controller, and the panel
// service the vault section reads) and what a vault reset does to retired
// slots. Every step runs real code over the real broker and the real
// native store; nothing here substitutes for one. Seeds are installed-shape
// records with generated test-only values, never issued or sent, and the
// legacy slot is always cleaned up.
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect } from 'vitest'
import type { VaultBrokerClient } from '../../../../src/core/vault/broker/client'
import { chatgptSubscriptionMigrationCredential } from '../../../../src/core/vault/migrate/chatgptSubscription'
import { vaultPanelService } from '../../../../src/host/vault/vaultPanelService'
import { UI_TEXT, VAULT_PROTOCOL_VERSION, VAULT_RESET_WORD } from '../../../../src/shared/constants'
import { vaultPanelStateSchema } from '../../../../src/shared/vaultPanel'
import {
  assertMigratedSlot,
  assertSignedOut,
  confirmBrokerSetup,
  installedChatGptRecord,
  openRetireFlow,
} from './subscriptionMigrationFlow'

const ORIGIN = 'https://api.openai.com'
/** The retain window is two releases: the flow starts at 19, 21 retires, undo restarts it, 23 retires again. */
const RETIRING_RELEASE = 21

/** The call refuses with exactly this sentence, never anything else and never silently. */
async function expectRefused(work: Promise<unknown>, sentence: string): Promise<void> {
  let message: string | undefined
  try {
    await work
  } catch (error: unknown) {
    message = error instanceof Error ? error.message : String(error)
  }
  expect(message).toBe(sentence)
}

/**
Undo restores a retired value byte-exact and restarts its window; a slot
still current, an unknown key, a locked vault, a legacy copy that changed
since and an emptied slot each refuse in their own words; the panel's
service lists the retired slot and undoes it through the same path.
*/
export async function driveUndoRetiredCase(deps: {
  connect: () => Promise<VaultBrokerClient>
  lockScope: string
  fresh: boolean
}): Promise<void> {
  const { session, secrets, reader, logged, release, controller, shell } =
    await openRetireFlow(deps)
  const codec = chatgptSubscriptionMigrationCredential(Date.now)
  let panelMigration: typeof controller | undefined
  const service = vaultPanelService(session, {
    ambientFiles: () => Promise.resolve([]),
    migration: () => panelMigration,
  })
  const migrated = (expected: string, isLegacyPresent: boolean) =>
    assertMigratedSlot({
      reader,
      session,
      codec,
      secrets,
      shell,
      origin: ORIGIN,
      expected,
      isLegacyPresent,
    })
  const retiredKeys = async () => {
    const entries = await controller.listRetired()
    return entries.map((entry) => entry.key)
  }
  try {
    const signedIn = JSON.stringify(installedChatGptRecord())
    await secrets.store(codec.key, signedIn)
    await controller.ensureMigrated()
    await migrated(signedIn, true)

    // Nothing is retired yet: nothing lists, and Undo says the slot is current.
    expect(await retiredKeys()).toEqual([])
    await expectRefused(controller.undoRetired(codec.key), UI_TEXT.vault.retiredUndoCurrent)
    await expectRefused(
      controller.undoRetired('museSpark.provider.never-migrated'),
      UI_TEXT.vault.retiredUndoUnknown,
    )

    // Two releases later the legacy entry retires; the vault holds the only copy.
    release.current = RETIRING_RELEASE
    await controller.ensureMigrated()
    await migrated(signedIn, false)
    expect(await retiredKeys()).toEqual([codec.key])

    // A locked vault lists and undoes nothing, and says so.
    await session.lock()
    await expectRefused(controller.listRetired(), UI_TEXT.vault.locked)
    await expectRefused(controller.undoRetired(codec.key), UI_TEXT.vault.locked)
    await session.unlock(null)

    // The panel's service lists the retired slot beside the vault's own state.
    panelMigration = controller
    const listed = vaultPanelStateSchema.parse(await service.snapshot())
    expect(listed.retired?.map((entry) => entry.key)).toEqual([codec.key])

    // Undo through the panel's path restores the value byte-exact in the legacy store.
    await service.undoRetired(codec.key)
    expect((await secrets.get(codec.key)) === signedIn).toBe(true)
    await migrated(signedIn, true)
    expect(await retiredKeys()).toEqual([])
    expect(vaultPanelStateSchema.parse(await service.snapshot()).retired).toEqual([])

    // The window restarted at undo: the next unlock keeps the legacy copy,
    // and two releases on it retires again, so Undo is repeatable.
    await controller.ensureMigrated()
    await migrated(signedIn, true)
    release.current = RETIRING_RELEASE + 2
    await controller.ensureMigrated()
    await migrated(signedIn, false)
    await controller.undoRetired(codec.key)
    await migrated(signedIn, true)

    // A legacy copy that changed after the slot retired is never overwritten.
    release.current = RETIRING_RELEASE + 4
    await controller.ensureMigrated()
    await migrated(signedIn, false)
    const newer = JSON.stringify(installedChatGptRecord())
    await secrets.store(codec.key, newer)
    await expectRefused(controller.undoRetired(codec.key), UI_TEXT.vault.retiredUndoChanged)
    expect((await secrets.get(codec.key)) === newer).toBe(true)
    await secrets.delete(codec.key)

    // Once the person has emptied the slot (signed out), Undo refuses in words
    // and restores nothing.
    await shell.store.delete(codec.key)
    await assertSignedOut({ secrets, session, codec, logged })
    await expectRefused(controller.undoRetired(codec.key), UI_TEXT.vault.retiredUndoGone)
    expect(await retiredKeys()).toEqual([])
    expect((await secrets.get(codec.key)) === undefined).toBe(true)
  } finally {
    await secrets.delete(codec.key)
  }
}

/**
A vault reset takes retired slots with everything else: the vault copy and
its journal row go, and nothing is restored to the legacy store, because a
reset runs broker-side and cannot write it. The vault is lost for real
(its slot file damaged on disk), so Reset is offered, then confirmed with
the typed word, and a fresh vault holds neither the retired row nor its
value.
*/
export async function driveResetCase(deps: {
  connect: () => Promise<VaultBrokerClient>
  lockScope: string
  fresh: boolean
  brokerDataDir: string
}): Promise<void> {
  const { session, secrets, reader, logged, release, controller, shell } =
    await openRetireFlow(deps)
  const codec = chatgptSubscriptionMigrationCredential(Date.now)
  try {
    const signedIn = JSON.stringify(installedChatGptRecord())
    await secrets.store(codec.key, signedIn)
    await controller.ensureMigrated()
    release.current = RETIRING_RELEASE
    await controller.ensureMigrated()
    await assertMigratedSlot({
      reader,
      session,
      codec,
      secrets,
      shell,
      origin: ORIGIN,
      expected: signedIn,
      isLegacyPresent: false,
    })
    const retired = await controller.listRetired()
    expect(retired.map((entry) => entry.key)).toEqual([codec.key])

    // The vault is lost: locked, with its slot file damaged on disk.
    await session.lock()
    await writeFile(path.join(deps.brokerDataDir, 'slots.v1'), '{}')
    const challenge = await session.resetBegin()
    expect(challenge.word).toBe(VAULT_RESET_WORD)
    await session.resetConfirm(challenge.resetId, challenge.word)

    // A fresh vault: no retired row, no vault copy, and nothing restored.
    await confirmBrokerSetup(session)
    const fresh = await session.snapshot()
    expect(fresh.items.some((entry) => entry.id === codec.itemId)).toBe(false)
    expect(await controller.listRetired()).toEqual([])
    expect((await secrets.get(codec.key)) === undefined).toBe(true)
    expect((await shell.store.get(codec.key)) === undefined).toBe(true)
    let isValueRead = true
    try {
      const bytes = await reader.read({
        v: VAULT_PROTOCOL_VERSION,
        kind: 'firstPartyRead',
        itemId: codec.itemId,
        origin: ORIGIN,
        client: 'provider',
      })
      bytes.fill(0)
    } catch {
      // The retired value is gone with its vault: nothing answers for the item.
      isValueRead = false
    }
    expect(isValueRead).toBe(false)
    expect(logged.filter((line) => line.startsWith('warn:') || line.startsWith('error:'))).toEqual(
      [],
    )
  } finally {
    await secrets.delete(codec.key)
  }
}
