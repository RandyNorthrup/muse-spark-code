// M124 (D106, design §6): a scrubbed, schema-versioned receipt for every
// call transition, transport refusal and owner command. Private text enters
// only as a keyed digest, so the journal is no guessing oracle. A required
// receipt (`record`) is awaited and a failed append refuses its effect. A
// best-effort one (`note`: a refusal, a transport refusal, Stop) never waits
// and never queues: while `auditBacklog` receipts are being written it is
// tallied, and written later as one line with its count, so a flood of bad
// frames costs a counter, not memory, and nothing waits behind it. A receipt
// not durable within `auditTimeoutMs` failed, and a journal with such a hung
// append counts as failed until that append answers.
import { createHmac } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { CONNECTOR_LIMITS, CONNECTOR_SCHEMA_VERSION } from '../../shared/constants'
import { connectorAuditSchema, type ConnectorAuditRecord } from '../../shared/connector'
import { canonicalJson } from './approval'

export interface AuditPort {
  /** Appends one JSON line durably; throws when it cannot. */
  readonly append: (line: string) => Promise<void>
  /** The per-install audit key (owner-only), read once. */
  readonly key: () => Promise<Uint8Array>
}

export type AuditEvent = Omit<ConnectorAuditRecord, 'schemaVersion' | 'at' | 'connectionId'>

export class ConnectorAudit {
  private key: Promise<Uint8Array> | undefined
  /** Receipts being written now, and appends that outlived their timeout. */
  private writing = 0
  private hung = 0
  /** Best-effort receipts that met a full backlog, by their content without call ids. */
  private readonly tally = new Map<string, { readonly event: AuditEvent; count: number }>()

  public constructor(
    private readonly port: AuditPort,
    private readonly connectionId: string,
    private readonly now: () => number,
    private readonly scrub: (text: string) => string,
    private readonly timeoutMs: number = CONNECTOR_LIMITS.auditTimeoutMs,
  ) {}

  private async append(line: string): Promise<boolean> {
    await this.port.append(line)
    return true
  }

  /** An append past its timeout: the journal counts as failed until it answers. */
  private async hang(append: Promise<boolean>): Promise<void> {
    this.hung += 1
    try {
      await append
    } catch {
      // Its record already answered false.
    } finally {
      this.hung -= 1
      this.flush()
    }
  }

  /** Writes tallied receipts, one line each with its count, while there is room. */
  private flush(): void {
    for (const [key, entry] of this.tally) {
      if (this.writing >= CONNECTOR_LIMITS.auditBacklog || this.hung > 0) return
      this.tally.delete(key)
      void this.record({ ...entry.event, count: entry.count })
    }
  }

  /** HMAC-SHA256 of the canonical value under the audit key. */
  public async digest(value: unknown): Promise<string> {
    this.key ??= this.port.key()
    return createHmac('sha256', await this.key)
      .update(canonicalJson(value))
      .digest('hex')
  }

  /** True once the line is durable; false when the journal failed or hangs. */
  public async record(event: AuditEvent): Promise<boolean> {
    if (this.hung > 0) return false
    this.writing += 1
    const timer = new AbortController()
    try {
      const record = connectorAuditSchema.parse({
        ...event,
        schemaVersion: CONNECTOR_SCHEMA_VERSION,
        at: new Date(this.now()).toISOString(),
        connectionId: this.connectionId,
        // Tool names arrive from the client: an unknown one is scrubbed text.
        ...(event.tool !== undefined && { tool: this.scrub(event.tool) }),
      })
      const append = this.append(`${JSON.stringify(record)}\n`)
      const isDurable = await Promise.race([
        append,
        sleep(this.timeoutMs, false, { signal: timer.signal }),
      ])
      if (!isDurable) void this.hang(append)
      return isDurable
    } catch {
      return false
    } finally {
      timer.abort()
      this.writing -= 1
      this.flush()
    }
  }

  /** A best-effort receipt: written now, or tallied while the backlog is full. Never waits. */
  public note(event: AuditEvent): void {
    if (this.writing < CONNECTOR_LIMITS.auditBacklog && this.hung === 0) {
      void this.record(event)
      return
    }
    const kept: AuditEvent = { ...event, callId: undefined, operationId: undefined }
    const key = JSON.stringify(kept)
    const entry = this.tally.get(key)
    if (entry === undefined) this.tally.set(key, { event: kept, count: 1 })
    else entry.count += 1
  }
}
