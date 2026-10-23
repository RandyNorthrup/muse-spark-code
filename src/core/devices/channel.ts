import * as z from 'zod/mini'
import { devicePresenceRelaySchema } from './actionGrants'
import { DEVICE_LIMITS } from '../../shared/constants'
import {
  DEVICE_STREAMS,
  deviceReadySchema,
  deviceChannelSchema,
  deviceFrameSchema,
  deviceCapabilitySchema,
  deviceGrantRequestSchema,
  deviceGrantSchema,
  deviceGrantRefusalSchema,
  deviceResultEnvelopeSchema,
  deviceResultAckSchema,
  type DeviceReady,
  type DeviceStream,
} from '../../shared/devices'

// Product-owned carriage, not an upstream model protocol. Inner envelopes
// remain lane 0's strict schemas. The log lane carries bounded untrusted text;
// authorization and scrubbing still belong to the receiving application.
const messageSchema = z.union([
  deviceChannelSchema,
  // Lane A's sole added carriage member; control is the default stream.
  z.strictObject({ kind: z.literal('presenceRelay'), relay: devicePresenceRelaySchema }),
  z.strictObject({ kind: z.literal('frame'), frame: deviceFrameSchema }),
  z.strictObject({ kind: z.literal('capability'), capability: deviceCapabilitySchema }),
  z.strictObject({ kind: z.literal('grantRequest'), request: deviceGrantRequestSchema }),
  z.strictObject({ kind: z.literal('grant'), grant: deviceGrantSchema }),
  z.strictObject({ kind: z.literal('grantRefusal'), refusal: deviceGrantRefusalSchema }),
  z.strictObject({ kind: z.literal('result'), result: deviceResultEnvelopeSchema }),
  z.strictObject({ kind: z.literal('resultAck'), ack: deviceResultAckSchema }),
  z.strictObject({
    kind: z.literal('log'),
    text: z.string(),
  }),
])
export type MultiplexedDeviceMessage = z.infer<typeof messageSchema>

const sequence = z.int().check(z.gte(1))
const packetIdentity = {
  version: deviceReadySchema.shape.version,
  pairId: deviceReadySchema.shape.pairId,
  receiverIncarnationId: deviceReadySchema.shape.receiverIncarnationId,
  stream: z.enum(DEVICE_STREAMS),
  sequence,
}
const packetSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...packetIdentity,
    kind: z.literal('data'),
    part: z.int().check(z.gte(0), z.lte(DEVICE_LIMITS.frameFragments - 1)),
    final: z.boolean(),
    text: z.string().check(z.minLength(1), z.maxLength(DEVICE_LIMITS.channelFrameBytes)),
  }),
  z.strictObject({ ...packetIdentity, kind: z.literal('ack') }),
])
type Packet = z.infer<typeof packetSchema>
type DataPacket = Extract<Packet, { kind: 'data' }>

export interface DeviceChannelDelivery {
  readonly stream: DeviceStream
  readonly sequence: number
  readonly message: MultiplexedDeviceMessage
}

interface Outgoing {
  sequence: number
  text: string
  offset: number
  part: number
}
interface StreamState {
  outgoing: Outgoing[]
  sent: number
  acknowledged: number
  next: number
  incoming: DeviceChannelDelivery[]
  running: DeviceChannelDelivery | undefined
  received: number
  completed: number
  assembly: { sequence: number; parts: number; bytes: number; text: string } | undefined
  ack: number | undefined
}

const encoder = new TextEncoder()
const newline = encoder.encode('\n')[0] ?? 0
function bytesOf(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength
}

function streamFor(message: MultiplexedDeviceMessage): DeviceStream {
  switch (message.kind) {
    case 'log': {
      return 'logs'
    }
    case 'capability': {
      return 'status'
    }
    case 'grantRequest':
    case 'result': {
      return 'events'
    }
    case 'frame': {
      switch (message.frame.body.kind) {
        case 'artifact':
        case 'artifactChunk': {
          return 'bulk'
        }
        case 'offers': {
          return 'status'
        }
        case 'dispatch':
        case 'outcome':
        case 'tombstone':
        case 'reconciled':
        case 'checkReport': {
          return 'events'
        }
        default: {
          return 'control'
        }
      }
    }
    default: {
      return 'control'
    }
  }
}

// All allocations are bounded before decoding/parsing. A message may span
// small packets, allowing control to preempt bulk between socket writes.
// Queue occupancy includes partially sent, unacknowledged and running work.
export class MultiplexedDeviceChannel {
  private readonly streams = new Map<DeviceStream, StreamState>(
    DEVICE_STREAMS.map((stream) => [
      stream,
      {
        outgoing: [],
        sent: 0,
        acknowledged: 0,
        next: 1,
        incoming: [],
        running: undefined,
        received: 0,
        completed: 0,
        assembly: undefined,
        ack: undefined,
      },
    ]),
  )
  private pending = new Uint8Array(0)
  private fragments = 0
  private isClosed = false
  readonly identity: DeviceReady

  constructor(identity: DeviceReady) {
    this.identity = deviceReadySchema.parse(identity)
    if (
      new Set(identity.streams).size !== identity.streams.length ||
      DEVICE_STREAMS.some((stream) => !identity.streams.includes(stream))
    )
      throw new Error('invalid-frame')
  }

  private state(stream: DeviceStream): StreamState {
    const state = this.streams.get(stream)
    if (state === undefined || this.isClosed) throw new Error('revoked')
    return state
  }

  private occupancy(stream: DeviceStream, isIncoming: boolean): number {
    let count = 0
    for (const [key, state] of this.streams) {
      if ((key === 'control') !== (stream === 'control')) continue
      count += isIncoming
        ? state.incoming.length +
          Number(state.running !== undefined) +
          Number(state.assembly !== undefined)
        : state.outgoing.length
    }
    return count
  }

  private checkedMessage(input: unknown): MultiplexedDeviceMessage {
    if (bytesOf(input) > DEVICE_LIMITS.frameBytes) throw new Error('invalid-frame')
    const message = messageSchema.parse(input)
    let pairId = this.identity.pairId
    let incarnation = this.identity.receiverIncarnationId
    let limit: number = DEVICE_LIMITS.frameBytes
    switch (message.kind) {
      case 'ready': {
        pairId = message.ready.pairId
        incarnation = message.ready.receiverIncarnationId
        if (
          new Set(message.ready.streams).size !== DEVICE_STREAMS.length ||
          DEVICE_STREAMS.some((stream) => !message.ready.streams.includes(stream))
        )
          throw new Error('invalid-frame')
        limit = DEVICE_LIMITS.channelFrameBytes
        break
      }
      case 'heartbeat': {
        pairId = message.heartbeat.pairId
        incarnation = message.heartbeat.receiverIncarnationId
        limit = DEVICE_LIMITS.channelFrameBytes
        break
      }
      case 'throttled': {
        pairId = message.throttled.pairId
        incarnation = message.throttled.receiverIncarnationId ?? incarnation
        limit = DEVICE_LIMITS.channelFrameBytes
        break
      }
      case 'frame': {
        pairId = message.frame.pairId
        incarnation = message.frame.receiverIncarnationId
        break
      }
      case 'capability': {
        incarnation = message.capability.receiverIncarnationId
        limit = DEVICE_LIMITS.capabilityBytes
        break
      }
      case 'presenceRelay': {
        pairId = message.relay.pairId
        limit = DEVICE_LIMITS.grantBytes
        break
      }
      case 'grantRequest': {
        pairId = message.request.pairId
        limit = DEVICE_LIMITS.grantBytes
        break
      }
      case 'grant': {
        pairId = message.grant.pairId
        limit = DEVICE_LIMITS.grantBytes
        break
      }
      case 'grantRefusal': {
        pairId = message.refusal.pairId
        limit = DEVICE_LIMITS.grantBytes
        break
      }
      case 'result': {
        pairId = message.result.identity.pairId
        incarnation = message.result.identity.receiverIncarnationId
        limit = DEVICE_LIMITS.resultEnvelopeBytes
        break
      }
      case 'resultAck': {
        pairId = message.ack.identity.pairId
        incarnation = message.ack.identity.receiverIncarnationId
        limit = DEVICE_LIMITS.resultEnvelopeBytes
        break
      }
      case 'log': {
        break
      }
    }
    if (
      pairId !== this.identity.pairId ||
      incarnation !== this.identity.receiverIncarnationId ||
      bytesOf(message) > limit
    )
      throw new Error('invalid-frame')
    return message
  }

  private packet(packet: Packet): Uint8Array {
    return encoder.encode(JSON.stringify(packetSchema.parse(packet)) + '\n')
  }

  private header(stream: DeviceStream, sequenceNumber: number) {
    return {
      version: this.identity.version,
      pairId: this.identity.pairId,
      receiverIncarnationId: this.identity.receiverIncarnationId,
      stream,
      sequence: sequenceNumber,
    }
  }

  private receivePacket(packet: DataPacket, state: StreamState): void {
    if (state.assembly === undefined) {
      const cap =
        packet.stream === 'control' ? DEVICE_LIMITS.controlFrames : DEVICE_LIMITS.queuedFrames
      if (
        packet.part !== 0 ||
        packet.sequence !== state.received + 1 ||
        this.occupancy(packet.stream, true) >= cap
      )
        throw new Error('capacity')
      state.assembly = { sequence: packet.sequence, parts: 0, bytes: 0, text: '' }
    }
    const assembly = state.assembly
    if (
      packet.sequence !== assembly.sequence ||
      packet.part !== assembly.parts ||
      assembly.bytes + encoder.encode(packet.text).byteLength > DEVICE_LIMITS.frameBytes
    )
      throw new Error('invalid-frame')
    assembly.bytes += encoder.encode(packet.text).byteLength
    assembly.text += packet.text
    assembly.parts += 1
    if (!packet.final) return
    const input: unknown = JSON.parse(assembly.text)
    const message = this.checkedMessage(input)
    if (JSON.stringify(message) !== assembly.text || streamFor(message) !== packet.stream)
      throw new Error('invalid-frame')
    state.received = packet.sequence
    state.incoming.push({ stream: packet.stream, sequence: packet.sequence, message })
    state.assembly = undefined
  }

  get incomplete(): boolean {
    if (this.pending.byteLength > 0) return true
    for (const state of this.streams.values()) if (state.assembly !== undefined) return true
    return false
  }

  // False is pressure, never an empty successful send. Control has its own
  // reserve and cannot be demoted by a caller choosing the bulk stream.
  enqueue(input: MultiplexedDeviceMessage): boolean {
    const message = this.checkedMessage(input)
    const stream = streamFor(message)
    const state = this.state(stream)
    const cap = stream === 'control' ? DEVICE_LIMITS.controlFrames : DEVICE_LIMITS.queuedFrames
    if (this.occupancy(stream, false) >= cap) return false
    if (!Number.isSafeInteger(state.next + 1)) throw new TypeError('capacity')
    state.outgoing.push({
      sequence: state.next++,
      text: JSON.stringify(message),
      offset: 0,
      part: 0,
    })
    return true
  }

  nextPacket(): Uint8Array | undefined {
    for (const stream of DEVICE_STREAMS) {
      const state = this.state(stream)
      if (state.ack !== undefined) {
        const packet = this.packet({ ...this.header(stream, state.ack), kind: 'ack' })
        state.ack = undefined
        return packet
      }
    }
    for (const stream of DEVICE_STREAMS) {
      const state = this.state(stream)
      const item = state.outgoing.find((entry) => entry.offset < entry.text.length)
      if (item === undefined) continue
      const header = {
        ...this.header(stream, item.sequence),
        kind: 'data' as const,
        part: item.part,
      }
      let length = Math.min(item.text.length - item.offset, DEVICE_LIMITS.channelFrameBytes)
      let packet = this.packet({
        ...header,
        final: item.offset + length === item.text.length,
        text: item.text.slice(item.offset, item.offset + length),
      })
      while (packet.byteLength > DEVICE_LIMITS.channelFrameBytes) {
        length = Math.floor(length / 2)
        if (length === 0) throw new Error('invalid-frame')
        packet = this.packet({
          ...header,
          final: item.offset + length === item.text.length,
          text: item.text.slice(item.offset, item.offset + length),
        })
      }
      item.offset += length
      item.part += 1
      if (item.part > DEVICE_LIMITS.frameFragments) throw new Error('capacity')
      if (item.offset === item.text.length) state.sent = item.sequence
      return packet
    }
    return undefined
  }

  push(chunk: Uint8Array): void {
    let offset = 0
    while (offset < chunk.byteLength) {
      const end = chunk.indexOf(newline, offset)
      const until = end === -1 ? chunk.byteLength : end
      const length = this.pending.byteLength + until - offset
      if (
        length + 1 > DEVICE_LIMITS.channelFrameBytes ||
        ++this.fragments > DEVICE_LIMITS.frameFragments
      )
        throw new Error('invalid-frame')
      const joined = new Uint8Array(length)
      joined.set(this.pending)
      joined.set(chunk.subarray(offset, until), this.pending.byteLength)
      this.pending = joined
      if (end === -1) return
      const text = new TextDecoder('utf-8', { fatal: true }).decode(this.pending)
      const input: unknown = JSON.parse(text)
      const packet = packetSchema.parse(input)
      // Canonical encoding also rejects duplicate/escaped JSON keys before
      // they can be silently discarded by JSON.parse.
      if (
        JSON.stringify(packet) !== text ||
        packet.pairId !== this.identity.pairId ||
        packet.receiverIncarnationId !== this.identity.receiverIncarnationId
      )
        throw new Error('invalid-frame')
      this.pending = new Uint8Array(0)
      this.fragments = 0
      const state = this.state(packet.stream)
      if (packet.kind === 'ack') {
        if (packet.sequence > state.sent) throw new Error('invalid-frame')
        if (packet.sequence > state.acknowledged) {
          state.acknowledged = packet.sequence
          state.outgoing = state.outgoing.filter((item) => item.sequence > packet.sequence)
        }
      } else this.receivePacket(packet, state)
      offset = until + 1
    }
  }

  takeIncoming(isControl: boolean): DeviceChannelDelivery | undefined {
    for (const stream of DEVICE_STREAMS) {
      if ((stream === 'control') !== isControl) continue
      const state = this.state(stream)
      if (state.running !== undefined) continue
      const delivery = state.incoming.shift()
      if (delivery !== undefined) {
        state.running = delivery
        return delivery
      }
    }
    return undefined
  }

  complete(delivery: DeviceChannelDelivery): void {
    const state = this.state(delivery.stream)
    if (state.running !== delivery || delivery.sequence !== state.completed + 1)
      throw new Error('invalid-frame')
    state.running = undefined
    state.completed = delivery.sequence
    state.ack = delivery.sequence
  }

  close(): void {
    this.isClosed = true
    this.pending = new Uint8Array(0)
    this.streams.clear()
  }
}
