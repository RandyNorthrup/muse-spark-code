// M96d machine coordinator (PLAN.md D75): the pure grant state machine.
//
// The ledger's engine: whole-vector admission, the launch protocol,
// frozen-holder exclusion and conjunctive retirement, with no clock,
// no timer and no I/O. The durable shell (`ledger.ts`) journals every
// transition before it is acknowledged; this module decides what the
// transitions are. A resource is available only when every previous
// grant on it has a complete retirement proof (the design's §1).

import * as z from 'zod/mini'
import {
  COORDINATOR_GRANT_ID_MAX_CHARS,
  COORDINATOR_OWNER_MAX_CHARS,
  COORDINATOR_RESOURCE_MAX_CHARS,
} from '../../../shared/constants'
import {
  coordinatorReferenceSchema,
  isSameCoordinatorReference,
  isStableCoordinatorReference,
  type CoordinatorReference,
} from './references'

const grantId = z.string().check(z.minLength(1), z.maxLength(COORDINATOR_GRANT_ID_MAX_CHARS))
const ownerId = z.string().check(z.minLength(1), z.maxLength(COORDINATOR_OWNER_MAX_CHARS))
const resourceId = z
  .string()
  .check(z.minLength(1), z.maxLength(COORDINATOR_RESOURCE_MAX_CHARS))
  .check(z.refine((value) => !value.includes('\0') && value.trim() === value))

const grantPhaseSchema = z.enum([
  'reserved',
  'intent',
  'spawned',
  'registered',
  'running',
  'terminal',
])

export const grantRecordSchema = z.strictObject({
  id: grantId,
  owner: ownerId,
  resources: z.array(resourceId).check(z.minLength(1)),
  phase: grantPhaseSchema,
  reference: z.optional(coordinatorReferenceSchema),
  scopeCoverage: z.enum(['complete', 'unknown']),
  pendingRename: z.boolean(),
  /** Set once, at the terminal transition; retried acknowledgements read it back. */
  outcome: z.optional(
    z.strictObject({ epoch: z.string().check(z.minLength(1)), token: z.string() }),
  ),
  /** The caller confirmed it received the terminal outcome; collection may drop the tombstone. */
  acknowledged: z.boolean(),
})
export type CoordinatorGrantRecord = z.infer<typeof grantRecordSchema>

export const retirementProofSchema = z.strictObject({
  grant: grantId,
  epoch: z.string().check(z.minLength(1)),
  reference: coordinatorReferenceSchema,
  treeEmpty: z.boolean(),
  effectsDrained: z.boolean(),
})
export type CoordinatorRetirementProof = z.infer<typeof retirementProofSchema>

export type CoordinatorGrantRefusal = 'grantReused' | 'resourcesHeld' | 'unknownGrant' | 'badPhase'

/** A caller-bug refusal that names its cause with the grant. */
export class CoordinatorGrantError extends Error {
  public constructor(
    public readonly code: CoordinatorGrantRefusal,
    message: string,
  ) {
    super(message)
    this.name = 'CoordinatorGrantError'
  }
}

export function isCoordinatorGrantError(value: unknown): value is CoordinatorGrantError {
  return value instanceof Error && value.name === 'CoordinatorGrantError'
}

/** A record's parsed copy, detached from the caller's object. */
function indexedCopy(record: CoordinatorGrantRecord): CoordinatorGrantRecord {
  const checked = grantRecordSchema.parse(record)
  return { ...checked, resources: [...checked.resources] }
}

/**
The window- and machine-shared grant engine. One instance per ledger
custody; the durable shell snapshots before every mutation and
restores when its sync fails, so memory never runs ahead of disk.
*/
export class CoordinatorGrants {
  private readonly grants = new Map<string, CoordinatorGrantRecord>()
  private isReachable = true

  public constructor(private readonly custody: string) {}

  private requireGrant(id: string): CoordinatorGrantRecord {
    const record = this.grants.get(grantId.parse(id))
    if (record === undefined) throw new CoordinatorGrantError('unknownGrant', `Unknown grant ${id}`)
    return record
  }

  /** This custody's epoch: proofs name it, and only it settles here. */
  get epoch(): string {
    return this.custody
  }

  /** The live grants, cloned; the shell persists this shape. */
  snapshot(): CoordinatorGrantRecord[] {
    return Array.from(this.grants.values(), (record) => ({
      ...record,
      resources: [...record.resources],
      ...(record.reference !== undefined && { reference: { ...record.reference } }),
      ...(record.outcome !== undefined && { outcome: { ...record.outcome } }),
    }))
  }

  /** Restore a snapshot: the shell's sync-failure rollback, nothing else. */
  restore(records: readonly CoordinatorGrantRecord[]): void {
    this.grants.clear()
    for (const record of records) {
      const copy = indexedCopy(record)
      this.grants.set(copy.id, copy)
    }
  }

  /**
  Retain loaded grants under a fresh custody: open work keeps every
  resource while dropping all reference authority, terminal
  tombstones carry over untouched. Persisted identities are
  reconciliation evidence, never recovered handles.
  */
  retainLoaded(records: readonly CoordinatorGrantRecord[]): void {
    this.grants.clear()
    for (const record of records) {
      const copy = indexedCopy(record)
      this.grants.set(copy.id, {
        ...copy,
        ...(copy.phase !== 'terminal' && {
          reference: undefined,
          scopeCoverage: 'unknown' as const,
        }),
      })
    }
  }

  get reachable(): boolean {
    return this.isReachable
  }

  /** Whole-vector admission: any held overlap refuses the entire grant. */
  reserve(id: string, owner: string, resources: readonly string[]): void {
    const grant = grantId.parse(id)
    if (this.grants.has(grant))
      throw new CoordinatorGrantError('grantReused', `Grant ${grant} is already recorded`)
    const validatedOwner = ownerId.parse(owner)
    const validated = z
      .array(resourceId)
      .check(z.minLength(1))
      .parse([...resources])
    for (const held of this.grants.values()) {
      if (
        held.phase !== 'terminal' &&
        held.resources.some((resource) => validated.includes(resource))
      )
        throw new CoordinatorGrantError('resourcesHeld', `Grant ${grant} overlaps held resources`)
    }
    this.grants.set(grant, {
      id: grant,
      owner: validatedOwner,
      resources: validated,
      phase: 'reserved',
      reference: undefined,
      scopeCoverage: 'unknown',
      pendingRename: false,
      outcome: undefined,
      acknowledged: false,
    })
  }

  held(id: string): readonly string[] {
    const record = this.grants.get(id)
    return record === undefined || record.phase === 'terminal' ? [] : [...record.resources]
  }

  retirementState(id: string): 'active' | 'unknown' | 'finished' {
    const record = this.grants.get(id)
    if (record?.phase === 'terminal') return 'finished'
    return record?.scopeCoverage === 'complete' ? 'active' : 'unknown'
  }

  endpointFailed(_error: string): void {
    // An endpoint failure marks reachability only: it never elects,
    // releases or retires anything.
    this.isReachable = false
  }

  electSuccessor(hasAnchor: boolean): boolean {
    // Only a qualified exclusive anchor admits a successor, and the
    // successor inherits every open grant; reachability alone elects nothing.
    return hasAnchor
  }

  persistIntent(id: string): void {
    const record = this.requireGrant(id)
    if (record.phase !== 'reserved')
      throw new CoordinatorGrantError('badPhase', `Grant ${id} is not at that launch phase`)
    record.phase = 'intent'
  }

  spawn(id: string): void {
    const record = this.requireGrant(id)
    if (record.phase !== 'intent')
      throw new CoordinatorGrantError('badPhase', `Grant ${id} is not at that launch phase`)
    record.phase = 'spawned'
  }

  register(
    id: string,
    reference: CoordinatorReference,
    scopeCoverage: 'complete' | 'unknown',
  ): void {
    const record = this.requireGrant(id)
    if (record.phase !== 'spawned')
      throw new CoordinatorGrantError('badPhase', `Grant ${id} is not at that launch phase`)
    record.reference = coordinatorReferenceSchema.parse(reference)
    record.scopeCoverage = scopeCoverage
    record.phase = 'registered'
  }

  resume(id: string): void {
    const record = this.requireGrant(id)
    if (record.phase !== 'registered')
      throw new CoordinatorGrantError('badPhase', `Grant ${id} is not at that launch phase`)
    record.phase = 'running'
  }

  ownerExited(_owner: string): void {
    // Owner death cannot discharge pending launches, descendants or effects.
  }

  freezeBeforeRename(id: string): void {
    const record = this.requireGrant(id)
    if (record.phase !== 'running')
      throw new CoordinatorGrantError('badPhase', `Grant ${id} is not at that launch phase`)
    record.pendingRename = true
  }

  userConfirmedStopped(_id: string): boolean {
    // A user's confirmation is an assertion, never retirement proof.
    return false
  }

  completePendingRename(id: string): boolean {
    const record = this.grants.get(grantId.parse(id))
    if (record?.pendingRename !== true) return false
    record.pendingRename = false
    return true
  }

  settle(proof: CoordinatorRetirementProof): 'released' | 'duplicate' | 'refused' {
    const checked = retirementProofSchema.parse(proof)
    const record = this.grants.get(checked.grant)
    if (record?.outcome !== undefined) return 'duplicate'
    if (
      record === undefined ||
      checked.epoch !== this.custody ||
      record.reference === undefined ||
      record.phase === 'terminal' ||
      record.pendingRename ||
      record.scopeCoverage !== 'complete' ||
      !checked.treeEmpty ||
      !checked.effectsDrained ||
      !checked.reference.exited ||
      !isSameCoordinatorReference(record.reference, checked.reference) ||
      !isStableCoordinatorReference(checked.reference)
    )
      return 'refused'
    record.phase = 'terminal'
    record.outcome = { epoch: this.custody, token: checked.reference.token }
    return 'released'
  }

  outcomeOf(id: string): { epoch: string; token: string } | undefined {
    // A lost terminal acknowledgement retries the same grant and reads
    // its recorded outcome back; it never refunds twice.
    const outcome = this.grants.get(grantId.parse(id))?.outcome
    return outcome === undefined ? undefined : { ...outcome }
  }

  acknowledgeSettled(id: string): boolean {
    const record = this.grants.get(grantId.parse(id))
    if (record?.phase !== 'terminal' || record.acknowledged) return false
    record.acknowledged = true
    return true
  }

  collectAcknowledged(): readonly string[] {
    const dropped: string[] = []
    for (const record of this.grants.values()) {
      if (record.phase === 'terminal' && record.acknowledged) dropped.push(record.id)
    }
    for (const id of dropped) this.grants.delete(id)
    return dropped
  }
}
