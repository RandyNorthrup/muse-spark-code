import * as z from 'zod/mini'
import path from 'node:path'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { UI_TEXT, GIT_METADATA_OPTIONS, HOOK_CONFIG_MAX_BYTES } from '../../shared/constants'
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { applyTeamMerge, TeamLanding, type LandingIntent } from '../../core/team/teamMerge'
import type {
  TeamLandingUndo,
  TeamMergeOutcome,
  TeamMergePort,
  TeamMergeRefusal,
  TeamOpenLanding,
} from '../../core/team/teamHostService'
import type { TeamGit } from '../../core/team/teamGit'
import type { GitProcess } from '../git'
import { isSamePath } from '../../core/paths'
import { canonicalPath, errnoCode } from '../canonicalPath'
import { StagingCopy, checkIdentity, type TeamCheckIdentity } from './stagingCopy'
import {
  LandingJournal,
  hasOpenLanding as journalHasOpenLanding,
  landingFileAccess,
  parseLandingEntry,
  scanLandingEntries,
  type LandingRecord,
} from './landingJournal'
import {
  indexLockHolder,
  knownRepositoryHolder,
  takeIndexLock,
  type LandingHint,
} from './gitIndexLock'
import { createTeamJournal, type TeamJournal } from './teamJournal'
import {
  createWindowAuthority,
  createWindowIdentity,
  type WindowAuthority,
  type WindowIdentity,
} from './windowIdentity'

/** What the check approved: pass/fail plus the Git tree hash of the approved bytes. */
export interface TeamCheckOutcome {
  readonly passed: boolean
  readonly treeSha?: string
  /** The check that failed, for the person's refusal. */
  readonly failed?: string
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
type LandingFiles = ReturnType<typeof landingFileAccess>

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

/**
The journal and file ports both landing constructions share verbatim. `back` is what putting
files back goes through: a landing that was stopped still rolls back, so it asks only what any
recovery asks.
*/
function landingJournalPorts(
  journal: LandingJournal,
  access: { readonly forward: LandingFiles; readonly back: LandingFiles },
  around: Pick<ConstructorParameters<typeof TeamLanding>[0], 'prepare' | 'close'>,
): Pick<
  ConstructorParameters<typeof TeamLanding>[0],
  'prepare' | 'close' | 'replace' | 'recover' | 'undo'
> {
  return {
    ...around,
    replace: (_folder, file, canWrite) =>
      access.forward.replace(file.path, file.before, file.after, canWrite),
    recover: (intent, canWrite) => journal.recover(intent, access.back, canWrite),
    undo: (intent, id, canWrite) => journal.undo(intent, id, access.back, canWrite),
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

/**
The workspace and the landing's storage as the file system resolves them
(PLAN.md D24), once, before either is used: an 8.3 short name (a Windows
TEMP under a long profile name, `RUNNER~1` on hosted runners), a junction
or a symbolic link above either folder (macOS's /var) names the same
folder by another spelling. The staging copy is made under the canonical
storage, so the merge applier's linked-root refusal judges only links
inside the copy; every user-tree target resolves under the canonical root,
so the write's canonical-target check judges only links inside the tree.
*/
async function canonicalLandingFolders(
  deps: Pick<LandingDeps, 'root' | 'storage'>,
): Promise<{ readonly root: string; readonly storage: string }> {
  return { root: await canonicalPath(deps.root), storage: await canonicalPath(deps.storage) }
}

/** What Windows answers a rename or removal over a file a program holds. */
const HELD_CODES: ReadonlySet<string> = new Set(['EPERM', 'EBUSY', 'EACCES'])

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
  const { policy, runGit } = deps
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
  await mkdir(path.join(deps.storage, 'landing'), { recursive: true })
  const { root, storage } = await canonicalLandingFolders(deps)
  const scratch = path.join(storage, 'landing')
  const copy = await mkdtemp(path.join(scratch, 'staging-'))
  const staging = new StagingCopy(git, process.env, scratch)
  const owner = policy.owner
  const { store: journalStore, authority } = createLandingStore(storage, owner, deps.platform)
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
  // Trust still binds a roll-back; the abort that stopped the landing does not.
  const back = landingFileAccess(root, staging, {
    validateTarget: async (file) => {
      if (!deps.isTrusted()) throw new Error(UI_TEXT.teamRunners.trustNotice)
      await policy.validateTarget(file)
    },
  })
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
      return {
        status: 'rework',
        written: [],
        conflicts: [],
        refusal: { kind: 'checks', action: 'recheck', check: checkOutcome.failed },
      }
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
    // Before anything is written: the person's unsaved work stops a landing whole, not half way.
    for (const name of merged.written) await policy.validateTarget(path.resolve(root, name))
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
      ...landingJournalPorts(
        journal,
        { forward: access, back },
        {
          prepare: async (intent) => {
            admit()
            retention.copy = true
            await journal.prepare(intent)
          },
          close: async (intent, status, conflicts) => {
            await journal.close(intent, status, conflicts)
            retention.copy = false
          },
        },
      ),
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
    let written: readonly string[] = []
    switch (landed.status) {
      case 'changed': {
        // What reached the tree stays named as written until Undo Merge puts it back.
        written = merged.written.filter((file) =>
          landed.paths.every((name) => !isSamePath(name, file, deps.platform)),
        )
        refusal = {
          kind: 'changed',
          action: 'recheck',
          paths: landed.paths,
          landingId: landed.intent.id,
        }
        break
      }
      case 'held': {
        // A failure that is no file being held keeps its own words, with the tree already back.
        if (!HELD_CODES.has(errnoCode(landed.cause) ?? '')) throw landed.cause
        refusal = { kind: 'held', action: 'recheck', paths: landed.paths }
        break
      }
      case 'branched': {
        refusal = { kind: 'branched', holder: landed.holder, branch: landed.branch }
        break
      }
      case 'busy': {
        // The landing's answer does not say why. What holds the repository now does.
        const holder = await knownRepositoryHolder(
          root,
          gitDirectory,
          owner.instanceId,
          await policy.hints(),
          deps.platform,
        )
        refusal = { kind: 'busy', action: 'recheck', ...(holder !== undefined && { holder }) }
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
      written,
      conflicts: landed.status === 'held' ? [...landed.kept] : conflicts,
      refusal,
    }
  } finally {
    if (!retention.copy) await rm(copy, { recursive: true, force: true })
  }
}

/** The landing that only puts back: recovery and Undo Merge, over a record already written. */
function rollbackLanding(input: {
  readonly deps: Omit<LandingDeps, 'writePaths'>
  readonly admit: () => void
  readonly root: string
  readonly staging: StagingCopy
  readonly journal: LandingJournal
  readonly gitDirectory: string
  readonly authorize: (intent: LandingIntent) => Promise<boolean>
}): TeamLanding {
  const { deps, admit, root, staging, journal, gitDirectory } = input
  const { policy } = deps
  const access = landingFileAccess(root, staging, { validateTarget: policy.validateTarget })
  return new TeamLanding({
    windowInstanceId: policy.owner.instanceId,
    canonicalRoot: canonicalPath,
    hasOpenLanding: () => Promise.resolve(false),
    snapshot: (folder) => staging.snapshot(folder),
    checkIdentity: () => Promise.resolve(checkIdentity(policy.checks())),
    invalidate: () => Promise.resolve(),
    ...landingLockPorts({
      root,
      gitDirectory,
      owner: policy.owner,
      policy,
      platform: deps.platform,
      admit,
    }),
    defer: () => Promise.reject(new Error(UI_TEXT.teamTrafficDetails.changedSinceOpened)),
    confirmLanding: () => Promise.resolve(false),
    confirmWithoutChecks: policy.confirmWithoutChecks,
    ...landingJournalPorts(
      journal,
      { forward: access, back: access },
      {
        prepare: async (intent) => {
          await journal.prepare(intent)
        },
        close: async (intent, status, conflicts) => {
          await journal.close(intent, status, conflicts)
        },
      },
    ),
    authorizeRecovery: input.authorize,
  })
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
  const { policy, runGit } = deps
  const admit = landingAdmit(deps, signal)
  const owner = policy.owner
  const { root, storage } = await canonicalLandingFolders(deps)
  const {
    store: journalStore,
    authority,
    storeFor,
  } = createLandingStore(storage, owner, deps.platform)
  const scanned = await scanLandingEntries(journalStore)
  if (scanned.blocked) return 0
  const open: { record: LandingRecord; storeOwner: WindowIdentity }[] = []
  for (const entry of scanned.entries) {
    if (entry.raw.kind !== 'record') return 0
    const record = parseLandingEntry(entry.name, entry.raw.value)
    if (record.status === 'open' && (await canonicalPath(record.root)) === root)
      open.push({ record, storeOwner: entry.owner })
  }
  if (open.length === 0) return 0
  const git = landingGit(admit, runGit)
  const scratch = path.join(storage, 'landing')
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
  const gitDirectory = await staging.gitDirectory(root)
  const landing = rollbackLanding({
    deps,
    admit,
    root,
    staging,
    journal,
    gitDirectory,
    authorize: async (intent) => {
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

/** Undo Merge over this window's landing that a changed file stopped, by M86's rule. */
export async function undoTeamLanding(
  table: UiText,
  locale: string,
  deps: Omit<LandingDeps, 'writePaths'>,
  landingId: string,
  taskId: string,
  signal: AbortSignal,
): Promise<TeamLandingUndo> {
  setUiText(table, locale)
  const { policy, runGit } = deps
  const admit = landingAdmit(deps, signal)
  const { root, storage } = await canonicalLandingFolders(deps)
  const { store } = createLandingStore(storage, policy.owner, deps.platform)
  const read = await store.read(`landing-${landingId}`, z.unknown())
  if (read.kind !== 'record') throw new Error(UI_TEXT.teamTrafficDetails.changedSinceOpened)
  const record = parseLandingEntry(`landing-${landingId}`, read.value)
  if (record.status !== 'changed') throw new Error(UI_TEXT.teamTrafficDetails.changedSinceOpened)
  const staging = new StagingCopy(
    landingGit(admit, runGit),
    process.env,
    path.join(storage, 'landing'),
  )
  const undone = await rollbackLanding({
    deps,
    admit,
    root,
    staging,
    journal: storeLandingJournal(() => store),
    gitDirectory: await staging.gitDirectory(root),
    authorize: () => Promise.resolve(true),
  }).undo(record, taskId)
  if (undone.status === 'busy' || undone.status === 'denied')
    return { status: undone.status, kept: [] }
  return { status: 'undone', kept: 'paths' in undone ? [...undone.paths] : [] }
}

/** The open landings for this root across every window's store: Traffic's recovery rows. */
export async function openTeamLandings(
  deps: Omit<LandingDeps, 'writePaths'>,
): Promise<readonly TeamOpenLanding[]> {
  const { root, storage } = await canonicalLandingFolders(deps)
  const { store } = createLandingStore(storage, deps.policy.owner, deps.platform)
  const scanned = await scanLandingEntries(store)
  const rows: TeamOpenLanding[] = []
  let lockPath: string | undefined
  let isLockRead = false
  for (const entry of scanned.entries) {
    if (entry.raw.kind !== 'record') continue
    const record = parseLandingEntry(entry.name, entry.raw.value)
    if (record.status !== 'open' || (await canonicalPath(record.root)) !== root) continue
    if (!isLockRead) {
      isLockRead = true
      const git = landingGit(landingAdmit(deps, new AbortController().signal), deps.runGit)
      const gitDirectory = await new StagingCopy(git, process.env, storage).gitDirectory(root)
      const holder = await indexLockHolder(gitDirectory)
      lockPath = holder?.kind === 'lock' ? holder.path : undefined
    }
    rows.push({
      id: record.id,
      windowInstanceId: record.windowInstanceId,
      paths: record.files.map((file) => file.path),
      ...(lockPath !== undefined && { lockPath }),
    })
  }
  return rows
}

/** What each surface brings to the checked landing; absent parts ask for nothing. */
export interface EngineLandingPorts {
  /** Another place for the journal and the staging copies than the engine's storage. */
  readonly storage?: string
  readonly checks?: () => TeamCheckIdentity
  readonly runChecks?: TeamLandingPolicy['runChecks']
  readonly validateTarget?: TeamLandingPolicy['validateTarget']
  readonly hints?: TeamLandingPolicy['hints']
  readonly confirmTakeover?: TeamLandingPolicy['confirmTakeover']
}

/**
The product's landing for one window: its identity, and every task's work through the checked
landing with recovery first. The merge card was the person's decision, and with no check set it
is what asks: there is no separate prompt to answer (the record's first decision).
*/
export function createEngineLanding(
  ui: { readonly table: UiText; readonly locale: string },
  input: {
    readonly root: () => Promise<string>
    readonly storage: () => Promise<string>
    readonly platform: NodeJS.Platform
    readonly isTrusted: () => boolean
    readonly runGit: TeamGit
    readonly now: () => number
    readonly ports: EngineLandingPorts | undefined
  },
) {
  const owner = createWindowIdentity(input.now())
  const { ports } = input
  const policy = (confirmTakeover: TeamLandingPolicy['confirmTakeover']): TeamLandingPolicy => ({
    owner,
    checks:
      ports?.checks ??
      (() => ({ commands: [], platform: input.platform, setupCommand: '', cacheKey: '' })),
    runChecks: ports?.runChecks ?? (() => Promise.resolve({ passed: true })),
    confirmWithoutChecks: () => Promise.resolve(true),
    validateTarget: ports?.validateTarget ?? (() => Promise.resolve()),
    hints: ports?.hints ?? (() => Promise.resolve([])),
    confirmTakeover,
  })
  const depsFor = async (confirmTakeover: TeamLandingPolicy['confirmTakeover']) => ({
    root: await input.root(),
    storage: ports?.storage ?? (await input.storage()),
    platform: input.platform,
    isTrusted: input.isTrusted,
    runGit: input.runGit,
    policy: policy(confirmTakeover),
  })
  const recover = async (confirm: TeamLandingPolicy['confirmTakeover'], signal: AbortSignal) =>
    await recoverOpenLandings(ui.table, ui.locale, await depsFor(confirm), signal)
  return {
    land: async (
      task: Parameters<TeamMergePort['merge']>[0],
      signal: AbortSignal,
      options: Parameters<TeamMergePort['merge']>[2],
      writePaths: readonly string[] | undefined,
    ): Promise<TeamMergeOutcome> => {
      // What an earlier landing left goes first, or this one is refused as busy.
      await recover(ports?.confirmTakeover, signal)
      return await landTeamTask(
        ui.table,
        ui.locale,
        { ...(await depsFor(undefined)), writePaths },
        task,
        signal,
        options,
      )
    },
    recover: async (isConfirmed: boolean, signal: AbortSignal): Promise<number> =>
      await recover(isConfirmed ? () => Promise.resolve(true) : ports?.confirmTakeover, signal),
    open: async () => await openTeamLandings(await depsFor(undefined)),
    undo: async (taskId: string, landingId: string, signal: AbortSignal) =>
      await undoTeamLanding(
        ui.table,
        ui.locale,
        await depsFor(undefined),
        landingId,
        taskId,
        signal,
      ),
  }
}
