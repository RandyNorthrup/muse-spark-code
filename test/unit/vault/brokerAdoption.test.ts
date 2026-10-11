// Lane CM1091BR3: the broker composition adopts part A's round-3 contracts.
// The start is doubled (no socket ever listens), so the composed broker and
// management run in-process over generated directories, a generated home and
// fake keyring/slots. Generated material only.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { randomBytes } from 'node:crypto'
import { VAULT_PROTOCOL_VERSION, VAULT_RESET_WORD } from '../../../src/shared/constants'
import { vaultBrokerLockSchema } from '../../../src/shared/vaultProtocol'
import type { VaultManagement } from '../../../src/core/vault/broker/management'
import type { VaultBroker } from '../../../src/core/vault/broker/broker'
import type * as brokerModule from '../../../src/core/vault/broker/broker'
import type * as managementModule from '../../../src/core/vault/broker/management'
import type {
  VaultBrokerProcessOptions,
  startVaultBrokerProcess,
} from '../../../src/runtime/vault/brokerProcess'
import {
  createVaultBrokerProcess,
  type VaultBrokerBindings,
} from '../../../src/runtime/vault/vaultBrokerEntry'
import { NodeVaultFiles } from '../../../src/core/vault/store'
import { memoryKeyring } from '../helpers/keyring'
import { FakeVaultSlot, fakeOsStoreProvider, fakeHostChannelPorts } from '../helpers/vault/core'
import { brokerFixture } from './brokerFixture'
import { cleanupTempHomes, tempHome } from './managementFixture'

type Start = typeof startVaultBrokerProcess
const seen: {
  options: VaultBrokerProcessOptions | undefined
  management: VaultManagement | undefined
  broker: VaultBroker | undefined
} = { options: undefined, management: undefined, broker: undefined }

vi.mock('../../../src/runtime/vault/brokerProcess', () => ({
  startVaultBrokerProcess: vi.fn(async (options: VaultBrokerProcessOptions) => {
    seen.options = options
    const runDirectory = options.runDirectory
    const location = {
      lock: vaultBrokerLockSchema.parse({
        v: VAULT_PROTOCOL_VERSION,
        processId: process.pid,
        startedAt: Date.now(),
        brokerId: randomBytes(16).toString('hex'),
        userSession: options.userSession,
        socket: path.join(runDirectory, 'broker.sock'),
      }),
      bootToken: randomBytes(16).toString('hex'),
    }
    // The channel is composed but never listened: no socket in this suite.
    await options.channel(location, {
      listen: () => Promise.resolve(() => Promise.resolve()),
    })
    return { location, closed: Promise.resolve(), close: () => Promise.resolve() }
  }) satisfies Start,
}))

vi.mock('../../../src/core/vault/broker/broker', async (importOriginal) => {
  const mod = await importOriginal<typeof brokerModule>()
  const Original = mod.VaultBroker
  return {
    ...mod,
    VaultBroker: class extends Original {
      constructor(...args: ConstructorParameters<typeof Original>) {
        super(...args)
        seen.broker = this
      }
    },
  }
})

vi.mock('../../../src/core/vault/broker/management', async (importOriginal) => {
  const mod = await importOriginal<typeof managementModule>()
  const Original = mod.VaultManagement
  return {
    ...mod,
    VaultManagement: class extends Original {
      constructor(...args: ConstructorParameters<typeof Original>) {
        super(...args)
        seen.management = this
      }
    },
  }
})

/** Forgets the previous composition; kept out of compose() so its flow keeps the checks. */
function resetSeen(): void {
  seen.options = undefined
  seen.management = undefined
  seen.broker = undefined
}

afterEach(cleanupTempHomes)

/** A generated home holding one `.git-credentials` with a generated secret. */
async function homeWithGitCredentials(home: string): Promise<{ file: string; secret: string }> {
  const secret = randomBytes(12).toString('hex')
  const file = path.join(home, '.git-credentials')
  await writeFile(file, `https://generated-user:${secret}@example.test\n`, { mode: 0o600 })
  return { file, secret }
}

async function bindings(
  home: string,
): Promise<{ ports: VaultBrokerBindings; anchors: Map<string, string> }> {
  // The broker's own audit over a proven in-memory port.
  const broker = await brokerFixture()
  await broker.broker.dispose()
  const keyring = memoryKeyring(true)
  const osStore = new FakeVaultSlot('osStore')
  const ports: VaultBrokerBindings = {
    keyring: keyring.openEntry,
    slots: fakeOsStoreProvider(osStore),
    peers: {
      verify: () => Promise.reject(new Error('no peer without a socket')),
    },
    audit: () => broker.deps.audit,
    onAuditFailure: () => {
      throw new Error('generated audit failure')
    },
    ...fakeHostChannelPorts(),
    home,
    lockOnScreenLock: false,
    idleMs: 1000,
  }
  return { ports, anchors: keyring.values }
}

async function compose(): Promise<{
  management: VaultManagement
  broker: VaultBroker
  options: VaultBrokerProcessOptions
  root: string
  home: string
  dataDir: string
  anchors: Map<string, string>
}> {
  const root = await tempHome()
  const dataDir = path.join(root, 'data')
  const runDirectory = path.join(root, 'run')
  const home = path.join(root, 'home')
  // The store admits owner-only directories, as the broker's own startup makes them.
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  await mkdir(runDirectory, { recursive: true, mode: 0o700 })
  await mkdir(home, { recursive: true, mode: 0o700 })
  resetSeen()
  const { ports, anchors } = await bindings(home)
  await createVaultBrokerProcess(
    { dataDir, runDirectory, installRoot: root, userSession: 'test-adoption' },
    ports,
  )
  const options = seen.options
  const management = seen.management
  const broker = seen.broker
  if (options === undefined || management === undefined || broker === undefined)
    throw new Error('the composition did not start')
  return { management, broker, options, root, home, dataDir, anchors }
}

async function created(management: VaultManagement): Promise<Buffer> {
  const shown = await management.setup()
  const code = Buffer.from(shown.code)
  shown.code.fill(0)
  await management.confirmSetup(shown.setupId)
  return code
}

describe('broker composition adopts the round-3 contracts', () => {
  it('imports only a file discovered under the composed home, hidden until kept', async () => {
    const c = await compose()
    const { file, secret } = await homeWithGitCredentials(c.home)
    const code = await created(c.management)
    try {
      const report = await c.management.importFile(file, () => true)
      expect(report.items).toHaveLength(1)
      expect(report.items[0]).toMatchObject({ kind: 'password', hidden: true })
      // The report is value-free: names and kinds only.
      expect(JSON.stringify(report)).not.toContain(secret)
      // Staged items arrive hidden until reviewed.
      const hidden = await c.management.snapshot()
      expect(hidden.items).toHaveLength(1)
      expect(hidden.items[0]).toMatchObject({ hidden: true })
      await c.management.keepImport(report.receipt)
      // Keep spends the receipt: the source stays, a second Keep is refused.
      const source = await stat(file)
      expect(source.isFile()).toBe(true)
      await expect(c.management.keepImport(report.receipt)).rejects.toMatchObject({
        reason: 'invalid',
      })
      const kept = await c.management.snapshot()
      expect(kept.items.map((entry) => entry.id)).toEqual(report.items.map((entry) => entry.id))
      expect(kept.status.state).toBe('unlocked')
    } finally {
      code.fill(0)
    }
  })

  it('refuses a readable credential file the discovery did not list', async () => {
    const c = await compose()
    const outside = path.join(c.root, 'elsewhere-credentials')
    await writeFile(outside, 'https://generated-user:generated@example.test\n', { mode: 0o600 })
    const code = await created(c.management)
    try {
      await expect(c.management.importFile(outside, () => true)).rejects.toMatchObject({
        reason: 'invalid',
      })
    } finally {
      code.fill(0)
    }
  })

  it('deleteImport removes the staged items and the source file', async () => {
    const c = await compose()
    const { file } = await homeWithGitCredentials(c.home)
    const code = await created(c.management)
    try {
      const report = await c.management.importFile(file, () => true)
      await c.management.deleteImport(report.receipt, () => true)
      // Delete removes the source (and spends the receipt); the imported items stay.
      await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(c.management.deleteImport(report.receipt, () => true)).rejects.toMatchObject({
        reason: 'invalid',
      })
      const snapshot = await c.management.snapshot()
      expect(snapshot.items.map((entry) => entry.id)).toEqual(report.items.map((entry) => entry.id))
    } finally {
      code.fill(0)
    }
  })

  it('resetBegin is refused while healthy; a lost vault resets on the exact word', async () => {
    const c = await compose()
    const code = await created(c.management)
    try {
      await expect(c.management.resetBegin()).rejects.toMatchObject({ reason: 'invalid' })
      // Lose the vault: the files are gone while the anchor still names it.
      await c.options.lock()
      await rm(path.join(c.dataDir, 'vault.v1'), { force: true })
      await rm(path.join(c.dataDir, 'slots.v1'), { force: true })
      const lost = await c.management.snapshot()
      expect(lost.status.reason).toBe('vaultLost')
      const spent = await c.management.resetBegin()
      await expect(c.management.resetConfirm(spent.resetId, 'reset')).rejects.toMatchObject({
        reason: 'invalid',
      })
      // A refused word spends the challenge: the reset starts over.
      await expect(
        c.management.resetConfirm(spent.resetId, VAULT_RESET_WORD),
      ).rejects.toMatchObject({ reason: 'invalid' })
      const challenge = await c.management.resetBegin()
      expect(challenge.word).toBe(VAULT_RESET_WORD)
      expect(c.anchors.size).toBe(1)
      await c.management.resetConfirm(challenge.resetId, VAULT_RESET_WORD)
      // Compare-and-delete: this vault's anchor record is gone.
      expect(c.anchors.size).toBe(0)
      const resetAudit = await readFile(path.join(c.dataDir, 'reset.v1'), 'utf8')
      expect(JSON.parse(resetAudit.trim())).toMatchObject({ v: 1, kind: 'vaultReset' })
      const state = await c.management.snapshot()
      expect(state.status.state).toBe('uncreated')
    } finally {
      code.fill(0)
    }
  })

  it('a broker lock during the composed reset audit fails it locked and writes nothing', async () => {
    const c = await compose()
    const code = await created(c.management)
    await c.broker.lock()
    await rm(path.join(c.dataDir, 'vault.v1'), { force: true })
    await rm(path.join(c.dataDir, 'slots.v1'), { force: true })
    const challenge = await c.management.resetBegin()
    const held = Promise.withResolvers<undefined>()
    let isHeld = false
    const writeAtomic = NodeVaultFiles.prototype.writeAtomic
    const spy = vi
      .spyOn(NodeVaultFiles.prototype, 'writeAtomic')
      .mockImplementation(async function (
        this: NodeVaultFiles,
        ...args: Parameters<typeof writeAtomic>
      ) {
        if (args[0] === 'reset.v1') {
          isHeld = true
          await held.promise
        }
        await writeAtomic.apply(this, args)
      })
    try {
      const resetting = c.management.resetConfirm(challenge.resetId, VAULT_RESET_WORD)
      await vi.waitFor(() => {
        expect(isHeld).toBe(true)
      })
      // The composed broker's Lock raises the management side's lock
      // generation through the composition's onLocked wiring; the audit
      // commit re-checks it before anything is published.
      await c.broker.lock()
      held.resolve(undefined)
      await expect(resetting).rejects.toMatchObject({ reason: 'locked' })
      expect(c.anchors.size).toBe(1)
      await expect(stat(path.join(c.dataDir, 'reset.v1'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    } finally {
      spy.mockRestore()
      code.fill(0)
    }
  })
})
