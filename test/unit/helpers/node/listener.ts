import { Duplex } from 'node:stream'
import { IncomingMessage } from 'node:http'
import { Socket } from 'node:net'
import { performance } from 'node:perf_hooks'
import type {
  NodeMethodName,
  NodeMethodParams,
  NodeMethodPort,
  NodeMethodResult,
} from '../../../../src/shared/hostApi/nodeMethods'
import type { NodeListenerOptions } from '../../../../src/runtime/node/listener'
import type { NodeListenerVerifier } from '../../../../src/runtime/node/listenerGuard'
import { recordCalls, scripted } from '../recordCalls'
import { nodeConfig, nodeHash, nodeSession } from './records'

function defaultRequest(): Promise<unknown> {
  return Promise.resolve({ done: true })
}

export function listenerFixture() {
  const lines: string[] = []
  const ended = new AbortController()
  // The port is generic over method names, so it keeps a hand-written
  // recorder with the same queued one-shot surface as scripted(). The one
  // `as` below is the seam: a scripted double cannot narrow a method result
  // the way the real dispatcher does (PLAN.md §8).
  type RequestBehavior = (
    method: NodeMethodName,
    params: unknown,
    signal: AbortSignal,
  ) => Promise<unknown>
  const requestCalls: [NodeMethodName, unknown, AbortSignal][] = []
  const requestQueue: RequestBehavior[] = []
  let requestBehavior: RequestBehavior = defaultRequest
  async function request<M extends NodeMethodName>(
    method: M,
    params: NodeMethodParams<M>,
    signal: AbortSignal,
  ): Promise<NodeMethodResult<M>> {
    requestCalls.push([method, params, signal])
    const next = requestQueue.shift() ?? requestBehavior
    return (await next(method, params, signal)) as NodeMethodResult<M>
  }
  const requestStub = Object.assign(request, {
    calls: requestCalls,
    once: (behavior: RequestBehavior): void => {
      requestQueue.push(behavior)
    },
    use: (behavior: RequestBehavior): void => {
      requestBehavior = behavior
    },
    reset: (behavior: RequestBehavior = defaultRequest): void => {
      requestQueue.length = 0
      requestCalls.length = 0
      requestBehavior = behavior
    },
  })
  const port: NodeMethodPort = { request: requestStub }
  const verifier = {
    verifyBearer: scripted((_bearer: string, _signal: AbortSignal) =>
      Promise.resolve(nodeSession()),
    ),
    sessionSignal: scripted((_sessionId: string) => ended.signal),
    consumeStepUp: scripted(
      (
        _binding: Parameters<NodeListenerVerifier['consumeStepUp']>[0],
        _signal: AbortSignal,
      ): ReturnType<NodeListenerVerifier['consumeStepUp']> =>
        Promise.reject(new Error('unbound test step-up')),
    ),
  }
  const methods = scripted(() => port)
  const terminal = scripted(() => Promise.resolve())
  const print = recordCalls<[string]>()
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
    methods,
    terminal,
    print: (line) => {
      print.fn(line)
      lines.push(line)
    },
  }
  return { options, port, request: requestStub, verifier, methods, terminal, print, ended, lines }
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
