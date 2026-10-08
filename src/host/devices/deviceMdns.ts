// Lane D: the DNS-SD binding behind DeviceDiscovery's injected mDNS port.
// Advertising carries only an opaque rotating service id, the receiver port
// and the protocol version — never an OS hostname, account, repository,
// model or stable device name. The SRV target is the opaque instance name
// itself: the peer address always comes from the UDP sender, which T
// revalidates while retaining the saved mutual-TLS identity. Discovery
// supplies address hints only; a hint never replaces a saved peer pin.
import { createSocket } from 'node:dgram'
import * as dnsPacket from 'dns-packet'
import { DEVICE_LIMITS } from '../../shared/constants'
import type { DeviceMdnsPort } from './deviceDiscovery'

// Fixed mDNS wire words, not tunables: the IANA multicast group and port,
// our DNS-SD service type, and the record TTL. The TTL outlives two
// advertisement rotations so a missed announce never reads as withdrawn.
const MDNS_ADDRESS = '224.0.0.251'
const MDNS_PORT = 5353
const SERVICE_TYPE = '_musespark._tcp.local'
const RECORD_TTL_SECONDS = 120
const INSTANCE_PREFIX = 'd-'
const INSTANCE_ID_CHARS = 12

/** Narrow dgram surface this binding needs; fakes implement it in tests. */
export interface DeviceMdnsUdpSocket {
  bind(port: number, callback: () => void): void
  send(message: Buffer, port: number, address: string): void
  addMembership(multicastAddress: string, interfaceAddress: string): void
  setMulticastInterface(interfaceAddress: string): void
  onMessage(listener: (message: Buffer, sender: { address: string }) => void): void
  onError(listener: (error: Error) => void): void
  close(callback?: () => void): void
}

function instanceName(serviceId: string): string {
  return `${INSTANCE_PREFIX}${serviceId.slice(0, INSTANCE_ID_CHARS)}.${SERVICE_TYPE}`
}

function responsePacket(serviceId: string, port: number): Buffer {
  const instance = instanceName(serviceId)
  return dnsPacket.encode({
    type: 'response',
    answers: [
      { type: 'PTR', name: SERVICE_TYPE, data: instance, ttl: RECORD_TTL_SECONDS },
      {
        type: 'SRV',
        name: instance,
        data: { port, target: instance, priority: 0, weight: 0 },
        ttl: RECORD_TTL_SECONDS,
      },
      {
        type: 'TXT',
        name: instance,
        data: [
          Buffer.from(`id=${serviceId}`),
          Buffer.from(`v=${String(DEVICE_LIMITS.protocolVersion)}`),
        ],
        ttl: RECORD_TTL_SECONDS,
      },
    ],
  })
}

function isServiceQuery(message: Buffer): boolean {
  try {
    const decoded = dnsPacket.decode(message)
    return (
      decoded.type === 'query' &&
      (decoded.questions ?? []).some(
        (question) => question.name === SERVICE_TYPE || question.name.endsWith(`.${SERVICE_TYPE}`),
      )
    )
  } catch {
    return false
  }
}

function textEntry(entry: string | Buffer): string | undefined {
  try {
    const text = typeof entry === 'string' ? entry : entry.toString('utf8')
    return text.length > 0 ? text : undefined
  } catch {
    return undefined
  }
}

/**
 * Picks only our advertisement fields from a decoded packet: the opaque
 * service id and version from a TXT record under our service type, with the
 * port from the SRV record on the same instance name. Extra records and TXT
 * entries are ignored, never parsed into the result. Throws a fixed word on
 * anything else; DeviceDiscovery treats that as silence.
 */
export function decodeDeviceMdnsPacket(message: Buffer): {
  serviceId: string
  port: number
  version: number
} {
  try {
    const decoded = dnsPacket.decode(message)
    const suffix = `.${SERVICE_TYPE}`
    const answers = decoded.answers ?? []
    for (const answer of answers) {
      if (answer.type !== 'TXT' || !answer.name.endsWith(suffix)) continue
      const entries = Array.isArray(answer.data) ? answer.data : [answer.data]
      let serviceId: string | undefined
      let version: number | undefined
      for (const entry of entries) {
        const text =
          typeof entry === 'string' || Buffer.isBuffer(entry) ? textEntry(entry) : undefined
        if (text === undefined) continue
        if (text.startsWith('id=')) serviceId = text.slice('id='.length)
        else if (text.startsWith('v=')) {
          const parsed = Number(text.slice('v='.length))
          if (Number.isSafeInteger(parsed)) version = parsed
        }
      }
      if (serviceId === undefined || version === undefined) continue
      const port = srvPort(answers, answer.name)
      if (port !== undefined) return { serviceId, port, version }
    }
  } catch {
    // Fall through to the fixed refusal below: never reflect peer bytes.
  }
  throw new Error('invalid-frame')
}

/**
 * The receiver port from the SRV record on the same instance name. The data
 * arrives as unknown at runtime regardless of the codec types, so the port is
 * read through unknown and accepted only as a safe integer.
 */
function srvPort(answers: readonly dnsPacket.Answer[], name: string): number | undefined {
  for (const answer of answers) {
    if (answer.type !== 'SRV' || answer.name !== name) continue
    const data: unknown = answer.data
    if (typeof data !== 'object' || data === null || !('port' in data)) continue
    const port: unknown = data.port
    if (typeof port === 'number' && Number.isSafeInteger(port)) return port
  }
  return undefined
}

function defaultSocket(): DeviceMdnsUdpSocket {
  const socket = createSocket({ type: 'udp4', reuseAddr: true })
  return {
    bind: (port, callback) => {
      socket.bind(port, callback)
    },
    send: (message, port, address) => {
      socket.send(message, port, address)
    },
    addMembership: (address, interfaceAddress) => {
      socket.addMembership(address, interfaceAddress)
    },
    setMulticastInterface: (interfaceAddress) => {
      socket.setMulticastInterface(interfaceAddress)
    },
    onMessage: (listener) => {
      socket.on('message', listener)
    },
    onError: (listener) => {
      socket.on('error', listener)
    },
    close: (callback) => {
      socket.close(callback)
    },
  }
}

/**
 * The production mDNS port: a UDP socket on the chosen interface answering
 * our service queries and announcing our advertisements. Tests inject a fake
 * socket; no test in this lane opens a real one.
 */
export function createDeviceMdnsPort(
  createUdpSocket: () => DeviceMdnsUdpSocket = defaultSocket,
): DeviceMdnsPort {
  return {
    async open(interfaceAddress, receive) {
      const socket = createUdpSocket()
      // Best-effort hints: send failures surface as silence here, never as
      // peer text. Startup failure rejects and DeviceDiscovery maps it to
      // the fixed blocked-or-unreachable recovery.
      let hasOpened = false
      const startup = new Promise<void>((resolve, reject) => {
        socket.onError((error) => {
          if (!hasOpened) reject(error)
        })
        try {
          socket.bind(MDNS_PORT, () => {
            try {
              socket.setMulticastInterface(interfaceAddress)
              socket.addMembership(MDNS_ADDRESS, interfaceAddress)
            } catch (error) {
              reject(error instanceof Error ? error : new Error('blocked-or-unreachable'))
              return
            }
            hasOpened = true
            resolve()
          })
        } catch (error) {
          reject(error instanceof Error ? error : new Error('blocked-or-unreachable'))
        }
      })
      await startup
      let current: { serviceId: string; port: number } | undefined
      const sendCurrent = (): void => {
        if (current === undefined) return
        try {
          socket.send(responsePacket(current.serviceId, current.port), MDNS_PORT, MDNS_ADDRESS)
        } catch {
          /* Best-effort announce; the next rotation retries. */
        }
      }
      socket.onMessage((message, sender) => {
        try {
          if (isServiceQuery(message)) sendCurrent()
          receive(message, sender.address)
        } catch {
          /* Ignore untrusted discovery data without reflecting its text. */
        }
      })
      return {
        advertise(advertisement): void {
          current = { serviceId: advertisement.serviceId, port: advertisement.port }
          sendCurrent()
        },
        close(): void {
          current = undefined
          try {
            socket.close()
          } catch {
            /* Closing an already-closed socket is not a failure. */
          }
        },
      }
    },
    decode(message: Buffer): unknown {
      return decodeDeviceMdnsPacket(message)
    },
  }
}
