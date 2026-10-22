// Lane D: the DNS-SD binding behind DeviceDiscovery's injected mDNS port.
// Advertising carries only an opaque rotating service id, the receiver port
// and the protocol version — never an OS hostname, account, repository,
// model or stable device name. The SRV target is the opaque instance name
// itself: the peer address always comes from the UDP sender, which T
// revalidates while retaining the saved mutual-TLS identity. Discovery
// supplies address hints only; a hint never replaces a saved peer pin.
//
// The codec below is deliberately minimal and dependency-free: it writes
// only the three records this binding announces (PTR/SRV/TXT) and reads
// only those shapes back, answering service queries from others. Anything
// else on the multicast group — printers, foreign services, garbage — is
// skipped or refused with a fixed word, never reflected. Bounds below are
// DNS format guards (label, name, pointer and count limits), not tunables.
import { createSocket } from 'node:dgram'
import { DEVICE_LIMITS } from '../../shared/constants'
import type { DeviceDiscoveryStatus, DeviceMdnsPort } from './deviceDiscovery'

// Fixed mDNS wire words, not tunables: the IANA multicast group and port,
// our DNS-SD service type, and the record TTL. The TTL outlives two
// advertisement rotations so a missed announce never reads as withdrawn.
const MDNS_ADDRESS = '224.0.0.251'
const MDNS_PORT = 5353
const SERVICE_TYPE = '_musespark._tcp.local'
const RECORD_TTL_SECONDS = 120
const INSTANCE_PREFIX = 'd-'
const INSTANCE_ID_CHARS = 12
// DNS format words and guards, not tunables: header/record layouts, label,
// name, pointer-chain and record-count limits. A packet past any guard
// refuses as a whole.
const HEADER_BYTES = 12
const FLAGS_OFFSET = 2
const QDCOUNT_OFFSET = 4
const ANCOUNT_OFFSET = 6
const NSCOUNT_OFFSET = 8
const ARCOUNT_OFFSET = 10
const QUESTION_FIXED_BYTES = 4
const RECORD_FIXED_BYTES = 10
const RDLENGTH_OFFSET = 8
const SRV_FIXED_BYTES = 6
const SRV_PORT_OFFSET = 4
const U16_BYTES = 2
const U32_BYTES = 4
const MAX_LABEL_CHARS = 63
const MAX_NAME_CHARS = 255
const MAX_POINTER_JUMPS = 8
const MAX_RECORDS = 64
const POINTER_MASK = 0xc0
const POINTER_TARGET_MASK = 0x3f
const POINTER_OFFSET_BITS = 8
const FLAG_RESPONSE = 0x80_00
const RESPONSE_FLAGS = 0x84_00
const CLASS_IN = 1
const CLASS_CACHE_FLUSH = 0x80_00
const TYPE_PTR = 12
const TYPE_SRV = 33
const TYPE_TXT = 16
const ANNOUNCE_ANSWER_COUNT = 3

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

function isOurs(name: string): boolean {
  const lower = name.toLowerCase()
  return lower === SERVICE_TYPE || lower.endsWith(`.${SERVICE_TYPE}`)
}

function writeU16(value: number): Buffer {
  const bytes = Buffer.alloc(U16_BYTES)
  bytes.writeUInt16BE(value, 0)
  return bytes
}

function writeU32(value: number): Buffer {
  const bytes = Buffer.alloc(U32_BYTES)
  bytes.writeUInt32BE(value, 0)
  return bytes
}

function writeName(name: string): Buffer {
  const parts: Buffer[] = []
  for (const label of name.split('.')) {
    const bytes = Buffer.from(label, 'utf8')
    if (bytes.length === 0 || bytes.length > MAX_LABEL_CHARS) throw new Error('invalid-frame')
    parts.push(Buffer.from([bytes.length]), bytes)
  }
  parts.push(Buffer.from([0]))
  return Buffer.concat(parts)
}

function readU16(packet: Buffer, offset: number): number {
  if (offset < 0 || offset + U16_BYTES > packet.length) throw new Error('invalid-frame')
  return packet.readUInt16BE(offset)
}

/** Reads a possibly compressed name; `next` is the offset past the name. */
function readName(packet: Buffer, offset: number): { name: string; next: number } {
  const labels: string[] = []
  let current = offset
  let prefixBytes = 0
  let hasJumped = false
  let jumps = 0
  for (;;) {
    if (current < 0 || current >= packet.length) throw new Error('invalid-frame')
    const length = packet[current] ?? 0
    if ((length & POINTER_MASK) === POINTER_MASK) {
      if (current + 1 >= packet.length) throw new Error('invalid-frame')
      const target =
        ((length & POINTER_TARGET_MASK) << POINTER_OFFSET_BITS) | (packet.at(current + 1) ?? 0)
      if (target >= packet.length) throw new Error('invalid-frame')
      if (!hasJumped) {
        prefixBytes = current + U16_BYTES - offset
        hasJumped = true
      }
      current = target
      jumps += 1
      if (jumps > MAX_POINTER_JUMPS) throw new Error('invalid-frame')
      continue
    }
    if (length > MAX_LABEL_CHARS) throw new Error('invalid-frame')
    if (length === 0) {
      const name = labels.join('.')
      if (name.length > MAX_NAME_CHARS) throw new Error('invalid-frame')
      return { name, next: hasJumped ? offset + prefixBytes : current + 1 }
    }
    if (current + 1 + length > packet.length) throw new Error('invalid-frame')
    labels.push(packet.subarray(current + 1, current + 1 + length).toString('latin1'))
    current += 1 + length
  }
}

interface DnsRecord {
  readonly name: string
  readonly type: number
  readonly data: Buffer
  /** The whole message: compressed names decode against message offsets. */
  readonly message: Buffer
  /** Absolute offset of this record's RDATA inside `message`. */
  readonly dataOffset: number
}

function decodeRecords(message: Buffer): {
  isResponse: boolean
  questions: string[]
  records: DnsRecord[]
} {
  if (message.length < HEADER_BYTES) throw new Error('invalid-frame')
  const flags = readU16(message, FLAGS_OFFSET)
  const counts = [
    readU16(message, QDCOUNT_OFFSET),
    readU16(message, ANCOUNT_OFFSET),
    readU16(message, NSCOUNT_OFFSET),
    readU16(message, ARCOUNT_OFFSET),
  ]
  if (counts.some((count) => count > MAX_RECORDS)) throw new Error('invalid-frame')
  const questions: string[] = []
  const records: DnsRecord[] = []
  let offset = HEADER_BYTES
  const questionCount = counts[0] ?? 0
  for (let index = 0; index < questionCount; index += 1) {
    const parsed = readName(message, offset)
    offset = parsed.next
    if (offset + QUESTION_FIXED_BYTES > message.length) throw new Error('invalid-frame')
    offset += QUESTION_FIXED_BYTES
    questions.push(parsed.name)
  }
  // Walk every section so offsets stay honest. Answers and Additional records
  // are kept: a standard DNS-SD response carries PTR in Answers with its
  // matching SRV/TXT in Additional. Authority records only position the
  // section that follows.
  const sections = [
    { keep: true, count: counts[1] ?? 0 },
    { keep: false, count: counts[2] ?? 0 },
    { keep: true, count: counts[3] ?? 0 },
  ]
  for (const section of sections) {
    for (let index = 0; index < section.count; index += 1) {
      const parsed = readName(message, offset)
      offset = parsed.next
      if (offset + RECORD_FIXED_BYTES > message.length) throw new Error('invalid-frame')
      const type = readU16(message, offset)
      const recordClass = readU16(message, offset + U16_BYTES)
      const dataLength = readU16(message, offset + RDLENGTH_OFFSET)
      offset += RECORD_FIXED_BYTES
      if (offset + dataLength > message.length) throw new Error('invalid-frame')
      if (section.keep && (recordClass & ~CLASS_CACHE_FLUSH) === CLASS_IN)
        records.push({
          name: parsed.name,
          type,
          data: message.subarray(offset, offset + dataLength),
          message,
          dataOffset: offset,
        })
      offset += dataLength
    }
  }
  return { isResponse: (flags & FLAG_RESPONSE) !== 0, questions, records }
}

function writeRecord(name: string, type: number, data: Buffer, isCacheFlush: boolean): Buffer {
  return Buffer.concat([
    writeName(name),
    writeU16(type),
    writeU16(isCacheFlush ? CLASS_IN | CLASS_CACHE_FLUSH : CLASS_IN),
    writeU32(RECORD_TTL_SECONDS),
    writeU16(data.length),
    data,
  ])
}

function responsePacket(serviceId: string, port: number): Buffer {
  const instance = instanceName(serviceId)
  const srv = Buffer.concat([writeU16(0), writeU16(0), writeU16(port), writeName(instance)])
  const txt = Buffer.concat(
    [`id=${serviceId}`, `v=${String(DEVICE_LIMITS.protocolVersion)}`].map((entry) => {
      const bytes = Buffer.from(entry, 'utf8')
      return Buffer.concat([Buffer.from([bytes.length]), bytes])
    }),
  )
  return Buffer.concat([
    writeU16(0),
    writeU16(RESPONSE_FLAGS),
    writeU16(0),
    writeU16(ANNOUNCE_ANSWER_COUNT),
    writeU16(0),
    writeU16(0),
    writeRecord(SERVICE_TYPE, TYPE_PTR, writeName(instance), false),
    writeRecord(instance, TYPE_SRV, srv, true),
    writeRecord(instance, TYPE_TXT, txt, true),
  ])
}

function isServiceQuery(message: Buffer): boolean {
  try {
    const decoded = decodeRecords(message)
    return !decoded.isResponse && decoded.questions.some((name) => isOurs(name))
  } catch {
    return false
  }
}

function textEntries(data: Buffer): string[] {
  const entries: string[] = []
  let offset = 0
  while (offset < data.length) {
    const length = data[offset] ?? 0
    offset += 1
    if (offset + length > data.length) return entries
    entries.push(data.subarray(offset, offset + length).toString('utf8'))
    offset += length
  }
  return entries
}

/**
Picks only our advertisement fields from a packet: the opaque service id
and version from a TXT record under our service type, with the port from
the SRV record on the same instance name. Extra records and TXT entries
are ignored, never parsed into the result. Throws a fixed word on
anything else; DeviceDiscovery treats that as silence.
*/
export function decodeDeviceMdnsPacket(message: Buffer): {
  serviceId: string
  port: number
  version: number
} {
  try {
    const decoded = decodeRecords(message)
    if (!decoded.isResponse) throw new Error('invalid-frame')
    for (const answer of decoded.records) {
      if (answer.type !== TYPE_TXT || !isOurs(answer.name)) continue
      let serviceId: string | undefined
      let version: number | undefined
      for (const entry of textEntries(answer.data)) {
        if (entry.startsWith('id=')) serviceId = entry.slice('id='.length)
        else if (entry.startsWith('v=')) {
          const parsed = Number(entry.slice('v='.length))
          if (Number.isSafeInteger(parsed)) version = parsed
        }
      }
      if (serviceId === undefined || version === undefined) continue
      const port = srvPort(decoded.records, answer.name)
      if (port !== undefined) return { serviceId, port, version }
    }
  } catch {
    // Fall through to the fixed refusal below: never reflect peer bytes.
  }
  throw new Error('invalid-frame')
}

/**
The receiver port from the SRV record on the same instance name. The SRV
target is decoded against the whole message: a compressed target is a
pointer into earlier message bytes, never into the detached RDATA.
*/
function srvPort(records: readonly DnsRecord[], name: string): number | undefined {
  for (const record of records) {
    if (
      record.type !== TYPE_SRV ||
      record.name.toLowerCase() !== name.toLowerCase() ||
      record.data.length < SRV_FIXED_BYTES
    )
      continue
    const port = record.data.readUInt16BE(SRV_PORT_OFFSET)
    if (port >= 1 && port <= DEVICE_LIMITS.portMax) {
      // The target rides along for structure only; the peer address always
      // comes from the UDP sender, never from this name.
      try {
        readName(record.message, record.dataOffset + SRV_FIXED_BYTES)
      } catch {
        continue
      }
      return port
    }
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
The production mDNS port: a UDP socket on the chosen interface answering
our service queries and announcing our advertisements. Tests inject a fake
socket; no test in this lane opens a real one.
*/
export function createDeviceMdnsPort(
  createUdpSocket: () => DeviceMdnsUdpSocket = defaultSocket,
): DeviceMdnsPort {
  return {
    async open(interfaceAddress, receive) {
      const socket = createUdpSocket()
      // Socket health: any UDP failure closes the socket, publishes the
      // owned blocked-or-unreachable status, and fails later sends with the
      // same fixed word, never with socket or peer text. DeviceDiscovery
      // subscribes to that status (startup and rotations alike) and the
      // switch shows exactly what it says.
      let isClosed = false
      let hasFailed = false
      const statusListeners = new Set<(status: DeviceDiscoveryStatus) => void>()
      const notifyBlocked = (): void => {
        const blocked: DeviceDiscoveryStatus = {
          state: 'blocked-or-unreachable',
          reason: 'blocked-or-unreachable',
        }
        for (const listener of statusListeners) {
          try {
            listener(blocked)
          } catch {
            /* A status listener never breaks the socket. */
          }
        }
      }
      const hush = (): void => {
        if (isClosed) return
        isClosed = true
        try {
          socket.close()
        } catch {
          /* Closing an already-closed socket is not a failure. */
        }
      }
      const fail = (): Error => {
        hasFailed = true
        hush()
        notifyBlocked()
        return new Error('blocked-or-unreachable')
      }
      let hasOpened = false
      const startup = new Promise<void>((resolve, reject) => {
        socket.onError(() => {
          if (!hasOpened) {
            // A startup-window socket error rejects open; the socket it
            // created is closed, so retries leak nothing.
            reject(fail())
            return
          }
          if (!isClosed) fail()
        })
        try {
          socket.bind(MDNS_PORT, () => {
            try {
              socket.setMulticastInterface(interfaceAddress)
              socket.addMembership(MDNS_ADDRESS, interfaceAddress)
            } catch {
              reject(fail())
              return
            }
            hasOpened = true
            resolve()
          })
        } catch {
          reject(fail())
        }
      })
      await startup
      let current: { serviceId: string; port: number } | undefined
      // Query answers share discovery's packet budget: at most queuedFrames
      // responses per advertisement rotation, only while an advertisement is
      // current (discovery advertises and clears it under its policy).
      let queryAnswers = 0
      const sendCurrent = (): void => {
        if (hasFailed) throw new Error('blocked-or-unreachable')
        if (current === undefined) return
        try {
          socket.send(responsePacket(current.serviceId, current.port), MDNS_PORT, MDNS_ADDRESS)
        } catch {
          throw fail()
        }
      }
      const answerQuery = (): void => {
        if (hasFailed || current === undefined || queryAnswers >= DEVICE_LIMITS.queuedFrames) return
        queryAnswers += 1
        sendCurrent()
      }
      socket.onMessage((message, sender) => {
        try {
          if (isServiceQuery(message)) answerQuery()
          receive(message, sender.address)
        } catch {
          /* Ignore untrusted discovery data without reflecting its text. */
        }
      })
      return {
        advertise(advertisement): void {
          current = { serviceId: advertisement.serviceId, port: advertisement.port }
          queryAnswers = 0
          sendCurrent()
        },
        close(): void {
          current = undefined
          hush()
        },
        onStatus(listener: (status: DeviceDiscoveryStatus) => void): () => void {
          statusListeners.add(listener)
          return () => {
            statusListeners.delete(listener)
          }
        },
      }
    },
    decode(message: Buffer): unknown {
      return decodeDeviceMdnsPacket(message)
    },
  }
}
