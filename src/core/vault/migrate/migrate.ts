import { VAULT_LEGACY_RETAIN_RELEASES } from '../../../shared/constants'
import { type VaultItem } from '../../../shared/vault'
import { vaultPrivateReadSchema } from '../../../shared/vaultProtocol'
import { eraseItem, itemDigest, areSameBytes, validateMigrationItem } from './material'
import {
  migrationRecordSchema,
  VaultMigrationFault,
  type MigrationCredential,
  type MigrationDeps,
  type MigrationLease,
  type MigrationRecord,
} from './ports'

/**
 * Journal note recorded when a finished retire finds the legacy copy
 * already absent: the engine deleted nothing, and the note says so, so the
 * join can tell a watched retire from a possibly raced external deletion.
 */
const RETIRE_RESUMED_WITHOUT_COPY_NOTE = 'retire intent resumed with the legacy copy already absent'

/** Private management service. No method is exposed to agent tools or the public protocol. */
export class VaultMigration {
  private readonly credentials: ReadonlyMap<string, MigrationCredential>
  constructor(
    private readonly deps: MigrationDeps,
    credentials: readonly MigrationCredential[],
  ) {
    this.credentials = new Map(
      credentials.map((entry) => {
        const request = entry.request === null ? null : vaultPrivateReadSchema.parse(entry.request)
        if (request !== null && request.itemId !== entry.itemId)
          throw new VaultMigrationFault('invalid')
        // A credential's declared name must equal the name its decode
        // builds: otherwise two credentials with different declared names
        // could still meet on one decoded name and reproduce at migrate the
        // R2 conflict the shared-name refusal rules out before any write.
        // The wrapper is bound here, in the constructor, and refuses with
        // `conflict` before any journal row, comparison or write. A decoded
        // item that fails the check is wiped before the throw.
        const checked: MigrationCredential = {
          ...entry,
          request,
          decode(value) {
            const item = entry.decode(value)
            if (item.metadata.name !== entry.name) {
              eraseItem(item)
              throw new VaultMigrationFault('conflict')
            }
            return item
          },
        }
        return [entry.key, checked]
      }),
    )
    if (
      this.credentials.size !== credentials.length ||
      new Set(credentials.map((entry) => entry.itemId)).size !== credentials.length ||
      new Set(credentials.map((entry) => entry.name)).size !== credentials.length
    )
      throw new VaultMigrationFault('conflict')
  }
  private credential(key: string): MigrationCredential {
    const entry = this.credentials.get(key)
    if (!entry) throw new VaultMigrationFault('invalid')
    return entry
  }
  private async run<T>(work: (lease: MigrationLease) => Promise<T>): Promise<T> {
    try {
      return await this.deps.owner.run(work)
    } catch (error: unknown) {
      if (error instanceof VaultMigrationFault) throw error
      throw new VaultMigrationFault('storage')
    }
  }
  private currentRelease(): number {
    const current = this.deps.minorRelease()
    if (!Number.isSafeInteger(current) || current < 0) throw new VaultMigrationFault('invalid')
    return current
  }
  private async record(
    entry: MigrationCredential,
    lease: MigrationLease,
  ): Promise<MigrationRecord | null> {
    const raw = await this.deps.journal.read(entry.key)
    lease.assertCurrent()
    if (raw === null) return null
    const row = migrationRecordSchema.parse(raw)
    if (
      row.key !== entry.key ||
      row.itemId !== entry.itemId ||
      row.sourceId !== this.deps.journal.sourceId
    )
      throw new VaultMigrationFault('conflict')
    return row
  }
  private async save(row: MigrationRecord, lease: MigrationLease): Promise<void> {
    lease.assertCurrent()
    await this.deps.journal.write(migrationRecordSchema.parse(row), () => {
      lease.assertCurrent()
    })
    lease.assertCurrent()
  }
  private intent(
    entry: MigrationCredential,
    item: VaultItem,
    phase: 'copying' | 'writing',
    shouldRetainLegacy: boolean,
    startedRelease: number,
  ): MigrationRecord {
    return {
      key: entry.key,
      sourceId: this.deps.journal.sourceId,
      itemId: entry.itemId,
      startedRelease,
      retainLegacy: shouldRetainLegacy,
      phase,
      digest: itemDigest(item),
    }
  }
  private async persistCopy(
    row: MigrationRecord,
    item: VaultItem,
    lease: MigrationLease,
  ): Promise<void> {
    await this.save(row, lease)
    lease.assertCurrent()
    await this.deps.vault.write(item, () => {
      lease.assertCurrent()
    })
    lease.assertCurrent()
    await this.verified(row, lease)
  }
  private async verified(row: MigrationRecord, lease: MigrationLease): Promise<void> {
    let item: VaultItem | undefined
    try {
      item = await this.deps.vault.read(row.itemId)
      lease.assertCurrent()
      validateMigrationItem(item, row.itemId)
      if (itemDigest(item) !== row.digest) throw new VaultMigrationFault('verification')
    } finally {
      eraseItem(item)
    }
  }
  private async removeLegacy(key: string, lease: MigrationLease): Promise<void> {
    let remaining: Uint8Array | null = null
    try {
      lease.assertCurrent()
      await this.deps.legacy.remove(key, () => {
        lease.assertCurrent()
      })
      lease.assertCurrent()
      remaining = await this.deps.legacy.read(key)
      lease.assertCurrent()
      if (remaining !== null) throw new VaultMigrationFault('verification')
    } finally {
      remaining?.fill(0)
    }
  }
  /**
   * Drop the vault copy when it is still there. A crash past the vault
   * remove leaves nothing to drop, and the remove refuses a missing id, so
   * the list decides instead of the error shape.
   */
  private async removeVaultCopyIfPresent(
    entry: MigrationCredential,
    lease: MigrationLease,
  ): Promise<void> {
    const listed = await this.deps.vault.list()
    lease.assertCurrent()
    if (listed.every((metadata) => metadata.id !== entry.itemId)) return
    await this.deps.vault.remove(entry.itemId, () => {
      lease.assertCurrent()
    })
    lease.assertCurrent()
  }
  private async mirror(
    entry: MigrationCredential,
    row: MigrationRecord,
    lease: MigrationLease,
  ): Promise<void> {
    let item: VaultItem | undefined
    let bytes: Uint8Array | undefined
    let reread: Uint8Array | null = null
    try {
      item = await this.deps.vault.read(entry.itemId)
      lease.assertCurrent()
      validateMigrationItem(item, entry.itemId)
      if (itemDigest(item) !== row.digest) throw new VaultMigrationFault('verification')
      bytes = entry.encode(item)
      lease.assertCurrent()
      await this.deps.legacy.write(entry.key, bytes, () => {
        lease.assertCurrent()
      })
      lease.assertCurrent()
      reread = await this.deps.legacy.read(entry.key)
      lease.assertCurrent()
      if (!areSameBytes(bytes, reread)) throw new VaultMigrationFault('verification')
    } finally {
      reread?.fill(0)
      bytes?.fill(0)
      eraseItem(item)
    }
  }
  private async verifyLegacy(
    entry: MigrationCredential,
    row: MigrationRecord,
    lease: MigrationLease,
  ): Promise<void> {
    let item: VaultItem | undefined
    let legacyItem: VaultItem | undefined
    let source: Uint8Array | null = null
    let current: Uint8Array | undefined
    let old: Uint8Array | undefined
    try {
      item = await this.deps.vault.read(entry.itemId)
      lease.assertCurrent()
      validateMigrationItem(item, entry.itemId)
      if (itemDigest(item) !== row.digest) throw new VaultMigrationFault('verification')
      source = await this.deps.legacy.read(entry.key)
      lease.assertCurrent()
      // A previously completed delete may precede a crashed journal commit.
      if (source === null) return
      legacyItem = entry.decode(source)
      validateMigrationItem(legacyItem, entry.itemId)
      current = entry.encode(item)
      old = entry.encode(legacyItem)
      if (!areSameBytes(current, old)) throw new VaultMigrationFault('conflict')
    } finally {
      old?.fill(0)
      current?.fill(0)
      source?.fill(0)
      eraseItem(legacyItem)
      eraseItem(item)
    }
  }
  /**
   * Whether the legacy copy is absent while the slot still retains it. Only
   * an `active` slot with `retainLegacy` can report this: a retired slot
   * owns no legacy copy, and every other phase is refused before this runs.
   */
  /**
   * Finish a retire the engine itself started: the journal already carries
   * the retire intent, so the missing legacy copy is evidence of an
   * interrupted retire, never of a user deletion. When the legacy copy is
   * already absent, verifies only the vault digest and records `retired`
   * with a note saying the engine did not see the delete. When a legacy
   * copy is still present, compares it before deleting, so a change that
   * landed after the intent still refuses.
   */
  private async finishInterruptedRetire(
    entry: MigrationCredential,
    row: MigrationRecord,
    lease: MigrationLease,
  ): Promise<void> {
    const base = { ...row }
    delete base.retireIntent
    if (await this.legacyAbsent(entry, lease)) {
      await this.verified(row, lease)
      base.retireNote = RETIRE_RESUMED_WITHOUT_COPY_NOTE
    } else {
      await this.verifyLegacy(entry, row, lease)
      await this.removeLegacy(entry.key, lease)
    }
    await this.save(
      { ...base, retainLegacy: false, phase: 'retired', retirementNoticePending: true },
      lease,
    )
    this.deps.onRetired(entry.key)
    await this.save(
      { ...base, retainLegacy: false, phase: 'retired', retirementNoticePending: false },
      lease,
    )
  }
  /**
   * Finish one pending retire intent: a present copy the engine verifies is
   * deleted and the slot is recorded `retired`; an absent one is recorded
   * `retired` with a note saying the engine did not see the delete. A copy
   * changed after the intent is left alone — the engine deletes nobody
   * else's bytes — its stale intent is cleared so the change reads honestly,
   * and `diverged` is reported instead of throwing. A vault-side failure is
   * told apart from a changed legacy copy: the vault is re-verified before
   * the row is touched, so a vault-side failure propagates with the intent
   * intact and only a healthy vault with a changed copy reports `diverged`.
   */
  private async finishOneIntent(
    entry: MigrationCredential,
    row: MigrationRecord,
    lease: MigrationLease,
  ): Promise<'retired' | 'diverged'> {
    if (await this.legacyAbsent(entry, lease)) {
      await this.finishInterruptedRetire(entry, row, lease)
      return 'retired'
    }
    try {
      await this.finishInterruptedRetire(entry, row, lease)
      return 'retired'
    } catch (error: unknown) {
      if (
        error instanceof VaultMigrationFault &&
        (error.code === 'conflict' || error.code === 'invalid')
      ) {
        // The failure may be the vault's, not the legacy copy's: re-verify
        // the vault digest before touching the row. A vault-side failure
        // throws here with the retire intent intact; only a vault that still
        // verifies proves the copy changed, and only then is the stale
        // intent cleared.
        await this.verified(row, lease)
        const base = { ...row }
        delete base.retireIntent
        delete base.retireNote
        await this.save(base, lease)
        return 'diverged'
      }
      throw error
    }
  }
  /**
   * Whether the legacy copy is absent. The read buffer is owned inside a
   * `try` that already exists before the first await: a stale lease refuses
   * only after the buffer is wiped, so no refusal path leaves key material
   * live. Every other helper that holds key material follows the same shape
   * (the `try` opens before the first await); this one did not, and a lease
   * invalidated between the read and the assert left the returned bytes
   * unwiped.
   */
  private async legacyAbsent(entry: MigrationCredential, lease: MigrationLease): Promise<boolean> {
    let source: Uint8Array | null = null
    try {
      source = await this.deps.legacy.read(entry.key)
      lease.assertCurrent()
      return source === null
    } finally {
      source?.fill(0)
    }
  }
  /**
   * Whether the legacy copy changed since the migration, reusing
   * `verifyLegacy` (which wipes every buffer): a legacy copy that no longer
   * verifies against the vault — mismatched or undecodable — reports a
   * boolean instead of throwing. Anything else, including the vault itself,
   * still throws.
   */
  private async legacyDiverged(
    entry: MigrationCredential,
    row: MigrationRecord,
    lease: MigrationLease,
  ): Promise<boolean> {
    try {
      await this.verifyLegacy(entry, row, lease)
      return false
    } catch (error: unknown) {
      if (
        error instanceof VaultMigrationFault &&
        (error.code === 'conflict' || error.code === 'invalid')
      )
        return true
      throw error
    }
  }
  /**
   * The legacy copy must still be the bytes this store call carries: a save
   * that landed after the caller read refuses with `conflict` instead of
   * being overwritten with the older value, and the next unlock heals the
   * newer one. An absent copy refuses the same way.
   */
  private async assertLegacyMatches(
    entry: MigrationCredential,
    snapshot: Uint8Array,
    lease: MigrationLease,
  ): Promise<void> {
    let live: Uint8Array | null = null
    try {
      live = await this.deps.legacy.read(entry.key)
      lease.assertCurrent()
      if (!areSameBytes(snapshot, live)) throw new VaultMigrationFault('conflict')
    } finally {
      live?.fill(0)
    }
  }
  /**
   * One store inside the caller's lease (never nested in `run`). Checks the
   * legacy copy still matches before the vault write and again before the
   * legacy write, so a newer save is never overwritten with older bytes.
   */
  private async storeInLease(
    entry: MigrationCredential,
    snapshot: Uint8Array,
    lease: MigrationLease,
  ): Promise<void> {
    const old = await this.record(entry, lease)
    if (old?.phase === 'undone' || old?.phase === 'copying')
      throw new VaultMigrationFault('conflict')
    let item: VaultItem | undefined
    let legacy: Uint8Array | null = null
    try {
      item = entry.decode(snapshot)
      validateMigrationItem(item, entry.itemId)
      await this.assertLegacyMatches(entry, snapshot, lease)
      const current = await this.deps.vault.list()
      lease.assertCurrent()
      const previous = current.find((metadata) => metadata.id === entry.itemId)
      if (old && previous) {
        item.metadata.dates = {
          ...item.metadata.dates,
          createdAt: previous.dates.createdAt,
          rotatedAt: item.metadata.dates.createdAt,
          lastUsedAt: previous.dates.lastUsedAt,
        }
        item.metadata.label = previous.label
        item.metadata.requirePresence = previous.requirePresence
      }
      if (!old) {
        const items = await this.deps.vault.list()
        lease.assertCurrent()
        if (
          items.some(
            (metadata) => metadata.id === entry.itemId || metadata.name === item?.metadata.name,
          )
        )
          throw new VaultMigrationFault('conflict')
        legacy = await this.deps.legacy.read(entry.key)
        lease.assertCurrent()
      }
      const row = this.intent(
        entry,
        item,
        'writing',
        old?.retainLegacy ?? legacy !== null,
        old?.startedRelease ?? this.currentRelease(),
      )
      if ((old?.phase === 'active' || old?.phase === 'retired') && old.digest !== null)
        row.previous = { phase: old.phase, digest: old.digest }
      await this.persistCopy(row, item, lease)
      await this.assertLegacyMatches(entry, snapshot, lease)
      if (row.retainLegacy) await this.mirror(entry, row, lease)
      await this.save(
        { ...row, previous: undefined, phase: row.retainLegacy ? 'active' : 'retired' },
        lease,
      )
    } finally {
      eraseItem(item)
      legacy?.fill(0)
    }
  }
  /**
   * Finish a sign-out the engine itself started: the journal already says
   * `deleting`, so a missing legacy copy is evidence of the interrupted
   * sign-out, never of a user deletion. A live legacy copy is a key saved
   * after the interruption, and it is never deleted here: only the stale
   * vault copy goes. An apiKey record is then re-seeded with `store`, while
   * an opaque one stays in SecretStorage with the row `deleted`, which the
   * unlock skips like any signed-out opaque slot. A record that no longer
   * decodes refuses with the codec's own fault and nothing is deleted. With
   * no legacy copy, the legacy remove runs only against the absent copy it
   * expects, and the row completes `deleted` without touching SecretStorage.
   */
  private async finishInterruptedDelete(
    entry: MigrationCredential,
    row: MigrationRecord,
    lease: MigrationLease,
  ): Promise<void> {
    let live: Uint8Array | null = null
    try {
      live = await this.deps.legacy.read(entry.key)
      lease.assertCurrent()
      if (live === null) {
        await this.removeVaultCopyIfPresent(entry, lease)
        await this.removeLegacy(entry.key, lease)
        const base = { ...row }
        delete base.previous
        delete base.retireIntent
        delete base.retireNote
        await this.save({ ...base, phase: 'deleted', digest: null }, lease)
        return
      }
      let decoded: VaultItem | undefined
      try {
        decoded = entry.decode(live)
        await this.removeVaultCopyIfPresent(entry, lease)
        if (decoded.material.kind !== 'apiKey') {
          const base = { ...row }
          delete base.previous
          delete base.retireIntent
          delete base.retireNote
          await this.save({ ...base, phase: 'deleted', digest: null }, lease)
          return
        }
        await this.storeInLease(entry, live, lease)
      } finally {
        eraseItem(decoded)
      }
    } finally {
      live?.fill(0)
    }
  }
  /**
   * The live legacy record's decoded material kind. Null when the record is
   * absent or damaged — each caller leaves those to its own recovery — and
   * every buffer is wiped before returning.
   */
  private async liveMaterialKind(
    entry: MigrationCredential,
    lease: MigrationLease,
  ): Promise<VaultItem['material']['kind'] | null> {
    let live: Uint8Array | null = null
    let decoded: VaultItem | undefined
    try {
      live = await this.deps.legacy.read(entry.key)
      lease.assertCurrent()
      if (live === null) return null
      try {
        decoded = entry.decode(live)
      } catch {
        return null
      }
      return decoded.material.kind
    } finally {
      eraseItem(decoded)
      live?.fill(0)
    }
  }
  /** The journal's phase for a key, or null before its first copy. */
  async journalPhase(key: string): Promise<MigrationRecord['phase'] | null> {
    const entry = this.credential(key)
    return await this.run(async (lease) => {
      const row = await this.record(entry, lease)
      return row?.phase ?? null
    })
  }
  /** Idempotent, including restart after copy or verification failure; source is never removed here. */
  async migrate(
    key: string,
  ): Promise<'missing' | 'active' | 'retired' | 'diverged' | 'legacyDeleted'> {
    const entry = this.credential(key)
    return await this.run(async (lease) => {
      const old = await this.record(entry, lease)
      if (old?.phase === 'active' || old?.phase === 'retired') {
        try {
          await this.verified(old, lease)
        } catch (error: unknown) {
          // The vault copy is gone or unreadable (a removal leaves the
          // journal `active`): with a live legacy copy, write it again
          // instead of pausing with the vault copy missing; with none,
          // report the deletion behind the vault like any other.
          if (
            !(error instanceof VaultMigrationFault) ||
            error.code !== 'invalid' ||
            old.phase !== 'active'
          )
            throw error
          const live = await this.deps.legacy.read(key)
          lease.assertCurrent()
          if (live === null) return 'legacyDeleted'
          try {
            await this.storeInLease(entry, live, lease)
          } finally {
            live.fill(0)
          }
          return 'active'
        }
        // A legacy copy deleted behind an active slot is a change like an
        // overwrite: report it with its own typed state instead of `active`,
        // so undo cannot write the deleted key back. A retired slot without
        // a legacy copy is complete and still reports `retired`. The states
        // are told apart by evidence, never by guessing: a missing copy with
        // the engine's own retire intent is an interrupted retire, finished
        // here with the ordinary retire notice; one without it is a deletion
        // behind the vault, left for the caller to answer.
        if (old.phase === 'active' && old.retainLegacy && (await this.legacyAbsent(entry, lease))) {
          if (old.retireIntent === true) {
            await this.finishInterruptedRetire(entry, old, lease)
            return 'retired'
          }
          return 'legacyDeleted'
        }
        return (await this.legacyDiverged(entry, old, lease)) ? 'diverged' : old.phase
      }
      if (old && old.phase !== 'copying' && old.phase !== 'undone')
        throw new VaultMigrationFault('conflict')
      let bytes: Uint8Array | null = null
      let sourceAgain: Uint8Array | null = null
      let item: VaultItem | undefined
      try {
        bytes = await this.deps.legacy.read(key)
        lease.assertCurrent()
        if (bytes === null) return 'missing'
        item = entry.decode(bytes)
        validateMigrationItem(item, entry.itemId)
        const items = await this.deps.vault.list()
        lease.assertCurrent()
        const existing = items.find(
          (metadata) => metadata.id === entry.itemId || metadata.name === item?.metadata.name,
        )
        if (existing && (!old || existing.id !== entry.itemId)) {
          if (old || existing.id !== entry.itemId) throw new VaultMigrationFault('conflict')
          let shared: VaultItem | undefined
          try {
            shared = await this.deps.vault.read(existing.id)
            lease.assertCurrent()
            validateMigrationItem(shared, entry.itemId)
            item.metadata.requirePresence = shared.metadata.requirePresence
            if (itemDigest(shared) !== itemDigest(item)) throw new VaultMigrationFault('conflict')
            item.metadata.dates = shared.metadata.dates
            item.metadata.label = shared.metadata.label
          } finally {
            eraseItem(shared)
          }
        }
        const row = this.intent(
          entry,
          item,
          'copying',
          true,
          old?.phase === 'copying' ? old.startedRelease : this.currentRelease(),
        )
        await this.persistCopy(row, item, lease)
        sourceAgain = await this.deps.legacy.read(key)
        lease.assertCurrent()
        if (!areSameBytes(bytes, sourceAgain)) throw new VaultMigrationFault('conflict')
        await this.save({ ...row, phase: 'active' }, lease)
        return 'active'
      } finally {
        eraseItem(item)
        bytes?.fill(0)
        sourceAgain?.fill(0)
      }
    })
  }
  /** Matches B's VaultCredentialBindingPort. Born-in-vault entries never create a legacy copy. */
  async store(key: string, value: Uint8Array): Promise<void> {
    const entry = this.credential(key)
    const snapshot = Buffer.alloc(value.byteLength)
    snapshot.set(value)
    try {
      await this.run(async (lease) => {
        await this.storeInLease(entry, snapshot, lease)
      })
    } finally {
      snapshot.fill(0)
    }
  }
  async resolve(key: string): Promise<ReturnType<typeof vaultPrivateReadSchema.parse> | null> {
    const entry = this.credential(key)
    return await this.run(async (lease) => {
      const row = await this.record(entry, lease)
      if (!row || row.phase === 'undone' || row.phase === 'deleted') return null
      if (row.phase !== 'active' && row.phase !== 'retired')
        throw new VaultMigrationFault('conflict')
      return entry.request === null ? null : vaultPrivateReadSchema.parse(entry.request)
    })
  }
  async undo(key: string): Promise<void> {
    const entry = this.credential(key)
    await this.run(async (lease) => {
      const row = await this.record(entry, lease)
      if (
        row?.phase !== 'active' ||
        !row.retainLegacy ||
        this.currentRelease() - row.startedRelease >= VAULT_LEGACY_RETAIN_RELEASES
      )
        throw new VaultMigrationFault('window')
      // A legacy copy deleted behind the vault is never written back: refuse
      // with a reason and leave the source absent, instead of resurrecting
      // the key the user deleted.
      if (await this.legacyAbsent(entry, lease)) throw new VaultMigrationFault('conflict')
      await this.verifyLegacy(entry, row, lease)
      await this.mirror(entry, row, lease)
      await this.save({ ...row, phase: 'undone' }, lease)
    })
  }
  async retire(key: string): Promise<boolean> {
    const entry = this.credential(key)
    return await this.run(async (lease) => {
      const row = await this.record(entry, lease)
      if (row?.phase === 'retired' && row.retirementNoticePending) {
        this.deps.onRetired(key)
        await this.save({ ...row, retirementNoticePending: false }, lease)
        return true
      }
      if (
        row?.phase !== 'active' ||
        !row.retainLegacy ||
        this.currentRelease() - row.startedRelease < VAULT_LEGACY_RETAIN_RELEASES
      )
        return false
      // A missing legacy copy without the engine's own retire intent is a
      // deletion behind the vault: retire neither completes it to `retired`
      // nor fires the retire notice nor erases the `legacyDeleted` report.
      // It stays for the caller to answer. One with the intent is the
      // engine's own interrupted retire, finished with the ordinary notice.
      if (await this.legacyAbsent(entry, lease)) {
        if (row.retireIntent !== true) return false
        await this.finishInterruptedRetire(entry, row, lease)
        return true
      }
      await this.verifyLegacy(entry, row, lease)
      // The intent is written and flushed before the delete, so every later
      // state carries the evidence of whose delete removed the legacy copy.
      await this.save({ ...row, retireIntent: true }, lease)
      await this.finishInterruptedRetire(entry, { ...row, retireIntent: true }, lease)
      return true
    })
  }
  /**
   * Remove the slot from both stores. When the legacy copy is already
   * absent, the vault copy is the only copy left, and deleting it needs the
   * caller's explicit confirmation, typed as the literal `true` so a
   * variable cannot satisfy it by accident. There are two confirmations and
   * they cannot be confused in code: an `active` slot that still retains
   * its legacy copy but finds it absent (with no retire intent) is the
   * `legacyDeleted` report, answered only after asking the person, with
   * `legacyDeletionConfirmed`; every other last copy — a `retired` slot, a
   * credential born in the vault, an interrupted retire — is an ordinary
   * delete, confirmed with `destroyLastCopyConfirmed` (a plain sign-out may
   * pass it). Without the matching confirmation the call refuses with
   * `conflict` and destroys nothing. Rows already being deleted complete
   * without either: that delete was confirmed when it started. A resumed
   * one never deletes a key saved after the interruption — a live legacy
   * copy is kept, only the stale vault copy goes — and a vault copy
   * already gone is not removed again.
   */
  async delete(
    key: string,
    options?: { destroyLastCopyConfirmed?: true; legacyDeletionConfirmed?: true },
  ): Promise<void> {
    const entry = this.credential(key)
    await this.run(async (lease) => {
      const row = await this.record(entry, lease)
      if (!row) throw new VaultMigrationFault('invalid')
      if (row.phase === 'deleted') return
      if (row.phase === 'deleting') {
        await this.finishInterruptedDelete(entry, row, lease)
        return
      }
      if (await this.legacyAbsent(entry, lease)) {
        const isAnswersLegacyDeleted =
          row.phase === 'active' && row.retainLegacy && row.retireIntent !== true
        if (
          (isAnswersLegacyDeleted
            ? options?.legacyDeletionConfirmed
            : options?.destroyLastCopyConfirmed) !== true
        )
          throw new VaultMigrationFault('conflict')
      }
      await this.save({ ...row, previous: undefined, phase: 'deleting' }, lease)
      lease.assertCurrent()
      await this.deps.vault.remove(entry.itemId, () => {
        lease.assertCurrent()
      })
      lease.assertCurrent()
      await this.removeLegacy(key, lease)
      // The final row is terminal: transition-only fields (`previous`,
      // retire evidence) are cleared with it, so the row is schema-valid in
      // every path — including a delete that follows an interrupted
      // rotation, whose source row still carries `previous`.
      const base = { ...row }
      delete base.previous
      delete base.retireIntent
      delete base.retireNote
      await this.save({ ...base, phase: 'deleted', digest: null }, lease)
    })
  }
  /**
   * Drop a copy the engine can never verify: a `copying` or `writing` row
   * whose vault item the private channel cannot serve, or whose legacy
   * record no longer decodes to an apiKey row. Saves before the apiKey gate
   * stranded such rows with a `secret` item the unlock used to skip before
   * `resume` ever saw them. The stuck item goes when it is still there, and
   * the journal row goes with it, so the opaque record keeps working in
   * SecretStorage. Anything else — an apiKey row recovery can still finish,
   * or a row with no stuck item and no opaque record — reports false and is
   * left for its own recovery, and a damaged record stays the engine's to
   * report instead of being rolled back here.
   */
  async rollbackCopy(key: string): Promise<boolean> {
    const entry = this.credential(key)
    return await this.run(async (lease) => {
      const row = await this.record(entry, lease)
      if (!row || (row.phase !== 'copying' && row.phase !== 'writing')) return false
      const listed = await this.deps.vault.list()
      lease.assertCurrent()
      const isPresent = listed.some((metadata) => metadata.id === entry.itemId)
      let isStuck: boolean
      if (isPresent) {
        let isReadable = false
        let item: VaultItem | undefined
        try {
          item = await this.deps.vault.read(entry.itemId)
          lease.assertCurrent()
          isReadable = true
        } catch (error: unknown) {
          if (!(error instanceof VaultMigrationFault) || error.code !== 'invalid') throw error
        } finally {
          eraseItem(item)
        }
        isStuck = !isReadable
      } else {
        const kind = await this.liveMaterialKind(entry, lease)
        if (kind === null) return false
        isStuck = kind !== 'apiKey'
      }
      if (!isStuck) return false
      if (isPresent) {
        await this.deps.vault.remove(entry.itemId, () => {
          lease.assertCurrent()
        })
        lease.assertCurrent()
      }
      await this.deps.journal.remove(entry.key)
      lease.assertCurrent()
      return true
    })
  }
  /**
   * Drop a vault copy the legacy slot no longer owns: the live record
   * decodes to something other than an apiKey row (an oauth, subscription
   * or account record saved over a migrated apiKey slot) while the journal
   * still claims the old key. A readable apiKey vault item is not "stuck",
   * so `rollbackCopy` leaves it; this removes it instead, without touching
   * the live SecretStorage record. A `copying` or `writing` row goes with
   * its item the way a rollback drops it; any other owned row (`active`,
   * `retired`, `deleting`) finishes `deleted` through the interrupted
   * sign-out path, which keeps a live copy it did not expect. Anything
   * else — no row, a terminal row, an absent or damaged record, or a
   * record that still decodes to an apiKey row — reports false and changes
   * nothing. Never deletes the SecretStorage record: that is the live key.
   */
  async removeStaleVaultCopy(key: string): Promise<boolean> {
    const entry = this.credential(key)
    return await this.run(async (lease) => {
      const row = await this.record(entry, lease)
      if (row === null || row.phase === 'deleted' || row.phase === 'undone') return false
      const kind = await this.liveMaterialKind(entry, lease)
      // An apiKey record is not stale — and an absent or damaged one stays
      // the engine's own recovery to report. A newer record the finish path
      // below reads is re-read there, so no check here can go stale.
      if (kind === null || kind === 'apiKey') return false
      if (row.phase === 'copying' || row.phase === 'writing') {
        await this.removeVaultCopyIfPresent(entry, lease)
        await this.deps.journal.remove(entry.key)
        lease.assertCurrent()
        return true
      }
      await this.finishInterruptedDelete(entry, row, lease)
      return true
    })
  }
  /** Startup recovery runs before first-party bindings become usable. */
  async resume(key: string): Promise<void> {
    const entry = this.credential(key)
    const phase = await this.run(async (lease) => {
      const row = await this.record(entry, lease)
      return row?.phase
    })
    if (phase === 'copying') {
      await this.migrate(key)
      return
    }
    if (phase === 'deleting') {
      await this.delete(key)
      return
    }
    // The engine's own interrupted retire finishes here, with the ordinary
    // retire notice; a missing legacy copy without the intent is a deletion
    // behind the vault and stays `legacyDeleted` for the caller to answer. A
    // legacy copy changed after the intent clears the stale intent and reads
    // honestly instead of throwing, so the join's per-key sequence goes on
    // to the other rows.
    if (phase === 'active') {
      await this.run(async (lease) => {
        const row = await this.record(entry, lease)
        if (row?.phase !== 'active' || row.retireIntent !== true) return
        await this.finishOneIntent(entry, row, lease)
      })
      return
    }
    if (phase !== 'writing') return
    // A first `store` (no `previous`) interrupted after its journal intent
    // commits but before its first vault write leaves a `writing` row with
    // no vault item and no previous value to restore. The crashed call took
    // the new key material with it, so recovery settles for the old state
    // whole: a surviving legacy copy is migrated to `active`, and with no
    // copy anywhere the slot is recorded `deleted`. Both settle with a
    // schema-valid record, and neither invents the lost value.
    // Whether the abandoned intent rewound to `copying` below: the
    // migration runs after this run returns, never nested inside it (a
    // nested owner run would deadlock the serialized owner).
    const shouldMigrateAfterResume = await this.run(async (lease) => {
      const row = await this.record(entry, lease)
      if (row?.phase !== 'writing') return false
      const listed = await this.deps.vault.list()
      lease.assertCurrent()
      if (listed.every((metadata) => metadata.id !== row.itemId)) {
        // The atomic vault write never committed.
        if (row.previous !== undefined) {
          // A rotation: restore the previous usable journal row.
          await this.save({ ...row, ...row.previous, previous: undefined }, lease)
          return false
        }
        if (await this.legacyAbsent(entry, lease)) {
          const base = { ...row }
          delete base.previous
          delete base.retireIntent
          delete base.retireNote
          await this.save({ ...base, previous: undefined, phase: 'deleted', digest: null }, lease)
          return false
        }
        // The legacy copy survived: rewind the abandoned intent to
        // `copying` and migrate it after this run, so the old value stays
        // whole with an `active` record a later `store` can rotate from.
        // The stale digest rides along — `migrate` recomputes it — because
        // only a `deleted` row may carry a null digest.
        await this.save({ ...row, previous: undefined, phase: 'copying' }, lease)
        return true
      }
      let copied: VaultItem | undefined
      try {
        copied = await this.deps.vault.read(row.itemId)
        lease.assertCurrent()
        validateMigrationItem(copied, row.itemId)
        const digest = itemDigest(copied)
        if (digest !== row.digest) {
          if (digest !== row.previous?.digest) throw new VaultMigrationFault('verification')
          // Atomic vault write did not commit. Restore the previous usable journal row.
          await this.save({ ...row, ...row.previous, previous: undefined }, lease)
          return false
        }
      } finally {
        eraseItem(copied)
      }
      // The interrupted store may have crashed between the vault commit and
      // the legacy write, and a save may have landed since: mirroring the
      // vault bytes back now would overwrite that newer save (or resurrect
      // a legacy copy the person removed, which `undo` refuses to do).
      // With no legacy copy, complete without touching it; with a changed
      // one, rewind and migrate it, the way the missing-vault-item branch
      // above already does.
      const live = await this.deps.legacy.read(entry.key)
      lease.assertCurrent()
      if (live === null) {
        await this.save(
          { ...row, previous: undefined, phase: row.retainLegacy ? 'active' : 'retired' },
          lease,
        )
        return false
      }
      try {
        let legacyItem: VaultItem | undefined
        try {
          legacyItem = entry.decode(live)
          if (itemDigest(legacyItem) !== row.digest) {
            await this.save({ ...row, previous: undefined, phase: 'copying' }, lease)
            return true
          }
        } finally {
          eraseItem(legacyItem)
        }
      } finally {
        live.fill(0)
      }
      if (row.retainLegacy) await this.mirror(entry, row, lease)
      await this.save(
        { ...row, previous: undefined, phase: row.retainLegacy ? 'active' : 'retired' },
        lease,
      )
      return false
    })
    if (shouldMigrateAfterResume) await this.migrate(key)
  }
  /**
   * Startup recovery: finish every pending retire intent at once. The vault
   * calls this at every open before any other migration call, so no intent
   * survives an open: a present legacy copy is deleted and the slot is
   * recorded `retired`; an absent one is recorded `retired` with a journal
   * note saying the copy was already absent when the intent was resumed. A
   * row whose legacy copy changed after the intent is left alone — the
   * engine deletes nobody else's bytes — its stale intent is cleared so the
   * change reads honestly, and its state is reported; the call goes on to
   * the other rows instead of throwing for it. A vault-side verification
   * failure still throws. Returns the outcome per finished row; rows without
   * a pending intent are absent from the result.
   */
  async finishPendingRetires(): Promise<Record<string, 'retired' | 'diverged'>> {
    const outcome: Record<string, 'retired' | 'diverged'> = {}
    for (const key of this.credentials.keys()) {
      const entry = this.credential(key)
      const state = await this.run(async (lease) => {
        const row = await this.record(entry, lease)
        return row?.phase === 'active' && row.retireIntent === true
          ? await this.finishOneIntent(entry, row, lease)
          : null
      })
      if (state !== null) outcome[key] = state
    }
    return outcome
  }
}
