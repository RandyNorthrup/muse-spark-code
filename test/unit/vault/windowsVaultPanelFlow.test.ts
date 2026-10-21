import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { encodeVaultMaterial } from '../../../src/core/vault/crypto'
import { VaultManageSession } from '../../../src/core/vault/broker/manageClient'
import { VaultFirstPartyReader } from '../../../src/core/vault/broker/firstParty'
import { discoverAmbientFiles } from '../../../src/core/vault/migrate/ambient'
import { vaultPanelService } from '../../../src/host/vault/vaultPanelService'
import { VaultPanelHost } from '../../../src/host/vault/vaultPanelHost'
import { editVaultItem, type VaultNativeInput } from '../../../src/host/vault/vaultNativeEditor'
import type { VaultHostMessage } from '../../../src/shared/hostApi/vaultMessages'
import type { VaultPanelState } from '../../../src/shared/vaultPanel'
import type { VaultItem } from '../../../src/shared/vault'
import { VAULT_PROTOCOL_VERSION } from '../../../src/shared/constants'
import { collectingLogger } from '../helpers/collectingLogger'
import {
  startWindowsBrokerFixture,
  type WindowsBrokerFixture,
} from '../helpers/vault/windowsBrokerFixture'

// The vault exactly as the Models & Agents panel drives it on Windows: the
// panel host (with its watch stream, reloads and authorize guards) over the
// broker-backed panel service and management session, wired as
// vaultPanelEntry wires them, against the real broker the real client
// platform launches. The fixture carries no keyring binding, as the VSIX
// carries none. Set up, unlock, add through the native editor's own code,
// write and read back a first-party row the way the key-store migration
// does (the product's value read), lock, unlock again and read again.
// The person's view is the published state and the toasts; each step
// settles on the state the broker then reports.
const fixture = { current: undefined as WindowsBrokerFixture | undefined }
const ORIGIN = 'https://api.example.com'
// Each step can include a slot helper launch (DPAPI) through the governor.
const STEP_TIMEOUT_MS = 60_000

describe.skipIf(process.platform !== 'win32')('Windows vault through the panel', () => {
  beforeAll(async () => {
    fixture.current = await startWindowsBrokerFixture('vs-wpanel-')
  })
  afterAll(async () => {
    await fixture.current?.dispose()
  })

  it('sets up, unlocks, adds, reads back, locks and unlocks again through the real broker', async () => {
    const current = fixture.current
    if (!current) throw new Error('the client platform did not build')
    const home = path.join(current.root, 'home')
    await mkdir(home)
    const session = new VaultManageSession(current.connect, encodeVaultMaterial)
    const frames: VaultPanelState[] = []
    const toasts: string[] = []
    const codes: string[] = []
    const lockItem: boolean[] = []
    const logged: string[] = []
    // The person's answers in the native Add dialog, in the order it asks:
    // kind, name, label, where it may be used (nowhere yet), policy,
    // presence, expiry (none), hidden, unattended, disclosure, then the key,
    // its use and its origin.
    const typed = ['service-key', 'Service key', '', 'sk-panel-value', ORIGIN]
    const picked = ['apiKey', 'none', 'askEveryTime', 'keep', 'keep', 'keep', 'keep', 'bearer']
    const person: VaultNativeInput = {
      input: () => Promise.resolve(typed.shift()),
      pick: () => Promise.resolve(picked.shift()),
      sshKey: () => Promise.resolve(null),
      now: () => Date.now(),
    }
    const host = new VaultPanelHost({
      service: vaultPanelService(session, { ambientFiles: () => discoverAmbientFiles(home) }),
      log: collectingLogger(logged),
      now: () => Date.now(),
      editItem: (item, signal) => editVaultItem(person, item, signal),
      confirmRemove: () => Promise.resolve(false),
      copyPublicKey: () => Promise.resolve(),
      publish: (message: VaultHostMessage) => {
        frames.push(message.state)
      },
      status: (isUnlocked) => {
        lockItem.push(isUnlocked)
      },
      showError: (message) => {
        toasts.push(message)
      },
      importDone: () => Promise.resolve('keep'),
      confirmReset: () => Promise.resolve(null),
      // The person reads the code and clicks I Saved It.
      showRecoveryCode: (code) => {
        codes.push(code)
        return Promise.resolve(true)
      },
    })
    /** The panel's settled view: the state it shows once no reload or retry is pending. */
    const settled = async (state: VaultPanelState['status']['state']): Promise<VaultPanelState> => {
      await vi.waitFor(
        () => {
          const frame = frames.at(-1)
          expect(frame?.retrying ?? false).toBe(false)
          expect(frame?.status.state).toBe(state)
        },
        { timeout: STEP_TIMEOUT_MS, interval: 50 },
      )
      expect(toasts).toEqual([])
      const frame = frames.at(-1)
      if (frame === undefined) throw new Error('the panel published nothing')
      return frame
    }
    // Past 4 KiB on the wire, as a key bundle or certificate chain is: the
    // relay once failed (and took every connection with it) on any frame
    // larger than one wrapped slot key.
    const value = Buffer.from('first-party-panel-value-'.repeat(400))
    const firstParty: VaultItem = {
      metadata: {
        id: 'a1'.repeat(16),
        name: 'first-party-row',
        handle: 'secret://first-party-row',
        label: 'First-party row',
        kind: 'apiKey',
        bindings: [{ kind: 'origin', origin: ORIGIN }],
        requirePresence: false,
        hidden: true,
        firstParty: true,
        policy: { mode: 'never', unattendedAllowed: false, allowDisclosure: false },
        dates: { createdAt: Date.now(), rotatedAt: null, expiresAt: null, lastUsedAt: null },
        publicKey: null,
        fingerprint: null,
      },
      material: { kind: 'apiKey', value: Buffer.from(value), auth: 'bearer', origin: ORIGIN },
    }
    const readBack = () =>
      new VaultFirstPartyReader(current.connect).read({
        v: VAULT_PROTOCOL_VERSION,
        kind: 'firstPartyRead',
        itemId: firstParty.metadata.id,
        origin: ORIGIN,
        client: 'model',
      })
    // VS Code's extension host works inside its own install folder, and the
    // broker inherits that folder: here the working folder holds every
    // helper (built pipe and slot helpers, job helpers, dist), so a launch
    // that refused an absolute helper path as a workspace planting fails.
    // It is the fixture's parent: the broker's working folder must not be
    // the folder the fixture removes (Windows refuses to remove it).
    const workingFolder = process.cwd()
    process.chdir(path.dirname(current.root))
    try {
      await host.handle({ type: 'vaultReady' })
      await settled('uncreated')

      await host.handle({ type: 'vaultSetup' })
      expect(codes).toHaveLength(1)
      // Setup ends unlocked: its first unlock opens the audit log too.
      await settled('unlocked')
      expect(lockItem.at(-1)).toBe(true)

      // A reload the panel asked for, overtaken by Lock before it ran (as a
      // first open is overtaken by the broker's own events): the newer
      // operation owns the view, and the retired one is not a failure.
      const overtaken = host.handle({ type: 'vaultReady' })
      await host.handle({ type: 'vaultLock' })
      await overtaken
      await settled('locked')
      expect(lockItem.at(-1)).toBe(false)

      // The release blocker: a set-up vault unlocks from the panel.
      await host.handle({ type: 'vaultUnlock' })
      const unlocked = await settled('unlocked')
      expect(unlocked.status.tier).toBe('osStore')

      await host.handle({ type: 'vaultAdd' })
      await vi.waitFor(
        () => {
          expect(frames.at(-1)?.items.map((item) => item.name)).toEqual(['service-key'])
        },
        { timeout: STEP_TIMEOUT_MS, interval: 50 },
      )
      expect(toasts).toEqual([])

      // The key-store migration's own write and read: a first-party row
      // through the same session, read back on the private channel.
      await session.write(firstParty, false)
      const first = await readBack()
      expect(first.equals(value)).toBe(true)

      await host.handle({ type: 'vaultLock' })
      await settled('locked')

      await host.handle({ type: 'vaultUnlock' })
      const again = await settled('unlocked')
      // Both rows survive the lock; the panel's view hides the first-party one.
      expect(
        again.items.map((item) => item.name).toSorted((left, right) => left.localeCompare(right)),
      ).toEqual(['first-party-row', 'service-key'])
      expect(again.status.itemCount).toBe(2)
      const second = await readBack()
      expect(second.equals(value)).toBe(true)
      // Nothing failed, so the log names no failure.
      expect(logged.filter((line) => line.includes('failed'))).toEqual([])
    } finally {
      host.dispose()
      process.chdir(workingFolder)
    }
  }, 300_000)
})
