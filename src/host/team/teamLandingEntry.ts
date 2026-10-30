import * as z from 'zod/mini'
import path from 'node:path'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { UI_TEXT, GIT_METADATA_OPTIONS, HOOK_CONFIG_MAX_BYTES } from '../../shared/constants'
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { applyTeamMerge, TeamLanding } from '../../core/team/teamMerge'
import type { TeamMergePort, TeamMergeRefusal } from '../../core/team/teamHostService'
import type { TeamGit } from '../../core/team/teamGit'
import type { GitProcess } from '../git'
import { isSamePath } from '../../core/paths'
import { canonicalPath } from '../canonicalPath'
import { StagingCopy, checkIdentity, type TeamCheckIdentity } from './stagingCopy'
import {
  LandingJournal,
  hasOpenLanding as journalHasOpenLanding,
  landingFileAccess,
  parseLandingEntry,
  scanLandingEntries,
  type LandingRecord,
} from './landingJournal'
import { knownRepositoryHolder, takeIndexLock, type LandingHint } from './gitIndexLock'
import { createTeamJournal, type TeamJournal } from './teamJournal'
import { createWindowAuthority, type WindowAuthority, type WindowIdentity } from './windowIdentity'

/** What the check approved: pass/fail plus the Git tree hash of the approved bytes. */
export interface TeamCheckOutcome {
  readonly passed: boolean
  readonly treeSha?: string
}
export interface TeamLandingPolicy {
  readonly owner: WindowIdentity
  readonly checks: () => TeamCheckIdentity
  readonly runChecks: (folder: string, signal: AbortSignal) => Promise<TeamCheckOutcome>
  readonly confirmWithoutChecks: () => Promise<boolean>
  readonly validateTarget: (file: string) => Promise<void>
  readonly hints: () => Promise<readonly LandingHint[]>
  /** Confirmed takeover (K/I/X2): the person accepts recovering another
  window's open landing. Absent, foreign recovery is always denied. */
  readonly confirmTakeover?: ((record: LandingRecord) => Promise<boolean>) | undefined
}

const takeoverReceiptSchema = z.strictObject({
  windowInstanceId: z.string(),
  startedAt: z.number(),
  at: z.number(),
})

/** This window's journal store with takeover receipts written before authority. */
function createLandingStore(
  storage: string,
  owner: WindowIdentity,
  platform: NodeJS.Platform,
): {
  readonly store: TeamJournal
  readonly authority: WindowAuthority
  /** The journal store a record's own window writes: recovery settles the
  owner's record there, never a copy in the recovering window's store. */
  readonly storeFor: (recordOwner: WindowIdentity) => TeamJournal
} {
  const holder: { store?: TeamJournal } = {}
  const authority = createWindowAuthority(owner, async (foreign) => {
    if (holder.store === undefined) throw new Error(UI_TEXT.teamTrafficDetails.changedSinceOpened)
    await holder.store.write(
      `takeover-${foreign.instanceId}`,
      { windowInstanceId: foreign.instanceId, startedAt: foreign.startedAt, at: Date.now() },
      takeoverReceiptSchema,
    )
  })
  const storeFor = (recordOwner: WindowIdentity): TeamJournal =>
    createTeamJournal({
      storageDirectory: storage,
      owner: recordOwner,
      authority,
      maxRecordBytes: HOOK_CONFIG_MAX_BYTES,
      platform,
    })
  holder.store = storeFor(owner)
  return { store: holder.store, authority, storeFor }
}
interface LandingDeps {
  readonly root: string
  readonly storage: string
  readonly platform: NodeJS.Platform
  readonly isTrusted: () => boolean
  readonly runGit: TeamGit
  readonly policy: TeamLandingPolicy
  readonly writePaths: readonly string[] | undefined
}

/** The abort-and-trust admission re-checked after every await before a write. */
function landingAdmit(deps: Pick<LandingDeps, 'isTrusted'>, signal: AbortSignal): () => void {
  return () => {
    signal.throwIfAborted()
    if (!deps.isTrusted()) throw new Error(UI_TEXT.teamRunners.trustNotice)
  }
}

/** The staging copy's git process over the caller's admitted `runGit`. */
function landingGit(admit: () => void, runGit: TeamGit): GitProcess {
  return async (args, input) => {
    admit()
    const stdin =
      typeof input.input === 'string' || input.input === undefined
        ? input.input
        : new TextDecoder().decode(input.input)
    return Buffer.from(await runGit(args, input.cwd, stdin, input.env))
  }
}

/** A landing journal over the store each record's id resolves to. */
function storeLandingJournal(storeOf: (id: string) => TeamJournal): LandingJournal {
  return new LandingJournal({
    read: async (id) => {
      const read = await storeOf(id).read(`landing-${id}`, z.unknown())
      if (read.kind !== 'record') throw new Error(UI_TEXT.teamTrafficDetails.changedSinceOpened)
      return read.value
    },
    write: (record) => storeOf(record.id).write(`landing-${record.id}`, record, z.unknown()),
  })
}

/** The repository holder probe and the admitted index-lock lease. */
function landingLockPorts(input: {
  readonly root: string
  readonly gitDirectory: string
  readonly owner: WindowIdentity
  readonly policy: TeamLandingPolicy
  readonly platform: NodeJS.Platform
  readonly admit: () => void
}): Pick<ConstructorParameters<typeof TeamLanding>[0], 'knownHolder' | 'takeLock'> {
  const { root, gitDirectory, owner, policy, platform, admit } = input
  return {
    knownHolder: async (_folder, lock) =>
      await knownRepositoryHolder(
        root,
        gitDirectory,
        owner.instanceId,
        await policy.hints(),
        platform,
        lock,
      ),
    takeLock: async (_folder, id) => {
      admit()
      const lock = await takeIndexLock(gitDirectory, {
        landingId: id,
        windowInstanceId: owner.instanceId,
      })
      try {
        admit()
        return lock.kind === 'taken' ? lock.lease : null
      } catch (error) {
        if (lock.kind === 'taken') await lock.lease.release()
        throw error
      }
    },
  }
}

/** The journal and file ports both landing constructions share verbatim. */
function landingJournalPorts(
  journal: LandingJournal,
  access: ReturnType<typeof landingFileAccess>,
  around: Pick<ConstructorParameters<typeof TeamLanding>[0], 'prepare' | 'close'>,
): Pick<
  ConstructorParameters<typeof TeamLanding>[0],
  'prepare' | 'close' | 'replace' | 'recover' | 'undo'
> {
  return {
    ...around,
    replace: (_folder, file, canWrite) =>
      access.replace(file.path, file.before, file.after, canWrite),
    recover: (intent, canWrite) => journal.recover(intent, access, canWrite),
    undo: (intent, id, canWrite) => journal.undo(intent, id, access, canWrite),
  }
}

/**
The confirmed takeover shared by both recovery paths: the person accepts
this exact record, then authority is taken (receipted) before any write.
The caller has already proven the record is foreign and confirmable.
*/
async function hasConfirmedTakeover(input: {
  readonly admit: () => void
  readonly policy: TeamLandingPolicy
  readonly authority: WindowAuthority
  readonly record: LandingRecord
  readonly storeOwner: WindowIdentity
}): Promise<boolean> {
  const { admit, policy, authority, record, storeOwner } = input
  if (policy.confirmTakeover === undefined) return false
  admit()
  if (!(await policy.confirmTakeover(record))) return false
  admit()
  return await authority.takeOver(storeOwner, true)
}

/** Existing review permission admits staging; no user-tree write precedes checked landing. */
export async function landTeamTask(
  table: UiText,
  locale: string,
  deps: LandingDeps,
  task: Parameters<TeamMergePort['merge']>[0],
  signal: AbortSignal,
  options: Parameters<TeamMergePort['merge']>[2],
): ReturnType<TeamMergePort['merge']> {
  setUiText(table, locale)
  const { policy, root, runGit } = deps
  const admit = landingAdmit(deps, signal)
  const outcome = task.outcome
  if (
    outcome.head === undefined ||
    outcome.baseCommit === undefined ||
    outcome.agentsRef === undefined ||
    outcome.folder === undefined
  )
    throw new Error(UI_TEXT.teamTaskUnknown)
  const branchHead = outcome.head
  const agentsRef = outcome.agentsRef
  const git = landingGit(admit, runGit)
  const scratch = path.join(deps.storage, 'landing')
  await mkdir(scratch, { recursive: true })
  const copy = await mkdtemp(path.join(scratch, 'staging-'))
  const staging = new StagingCopy(git, process.env, scratch)
  const owner = policy.owner
  const { store: journalStore, authority } = createLandingStore(deps.storage, owner, deps.platform)
  const journal = storeLandingJournal(() => journalStore)
  const validateTarget = async (file: string) => {
    admit()
    await policy.validateTarget(file)
    admit()
    const actual = new TextDecoder()
      .decode(await runGit(['rev-parse', '--verify', agentsRef], root))
      .trim()
    admit()
    if (
      actual !== branchHead ||
      (outcome.changedFiles ?? []).every(
        (name) => !isSamePath(path.resolve(root, name), file, deps.platform),
      )
    )
      throw new Error(UI_TEXT.teamTrafficDetails.changedSinceOpened)
  }
  const access = landingFileAccess(root, staging, { validateTarget })
  const retention = { copy: false }
  try {
    admit()
    const snapshot = await staging.snapshot(root)
    await staging.clone(root, snapshot, copy)
    await runGit(
      ['fetch', '--no-tags', '--no-write-fetch-head', '--', root, `${agentsRef}:${agentsRef}`],
      copy,
    )
    const actual = new TextDecoder()
      .decode(await runGit(['rev-parse', '--verify', agentsRef], root))
      .trim()
    admit()
    const merged = await applyTeamMerge(
      { runGit, realPath: canonicalPath },
      {
        repositoryRoot: copy,
        baseCommit: outcome.baseCommit,
        branchHead,
        taskFolder: outcome.folder,
        agentRefs: [{ ref: agentsRef, expected: branchHead, actual }],
        ...(deps.writePaths !== undefined && { writePaths: deps.writePaths }),
      },
      { platform: deps.platform, allowProtected: options.allowProtected },
    )
    if (merged.status !== 'merged')
      return {
        status: 'rework',
        written: [],
        conflicts: merged.conflicts.map((conflict) => conflict.path),
      }
    const identity = checkIdentity(policy.checks())
    const isWithoutChecks = policy.checks().commands.length === 0
    const checkOutcome = isWithoutChecks ? undefined : await policy.runChecks(copy, signal)
    if (checkOutcome !== undefined && !checkOutcome.passed)
      return { status: 'rework', written: [], conflicts: [] }
    admit()
    if (checkOutcome?.treeSha !== undefined) {
      await runGit([...GIT_METADATA_OPTIONS, '-c', 'core.hooksPath=/dev/null', 'add', '-A'], copy)
      const approved = new TextDecoder()
        .decode(
          await runGit(
            [...GIT_METADATA_OPTIONS, '-c', 'core.hooksPath=/dev/null', 'write-tree'],
            copy,
          ),
        )
        .trim()
      admit()
      if (approved !== checkOutcome.treeSha)
        return {
          status: 'rework',
          written: [],
          conflicts: [],
          refusal: { kind: 'stale', action: 'rebuild' } satisfies TeamMergeRefusal,
        }
    }
    admit()
    const final = await staging.snapshot(copy)
    await runGit(['fetch', '--no-tags', '--no-write-fetch-head', '--', copy, final.commit], root)
    const admission = {
      id: randomUUID(),
      snapshot,
      final,
      checkIdentity: identity,
      owners: new Map((outcome.changedFiles ?? []).map((name) => [name, [task.taskId]])),
    }
    const gitDirectory = await staging.gitDirectory(root)
    const landing = new TeamLanding({
      windowInstanceId: owner.instanceId,
      canonicalRoot: canonicalPath,
      hasOpenLanding: (canonical) => journalHasOpenLanding(journalStore, canonical),
      snapshot: (folder) => staging.snapshot(folder),
      checkIdentity: () => Promise.resolve(checkIdentity(policy.checks())),
      invalidate: (admission) =>
        journalStore.write(
          `invalidated-${admission.id}`,
          {
            taskId: task.taskId,
            tree: admission.snapshot.tree,
            checkIdentity: admission.checkIdentity,
          },
          z.strictObject({ taskId: z.string(), tree: z.string(), checkIdentity: z.string() }),
        ),
      ...landingLockPorts({
        root,
        gitDirectory,
        owner,
        policy,
        platform: deps.platform,
        admit,
      }),
      defer: async (_folder, item) => {
        admit()
        retention.copy = true
        return await staging.landingBranch(root, item.final, item.id, copy)
      },
      confirmLanding: () => {
        admit()
        return Promise.resolve(true)
      },
      confirmWithoutChecks: policy.confirmWithoutChecks,
      ...landingJournalPorts(journal, access, {
        prepare: async (intent) => {
          admit()
          retention.copy = true
          await journal.prepare(intent)
        },
        close: async (intent, status, conflicts) => {
          await journal.close(intent, status, conflicts)
          retention.copy = false
        },
      }),
      // Owner-store recovery: this window's own open landing recovers at
      // once; another window's recovers only after the person's confirmed
      // takeover, receipted in this window's store before any write.
      authorizeRecovery: async (intent) => {
        admit()
        if (intent.windowInstanceId === owner.instanceId) return true
        if (policy.confirmTakeover === undefined) return false
        const scanned = await scanLandingEntries(journalStore)
        if (scanned.blocked) return false
        const entry = scanned.entries.find((item) => item.name === `landing-${intent.id}`)
        if (entry?.raw.kind !== 'record' || entry.owner.instanceId !== intent.windowInstanceId)
          return false
        const record = parseLandingEntry(entry.name, entry.raw.value)
        return await hasConfirmedTakeover({
          admit,
          policy,
          authority,
          record,
          storeOwner: entry.owner,
        })
      },
    })
    const landed = await landing.land(root, admission, isWithoutChecks)
    if (landed.status === 'landed')
      return { status: 'merged', written: merged.written, conflicts: [] }
    const conflicts = 'paths' in landed ? [...landed.paths] : []
    let refusal: TeamMergeRefusal
    switch (landed.status) {
      case 'branched': {
        refusal = { kind: 'branched', holder: landed.holder, branch: landed.branch }
        break
      }
      case 'busy': {
        refusal = { kind: 'busy', action: 'recheck' }
        break
      }
      case 'denied': {
        refusal = { kind: 'denied' }
        break
      }
      case 'stale': {
        refusal = { kind: 'stale', action: 'rebuild' }
        break
      }
      default: {
        throw new Error(UI_TEXT.teamTaskUnknown)
      }
    }
    return {
      status: 'rework',
      written: [],
      conflicts,
      refusal,
    }
  } finally {
    if (!retention.copy) await rm(copy, { recursive: true, force: true })
  }
}

/**
Startup recovery over the owner stores: every open landing for this root,
from this window's store and foreign ones, oldest first. Foreign records
recover only through the confirmed takeover in `authorizeRecovery`; an
unreadable store recovers nothing. Returns how many landings closed.
*/
export async function recoverOpenLandings(
  table: UiText,
  locale: string,
  deps: Omit<LandingDeps, 'writePaths'>,
  signal: AbortSignal,
): Promise<number> {
  setUiText(table, locale)
  const { policy, root, runGit } = deps
  const admit = landingAdmit(deps, signal)
  const owner = policy.owner
  const {
    store: journalStore,
    authority,
    storeFor,
  } = createLandingStore(deps.storage, owner, deps.platform)
  const scanned = await scanLandingEntries(journalStore)
  if (scanned.blocked) return 0
  const canonical = await canonicalPath(root)
  const open: { record: LandingRecord; storeOwner: WindowIdentity }[] = []
  for (const entry of scanned.entries) {
    if (entry.raw.kind !== 'record') return 0
    const record = parseLandingEntry(entry.name, entry.raw.value)
    if (record.status === 'open' && (await canonicalPath(record.root)) === canonical)
      open.push({ record, storeOwner: entry.owner })
  }
  if (open.length === 0) return 0
  const git = landingGit(admit, runGit)
  const scratch = path.join(deps.storage, 'landing')
  const staging = new StagingCopy(git, process.env, scratch)
  // Recovery settles each intent in its owner's store: a recovered copy in
  // this window's store would leave the owner's open intent blocking every
  // later landing. The takeover in authorizeRecovery runs first, so the
  // owner's store accepts the write.
  const ownerStoreOf = (id: string): TeamJournal => {
    const found = open.find((item) => item.record.id === id)
    return found === undefined ? journalStore : storeFor(found.storeOwner)
  }
  const journal = storeLandingJournal(ownerStoreOf)
  const access = landingFileAccess(root, staging, { validateTarget: policy.validateTarget })
  const gitDirectory = await staging.gitDirectory(root)
  const landing = new TeamLanding({
    windowInstanceId: owner.instanceId,
    canonicalRoot: canonicalPath,
    hasOpenLanding: () => Promise.resolve(false),
    snapshot: (folder) => staging.snapshot(folder),
    checkIdentity: () => Promise.resolve(checkIdentity(policy.checks())),
    invalidate: () => Promise.resolve(),
    ...landingLockPorts({
      root,
      gitDirectory,
      owner,
      policy,
      platform: deps.platform,
      admit,
    }),
    defer: () => Promise.reject(new Error(UI_TEXT.teamTrafficDetails.changedSinceOpened)),
    confirmLanding: () => Promise.resolve(false),
    confirmWithoutChecks: policy.confirmWithoutChecks,
    ...landingJournalPorts(journal, access, {
      prepare: async (intent) => {
        await journal.prepare(intent)
      },
      close: async (intent, status, conflicts) => {
        await journal.close(intent, status, conflicts)
      },
    }),
    authorizeRecovery: async (intent) => {
      admit()
      if (intent.windowInstanceId === owner.instanceId) return true
      const found = open.find((item) => item.record.id === intent.id)
      if (found?.storeOwner.instanceId !== intent.windowInstanceId) return false
      return await hasConfirmedTakeover({
        admit,
        policy,
        authority,
        record: found.record,
        storeOwner: found.storeOwner,
      })
    },
  })
  let recovered = 0
  for (const { record } of open) {
    admit()
    const outcome = await landing.recover(record)
    if (outcome.status === 'landed' || outcome.status === 'changed') recovered++
  }
  return recovered
}
