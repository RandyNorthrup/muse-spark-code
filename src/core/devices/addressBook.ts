// Nodes are known by identity, never by address (M110r Y2, PLAN.md
// D90.25). A node's id is the SHA-256 fingerprint of its identity public
// key; pairs, routes, tasks, leases, journals and every UI name it by id
// and label, and an address is only a hint where to look. The address
// book keeps last-known addresses, newest first. Discovery advertises a
// rotating per-pair token, never the id. Pure, except the clock the
// caller passes for token hours.

import { createHash, createHmac } from 'node:crypto'
import * as z from 'zod/mini'
import { MILLISECONDS_PER_HOUR } from '../../shared/constants'

/** A node id: the SHA-256 fingerprint of its identity public key, hex. */
export const nodeIdSchema = z.string().check(z.regex(/^[0-9a-f]{64}$/))
export type NodeId = z.infer<typeof nodeIdSchema>

/** The hour the token encodes, as an unsigned 64-bit big-endian integer. */
const TOKEN_HOUR_BYTES = 8

/** Derive the node id from its identity public key bytes. */
export function nodeIdFromPublicKey(publicKey: Uint8Array): NodeId {
  return createHash('sha256').update(publicKey).digest('hex')
}

/**
The token a paired node advertises on the LAN instead of its id: the HMAC
under that pair's key of the current hour. A stranger sees a changing
opaque value. `hour` is whole hours since the Unix epoch.
*/
export function discoveryToken(pairKey: Uint8Array, hour: number): string {
  const hourBytes = Buffer.alloc(TOKEN_HOUR_BYTES)
  hourBytes.writeBigUInt64BE(BigInt(Math.max(0, Math.floor(hour))))
  return createHmac('sha256', pairKey).update(hourBytes).digest('hex')
}

/** The whole hour containing `wallMs`, for the discovery token. */
export function tokenHour(wallMs: number): number {
  return Math.floor(wallMs / MILLISECONDS_PER_HOUR)
}

const addressBookEntrySchema = z.strictObject({
  id: nodeIdSchema,
  label: z.string().check(z.minLength(1)),
  /** Last-known addresses, newest first. */
  addresses: z.array(z.string().check(z.minLength(1))),
  updatedAt: z.number().check(z.gte(0)),
})
export type AddressBookEntry = z.infer<typeof addressBookEntrySchema>

const addressBookSchema = z.strictObject({
  entries: z.array(addressBookEntrySchema),
})

/**
Last-known addresses per node, newest first. A successful handshake moves
its address to the front; discovery tries them in order.
*/
export class AddressBook {
  private readonly entries = new Map<string, AddressBookEntry>()

  /** Remember `nodeId` under `label` with `addresses` newest first. */
  remember(nodeId: NodeId, label: string, addresses: readonly string[], nowWall: number): void {
    const seen = new Set<string>()
    const ordered = addresses.filter((address) => {
      if (seen.has(address)) return false
      seen.add(address)
      return true
    })
    this.entries.set(nodeId, { id: nodeId, label, addresses: ordered, updatedAt: nowWall })
  }

  /** Move a proven address to the front of its node's hints. */
  recordSuccess(nodeId: NodeId, address: string, nowWall: number): void {
    const entry = this.entries.get(nodeId)
    if (entry === undefined) return
    const rest = entry.addresses.filter((known) => known !== address)
    this.entries.set(nodeId, {
      ...entry,
      addresses: [address, ...rest],
      updatedAt: nowWall,
    })
  }

  known(nodeId: NodeId): AddressBookEntry | undefined {
    return this.entries.get(nodeId)
  }

  addressesFor(nodeId: NodeId): readonly string[] {
    return this.entries.get(nodeId)?.addresses ?? []
  }

  /** Serialize for the node's store; validated on load. */
  dump(): string {
    const entries: AddressBookEntry[] = []
    for (const entry of this.entries.values()) entries.push(entry)
    return JSON.stringify({ entries })
  }

  /** Load a dumped book; a corrupt dump throws and the book is unchanged. */
  load(dumped: string): void {
    const parsed = addressBookSchema.parse(JSON.parse(dumped) as unknown)
    this.entries.clear()
    for (const entry of parsed.entries) this.entries.set(entry.id, entry)
  }
}

/**
One discovery leg: dial through it, proving the pinned identity, and stop
when `signal` aborts. M100's transports implement these; Y2 only races
them.
*/
export type DiscoveryAttempt<T> = (signal: AbortSignal) => Promise<T>

/**
Race discovery legs in parallel: the first handshake that proves the
pinned identity wins and the rest are aborted. Every leg failing rejects
with all of their reasons; the caller re-resolves.
*/
export async function firstHandshakeWins<T>(attempts: readonly DiscoveryAttempt<T>[]): Promise<T> {
  if (attempts.length === 0) throw new Error('no discovery legs')
  const controller = new AbortController()
  try {
    const pending = new Map(
      attempts.map((attempt, index) => [
        index,
        (async () => {
          try {
            return { index, ok: true as const, value: await attempt(controller.signal) }
          } catch (error: unknown) {
            return { index, ok: false as const, error }
          }
        })(),
      ]),
    )
    const failures: unknown[] = []
    while (pending.size > 0) {
      const next = await Promise.race(pending.values())
      pending.delete(next.index)
      if (next.ok) {
        controller.abort()
        return next.value
      }
      failures.push(next.error)
    }
    throw new AggregateError(failures, `all ${String(attempts.length)} discovery legs failed`)
  } finally {
    controller.abort()
  }
}
