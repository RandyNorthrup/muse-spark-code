// Test-only executable specification; never import from src/**. "synced",
// native references and anchor acquisition denote trusted proof obligations,
// not file I/O, OS handles, peer assertions or a production implementation.
export interface NativeReference {
  readonly platform: 'linux' | 'darwin' | 'win32'
  readonly kind: 'pidfd' | 'processHandle' | 'ownedChild' | 'psSeconds' | 'processGroup'
  readonly token: string
  readonly boot: string
  readonly start: string
  readonly pid: number
  readonly validated: boolean
  readonly exited: boolean
}

interface Grant {
  readonly owner: string
  readonly resources: readonly string[]
  phase: 'reserved' | 'intent' | 'spawned' | 'registered' | 'running' | 'terminal'
  reference: NativeReference | undefined
  scopeCoverage: 'complete' | 'unknown'
  pendingRename: boolean
}

interface RetirementProof {
  readonly grant: string
  readonly epoch: string
  readonly reference: NativeReference
  readonly treeEmpty: boolean
  readonly effectsDrained: boolean
}

export class CoordinatorSpecification {
  private readonly grants = new Map<string, Grant>()
  public reachable = true
  public readonly landed: string[] = []

  public constructor(private readonly epoch: string) {}

  public reserve(id: string, owner: string, resources: readonly string[]): boolean {
    if (this.grants.has(id)) return false
    for (const held of this.grants.values())
      if (
        held.phase !== 'terminal' &&
        held.resources.some((resource) => resources.includes(resource))
      )
        return false
    this.grants.set(id, {
      owner,
      resources: [...resources],
      phase: 'reserved',
      reference: undefined,
      scopeCoverage: 'unknown',
      pendingRename: false,
    })
    return true
  }

  public held(id: string): readonly string[] {
    const record = this.grants.get(id)
    return record === undefined || record.phase === 'terminal' ? [] : [...record.resources]
  }

  public retirementState(id: string): 'active' | 'unknown' | 'finished' {
    const record = this.grants.get(id)
    if (record?.phase === 'terminal') return 'finished'
    return record?.scopeCoverage === 'complete' ? 'active' : 'unknown'
  }

  public endpointFailed(_error: string): void {
    this.reachable = false
  }

  public advanceClock(): void {
    // A timer affects availability only, never retirement.
  }

  public electSuccessor(hasAnchor: boolean): boolean {
    return hasAnchor
  }

  public persistIntent(id: string, isSynced: boolean): boolean {
    const record = this.grants.get(id)
    if (!isSynced || record?.phase !== 'reserved') return false
    record.phase = 'intent'
    return true
  }

  public spawn(id: string): boolean {
    const record = this.grants.get(id)
    if (record?.phase !== 'intent') return false
    record.phase = 'spawned'
    return true
  }

  public register(
    id: string,
    reference: NativeReference,
    scopeCoverage: 'complete' | 'unknown',
  ): void {
    const record = this.grants.get(id)
    if (record?.phase !== 'spawned') throw new Error('Not spawned')
    record.reference = { ...reference }
    record.scopeCoverage = scopeCoverage
    record.phase = 'registered'
  }

  public resume(id: string): void {
    const record = this.grants.get(id)
    if (record?.phase !== 'registered') throw new Error('Not registered')
    record.phase = 'running'
  }

  public ownerExited(_owner: string): void {
    // Owner death cannot discharge pending launches, descendants or effects.
  }

  public freezeBeforeRename(id: string): void {
    const record = this.grants.get(id)
    if (record?.phase !== 'running') throw new Error('Not running')
    record.pendingRename = true
  }

  public userConfirmedStopped(_id: string): boolean {
    return false
  }

  public completePendingRename(id: string): boolean {
    const record = this.grants.get(id)
    if (record?.pendingRename !== true) return false
    this.landed.push(id)
    record.pendingRename = false
    return true
  }

  public settle(proof: RetirementProof, isSynced: boolean): boolean {
    const record = this.grants.get(proof.grant)
    if (
      !isSynced ||
      proof.epoch !== this.epoch ||
      record?.reference === undefined ||
      record.phase === 'terminal' ||
      record.pendingRename ||
      record.scopeCoverage !== 'complete' ||
      !proof.treeEmpty ||
      !proof.effectsDrained ||
      !proof.reference.exited ||
      !isSameReference(record.reference, proof.reference) ||
      !isStableReference(proof.reference)
    )
      return false
    record.phase = 'terminal'
    return true
  }

  public restart(epoch: string): CoordinatorSpecification {
    const recovered = new CoordinatorSpecification(epoch)
    for (const [id, record] of this.grants)
      recovered.grants.set(id, {
        ...record,
        resources: [...record.resources],
        reference: undefined,
        scopeCoverage: 'unknown',
      })
    return recovered
  }
}

export function signalTarget(
  expected: NativeReference,
  observed: NativeReference,
): string | undefined {
  return !isSameReference(expected, observed) ||
    !isStableReference(observed) ||
    observed.platform === 'darwin' ||
    observed.exited
    ? undefined
    : expected.token
}

function isSameReference(expected: NativeReference, observed: NativeReference): boolean {
  return (
    expected.validated &&
    observed.validated &&
    expected.platform === observed.platform &&
    expected.kind === observed.kind &&
    expected.token === observed.token &&
    expected.boot === observed.boot &&
    expected.start === observed.start &&
    expected.pid === observed.pid
  )
}

function isStableReference(reference: NativeReference): boolean {
  return (
    (reference.platform === 'linux' && reference.kind === 'pidfd') ||
    (reference.platform === 'win32' && reference.kind === 'processHandle') ||
    (reference.platform === 'darwin' && reference.kind === 'ownedChild')
  )
}

export function chooseMode(
  prerequisites: {
    readonly platform: NativeReference['platform']
    readonly filesystem: string
    readonly nativeQualified: boolean
    readonly scopeQualified: boolean
    readonly storeValid: boolean
  },
  hasUnresolvedGrants: boolean,
): 'machine' | 'windowScoped' | 'blocked' {
  if (hasUnresolvedGrants || !prerequisites.storeValid) return 'blocked'
  return prerequisites.filesystem === 'local' &&
    prerequisites.nativeQualified &&
    prerequisites.scopeQualified
    ? 'machine'
    : 'windowScoped'
}
