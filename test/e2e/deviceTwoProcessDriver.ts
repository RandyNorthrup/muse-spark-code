// M100 two-process drill child: owns one temp dir, publishes its invitation
// through a file, reads its peer's invitation, then runs one pinned-TLS
// frame exchange over loopback. Bundled by deviceTwoProcess.e2e.test.ts with
// esbuild; never imported by tests. All stdout lines are signals the parent
// matches; diagnostics go to stderr.
//
// The DER-to-PEM wrap below is drill glue: invitation acceptance (which will
// materialise a TLS pair from certificateDerBase64 in src) is a later lane.
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createDeviceInvitation } from '../../src/core/devices/pairing'
import { DeviceTransport, type DeviceTransportPair } from '../../src/host/devices/deviceTransport'
import type { DeviceChannel, DeviceChannelPort } from '../../src/host/devices/deviceChannel'
import type { Logger } from '../../src/host/logger'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import {
  deviceInvitationSchema,
  type DeviceFrame,
  type DeviceInvitation,
} from '../../src/shared/devices'

const PAIR_ID = 'ab'.repeat(16)
const POLL_MS = 50
const FILE_BUDGET_MS = 10_000
const EXCHANGE_BUDGET_MS = 15_000

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

function arg(name: string): string {
  const index = process.argv.indexOf(`--${name}`)
  const value = index === -1 ? undefined : process.argv[index + 1]
  if (value === undefined || value === '') throw new Error(`missing --${name}`)
  return value
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

async function run(): Promise<void> {
  const role = arg('role')
  const port = Number(arg('port'))
  if ((role !== 'listen' && role !== 'dial') || !Number.isSafeInteger(port) || port < 1) {
    throw new Error('bad arguments')
  }
  const dir = arg('dir')
  const ownPath = arg('own')
  const peerPath = arg('peer')
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
      await waitForFile(arg('ready'), 'listener not ready')
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

function signal(line: string): void {
  process.stdout.write(`${line}\n`)
}

try {
  await run()
} catch (error) {
  log.error(error instanceof Error ? error.message : 'failed')
  process.exitCode = 1
}
