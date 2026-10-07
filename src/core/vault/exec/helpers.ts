import { createServer, connect, type Socket, type Server } from 'node:net'
import { chmod } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import { UI_TEXT, VAULT_LIMITS, VAULT_APPROVAL_TTL_MS } from '../../../shared/constants'
import { vaultPrivateDirectory } from '../broker/files'
import { type VaultSecuredListenerPort } from '../broker/channel'

const requestSchema = z
  .strictObject({
    kind: z.enum(['git', 'askpass']),
    operation: z.optional(z.string().check(z.maxLength(VAULT_LIMITS.text))),
    input: z.optional(z.string().check(z.maxLength(VAULT_LIMITS.text))),
  })
  .check(
    z.refine((v) =>
      v.kind === 'git'
        ? v.operation !== undefined && v.input !== undefined
        : v.operation === undefined && v.input === undefined,
    ),
  )
const replySchema = z
  .instanceof(Uint8Array)
  .check(
    z.refine(
      (v) => v.length > 0 && v.length <= VAULT_LIMITS.frameBytes && (v[0] === 0 || v[0] === 1),
    ),
  )

/** A disconnected client cannot keep the serialized owner waiting on late peer verification. */
async function isHelperPeerAllowed(
  socket: Socket,
  isAllowed: (socket: Socket) => Promise<boolean>,
): Promise<boolean> {
  if (socket.destroyed) return false
  let onClose: (() => void) | undefined
  const closed = new Promise<boolean>((resolve) => {
    onClose = () => {
      resolve(false)
    }
    socket.once('close', onClose)
  })
  try {
    return await Promise.race([isAllowed(socket), closed])
  } finally {
    if (onClose) socket.off('close', onClose)
  }
}

export interface VaultExecHelperDeps {
  /** B/P checks OS peer identity, then the native launcher's exact command-tree membership. */
  readonly authenticate: (socket: Socket) => Promise<boolean>
  readonly git?: (operation: string, input: string) => Buffer
  readonly askpass?: () => Buffer
  readonly listener?: VaultSecuredListenerPort
}

/** Feeder-owned, private helper transport. Socket names are routes, never authorization tickets. */
export class VaultExecHelperServer {
  private server: Server | undefined
  private listenerClose: (() => Promise<void>) | undefined
  private readonly sockets = new Set<Socket>()
  private readonly bytes = new Set<Buffer>()
  private isClosed = false
  private isStarting = false
  private generation = 0
  private tail: Promise<void> = Promise.resolve()
  constructor(private readonly deps: VaultExecHelperDeps) {}

  private canServe(generation: number): boolean {
    return !this.isClosed && this.generation === generation
  }
  private accept(socket: Socket): void {
    if (this.isClosed) {
      socket.destroy()
      return
    }
    const generation = this.generation
    this.sockets.add(socket)
    let held = Buffer.alloc(0)
    let isDispatched = false
    const timer = setTimeout(() => socket.destroy(), VAULT_APPROVAL_TTL_MS)
    socket.on('error', () => {
      socket.destroy()
    })
    socket.once('close', () => {
      clearTimeout(timer)
      held.fill(0)
      this.bytes.delete(held)
      this.sockets.delete(socket)
    })
    socket.on('data', (chunk: Buffer) => {
      if (isDispatched) {
        chunk.fill(0)
        socket.destroy()
        return
      }
      if (held.length + chunk.length > VAULT_LIMITS.frameBytes) {
        chunk.fill(0)
        socket.destroy()
        return
      }
      const previous = held
      held = Buffer.alloc(previous.length + chunk.length)
      held.set(previous)
      held.set(chunk, previous.length)
      previous.fill(0)
      chunk.fill(0)
      this.bytes.delete(previous)
      this.bytes.add(held)
      const end = held.indexOf('\n')
      if (end === -1) return
      isDispatched = true
      const next = async () => {
        if (end !== held.length - 1) {
          held.fill(0)
          this.bytes.delete(held)
          socket.destroy()
          return
        }
        let result: Buffer | undefined
        let reply: Buffer | undefined
        try {
          const request = requestSchema.parse(JSON.parse(held.subarray(0, end).toString('utf8')))
          held.fill(0)
          this.bytes.delete(held)
          const isAuthenticated = await isHelperPeerAllowed(socket, this.deps.authenticate)
          if (!isAuthenticated || !this.canServe(generation) || socket.destroyed)
            throw new Error(UI_TEXT.vault.noAccess)
          result =
            request.kind === 'git' && request.operation !== undefined && request.input !== undefined
              ? this.deps.git?.(request.operation, request.input)
              : this.deps.askpass?.()
          if (!result || result.length + 1 > VAULT_LIMITS.frameBytes)
            throw new Error(UI_TEXT.vault.noAccess)
          reply = Buffer.alloc(result.length + 1)
          reply[0] = 1
          reply.set(result, 1)
          this.bytes.add(reply)
          const owned = reply
          socket.end(owned, () => {
            owned.fill(0)
            this.bytes.delete(owned)
          })
        } catch {
          socket.destroy()
        } finally {
          held.fill(0)
          this.bytes.delete(held)
          result?.fill(0)
          if (reply && socket.destroyed) {
            reply.fill(0)
            this.bytes.delete(reply)
          }
        }
      }
      const previousEffect = this.tail
      this.tail = (async () => {
        await previousEffect
        await next()
      })()
    })
  }
  async listen(endpoint: string): Promise<void> {
    if (this.isClosed || this.isStarting || this.server || this.listenerClose)
      throw new Error(UI_TEXT.vault.noAccess)
    this.isStarting = true
    const generation = this.generation
    if (this.deps.listener) {
      const close = await this.deps.listener.listen(endpoint, (socket) => {
        this.accept(socket)
      })
      if (!this.canServe(generation)) {
        await close()
        throw new Error(UI_TEXT.vault.noAccess)
      }
      this.listenerClose = close
      return
    }
    if (process.platform === 'win32') throw new Error(UI_TEXT.vault.noAccess)
    await vaultPrivateDirectory(path.dirname(endpoint))
    if (!this.canServe(generation)) throw new Error(UI_TEXT.vault.noAccess)
    const server = createServer({ allowHalfOpen: true }, (socket) => {
      this.accept(socket)
    })
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(endpoint, resolve)
    })
    if (!this.canServe(generation)) throw new Error(UI_TEXT.vault.noAccess)
    await chmod(endpoint, constants.S_IRUSR | constants.S_IWUSR)
    if (!this.canServe(generation)) throw new Error(UI_TEXT.vault.noAccess)
  }
  async close(): Promise<void> {
    this.isClosed = true
    this.generation += 1
    for (const bytes of this.bytes) bytes.fill(0)
    this.bytes.clear()
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    if (this.listenerClose) {
      const close = this.listenerClose
      this.listenerClose = undefined
      await close()
    }
    if (!this.server) return
    const server = this.server
    this.server = undefined
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  }
}

/** Only the private helper's caller receives these bytes and must wipe them after stdout write. */
export async function callVaultExecHelper(
  endpoint: string,
  input: ReturnType<typeof requestSchema.parse>,
  isServerAllowed: (socket: Socket) => Promise<boolean>,
): Promise<Buffer> {
  const request = requestSchema.parse(input)
  const socket = connect(endpoint)
  const chunks: Buffer[] = []
  const outgoing = Buffer.alloc(Buffer.byteLength(JSON.stringify(request)) + 1)
  outgoing.write(`${JSON.stringify(request)}\n`)
  let total = 0
  let joined: Buffer | undefined
  const timer = setTimeout(
    () => socket.destroy(new Error(UI_TEXT.vault.noAccess)),
    VAULT_APPROVAL_TTL_MS,
  )
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })
    const isAuthenticated = await isHelperPeerAllowed(socket, isServerAllowed)
    if (!isAuthenticated || socket.destroyed) throw new Error(UI_TEXT.vault.noAccess)
    socket.end(outgoing, () => outgoing.fill(0))
    for await (const input of socket) {
      if (!(input instanceof Buffer)) throw new Error(UI_TEXT.vault.noAccess)
      total += input.length
      if (total > VAULT_LIMITS.frameBytes) {
        input.fill(0)
        throw new Error(UI_TEXT.vault.noAccess)
      }
      const copy = Buffer.alloc(input.length)
      copy.set(input)
      chunks.push(copy)
      input.fill(0)
    }
    joined = Buffer.alloc(total)
    let offset = 0
    for (const bytes of chunks) {
      joined.set(bytes, offset)
      offset += bytes.length
    }
    replySchema.parse(joined)
    if (joined[0] !== 1) throw new Error(UI_TEXT.vault.noAccess)
    const result = Buffer.alloc(joined.length - 1)
    result.set(joined.subarray(1))
    return result
  } catch {
    throw new Error(UI_TEXT.vault.noAccess)
  } finally {
    clearTimeout(timer)
    outgoing.fill(0)
    joined?.fill(0)
    for (const bytes of chunks) bytes.fill(0)
    socket.destroy()
  }
}
