import { NodeTransactions } from './transactions'
// One atomic transaction holds state and the bounded, hash-chained audit.
// Sessions, bearer tokens and unsealed keys never enter this file (H06/H15).
import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import {
  NODE_DAYS_TO_MS,
  NODE_PROTOCOL_VERSION,
  NODE_STATE_FILE,
  NODE_STATE_MAX_BYTES,
  NODE_ZERO_DIGEST,
  UI_TEXT,
} from '../../shared/constants'
import { nodeAuditSchema, nodeStateSchema, type NodeAudit, type NodeState } from '../../shared/node'
import { nodeDigestSchema, nodeTimeSchema } from '../../shared/nodeAuth'
import { migrateNodeState, type NodeMigration } from './migrations'
import { isMissingFile, NodePrivateFiles } from './privateFiles'

const head = z.strictObject({ seq: nodeTimeSchema, hash: nodeDigestSchema })
const snapshotSchema = z.strictObject({
  v: z.literal(NODE_PROTOCOL_VERSION),
  state: nodeStateSchema,
  anchor: head,
  entries: z.array(nodeAuditSchema),
})
type Snapshot = z.infer<typeof snapshotSchema>
type AuditDetails = NodeAudit extends infer Entry
  ? Entry extends NodeAudit
    ? Omit<Entry, 'v' | 'seq' | 'nodeId' | 'previousHash' | 'hash'>
    : never
  : never

/** Stable field ordering makes hash verification independent of JSON key order. */
function auditDigest(entry: NodeAudit): string {
  const { hash: _hash, ...fields } = entry
  const canonical = Object.fromEntries(
    Object.entries(fields).toSorted(([a], [b]) => a.localeCompare(b, 'en')),
  )
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

function verify(snapshot: Snapshot): void {
  let previous = snapshot.anchor
  for (const entry of snapshot.entries) {
    if (
      entry.seq !== previous.seq + 1 ||
      entry.previousHash !== previous.hash ||
      entry.nodeId !== snapshot.state.nodeId ||
      entry.hash !== auditDigest(entry)
    )
      throw new Error(UI_TEXT.nodeErrors.invalidRequest)
    previous = entry
  }
  if (
    previous.seq !== snapshot.state.auditHead.seq ||
    previous.hash !== snapshot.state.auditHead.hash
  ) {
    throw new Error(UI_TEXT.nodeErrors.invalidRequest)
  }
}

export class NodeStateStore {
  private readonly transactions = new NodeTransactions()
  private snapshot: Snapshot | undefined
  readonly files: NodePrivateFiles

  constructor(root: string) {
    this.files = new NodePrivateFiles(root)
  }

  private required(): Snapshot {
    if (this.snapshot === undefined) throw new Error(UI_TEXT.nodeErrors.unavailable)
    return this.snapshot
  }

  private async publish(snapshot: Snapshot): Promise<void> {
    verify(snapshotSchema.parse(snapshot))
    const text = JSON.stringify(snapshot)
    if (Buffer.byteLength(text) > NODE_STATE_MAX_BYTES) throw new Error(UI_TEXT.nodeErrors.tooLarge)
    await this.files.write(NODE_STATE_FILE, text)
    this.snapshot = snapshot
  }

  async initialize(state: NodeState): Promise<void> {
    await this.transactions.enqueue(async () => {
      await this.files.prepare()
      try {
        await this.files.read(NODE_STATE_FILE, NODE_STATE_MAX_BYTES)
        throw new Error(UI_TEXT.nodeErrors.conflict)
      } catch (error: unknown) {
        if (!isMissingFile(error)) throw error
      }
      const parsed = nodeStateSchema.parse(state)
      if (parsed.auditHead.seq !== 0 || parsed.auditHead.hash !== NODE_ZERO_DIGEST) {
        throw new Error(UI_TEXT.nodeErrors.invalidRequest)
      }
      await this.publish({
        v: NODE_PROTOCOL_VERSION,
        state: parsed,
        anchor: parsed.auditHead,
        entries: [],
      })
    })
  }

  async load(migrations: readonly NodeMigration[] = []): Promise<NodeState> {
    return await this.transactions.enqueue(async () => {
      const bytes = await this.files.read(NODE_STATE_FILE, NODE_STATE_MAX_BYTES)
      const input: unknown = JSON.parse(bytes)
      const envelope = z
        .strictObject({
          v: z.literal(NODE_PROTOCOL_VERSION),
          state: z.unknown(),
          anchor: head,
          entries: z.array(nodeAuditSchema),
        })
        .parse(input)
      const state = await migrateNodeState(envelope.state, migrations, async (old, from) => {
        await this.files.write(`state.before-v${String(from)}.json`, JSON.stringify(old))
      })
      const snapshot = snapshotSchema.parse({ ...envelope, state })
      verify(snapshot)
      this.snapshot = snapshot
      return structuredClone(state)
    })
  }

  read(): NodeState {
    if (this.snapshot === undefined) throw new Error(UI_TEXT.nodeErrors.unavailable)
    return structuredClone(this.snapshot.state)
  }

  audit(): NodeAudit[] {
    if (this.snapshot === undefined) throw new Error(UI_TEXT.nodeErrors.unavailable)
    return structuredClone(this.snapshot.entries)
  }

  /** Generation check prevents a stale auth enrollment or UI write overwriting another. */
  async update(
    expectedGeneration: number,
    change: (state: NodeState) => NodeState,
  ): Promise<NodeState> {
    return await this.transactions.enqueue(async () => {
      const old = this.required()
      if (old.state.generation !== expectedGeneration) throw new Error(UI_TEXT.nodeErrors.conflict)
      const state = nodeStateSchema.parse(change(structuredClone(old.state)))
      if (
        state.nodeId !== old.state.nodeId ||
        state.ownerId !== old.state.ownerId ||
        state.auditHead.seq !== old.state.auditHead.seq ||
        state.auditHead.hash !== old.state.auditHead.hash
      )
        throw new Error(UI_TEXT.nodeErrors.invalidRequest)
      state.generation = old.state.generation + 1
      await this.publish({ ...old, state })
      return structuredClone(state)
    })
  }

  async append(details: AuditDetails): Promise<NodeAudit> {
    return await this.transactions.enqueue(async () => {
      const old = this.required()
      const entry = nodeAuditSchema.parse({
        ...details,
        v: NODE_PROTOCOL_VERSION,
        seq: old.state.auditHead.seq + 1,
        nodeId: old.state.nodeId,
        previousHash: old.state.auditHead.hash,
        hash: NODE_ZERO_DIGEST,
      })
      entry.hash = auditDigest(entry)
      const snapshot = structuredClone(old)
      snapshot.entries.push(entry)
      snapshot.state.auditHead = { seq: entry.seq, hash: entry.hash }
      snapshot.state.generation += 1
      const oldest = entry.time - snapshot.state.config.audit.retentionDays * NODE_DAYS_TO_MS
      while (
        snapshot.entries.length > 0 &&
        ((snapshot.entries[0]?.time ?? entry.time) < oldest ||
          Buffer.byteLength(JSON.stringify(snapshot.entries)) >
            snapshot.state.config.audit.maxBytes)
      ) {
        const removed = snapshot.entries.shift()
        if (removed !== undefined) snapshot.anchor = { seq: removed.seq, hash: removed.hash }
      }
      await this.publish(snapshot)
      return structuredClone(entry)
    })
  }
}
