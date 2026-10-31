// M100 two-process drill child: owns one temp dir, publishes its invitation
// through a file, reads its peer's invitation, then runs one pinned-TLS
// frame exchange over loopback. Bundled by deviceTwoProcess.e2e.test.ts with
// esbuild; never imported by tests. All stdout lines are signals the parent
// matches; diagnostics go to stderr.
//
// The DER-to-PEM wrap below is drill glue: invitation acceptance (which will
// materialise a TLS pair from certificateDerBase64 in src) is a later lane.
import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import nodePath from 'node:path'
import type { Server, TLSSocket } from 'node:tls'
import {
  DeviceOwnerAudit,
  DeviceOwnerBindings,
  DeviceOwnerGrants,
} from '../../src/core/devices/ownerBind'
import type { MultiplexedDeviceMessage } from '../../src/core/devices/channel'
import {
  confirmDeviceFingerprint,
  createDeviceInvitation,
  validateDevicePair,
  type DevicePair,
} from '../../src/core/devices/pairing'
import { DeviceTransport, type DeviceTransportPair } from '../../src/host/devices/deviceTransport'
import {
  openMultiplexedDeviceChannel,
  type DeviceChannel,
  type DeviceChannelPort,
  type MultiplexedDevicePort,
  type PacedDeviceChannel,
} from '../../src/host/devices/deviceChannel'
import type { Logger } from '../../src/host/logger'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import {
  deviceGrantRequestSchema,
  deviceGrantSchema,
  deviceInvitationSchema,
  devicePairingConfirmationSchema,
  type DeviceFrame,
  type DeviceGrant,
  type DeviceInvitation,
  type DevicePairingConfirmation,
} from '../../src/shared/devices'
import type { DeviceTlsIdentity } from '../unit/helpers/deviceTls'
import { pacedReadyFor, pinnedConnect, pinnedServer } from '../unit/helpers/devicePacedSockets'
import { rigArg } from './driverArgs'

const PAIR_ID = 'ab'.repeat(16)
const POLL_MS = 50
const FILE_BUDGET_MS = 10_000
const EXCHANGE_BUDGET_MS = 15_000
// Lane K owner-bind scenario: the bound owner, the wrong owner, and one
// role per grant so each refusal names its own cause.
const OWNER_A = 'aa'.repeat(16)
const OWNER_B = 'bb'.repeat(16)
const ROLE_OK = 'c1'.repeat(16)
const ROLE_EXPIRING = 'c2'.repeat(16)
const REPOSITORY = 'dd'.repeat(16)
const GRANT_OK = 'e1'.repeat(16)
const GRANT_EXPIRING = 'e2'.repeat(16)
const OWNER_REQUESTS = 4
const GRANT_TTL_MS = 2000
const REPLAY_WAIT_MS = 4000

const log: Logger = {
  trace: (message: string): void => {
    process.stderr.write(`[trace] ${message}\n`)
  },
  info: (message: string): void => {
    process.stderr.write(`[info] ${message}\n`)
  },
  warn: (message: string): void => {
    process.stderr.write(`[warn] ${message}\n`)
  },
  error: (message: string): void => {
    process.stderr.write(`[error] ${message}\n`)
  },
}

function opt(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  const value = index === -1 ? undefined : process.argv[index + 1]
  return value === '' ? undefined : value
}

/** A DER certificate as the TLS stack wants it: PEM-wrapped base64. */
function derBase64ToPem(derBase64: string): string {
  const rows: string[] = []
  for (let at = 0; at < derBase64.length; at += 64) rows.push(derBase64.slice(at, at + 64))
  return `-----BEGIN CERTIFICATE-----\n${rows.join('\n')}\n-----END CERTIFICATE-----\n`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function waitForFile(path: string, missing: string): Promise<void> {
  const startedAt = Date.now()
  for (;;) {
    if (existsSync(path)) return
    if (Date.now() - startedAt > FILE_BUDGET_MS) throw new Error(missing)
    await sleep(POLL_MS)
  }
}

async function readPeerInvitation(path: string): Promise<DeviceInvitation> {
  await waitForFile(path, 'peer invitation not found')
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
  return deviceInvitationSchema.parse(raw)
}

function frame(body: DeviceFrame['body'], requestId: string): DeviceFrame {
  return {
    version: DEVICE_LIMITS.protocolVersion,
    pairId: PAIR_ID,
    receiverIncarnationId: 'cd'.repeat(16),
    requestId,
    body,
  }
}

interface Exchange {
  port: DeviceChannelPort
  waitForConnected: () => Promise<DeviceChannel>
  waitForReceive: (kind: string) => Promise<DeviceFrame>
}

function captureExchange(): Exchange {
  let channel: DeviceChannel | undefined
  const channelWaiters: ((value: DeviceChannel) => void)[] = []
  const received: DeviceFrame[] = []
  const receiveWaiters: { kind: string; resolve: (frame: DeviceFrame) => void }[] = []
  const port: DeviceChannelPort = {
    connected: (value: DeviceChannel): void => {
      channel = value
      for (const wait of channelWaiters.splice(0)) wait(value)
    },
    receive: (value: DeviceFrame): Promise<void> => {
      received.push(value)
      for (let index = receiveWaiters.length - 1; index >= 0; index -= 1) {
        const waiter = receiveWaiters[index]
        if (waiter?.kind !== value.body.kind) continue
        receiveWaiters.splice(index, 1)
        waiter.resolve(value)
      }
      return Promise.resolve()
    },
    disconnected: (reason: string): void => {
      log.warn(`disconnected: ${reason}`)
    },
  }
  return {
    port,
    waitForConnected: (): Promise<DeviceChannel> =>
      new Promise((resolve, reject) => {
        if (channel !== undefined) {
          resolve(channel)
          return
        }
        const timer = setTimeout(() => {
          reject(new Error('channel not connected'))
        }, EXCHANGE_BUDGET_MS)
        timer.unref()
        channelWaiters.push((value) => {
          clearTimeout(timer)
          resolve(value)
        })
      }),
    waitForReceive: (kind: string): Promise<DeviceFrame> =>
      new Promise((resolve, reject) => {
        const ready = received.find((candidate) => candidate.body.kind === kind)
        if (ready !== undefined) {
          resolve(ready)
          return
        }
        const timer = setTimeout(() => {
          reject(new Error(`frame not received: ${kind}`))
        }, EXCHANGE_BUDGET_MS)
        timer.unref()
        receiveWaiters.push({
          kind,
          resolve: (value) => {
            clearTimeout(timer)
            resolve(value)
          },
        })
      }),
  }
}

async function readPeerConfirmation(path: string): Promise<DevicePairingConfirmation> {
  await waitForFile(path, 'peer confirmation not found')
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
  return devicePairingConfirmationSchema.parse(raw)
}

function tlsIdentities(
  own: DeviceInvitation,
  ownKey: string,
  peer: DeviceInvitation,
): { local: DeviceTlsIdentity; remote: DeviceTlsIdentity } {
  return {
    local: {
      pem: derBase64ToPem(own.certificateDerBase64),
      keyPem: ownKey,
      fingerprint: own.fingerprint,
    },
    remote: {
      pem: derBase64ToPem(peer.certificateDerBase64),
      keyPem: '',
      fingerprint: peer.fingerprint,
    },
  }
}

async function listenFixed(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
}

function acceptOne(server: Server): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('peer did not dial'))
    }, EXCHANGE_BUDGET_MS)
    timer.unref()
    server.once('secureConnection', (socket: TLSSocket) => {
      clearTimeout(timer)
      socket.on('error', () => undefined)
      resolve(socket)
    })
    server.once('error', reject)
  })
}

async function run(): Promise<void> {
  const role = rigArg('role')
  const port = Number(rigArg('port'))
  if ((role !== 'listen' && role !== 'dial') || !Number.isSafeInteger(port) || port < 1) {
    throw new Error('bad arguments')
  }
  const dir = rigArg('dir')
  const ownPath = rigArg('own')
  const peerPath = rigArg('peer')
  mkdirSync(dir, { recursive: true })
  const deviceId = randomBytes(DEVICE_LIMITS.idChars / 2).toString('hex')
  const now = Date.now()
  const { invitation, privateKeyPem } = createDeviceInvitation(
    { address: '127.0.0.1', port },
    deviceId,
    now,
    now + DEVICE_LIMITS.certificateLifetimeMs,
  )
  writeFileSync(ownPath, JSON.stringify(invitation))
  signal('INVITATION-WRITTEN')
  const peer = await readPeerInvitation(peerPath)
  const scenario = opt('scenario') ?? 'frames'
  if (scenario === 'owner-bind') {
    await runOwnerBind(
      role,
      dir,
      port,
      invitation,
      privateKeyPem,
      peer,
      peerPath,
      role === 'dial' ? rigArg('ready') : undefined,
    )
    return
  }
  if (scenario !== 'frames') throw new Error('bad scenario')
  const transportPair: DeviceTransportPair = {
    pairId: PAIR_ID,
    receiverIncarnationId: 'cd'.repeat(16),
    certificate: derBase64ToPem(invitation.certificateDerBase64),
    privateKey: privateKeyPem,
    fingerprint: invitation.fingerprint,
    peerCertificate: derBase64ToPem(peer.certificateDerBase64),
    peerFingerprint: peer.fingerprint,
    isActive: () => true,
    isOffered: () => true,
  }
  const transport = new DeviceTransport(log)
  const exchange = captureExchange()
  const identity = {
    pairId: PAIR_ID,
    receiverIncarnationId: 'cd'.repeat(16),
    boardId: 'ef'.repeat(16),
    taskId: '01'.repeat(16),
    attemptId: '23'.repeat(16),
  }
  try {
    if (role === 'listen') {
      const unlisten = await transport.listen(transportPair, '127.0.0.1', port, exchange.port)
      try {
        writeFileSync(`${dir}/ready`, '')
        signal('LISTENING')
        const channel = await exchange.waitForConnected()
        channel.send(frame({ kind: 'offers', offers: [] }, '10'.repeat(16)))
        const reconcile = await exchange.waitForReceive('reconcile')
        writeFileSync(`${dir}/received.json`, JSON.stringify(reconcile))
        signal('RECEIVED reconcile')
        channel.send(frame({ kind: 'reconcile', identities: [identity] }, '12'.repeat(16)))
        signal('LISTENER-DONE')
      } finally {
        unlisten()
      }
    } else {
      await waitForFile(rigArg('ready'), 'listener not ready')
      const channel = await transport.connect(
        transportPair,
        '127.0.0.1',
        port,
        '127.0.0.1',
        exchange.port,
      )
      try {
        signal('CONNECTED')
        const opening = await exchange.waitForReceive('offers')
        writeFileSync(`${dir}/received.json`, JSON.stringify(opening))
        signal('RECEIVED offers')
        channel.send(frame({ kind: 'reconcile', identities: [identity] }, '11'.repeat(16)))
        await exchange.waitForReceive('reconcile')
        signal('DIALER-DONE')
      } finally {
        channel.close()
      }
    }
  } finally {
    transport.revoke(PAIR_ID)
  }
}

function grantShape(
  pairId: string,
  roleId: string,
  grantId: string,
  issuedAt: number,
  expiresAt: number,
): DeviceGrant {
  return deviceGrantSchema.parse({
    version: DEVICE_LIMITS.protocolVersion,
    grantId,
    grantRevision: 1,
    pairId,
    ownerId: OWNER_A,
    roleId,
    mode: 'manual',
    repositoryId: REPOSITORY,
    lanes: true,
    checks: false,
    quota: {
      workers: 4,
      processes: 4,
      heavyChecks: 2,
      tokens: 200,
      spendUsd: 2,
      artifactBytes: 200,
    },
    issuedAt,
    expiresAt,
    requiresStepUp: false,
  })
}

function grantClaim(pairId: string, ownerId: string, roleId: string) {
  return deviceGrantRequestSchema.parse({
    version: DEVICE_LIMITS.protocolVersion,
    pairId,
    ownerId,
    roleId,
    mode: 'manual',
    repositoryId: REPOSITORY,
    lanes: true,
    checks: false,
    quota: { workers: 0, processes: 0, heavyChecks: 0, tokens: 0, spendUsd: 0, artifactBytes: 0 },
  })
}

async function runOwnerBind(
  role: string,
  dir: string,
  port: number,
  own: DeviceInvitation,
  ownKey: string,
  peer: DeviceInvitation,
  peerPath: string,
  readyPath: string | undefined,
): Promise<void> {
  // The confirmation ceremony over files, as invitations go over files:
  // each side signs its own bond and publishes it for the peer.
  const confirmation = confirmDeviceFingerprint(own, peer, ownKey, peer.fingerprint, Date.now())
  writeFileSync(`${dir}/confirmation.json`, JSON.stringify(confirmation))
  // The peer's folder by the platform's own separator (`\` on Windows).
  const peerConfirmation = await readPeerConfirmation(
    `${nodePath.dirname(peerPath)}/confirmation.json`,
  )
  const pair = { local: own, peer, localConfirmation: confirmation, peerConfirmation }
  const pairId = validateDevicePair(pair, Date.now())
  const identities = tlsIdentities(own, ownKey, peer)
  const capturePath = `${dir}/capture.jsonl`
  const record = (direction: string, message: unknown): void => {
    appendFileSync(capturePath, `${JSON.stringify({ direction, message })}\n`)
  }
  if (role === 'listen') {
    await serveOwnerBind(dir, port, pairId, pair, identities, record)
  } else {
    if (readyPath === undefined) throw new Error('missing --ready')
    await claimOwnerBind(readyPath, port, pairId, identities, record)
  }
}

async function openOwnerChannel(
  socket: TLSSocket,
  pairId: string,
  peerFingerprint: string,
  requestId: string,
  isReceiver: boolean,
  port: MultiplexedDevicePort,
): Promise<PacedDeviceChannel> {
  const channel = openMultiplexedDeviceChannel(
    socket,
    { pairId, peerFingerprint, isActive: () => true },
    pacedReadyFor(pairId, 'cd'.repeat(16), requestId),
    isReceiver,
    port,
    log,
  )
  await channel.ready
  return channel
}

async function serveOwnerBind(
  dir: string,
  port: number,
  pairId: string,
  pair: DevicePair,
  identities: { local: DeviceTlsIdentity; remote: DeviceTlsIdentity },
  record: (direction: string, message: unknown) => void,
): Promise<void> {
  const auditPath = `${dir}/audit.jsonl`
  const audit = new DeviceOwnerAudit({
    append: (entry) => {
      appendFileSync(auditPath, `${JSON.stringify(entry)}\n`)
      return Promise.resolve()
    },
  })
  const bindings = new DeviceOwnerBindings()
  const grants = new DeviceOwnerGrants(bindings, audit)
  // The binding the drills attack: this pair serves owner A only.
  bindings.bind(pair, OWNER_A, Date.now())
  await audit.record({ pairId, ownerId: OWNER_A, action: 'bind', decision: 'allow' })
  const issuedAt = Date.now()
  await grants.issue(grantShape(pairId, ROLE_OK, GRANT_OK, issuedAt, issuedAt + 3_600_000))
  await grants.issue(
    grantShape(pairId, ROLE_EXPIRING, GRANT_EXPIRING, issuedAt, issuedAt + GRANT_TTL_MS),
  )
  const server = pinnedServer(identities.local, identities.remote)
  await listenFixed(server, port)
  writeFileSync(`${dir}/ready`, '')
  signal('LISTENING')
  try {
    const socket = await acceptOne(server)
    // Serves serialize: the audit order is the claim order, and the
    // served count only moves once the reply is on the channel.
    let tail: Promise<void> = Promise.resolve()
    let served = 0
    const channelPort: MultiplexedDevicePort = {
      connected: () => undefined,
      receive: (message) => {
        record('in', message)
        if (message.kind !== 'grantRequest') return Promise.resolve()
        const next = (async (): Promise<void> => {
          await tail
          const found = grants.find(
            message.request.pairId,
            message.request.ownerId,
            message.request.roleId,
          )
          const decided = await grants.authorize(
            {
              pairId: message.request.pairId,
              ownerId: message.request.ownerId,
              roleId: message.request.roleId,
              grantId: found?.grantId ?? '00'.repeat(16),
              grantRevision: found?.grantRevision ?? 1,
              mode: message.request.mode,
              quota: message.request.quota,
            },
            Date.now(),
          )
          const reply: MultiplexedDeviceMessage =
            'reason' in decided
              ? { kind: 'grantRefusal', refusal: decided }
              : { kind: 'grant', grant: decided }
          record('out', reply)
          if (!channel.send(reply)) throw new Error('channel did not accept the reply')
          served += 1
        })()
        tail = (async (): Promise<void> => {
          try {
            await next
          } catch {
            // A failed serve still releases the next one; the failure
            // itself rejects through receive above.
          }
        })()
        return next
      },
      disconnected: (): void => {
        log.warn('disconnected')
      },
    }
    const channel = await openOwnerChannel(
      socket,
      pairId,
      identities.remote.fingerprint,
      'd1'.repeat(16),
      true,
      channelPort,
    )
    try {
      for (;;) {
        await sleep(POLL_MS)
        if (served >= OWNER_REQUESTS) break
      }
      signal('LISTENER-DONE')
    } finally {
      channel.close()
    }
  } finally {
    server.close()
  }
}

async function claimOwnerBind(
  readyPath: string,
  port: number,
  pairId: string,
  identities: { local: DeviceTlsIdentity; remote: DeviceTlsIdentity },
  record: (direction: string, message: unknown) => void,
): Promise<void> {
  await waitForFile(readyPath, 'listener not ready')
  const socket = await pinnedConnect(identities.local, identities.remote, port)
  type GrantReply = Extract<MultiplexedDeviceMessage, { kind: 'grant' | 'grantRefusal' }>
  const replyWaiters: ((message: GrantReply) => void)[] = []
  const channelPort: MultiplexedDevicePort = {
    connected: () => undefined,
    receive: (message) => {
      record('in', message)
      if (message.kind === 'grant' || message.kind === 'grantRefusal') {
        for (const wait of replyWaiters.splice(0)) wait(message)
      }
      return Promise.resolve()
    },
    disconnected: (): void => {
      log.warn('disconnected')
    },
  }
  const channel = await openOwnerChannel(
    socket,
    pairId,
    identities.remote.fingerprint,
    'd2'.repeat(16),
    false,
    channelPort,
  )
  const ask = async (
    ownerId: string,
    roleId: string,
  ): Promise<Extract<MultiplexedDeviceMessage, { kind: 'grant' | 'grantRefusal' }>> => {
    const request: MultiplexedDeviceMessage = {
      kind: 'grantRequest',
      request: grantClaim(pairId, ownerId, roleId),
    }
    record('out', request)
    if (!channel.send(request)) throw new Error('channel did not accept the claim')
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('grant reply not received'))
      }, EXCHANGE_BUDGET_MS)
      timer.unref()
      replyWaiters.push((message) => {
        clearTimeout(timer)
        resolve(message)
      })
    })
  }
  try {
    signal('CONNECTED')
    // Positive control, then the wrong owner on a valid pair key.
    const allowed = await ask(OWNER_A, ROLE_OK)
    if (allowed.kind !== 'grant') throw new Error('owner A was not allowed')
    signal('OWNER-ALLOWED')
    const refused = await ask(OWNER_B, ROLE_OK)
    if (refused.kind !== 'grantRefusal' || refused.refusal.reason !== 'owner-mismatch')
      throw new Error('owner B was not refused as owner-mismatch')
    signal('OWNER-REFUSED')
    // The grant while current, then its replay past its bound.
    const live = await ask(OWNER_A, ROLE_EXPIRING)
    if (live.kind !== 'grant') throw new Error('live grant was not allowed')
    signal('GRANT-ALLOWED')
    await sleep(REPLAY_WAIT_MS)
    const replayed = await ask(OWNER_A, ROLE_EXPIRING)
    if (replayed.kind !== 'grantRefusal' || replayed.refusal.reason !== 'grant-expired')
      throw new Error('expired replay was not refused as grant-expired')
    signal('GRANT-REPLAY-REFUSED')
    signal('DIALER-DONE')
  } finally {
    channel.close()
  }
}

function signal(line: string): void {
  process.stdout.write(`${line}\n`)
}

try {
  await run()
} catch (error) {
  log.error(error instanceof Error ? error.message : 'failed')
  process.exitCode = 1
}
