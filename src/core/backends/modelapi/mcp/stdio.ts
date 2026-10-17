// The stdio transport (M50, PLAN.md D42): a server started as a child
// process, spoken to on its stdin and heard on its stdout, one message at a
// time. Muse Code 1.3.0 frames them three ways (its `McpStdioFramingSetting`,
// read from the binary): `line_delimited_json`, the MCP specification's own
// (one JSON object per line); `content_length`, LSP-style headers; and `auto`,
// its default, which probes line-delimited JSON and falls back to
// Content-Length. Here `auto` writes lines and switches both ways to
// Content-Length when the server's first bytes are such a header; a server
// that never answers a line reaches its start-up deadline, whose reason says
// to set `content_length`.
//
// A message over MCP_MESSAGE_MAX_BYTES, or a header that cannot be read, ends
// the server: the stream cannot be trusted after it. A line that is not JSON
// (a server printing its banner to stdout) is logged and skipped. Its stderr
// goes to the log line by line, and its last words give the reason when it
// exits. Closing ends its input, waits MCP_SHUTDOWN_GRACE_MS for it to leave,
// then kills its process tree. Pure over the injected child process.

import { Buffer } from 'node:buffer'
import {
  BYTES_PER_MIB,
  type McpFraming,
  MCP_MESSAGE_MAX_BYTES,
  MCP_SHUTDOWN_GRACE_MS,
  MCP_STDERR_TAIL_CHARS,
} from '../../../../shared/constants'
import { clipForLog, type CoreLogger } from '../../../logging'
import type { McpTransport } from './connection'
import type { OutgoingMessage } from './protocol'

/** A started server process, as the host lends it (src/host/backend/mcpProcess.ts). */
export interface McpChildProcess {
  write(bytes: Uint8Array): void
  /** Closes its stdin: a well-behaved server leaves when it sees the end. */
  endInput(): void
  onStdout(listener: (chunk: Uint8Array) => void): void
  onStderr(listener: (chunk: Uint8Array) => void): void
  /** Once, when it has exited or could not be started: how, in words. */
  onExit(listener: (how: string) => void): void
  /** Ends a live tree, or waits for its exited parent's orphan sweep. */
  kill(): Promise<void>
}

/** A stream that broke the framing: the server is ended with this reason. */
export class McpFramingError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'McpFramingError'
  }
}

const LINE_FEED = 0x0a
const CARRIAGE_RETURN = 0x0d
const HEADER_END = Buffer.from('\r\n\r\n', 'latin1')
const CONTENT_LENGTH = /^content-length:\s*(\d+)\s*$/im
const CONTENT_LENGTH_START = /^content-length\s*:/i
const CONTENT_LENGTH_WORD = 'content-length'
// Blank output before the first message is held no further than this.
const PROBE_MAX_BYTES = 1024

function tooLarge(): McpFramingError {
  return new McpFramingError(
    `the server sent a message over ${String(MCP_MESSAGE_MAX_BYTES / BYTES_PER_MIB)} MiB`,
  )
}

/** Reads messages from a byte stream and writes them back in the same framing. */
interface Framer {
  /** The complete messages the bytes finish, in order; throws `McpFramingError`. */
  push(chunk: Uint8Array): readonly string[]
  encode(json: string): Uint8Array
}

/** A framer over the bytes read so far; each kind says how the next message ends. */
abstract class BufferedFramer implements Framer {
  protected pending: Buffer = Buffer.alloc(0)

  /** The next whole message, taken off `pending`; undefined while there is none yet. */
  protected abstract next(): string | undefined

  public push(chunk: Uint8Array): readonly string[] {
    this.pending = Buffer.concat([this.pending, chunk])
    const messages: string[] = []
    for (let message = this.next(); message !== undefined; message = this.next()) {
      messages.push(message)
    }
    return messages
  }

  public abstract encode(json: string): Uint8Array
}

/** One JSON object per line; `\r\n` is accepted and blank lines are skipped. */
export class LineFramer extends BufferedFramer {
  protected next(): string | undefined {
    for (;;) {
      const newline = this.pending.indexOf(LINE_FEED)
      if (newline === -1) {
        if (this.pending.length > MCP_MESSAGE_MAX_BYTES) {
          throw tooLarge()
        }
        return undefined
      }
      const end =
        newline > 0 && this.pending[newline - 1] === CARRIAGE_RETURN ? newline - 1 : newline
      const line = this.pending.subarray(0, end).toString('utf8')
      this.pending = this.pending.subarray(newline + 1)
      if (line.trim() !== '') {
        return line
      }
    }
  }

  public encode(json: string): Uint8Array {
    return Buffer.from(`${json}\n`, 'utf8')
  }
}

/** `Content-Length: N` headers, a blank line, then N bytes of JSON (LSP framing). */
export class ContentLengthFramer extends BufferedFramer {
  protected next(): string | undefined {
    const headerEnd = this.pending.indexOf(HEADER_END)
    if (headerEnd === -1) {
      if (this.pending.length > MCP_MESSAGE_MAX_BYTES) {
        throw tooLarge()
      }
      return undefined
    }
    const header = this.pending.subarray(0, headerEnd).toString('latin1')
    const length = CONTENT_LENGTH.exec(header)?.[1]
    if (length === undefined) {
      throw new McpFramingError('the server sent a message header without a Content-Length')
    }
    const size = Number(length)
    if (size > MCP_MESSAGE_MAX_BYTES) {
      throw tooLarge()
    }
    const start = headerEnd + HEADER_END.length
    if (this.pending.length < start + size) {
      return undefined
    }
    const body = this.pending.subarray(start, start + size).toString('utf8')
    this.pending = this.pending.subarray(start + size)
    return body
  }

  public encode(json: string): Uint8Array {
    const body = Buffer.from(json, 'utf8')
    return Buffer.concat([
      Buffer.from(`Content-Length: ${String(body.length)}\r\n\r\n`, 'latin1'),
      body,
    ])
  }
}

/**
 * `auto`'s choice from the first bytes a server writes: Content-Length when
 * they are that header, lines otherwise; undefined while too few have come
 * to tell (they are held until then).
 */
export function framingOfFirstBytes(bytes: Uint8Array): 'content_length' | 'lines' | undefined {
  const text = Buffer.from(bytes).toString('latin1').trimStart()
  if (CONTENT_LENGTH_START.test(text)) {
    return 'content_length'
  }
  const isStillAPrefix =
    bytes.length <= PROBE_MAX_BYTES &&
    text.length < CONTENT_LENGTH_WORD.length &&
    CONTENT_LENGTH_WORD.startsWith(text.toLowerCase())
  return isStillAPrefix ? undefined : 'lines'
}

export interface StdioTransportOptions {
  readonly name: string
  readonly framing: McpFraming
  readonly log: CoreLogger
}

export class McpStdioTransport implements McpTransport {
  private framer: Framer
  /** `auto` until the first bytes tell: what came so far, held. */
  private probed: Buffer | undefined
  private readonly messageListeners = new Set<(message: unknown) => void>()
  private readonly closeListeners = new Set<(reason: string) => void>()
  private stderrLine = ''
  private stderrTail = ''
  private exitReason: string | undefined
  /** Resolves (true) once the process has exited. */
  private readonly exited: Promise<true>

  public constructor(
    private readonly child: McpChildProcess,
    private readonly options: StdioTransportOptions,
  ) {
    this.framer =
      options.framing === 'content_length' ? new ContentLengthFramer() : new LineFramer()
    this.probed = options.framing === 'auto' ? Buffer.alloc(0) : undefined
    this.exited = new Promise((resolve) => {
      child.onExit((how) => {
        this.ended(how)
        resolve(true)
      })
    })
    child.onStdout((chunk) => {
      this.stdout(chunk)
    })
    child.onStderr((chunk) => {
      this.stderr(chunk)
    })
  }

  private ended(how: string): void {
    if (this.exitReason !== undefined) {
      return
    }
    const last = this.stderrTail.trim()
    this.exitReason = last === '' ? how : `${how}: ${last}`
    for (const listener of this.closeListeners) {
      listener(this.exitReason)
    }
  }

  private stdout(chunk: Uint8Array): void {
    if (this.exitReason !== undefined) {
      return
    }
    const bytes = this.probe(chunk)
    if (bytes === undefined) {
      return
    }
    let messages: readonly string[]
    try {
      messages = this.framer.push(bytes)
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error)
      this.options.log.error(`MCP server ${this.options.name} is stopped: ${reason}`)
      this.ended(reason)
      void this.child.kill().catch(() => {
        this.options.log.error(`MCP server ${this.options.name} has an unproved tree stop`)
      })
      return
    }
    for (const text of messages) {
      this.deliver(text)
    }
  }

  /**
   * `auto`: the bytes held until the stream's start tells the framing, then
   * all of them; a server that begins with a Content-Length header is
   * spoken to that way from then on. Undefined while it cannot tell yet.
   */
  private probe(chunk: Uint8Array): Uint8Array | undefined {
    if (this.probed === undefined) {
      return chunk
    }
    const held = Buffer.concat([this.probed, chunk])
    const framing = framingOfFirstBytes(held)
    if (framing === undefined) {
      this.probed = held
      return undefined
    }
    this.probed = undefined
    if (framing === 'content_length') {
      this.options.log.info(
        `MCP server ${this.options.name} frames its messages with Content-Length; switching to that framing`,
      )
      this.framer = new ContentLengthFramer()
    }
    return held
  }

  private deliver(text: string): void {
    let message: unknown
    try {
      message = JSON.parse(text)
    } catch {
      this.options.log.warn(
        `MCP server ${this.options.name} wrote a line that is not JSON to stdout; skipped: ${clipForLog(text)}`,
      )
      return
    }
    for (const listener of this.messageListeners) {
      listener(message)
    }
  }

  private stderr(chunk: Uint8Array): void {
    const text = `${this.stderrLine}${Buffer.from(chunk).toString('utf8')}`
    const lines = text.split(/\r?\n/)
    this.stderrLine = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim() === '') {
        continue
      }
      this.options.log.info(`MCP server ${this.options.name} (stderr): ${clipForLog(line)}`)
      this.stderrTail = line.slice(-MCP_STDERR_TAIL_CHARS)
    }
  }

  public send(message: OutgoingMessage): Promise<void> {
    if (this.exitReason !== undefined) {
      return Promise.reject(new Error(`the server has stopped: ${this.exitReason}`))
    }
    this.child.write(this.framer.encode(JSON.stringify(message)))
    return Promise.resolve()
  }

  public setProtocolVersion(): void {
    // The stdio transport carries no version header.
  }

  public onMessage(listener: (message: unknown) => void): void {
    this.messageListeners.add(listener)
  }

  public onClose(listener: (reason: string) => void): void {
    this.closeListeners.add(listener)
  }

  /** Ends its input, gives it MCP_SHUTDOWN_GRACE_MS to leave, then reaps its tree. */
  public async close(): Promise<void> {
    this.closeListeners.clear()
    if (this.exitReason !== undefined) {
      await this.child.kill()
      return
    }
    this.child.endInput()
    let timer: ReturnType<typeof setTimeout> | undefined
    const graceOver = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        resolve(false)
      }, MCP_SHUTDOWN_GRACE_MS)
    })
    await Promise.race([this.exited, graceOver])
    clearTimeout(timer)
    // `kill` waits for the checked orphan sweep when the parent exited;
    // otherwise it ends the still-running process tree.
    await this.child.kill()
  }
}
