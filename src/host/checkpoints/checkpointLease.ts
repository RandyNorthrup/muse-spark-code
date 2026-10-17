// One CAS reservation for restores and cleanup. The store serializes admissions;
// a held value is never recoverable, even by another admission in this instance.
import { failureForLog } from '../../core/backends/musecode/logText'
import path from 'node:path'
import { lstatIdentity } from '../../core/fs/fileIdentity'
import { isMissingPath } from '../canonicalPath'
import { CHECKPOINT_LEASE_RECOVERY_MS, CHECKPOINT_PUBLISH_RETRY_MS } from '../../shared/constants'
import type { Logger } from '../logger'
import { parseRecord, type StoredRecord } from './checkpointRecords'
import { didWriteRef, keepTree, refValue } from './recordRefs'
import type { ShadowGit } from './shadowGit'

const CHECKPOINT_RESERVATION_REF = 'refs/muse-spark/restore-active'

type LeaseState =
  { readonly kind: 'idle' } | { readonly kind: 'held' | 'owed'; readonly keep: string }

interface LeaseContext {
  readonly shadow: ShadowGit
  readonly top: string
  readonly prefix: string
}

interface LeaseDeps {
  readonly storageDir: string
  readonly instance: string
  readonly now: () => number
  /** Presence proves exit only without native/process uncertainty. */
  readonly isGone: (instance: string) => Promise<boolean>
  readonly log: Pick<Logger, 'warn'>
}

export class CheckpointLease {
  private state: LeaseState = { kind: 'idle' }

  public constructor(private readonly deps: LeaseDeps) {}

  private async tree(context: LeaseContext, signal: AbortSignal): Promise<string> {
    const record: StoredRecord = {
      kind: 'restore',
      top: context.top,
      prefix: context.prefix,
      id: this.deps.instance,
      owner: this.deps.instance,
      sessionId: '',
      createdAt: this.deps.now(),
      entries: [],
    }
    return await keepTree(context.shadow, JSON.stringify(record), [], signal)
  }

  /** A lost CAS reply must leave recoverable debt, never an ownerless local state. */
  private async claim(
    context: LeaseContext,
    keep: string,
    previous: string | undefined,
    signal: AbortSignal,
  ): Promise<boolean> {
    this.state = { kind: 'owed', keep }
    if (await didWriteRef(context.shadow, CHECKPOINT_RESERVATION_REF, keep, previous, signal)) {
      this.state = { kind: 'held', keep }
      return true
    }
    this.state = { kind: 'idle' }
    return false
  }

  /** Exact-value deletion; a changed reservation belongs to its new owner. */
  private async repay(shadow: ShadowGit, keep: string, signal: AbortSignal): Promise<void> {
    this.state = { kind: 'owed', keep }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await shadow.run(['update-ref', '-d', CHECKPOINT_RESERVATION_REF, keep], { signal })
        this.state = { kind: 'idle' }
        return
      } catch (error: unknown) {
        if (attempt === 1 || signal.aborted) {
          this.deps.log.warn(`The restore lease could not be released: ${failureForLog(error)}`)
          return
        }
        await new Promise<void>((resolve) => {
          setTimeout(resolve, CHECKPOINT_PUBLISH_RETRY_MS)
        })
      }
    }
  }

  /** No loops: one owed-release retry and at most one exact-value takeover. */
  public async recoverAbandoned(context: LeaseContext): Promise<void> {
    if (this.state.kind === 'held') return
    const signal = AbortSignal.timeout(CHECKPOINT_LEASE_RECOVERY_MS)
    try {
      const previous = await refValue(context.shadow, CHECKPOINT_RESERVATION_REF, signal)
      if (this.state.kind === 'owed') {
        if (previous === this.state.keep) {
          await this.repay(context.shadow, previous, signal)
          return
        }
        this.state = { kind: 'idle' }
      }
      if (previous === undefined) return
      const record = parseRecord(
        await context.shadow.text(['cat-file', 'blob', `${previous}:record.json`], { signal }),
      )
      const owner = record?.kind === 'restore' ? record.owner : undefined
      if (owner === undefined || owner === this.deps.instance || !(await this.deps.isGone(owner)))
        return
      const keep = await this.tree(context, signal)
      if (await this.claim(context, keep, previous, signal)) {
        await this.repay(context.shadow, keep, signal)
      }
    } catch (error: unknown) {
      // Failure cannot establish abandonment: admission still checks the ref.
      this.deps.log.warn(`Checkpoint lease recovery could not finish: ${failureForLog(error)}`)
    }
  }

  /** Restricted Mode checks loose/packed reservation files without invoking Git. */
  public async isReserved(shadow?: ShadowGit): Promise<boolean> {
    if (shadow !== undefined)
      return (await refValue(shadow, CHECKPOINT_RESERVATION_REF)) !== undefined
    for (const ref of [CHECKPOINT_RESERVATION_REF, 'packed-refs']) {
      try {
        await lstatIdentity(path.join(this.deps.storageDir, 'shadow.git', ref))
        return true
      } catch (error: unknown) {
        if (!isMissingPath(error)) throw error
      }
    }
    return false
  }

  public async acquire(context: LeaseContext): Promise<string | undefined> {
    await this.recoverAbandoned(context)
    if (this.state.kind !== 'idle') return undefined
    const signal = AbortSignal.timeout(CHECKPOINT_LEASE_RECOVERY_MS)
    const keep = await this.tree(context, signal)
    return (await this.claim(context, keep, undefined, signal)) ? keep : undefined
  }

  /** Release failure preserves the completed operation's result and its exact debt. */
  public async release(shadow: ShadowGit, keep: string): Promise<void> {
    await this.repay(shadow, keep, AbortSignal.timeout(CHECKPOINT_LEASE_RECOVERY_MS))
  }
}
