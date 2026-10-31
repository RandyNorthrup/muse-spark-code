import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { build } from 'esbuild'
import { REDACTED_MARK, UI_TEXT, VAULT_PROTOCOL_VERSION } from '../../../src/shared/constants'
import { vaultCommandDigest } from '../../../src/core/vault/broker/policy'
import { VaultManageSession } from '../../../src/core/vault/broker/manageClient'
import { encodeVaultMaterial } from '../../../src/core/vault/crypto'
import { type VaultBrokerClient } from '../../../src/core/vault/broker/client'
import { VaultBrokerProcess } from '../../../src/host/vault/brokerProcess'
import { posixVaultClientPlatform } from '../../../src/runtime/vault/posixClientPlatform'
import { configureBrokerResources } from '../../../src/runtime/vault/brokerResources'
import {
  freshOsStoreSlot,
  openPlatformOsStoreSlot,
} from '../../../src/runtime/vault/slots/slotEntries'
import type { VaultSlotProvider } from '../../../src/core/vault/broker/repository'
import { createVaultBrokerBindings } from '../../../src/runtime/vault/brokerBindings'
import { createVaultBrokerProcess } from '../../../src/runtime/vault/vaultBrokerEntry'
import {
  FileVaultAnchor,
  fileRecordEntries,
  vaultAnchorFile,
} from '../../../src/runtime/vault/fileAnchor'
import { openHeadlessVault } from '../../../src/runtime/vault/headlessSession'
import { createHeadlessVaultExecService } from '../../../src/runtime/vault/vaultExecHost'
import { writeVaultPolicy } from '../../../src/runtime/vault/vaultPolicy'
import { vaultBrokerDataDir } from '../../../src/runtime/vault/vaultStoreScope'
import { vaultGrantSchema, type VaultGrant, type VaultItem } from '../../../src/shared/vault'
import { type VaultExecService } from '../../../src/core/vault/exec/service'
import { type ExecVaultSession } from '../../../src/runtime/vault/execVault'
import { buildBrokerChildren } from '../helpers/vault/sessionBrokerBuild'
import { shouldSkipPosixBrokerSuite } from '../helpers/vault/socketFit'

// D243 proof on real parts: the real broker and channel serve a real
// Unix socket in this process (the product's file anchor stands in for
// the OS store, as it does where the binding is not installed); the
// feeder is a real child process running the installed vaultExecEntry
// bundle; peer identity and ancestry come from the compiled native
// helper over kernel records. The value is minted in memory here, used
// by real commands through the feeder, and must surface nowhere a host
// can read — only its length and a redacted echo prove it arrived.
// The separate-process broker topology itself is brokerSession's proof.

const value = randomBytes(18).toString('hex')
const shouldSkipBroker = shouldSkipPosixBrokerSuite()
const uid = typeof process.getuid === 'function' ? process.getuid() : 0
/** No screen-lock binding in this suite: nothing to unsubscribe. */
function noScreenLock(): () => void {
  // Mirrors LinuxVaultSlots: no capture in this composition, and the
  // broker is never told to lock on screen lock (lockOnScreenLock is
  // false in the bindings), so subscribing refuses like theirs does.
  throw new Error('no screen-lock binding in this suite')
}
const state: {
  root: string
  data: string
  shell: string
  disposeResources?: () => void
  broker?: { close(): Promise<void> }
  platform?: { dispose?: () => void }
  manage?: VaultManageSession
  session?: ExecVaultSession
  service?: VaultExecService
  raw?: VaultBrokerClient
  controller: AbortController
} = { root: '', data: '', shell: '', controller: new AbortController() }
const denials: string[] = []

const command = (script: string) => ({
  executable: state.shell,
  argv: ['-c', script],
  cwd: state.data,
})
const envRun = (script: string) => ({
  command: command(script),
  secrets: { env: { VAULT_PROBE: 'secret://service-key' } },
})
const countUse = () => ({
  kind: 'environment' as const,
  command: command('printf %s "$VAULT_PROBE" | wc -c'),
  names: ['VAULT_PROBE'],
})

async function buildSiblingBundles(root: string): Promise<void> {
  const entries: readonly (readonly [string, string])[] = [
    ['src/runtime/vault/vaultExecEntry.ts', 'vaultExec.js'],
    ['src/core/resources/resourceGovernorEntry.ts', 'resourceGovernor.js'],
    ['src/runtime/vault/vaultPolicyEntry.ts', 'vaultPolicy.js'],
  ]
  for (const [entry, output] of entries)
    await build({
      entryPoints: [entry],
      outfile: path.join(root, 'dist', output),
      bundle: true,
      external: ['@napi-rs/keyring'],
      platform: 'node',
      format: 'cjs',
    })
}

function item(): VaultItem {
  const environment = (script: string) => ({
    kind: 'environment' as const,
    commandDigest: vaultCommandDigest(command(script)),
    names: ['VAULT_PROBE'],
  })
  return {
    metadata: {
      id: 'a'.repeat(32),
      name: 'service-key',
      handle: 'secret://service-key',
      label: 'Service key',
      kind: 'apiKey',
      bindings: [
        environment('printf %s "$VAULT_PROBE" | wc -c'),
        environment('printenv VAULT_PROBE'),
        environment('sleep 30'),
        { kind: 'stdin' as const, commandDigest: vaultCommandDigest(command('wc -c')) },
      ],
      requirePresence: false,
      hidden: false,
      firstParty: false,
      policy: { mode: 'alwaysAllow', unattendedAllowed: true, allowDisclosure: false },
      dates: { createdAt: Date.now(), rotatedAt: null, expiresAt: null, lastUsedAt: null },
      publicKey: null,
      fingerprint: null,
    },
    material: {
      kind: 'apiKey',
      value: Buffer.from(value, 'utf8'),
      auth: 'bearer',
      origin: 'https://api.example.com',
    },
  }
}

function grants(): readonly VaultGrant[] {
  const base = {
    itemId: 'a'.repeat(32),
    roles: [{ kind: 'headless' as const }],
    workspaces: 'any' as const,
    maxUses: null,
    uses: 0,
    expiresAt: null,
    window: null,
    unattendedAllowed: true,
    sessionId: null,
    taskId: null,
    ceiling: ['secret://service-key'],
    createdAt: Date.now(),
    createdBy: 'vaultCli' as const,
  }
  const environment = (id: string, script: string): VaultGrant => ({
    ...base,
    id,
    target: {
      kind: 'environment',
      commandDigest: vaultCommandDigest(command(script)),
      names: ['VAULT_PROBE'],
    },
  })
  return [
    environment('b'.repeat(32), 'printf %s "$VAULT_PROBE" | wc -c'),
    environment('c'.repeat(32), 'printenv VAULT_PROBE'),
    environment('e'.repeat(32), 'sleep 30'),
    {
      ...base,
      id: 'd'.repeat(32),
      target: { kind: 'stdin', commandDigest: vaultCommandDigest(command('wc -c')) },
    },
  ].map((grant) => vaultGrantSchema.parse(grant))
}

beforeAll(async () => {
  if (shouldSkipBroker) return
  state.root = await realpath(await mkdtemp(path.join(os.tmpdir(), 've-')))
  state.data = state.root
  state.shell = await realpath('/bin/sh')
  // Compiles the native peer helper and stages the created-directories
  // helper into the fixture install root; no fixture children needed.
  await buildBrokerChildren(state.root, [])
  await buildSiblingBundles(state.root)
  const brokerData = vaultBrokerDataDir(state.data)
  const runDirectory = path.join(state.data, 'vault', 'run')
  const context = {
    dataDir: brokerData,
    runDirectory,
    installRoot: state.root,
    userSession: `${String(uid)}:${process.env['XDG_SESSION_ID'] ?? 'login'}`,
  }
  state.disposeResources = await configureBrokerResources(
    {
      dataDir: brokerData,
      runDirectory: path.join(state.data, 'test-run'),
      installRoot: state.root,
    },
    () => import('../../../src/core/resources/resourceGovernorEntry'),
  )
  // The product's file anchor and OS-store slot over file records: the
  // same parts the broker uses where the OS binding is not installed,
  // so this proof needs no keychain. Slot records keep their platform
  // provider label; only the entry store behind them is the file one.
  const entries = fileRecordEntries(brokerData)
  // The OS-store slot speaks byte secrets; the file records speak the
  // keyring's password strings. The adapter only changes encoding —
  // the records on disk are the product fallback's own.
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
        brokerData,
      ),
    osStore: (vaultId, slotId) =>
      freshOsStoreSlot(vaultId, slotId, process.platform, openEntry, brokerData),
    presence: () => Promise.resolve(false),
    onScreenLock: noScreenLock,
  }
  const bindings = await createVaultBrokerBindings(context, {
    keyring: entries,
    anchor: new FileVaultAnchor(vaultAnchorFile(brokerData)),
    slots,
  })
  state.broker = await createVaultBrokerProcess(context, bindings)
  const hostId = 'b'.repeat(32)
  const hostSession = 'd'.repeat(32)
  const platform = await posixVaultClientPlatform({
    dataDir: state.data,
    distDir: path.join(state.root, 'dist'),
    hostId,
    hostSession,
  })
  state.platform = platform
  const brokerProcess = new VaultBrokerProcess(platform.discovery, platform.process)
  await brokerProcess.get()
  const connect = async (): Promise<VaultBrokerClient> => {
    state.raw = await brokerProcess.connect(hostId, hostSession, platform.peers, platform.dial)
    return state.raw
  }
  state.manage = new VaultManageSession(connect, encodeVaultMaterial)
  const snapshot = await state.manage.snapshot()
  if (snapshot.status.state === 'uncreated') {
    const begun = await state.manage.setup()
    begun.code.fill(0)
    await state.manage.confirmSetup(begun.setupId)
  } else if (snapshot.status.state !== 'unlocked') await state.manage.unlock(null)
  await state.manage.write(item(), false)
  for (const grant of grants()) await state.manage.grant(grant)
  state.session = await openHeadlessVault(
    connect,
    {
      cwd: state.data,
      sessionId: 'e'.repeat(32),
      signal: state.controller.signal,
      source: 'headless',
      unattended: true,
      onDenied: (message) => {
        denials.push(message)
      },
    },
    hostId,
    process.pid,
  )
  state.service = createHeadlessVaultExecService({
    broker: state.session.execBroker(),
    distDir: path.join(state.root, 'dist'),
    dataDir: state.data,
    nodePath: process.execPath,
    env: process.env,
    platform: process.platform,
  })
}, 120_000)

afterAll(async () => {
  state.controller.abort()
  try {
    await state.session?.close()
  } catch {
    // Teardown continues to the broker and the fixture root either way.
  }
  state.raw?.close()
  try {
    await state.broker?.close()
  } catch {
    // Teardown continues to the fixture root either way.
  }
  state.platform?.dispose?.()
  state.disposeResources?.()
  if (state.root) await rm(state.root, { recursive: true, force: true })
})

const assertCanRun = (): void => {
  state.controller.signal.throwIfAborted()
}

describe.skipIf(shouldSkipBroker)(
  'delegated vault exec over the real broker and feeder (D243)',
  () => {
    it('refuses without a person ceiling, in words', async () => {
      const service = state.service
      if (!service) throw new Error('missing exec service')
      denials.length = 0
      await expect(
        service.run(
          envRun('printf %s "$VAULT_PROBE" | wc -c'),
          state.controller.signal,
          assertCanRun,
        ),
      ).rejects.toThrow()
      expect(denials.join('\n')).toContain(UI_TEXT.vault.ceilingNone)
      // A ceiling for another workspace still refuses this one.
      await writeVaultPolicy(vaultBrokerDataDir(state.data), {
        ceilings: [
          {
            workspaceId: '/somewhere/else',
            role: { kind: 'headless' },
            ceiling: ['secret://service-key'],
          },
        ],
      })
      denials.length = 0
      await expect(
        service.run(
          envRun('printf %s "$VAULT_PROBE" | wc -c'),
          state.controller.signal,
          assertCanRun,
        ),
      ).rejects.toThrow()
      expect(denials.join('\n')).toContain('ceiling')
    }, 30_000)

    it('runs env and stdin uses through the feeder; the value never surfaces', async () => {
      const service = state.service
      if (!service || !state.raw || !state.session) throw new Error('missing exec service')
      await writeVaultPolicy(vaultBrokerDataDir(state.data), {
        ceilings: [
          {
            workspaceId: state.data,
            role: { kind: 'headless' },
            ceiling: ['secret://service-key'],
          },
        ],
      })
      const counted = await service.run(
        envRun('printf %s "$VAULT_PROBE" | wc -c'),
        state.controller.signal,
        assertCanRun,
      )
      expect(counted.exitCode).toBe(0)
      expect(counted.stdout.trim()).toBe(String(value.length))
      const echoed = await service.run(
        envRun('printenv VAULT_PROBE'),
        state.controller.signal,
        assertCanRun,
      )
      expect(echoed.exitCode).toBe(0)
      expect(echoed.stdout).not.toContain(value)
      expect(echoed.stdout).toContain(REDACTED_MARK)
      const stdin = await service.run(
        { command: command('wc -c'), secrets: { stdin: 'secret://service-key' } },
        state.controller.signal,
        assertCanRun,
      )
      expect(stdin.stdout.trim()).toBe(String(value.length))
      // A git use refuses at the host port (first increment scope).
      await expect(
        service.run(
          {
            command: command('true'),
            secrets: {
              git: {
                handle: 'secret://service-key',
                protocol: 'https',
                host: 'example.com',
                path: 'repo',
              },
            },
          },
          state.controller.signal,
          assertCanRun,
        ),
      ).rejects.toThrow()
      // A delegation to the wrong process identity is refused by the broker.
      const inner = state.session.execBroker()
      const foreign = createHeadlessVaultExecService({
        broker: {
          authorize: inner.authorize,
          list: inner.list,
          delegate: async (ticketId, feeder, digest) => {
            await inner.delegate(
              ticketId,
              { processId: process.pid, startedAt: feeder.startedAt },
              digest,
            )
          },
        },
        distDir: path.join(state.root, 'dist'),
        dataDir: state.data,
        nodePath: process.execPath,
        env: process.env,
        platform: process.platform,
      })
      const refused = await foreign.run(
        envRun('printf %s "$VAULT_PROBE" | wc -c'),
        state.controller.signal,
        assertCanRun,
      )
      expect(refused.exitCode).not.toBe(0)
      expect(refused.stdout).not.toContain(String(value.length))
      // A tainted proposal denies as tainted over the real channel.
      await state.raw.send({
        kind: 'reportProvenance',
        taint: { tainted: false, reasons: [] },
      })
      const approval = await state.raw.send({
        kind: 'requestUse',
        proposal: {
          handle: 'secret://service-key',
          use: countUse(),
          taint: {
            tainted: true,
            reasons: [{ source: 'web', label: 'fixture web page' }],
          },
        },
      })
      expect(approval).toMatchObject({ kind: 'denied', reason: 'tainted' })
      // No redemption is served on the requester socket itself.
      const ticket = await inner.authorize(
        'secret://service-key',
        countUse(),
        { tainted: false, reasons: [] },
        state.controller.signal,
      )
      if (ticket.kind !== 'ticket') throw new Error('missing ticket')
      const redeem = await state.raw.send({
        kind: 'redeem',
        ticket: ticket.ticket,
        use: countUse(),
      })
      expect(redeem).toMatchObject({ kind: 'denied' })
      const feederFrame = await state.raw.send({
        v: VAULT_PROTOCOL_VERSION,
        kind: 'execRedeem',
        ticket: ticket.ticket,
        use: countUse(),
        envelopeDigest: '0'.repeat(64),
      })
      expect(feederFrame).toMatchObject({ kind: 'denied' })
    }, 60_000)

    it('a lock ends a running feeder command', async () => {
      const service = state.service
      if (!service || !state.manage) throw new Error('missing exec service')
      const started = Date.now()
      const running = service.run(envRun('sleep 30'), state.controller.signal, assertCanRun)
      await state.manage.lock()
      const reply = await running
      expect(Date.now() - started).toBeLessThan(25_000)
      expect(reply.exitCode).not.toBe(0)
      await state.manage.unlock(null)
    }, 60_000)
  },
)
