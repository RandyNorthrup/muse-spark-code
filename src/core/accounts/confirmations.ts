// D88.6: machine-local decisions. The owning host supplies private local I/O;
// neither a webview nor a device supplies the machine or the policy stamp.
import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import {
  accountConfirmationChoiceSchema,
  accountConfirmationSchema,
  type AccountConfirmation,
} from '../../shared/accounts'
import type { AccountPolicy } from '../providers/accountPolicy'

const storedSchema = z.strictObject({
  confirmation: accountConfirmationSchema,
  policyDigest: z.string().check(z.regex(/^[a-f0-9]{64}$/)),
})
type StoredConfirmation = z.infer<typeof storedSchema>

export interface AccountConfirmationStore {
  read(provider: string, product: string): Promise<unknown>
  write(provider: string, product: string, value: StoredConfirmation): Promise<void>
  remove(provider: string, product: string): Promise<void>
}

/** Changes to clauses or decisions invalidate consent even without a version bump. */
function digest(row: AccountPolicy): string {
  return createHash('sha256').update(JSON.stringify(row)).digest('hex')
}

export interface AccountPolicyGrant {
  readonly choice: AccountConfirmation['choice']
  /** Synchronous final fence. Revocation takes effect before its disk write. */
  readonly isCurrent: (row: AccountPolicy | undefined) => boolean
}

export class AccountConfirmations {
  private readonly generations = new Map<string, number>()
  private readonly revoked = new Set<string>()
  private readonly pending = new Map<
    string,
    {
      readonly generation: number
      readonly stamp: string
      readonly result: Promise<AccountPolicyGrant | undefined>
    }
  >()
  private writes: Promise<void> = Promise.resolve()

  public constructor(
    private readonly deps: {
      readonly machineId: string
      readonly store: AccountConfirmationStore
      readonly now: () => number
      readonly ask: (row: AccountPolicy) => Promise<unknown>
    },
  ) {}

  private key(row: Pick<AccountPolicy, 'provider' | 'product'>): string {
    return JSON.stringify([row.provider, row.product])
  }

  private grant(row: AccountPolicy, choice: AccountConfirmation['choice']): AccountPolicyGrant {
    const key = this.key(row)
    const generation = this.generations.get(key) ?? 0
    const stamp = digest(row)
    return {
      choice,
      isCurrent: (current) =>
        current !== undefined &&
        digest(current) === stamp &&
        (this.generations.get(key) ?? 0) === generation,
    }
  }

  private async write(use: () => Promise<void>): Promise<void> {
    const previous = this.writes
    const operation = (async () => {
      await previous
      await use()
    })()
    this.writes = (async () => {
      try {
        await operation
      } catch {
        // The caller receives the failure; a later revoke must still run.
      }
    })()
    await operation
  }

  private async decide(row: AccountPolicy): Promise<AccountPolicyGrant | undefined> {
    const key = this.key(row)
    const generation = this.generations.get(key) ?? 0
    const answer = await this.deps.ask(row)
    if (generation !== (this.generations.get(key) ?? 0)) return
    const choice = accountConfirmationChoiceSchema.parse(answer)
    const confirmation = accountConfirmationSchema.parse({
      machineId: this.deps.machineId,
      provider: row.provider,
      product: row.product,
      recordVersion: row.recordVersion,
      recordCheckedAt: row.checkedAt,
      answeredAt: new Date(this.deps.now()).toISOString(),
      choice,
    })
    await this.write(async () => {
      if (generation !== (this.generations.get(key) ?? 0)) return
      await this.deps.store.write(row.provider, row.product, {
        confirmation,
        policyDigest: digest(row),
      })
    })
    if (generation !== (this.generations.get(key) ?? 0)) return
    // Publishing fresh authority invalidates every storage read begun before it.
    this.generations.set(key, generation + 1)
    this.revoked.delete(key)
    return this.grant(row, choice)
  }

  /** Stored data is untrusted and has no authority outside this exact machine/row. */
  public async read(row: AccountPolicy): Promise<AccountPolicyGrant | undefined> {
    const snapshot = structuredClone(row)
    const key = this.key(snapshot)
    if (this.revoked.has(key)) return
    const generation = this.generations.get(key) ?? 0
    const parsed = storedSchema.safeParse(
      await this.deps.store.read(snapshot.provider, snapshot.product),
    )
    if (!parsed.success || this.revoked.has(key) || generation !== (this.generations.get(key) ?? 0))
      return
    const { confirmation, policyDigest } = parsed.data
    if (
      confirmation.machineId !== this.deps.machineId ||
      confirmation.provider !== snapshot.provider ||
      confirmation.product !== snapshot.product ||
      confirmation.recordVersion !== snapshot.recordVersion ||
      confirmation.recordCheckedAt !== snapshot.checkedAt ||
      Date.parse(confirmation.answeredAt) > this.deps.now() ||
      !Number.isFinite(this.deps.now()) ||
      policyDigest !== digest(snapshot)
    )
      return
    return this.grant(snapshot, confirmation.choice)
  }

  /** Headless reads only; interactive concurrent admissions share one question. */
  public async obtain(
    row: AccountPolicy,
    isInteractive: boolean,
  ): Promise<AccountPolicyGrant | undefined> {
    const snapshot = structuredClone(row)
    if (!isInteractive) return await this.read(snapshot)
    const key = this.key(snapshot)
    const stamp = digest(snapshot)
    const generation = this.generations.get(key) ?? 0
    const pending = this.pending.get(key)
    if (pending?.stamp === stamp && pending.generation === generation) return await pending.result
    if (pending?.generation === generation) this.generations.set(key, generation + 1)
    const ownedGeneration = this.generations.get(key) ?? 0
    // Install the owner before any I/O, including the initial storage read.
    const result = (async () => {
      await Promise.resolve()
      const existing = await this.read(snapshot)
      if (ownedGeneration !== (this.generations.get(key) ?? 0)) return
      return existing ?? (await this.decide(snapshot))
    })()
    const owned = { generation: ownedGeneration, stamp, result }
    this.pending.set(key, owned)
    try {
      return await result
    } finally {
      if (this.pending.get(key) === owned) this.pending.delete(key)
    }
  }

  public async revoke(provider: string, product: string): Promise<void> {
    const key = this.key({ provider, product })
    this.revoked.add(key)
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1)
    await this.write(async () => {
      await this.deps.store.remove(provider, product)
    })
  }
}
