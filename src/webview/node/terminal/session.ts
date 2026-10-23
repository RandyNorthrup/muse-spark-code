import {
  NODE_MAX_TERMINAL_DIMENSION,
  NODE_TERMINAL_INPUT_BYTES,
  NODE_ZERO_DIGEST,
} from '../../../shared/constants'
import { nodeEventSchema } from '../../../shared/node'
import { nodeMethods, type NodeMethodPort } from '../../../shared/hostApi/nodeMethods'
import { NodePageError } from '../../bridges/nodePort'
import type { NodeTerminalSocketFactory } from '../../bridges/nodePort'
import { presentStepUp, stepUpActionDigest, type NodePageAuthPort } from '../git/network'

export type { NodeTerminalSocketFactory, NodeTerminalWire } from '../../bridges/nodePort'

export type NodeTerminalEvent =
  | { type: 'output'; data: string }
  | { type: 'ended'; exitCode: number | null }
  | { type: 'error'; error: unknown }

export interface NodeTerminalSession {
  readonly terminalId: string
  /** Subscribe to the stream; a late subscriber replays the terminal's end. */
  events(handler: (event: NodeTerminalEvent) => void): () => void
  /** Keystrokes toward the shell, chunked to the input bound. */
  write(data: string): void
  /** Follows the view's measured size; rejects what the schema would. */
  resize(cols: number, rows: number): void
  /** Ends the stream: the close frame, then the socket. Idempotent. */
  close(): void
}

/** Split without cutting a code point: the bound counts bytes. */
function chunkInput(data: string): string[] {
  const chunks: string[] = []
  let chunk = ''
  let size = 0
  const encoder = new TextEncoder()
  for (const point of data) {
    const width = encoder.encode(point).byteLength
    if (width > NODE_TERMINAL_INPUT_BYTES) continue
    if (size + width > NODE_TERMINAL_INPUT_BYTES) {
      chunks.push(chunk)
      chunk = ''
      size = 0
    }
    chunk += point
    size += width
  }
  if (chunk !== '') chunks.push(chunk)
  return chunks
}

async function attachSession(
  port: NodeMethodPort,
  terminalId: string,
  connect: NodeTerminalSocketFactory,
  signal: AbortSignal,
): Promise<NodeTerminalSession> {
  signal.throwIfAborted()
  // The method call validates the id first (typed `notFound`), so a bad id
  // never opens a socket; the socket's auth frame attaches it again.
  await port.request('node/terminal/attach', { terminalId }, signal)
  const wire = await connect(terminalId)
  if (signal.aborted) {
    // Cancelled while the socket opened: nobody will ever read it, and the
    // server disposes the shell on the dropped socket.
    wire.close()
    signal.throwIfAborted()
  }
  const handlers = new Set<(event: NodeTerminalEvent) => void>()
  let ended: { type: 'ended'; exitCode: number | null } | undefined
  let isClosed = false
  const emit = (event: NodeTerminalEvent): void => {
    if (event.type === 'ended') ended = event
    for (const handler of handlers) handler(event)
  }
  const releaseMessage = wire.onMessage((data: string) => {
    let raw: unknown
    try {
      raw = JSON.parse(data)
    } catch (error: unknown) {
      // Unparseable bytes read as a server fault: anything else keeps
      // its kind.
      if (!(error instanceof SyntaxError)) throw error
      emit({ type: 'error', error: new NodePageError('unavailable', { cause: error }) })
      return
    }
    const parsed = nodeEventSchema.safeParse(raw)
    if (!parsed.success) {
      emit({ type: 'error', error: new NodePageError('unavailable', { cause: parsed.error }) })
      return
    }
    const event = parsed.data
    // The server sends only this terminal's output and end on its stream;
    // anything else is a server fault, said plainly.
    if (event.type === 'terminalOutput' && event.terminalId === terminalId)
      emit({ type: 'output', data: event.data })
    else if (event.type === 'terminalEnded' && event.terminalId === terminalId)
      emit({ type: 'ended', exitCode: event.exitCode })
    else emit({ type: 'error', error: new NodePageError('unavailable') })
  })
  const releaseClose = wire.onClose(() => {
    // The server ends a terminal with its event, never a bare close: a
    // dropped socket before the end is a failure the person must see.
    if (!isClosed && ended === undefined)
      emit({ type: 'error', error: new NodePageError('unavailable') })
  })
  return {
    terminalId,
    events(handler) {
      if (ended !== undefined) handler(ended)
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
    write(data) {
      if (isClosed || ended !== undefined) throw new Error('node terminal session closed')
      for (const part of chunkInput(data)) wire.send(JSON.stringify({ type: 'input', data: part }))
    },
    resize(cols, rows) {
      if (isClosed || ended !== undefined) throw new Error('node terminal session closed')
      if (
        !Number.isSafeInteger(cols) ||
        !Number.isSafeInteger(rows) ||
        cols < 1 ||
        rows < 1 ||
        cols > NODE_MAX_TERMINAL_DIMENSION ||
        rows > NODE_MAX_TERMINAL_DIMENSION
      )
        throw new NodePageError('invalidRequest')
      wire.send(JSON.stringify({ type: 'resize', size: { cols, rows } }))
    },
    close() {
      if (isClosed) return
      isClosed = true
      releaseMessage()
      releaseClose()
      // Best effort in both directions: a closing socket still ends the
      // stream, and the server disposes the shell on the dropped socket.
      wire.send(JSON.stringify({ type: 'close' }))
      wire.close()
    },
  }
}

export async function openNodeTerminal(options: {
  port: NodeMethodPort
  auth: NodePageAuthPort
  workspaceId: string
  size: { cols: number; rows: number }
  connect: NodeTerminalSocketFactory
  signal: AbortSignal
}): Promise<NodeTerminalSession> {
  const pending = nodeMethods['node/terminal/open'].params.parse({
    workspaceId: options.workspaceId,
    stepUpId: 'pending',
    actionDigest: NODE_ZERO_DIGEST,
    size: options.size,
  })
  const actionDigest = await stepUpActionDigest('node/terminal/open', pending)
  const proof = await presentStepUp(options.auth, 'terminal.open', actionDigest, options.signal)
  const opened = await options.port.request(
    'node/terminal/open',
    { ...pending, stepUpId: proof.id, actionDigest },
    options.signal,
  )
  try {
    return await attachSession(options.port, opened.terminalId, options.connect, options.signal)
  } catch (error: unknown) {
    if (!options.signal.aborted) throw error
    // Abandoned while attaching: end the shell rather than leak it. The
    // close rides its own signal (the caller's is spent); a failed close
    // surfaces instead of the abort, because that failure is the news.
    await options.port.request(
      'node/terminal/close',
      { terminalId: opened.terminalId },
      AbortSignal.any([]),
    )
    throw error
  }
}

export async function attachNodeTerminal(options: {
  port: NodeMethodPort
  terminalId: string
  connect: NodeTerminalSocketFactory
  signal: AbortSignal
}): Promise<NodeTerminalSession> {
  return await attachSession(options.port, options.terminalId, options.connect, options.signal)
}
