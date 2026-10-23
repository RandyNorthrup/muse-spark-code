// M100 lane K: brokered vault uses over the M100 channel (with M109 lane
// R). The owner serves through a real VaultRemoteOwner against a real
// locked VaultBroker; both channel ends are real pinned TLS 1.3. POSIX:
// on Windows the broker's files build over the pipe relay, so the locked
// broker cannot stand in-process there; the channel logic is
// platform-independent and the Windows DPAPI leg proves the slot on CI.
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import os from 'node:os'
import path from 'node:path'
import type { Server, TLSSocket } from 'node:tls'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  DeviceOwnerAudit,
  DeviceOwnerBindings,
  ownerVaultChannel,
  hasConsumedOwnerBrokeredUse,
  serveOwnerBrokeredUse,
  type DeviceOwnerAuditRecord,
  type DeviceOwnerBinding,
  type DeviceOwnerChannel,
} from '../../src/core/devices/ownerBind'
import type { MultiplexedDeviceMessage } from '../../src/core/devices/channel'
import { DevicePairingError, type DevicePair } from '../../src/core/devices/pairing'
import { VaultBroker } from '../../src/core/vault/broker/broker'
import { VaultAuditLog, type VaultAuditAnchorPort } from '../../src/core/vault/broker/audit'
import { VaultLockEpoch } from '../../src/core/vault/broker/epoch'
import { VaultSlotUnlock, VaultStoreRepository } from '../../src/core/vault/broker/repository'
import { VaultScrubService } from '../../src/core/vault/scrub'
import { NodeVaultFiles } from '../../src/core/vault/store'
import { VaultRemoteOwner, type VaultRemotePorts } from '../../src/core/vault/remote'
import {
  PacedDeviceChannels,
  type MultiplexedDevicePort,
  type PacedDeviceChannel,
} from '../../src/host/devices/deviceChannel'
import { KeyringVaultAnchor } from '../../src/runtime/vault/keyringAnchor'
import type { KeyringEntryFactory } from '../../src/runtime/keyStore'
import { LinuxVaultSlots } from '../../src/runtime/vault/slots/linuxVaultSlots'
import { MacVaultSlots } from '../../src/runtime/vault/slots/macVaultSlots'
import { macVaultTransport } from '../../src/runtime/vault/slots/macVaultTransport'
import { vaultAnchorAccount } from '../../src/runtime/vault/vaultStoreScope'
import {
  MILLISECONDS_PER_MINUTE,
  VAULT_IDLE_MINUTES,
  VAULT_LIMITS,
  VAULT_PROTOCOL_VERSION,
} from '../../src/shared/constants'
import {
  vaultRemoteRequestSchema,
  type VaultAuthenticatedPeer,
} from '../../src/shared/vaultProtocol'
import { levelLogger, type LoggedMessage } from './helpers/collectingLogger'
import { completeDevicePair } from './helpers/devicePairs'
import { deviceTlsIdentity } from './helpers/deviceTls'
import {
  listenEphemeral,
  pacedReadyFor,
  pinnedDialer,
  pinnedServer,
} from './helpers/devicePacedSockets'

const NOW = Date.UTC(2026, 9, 23)
const OWNER_DEVICE = '0a'.repeat(16)
const REQUESTER_DEVICE = '0b'.repeat(16)
const OWNER_ID = 'aa'.repeat(16)
const INCARNATION = 'cc'.repeat(16)
const ORIGIN = 'https://example.com'

function hexId(value: number): string {
  return value.toString(16).padStart(32, '0')
}

function completePair(): DevicePair {
  return completeDevicePair(OWNER_DEVICE, REQUESTER_DEVICE, NOW).pair
}

function mirrored(pair: DevicePair): DevicePair {
  return {
    local: pair.peer,
    peer: pair.local,
    localConfirmation: pair.peerConfirmation,
    peerConfirmation: pair.localConfirmation,
  }
}

function totpRequest(owningDeviceId: string, id: string) {
  return vaultRemoteRequestSchema.parse({
    v: VAULT_PROTOCOL_VERSION,
    id,
    owningDeviceId,
    use: { kind: 'totp', origin: ORIGIN },
  })
}

function unreachablePort(name: string): () => Promise<never> {
  return () => Promise.reject(new Error(`${name} must not be consulted while locked`))
}

function audited(records: DeviceOwnerAuditRecord[]): DeviceOwnerAudit {
  return new DeviceOwnerAudit({
    append: (record) => {
      records.push(record)
      return Promise.resolve()
    },
  })
}

function auditPairs(records: DeviceOwnerAuditRecord[]): [string, string][] {
  return records.map((record) => [record.action, record.decision])
}

function silentUnsubscribe(): void {
  return undefined
}

function silentSubscribe(): () => void {
  return silentUnsubscribe
}

function silentSend(): void {
  return undefined
}

const silentOwnerChannel: DeviceOwnerChannel = {
  send: silentSend,
  subscribe: silentSubscribe,
  subscribeClose: silentSubscribe,
  closed: false,
}

interface LaneKFanOut {
  readonly port: MultiplexedDevicePort
  bind(channel: PacedDeviceChannel): DeviceOwnerChannel
}

function laneKFanOut(): LaneKFanOut {
  const listeners = new Set<(message: MultiplexedDeviceMessage) => void>()
  const closeListeners = new Set<() => void>()
  return {
    port: {
      connected: () => undefined,
      receive: (message) => {
        for (const listener of listeners) listener(message)
        return Promise.resolve()
      },
      disconnected: () => {
        for (const listener of closeListeners) listener()
      },
    },
    bind: (channel) => ({
      send: (message) => {
        if (!channel.send(message)) throw new DevicePairingError('capacity')
      },
      subscribe: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      subscribeClose: (listener) => {
        closeListeners.add(listener)
        return () => {
          closeListeners.delete(listener)
        }
      },
      get closed() {
        return channel.closed
      },
    }),
  }
}

describe.runIf(process.platform === 'linux' || process.platform === 'darwin')(
  'M100 lane K brokered uses over the channel',
  () => {
    const logged: LoggedMessage[] = []
    const log = levelLogger(logged)
    const fixture: {
      root: string
      broker?: VaultBroker
      owner?: VaultRemoteOwner
      ownerBinding?: DeviceOwnerBinding
      requesterBinding?: DeviceOwnerBinding
      peer?: VaultAuthenticatedPeer
      pairId?: string
    } = { root: '' }
    const pacers: PacedDeviceChannels[] = []
    const servers: Server[] = []
    const live: PacedDeviceChannel[] = []
    const userCalls: { select: number; resolve: number; approve: number; execute: number } = {
      select: 0,
      resolve: 0,
      approve: 0,
      execute: 0,
    }
    const brokerEvents: string[] = []

    beforeAll(async () => {
      fixture.root = await mkdtemp(path.join(tmpdir(), 'lane-k-broker-'))
      const dataDir = path.join(fixture.root, 'vault')
      const runDir = path.join(fixture.root, 'run')
      const { AsyncEntry } = await import('@napi-rs/keyring')
      const keyring: KeyringEntryFactory = (service, account) =>
        new AsyncEntry(service, account, { linux: { store: 'secret-service' } })
      // Scoped to the temp root: the product's own anchor account is never named.
      const anchor = new KeyringVaultAnchor(keyring, { account: vaultAnchorAccount(dataDir) })
      const files = new NodeVaultFiles(dataDir, VAULT_LIMITS.frameBytes)
      const slots =
        process.platform === 'darwin'
          ? new MacVaultSlots(macVaultTransport(path.join(fixture.root, 'missing-helper')), {
              dataDir,
              platform: 'darwin',
            })
          : new LinuxVaultSlots({ dataDir, platform: 'linux' })
      const repository = new VaultStoreRepository(files, anchor)
      const unlock = new VaultSlotUnlock(files, anchor, slots)
      const epoch = new VaultLockEpoch(runDir)
      const anchors: VaultAuditAnchorPort = {
        read: unreachablePort('audit anchor'),
        write: unreachablePort('audit anchor'),
        transaction: unreachablePort('audit anchor'),
      }
      const audit = new VaultAuditLog(path.join(dataDir, 'audit'), anchors)
      const scrub = new VaultScrubService()
      // The broker is never set up or unlocked: every use refuses locked,
      // and no store entry is read or written on any platform.
      fixture.broker = new VaultBroker({
        clock: { now: () => Date.now() },
        repository,
        unlock,
        epoch: {
          current: () => epoch.current(),
          bump: (authorize) => epoch.bump(authorize),
          subscribe: (listener) => epoch.subscribe(listener),
        },
        audit,
        identity: {
          verifyHost: unreachablePort('identity'),
          verifyLaunched: unreachablePort('identity'),
        },
        idleMs: VAULT_IDLE_MINUTES * MILLISECONDS_PER_MINUTE,
        lockOnScreenLock: false,
        firstPartyOnly: false,
        onApproval: () => {
          brokerEvents.push('approval')
        },
        onLocked: () => {
          brokerEvents.push('locked')
        },
        onRevoked: () => {
          brokerEvents.push('revoked')
        },
        onAuditFailure: () => {
          brokerEvents.push('audit-failure')
        },
        scrub: (text) => scrub.scrub(text),
      })
      const pair = completePair()
      const bindings = new DeviceOwnerBindings()
      const ownerBinding = bindings.bind(pair, OWNER_ID, NOW)
      const requesterBinding = bindings.bind(mirrored(pair), OWNER_ID, NOW)
      fixture.ownerBinding = ownerBinding
      fixture.requesterBinding = requesterBinding
      fixture.pairId = ownerBinding.pairId
      const peer: VaultAuthenticatedPeer = {
        hostId: randomBytes(16).toString('hex'),
        processId: process.pid,
        userId: os.userInfo().username,
        ui: true,
      }
      fixture.peer = peer
      const ports: VaultRemotePorts = {
        owningDeviceId: OWNER_DEVICE,
        peer,
        broker: fixture.broker,
        select: () => {
          userCalls.select += 1
          return Promise.resolve('secret://owner-totp-1')
        },
        resolve: (remote) => {
          userCalls.resolve += 1
          if (remote.use.kind !== 'totp' || remote.use.origin !== ORIGIN)
            throw new Error('useChanged')
          return Promise.resolve({
            kind: 'totp' as const,
            command: { executable: process.execPath, argv: [], cwd: fixture.root },
          })
        },
        approve: () => {
          userCalls.approve += 1
          return Promise.reject(new Error('must not be asked while locked'))
        },
        execute: () => {
          userCalls.execute += 1
          return Promise.reject(new Error('must not execute while locked'))
        },
      }
      fixture.owner = new VaultRemoteOwner(ports)
    })

    afterAll(async () => {
      await fixture.owner?.dispose()
      await fixture.broker?.dispose()
      for (const channel of live.splice(0)) channel.close()
      for (const pacer of pacers.splice(0)) pacer.close()
      for (const server of servers.splice(0)) {
        server.close()
        await new Promise((resolve) => server.once('close', resolve))
      }
      if (fixture.root !== '') await rm(fixture.root, { recursive: true, force: true })
    })

    async function pairedEnds(): Promise<{
      ownerSide: DeviceOwnerChannel
      requesterSide: DeviceOwnerChannel
    }> {
      const { pairId } = ready()
      const dialerIdentity = deviceTlsIdentity(REQUESTER_DEVICE, 1)
      const serverIdentity = deviceTlsIdentity(OWNER_DEVICE, 1)
      const server = pinnedServer(serverIdentity, dialerIdentity)
      servers.push(server)
      const port = await listenEphemeral(server)
      const pacing = {
        throttled: () => undefined,
        authenticationRequired: () => undefined,
      }
      const dialer = new PacedDeviceChannels(
        pinnedDialer(dialerIdentity, serverIdentity, port),
        pacing,
        log,
      )
      const acceptor = new PacedDeviceChannels(
        pinnedDialer(serverIdentity, dialerIdentity, port),
        pacing,
        log,
      )
      pacers.push(dialer, acceptor)
      const ownerFan = laneKFanOut()
      const requesterFan = laneKFanOut()
      const accepted: Promise<PacedDeviceChannel>[] = []
      server.on('secureConnection', (socket: TLSSocket) => {
        socket.on('error', () => undefined)
        accepted.push(
          acceptor.accept(
            {
              pairId,
              peerFingerprint: dialerIdentity.fingerprint,
              isActive: () => true,
            },
            pacedReadyFor(pairId, INCARNATION, hexId(101)),
            ownerFan.port,
            () => Promise.resolve(socket),
          ),
        )
      })
      const requester = await dialer.connect(
        {
          pairId,
          peerFingerprint: serverIdentity.fingerprint,
          isActive: () => true,
        },
        pacedReadyFor(pairId, INCARNATION, hexId(102)),
        requesterFan.port,
      )
      await requester.ready
      const [incoming] = accepted
      if (incoming === undefined) throw new Error('missing accepted channel')
      const owner = await incoming
      await owner.ready
      live.push(requester, owner)
      return { ownerSide: ownerFan.bind(owner), requesterSide: requesterFan.bind(requester) }
    }

    function ready() {
      const { owner, ownerBinding, requesterBinding, peer, pairId } = fixture
      if (
        owner === undefined ||
        ownerBinding === undefined ||
        requesterBinding === undefined ||
        peer === undefined ||
        pairId === undefined
      )
        throw new Error('lane-K fixture not ready')
      return { owner, ownerBinding, requesterBinding, peer, pairId }
    }

    it('serves channel facts from the binding, never the payload', async () => {
      const { ownerBinding, peer } = ready()
      const channel = ownerVaultChannel(ownerBinding, peer, silentOwnerChannel)
      const identity = await channel.authenticate()
      expect(identity.pinnedMutualTls).toBe(true)
      expect(identity.deviceId).toBe(REQUESTER_DEVICE)
      expect(identity.owningDeviceId).toBe(OWNER_DEVICE)
      expect(identity.requester).toMatchObject({
        hostId: peer.hostId,
        deviceId: REQUESTER_DEVICE,
        source: 'device',
        role: { kind: 'orchestrator' },
        unattended: false,
        peerProcessId: process.pid,
      })
    })

    it('denies a brokered use against the locked broker, both sides audited', async () => {
      const { owner, ownerBinding, requesterBinding, peer } = ready()
      const records: DeviceOwnerAuditRecord[] = []
      const audit = audited(records)
      const { ownerSide, requesterSide } = await pairedEnds()
      const serving: Promise<'allowed' | 'denied'>[] = []
      ownerSide.subscribe((message) => {
        if (message.kind !== 'vaultRequest') return
        serving.push(serveOwnerBrokeredUse(owner, ownerSide, ownerBinding, peer, message, audit))
      })
      const delivered: Uint8Array[] = []
      const before = { ...userCalls }
      const isConsumed = await hasConsumedOwnerBrokeredUse(
        requesterSide,
        requesterBinding,
        peer,
        totpRequest(OWNER_DEVICE, hexId(201)),
        (kind, bytes) => {
          delivered.push(bytes)
          return Promise.resolve()
        },
        new AbortController().signal,
        audit,
      )
      expect(isConsumed).toBe(false)
      await expect(Promise.all(serving)).resolves.toEqual(['denied'])
      expect(delivered).toEqual([])
      // The locked broker refused after local selection, before any approval.
      expect(userCalls.select - before.select).toBe(1)
      expect(userCalls.resolve - before.resolve).toBe(1)
      expect(userCalls.approve - before.approve).toBe(0)
      expect(userCalls.execute - before.execute).toBe(0)
      expect(auditPairs(records)).toHaveLength(2)
      expect(auditPairs(records)).toEqual(
        expect.arrayContaining([
          ['serve', 'deny'],
          ['request', 'deny'],
        ]),
      )
    })

    it('denies a use for the wrong owning device before the broker', async () => {
      const { owner, ownerBinding, peer } = ready()
      const records: DeviceOwnerAuditRecord[] = []
      const audit = audited(records)
      const { ownerSide, requesterSide } = await pairedEnds()
      const serving: Promise<'allowed' | 'denied'>[] = []
      ownerSide.subscribe((message) => {
        if (message.kind !== 'vaultRequest') return
        serving.push(serveOwnerBrokeredUse(owner, ownerSide, ownerBinding, peer, message, audit))
      })
      const answers: MultiplexedDeviceMessage[] = []
      const answered = new Promise<void>((resolve) => {
        requesterSide.subscribe((message) => {
          if (message.kind !== 'vaultResponse') return
          answers.push(message)
          resolve()
        })
      })
      const before = { ...userCalls }
      // Sent raw: the consumer call site would refuse this itself before
      // transmitting, so the owner-side refusal is reached directly.
      requesterSide.send({
        kind: 'vaultRequest',
        request: totpRequest('ff'.repeat(16), hexId(202)),
      })
      await answered
      await expect(Promise.all(serving)).resolves.toEqual(['denied'])
      expect(answers).toHaveLength(1)
      expect(answers[0]).toMatchObject({
        kind: 'vaultResponse',
        response: { id: hexId(202), result: { kind: 'denied' } },
      })
      // Neither local selection nor the broker was reached.
      expect(userCalls.select - before.select).toBe(0)
      expect(userCalls.resolve - before.resolve).toBe(0)
      expect(auditPairs(records)).toEqual([['serve', 'deny']])
      // Requester-end revocation notices are routine; no approval was
      // asked, no lock transitioned, no audit failed.
      expect(brokerEvents.filter((event) => event !== 'revoked')).toEqual([])
    })

    it('denies a replayed request without reselecting', async () => {
      const { owner, ownerBinding, requesterBinding, peer } = ready()
      const records: DeviceOwnerAuditRecord[] = []
      const audit = audited(records)
      const { ownerSide, requesterSide } = await pairedEnds()
      const serving: Promise<'allowed' | 'denied'>[] = []
      ownerSide.subscribe((message) => {
        if (message.kind !== 'vaultRequest') return
        serving.push(serveOwnerBrokeredUse(owner, ownerSide, ownerBinding, peer, message, audit))
      })
      const before = { ...userCalls }
      const request = totpRequest(OWNER_DEVICE, hexId(203))
      const deliver = () => Promise.resolve()
      const signal = new AbortController().signal
      await expect(
        hasConsumedOwnerBrokeredUse(
          requesterSide,
          requesterBinding,
          peer,
          request,
          deliver,
          signal,
          audit,
        ),
      ).resolves.toBe(false)
      await expect(
        hasConsumedOwnerBrokeredUse(
          requesterSide,
          requesterBinding,
          peer,
          request,
          deliver,
          signal,
          audit,
        ),
      ).resolves.toBe(false)
      await Promise.all(serving)
      // The replay died on the owner's seen-set, before local selection.
      expect(userCalls.select - before.select).toBe(1)
      expect(userCalls.resolve - before.resolve).toBe(1)
      expect(auditPairs(records)).toHaveLength(4)
      expect(auditPairs(records).filter((pair) => pair[0] === 'serve')).toEqual([
        ['serve', 'deny'],
        ['serve', 'deny'],
      ])
      expect(auditPairs(records).filter((pair) => pair[0] === 'request')).toEqual([
        ['request', 'deny'],
        ['request', 'deny'],
      ])
    })

    it('refuses a non-vault message and an aborted request without serving', async () => {
      const { owner, ownerBinding, requesterBinding, peer } = ready()
      const records: DeviceOwnerAuditRecord[] = []
      const audit = audited(records)
      const { ownerSide, requesterSide } = await pairedEnds()
      let served = 0
      ownerSide.subscribe((message) => {
        if (message.kind !== 'vaultRequest') return
        served += 1
      })
      await expect(
        serveOwnerBrokeredUse(
          owner,
          ownerSide,
          ownerBinding,
          peer,
          { kind: 'log', text: 'not a use' },
          audit,
        ),
      ).rejects.toThrow(expect.objectContaining({ reason: 'invalid-frame' }))
      const control = new AbortController()
      control.abort()
      await expect(
        hasConsumedOwnerBrokeredUse(
          requesterSide,
          requesterBinding,
          peer,
          totpRequest(OWNER_DEVICE, hexId(204)),
          () => Promise.resolve(),
          control.signal,
          audit,
        ),
      ).resolves.toBe(false)
      expect(served).toBe(0)
      expect(auditPairs(records)).toEqual([['request', 'deny']])
    })
  },
)
