// An editor's side of one MHP connection, as the runtime panel suites drive it
// over the real process's standard I/O: every frame out is built, and every
// frame in is read, with the frozen contract (src/shared/hostApi). Requests the
// runtime makes of the host (`surfaces/open`, `ui/confirm`, `terminal/create`)
// are answered by the handler the suite registered for that method, as an
// editor's own service would answer them.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { MHP, MHP_ERROR_CODES } from '../../../src/shared/constants'

type Frame = Record<string, unknown>

/** The editor's side of a connection, over any pair of streams. */
export interface MhpWire {
  send(frame: unknown): void
  /** A host request; resolves with the frame answering its id. */
  request(method: string, params: unknown): Promise<unknown>
  /** The service the host gives the runtime for `method`; its return is the request's result. */
  serve(method: string, handler: (params: unknown) => unknown): void
  /** The next frame that answers no request (a notification, a panel frame, an id-less failure). */
  next(isWanted?: (frame: Frame) => boolean): Promise<Frame>
  /** Requests the runtime made of the host so far, with their params. */
  readonly asked: readonly { readonly method: string; readonly params: unknown }[]
  /** Every frame the runtime wrote, in order. */
  readonly received: readonly Record<string, unknown>[]
}

/** The editor's side of a connection to a runtime process. */
export interface MhpHost extends MhpWire {
  readonly child: ChildProcessWithoutNullStreams
  readonly exited: Promise<number | null>
  stderr(): string
}

function isFrame(value: unknown): value is Frame {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function connectMhpHost(input: Writable, output: Readable): MhpWire {
  const waiting = new Map<string, (frame: unknown) => void>()
  const services = new Map<string, (params: unknown) => unknown>()
  const asked: { method: string; params: unknown }[] = []
  const inbox: Frame[] = []
  const received: Frame[] = []
  const takers: { isWanted: (frame: Frame) => boolean; take: (frame: Frame) => void }[] = []
  const send = (frame: unknown) => {
    input.write(`${JSON.stringify(frame)}\n`)
  }
  const deliver = (frame: Frame) => {
    const index = takers.findIndex((taker) => taker.isWanted(frame))
    const taker = takers[index]
    if (taker === undefined) {
      inbox.push(frame)
      return
    }
    takers.splice(index, 1)
    taker.take(frame)
  }
  let buffered = ''
  output.setEncoding('utf8')
  output.on('data', (chunk: string) => {
    buffered += chunk
    for (let end = buffered.indexOf('\n'); end !== -1; end = buffered.indexOf('\n')) {
      const frame: unknown = JSON.parse(buffered.slice(0, end))
      buffered = buffered.slice(end + 1)
      if (!isFrame(frame)) continue
      received.push(frame)
      const id =
        typeof frame['id'] === 'string' || typeof frame['id'] === 'number'
          ? String(frame['id'])
          : undefined
      const method = typeof frame['method'] === 'string' ? frame['method'] : undefined
      const answer = id === undefined ? undefined : waiting.get(id)
      if (id !== undefined && method === undefined && answer !== undefined) {
        waiting.delete(id)
        answer(frame)
      } else if (id !== undefined && method !== undefined) {
        // The runtime asks the host for a service.
        asked.push({ method, params: frame['params'] })
        const service = services.get(method)
        send(
          service === undefined
            ? {
                jsonrpc: MHP.jsonRpcVersion,
                id: frame['id'],
                error: { code: MHP_ERROR_CODES.methodNotFound, message: 'MHP_METHOD_NOT_FOUND' },
              }
            : { jsonrpc: MHP.jsonRpcVersion, id: frame['id'], result: service(frame['params']) },
        )
      } else {
        if (method !== undefined) asked.push({ method, params: frame['params'] })
        deliver(frame)
      }
    }
  })
  let nextId = 1
  return {
    send,
    request: (method, params) => {
      const id = `host-${String(nextId++)}`
      const answered = new Promise<unknown>((resolve) => {
        waiting.set(id, resolve)
      })
      send({ jsonrpc: MHP.jsonRpcVersion, id, method, params })
      return answered
    },
    serve: (method, handler) => {
      services.set(method, handler)
    },
    next: (isWanted = () => true) => {
      const index = inbox.findIndex((frame) => isWanted(frame))
      const head = inbox[index]
      if (head !== undefined) {
        inbox.splice(index, 1)
        return Promise.resolve(head)
      }
      return new Promise<Frame>((resolve) => {
        takers.push({ isWanted, take: resolve })
      })
    },
    asked,
    received,
  }
}

export function startMhpHost(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string
    readonly env: NodeJS.ProcessEnv
    readonly started: Set<ChildProcessWithoutNullStreams>
  },
): MhpHost {
  const child = spawn(command, [...args], { cwd: options.cwd, env: options.env, stdio: 'pipe' })
  options.started.add(child)
  const exited = new Promise<number | null>((resolve) => {
    child.once('close', (code) => {
      options.started.delete(child)
      resolve(code)
    })
  })
  let errors = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    errors += chunk
  })
  return {
    ...connectMhpHost(child.stdin, child.stdout),
    child,
    exited,
    stderr: () => errors,
  }
}
