// M124 (D106, design §6): a scrubbed, schema-versioned receipt for every
// call, refusal, decision and outcome. Private text enters only as a keyed
// digest, so the journal is no guessing oracle. A failed append refuses new
// effects (the registry checks `record`'s answer); Stop never waits for it.
import { createHmac } from 'node:crypto'
import { CONNECTOR_SCHEMA_VERSION } from '../../shared/constants'
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

  public constructor(
    private readonly port: AuditPort,
    private readonly connectionId: string,
    private readonly now: () => number,
    private readonly scrub: (text: string) => string,
  ) {}

  /** HMAC-SHA256 of the canonical value under the audit key. */
  public async digest(value: unknown): Promise<string> {
    this.key ??= this.port.key()
    return createHmac('sha256', await this.key)
      .update(canonicalJson(value))
      .digest('hex')
  }

  /** True once the line is durable; false when the journal failed. */
  public async record(event: AuditEvent): Promise<boolean> {
    try {
      const record = connectorAuditSchema.parse({
        ...event,
        schemaVersion: CONNECTOR_SCHEMA_VERSION,
        at: new Date(this.now()).toISOString(),
        connectionId: this.connectionId,
        // Tool names arrive from the client: an unknown one is scrubbed text.
        ...(event.tool !== undefined && { tool: this.scrub(event.tool) }),
      })
      await this.port.append(`${JSON.stringify(record)}\n`)
      return true
    } catch {
      return false
    }
  }
}
