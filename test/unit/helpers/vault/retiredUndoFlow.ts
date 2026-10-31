// D241 drives over the real broker, shared by the Windows and POSIX
// migration suites: a retired slot's Undo (the controller, and the panel
// service the vault section reads) and what a vault reset does to retired
// slots. Every step runs real code over the real broker and the real
// native store; nothing here substitutes for one. Seeds are installed-shape
// records with generated test-only values, never issued or sent, and the
// legacy slot is always cleaned up.
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'esbuild'
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
  migrationKeyringService,
  openRetireFlow,
  uniqueKeyringStore,
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

/** One bundled child, rebuilt into the worktree's gitignored temp. */
async function undoCrashBundle(): Promise<string> {
  const directory = path.resolve('temp/undo-crash')
  await mkdir(directory, { recursive: true })
  const file = path.join(directory, 'child.cjs')
  await build({
    entryPoints: ['test/unit/helpers/vault/undoCrashChild.ts'],
    outfile: file,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['@napi-rs/keyring'],
  })
  return file
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

/** The child reached its hang, or it ended / the deadline passed. */
async function waitForCrashPoint(file: string, child: ChildProcess): Promise<void> {
  // One undo against an already-open broker. The suite's flow deadline
  // covers this wait; the product has no timeout of its own here.
  const deadline = Date.now() + 90_000
  for (;;) {
    try {
      await stat(file)
      return
    } catch (error: unknown) {
      if (!isMissingFile(error)) throw error
    }
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error('the undo child ended before the crash point')
    if (Date.now() >= deadline) throw new Error('the undo child did not reach the crash point')
    await delay(50)
  }
}

/**
Run a real undo in a child connected to this broker and SIGKILL it after
the named durable step. `legacy` is after the native store write and
before that write is marked observed. `written` is after the mark and
before the slot returns to active. `pending` is after the intent is
journaled and before the native store write.
*/
async function killUndoAt(deps: {
  bundle: string
  dataDir: string
  installRoot: string
  service: string
  lockScope: string
  stop: 'legacy' | 'written' | 'pending'
}): Promise<void> {
  const sentinel = path.join(deps.dataDir, `undo-stop-${deps.stop}`)
  await rm(sentinel, { force: true })
  const child = spawn(
    process.execPath,
    [
      deps.bundle,
      deps.dataDir,
      deps.installRoot,
      deps.service,
      deps.lockScope,
      deps.stop,
      sentinel,
    ],
    { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  child.stdout.resume()
  child.stderr.resume()
  const exited = once(child, 'exit')
  try {
    await waitForCrashPoint(sentinel, child)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  const [, signal] = await exited
  expect(signal).toBe('SIGKILL')
}

/**
A retired undo killed between its steps, on the real broker and a uniquely
named native store. The next unlock finishes a restore whose legacy write
landed, does not put a secret back after that write was saved and the
person then removed it, and a delete of the slot removes a restore that
had not written yet. Assertions are booleans.
*/
export async function driveUndoCrashCase(deps: {
  connect: () => Promise<VaultBrokerClient>
  lockScope: string
  fresh: boolean
  dataDir: string
  installRoot: string
}): Promise<void> {
  const service = migrationKeyringService()
  const secrets = uniqueKeyringStore(deps.lockScope, service)
  const { session, reader, logged, release, controller, shell } = await openRetireFlow({
    connect: deps.connect,
    lockScope: deps.lockScope,
    fresh: deps.fresh,
    secrets,
  })
  const codec = chatgptSubscriptionMigrationCredential(Date.now)
  const bundle = await undoCrashBundle()
  const signedIn = JSON.stringify(installedChatGptRecord())
  const migrated = (isLegacyPresent: boolean) =>
    assertMigratedSlot({
      reader,
      session,
      codec,
      secrets,
      shell,
      origin: ORIGIN,
      expected: signedIn,
      isLegacyPresent,
    })
  const retiredKeys = async () => {
    const entries = await controller.listRetired()
    return entries.map((entry) => entry.key)
  }
  const crash = (stop: 'legacy' | 'written' | 'pending') =>
    killUndoAt({
      bundle,
      dataDir: deps.dataDir,
      installRoot: deps.installRoot,
      service,
      lockScope: deps.lockScope,
      stop,
    })
  const warnings = () =>
    logged.filter((line) => line.startsWith('warn:') || line.startsWith('error:'))
  try {
    await secrets.store(codec.key, signedIn)
    await controller.ensureMigrated()
    release.current = RETIRING_RELEASE
    await controller.ensureMigrated()
    await migrated(false)
    expect(await retiredKeys()).toEqual([codec.key])

    // The legacy write has landed and the journal still says retired.
    await crash('legacy')
    expect(await retiredKeys()).toEqual([codec.key])
    expect((await secrets.get(codec.key)) === signedIn).toBe(true)
    await controller.ensureMigrated()
    expect(await retiredKeys()).toEqual([])
    expect((await secrets.get(codec.key)) === signedIn).toBe(true)
    await migrated(true)

    // Retire once more. Kill after the restore is marked observed, then
    // remove that copy. The next unlock must leave it removed.
    await shell.store.delete(codec.key)
    await secrets.store(codec.key, signedIn)
    release.current = RETIRING_RELEASE
    await controller.ensureMigrated()
    release.current = RETIRING_RELEASE + 2
    await controller.ensureMigrated()
    await migrated(false)
    await crash('written')
    expect((await secrets.get(codec.key)) === signedIn).toBe(true)
    await secrets.delete(codec.key)
    await controller.ensureMigrated()
    expect((await secrets.get(codec.key)) === undefined).toBe(true)
    expect(await retiredKeys()).toEqual([codec.key])

    // Kill before any legacy write, then delete the slot. Nothing comes back.
    await crash('pending')
    expect((await secrets.get(codec.key)) === undefined).toBe(true)
    expect(await retiredKeys()).toEqual([codec.key])
    await shell.store.delete(codec.key)
    await controller.ensureMigrated()
    expect(await retiredKeys()).toEqual([])
    expect((await secrets.get(codec.key)) === undefined).toBe(true)
    expect(warnings()).toEqual([])
  } finally {
    await secrets.delete(codec.key)
  }
}
