import { connect, type Socket } from 'node:net'
import {
  VAULT_PROTOCOL_VERSION,
  VAULT_APPROVAL_TTL_MS,
  VAULT_LIMITS,
  UI_TEXT,
} from '../../../shared/constants'
import { vaultPrivateReadSchema, type VaultBrokerRequest } from '../../../shared/vaultProtocol'
import {
  vaultChannelRequestSchema,
  vaultChannelResponseSchema,
  type VaultChannelResponse,
} from './channel'
import { type VaultPeerVerifier } from './peer'
import { type VaultBrokerLocation } from './discovery'

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
  private constructor(private readonly socket: Socket) {
    socket.on('error', () => {
      this.close()
    })
    socket.on('close', () => {
      this.pending?.reject(new Error(UI_TEXT.vault.locked))
      if (this.pending) clearTimeout(this.pending.timer)
      this.pending = null
    })
    socket.on('data', (bytes: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, bytes])
      if (this.buffer.length > VAULT_LIMITS.frameBytes) {
        this.close()
        return
      }
      const end = this.buffer.indexOf('\n')
      if (end === -1) return
      try {
        const response = vaultChannelResponseSchema.parse(
          JSON.parse(this.buffer.subarray(0, end).toString('utf8')),
        )
        if (response.sequence !== this.pending?.sequence || end !== this.buffer.length - 1) {
          this.close()
          return
        }
        const pending = this.pending
        this.pending = null
        this.buffer.fill(0)
        this.buffer = Buffer.alloc(0)
        clearTimeout(pending.timer)
        pending.resolve(response.response)
      } catch {
        this.close() /* No unvalidated bytes or remote error text escape this boundary. */
      }
    })
  }
  async send(
    request: VaultBrokerRequest['request'] | ReturnType<typeof vaultPrivateReadSchema.parse>,
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
          reject(new Error(UI_TEXT.vault.locked))
          return
        }
        const timer = setTimeout(() => {
          reject(new Error(UI_TEXT.vault.approvalExpired))
          this.close()
        }, VAULT_APPROVAL_TTL_MS)
        this.pending = { sequence, resolve, reject, timer }
        const bytes = Buffer.from(`${JSON.stringify(frame)}\n`)
        if (bytes.length > VAULT_LIMITS.frameBytes) {
          this.close()
          return
        }
        this.socket.write(bytes, (error) => {
          if (error) this.close()
        })
      })
    })()
    this.tail = next
    return await next
  }
  async firstPartyRead(input: ReturnType<typeof vaultPrivateReadSchema.parse>): Promise<Buffer> {
    const response = await this.send(vaultPrivateReadSchema.parse(input))
    if (response.kind !== 'material') throw new Error(UI_TEXT.vault.noAccess)
    const decoded = Buffer.from(response.bytes, 'base64')
    const owned = Buffer.alloc(decoded.length)
    owned.set(decoded)
    decoded.fill(0)
    return owned
  }
  close(): void {
    this.socket.destroy()
    this.buffer.fill(0)
    this.buffer = Buffer.alloc(0)
  }
}
