// M110d lane X1: `node relay` forwards sealed envelopes between nodes over
// real loopback TCP. The relay never opens an envelope; a squatter cannot
// take a registered id; bad bytes and the operator's own ceilings refuse
// loudly; without ceilings nothing is refused.
import { afterEach, describe, expect, it } from 'vitest'
import { connectNodeRelay, type NodeRelayConnection } from '../../src/runtime/node/relay/client'
import {
  RelayFrameReader,
  encodeRelayFrame,
  relayServerFrameSchema,
} from '../../src/runtime/node/relay/protocol'
import {
  startNodeRelay,
  type NodeRelayCeilings,
  type StartedNodeRelay,
} from '../../src/runtime/node/relay/server'

const FRAME_CEILING = 1_000_000

const relays: StartedNodeRelay[] = []
const links: NodeRelayConnection[] = []

afterEach(async () => {
  for (const link of links.splice(0)) await link.close()
  for (const relay of relays.splice(0)) await relay.close()
})

async function startedRelay(ceilings?: NodeRelayCeilings) {
  const relay = await startNodeRelay(
    ceilings === undefined
      ? { maxFrameBytes: FRAME_CEILING }
      : { maxFrameBytes: FRAME_CEILING, ceilings },
  )
  relays.push(relay)
  return relay
}

async function linkedNode(relay: StartedNodeRelay, nodeId: string) {
  const link = await connectNodeRelay({
    host: '127.0.0.1',
    port: relay.port,
    nodeId,
    maxFrameBytes: FRAME_CEILING,
  })
  links.push(link)
  return link
}

/** Frames in arrival order; a missing frame fails the test instead of hanging it. */
function frameQueue(link: NodeRelayConnection) {
  const frames: unknown[] = []
  const waiters: ((frame: unknown) => void)[] = []
  link.onFrame((frame) => {
    const waiter = waiters.shift()
    if (waiter === undefined) frames.push(frame)
    else waiter(frame)
  })
  return {
    next(): Promise<unknown> {
      const frame = frames.shift()
      if (frame !== undefined) return Promise.resolve(frame)
      return new Promise<unknown>((resolve, reject) => {
        waiters.push(resolve)
        setTimeout(() => {
          reject(new Error('the relay never answered'))
        }, 4000)
      })
    },
  }
}

describe('node relay', () => {
  it('forwards a sealed envelope between two registered nodes, byte for byte', async () => {
    const relay = await startedRelay()
    const sender = await linkedNode(relay, 'node-a')
    const receiver = await linkedNode(relay, 'node-b')
    const incoming = frameQueue(receiver)
    const sealed = Buffer.from('sealed-by-the-pair-not-the-relay').toString('base64')
    expect(sender.send({ t: 'forward', to: 'node-b', sealed, sequence: 7 })).toBe(true)
    const delivered = relayServerFrameSchema.parse(await incoming.next())
    expect(delivered).toEqual({ t: 'deliver', from: 'node-a', sealed, sequence: 7 })
    expect(relay.stats().forwarded).toBe(1)
  })

  it('says unreachable for a ghost and refuses a squatted id', async () => {
    const relay = await startedRelay()
    const sender = await linkedNode(relay, 'node-a')
    const outgoing = frameQueue(sender)
    sender.send({ t: 'forward', to: 'ghost', sealed: 'eA==', sequence: 0 })
    expect(relayServerFrameSchema.parse(await outgoing.next())).toEqual({
      t: 'unreachable',
      to: 'ghost',
      reason: 'node is not on this relay',
    })
    await expect(linkedNode(relay, 'node-a')).rejects.toThrow('node is already on this relay')
  })

  it('refuses frames before registration and frames past the ceiling', async () => {
    const relay = await startedRelay()
    const { Socket } = await import('node:net')
    const sendRaw = async (payload: Buffer): Promise<readonly string[]> => {
      const refused: string[] = []
      const reader = new RelayFrameReader(FRAME_CEILING)
      const raw = new Socket()
      await new Promise<void>((done) => {
        raw.connect(relay.port, '127.0.0.1', done)
      })
      try {
        const closed = new Promise<void>((done) => {
          raw.on('close', () => {
            done()
          })
        })
        raw.on('data', (chunk: Buffer) => {
          const read = reader.push(chunk)
          if (read.ok)
            for (const frame of read.frames) {
              const parsed = relayServerFrameSchema.safeParse(frame)
              if (parsed.success && parsed.data.t === 'refused') refused.push(parsed.data.reason)
            }
        })
        raw.write(payload)
        await closed
      } finally {
        raw.destroy()
      }
      return refused
    }
    const early = await sendRaw(
      encodeRelayFrame({ t: 'forward', to: 'node-b', sealed: 'eA==', sequence: 0 }),
    )
    expect(early).toEqual(['register first'])
    const oversize = Buffer.alloc(32)
    oversize.writeUInt32BE(FRAME_CEILING + 1, 0)
    const big = await sendRaw(oversize)
    expect(big).toEqual(['frame exceeds the relay ceiling'])
  })

  it('names oversize and garbled bytes without opening them', () => {
    const reader = new RelayFrameReader(64)
    const header = Buffer.alloc(4)
    header.writeUInt32BE(65, 0)
    expect(reader.push(header)).toEqual({ ok: false, problem: 'oversize' })
    const garbled = new RelayFrameReader(64)
    const body = Buffer.from('not json', 'utf8')
    const frame = Buffer.alloc(4 + body.length)
    frame.writeUInt32BE(body.length, 0)
    body.copy(frame, 4)
    expect(garbled.push(frame)).toEqual({ ok: false, problem: 'unparseable' })
    expect(garbled.push(frame)).toEqual({ ok: false, problem: 'unparseable' })
    expect(reader.push(encodeRelayFrame({ t: 'close' }))).toEqual({
      ok: false,
      problem: 'oversize',
    })
  })

  it('enforces only the ceilings the operator sets', async () => {
    const relay = await startedRelay({ maxConnections: 1, maxBytesPerConnection: FRAME_CEILING })
    const first = await linkedNode(relay, 'node-a')
    await expect(linkedNode(relay, 'node-b')).rejects.toThrow('relay is full')
    expect(relay.stats().rejectedConnections).toBe(1)
    await first.close()
    expect(first.send({ t: 'close' })).toBe(false)
    const open = await startedRelay()
    await linkedNode(open, 'node-a')
    await linkedNode(open, 'node-b')
    expect(open.stats().rejectedConnections).toBe(0)
  })
})
