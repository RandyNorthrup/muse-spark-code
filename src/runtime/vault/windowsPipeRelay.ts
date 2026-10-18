import { Duplex } from 'node:stream'
import { spawnSync } from 'node:child_process'
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  writeSync,
  fsyncSync,
  renameSync,
  unlinkSync,
  mkdirSync,
  readFileSync,
  linkSync,
} from 'node:fs'
import pathModule from 'node:path'
import { randomBytes } from 'node:crypto'
import * as z from 'zod/mini'
import {
  UI_TEXT,
  VAULT_APPROVAL_TTL_MS,
  VAULT_BROKER_NATIVE_TIMEOUT_MS,
  VAULT_LIMITS,
} from '../../shared/constants'
import { VaultError } from '../../core/vault/crypto'
import { spawnResourceProcess } from '../../core/resources/launcher'
import { handleIdentitySync, lstatIdentitySync, sameFile } from '../../core/fs/fileIdentity'
import {
  WINDOWS_VAULT_PIPE_FRAME,
  WINDOWS_VAULT_PIPE_HEADER_BYTES,
  WINDOWS_VAULT_PIPE_ID_OFFSET,
  WINDOWS_VAULT_PIPE_LENGTH_OFFSET,
  WINDOWS_VAULT_PIPE_MAX_CONNECTIONS,
  WINDOWS_VAULT_PIPE_MAX_PAYLOAD,
  WINDOWS_VAULT_PIPE_RELAY_VERSION,
  windowsVaultPipeClientSchema,
  windowsVaultPipeFaultSchema,
  windowsVaultPipeNameSchema,
  windowsVaultPipeReadySchema,
  windowsVaultPipeServerResultSchema,
  windowsVaultPipeProcessResultSchema,
  type WindowsVaultPipeClient,
  type WindowsVaultPipeHelper,
} from '../../core/vault/broker/windowsPipe'
import type { VaultPrivateFilesPort, VaultFileWriter } from '../../core/vault/broker/files'
import { collectSlotChunk, drainSlotStderr, watchSlotChildErrors } from './slots/slotChild'
import { windowsVaultGuardScript, type WindowsVaultExecutable } from './slots/windowsVaultTransport'

/** A new random pipe name per broker start, published only in the owner-only lock file. */
export function windowsVaultPipeName(): string {
  return String.raw`\\.\pipe\muse-spark-vault-${randomBytes(VAULT_LIMITS.idBytes).toString('hex')}`
}

/** The relayed connection the channel accepts: a Duplex carrying its client record. */
export class WindowsVaultPipeConnection extends Duplex {
  constructor(
    readonly client: WindowsVaultPipeClient,
    private readonly send: (bytes: Uint8Array) => void,
  ) {
    super()
  }
  override _read(): void {
    /* The helper pushes; the channel pulls. */
  }
  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error) => void,
  ): void {
    try {
      this.send(chunk)
      callback()
    } catch (error: unknown) {
      callback(error instanceof Error ? error : new Error(UI_TEXT.vault.noAccess))
    }
  }
}

interface PendingQuery {
  readonly resolve: (payload: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

function missingFileError(): Error {
  return Object.assign(new Error(UI_TEXT.vault.noAccess), { code: 'ENOENT' })
}

/** The relay's narrow event surface over a real helper child process. */
export interface PipeRelayChild {
  readonly stdin: {
    write(buffer: Uint8Array): void
    end(data?: Uint8Array): void
  }
  readonly stdout: {
    on(event: 'data', listener: (chunk: Buffer) => void): unknown
  }
  readonly stderr: {
    on(event: 'data', listener: (chunk: Buffer) => void): unknown
  }
  on(event: 'error' | 'close', listener: (...args: never[]) => void): unknown
}

interface SpawnedPipeChild {
  readonly stdin: {
    write(buffer: Uint8Array): boolean
    end(data?: Uint8Array): unknown
  }
  readonly stdout: {
    on(event: 'data', listener: (chunk: Buffer) => void): unknown
  }
  readonly stderr: {
    on(event: 'data', listener: (chunk: Buffer) => void): unknown
  }
  once(event: 'error' | 'close', listener: () => void): unknown
}

/** Adapt a real helper child to the relay's narrow event surface. */
export function adaptPipeRelayChild(child: SpawnedPipeChild): PipeRelayChild {
  return {
    stdin: {
      write: (buffer) => {
        child.stdin.write(buffer)
      },
      end: (data) => {
        if (data !== undefined) child.stdin.write(data)
        child.stdin.end()
      },
    },
    stdout: { on: (event, listener) => child.stdout.on(event, listener) },
    stderr: { on: (event, listener) => child.stderr.on(event, listener) },
    on: (event, listener) => {
      // Error and close fire once each; the relay only needs notification.
      if (event === 'error') {
        child.once('error', () => {
          listener()
        })
      } else {
        child.once('close', () => {
          listener()
        })
      }
    },
  }
}

/**
 * One guarded helper process and its relay frames. Serve mode additionally
 * owns the pipe the channel listens on; files mode answers file and
 * native-identity queries for hosts and CLIs.
 */
export class PipeRelay {
  private readonly chunks: Buffer[] = []
  private size = 0
  private isSettled = false
  private queryId = 0
  private readonly pending = new Map<number, PendingQuery>()
  private readonly connections = new Map<number, WindowsVaultPipeConnection>()
  private readonly clients = new Map<WindowsVaultPipeConnection, WindowsVaultPipeClient>()
  private failed: Error | null = null
  private ownerSid: string | null = null
  private accepted: ((socket: Duplex) => void) | null = null
  private readonly pendingOpens: WindowsVaultPipeConnection[] = []
  private isListening = false
  private readyResolve: (() => void) | undefined
  private readyReject: ((error: Error) => void) | undefined

  constructor(
    private readonly child: PipeRelayChild,
    private readonly stopChild: () => Promise<void>,
    private readonly mode: 'serve' | 'files',
    readonly pipe: string | null,
  ) {}

  private writeFrame(type: number, id: number, payload: Uint8Array): void {
    if (this.isSettled) throw new Error(UI_TEXT.vault.noAccess)
    const header = Buffer.alloc(WINDOWS_VAULT_PIPE_HEADER_BYTES)
    header[0] = type
    header.writeUInt32BE(id, WINDOWS_VAULT_PIPE_ID_OFFSET)
    header.writeUInt32BE(payload.length, WINDOWS_VAULT_PIPE_LENGTH_OFFSET)
    try {
      this.child.stdin.write(header)
      if (payload.length > 0) this.child.stdin.write(payload)
    } catch {
      throw new Error(UI_TEXT.vault.noAccess)
    }
  }

  private drain(): void {
    for (;;) {
      const buffered = this.chunks.reduce((sum, part) => sum + part.length, 0)
      if (buffered < WINDOWS_VAULT_PIPE_HEADER_BYTES) return
      const flat = Buffer.concat(this.chunks)
      const type = flat.readUInt8(0)
      const id = flat.readUInt32BE(WINDOWS_VAULT_PIPE_ID_OFFSET)
      const length = flat.readUInt32BE(WINDOWS_VAULT_PIPE_LENGTH_OFFSET)
      if (length > WINDOWS_VAULT_PIPE_MAX_PAYLOAD) {
        this.fail(new Error(UI_TEXT.vault.noAccess))
        return
      }
      if (flat.length < WINDOWS_VAULT_PIPE_HEADER_BYTES + length) return
      for (const chunk of this.chunks) chunk.fill(0)
      // Copy before clearing: rest views flat's bytes, and dispatch runs below.
      const payload = Buffer.from(
        flat.subarray(WINDOWS_VAULT_PIPE_HEADER_BYTES, WINDOWS_VAULT_PIPE_HEADER_BYTES + length),
      )
      const rest = Buffer.from(flat.subarray(WINDOWS_VAULT_PIPE_HEADER_BYTES + length))
      flat.fill(0)
      this.chunks.length = 0
      if (rest.length > 0) this.chunks.push(rest)
      this.size = rest.length
      this.dispatch(type, id, payload)
    }
  }
  private dispatch(type: number, id: number, payload: Buffer): void {
    try {
      switch (type) {
        case WINDOWS_VAULT_PIPE_FRAME.ready: {
          this.onReady(payload)
          return
        }
        case WINDOWS_VAULT_PIPE_FRAME.open: {
          this.onOpen(id, payload)
          return
        }
        case WINDOWS_VAULT_PIPE_FRAME.data: {
          const connection = this.connections.get(id)
          if (!connection || this.mode !== 'serve') throw new Error(UI_TEXT.vault.noAccess)
          if (!connection.push(payload)) {
            /* The channel applies backpressure; the helper's pipe buffers. */
          }
          return
        }
        case WINDOWS_VAULT_PIPE_FRAME.end: {
          const connection = this.connections.get(id)
          if (connection) {
            this.connections.delete(id)
            this.clients.delete(connection)
            connection.push(null)
          }
          return
        }
        case WINDOWS_VAULT_PIPE_FRAME.fault: {
          let word: unknown
          try {
            word = JSON.parse(payload.toString('utf8'))
          } catch {
            word = null
          }
          const parsed = windowsVaultPipeFaultSchema.safeParse(word)
          this.fail(
            new Error(parsed.success ? `vault-pipe-${parsed.data}` : UI_TEXT.vault.noAccess),
          )
          return
        }
        case WINDOWS_VAULT_PIPE_FRAME.fileResult:
        case WINDOWS_VAULT_PIPE_FRAME.serverResult:
        case WINDOWS_VAULT_PIPE_FRAME.processResult: {
          let answer: unknown
          try {
            answer = JSON.parse(payload.toString('utf8'))
          } catch {
            this.fail(new Error(UI_TEXT.vault.noAccess))
            return
          }
          const queryId =
            typeof answer === 'object' &&
            answer !== null &&
            'id' in answer &&
            typeof answer.id === 'number'
              ? answer.id
              : null
          const pending = queryId === null ? undefined : this.pending.get(queryId)
          if (pending === undefined || queryId === null) {
            this.fail(new Error(UI_TEXT.vault.noAccess))
            return
          }
          this.pending.delete(queryId)
          clearTimeout(pending.timer)
          pending.resolve(answer)
          return
        }
        default: {
          this.fail(new Error(UI_TEXT.vault.noAccess))
        }
      }
    } finally {
      payload.fill(0)
    }
  }
  private onReady(payload: Buffer): void {
    let ready: unknown
    try {
      ready = JSON.parse(payload.toString('utf8'))
    } catch {
      this.fail(new Error(UI_TEXT.vault.noAccess))
      return
    }
    const parsed = windowsVaultPipeReadySchema.safeParse(ready)
    if (!parsed.success || parsed.data.pipe !== this.pipe) {
      this.fail(new Error(UI_TEXT.vault.noAccess))
      return
    }
    this.ownerSid = parsed.data.ownerSid
    this.readyResolve?.()
    this.readyResolve = undefined
    this.readyReject = undefined
  }
  private onOpen(id: number, payload: Buffer): void {
    if (this.mode !== 'serve' || id <= 0 || this.connections.has(id)) {
      this.fail(new Error(UI_TEXT.vault.noAccess))
      return
    }
    let client: WindowsVaultPipeClient
    try {
      client = windowsVaultPipeClientSchema.parse(JSON.parse(payload.toString('utf8')))
    } catch {
      this.fail(new Error(UI_TEXT.vault.noAccess))
      return
    }
    if (this.connections.size >= WINDOWS_VAULT_PIPE_MAX_CONNECTIONS) {
      this.writeFrame(WINDOWS_VAULT_PIPE_FRAME.close, id, Buffer.alloc(0))
      return
    }
    const connection = new WindowsVaultPipeConnection(client, (bytes) => {
      this.writeFrame(WINDOWS_VAULT_PIPE_FRAME.send, id, Buffer.from(bytes))
    })
    connection.once('close', () => {
      this.connections.delete(id)
      this.clients.delete(connection)
      try {
        this.writeFrame(WINDOWS_VAULT_PIPE_FRAME.close, id, Buffer.alloc(0))
      } catch {
        /* The helper is already gone. */
      }
    })
    this.connections.set(id, connection)
    this.clients.set(connection, client)
    const accepted = this.accepted
    if (accepted) accepted(connection)
    else this.pendingOpens.push(connection)
  }
  fail(error: Error): void {
    if (this.isSettled) return
    this.isSettled = true
    this.failed = error
    this.readyReject?.(error)
    this.readyResolve = undefined
    this.readyReject = undefined
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    for (const [, connection] of this.connections) connection.destroy(error)
    this.connections.clear()
    this.clients.clear()
    this.pendingOpens.length = 0
    for (const chunk of this.chunks) chunk.fill(0)
    this.chunks.length = 0
    this.size = 0
  }
  onStdout(chunk: Buffer): void {
    if (this.isSettled) {
      chunk.fill(0)
      return
    }
    this.size = collectSlotChunk(this.chunks, this.size, chunk, () => {
      this.fail(new Error(UI_TEXT.vault.noAccess))
    })
    this.drain()
  }
  awaitReady(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
  }
  inspect(socket: Duplex): WindowsVaultPipeClient {
    const client =
      socket instanceof WindowsVaultPipeConnection ? this.clients.get(socket) : undefined
    if (!client) throw new Error(UI_TEXT.vault.noAccess)
    return client
  }
  listen(pipe: string, accepted: (socket: Duplex) => void): () => Promise<void> {
    if (this.mode !== 'serve' || pipe !== this.pipe || this.isListening)
      throw new Error(UI_TEXT.vault.noAccess)
    this.isListening = true
    this.accepted = accepted
    for (const connection of this.pendingOpens) accepted(connection)
    this.pendingOpens.length = 0
    return () => {
      this.isListening = false
      this.accepted = null
      return Promise.resolve()
    }
  }
  /** Resolve once the helper answers; every query carries the approval TTL. */
  query(type: number, request: Record<string, unknown>): Promise<unknown> {
    if (this.isSettled || this.failed) throw this.failed ?? new Error(UI_TEXT.vault.noAccess)
    const id = (this.queryId += 1)
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(UI_TEXT.vault.noAccess))
      }, VAULT_APPROVAL_TTL_MS)
      this.pending.set(id, { resolve, reject, timer })
      try {
        const payload = Buffer.from(JSON.stringify({ ...request, id }), 'utf8')
        if (payload.length > WINDOWS_VAULT_PIPE_MAX_PAYLOAD) throw new Error(UI_TEXT.vault.noAccess)
        this.writeFrame(type, 0, payload)
      } catch (error: unknown) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(UI_TEXT.vault.noAccess))
      }
    })
  }
  async stop(): Promise<void> {
    this.fail(new Error(UI_TEXT.vault.noAccess))
    try {
      this.child.stdin.end()
    } catch {
      /* The helper is already gone. */
    }
    await this.stopChild()
  }

  owner(): string {
    if (this.ownerSid === null) throw new Error(UI_TEXT.vault.noAccess)
    return this.ownerSid
  }
}

const fileCommandSchema = z.strictObject({
  v: z.literal(WINDOWS_VAULT_PIPE_RELAY_VERSION),
  id: z.number().check(z.int(), z.nonnegative()),
  result: z.enum(['ok', 'refused', 'missing']),
})

/**
 * The `files` side of one relay: owner-only DACL commands for the store and
 * the broker's private files, plus the native server/process identity reads
 * for the client side. `refused` maps like the design says (store → io, files
 * → noAccess); `missing` is always an ENOENT-coded error.
 */
export class WindowsPipeFiles {
  constructor(
    private readonly relay: PipeRelay,
    private readonly refuse: (result: string) => Error,
  ) {}
  private async command(
    command: 'protect' | 'verify',
    kind: 'directory' | 'file',
    path: string,
  ): Promise<void> {
    const answer = fileCommandSchema.parse(
      await this.relay.query(WINDOWS_VAULT_PIPE_FRAME.file, {
        v: WINDOWS_VAULT_PIPE_RELAY_VERSION,
        command,
        kind,
        path,
      }),
    )
    if (answer.result === 'ok') return
    if (answer.result === 'missing') throw missingFileError()
    throw this.refuse(answer.result)
  }
  protect(path: string, kind: 'directory' | 'file'): Promise<void> {
    return this.command('protect', kind, path)
  }
  verify(path: string, kind: 'directory' | 'file'): Promise<void> {
    return this.command('verify', kind, path)
  }
}

/** Natively identify the pipe's server before sending `hello` (RVCM1091A F9). */
export async function inspectWindowsPipeServer(
  relay: PipeRelay,
  pipe: string,
): Promise<z.infer<typeof windowsVaultPipeServerResultSchema>> {
  return windowsVaultPipeServerResultSchema.parse(
    await relay.query(WINDOWS_VAULT_PIPE_FRAME.server, {
      v: WINDOWS_VAULT_PIPE_RELAY_VERSION,
      pipe,
    }),
  )
}

/** Natively identify any process, for broker discovery liveness on Windows. */
export async function inspectWindowsProcess(
  relay: PipeRelay,
  processId: number,
): Promise<z.infer<typeof windowsVaultPipeProcessResultSchema>> {
  return windowsVaultPipeProcessResultSchema.parse(
    await relay.query(WINDOWS_VAULT_PIPE_FRAME.process, {
      v: WINDOWS_VAULT_PIPE_RELAY_VERSION,
      processId,
    }),
  )
}

/**
 * The broker's private files on Windows: Node's filesystem calls with the
 * helper's owner-only DACL commands around them. There is no O_NOFOLLOW on
 * Windows, so every read and write verifies first (the helper refuses
 * reparse points in the path and its ancestors and any non-owner DACL);
 * only the broker's own user can pass that check, and code running as the
 * same user is outside D89.15's scope, exactly like the pipe itself.
 */
export class WindowsVaultPrivateFiles implements VaultPrivateFilesPort {
  constructor(
    private readonly guard: WindowsPipeFiles,
    private readonly helperFile: string,
  ) {}
  async directory(path: string): Promise<void> {
    mkdirSync(path, { recursive: true })
    await this.guard.protect(path, 'directory')
  }
  async read(path: string, maxBytes: number = VAULT_LIMITS.frameBytes): Promise<Buffer> {
    await this.guard.verify(path, 'file')
    const fd = openSync(path, 'r')
    try {
      if (!fstatSync(fd).isFile()) throw new Error(UI_TEXT.vault.noAccess)
    } finally {
      closeSync(fd)
    }
    const bytes = readFileSync(path)
    if (bytes.length > maxBytes) {
      bytes.fill(0)
      throw new Error(UI_TEXT.vault.noAccess)
    }
    return bytes
  }
  async replace(path: string, bytes: Uint8Array, authorize?: () => void): Promise<void> {
    await this.directory(pathModule.dirname(path))
    const temporary = `${path}.${randomBytes(VAULT_LIMITS.idBytes).toString('hex')}.tmp`
    const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL)
    try {
      writeSync(fd, bytes, 0, bytes.length, null)
      fsyncSync(fd)
      closeSync(fd)
      if (authorize) authorize()
      renameSync(temporary, path)
      const dir = openSync(pathModule.dirname(path), 'r')
      try {
        fsyncSync(dir)
      } finally {
        closeSync(dir)
      }
    } catch (error: unknown) {
      try {
        closeSync(fd)
      } catch {
        /* The rename may already have consumed this owned file. */
      }
      try {
        unlinkSync(temporary)
      } catch {
        /* The rename may already have consumed this owned file. */
      }
      throw error
    }
    await this.guard.protect(path, 'file')
  }
  async claim(
    path: string,
    bytes: Uint8Array,
    onReady?: () => void | Promise<void>,
  ): Promise<() => Promise<void>> {
    await this.directory(pathModule.dirname(path))
    const temporary = `${path}.pending`
    const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL)
    try {
      writeSync(fd, bytes, 0, bytes.length, null)
      fsyncSync(fd)
      const identity = handleIdentitySync(fd)
      closeSync(fd)
      await onReady?.()
      linkSync(temporary, path)
      try {
        unlinkSync(temporary)
      } catch {
        /* The complete record is published; a leftover temporary is retired by rule. */
      }
      const dir = openSync(pathModule.dirname(path), 'r')
      try {
        fsyncSync(dir)
      } finally {
        closeSync(dir)
      }
      return () => {
        if (sameFile(identity, lstatIdentitySync(path))) unlinkSync(path)
        return Promise.resolve()
      }
    } catch (error: unknown) {
      try {
        closeSync(fd)
      } catch {
        /* The publication path above already closed it. */
      }
      try {
        unlinkSync(temporary)
      } catch {
        /* Never published: nothing a reader can see remains under our name. */
      }
      throw error
    }
  }
  writer(path: string): VaultFileWriter {
    // Synchronous interface, so the one helper round trip it needs runs
    // synchronously: a one-shot files-mode verify of the digest-pinned
    // executable, never the guarded PowerShell chain.
    verifyWindowsVaultFileSync(this.helperFile, path)
    let descriptor: number | null = openSync(path, 'a')
    const sample = fstatSync(descriptor)
    if (!sample.isFile()) {
      closeSync(descriptor)
      descriptor = null
      throw new Error(UI_TEXT.vault.noAccess)
    }
    const current = (): number => {
      if (descriptor === null) throw new Error(UI_TEXT.vault.locked)
      if (!sameFile(handleIdentitySync(descriptor), lstatIdentitySync(path))) {
        closeSync(descriptor)
        verifyWindowsVaultFileSync(this.helperFile, path)
        const replacement = openSync(path, 'a')
        const resample = fstatSync(replacement)
        try {
          if (!resample.isFile()) throw new Error(UI_TEXT.vault.noAccess)
        } catch (error: unknown) {
          closeSync(replacement)
          throw error
        }
        descriptor = replacement
      }
      return descriptor
    }
    return {
      append: (bytes) => {
        const fd = current()
        let offset = 0
        while (offset < bytes.byteLength) {
          const count = writeSync(fd, bytes, offset, bytes.byteLength - offset, null)
          if (count === 0) throw new Error(UI_TEXT.vault.noAccess)
          offset += count
        }
        fsyncSync(fd)
      },
      replace: (bytes) => {
        current()
        const temporary = `${path}.${randomBytes(VAULT_LIMITS.idBytes).toString('hex')}.tmp`
        const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL)
        try {
          let offset = 0
          while (offset < bytes.byteLength) {
            const count = writeSync(fd, bytes, offset, bytes.byteLength - offset, null)
            if (count === 0) throw new Error(UI_TEXT.vault.noAccess)
            offset += count
          }
          fsyncSync(fd)
          const previous = current()
          renameSync(temporary, path)
          closeSync(previous)
          descriptor = fd
          const dir = openSync(pathModule.dirname(path), 'r')
          try {
            fsyncSync(dir)
          } finally {
            closeSync(dir)
          }
        } catch (error: unknown) {
          if (descriptor !== fd) closeSync(fd)
          try {
            unlinkSync(temporary)
          } catch {
            /* Rename may have consumed this owned file. */
          }
          throw error
        }
      },
      close: () => {
        if (descriptor === null) return
        closeSync(descriptor)
        descriptor = null
      },
    }
  }
}

/**
 * One synchronous helper round trip for the synchronous writer: the mode
 * line plus one `verify` file frame into the digest-pinned executable,
 * answered before the timeout. Anything else fails closed.
 */
function pipeRefused(): Error {
  return new Error(UI_TEXT.vault.noAccess)
}

export function verifyWindowsVaultFileSync(helperFile: string, path: string): void {
  const id = 1
  const frame = Buffer.from(
    JSON.stringify({
      v: WINDOWS_VAULT_PIPE_RELAY_VERSION,
      id,
      command: 'verify',
      kind: 'file',
      path,
    }),
    'utf8',
  )
  const header = Buffer.alloc(WINDOWS_VAULT_PIPE_HEADER_BYTES)
  header[0] = WINDOWS_VAULT_PIPE_FRAME.file
  header.writeUInt32BE(0, WINDOWS_VAULT_PIPE_ID_OFFSET)
  header.writeUInt32BE(frame.length, WINDOWS_VAULT_PIPE_LENGTH_OFFSET)
  const mode = Buffer.from(
    JSON.stringify({ v: WINDOWS_VAULT_PIPE_RELAY_VERSION, mode: 'files' }),
    'utf8',
  )
  const result = spawnSync(helperFile, [], {
    input: Buffer.concat([mode, Buffer.from('\n'), header, frame]),
    timeout: VAULT_BROKER_NATIVE_TIMEOUT_MS,
    env: { SystemRoot: process.env['SystemRoot'] ?? '' },
    cwd: pathModule.dirname(helperFile),
    maxBuffer: WINDOWS_VAULT_PIPE_MAX_PAYLOAD,
    windowsHide: true,
  })
  if (result.error !== undefined || result.status !== 0) throw pipeRefused()
  const output = result.stdout instanceof Buffer ? result.stdout : Buffer.from(result.stdout)
  try {
    if (output.length < WINDOWS_VAULT_PIPE_HEADER_BYTES) throw pipeRefused()
    if (
      output.readUInt8(0) !== WINDOWS_VAULT_PIPE_FRAME.fileResult ||
      output.readUInt32BE(WINDOWS_VAULT_PIPE_ID_OFFSET) !== 0
    )
      throw pipeRefused()
    const length = output.readUInt32BE(WINDOWS_VAULT_PIPE_LENGTH_OFFSET)
    if (
      length > WINDOWS_VAULT_PIPE_MAX_PAYLOAD ||
      output.length !== WINDOWS_VAULT_PIPE_HEADER_BYTES + length
    )
      throw pipeRefused()
    const answer = fileCommandSchema.parse(
      JSON.parse(
        output
          .subarray(WINDOWS_VAULT_PIPE_HEADER_BYTES, WINDOWS_VAULT_PIPE_HEADER_BYTES + length)
          .toString('utf8'),
      ),
    )
    if (answer.id !== id || answer.result !== 'ok') {
      if (answer.id === id && answer.result === 'missing') throw missingFileError()
      throw pipeRefused()
    }
  } finally {
    output.fill(0)
  }
}

/** Spawn the guarded helper and run the relay handshake for one mode. */
async function spawnPipeRelay(
  helper: WindowsVaultExecutable,
  mode: 'serve' | 'files',
  pipe: string | null,
  signal?: AbortSignal,
): Promise<PipeRelay> {
  if (
    !pathModule.isAbsolute(helper.file) ||
    !helper.file.toLowerCase().endsWith('.exe') ||
    !pathModule.isAbsolute(helper.powershell) ||
    !/^[a-f0-9]{64}$/u.test(helper.sha256)
  )
    throw new Error(UI_TEXT.vault.noAccess)
  // Do not inherit credentials, a shell, or a visible console window.
  let launched: Awaited<ReturnType<typeof spawnResourceProcess>>
  try {
    launched = await spawnResourceProcess(
      'contained',
      helper.powershell,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(windowsVaultGuardScript(helper.file, helper.sha256), 'utf16le').toString(
          'base64',
        ),
      ],
      {
        cwd: pathModule.dirname(helper.powershell),
        env: {},
        windowsHide: true,
      },
    )
  } catch {
    throw new Error(UI_TEXT.vault.noAccess)
  }
  const { child, stop } = launched
  const relay = new PipeRelay(adaptPipeRelayChild(child), () => stop(), mode, pipe)
  watchSlotChildErrors(child, signal, () => {
    relay.fail(new Error(UI_TEXT.vault.noAccess))
  })
  drainSlotStderr(child)
  child.on('close', () => {
    relay.fail(new Error(UI_TEXT.vault.noAccess))
  })
  return await new Promise<PipeRelay>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(UI_TEXT.vault.noAccess))
      return
    }
    let isReady = false
    const timer = setTimeout(() => {
      relay.fail(new Error(UI_TEXT.vault.noAccess))
      reject(new Error(UI_TEXT.vault.noAccess))
    }, VAULT_APPROVAL_TTL_MS)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        relay.fail(new Error(UI_TEXT.vault.noAccess))
        reject(new Error(UI_TEXT.vault.noAccess))
      },
      { once: true },
    )
    child.stdout.on('data', (chunk: Buffer) => {
      if (isReady) {
        relay.onStdout(chunk)
        return
      }
      if (chunk[0] !== 1) {
        chunk.fill(0)
        clearTimeout(timer)
        relay.fail(new Error(UI_TEXT.vault.noAccess))
        reject(new Error(UI_TEXT.vault.noAccess))
        return
      }
      isReady = true
      const rest = chunk.subarray(1)
      chunk[0] = 0
      try {
        child.stdin.write(
          Buffer.from(
            JSON.stringify(
              mode === 'serve'
                ? { v: WINDOWS_VAULT_PIPE_RELAY_VERSION, mode, pipe }
                : { v: WINDOWS_VAULT_PIPE_RELAY_VERSION, mode },
            ),
            'utf8',
          ),
        )
        child.stdin.write(Buffer.from('\n'))
      } catch {
        clearTimeout(timer)
        relay.fail(new Error(UI_TEXT.vault.noAccess))
        reject(new Error(UI_TEXT.vault.noAccess))
        return
      }
      if (rest.length > 0) relay.onStdout(Buffer.from(rest))
      rest.fill(0)
      if (mode === 'serve') {
        void relay
          .awaitReady()
          .then(() => {
            clearTimeout(timer)
            resolve(relay)
          })
          .catch((error: unknown) => {
            clearTimeout(timer)
            reject(error instanceof Error ? error : new Error(UI_TEXT.vault.noAccess))
          })
      } else {
        clearTimeout(timer)
        resolve(relay)
      }
    })
    try {
      child.stdin.write(Buffer.from(helper.guardSource, 'utf8').toString('base64') + '\n')
    } catch {
      clearTimeout(timer)
      reject(new Error(UI_TEXT.vault.noAccess))
    }
  })
}

/** Serve mode: the channel's secured listener over the owner-only pipe. */
export async function startWindowsPipeServe(
  helper: WindowsVaultExecutable,
  pipe: string,
  signal?: AbortSignal,
): Promise<WindowsVaultPipeHelper & { readonly relay: PipeRelay; readonly ownerSid: string }> {
  const parsed = windowsVaultPipeNameSchema.safeParse(pipe)
  if (!parsed.success) throw new Error(UI_TEXT.vault.noAccess)
  const relay = await spawnPipeRelay(helper, 'serve', parsed.data, signal)
  const security = new WindowsPipeFiles(relay, () => new VaultError('io'))
  const privateFiles = new WindowsVaultPrivateFiles(
    new WindowsPipeFiles(relay, () => new Error(UI_TEXT.vault.noAccess)),
    helper.file,
  )
  const files: WindowsVaultPipeHelper['files'] = {
    protect: (path, kind) => security.protect(path, kind),
    verify: (path, kind) => security.verify(path, kind),
    writer: (path) => privateFiles.writer(path),
    directory: (path) => privateFiles.directory(path),
    read: (path, maxBytes) => privateFiles.read(path, maxBytes),
    replace: (path, bytes, authorize) => privateFiles.replace(path, bytes, authorize),
    claim: (path, bytes, onReady) => privateFiles.claim(path, bytes, onReady),
  }
  return {
    relay,
    ownerSid: relay.owner(),
    files,
    listen: (path, accepted) => Promise.resolve(relay.listen(path, accepted)),
    inspect: (socket) => Promise.resolve(relay.inspect(socket)),
    stop: () => relay.stop(),
  }
}

/** Files mode: owner-only file commands and native identity reads. */
export async function startWindowsPipeFiles(
  helper: WindowsVaultExecutable,
  signal?: AbortSignal,
): Promise<{
  readonly relay: PipeRelay
  readonly files: WindowsPipeFiles
  readonly privateFiles: WindowsVaultPrivateFiles
  inspectServer(pipe: string): Promise<z.infer<typeof windowsVaultPipeServerResultSchema>>
  inspectProcess(processId: number): Promise<z.infer<typeof windowsVaultPipeProcessResultSchema>>
  stop(): Promise<void>
}> {
  const relay = await spawnPipeRelay(helper, 'files', null, signal)
  const files = new WindowsPipeFiles(relay, () => new Error(UI_TEXT.vault.noAccess))
  return {
    relay,
    files,
    privateFiles: new WindowsVaultPrivateFiles(files, helper.file),
    inspectServer: (pipe) => inspectWindowsPipeServer(relay, pipe),
    inspectProcess: (processId) => inspectWindowsProcess(relay, processId),
    stop: () => relay.stop(),
  }
}
