import { connect, type Socket } from 'node:net'
import { once } from 'node:events'
import {
  VAULT_PROTOCOL_VERSION,
  VAULT_APPROVAL_TTL_MS,
  VAULT_LIMITS,
  UI_TEXT,
} from '../../../shared/constants'
import {
  vaultBrokerEventFrameSchema,
  vaultPrivateReadSchema,
  type VaultBrokerEvent,
  type VaultBrokerRequest,
  type VaultPrivateRequest,
} from '../../../shared/vaultProtocol'
import {
  vaultChannelRequestSchema,
  vaultChannelResponseSchema,
  type VaultChannelResponse,
} from './frames'
import type { VaultPeerVerifier } from './peer'
import type { VaultBrokerLocation } from './discovery'

/**
 * A dead or corrupted channel names itself, never the vault's state. A
 * closed socket, a failed write and an invalid response previously all
 * threw the `locked` sentence, so the panel toasted "Locked" beside a
 * recovered unlocked section (RVCM1091G P3). The host maps every code here
 * to `unreachable` (the operation failed, Retry offered).
 */
export class VaultChannelError extends Error {
  constructor(readonly code: 'closed' | 'writeFailed' | 'invalidResponse') {
    super(UI_TEXT.vault.operationFailed)
    this.name = 'VaultChannelError'
  }
}

export class VaultBrokerClient {
  static async open(
    location: VaultBrokerLocation,
    hostId: string,
    hostSession: string,
    peers: VaultPeerVerifier,
  ): Promise<VaultBrokerClient> {
    const socket = connect(location.lock.socket)
    const client = new VaultBrokerClient(socket)
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve)
        socket.once('error', reject)
      })
      const identity = await peers.verify(socket)
      if (
        identity.processId !== location.lock.processId ||
        identity.startedAt !== location.lock.startedAt
      )
        throw new Error(UI_TEXT.vault.noAccess)
      const hello = await client.send({
        kind: 'hello',
        bootToken: location.bootToken,
        hostId,
        hostSession,
      })
      if (hello.kind !== 'hello' || hello.brokerId !== location.lock.brokerId)
        throw new Error(UI_TEXT.vault.noAccess)
      return client
    } catch (error: unknown) {
      client.close()
      throw error
    }
  }
  private sequence = 0
  private buffer = Buffer.alloc(0)
  private pending: {
    sequence: number
    resolve: (response: VaultChannelResponse['response']) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  } | null = null
  private tail: Promise<unknown> = Promise.resolve()
  /** Set by watch(): from then on every line is a pushed event frame. */
  private onEvent: ((event: VaultBrokerEvent) => void) | null = null
  private isAwaitingWatch = false
  private constructor(private readonly socket: Socket) {
    socket.on('error', () => {
      this.close()
    })
    socket.on('close', () => {
      this.close()
    })
    socket.on('data', (bytes: Buffer) => {
      const previous = this.buffer
      try {
        this.buffer = Buffer.concat([previous, bytes])
      } finally {
        previous.fill(0)
      }
      if (this.buffer.length > VAULT_LIMITS.frameBytes) {
        // A reply too large for one frame is an invalid response, never a
        // plain close (RVAPP-CM1091D5 P3-2).
        this.close('invalidResponse')
        return
      }
      if (this.onEvent !== null) {
        this.drainEvents(this.onEvent)
        return
      }
      const end = this.buffer.indexOf('\n')
      if (end === -1) return
      try {
        const response = vaultChannelResponseSchema.parse(
          JSON.parse(this.buffer.subarray(0, end).toString('utf8')),
        )
        // Only a watch answer may share its read with the first pushed events.
        if (
          response.sequence !== this.pending?.sequence ||
          (end !== this.buffer.length - 1 && !this.isAwaitingWatch)
        ) {
          // A wrong reply sequence or trailing bytes is an invalid response,
          // never a plain close (RVAPP-CM1091D5 P3-2).
          this.close('invalidResponse')
          return
        }
        const pending = this.pending
        this.pending = null
        const rest = this.isAwaitingWatch
          ? Buffer.from(this.buffer.subarray(end + 1))
          : Buffer.alloc(0)
        this.buffer.fill(0)
        this.buffer = rest
        clearTimeout(pending.timer)
        pending.resolve(response.response)
      } catch {
        this.close(
          'invalidResponse',
        ) /* No unvalidated bytes or remote error text escape this boundary. */
      }
    })
  }
  /** Validated pushed events, one per line; a bad frame closes the stream. */
  private drainEvents(onEvent: (event: VaultBrokerEvent) => void): void {
    let end = this.buffer.indexOf('\n')
    while (end !== -1) {
      const line = this.buffer.subarray(0, end)
      let event: VaultBrokerEvent
      try {
        event = vaultBrokerEventFrameSchema.parse(JSON.parse(line.toString('utf8'))).event
      } catch {
        this.close('invalidResponse')
        return
      }
      this.buffer = this.buffer.subarray(end + 1)
      try {
        onEvent(event)
      } catch {
        /* A failing listener cannot stop later events. */
      }
      end = this.buffer.indexOf('\n')
    }
  }
  async send(
    request: VaultBrokerRequest['request'] | VaultPrivateRequest,
  ): Promise<VaultChannelResponse['response']> {
    const sequence = this.sequence++
    const frame = vaultChannelRequestSchema.parse({
      v: VAULT_PROTOCOL_VERSION,
      sequence,
      request,
    })
    const previous = this.tail
    const next = (async () => {
      try {
        await previous
      } catch {
        /* Its caller receives the error; a closed channel rejects the next call. */
      }
      return await new Promise<VaultChannelResponse['response']>((resolve, reject) => {
        if (this.socket.destroyed) {
          reject(new VaultChannelError('closed'))
          return
        }
        const timer = setTimeout(() => {
          reject(new Error(UI_TEXT.vault.approvalExpired))
          this.close()
        }, VAULT_APPROVAL_TTL_MS)
        this.pending = { sequence, resolve, reject, timer }
        const bytes = Buffer.from(`${JSON.stringify(frame)}\n`)
        try {
          if (bytes.length > VAULT_LIMITS.frameBytes) {
            bytes.fill(0)
            // A request too large to send is a write failure, never a plain
            // close (RVAPP-CM1091D5 P3-2).
            this.close('writeFailed')
            return
          }
          this.socket.write(bytes, (error) => {
            try {
              if (error) this.close('writeFailed')
            } finally {
              bytes.fill(0)
            }
          })
        } catch (error: unknown) {
          try {
            this.close('writeFailed')
          } finally {
            bytes.fill(0)
          }
          reject(error instanceof VaultChannelError ? error : new VaultChannelError('writeFailed'))
        }
      })
    })()
    this.tail = next
    return await next
  }
  /**
   * v2 watch: this connection then carries only pushed lock, revoke, approval
   * and change events until close(); it accepts no further request.
   */
  async watch(onEvent: (event: VaultBrokerEvent) => void): Promise<void> {
    this.isAwaitingWatch = true
    const response = await this.send({ kind: 'watch' })
    if (response.kind !== 'ok') {
      this.close()
      throw new Error(UI_TEXT.vault.noAccess)
    }
    this.onEvent = onEvent
    this.drainEvents(onEvent)
  }
  /** Resolves when the connection ends, so a watcher can reconnect. */
  async closed(): Promise<void> {
    if (this.socket.destroyed) return
    await once(this.socket, 'close')
  }
  async firstPartyRead(input: ReturnType<typeof vaultPrivateReadSchema.parse>): Promise<Buffer> {
    const response = await this.send(vaultPrivateReadSchema.parse(input))
    if (response.kind !== 'material') throw new Error(UI_TEXT.vault.noAccess)
    const decoded = Buffer.from(response.bytes, 'base64')
    try {
      const owned = Buffer.alloc(decoded.length)
      owned.set(decoded)
      return owned
    } finally {
      decoded.fill(0)
    }
  }
  close(reason: VaultChannelError['code'] = 'closed'): void {
    try {
      this.socket.destroy()
    } finally {
      this.buffer.fill(0)
      this.buffer = Buffer.alloc(0)
      const pending = this.pending
      this.pending = null
      if (pending) {
        clearTimeout(pending.timer)
        pending.reject(new VaultChannelError(reason))
      }
    }
  }
}
