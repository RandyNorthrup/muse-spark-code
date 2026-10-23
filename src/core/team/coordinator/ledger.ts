// M96d machine coordinator (PLAN.md D75): the durable custody shell.
//
// One user-level broker per machine/user owns this store; every editor
// and the ACP/runtime process coordinate through it. The shell journals
// the pure grant engine (`grants.ts`): every mutation is written to an
// exclusive temporary file beside the ledger, synced, atomically
// renamed over it, and the directory is synced where the platform
// honours it. Memory is adopted only after the sync; a failed sync
// refuses the operation, restores the previous state, and the caller
// retries against that state. Terminal state is committed before the
// reply. A single live owner holds the store: a second live or
// uncertain owner refuses, and a provably dead one yields to a fresh
// custody that retains every open grant while dropping all reference
// authority (docs/design/m96d-coordinator.md §§1-2).

import { randomUUID } from 'node:crypto'
import type { Stats } from 'node:fs'
import { chmod, lstat, mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { writeFileAtomic } from '../../fs/atomicFile'
import {
  COORDINATOR_LEDGER_MAX_BYTES,
  COORDINATOR_STORE_VERSION,
  UI_TEXT,
} from '../../../shared/constants'
import { exactProcessBirth, isProcessAlive, systemBootIdentity } from '../../locks/processOwner'
import {
  CoordinatorGrants,
  grantRecordSchema,
  type CoordinatorGrantRecord,
  type CoordinatorRetirementProof,
} from './grants'
import type { CoordinatorReference } from './references'

const LEDGER_FILE = 'ledger.json'
const IDENTITY_FILE = 'identity.json'
const OWNER_FILE = 'owner.json'
const STORE_DIRECTORY_MODE = 0o700
const OWNER_ONLY_MASK = 0o777

const ledgerFileSchema = z.strictObject({
  storeId: z.string().check(z.minLength(1)),
  version: z.literal(COORDINATOR_STORE_VERSION),
  epoch: z.string().check(z.minLength(1)),
  grants: z.array(grantRecordSchema),
})
type LedgerFile = z.infer<typeof ledgerFileSchema>

const identityFileSchema = z.strictObject({
  storeId: z.string().check(z.minLength(1)),
  version: z.literal(COORDINATOR_STORE_VERSION),
})

const ownerFileSchema = z.strictObject({
  pid: z.number().check(z.int(), z.gt(0)),
  birth: z.string().check(z.minLength(1)),
  boot: z.string().check(z.minLength(1)),
  epoch: z.string().check(z.minLength(1)),
})
type OwnerFile = z.infer<typeof ownerFileSchema>

export type CoordinatorLedgerRefusal =
  | 'ambiguousStore'
  | 'identityMismatch'
  | 'storeTooLarge'
  | 'owned'
  | 'ownerUncertain'
  | 'epochReused'
  | 'syncFailed'

/** A store refusal that names its cause; the host renders the code through UI_TEXT. */
export class CoordinatorLedgerError extends Error {
  public constructor(
    public readonly code: CoordinatorLedgerRefusal,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'CoordinatorLedgerError'
  }
}

export function isCoordinatorLedgerError(value: unknown): value is CoordinatorLedgerError {
  return value instanceof Error && value.name === 'CoordinatorLedgerError'
}

/** A file that is simply not there: absent, never a failure. */
function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

async function readJsonFile<T>(
  directory: string,
  name: string,
  schema: {
    safeParse(value: unknown): { success: true; data: T } | { success: false; error: Error }
  },
): Promise<{ found: false } | { found: true; value: T }> {
  let bytes: Buffer
  try {
    bytes = await readFile(path.join(directory, name))
  } catch (error: unknown) {
    // Only a missing file reads as absent; anything else keeps its kind.
    if (!isMissingFile(error)) throw error
    return { found: false }
  }
  if (bytes.byteLength > COORDINATOR_LEDGER_MAX_BYTES)
    throw new CoordinatorLedgerError('storeTooLarge', UI_TEXT.coordinatorStoreTooLarge)
  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch (error: unknown) {
    // Only torn text reads as a blocking ambiguous store; the evidence stays on disk.
    if (!(error instanceof SyntaxError)) throw error
    throw new CoordinatorLedgerError('ambiguousStore', UI_TEXT.coordinatorStoreAmbiguous, {
      cause: error,
    })
  }
  // A malformed record is a blocking state: the evidence stays for repair, never an empty ledger.
  const checked = schema.safeParse(parsed)
  if (!checked.success)
    throw new CoordinatorLedgerError('ambiguousStore', UI_TEXT.coordinatorStoreAmbiguous, {
      cause: checked.error,
    })
  return { found: true, value: checked.data }
}

function assertStoreDirectory(information: Stats): void {
  // A link is never followed to a store: the directory itself must be a real directory.
  if (information.isSymbolicLink() || !information.isDirectory())
    throw new CoordinatorLedgerError('ambiguousStore', UI_TEXT.coordinatorStoreAmbiguous)
  if (process.platform === 'win32') return
  const getuid = process.getuid
  if (
    information.uid !== getuid?.() ||
    (information.mode & OWNER_ONLY_MASK) !== STORE_DIRECTORY_MODE
  )
    throw new CoordinatorLedgerError('ambiguousStore', UI_TEXT.coordinatorStoreAmbiguous)
}

/**
Whether the recorded owner is provably gone: another boot, our own
PID with a stale birth, a reused PID with another precise birth, or
no such process. A live PID whose birth cannot be read, and any
macOS birth match (whose seconds may hide a reuse), is uncertain,
never gone.
*/
async function isOwnerGone(owner: OwnerFile): Promise<boolean | undefined> {
  const boot = await systemBootIdentity()
  if (boot !== undefined && boot !== '' && owner.boot !== boot) return true
  if (owner.pid === process.pid) {
    // Our own record compares against our own live reading: equal is
    // alive, different is a stale record from a dead incarnation. No
    // coarse-match ambiguity: the reading is our own, whatever its clock.
    const self = await exactProcessBirth(process.pid)
    return self === undefined ? undefined : self !== owner.birth
  }
  const birth = await exactProcessBirth(owner.pid)
  if (birth === undefined) {
    // An unreadable birth with no such process is gone; a live PID whose
    // birth cannot be read is uncertain, never gone.
    return isProcessAlive(owner.pid) ? undefined : true
  }
  if (birth !== owner.birth) return true
  return process.platform === 'darwin' ? undefined : false
}

export interface CoordinatorLedger {
  readonly storeId: string
  readonly epoch: string
  readonly reachable: boolean
  reserve(id: string, owner: string, resources: readonly string[]): Promise<void>
  held(id: string): readonly string[]
  retirementState(id: string): 'active' | 'unknown' | 'finished'
  endpointFailed(error: string): void
  electSuccessor(hasAnchor: boolean): boolean
  persistIntent(id: string): Promise<void>
  spawn(id: string): Promise<void>
  register(
    id: string,
    reference: CoordinatorReference,
    scopeCoverage: 'complete' | 'unknown',
  ): Promise<void>
  resume(id: string): Promise<void>
  ownerExited(owner: string): void
  freezeBeforeRename(id: string): Promise<void>
  userConfirmedStopped(id: string): boolean
  completePendingRename(id: string): Promise<boolean>
  settle(proof: CoordinatorRetirementProof): Promise<'released' | 'duplicate' | 'refused'>
  outcomeOf(id: string): { epoch: string; token: string } | undefined
  acknowledgeSettled(id: string): Promise<boolean>
  collectAcknowledged(): Promise<readonly string[]>
  close(): Promise<void>
}

/**
Open (or create) the machine's durable grant ledger. A second live
owner, an uncertain owner, an ambiguous store or a reused epoch
refuses; a provably dead owner yields to a fresh custody that retains
every open grant while dropping all reference authority.
*/
export async function openCoordinatorLedger(
  storeDirectory: string,
  epoch: string,
): Promise<CoordinatorLedger> {
  const custody = z.string().check(z.minLength(1)).parse(epoch)
  const directory = path.resolve(storeDirectory)
  await mkdir(directory, { recursive: true, mode: STORE_DIRECTORY_MODE })
  if (process.platform !== 'win32') await chmod(directory, STORE_DIRECTORY_MODE)
  assertStoreDirectory(await lstat(directory))
  const identity = await readJsonFile(directory, IDENTITY_FILE, identityFileSchema)
  const ledger = await readJsonFile(directory, LEDGER_FILE, ledgerFileSchema)
  const owner = await readJsonFile(directory, OWNER_FILE, ownerFileSchema)
  const storeId = identity.found ? identity.value.storeId : randomUUID()
  if (!identity.found) {
    // A store directory that already holds a ledger or an owner without
    // its identity is ambiguous initialisation: a blocking state, never
    // an empty ledger.
    if (ledger.found || owner.found)
      throw new CoordinatorLedgerError('ambiguousStore', UI_TEXT.coordinatorStoreAmbiguous)
    await writeFileAtomic(
      directory,
      IDENTITY_FILE,
      JSON.stringify({ storeId, version: COORDINATOR_STORE_VERSION }),
    )
  } else if (ledger.found && ledger.value.storeId !== storeId) {
    throw new CoordinatorLedgerError('identityMismatch', UI_TEXT.coordinatorStoreIdentity)
  }
  if (ledger.found && ledger.value.epoch === custody)
    throw new CoordinatorLedgerError('epochReused', UI_TEXT.coordinatorEpochReused)
  if (owner.found) {
    const gone = await isOwnerGone(owner.value)
    if (gone !== true)
      throw new CoordinatorLedgerError(
        gone === false ? 'owned' : 'ownerUncertain',
        gone === false ? UI_TEXT.coordinatorLedgerOwned : UI_TEXT.coordinatorLedgerOwnerUncertain,
      )
  }
  const birth = await exactProcessBirth(process.pid)
  const boot = await systemBootIdentity()
  // Our own birth and boot must be readable: an owner the next open
  // cannot check would wedge the store on every restart.
  if (birth === undefined || boot === undefined || boot === '')
    throw new CoordinatorLedgerError('ownerUncertain', UI_TEXT.coordinatorLedgerOwnerUncertain)
  const engine = new CoordinatorGrants(custody)
  if (ledger.found) engine.retainLoaded(ledger.value.grants)
  let isClosed = false

  const sync = async (): Promise<void> => {
    const state: LedgerFile = {
      storeId,
      version: COORDINATOR_STORE_VERSION,
      epoch: custody,
      grants: engine.snapshot(),
    }
    try {
      await writeFileAtomic(directory, LEDGER_FILE, JSON.stringify(state))
    } catch (error: unknown) {
      // A failed sync refuses the operation while the previous synced
      // state stands; the caller retries against that state.
      if (isCoordinatorLedgerError(error)) throw error
      throw new CoordinatorLedgerError('syncFailed', UI_TEXT.coordinatorSyncFailed, {
        cause: error,
      })
    }
  }

  /** Run an engine mutation journal-first: snapshot, mutate, sync, or restore and refuse. */
  const mutate = async <T>(operation: () => T): Promise<T> => {
    if (isClosed) throw new Error('The coordinator ledger is closed')
    const before: readonly CoordinatorGrantRecord[] = engine.snapshot()
    const result = operation()
    try {
      await sync()
    } catch (error: unknown) {
      engine.restore(before)
      throw error
    }
    return result
  }

  const requireOpen = (): void => {
    if (isClosed) throw new Error('The coordinator ledger is closed')
  }

  await writeFileAtomic(
    directory,
    OWNER_FILE,
    JSON.stringify({ pid: process.pid, birth, boot, epoch: custody }),
  )
  await sync()
  return {
    storeId,
    epoch: custody,
    get reachable(): boolean {
      return engine.reachable
    },
    reserve: (id, ownerName, resources) =>
      mutate(() => {
        engine.reserve(id, ownerName, resources)
      }),
    held(id: string): readonly string[] {
      requireOpen()
      return engine.held(id)
    },
    retirementState(id: string): 'active' | 'unknown' | 'finished' {
      requireOpen()
      return engine.retirementState(id)
    },
    endpointFailed(error: string): void {
      engine.endpointFailed(error)
    },
    electSuccessor(hasAnchor: boolean): boolean {
      return engine.electSuccessor(hasAnchor)
    },
    persistIntent: (id) =>
      mutate(() => {
        engine.persistIntent(id)
      }),
    spawn: (id) =>
      mutate(() => {
        engine.spawn(id)
      }),
    register: (id, reference, scopeCoverage) =>
      mutate(() => {
        engine.register(id, reference, scopeCoverage)
      }),
    resume: (id) =>
      mutate(() => {
        engine.resume(id)
      }),
    ownerExited(ownerName: string): void {
      engine.ownerExited(ownerName)
    },
    freezeBeforeRename: (id) =>
      mutate(() => {
        engine.freezeBeforeRename(id)
      }),
    userConfirmedStopped(id: string): boolean {
      return engine.userConfirmedStopped(id)
    },
    completePendingRename: (id) => mutate(() => engine.completePendingRename(id)),
    settle: (proof) => mutate(() => engine.settle(proof)),
    outcomeOf(id: string): { epoch: string; token: string } | undefined {
      requireOpen()
      return engine.outcomeOf(id)
    },
    acknowledgeSettled: (id) => mutate(() => engine.acknowledgeSettled(id)),
    collectAcknowledged: () => mutate(() => engine.collectAcknowledged()),
    async close(): Promise<void> {
      // Closing releases ownership; the ledger keeps every grant for the
      // next custody, which rechecks the owner before opening.
      requireOpen()
      isClosed = true
      await rm(path.join(directory, OWNER_FILE), { force: true })
    },
  }
}
