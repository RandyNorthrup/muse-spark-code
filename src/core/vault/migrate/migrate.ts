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
        return [entry.key, { ...entry, request }]
      }),
    )
    if (
      this.credentials.size !== credentials.length ||
      new Set(credentials.map((entry) => entry.itemId)).size !== credentials.length
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
  /** Idempotent, including restart after copy or verification failure; source is never removed here. */
  async migrate(key: string): Promise<'missing' | 'active' | 'retired'> {
    const entry = this.credential(key)
    return await this.run(async (lease) => {
      const old = await this.record(entry, lease)
      if (old?.phase === 'active' || old?.phase === 'retired') {
        await this.verified(old, lease)
        return old.phase
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
        const old = await this.record(entry, lease)
        if (old?.phase === 'undone' || old?.phase === 'copying')
          throw new VaultMigrationFault('conflict')
        let item: VaultItem | undefined
        let legacy: Uint8Array | null = null
        try {
          item = entry.decode(snapshot)
          validateMigrationItem(item, entry.itemId)
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
            legacy = await this.deps.legacy.read(key)
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
          if (row.retainLegacy) await this.mirror(entry, row, lease)
          await this.save(
            { ...row, previous: undefined, phase: row.retainLegacy ? 'active' : 'retired' },
            lease,
          )
        } finally {
          eraseItem(item)
          legacy?.fill(0)
        }
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
      await this.verifyLegacy(entry, row, lease)
      await this.removeLegacy(key, lease)
      await this.save(
        { ...row, retainLegacy: false, phase: 'retired', retirementNoticePending: true },
        lease,
      )
      this.deps.onRetired(key)
      await this.save(
        { ...row, retainLegacy: false, phase: 'retired', retirementNoticePending: false },
        lease,
      )
      return true
    })
  }
  async delete(key: string): Promise<void> {
    const entry = this.credential(key)
    await this.run(async (lease) => {
      const row = await this.record(entry, lease)
      if (!row) throw new VaultMigrationFault('invalid')
      if (row.phase === 'deleted') return
      await this.save({ ...row, previous: undefined, phase: 'deleting' }, lease)
      lease.assertCurrent()
      await this.deps.vault.remove(entry.itemId, () => {
        lease.assertCurrent()
      })
      lease.assertCurrent()
      await this.removeLegacy(key, lease)
      await this.save({ ...row, phase: 'deleted', digest: null }, lease)
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
    if (phase !== 'writing') return
    await this.run(async (lease) => {
      const row = await this.record(entry, lease)
      if (row?.phase !== 'writing') return
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
          return
        }
      } finally {
        eraseItem(copied)
      }
      if (row.retainLegacy) await this.mirror(entry, row, lease)
      await this.save(
        { ...row, previous: undefined, phase: row.retainLegacy ? 'active' : 'retired' },
        lease,
      )
    })
  }
}
