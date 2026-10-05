// --- M96c lane Q: landing. M96 lane I owns review/ref/path admission. ---
export interface LandingBlob {
  readonly oid: string
  readonly mode: '100644' | '100755' | '120000'
}
export interface LandingSnapshot {
  readonly head: string
  readonly tree: string
  readonly commit: string
  readonly blobs: ReadonlyMap<string, LandingBlob>
}
export interface LandingIntent {
  readonly id: string
  readonly windowInstanceId: string
  readonly root: string
  readonly head: string
  readonly snapshotTree: string
  readonly checkIdentity: string
  readonly status: 'open' | 'landed' | 'recovered'
  readonly files: readonly {
    readonly path: string
    readonly before: LandingBlob | null
    readonly after: LandingBlob | null
    readonly tasks: readonly string[]
  }[]
  readonly conflicts: readonly string[]
}
export interface LandingAdmission {
  readonly id: string
  readonly snapshot: LandingSnapshot
  readonly final: LandingSnapshot
  readonly checkIdentity: string
  readonly owners: ReadonlyMap<string, readonly string[]>
}

export type LandingOutcome =
  | { readonly status: 'busy' | 'denied' | 'stale' }
  | { readonly status: 'branched'; readonly branch: string; readonly holder: unknown }
  | {
      readonly status: 'landed' | 'changed'
      readonly paths: readonly string[]
      readonly intent: LandingIntent
    }

export interface LandingLock {
  readonly path: string
  readonly isHeld: () => Promise<boolean>
  readonly release: () => Promise<boolean>
}

export interface TeamLandingDeps {
  readonly windowInstanceId: string
  readonly canonicalRoot: (root: string) => Promise<string>
  /** Lane K checks this window's durable journal, including explicit takeover. */
  readonly hasOpenLanding: (root: string) => Promise<boolean>
  readonly snapshot: (root: string) => Promise<LandingSnapshot>
  readonly checkIdentity: () => Promise<string>
  /** Void this admission and enqueue a fresh merge/check; Pause queue can hold it. */
  readonly invalidate: (admission: LandingAdmission) => Promise<void>
  readonly knownHolder: (
    root: string,
    ownedLock?: LandingLock,
  ) => Promise<{ readonly kind: string } | undefined>
  readonly takeLock: (root: string, id: string) => Promise<LandingLock | null>
  readonly defer: (root: string, admission: LandingAdmission) => Promise<string>
  /** The ordinary landing card; mode policy belongs to the host. */
  readonly confirmLanding: (admission: LandingAdmission) => Promise<boolean>
  /** Separate explicit prompt in every mode, Bypass included. */
  readonly confirmWithoutChecks: (admission: LandingAdmission) => Promise<boolean>
  readonly prepare: (intent: LandingIntent) => Promise<void>
  readonly close: (
    intent: LandingIntent,
    status: 'landed' | 'recovered',
    conflicts: readonly string[],
  ) => Promise<void>
  /** Repeat M77 canonical/protected/ref checks before each conditional mutation. */
  readonly replace: (
    root: string,
    file: LandingIntent['files'][number],
    canWrite: () => Promise<boolean>,
  ) => Promise<boolean>
  readonly recover: (
    intent: LandingIntent,
    canWrite: () => Promise<boolean>,
  ) => Promise<readonly string[]>
  readonly undo: (
    intent: LandingIntent,
    taskId: string | null,
    canWrite: () => Promise<boolean>,
  ) => Promise<readonly string[]>
  readonly authorizeRecovery: (intent: LandingIntent) => Promise<boolean>
}

function isSameBlob(left: LandingBlob | undefined, right: LandingBlob | undefined): boolean {
  return left === undefined || right === undefined
    ? left === right
    : left.oid === right.oid && left.mode === right.mode
}

/** One live window owns this instance. Git's own lock handles participating processes. */
export class TeamLanding {
  private readonly active = new Set<string>()
  public constructor(private readonly deps: TeamLandingDeps) {}

  private async rollback(
    intent: LandingIntent,
    taskId: string | null | undefined,
  ): Promise<LandingOutcome> {
    const root = await this.deps.canonicalRoot(intent.root)
    if (this.active.has(root)) return { status: 'busy' }
    this.active.add(root)
    let lock: LandingLock | null = null
    let canRelease = true
    try {
      if (!(await this.deps.authorizeRecovery(intent))) return { status: 'denied' }
      if ((await this.deps.knownHolder(root)) !== undefined) return { status: 'busy' }
      lock = await this.deps.takeLock(root, intent.id)
      if (lock === null) return { status: 'busy' }
      const ownedLock = lock
      const canWrite = async (): Promise<boolean> =>
        (await this.deps.knownHolder(root, ownedLock)) === undefined
      if (!(await canWrite())) return { status: 'busy' }
      canRelease = false
      const paths =
        taskId === undefined
          ? await this.deps.recover(intent, canWrite)
          : await this.deps.undo(intent, taskId, canWrite)
      canRelease = true
      return { status: paths.length === 0 ? 'landed' : 'changed', paths, intent }
    } finally {
      if (canRelease) await lock?.release()
      this.active.delete(root)
    }
  }

  public async land(
    root: string,
    admission: LandingAdmission,
    isWithoutChecks = false,
  ): Promise<LandingOutcome> {
    const canonical = await this.deps.canonicalRoot(root)
    if (this.active.has(canonical)) return { status: 'busy' }
    this.active.add(canonical)
    let lock: LandingLock | null = null
    let canRelease = true
    try {
      if (await this.deps.hasOpenLanding(canonical)) return { status: 'busy' }
      if (
        !(await this.deps.confirmLanding(admission)) ||
        (isWithoutChecks && !(await this.deps.confirmWithoutChecks(admission)))
      )
        return { status: 'denied' }
      const holder = await this.deps.knownHolder(canonical)
      if (holder !== undefined)
        return { status: 'branched', holder, branch: await this.deps.defer(canonical, admission) }
      lock = await this.deps.takeLock(canonical, admission.id)
      if (lock === null) return { status: 'busy' }
      const ownedLock = lock
      const currentHolder = await this.deps.knownHolder(canonical, ownedLock)
      if (currentHolder !== undefined)
        return {
          status: 'branched',
          holder: currentHolder,
          branch: await this.deps.defer(canonical, admission),
        }
      const canWrite = async (): Promise<boolean> =>
        (await this.deps.knownHolder(canonical, ownedLock)) === undefined
      const fresh = await this.deps.snapshot(canonical)
      if (
        fresh.tree !== admission.snapshot.tree ||
        fresh.head !== admission.snapshot.head ||
        (await this.deps.checkIdentity()) !== admission.checkIdentity
      ) {
        await this.deps.invalidate(admission)
        return { status: 'stale' }
      }
      const files: LandingIntent['files'][number][] = []
      const paths = new Set([...fresh.blobs.keys(), ...admission.final.blobs.keys()])
      for (const path of paths) {
        const before = fresh.blobs.get(path)
        const after = admission.final.blobs.get(path)
        if (isSameBlob(before, after)) continue
        const tasks = admission.owners.get(path)
        if (tasks === undefined || tasks.length === 0) throw new Error('missing landing file owner')
        files.push({ path, before: before ?? null, after: after ?? null, tasks })
      }
      const intent: LandingIntent = {
        id: admission.id,
        windowInstanceId: this.deps.windowInstanceId,
        root: canonical,
        head: fresh.head,
        snapshotTree: fresh.tree,
        checkIdentity: admission.checkIdentity,
        status: 'open',
        files,
        conflicts: [],
      }
      await this.deps.prepare(intent)
      canRelease = false
      const changed = new Set<string>()
      for (const file of files) {
        if (!(await canWrite()) || !(await this.deps.replace(canonical, file, canWrite))) {
          changed.add(file.path)
          break
        }
      }
      // Include untouched dependencies as well as every landed blob and HEAD.
      const after = await this.deps.snapshot(canonical)
      if (after.head !== fresh.head) changed.add('HEAD')
      const finalPaths = new Set([...after.blobs.keys(), ...admission.final.blobs.keys()])
      for (const path of finalPaths) {
        if (!isSameBlob(after.blobs.get(path), admission.final.blobs.get(path))) changed.add(path)
      }
      const conflicts = [...changed]
      await this.deps.close(intent, 'landed', conflicts)
      canRelease = true
      return { status: conflicts.length === 0 ? 'landed' : 'changed', paths: conflicts, intent }
    } finally {
      // A partial write or failed journal close leaves the lock and open intent for Recover.
      if (canRelease) await lock?.release()
      this.active.delete(canonical)
    }
  }

  /** Apply always rebuilds/merges/checks from a new snapshot, never reuses an old green result. */
  public async apply(
    root: string,
    id: string,
    rebuild: (id: string) => Promise<LandingAdmission>,
  ): Promise<LandingOutcome> {
    return await this.land(root, await rebuild(id))
  }

  public async recover(intent: LandingIntent): Promise<LandingOutcome> {
    return await this.rollback(intent, undefined)
  }

  public async undo(intent: LandingIntent, taskId: string | null): Promise<LandingOutcome> {
    return await this.rollback(intent, taskId)
  }
}
// --- End lane Q region. ---
