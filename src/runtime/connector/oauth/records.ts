// M124 remote (D240): the authorization server's records, held in memory
// and written whole to the connection's owner-only OAuth file after a change
// to a stored model. Grants, access tokens, refresh tokens and the clients
// that registered themselves survive a restart (a token is keyed by the
// SHA-256 digest of its value, so the file never holds a bearer secret);
// sessions, interactions and authorization codes live minutes and are never
// written. The running server is this file's only writer. The clients the
// owner registers with `mcp client add` are the owner's own file (clients.ts),
// read afresh whenever a client is looked up, so an addition or a removal
// made in another terminal takes effect at once.
// `oidc-provider` reaches all of this through its adapter (adapter.ts).
import { createHash } from 'node:crypto'
import {
  CONNECTOR_OAUTH_MODELS,
  type ConnectorOAuthModel,
  type ConnectorOAuthRecord,
  type ConnectorOAuthState,
} from '../../../shared/connectorRemote'
import { MILLISECONDS_PER_SECOND } from '../../../shared/constants'
import type { OwnerClients } from './clients'

/** A model whose key is a bearer secret: stored under its digest. */
const SECRET_MODELS: ReadonlySet<string> = new Set(['AccessToken', 'RefreshToken'])

export interface RecordLimits {
  readonly openClientsMax: number
  readonly openClientTtlMs: number
  readonly interactionsMax: number
}

export interface RecordsOptions {
  readonly now: () => number
  /** Writes one snapshot; the caller secures the file. */
  readonly save: (state: ConnectorOAuthState) => Promise<void>
  /** The owner's clients and revocations, read afresh. */
  readonly owner: () => Promise<OwnerClients>
  readonly limits: RecordLimits
}

type Payload = Record<string, unknown>

interface Held {
  readonly payload: Payload
  readonly expiresAt: number | undefined
}

/** The server is full of open registrations or pending consent pages: refuse, say so. */
export class OAuthRecordsFull extends Error {
  public constructor(public readonly what: 'clients' | 'interactions') {
    super(`connector OAuth ${what} full`)
    this.name = 'OAuthRecordsFull'
  }
}

export function isOAuthRecordsFull(error: unknown): error is OAuthRecordsFull {
  return error instanceof OAuthRecordsFull
}

function isStoredModel(model: string): model is ConnectorOAuthModel {
  return (CONNECTOR_OAUTH_MODELS as readonly string[]).includes(model)
}

function storedKey(model: string, id: string): string {
  return SECRET_MODELS.has(model) ? createHash('sha256').update(id, 'utf8').digest('hex') : id
}

/** An opaque token's own value is its `jti`: the stored copy keeps the digest key alone. */
function withoutTokenValue(model: string, payload: Payload): Payload {
  return SECRET_MODELS.has(model)
    ? Object.fromEntries(Object.entries(payload).filter(([name]) => name !== 'jti'))
    : payload
}

function slot(model: string, key: string): string {
  return `${model}\0${key}`
}

export class OAuthRecords {
  private readonly stored = new Map<string, ConnectorOAuthRecord>()
  private readonly transient = new Map<string, Held>()
  /** The latest write, finished or not; the next write waits for it to settle. */
  private lastWrite: Promise<void> = Promise.resolve()
  /** A write that has not begun: changes made now will be in it. */
  private waiting: Promise<void> | undefined
  private boundGeneration: number

  public constructor(
    private readonly base: Omit<ConnectorOAuthState, 'records'>,
    records: readonly ConnectorOAuthRecord[],
    private readonly options: RecordsOptions,
  ) {
    this.boundGeneration = base.boundGeneration
    for (const record of records) this.stored.set(slot(record.model, record.key), record)
  }

  private isLapsed(expiresAt: number | undefined): boolean {
    return expiresAt !== undefined && expiresAt <= this.options.now()
  }

  private expiry(expiresInSeconds: number | undefined): number | undefined {
    return expiresInSeconds === undefined
      ? undefined
      : this.options.now() + expiresInSeconds * MILLISECONDS_PER_SECOND
  }

  private prune(): void {
    for (const [name, record] of this.stored) {
      if (this.isLapsed(record.expiresAt)) this.stored.delete(name)
    }
    for (const [name, held] of this.transient) {
      if (this.isLapsed(held.expiresAt)) this.transient.delete(name)
    }
  }

  /**
  Writes the current state. One write at a time; a change made while a
  write is only waiting its turn rides in that write.
  */
  private async persist(): Promise<void> {
    if (this.waiting !== undefined) {
      await this.waiting
      return
    }
    const previous = this.lastWrite
    const write = (async () => {
      // The earlier write's failure is its own caller's; this one writes on.
      await Promise.allSettled([previous])
      this.waiting = undefined
      this.prune()
      await this.options.save({
        ...this.base,
        boundGeneration: this.boundGeneration,
        records: this.snapshot(),
      })
    })()
    this.waiting = write
    this.lastWrite = write
    await write
  }

  private snapshot(): ConnectorOAuthRecord[] {
    return Array.from(this.stored, ([, record]) => record)
  }

  /** The owner approved a grant for an open client: it no longer lapses. */
  private promoteClient(clientId: unknown): void {
    if (typeof clientId !== 'string') return
    const client = this.stored.get(slot('Client', clientId))
    if (client?.expiresAt === undefined) return
    this.stored.set(slot('Client', clientId), {
      model: client.model,
      key: client.key,
      payload: client.payload,
    })
  }

  private count(model: string): number {
    let total = 0
    for (const name of this.transient.keys()) if (name.startsWith(`${model}\0`)) total += 1
    return total
  }

  /** True while any sign-in is still held (a grant, a token): what a rebind would end. */
  private holdsSignIns(): boolean {
    for (const record of this.stored.values()) if (record.model !== 'Client') return true
    return false
  }

  public async upsert(
    model: string,
    id: string,
    payload: Payload,
    expiresInSeconds: number | undefined,
  ): Promise<void> {
    const expiresAt = this.expiry(expiresInSeconds)
    if (!isStoredModel(model)) {
      this.prune()
      if (
        model === 'Interaction' &&
        !this.transient.has(slot(model, id)) &&
        this.count('Interaction') >= this.options.limits.interactionsMax
      ) {
        throw new OAuthRecordsFull('interactions')
      }
      this.transient.set(slot(model, id), { payload, expiresAt })
      return
    }
    const key = storedKey(model, id)
    const existing = this.stored.get(slot(model, key))
    if (model === 'Client') {
      if (existing === undefined && this.openClientCount() >= this.options.limits.openClientsMax) {
        throw new OAuthRecordsFull('clients')
      }
      // A new open registration lapses unless an owner's approval promotes it.
      const lapse =
        existing === undefined
          ? this.options.now() + this.options.limits.openClientTtlMs
          : existing.expiresAt
      this.stored.set(slot(model, key), {
        model,
        key,
        payload,
        ...(lapse !== undefined && { expiresAt: lapse }),
      })
    } else {
      this.stored.set(slot(model, key), {
        model,
        key,
        payload: withoutTokenValue(model, payload),
        ...(expiresAt !== undefined && { expiresAt }),
      })
      if (model === 'Grant') this.promoteClient(payload['clientId'])
    }
    await this.persist()
  }

  public async find(model: string, id: string): Promise<Payload | undefined> {
    if (!isStoredModel(model)) {
      const held = this.transient.get(slot(model, id))
      return held === undefined || this.isLapsed(held.expiresAt) ? undefined : held.payload
    }
    if (model === 'Client') {
      const owner = await this.options.owner()
      if (owner.revoked.includes(id)) return undefined
      const own = owner.clients.find((client) => client.clientId === id)
      if (own !== undefined) {
        return {
          client_id: own.clientId,
          client_name: own.clientName,
          redirect_uris: [...own.redirectUris],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          scope: own.scopes.join(' '),
        }
      }
    }
    const record = this.stored.get(slot(model, storedKey(model, id)))
    if (record === undefined || this.isLapsed(record.expiresAt)) return undefined
    // The token's value is the id it was looked up by; it was never stored.
    return SECRET_MODELS.has(model) ? { ...record.payload, jti: id } : record.payload
  }

  /** A session by its uid (the only model looked up that way). */
  public findByUid(uid: string): Payload | undefined {
    for (const [name, held] of this.transient) {
      if (this.isLapsed(held.expiresAt)) continue
      if (name.startsWith('Session\0') && held.payload['uid'] === uid) return held.payload
    }
    return undefined
  }

  public async consume(model: string, id: string): Promise<void> {
    const consumed = Math.floor(this.options.now() / MILLISECONDS_PER_SECOND)
    if (!isStoredModel(model)) {
      const held = this.transient.get(slot(model, id))
      if (held !== undefined) {
        this.transient.set(slot(model, id), { ...held, payload: { ...held.payload, consumed } })
      }
      return
    }
    const key = storedKey(model, id)
    const record = this.stored.get(slot(model, key))
    if (record === undefined) return
    this.stored.set(slot(model, key), { ...record, payload: { ...record.payload, consumed } })
    await this.persist()
  }

  public async destroy(model: string, id: string): Promise<void> {
    if (!isStoredModel(model)) {
      this.transient.delete(slot(model, id))
      return
    }
    if (this.stored.delete(slot(model, storedKey(model, id)))) await this.persist()
  }

  /** Every grant-bound record: the grant, and the tokens and codes issued from it. */
  public async revokeByGrantId(grantId: string): Promise<void> {
    let didChange = false
    for (const [name, record] of this.stored) {
      const isGrant = record.model === 'Grant' && record.payload['jti'] === grantId
      if (!(isGrant || record.payload['grantId'] === grantId)) {
        continue
      }

      this.stored.delete(name)
      didChange = true
    }
    for (const [name, held] of this.transient) {
      if (held.payload['grantId'] === grantId) this.transient.delete(name)
    }
    if (didChange) await this.persist()
  }

  /** Open registrations still waiting for an owner's approval or for the clock. */
  public openClientCount(): number {
    let total = 0
    for (const record of this.stored.values()) {
      if (
        record.model === 'Client' &&
        record.expiresAt !== undefined &&
        !this.isLapsed(record.expiresAt)
      ) {
        total += 1
      }
    }
    return total
  }

  public pendingInteractions(): number {
    this.prune()
    return this.count('Interaction')
  }

  /**
  The connection grant changed hands or was withdrawn: every sign-in made
  under the earlier one ends. Clients stay (they hold no authority).
  */
  public async rebind(generation: number | undefined): Promise<void> {
    const isStale =
      generation === undefined ? this.holdsSignIns() : generation !== this.boundGeneration
    if (!isStale) return
    for (const [name, record] of this.stored) {
      if (record.model !== 'Client') this.stored.delete(name)
    }
    this.transient.clear()
    if (generation !== undefined) this.boundGeneration = generation
    await this.persist()
  }
}
