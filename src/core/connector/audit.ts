// M124 (D106, design §6): a scrubbed, schema-versioned receipt for every
// call transition, transport refusal and owner command. Private text enters
// only as a keyed digest, so the journal is no guessing oracle. A failed
// append refuses new effects (callers check `record`'s answer); Stop never
// waits for it. A receipt not durable within `auditTimeoutMs` failed, and a
// journal with such a hung append counts as failed until that append
// answers, so a stuck disk can neither hold calls nor pile up handles.
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
  private readonly waiting: (() => void)[] = []

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
      if (this.writing < CONNECTOR_LIMITS.auditBacklog)
        for (const wake of this.waiting.splice(0)) wake()
    }
  }

  /** Resolves when fewer than `auditBacklog` receipts are being written. */
  public ready(): Promise<void> {
    return this.writing < CONNECTOR_LIMITS.auditBacklog
      ? Promise.resolve()
      : new Promise((resolve) => {
          this.waiting.push(resolve)
        })
  }
}
