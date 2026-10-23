import { describe, expect, it } from 'vitest'
import {
  isNodePageError,
  nodeTerminalSocket,
  type NodeTerminalRawSocket,
} from '../../src/webview/bridges/nodePort'
import { UI_TEXT } from '../../src/shared/constants'
import { nodeTerminalClientFrameSchema } from '../../src/shared/node'
import { scripted } from './helpers/recordCalls'

const BEARER = 'b'.repeat(43)

type RawListener = (event: { readonly data?: unknown }) => void

/** A scripted WebSocket: the test fires its events and reads its frames. */
function fakeSocket() {
  const listeners = new Map<string, Set<RawListener>>()
  const sent: string[] = []
  let closed = 0
  let failure: Error | undefined
  const fire = (type: string, event: { readonly data?: unknown }) => {
    const group = listeners.get(type) ?? []
    for (const listener of group) listener(event)
  }
  const socket: NodeTerminalRawSocket = {
    send(data: string) {
      if (failure !== undefined) throw failure
      sent.push(data)
    },
    close() {
      closed += 1
      fire('close', {})
    },
    addEventListener(type: string, listener: RawListener) {
      let group = listeners.get(type)
      if (group === undefined) {
        group = new Set()
        listeners.set(type, group)
      }
      group.add(listener)
    },
    removeEventListener(type: string, listener: RawListener) {
      listeners.get(type)?.delete(listener)
    },
  }
  return {
    socket,
    sent,
    fire,
    closed: () => closed,
    failSendWith: (error: Error) => {
      failure = error
    },
  }
}

function fixture() {
  let bearer: string | undefined = BEARER
  const sockets: ReturnType<typeof fakeSocket>[] = []
  const openSocket = scripted<[string], NodeTerminalRawSocket>((url) => {
    expect(url).toBe('wss://node.local:7443/node/terminal/stream')
    const fake = fakeSocket()
    sockets.push(fake)
    return fake.socket
  })
  return {
    sockets,
    openSocket,
    connect: nodeTerminalSocket({
      origin: 'https://node.local:7443',
      bearer: () => bearer,
      openSocket,
    }),
    signOut: () => {
      bearer = undefined
    },
  }
}

describe('node terminal socket', () => {
  it('opens the stream route, authenticates first, and closes clean', async () => {
    const { connect, sockets, openSocket } = fixture()
    const pending = connect('t1')
    expect(openSocket.calls).toHaveLength(1)
    // The URL carries no credential: the bearer rides the first frame.
    expect(openSocket.calls[0]?.[0]).not.toContain(BEARER)
    sockets[0]?.fire('open', {})
    const wire = await pending
    expect(
      sockets[0]?.sent.map((frame) => nodeTerminalClientFrameSchema.parse(JSON.parse(frame))),
    ).toEqual([{ type: 'auth', bearer: BEARER, terminalId: 't1' }])
    const seen: string[] = []
    let ended = 0
    wire.onMessage((data) => {
      seen.push(data)
    })
    wire.onClose(() => {
      ended += 1
    })
    sockets[0]?.fire('message', { data: '{"type":"terminalOutput"}' })
    expect(seen).toEqual(['{"type":"terminalOutput"}'])
    wire.send(JSON.stringify({ type: 'input', data: 'x' }))
    expect(sockets[0]?.sent).toHaveLength(2)
    wire.close()
    expect(sockets[0]?.closed()).toBe(1)
    sockets[0]?.fire('message', { data: 'late' })
    expect(seen).toHaveLength(1)
    expect(ended).toBe(0)
    // Closing twice, or sending after the close, ends quietly.
    wire.close()
    wire.send('late')
    expect(sockets[0]?.closed()).toBe(1)
  })

  it.each([
    ['http:', '//node.local'].join(''),
    'https://node.local/path',
    'https://user:password@node.local',
    'https://node.local?token=bad',
  ])('refuses noncanonical origin %s', (origin) => {
    expect(() =>
      nodeTerminalSocket({
        origin,
        bearer: () => BEARER,
        openSocket: () => {
          throw new Error('must not open')
        },
      }),
    ).toThrow(UI_TEXT.nodeErrors.forbidden)
  })

  it('refuses without a bearer before any socket opens', async () => {
    const { connect, openSocket, signOut } = fixture()
    signOut()
    let failure: unknown
    try {
      await connect('t1')
    } catch (error: unknown) {
      failure = error
    }
    expect(isNodePageError(failure)).toBe(true)
    expect(openSocket.calls).toHaveLength(0)
  })

  it('rejects typed when the socket fails or the server refuses it', async () => {
    const errored = fixture()
    const failed = errored.connect('t1')
    errored.sockets[0]?.fire('error', {})
    await expect(failed).rejects.toThrow(UI_TEXT.nodeErrors.unavailable)
    expect(errored.sockets[0]?.closed()).toBe(1)

    const refused = fixture()
    const denied = refused.connect('t1')
    refused.sockets[0]?.fire('close', {})
    await expect(denied).rejects.toThrow(UI_TEXT.nodeErrors.unavailable)
  })

  it('ends the stream on a non-text frame or a failed send', async () => {
    const binary = fixture()
    const first = binary.connect('t1')
    binary.sockets[0]?.fire('open', {})
    const wire = await first
    let ended = 0
    wire.onClose(() => {
      ended += 1
    })
    binary.sockets[0]?.fire('message', { data: new Uint8Array([1, 2]) })
    expect(binary.sockets[0]?.closed()).toBe(1)
    expect(ended).toBe(1)

    const broken = fixture()
    const second = broken.connect('t1')
    broken.sockets[0]?.fire('open', {})
    const sending = await second
    let closed = 0
    sending.onClose(() => {
      closed += 1
    })
    broken.sockets[0]?.failSendWith(new DOMException('gone', 'NetworkError'))
    sending.send('lost')
    expect(broken.sockets[0]?.closed()).toBe(1)
    expect(closed).toBe(1)
  })

  it('rethrows a send failure that is not a DOM failure', async () => {
    const { connect, sockets } = fixture()
    const pending = connect('t1')
    sockets[0]?.fire('open', {})
    const wire = await pending
    const bug = new Error('socket bug')
    sockets[0]?.failSendWith(bug)
    expect(() => {
      wire.send('x')
    }).toThrow(bug)
  })
})
