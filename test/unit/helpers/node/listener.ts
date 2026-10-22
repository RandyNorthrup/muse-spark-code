import { vi } from 'vitest'
import { Duplex } from 'node:stream'
import { IncomingMessage } from 'node:http'
import { Socket } from 'node:net'
import { performance } from 'node:perf_hooks'
import type { NodeMethodPort } from '../../../../src/shared/hostApi/nodeMethods'
import type { NodeListenerOptions } from '../../../../src/runtime/node/listener'
import type { NodeListenerVerifier } from '../../../../src/runtime/node/listenerGuard'
import { nodeConfig, nodeHash, nodeSession } from './records'

export function listenerFixture() {
  const lines: string[] = []
  const ended = new AbortController()
  const port: NodeMethodPort = {
    request: vi.fn(() => Promise.reject(new Error('unbound test method'))),
  }
  const request = vi.mocked(port.request).mockResolvedValue({ done: true })
  const verifier = {
    verifyBearer: vi.fn<NodeListenerVerifier['verifyBearer']>().mockResolvedValue(nodeSession()),
    sessionSignal: vi.fn(() => ended.signal),
    consumeStepUp: vi.fn<NodeListenerVerifier['consumeStepUp']>(),
  }
  const options: NodeListenerOptions = {
    config: { ...nodeConfig(), listener: { address: '127.0.0.1', port: 7443 } },
    ownerId: 'owner',
    clock: { now: () => Date.now(), monotonicMs: () => performance.now() },
    tls: {
      root: '/unbound',
      certificateFile: 'cert.pem',
      privateKeyFile: 'key.pem',
      fingerprint: nodeHash,
    },
    verifier,
    methods: () => port,
    terminal: vi.fn(() => Promise.resolve()),
    print: vi.fn((line: string) => {
      lines.push(line)
    }),
  }
  return { options, verifier, request, ended, lines }
}

export function listenerRequest(isWebsocket = false): IncomingMessage {
  const request = new IncomingMessage(new Socket())
  request.method = isWebsocket ? 'GET' : 'POST'
  request.url = isWebsocket ? '/node/terminal/stream' : '/node/stop'
  request.rawHeaders = [
    'Host',
    'home.local:7443',
    'Origin',
    'https://home.local:7443',
    'Sec-Fetch-Site',
    'same-origin',
    'Sec-Fetch-Mode',
    isWebsocket ? 'websocket' : 'cors',
    'Sec-Fetch-Dest',
    isWebsocket ? 'websocket' : 'empty',
  ]
  if (isWebsocket)
    request.rawHeaders.push(
      'Upgrade',
      'websocket',
      'Connection',
      'Upgrade',
      'Sec-WebSocket-Version',
      '13',
      'Sec-WebSocket-Key',
      Buffer.alloc(16).toString('base64'),
    )
  return request
}

/** A synchronous fake transport with real Duplex cancellation/write callbacks. */
export class ListenerSocket extends Duplex {
  readonly writes: Buffer[] = []
  override _read(): void {
    /* Test controls inbound data. */
  }
  override _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error) => void): void {
    this.writes.push(Buffer.from(chunk))
    done()
  }
}

export function maskedFrame(value: unknown): Buffer {
  const bytes = Buffer.from(JSON.stringify(value))
  const header = Buffer.alloc(bytes.length < 126 ? 6 : 8)
  header[0] = 0x81
  if (header.length === 6) header[1] = 0x80 | bytes.length
  else {
    header[1] = 0xfe
    header.writeUInt16BE(bytes.length, 2)
  }
  const mask = Buffer.from('mask')
  mask.copy(header, header.length - mask.length)
  const payload = Buffer.from(bytes)
  for (let index = 0; index < payload.length; index += 1)
    payload[index] = payload[index]! ^ mask[index % mask.length]!
  return Buffer.concat([header, payload])
}

export async function flushListener(): Promise<void> {
  for (let count = 0; count < 20; count += 1) await Promise.resolve()
}
