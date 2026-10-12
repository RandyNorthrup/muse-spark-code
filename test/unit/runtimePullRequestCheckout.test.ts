// Checking out a pull request in the runtime (M123 lane P): refusals,
// the own worktree beside the repository, the held worktree under the
// data folder, the hold over both roots and its release, on the REST fake
// with a recording git port — then end to end on the fixture repositories
// with the real git runner, every git it starts through the dispatch gate.

import { execFile, execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { hostname as hostnameOf, tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveExecutable } from '../../src/core/executables'
import { fileIdentityKey } from '../../src/core/fs/fileIdentity'
import { isSamePath } from '../../src/core/paths'
import { BlobAnswers } from '../../src/core/git/heldCheckoutCore'
import type { HeldEntry } from '../../src/core/git/heldTree'
import { currentProcessOwner, type ProcessOwner } from '../../src/core/locks/processOwner'
import {
  heldWorktreeFolder,
  heldWorktreesRoot,
  type WorktreeRecord,
} from '../../src/core/worktreeConversations'
import { createFileExclusively } from '../../src/host/fsAtomic'
import { PENDING_CHECKOUT_RECOVERY_MS, UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import ES from '../../l10n/ui.es.json'
import {
  CleanupPendingError,
  createNodePullRequestCheckoutGit,
  HeldFolderTakenError,
  HeldWriters,
  nodeGitProcesses,
  pullRequestFetchEnvironment,
  quietPullRequestEnvironment,
  ReservationLostError,
  runBatchChild,
  RuntimePullRequestCheckout,
  type CheckoutGates,
  type GitProcessPort,
  type MadeFolder,
  type PullRequestCheckoutGit,
  type OpenPullRequestResult,
  type RuntimeCheckoutDeps,
} from '../../src/runtime/panel/pullRequests/checkout'
import {
  createFileWorktreeRecordStore,
  createMemoryWorktreeRecordStore,
  holdForRoots,
  recordRevision,
  versionOf,
  type TrustTicket,
  type WorktreeRecordStore,
} from '../../src/runtime/panel/pullRequests/records'
import {
  nodeRecordStoreFs,
  type RecordStoreFs,
} from '../../src/runtime/panel/pullRequests/recordStoreFs'
import { fakeGitHub } from './helpers/fakeGitHub'
import {
  deferred,
  exitedProcessId,
  failingListingsAfterLink,
  GENERATION_FILE,
} from './helpers/leaseFs'
import { recordingLogger } from './helpers/recordingLogger'
import { CAPTURED_PULL_FORK, CAPTURED_PULL_OWN } from './helpers/githubCapture'
import { fakeRuntimeGitDeps, fakeTokenSource } from './helpers/github/fakes'
import { createFixtureRepositories, type FixtureRepositories } from './helpers/github/repositories'

import * as launcher from '../../src/core/resources/launcher'
import * as admission from '../../src/core/resources/admission'
import { fakeResourceLease } from './helpers/resources/fakes'
import {
  type ResourceProcessLaunch,
  ResourceUnavailableError,
  ResourceMemoryLimitError,
  ResourceCapRefusedError,
  ResourcePausedError,
  resourcePausedText,
} from '../../src/core/resources/launch'
import { fixtureRuntimeAdmission } from './helpers/runtimeAdmission'
import { redactSecrets } from '../../src/core/redact'
import { GIT_STDERR_MAX_CHARS } from '../../src/shared/constants'
vi.mock('../../src/core/resources/admission', { spy: true })
const CANARY = 'm123p-checkout-canary'
const OWN = { owner: 'RandyNorthrup', name: 'muse-spark-code' }
const OWN_PULLS = '/repos/RandyNorthrup/muse-spark-code/pulls/56'
const FORK_PULLS = '/repos/RandyNorthrup/muse-spark-code/pulls/51'
const FOREIGN_TEXT = 'not this checkout’s'

/** A held destination under a fresh data folder, and a foreign file's place in it. */
async function raceFolder(): Promise<{ readonly folder: string; readonly foreign: string }> {
  const dataFolder = await mkdtemp(path.join(tmpdir(), 'm123p-own-'))
  const folder = path.join(dataFolder, 'pr-worktrees', '51-race')
  return { folder, foreign: path.join(folder, 'foreign.txt') }
}

// The held checkout's gates are counted by the route, never by a literal:
// POSIX checks twice per git and Windows rechecks at GO too, so the claim
// lands after a different number of checks on each platform. A test that
// must act at the claim or the add anchors on the claim itself (below),
// and a test that must cover every check learns the count from a dry run.
const CAPTURED_ORIGIN = {
  repository: 'RandyNorthrup/muse-spark-code',
  number: 51,
  url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/51',
  title: 'A foreign pull request',
  author: 'Piangpi1997',
  headSha: CAPTURED_PULL_FORK.head.sha,
  isAuthoredByUser: false,
} as const

/** Where the service checks pull request `number` of OWN out, held. */
function heldFolderOf(dataFolder: string, number: number): string {
  return heldWorktreeFolder(dataFolder, OWN, number, process.platform)
}

interface GitCalls {
  readonly fetched: { readonly cwd: string; readonly remote: string; readonly ref: string }[]
  readonly addedOwn: { readonly cwd: string; readonly folder: string; readonly sha: string }[]
  readonly checkedOutHeld: { readonly folder: string; readonly sha: string; readonly cwd: string }[]
  readonly removed: string[]
}

/** The folder, made for this checkout alone as the real port makes it: exclusively. */
async function claimFolderExclusively(folder: string): Promise<MadeFolder> {
  await mkdir(path.dirname(folder), { recursive: true })
  try {
    await mkdir(folder)
  } catch {
    throw new HeldFolderTakenError(folder)
  }
  const made = await lstat(folder, { bigint: true })
  return {
    folder,
    identity: { dev: made.dev, ino: made.ino },
    bornNs: made.birthtimeNs,
    hasAdded: false,
  }
}

/** Whether the folder at `made`'s place is still the very one made. */
async function isMade(made: MadeFolder): Promise<boolean> {
  try {
    const seen = await lstat(made.folder, { bigint: true })
    return (
      seen.dev === made.identity.dev &&
      seen.ino === made.identity.ino &&
      seen.birthtimeNs === made.bornNs
    )
  } catch {
    return false
  }
}

/** The identity a finished checkout records, as the service reads it. */
async function identityString(folder: string): Promise<string | undefined> {
  const seen = await stat(folder, { bigint: true })
  const key = fileIdentityKey(seen)
  return key === undefined ? undefined : `${key}:${seen.birthtimeNs.toString()}`
}

/** A held checkout as a test scripts it: the gates and the claim are the service's. */
type HeldBehavior = (
  folder: string,
  gates: CheckoutGates,
  claim: () => Promise<MadeFolder>,
) => Promise<void>

/** What git leaves after a successful add: the worktree's files. */
async function added(made: MadeFolder): Promise<void> {
  made.hasAdded = true
  await writeFile(path.join(made.folder, 'README.md'), 'checked out')
}

interface Failures {
  fetch?: boolean
  add?: boolean
  /** What the checkout made cannot be removed (a file held open, say). */
  cleanup?: boolean
}

function recordingGit(
  headSha: string,
  failures: Failures = {},
  addOwnWorktree?: (call: number) => Promise<void>,
  checkOutHeld?: HeldBehavior,
): {
  readonly git: PullRequestCheckoutGit
  readonly calls: GitCalls
} {
  const calls: GitCalls = { fetched: [], addedOwn: [], checkedOutHeld: [], removed: [] }
  const adding = () =>
    failures.add === true
      ? Promise.reject(new Error('the worktree could not be added'))
      : Promise.resolve()
  const isGoneAfterRemoving = async (made: MadeFolder): Promise<boolean> => {
    calls.removed.push(made.folder)
    if (!(await isMade(made))) {
      return true
    }
    if (failures.cleanup === true) {
      return false
    }
    await rm(made.folder, { recursive: true, force: true })
    return true
  }
  const addInto = async (made: MadeFolder, gates: CheckoutGates, work: Promise<void>) => {
    try {
      gates.run()
      await work
      await added(made)
    } catch (error: unknown) {
      await isGoneAfterRemoving(made)
      throw error
    }
  }
  return {
    calls,
    git: {
      fetch: (cwd, remote, ref, gate) => {
        gate()
        calls.fetched.push({ cwd, remote, ref })
        return failures.fetch === true
          ? Promise.reject(new Error('the network is down'))
          : Promise.resolve()
      },
      readFetchHead: (_cwd, gate) => {
        gate()
        return Promise.resolve(`${headSha}\n`)
      },
      claimFolder: claimFolderExclusively,
      addOwnWorktree: async (cwd, folder, sha, gates, claim) => {
        calls.addedOwn.push({ cwd, folder, sha })
        const call = calls.addedOwn.length
        const made = await claim()
        await addInto(made, gates, addOwnWorktree === undefined ? adding() : addOwnWorktree(call))
      },
      checkOutHeld: async (folder, sha, cwd, gates, claim) => {
        calls.checkedOutHeld.push({ folder, sha, cwd })
        if (checkOutHeld !== undefined) {
          await checkOutHeld(folder, gates, claim)
          return
        }
        // The listing, gated before anything is made.
        gates.run()
        const made = await claim()
        await addInto(made, gates, adding())
      },
      removeMade: (_cwd, made) => isGoneAfterRemoving(made),
      identityOf: async (made) =>
        (await isMade(made)) ? await identityString(made.folder) : undefined,
    },
  }
}

/** A held checkout that waits for the test before it claims, then checks out. */
function claimingAfter(waiting: () => void, gate: Promise<undefined>): HeldBehavior {
  return async (_folder, gates, claim) => {
    waiting()
    await gate
    const made = await claim()
    gates.run()
    await added(made)
  }
}

/** An own checkout that waits for the test before it claims, then adds. */
function ownAddAfter(
  waiting: () => void,
  gate: Promise<undefined>,
): PullRequestCheckoutGit['addOwnWorktree'] {
  return async (_cwd, _folder, _sha, gates, claim) => {
    waiting()
    await gate
    const made = await claim()
    gates.run()
    await added(made)
  }
}

/** The folder check a supersede runs under its hold: nothing there. */
function isFolderGone(): boolean {
  return true
}

/**
 * `target` with its links resolved (macOS's temp folder is a link into
 * `/private`, which git prints resolved; Windows 8.3 short names, which
 * git prints expanded); for a path that is gone, its parent's, so a
 * worktree git still lists compares the same. The native resolver on every
 * platform: plain `realpathSync` does not expand 8.3 names on Windows.
 */
function resolvedPath(target: string): string {
  try {
    return realpathSync.native(target)
  } catch {
    try {
      return path.join(realpathSync.native(path.dirname(target)), path.basename(target))
    } catch {
      return target
    }
  }
}

/** The runner's own claim: the folder made exclusively. */
function claimOf(runner: PullRequestCheckoutGit, folder: string): () => Promise<MadeFolder> {
  return () => runner.claimFolder(folder)
}

/**
 * The runner's claim wrapped so the test knows the claim by name: `check`
 * runs `afterClaim` at the first gate after the claim lands, wherever the
 * route puts the claim on this platform. `didRun` stays false when the
 * claim never landed, so the test fails loudly instead of asserting on a
 * state that was never created.
 */
function claimThen(
  runner: PullRequestCheckoutGit,
  folder: string,
  afterClaim: () => void,
): {
  readonly claim: () => Promise<MadeFolder>
  readonly check: () => void
  readonly didRun: () => boolean
} {
  let isClaimed = false
  let hasRun = false
  return {
    claim: async () => {
      const made = await runner.claimFolder(folder)
      isClaimed = true
      return made
    },
    check: () => {
      if (!isClaimed || hasRun) {
        return
      }
      hasRun = true
      afterClaim()
    },
    didRun: () => hasRun,
  }
}

/**
 * The 8.3 short spelling of `target`, asked of Windows itself; undefined
 * when it cannot be asked. Windows-only: POSIX has no short names.
 */
function shortPathOf(target: string): string | undefined {
  try {
    const shown = execFileSync(
      'cmd.exe',
      ['/d', '/s', '/c', `for %I in ("${target}") do @echo %~sI`],
      {
        encoding: 'utf8',
      },
    )
    const [first] = shown.split(/\r?\n/u, 1)
    const short = first?.trim() ?? ''
    return short === '' ? undefined : short
  } catch {
    return undefined
  }
}

/**
 * Two windows over one record store, the same repository and data
 * folder, each at its own wall-clock time: B's an hour and a moment ahead,
 * so it takes A's pending reservation over while A's folder is absent.
 */
async function twoWindowRace() {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'm123p-race-repo-'))
  const dataFolder = await mkdtemp(path.join(tmpdir(), 'm123p-race-data-'))
  const storageRoot = await mkdtemp(path.join(tmpdir(), 'm123p-race-vsc-'))
  const records = createMemoryWorktreeRecordStore(process.platform)
  const heldRoots = [
    heldWorktreesRoot(storageRoot, process.platform),
    heldWorktreesRoot(dataFolder, process.platform),
  ]
  const { deps } = fakeRuntimeGitDeps(repositoryRoot)
  const make = (now: number, git: PullRequestCheckoutGit, store: WorktreeRecordStore = records) =>
    new RuntimePullRequestCheckout({
      ...deps,
      repositoryRoot,
      dataFolder,
      tokenSources: [
        fakeTokenSource('deviceFlow', {
          bearer: CANARY,
          isSignedIn: true,
          fetch: fakeGitHub().fetch,
        }),
      ],
      platform: process.platform,
      now: () => now,
      confirm: () => Promise.resolve(true),
      openFolder: () => Promise.resolve(),
      baseUrl: 'https://api.github.test',
      log: recordingLogger(),
      isTrusted: () => true,
      records: store,
      heldRoots,
      git,
      pathExists: (fsPath) => existsSync(fsPath),
    } satisfies RuntimeCheckoutDeps)
  return {
    records,
    heldFolder: heldFolderOf(dataFolder, 51),
    window: (now: number, checkOutHeld: HeldBehavior, store?: WorktreeRecordStore) =>
      make(now, recordingGit(CAPTURED_PULL_FORK.head.sha, {}, undefined, checkOutHeld).git, store),
    ownWindow: (now: number, addOwnWorktree: PullRequestCheckoutGit['addOwnWorktree']) =>
      make(now, { ...recordingGit(CAPTURED_PULL_OWN.head.sha).git, addOwnWorktree }),
    /** Exactly one window succeeded, and its finished checkout is the one record. */
    expectOneOwner: async (results: readonly OpenPullRequestResult[]) => {
      const succeeded = results.filter((result) => result.ok)
      expect(succeeded).toHaveLength(1)
      const [winner] = succeeded
      const kept = await records.list()
      expect(kept).toHaveLength(1)
      expect(kept[0]?.isCheckoutPending).toBeUndefined()
      expect(winner !== undefined && existsSync(winner.folder)).toBe(true)
    },
  }
}

/** The folder as the store spells it: `/` separators on every platform. */
function slashedPath(folder: string): string {
  return folder.replaceAll('\\', '/')
}

/**
 * Records as files whose next generation, once armed, pauses after its
 * stage is flushed: past a release's entry check, before the
 * publication's last check and its link. `afterLink` runs once a
 * generation has landed.
 */
function stagedReleaseRecords() {
  const staged = deferred()
  const resume = deferred()
  const control = { isArmed: false, afterLink: (): void => undefined }
  const fs: RecordStoreFs = {
    ...nodeRecordStoreFs,
    createExclusive: async (file, content, durability) => {
      await nodeRecordStoreFs.createExclusive(file, content, durability)
      if (!control.isArmed || !path.basename(file).startsWith('.stage-')) {
        return
      }
      control.isArmed = false
      staged.resolve()
      await resume.promise
    },
    link: async (existing, target) => {
      await nodeRecordStoreFs.link(existing, target)
      if (GENERATION_FILE.test(target)) {
        control.afterLink()
      }
    },
  }
  return {
    control,
    staged: staged.promise,
    resume: resume.resolve,
    records: (dataFolder: string) =>
      createFileWorktreeRecordStore(dataFolder, process.platform, recordingLogger(), { fs }),
  }
}

/** A release refused because `ending` happened: its reason, and the hold still on `folder`. */
async function expectReleaseRefused(
  setup: CheckoutSetup,
  folder: string,
  released: Awaited<ReturnType<RuntimePullRequestCheckout['releaseHold']>>,
  ending: 'trust revoked' | 'window stopped',
): Promise<void> {
  expect(released.ok).toBe(false)
  if (ending === 'trust revoked') expect(released.reason).toBe(UI_TEXT.gitRestricted)
  expect(
    holdForRoots([folder], setup.heldRoots, await setup.records.list(), process.platform)?.folder,
  ).toBe(slashedPath(folder))
}

async function ticketFor(checkout: RuntimePullRequestCheckout, folder: string) {
  const ticket = await checkout.trustTicket(folder)
  if (ticket === undefined) {
    throw new Error(`no trust ticket for ${folder}`)
  }
  return ticket
}

/** The card shown for `folder`, confirmed: whether the hold was released. */
async function isTrustedInCard(checkout: RuntimePullRequestCheckout, folder: string) {
  const released = await checkout.releaseHold(await ticketFor(checkout, folder))
  return released.ok
}

/** How a promise settled, without letting a rejection go unhandled. */
async function settled<T>(work: Promise<T>): Promise<T | Error> {
  try {
    return await work
  } catch (error: unknown) {
    return error instanceof Error ? error : new Error(String(error))
  }
}

/** Signed in through the device flow, with the canary bearer, on `github`. */
function signedIn(github: { readonly fetch: typeof fetch }) {
  return [fakeTokenSource('deviceFlow', { bearer: CANARY, isSignedIn: true, fetch: github.fetch })]
}

/** Pull request 51 opened over `remotes`, which must succeed held under the data folder. */
async function heldOpen(
  checkout: RuntimePullRequestCheckout,
  remotes: Parameters<RuntimePullRequestCheckout['open']>[1],
  dataFolder: string,
) {
  const result = await checkout.open('51', remotes, 'origin')
  if (!result.ok) {
    throw new Error('checkout failed')
  }
  expect(result.held).toBe(true)
  expect(result.folder.startsWith(path.join(dataFolder, 'pr-worktrees', '51-'))).toBe(true)
  return result
}

/** Pull request 51 opened over OWN_REMOTES, which must succeed (`what` names it if not). */
async function opened51(checkout: RuntimePullRequestCheckout, what: string) {
  const result = await checkout.open('51', OWN_REMOTES, 'origin')
  if (!result.ok) {
    throw new Error(`${what} failed`)
  }
  return result
}

/** A first checkout of 51, confirmed in the card, whose folder was then removed by hand. */
async function trustedThenRemoved(checkout: RuntimePullRequestCheckout) {
  const first = await opened51(checkout, 'first checkout')
  expect(await isTrustedInCard(checkout, first.folder)).toBe(true)
  await rm(first.folder, { recursive: true, force: true })
  return first
}

type CheckoutSetup = Awaited<ReturnType<typeof checkoutSetup>>

/** A pending held reservation of pull request 51, as a crashed or stalled checkout leaves it. */
async function reservedPending(
  setup: CheckoutSetup,
  checkoutId: string,
  createdAt: number,
  pendingOwner: ProcessOwner,
): Promise<string> {
  const folder = heldFolderOf(setup.dataFolder, 51)
  const reserved = await setup.records.reserve({
    folder,
    repositoryRoot: setup.repositoryRoot,
    createdAt,
    checkoutId,
    pendingOwner,
    pullRequest: CAPTURED_ORIGIN,
    isHeld: true,
    isCheckoutPending: true,
  })
  expect(reserved.ok).toBe(true)
  return folder
}

/** Pull request 51 opened again, successfully: the record it left at `folder`. */
async function reopenedRecord(setup: CheckoutSetup, folder: string) {
  const result = await setup.checkout.open('51', OWN_REMOTES, 'origin')
  expect(result.ok).toBe(true)
  return await setup.records.recordFor(folder)
}

/**
 * A batch root that answers the first of two blobs and then goes quiet,
 * so its deadline fires while the first blob's writer is in flight. Ready
 * once its answer is readable (nothing read yet): a loaded machine's node
 * start-up never runs out the deadline before the answer exists.
 */
async function oneAnswerBatch(): Promise<{
  readonly child: ReturnType<typeof spawn>
  readonly blobs: HeldEntry[]
}> {
  const blobs: HeldEntry[] = [
    { path: 'first.txt', kind: 'file', oid: 'a'.repeat(40), size: 5 },
    { path: 'second.txt', kind: 'file', oid: 'b'.repeat(40), size: 5 },
  ]
  const script = [
    String.raw`process.stdout.write('${'a'.repeat(40)} blob 5\nhello\n');`,
    'process.stdin.resume();',
    'setTimeout(() => {}, 60000);',
  ].join('\n')
  const child = spawn(process.execPath, ['-e', script], {
    windowsHide: true,
    detached: process.platform !== 'win32',
  })
  child.stderr.resume()
  await once(child.stdout, 'readable')
  return { child, blobs }
}

async function checkoutSetup(
  options: {
    readonly signedIn?: boolean
    readonly isTrusted?: () => boolean
    readonly confirm?: boolean
    readonly headSha?: string
    readonly noSources?: boolean
    readonly failures?: Failures
    readonly now?: () => number
    readonly addOwnWorktree?: (call: number) => Promise<void>
    readonly checkOutHeld?: HeldBehavior
    /** The records over the data folder made for the setup (a file store, say). */
    readonly records?: (dataFolder: string) => WorktreeRecordStore
    /** The window's lifetime; the fake deps' own by default. */
    readonly signal?: AbortSignal
  } = {},
) {
  const github = fakeGitHub()
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'm123p-repo-'))
  const dataFolder = await mkdtemp(path.join(tmpdir(), 'm123p-data-'))
  const storageRoot = await mkdtemp(path.join(tmpdir(), 'm123p-vscode-'))
  const { deps } = fakeRuntimeGitDeps(repositoryRoot)
  const log = recordingLogger()
  const confirms: { readonly message: string; readonly detail: string; readonly action: string }[] =
    []
  const opened: string[] = []
  const source = fakeTokenSource('deviceFlow', {
    bearer: CANARY,
    isSignedIn: options.signedIn ?? true,
    fetch: github.fetch,
  })
  const recording = recordingGit(
    options.headSha ?? CAPTURED_PULL_OWN.head.sha,
    options.failures,
    options.addOwnWorktree,
    options.checkOutHeld,
  )
  const records = options.records?.(dataFolder) ?? createMemoryWorktreeRecordStore(process.platform)
  const heldRoots = [
    heldWorktreesRoot(storageRoot, process.platform),
    heldWorktreesRoot(dataFolder, process.platform),
  ]
  const checkout = new RuntimePullRequestCheckout({
    ...deps,
    repositoryRoot,
    dataFolder,
    tokenSources: options.noSources === true ? [] : [source],
    platform: process.platform,
    now: options.now ?? (() => 2000),
    confirm: (message, detail, action) => {
      confirms.push({ message, detail, action })
      return Promise.resolve(options.confirm ?? true)
    },
    openFolder: (folder) => {
      opened.push(folder)
      return Promise.resolve()
    },
    baseUrl: 'https://api.github.test',
    log,
    isTrusted: options.isTrusted ?? (() => true),
    ...(options.signal !== undefined && { signal: options.signal }),
    records,
    heldRoots,
    git: recording.git,
    pathExists: (fsPath) => existsSync(fsPath),
  } satisfies RuntimeCheckoutDeps)
  return {
    github,
    checkout,
    confirms,
    opened,
    log,
    source,
    repositoryRoot,
    dataFolder,
    storageRoot,
    git: recording,
    records,
    heldRoots,
  }
}

const OWN_REMOTES = [{ name: 'origin', repository: OWN }]

/** Gates for driving the runner directly: `check` before every git and file. */
function runnerGates(check: () => void = () => undefined): CheckoutGates {
  return { run: check, write: check, cleanup: () => undefined }
}

/**
 * The records with every call (but the synchronous gate read) going
 * through `around`, which runs before and after it; `holdsSync` stays as
 * it is, so the dispatch gate reads it as the service does.
 */
function recordsAround(
  store: WorktreeRecordStore,
  around: (name: string, call: () => Promise<unknown>) => Promise<unknown>,
): WorktreeRecordStore {
  return new Proxy(store, {
    get: (target, name, receiver) => {
      const value: unknown = Reflect.get(target, name, receiver)
      return typeof value !== 'function' || name === 'holdsSync'
        ? value
        : (...args: unknown[]) =>
            around(String(name), () => Promise.resolve(Reflect.apply(value, target, args)))
    },
  })
}

describe('runtime pull request checkout (M123 lane P)', () => {
  it('refuses a pull request reference that is not one', async () => {
    const { checkout, git, confirms } = await checkoutSetup()
    const result = await checkout.open('not a pull request', OWN_REMOTES, 'origin')
    expect(result).toEqual({ ok: false, reason: UI_TEXT.openPullRequestInvalid })
    expect(git.calls.fetched).toHaveLength(0)
    expect(confirms).toHaveLength(0)
  })

  it('refuses when no remote reaches the pull request', async () => {
    const { checkout, git } = await checkoutSetup()
    const noRemote = await checkout.open('56', [], undefined)
    expect(noRemote).toEqual({ ok: false, reason: UI_TEXT.openPullRequestNoRemote })
    const otherRepository = await checkout.open(
      'https://github.com/someone-else/other/pull/7',
      OWN_REMOTES,
      'origin',
    )
    expect(otherRepository.ok).toBe(false)
    expect(git.calls.fetched).toHaveLength(0)
  })

  it('asks for sign-in when no source has a credential', async () => {
    const { checkout, git, github } = await checkoutSetup({ noSources: true })
    const result = await checkout.open('56', OWN_REMOTES, 'origin')
    expect(result).toEqual({ ok: false, reason: UI_TEXT.gitHubSignInDeclined })
    expect(git.calls.fetched).toHaveLength(0)
    expect(github.requests).toHaveLength(0)
  })

  it('checks out the user’s own pull request beside the repository', async () => {
    const { checkout, git, confirms, opened, repositoryRoot } = await checkoutSetup()
    const result = await checkout.open('56', OWN_REMOTES, 'origin')
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.held).toBe(false)
    expect(result.number).toBe(56)
    expect(result.folder).toBe(
      path.join(
        path.dirname(repositoryRoot),
        `${path.basename(repositoryRoot)}.worktrees`,
        'pr-56',
      ),
    )
    expect(git.calls.fetched).toEqual([
      { cwd: repositoryRoot, remote: 'origin', ref: 'pull/56/head' },
    ])
    expect(git.calls.addedOwn).toHaveLength(1)
    expect(git.calls.checkedOutHeld).toHaveLength(0)
    expect(confirms).toHaveLength(1)
    expect(confirms[0]?.detail).toContain(CAPTURED_PULL_OWN.title)
    expect(opened).toEqual([result.folder])
  })

  it('checks out someone else’s pull request held under the data folder', async () => {
    const { checkout, git, confirms, opened, dataFolder, repositoryRoot } = await checkoutSetup({
      headSha: CAPTURED_PULL_FORK.head.sha,
    })
    const result = await heldOpen(checkout, OWN_REMOTES, dataFolder)
    expect(git.calls.checkedOutHeld).toEqual([
      { folder: result.folder, sha: CAPTURED_PULL_FORK.head.sha, cwd: repositoryRoot },
    ])
    expect(git.calls.addedOwn).toHaveLength(0)
    expect(confirms[0]?.detail).toContain(UI_TEXT.openPullRequestHeldDetail)
    expect(opened).toEqual([result.folder])
  })

  it('checks nothing out without an explicit confirm', async () => {
    const { checkout, git, opened } = await checkoutSetup({ confirm: false })
    const result = await checkout.open('56', OWN_REMOTES, 'origin')
    expect(result.ok).toBe(false)
    expect(git.calls.addedOwn).toHaveLength(0)
    expect(opened).toHaveLength(0)
  })

  it('refuses when the fetch disagrees with the pull request’s head', async () => {
    const { checkout, git } = await checkoutSetup({ headSha: '0'.repeat(40) })
    const result = await checkout.open('56', OWN_REMOTES, 'origin')
    expect(result).toEqual({ ok: false, reason: UI_TEXT.gitOperationChanged })
    expect(git.calls.addedOwn).toHaveLength(0)
  })

  it('reports a failed fetch and keeps no record', async () => {
    const { checkout, records } = await checkoutSetup({ failures: { fetch: true } })
    const result = await checkout.open('56', OWN_REMOTES, 'origin')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain(UI_TEXT.openPullRequestFetchFailed)
    }
    expect(await records.list()).toEqual([])
  })

  it('drops the credential on a 401 and asks to sign in again', async () => {
    const setup = await checkoutSetup()
    setup.github.answer('GET', OWN_PULLS, { status: 401, body: {} })
    const result = await setup.checkout.open('56', OWN_REMOTES, 'origin')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.needsSignIn).toBe(true)
    }
    expect(setup.source.rejectedBearers).toEqual([CANARY])
    expect(setup.git.calls.addedOwn).toHaveLength(0)
    expect(setup.opened).toHaveLength(0)
  })

  it('removes the record and the folder when the worktree cannot be added', async () => {
    const setup = await checkoutSetup({ failures: { add: true } })
    const result = await setup.checkout.open('56', OWN_REMOTES, 'origin')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain(UI_TEXT.worktreeAddFailed)
    }
    const folder = setup.git.calls.addedOwn[0]?.folder ?? ''
    expect(existsSync(folder)).toBe(false)
    expect(await setup.records.list()).toEqual([])
  })

  it('serializes overlapping opens instead of stranding the checkout pending', async () => {
    let stamps = 0
    const setup = await checkoutSetup({
      now: () => {
        stamps += 1
        return 1000 + stamps
      },
      // A second add would fail, as its folder is taken; the queued open
      // must never get that far.
      addOwnWorktree: (call) =>
        new Promise<void>((resolve, reject) => {
          setTimeout(() => {
            if (call === 1) {
              resolve()
            } else {
              reject(new Error('the worktree folder exists already'))
            }
          }, 30)
        }),
    })
    const [first, second] = await Promise.all([
      setup.checkout.open('56', OWN_REMOTES, 'origin'),
      setup.checkout.open('56', OWN_REMOTES, 'origin'),
    ])
    if (!first.ok) {
      throw new Error('first checkout failed')
    }
    // The queued open finds the finished checkout and offers it again.
    expect(second).toEqual({ ok: true, folder: first.folder, held: false, number: 56 })
    expect(setup.git.calls.addedOwn).toHaveLength(1)
    const record = await setup.records.recordFor(first.folder)
    expect(record?.isCheckoutPending).toBeUndefined()
  })

  it('refuses a second window’s open while the first checkout is pending', async () => {
    // Two service instances share one file store, as two windows do: the
    // second follows the pending record instead of racing it, and the
    // first still completes its checkout.
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'm123p-repo-'))
    const dataFolder = await mkdtemp(path.join(tmpdir(), 'm123p-data-'))
    const storageRoot = await mkdtemp(path.join(tmpdir(), 'm123p-vsc-'))
    const log = recordingLogger()
    const { deps } = fakeRuntimeGitDeps(repositoryRoot)
    const heldRoots = [
      heldWorktreesRoot(storageRoot, process.platform),
      heldWorktreesRoot(dataFolder, process.platform),
    ]
    const addedFolders: string[] = []
    const makeWindow = () => {
      const github = fakeGitHub()
      const recording = recordingGit(CAPTURED_PULL_OWN.head.sha, {}, (call) =>
        call === 1
          ? new Promise<void>((resolve) => {
              setTimeout(resolve, 50)
            })
          : Promise.reject(new Error('the worktree folder exists already')),
      )
      const checkout = new RuntimePullRequestCheckout({
        ...deps,
        repositoryRoot,
        dataFolder,
        tokenSources: signedIn(github),
        platform: process.platform,
        now: () => 2000,
        confirm: () => Promise.resolve(true),
        openFolder: () => Promise.resolve(),
        baseUrl: 'https://api.github.test',
        log,
        isTrusted: () => true,
        records: createFileWorktreeRecordStore(dataFolder, process.platform, log),
        heldRoots,
        git: {
          ...recording.git,
          addOwnWorktree: (cwd, folder, sha, gates, claim) => {
            addedFolders.push(folder)
            return recording.git.addOwnWorktree(cwd, folder, sha, gates, claim)
          },
        },
        pathExists: (fsPath) => existsSync(fsPath),
      } satisfies RuntimeCheckoutDeps)
      return checkout
    }
    const [first, second] = await Promise.all([
      makeWindow().open('56', OWN_REMOTES, 'origin'),
      makeWindow().open('56', OWN_REMOTES, 'origin'),
    ])
    const succeeded = [first, second].filter((result) => result.ok)
    const refused = [first, second].filter((result) => !result.ok)
    expect(succeeded).toHaveLength(1)
    expect(refused).toHaveLength(1)
    expect(refused[0]).toEqual({ ok: false, reason: UI_TEXT.gitOperationChanged })
    // `at` stays optional under every project config; the length
    // assert above guards the lookup.
    const winner = succeeded.at(0)
    if (winner === undefined) {
      throw new Error('one checkout should succeed')
    }
    // Exactly one git add ran, and the surviving record is finished —
    // never stranded pending by the loser's rollback.
    expect(addedFolders).toEqual([winner.folder])
    const fresh = createFileWorktreeRecordStore(dataFolder, process.platform, log)
    const surviving = await fresh.recordFor(winner.folder)
    expect(surviving?.isCheckoutPending).toBeUndefined()
  })

  it('releases only a finished checkout from the card', async () => {
    const setup = await checkoutSetup()
    const folder = path.join(setup.dataFolder, 'pr-worktrees', '51-abcdef12')
    await mkdir(folder, { recursive: true })
    const reserved = await setup.records.reserve({
      folder,
      repositoryRoot: setup.repositoryRoot,
      createdAt: 2000,
      checkoutId: 'pending-checkout',
      pullRequest: {
        repository: 'RandyNorthrup/muse-spark-code',
        number: 51,
        url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/51',
        title: 'A foreign pull request',
        author: 'Piangpi1997',
        headSha: CAPTURED_PULL_FORK.head.sha,
        isAuthoredByUser: false,
      },
      isHeld: true,
      isCheckoutPending: true,
    })
    if (!reserved.ok) {
      throw new Error('reserve refused')
    }
    // The card has nothing to show for a checkout still being written…
    expect(await setup.checkout.trustTicket(folder)).toBeUndefined()
    // …and a ticket forged for it releases nothing.
    const forged: TrustTicket = {
      folder,
      checkoutId: 'pending-checkout',
      revision: recordRevision(reserved.stored),
      fence: reserved.stored.fence,
      headSha: CAPTURED_PULL_FORK.head.sha,
      folderIdentity: 'any',
      pullRequest: reserved.stored.pullRequest ?? CAPTURED_ORIGIN,
    }
    expect(await setup.checkout.releaseHold(forged)).toEqual({
      ok: false,
      reason: UI_TEXT.gitOperationChanged,
    })
    const untouched = await setup.records.recordFor(folder)
    expect(untouched?.trustConfirmedAt).toBeUndefined()
  })

  it('refuses a remote named like an option', async () => {
    const { checkout, git } = await checkoutSetup()
    const result = await checkout.open(
      '56',
      [{ name: '--upload-pack=touch', repository: OWN }],
      undefined,
    )
    expect(result).toEqual({ ok: false, reason: UI_TEXT.gitPushUnsafeName })
    expect(git.calls.fetched).toHaveLength(0)
    expect(git.calls.addedOwn).toHaveLength(0)
  })

  it('offers a finished checkout again instead of taking it over', async () => {
    const setup = await checkoutSetup()
    const first = await setup.checkout.open('56', OWN_REMOTES, 'origin')
    if (!first.ok) {
      throw new Error('first checkout failed')
    }
    const second = await setup.checkout.open('56', OWN_REMOTES, 'origin')
    expect(second).toEqual({ ok: true, folder: first.folder, held: false, number: 56 })
    expect(setup.git.calls.addedOwn).toHaveLength(1)
    expect(setup.opened).toEqual([first.folder, first.folder])
  })

  it('never opens a folder it did not check out', async () => {
    const setup = await checkoutSetup()
    const folder = path.join(
      path.dirname(setup.repositoryRoot),
      `${path.basename(setup.repositoryRoot)}.worktrees`,
      'pr-56',
    )
    await mkdir(folder, { recursive: true })
    const result = await setup.checkout.open('56', OWN_REMOTES, 'origin')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain(UI_TEXT.worktreeFolderExists)
    }
    expect(setup.opened).toHaveLength(0)
    expect(setup.git.calls.addedOwn).toHaveLength(0)
  })

  it('holds the foreign worktree under either root until the card releases it', async () => {
    const setup = await checkoutSetup({ headSha: CAPTURED_PULL_FORK.head.sha })
    const result = await opened51(setup.checkout, 'checkout')
    const records = await setup.records.list()
    expect(holdForRoots([result.folder], setup.heldRoots, records, process.platform)?.folder).toBe(
      slashedPath(result.folder),
    )
    // Both roots are consulted: a worktree the other editor made holds too.
    const vscodeRoot = setup.heldRoots[0]
    if (vscodeRoot === undefined) {
      throw new Error('held roots missing')
    }
    const vscodeFolder = `${vscodeRoot}/51-abcdef12`
    const vscodeReserved = await setup.records.reserve({
      folder: vscodeFolder,
      repositoryRoot: setup.repositoryRoot,
      createdAt: 2000,
      checkoutId: 'vscode-checkout',
      pullRequest: {
        repository: 'RandyNorthrup/muse-spark-code',
        number: 51,
        url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/51',
        title: 'A foreign pull request',
        author: 'Piangpi1997',
        headSha: CAPTURED_PULL_FORK.head.sha,
        isAuthoredByUser: false,
      },
      isHeld: true,
      isCheckoutPending: true,
    })
    expect(vscodeReserved.ok).toBe(true)
    expect(
      holdForRoots([vscodeFolder], setup.heldRoots, await setup.records.list(), process.platform)
        ?.folder,
    ).toBe(slashedPath(vscodeFolder))
    const ticket = await ticketFor(setup.checkout, result.folder)
    expect(ticket.pullRequest.number).toBe(51)
    const released = await setup.checkout.releaseHold(ticket)
    expect(released).toEqual({ ok: true })
    expect(
      holdForRoots([result.folder], setup.heldRoots, await setup.records.list(), process.platform),
    ).toBeUndefined()
    expect(await setup.checkout.trustTicket(`${result.folder}-missing`)).toBeUndefined()
  })

  it.each(['trust revoked', 'window stopped'] as const)(
    'keeps the hold when, during the release’s folder read, %s (RVINTM123)',
    async (ending) => {
      // Armed for the release only: its first check passes, and then trust
      // ends or the window stops while the folder's identity is read.
      let releaseChecks: number | undefined
      const window = new AbortController()
      const setup = await checkoutSetup({
        headSha: CAPTURED_PULL_FORK.head.sha,
        signal: window.signal,
        isTrusted: () => {
          if (releaseChecks === undefined) return true
          releaseChecks += 1
          if (releaseChecks === 1) {
            if (ending === 'window stopped') {
              queueMicrotask(() => {
                window.abort()
              })
            }
            return true
          }
          return ending === 'window stopped'
        },
      })
      const result = await opened51(setup.checkout, 'checkout')
      const ticket = await ticketFor(setup.checkout, result.folder)
      releaseChecks = 0
      const released = await setup.checkout.releaseHold(ticket)
      await expectReleaseRefused(setup, result.folder, released, ending)
    },
  )

  it('refuses a release whose trust ends after its checks, before it lands (RVINTM123)', async () => {
    let isTrusted = true
    const setup = await checkoutSetup({
      headSha: CAPTURED_PULL_FORK.head.sha,
      isTrusted: () => isTrusted,
      records: () => {
        const store = createMemoryWorktreeRecordStore(process.platform)
        return {
          ...store,
          release: (ticket, now, isCurrent) => {
            // Trust ends once the release is under way in the store.
            isTrusted = false
            return store.release(ticket, now, isCurrent)
          },
        }
      },
    })
    const result = await opened51(setup.checkout, 'checkout')
    const ticket = await ticketFor(setup.checkout, result.folder)
    expect(await setup.checkout.releaseHold(ticket)).toEqual({
      ok: false,
      reason: UI_TEXT.gitRestricted,
    })
    expect(
      holdForRoots([result.folder], setup.heldRoots, await setup.records.list(), process.platform)
        ?.folder,
    ).toBe(slashedPath(result.folder))
  })

  it.each(['trust revoked', 'window stopped'] as const)(
    'refuses a release when, with its generation staged, %s (RVINTM123B)',
    async (ending) => {
      // Trust and the window hold through the release's entry check; only
      // the publication's last check, after the stage, can refuse it.
      let isTrusted = true
      const window = new AbortController()
      const files = stagedReleaseRecords()
      const setup = await checkoutSetup({
        headSha: CAPTURED_PULL_FORK.head.sha,
        signal: window.signal,
        isTrusted: () => isTrusted,
        records: files.records,
      })
      const result = await opened51(setup.checkout, 'checkout')
      const ticket = await ticketFor(setup.checkout, result.folder)
      files.control.isArmed = true
      const release = setup.checkout.releaseHold(ticket)
      await files.staged
      if (ending === 'trust revoked') {
        isTrusted = false
      } else {
        window.abort()
      }
      files.resume()
      const released = await release
      await expectReleaseRefused(setup, result.folder, released, ending)
    },
  )

  it('keeps a release that landed before trust ended (RVINTM123B)', async () => {
    let isTrusted = true
    const files = stagedReleaseRecords()
    const setup = await checkoutSetup({
      headSha: CAPTURED_PULL_FORK.head.sha,
      isTrusted: () => isTrusted,
      records: files.records,
    })
    const result = await opened51(setup.checkout, 'checkout')
    const ticket = await ticketFor(setup.checkout, result.folder)
    // Trust ends only once the release's generation is linked in place.
    files.control.afterLink = () => {
      isTrusted = false
    }
    expect(await setup.checkout.releaseHold(ticket)).toEqual({ ok: true })
    expect(isTrusted).toBe(false)
    expect(
      holdForRoots([result.folder], setup.heldRoots, await setup.records.list(), process.platform),
    ).toBeUndefined()
  })

  it('consumes a trust ticket once, for the very folder the checkout finished in', async () => {
    const setup = await checkoutSetup({ headSha: CAPTURED_PULL_FORK.head.sha })
    const result = await opened51(setup.checkout, 'checkout')
    const ticket = await ticketFor(setup.checkout, result.folder)
    // The folder made again at the same path is not the folder the user saw.
    await rm(result.folder, { recursive: true, force: true })
    await mkdir(result.folder)
    expect(await setup.checkout.releaseHold(ticket)).toEqual({
      ok: false,
      reason: UI_TEXT.gitOperationChanged,
    })
    expect(await setup.checkout.trustTicket(result.folder)).toBeUndefined()
    const held = await setup.records.recordFor(result.folder)
    expect(held?.trustConfirmedAt).toBeUndefined()
  })

  it('never lets a stale trust card release a replacement checkout', async () => {
    // RVM123P3 finding 3: the card shows checkout A; another window removes
    // A and finishes B at the same folder before A's confirmation arrives.
    let stamp = 1000
    const setup = await checkoutSetup({
      headSha: CAPTURED_PULL_FORK.head.sha,
      now: () => {
        stamp += 1000
        return stamp
      },
    })
    const first = await opened51(setup.checkout, 'first checkout')
    const cardForA = await ticketFor(setup.checkout, first.folder)
    await rm(first.folder, { recursive: true, force: true })
    const second = await setup.checkout.open('51', OWN_REMOTES, 'origin')
    expect(second.ok).toBe(true)
    const replacement = await setup.records.recordFor(first.folder)
    expect(replacement?.checkoutId).not.toBe(cardForA.checkoutId)
    expect(replacement?.isCheckoutPending).toBeUndefined()
    // A's confirmation, delivered late, releases nothing.
    expect(await setup.checkout.releaseHold(cardForA)).toEqual({
      ok: false,
      reason: UI_TEXT.gitOperationChanged,
    })
    const after = await setup.records.recordFor(first.folder)
    expect(after?.trustConfirmedAt).toBeUndefined()
    expect(
      holdForRoots([first.folder], setup.heldRoots, await setup.records.list(), process.platform)
        ?.folder,
    ).toBe(slashedPath(first.folder))
    // Its own card, used once, does; used again, nothing more happens.
    const cardForB = await ticketFor(setup.checkout, first.folder)
    expect(await setup.checkout.releaseHold(cardForB)).toEqual({ ok: true })
    const replayed = await setup.checkout.releaseHold(cardForB)
    expect(replayed.ok).toBe(false)
  })

  it('never restores the displaced trust when a replacement fails with files left', async () => {
    // RVM123P3 finding 2: a trusted checkout's folder is removed, the
    // updated pull request is checked out at the same folder, and that
    // checkout fails after a foreign file landed, which its cleanup could
    // not remove.
    const failures: Failures = {}
    const setup = await checkoutSetup({
      headSha: CAPTURED_PULL_FORK.head.sha,
      failures,
      checkOutHeld: async (folder, _gates, claim) => {
        const made = await claim()
        if (failures.cleanup !== true) {
          await added(made)
          return
        }
        await writeFile(path.join(folder, 'foreign.txt'), 'not yet trusted')
        throw new Error('cancelled after the first file')
      },
    })
    const first = await trustedThenRemoved(setup.checkout)
    failures.cleanup = true
    const replacement = await setup.checkout.open('51', OWN_REMOTES, 'origin')
    expect(replacement.ok).toBe(false)
    const record = await setup.records.recordFor(first.folder)
    // Still pending and unconfirmed: held, never offered, never trusted.
    expect(record?.isCheckoutPending).toBe(true)
    expect(record?.trustConfirmedAt).toBeUndefined()
    expect(
      holdForRoots([first.folder], setup.heldRoots, await setup.records.list(), process.platform)
        ?.folder,
    ).toBe(slashedPath(first.folder))
    expect(await setup.checkout.trustTicket(first.folder)).toBeUndefined()
    // The next open refuses the folder rather than offering it.
    const again = await setup.checkout.open('51', OWN_REMOTES, 'origin')
    expect(again.ok).toBe(false)
  })

  it('discards a failed replacement that made nothing, restoring nothing', async () => {
    let isFailing = false
    const setup = await checkoutSetup({
      headSha: CAPTURED_PULL_FORK.head.sha,
      checkOutHeld: async (_folder, _gates, claim) => {
        if (isFailing) {
          throw new Error('the tree could not be listed')
        }
        await added(await claim())
      },
    })
    const first = await trustedThenRemoved(setup.checkout)
    isFailing = true
    const replacement = await setup.checkout.open('51', OWN_REMOTES, 'origin')
    expect(replacement.ok).toBe(false)
    // No record at all: the hold by location applies, and no trust survives.
    expect(await setup.records.recordFor(first.folder)).toBeUndefined()
  })

  it('keeps a failed checkout pending until a writer still in flight has stopped', async () => {
    // RVM123P3 finding 4, at the service: the git port hands back the
    // cleanup that waits for the writer.
    const writerStopped = deferred()
    const cleanedUp = deferred()
    const cleanupAfterWriter = async (folder: string) => {
      await writerStopped.promise
      await rm(folder, { recursive: true, force: true })
      cleanedUp.resolve()
    }
    const setup = await checkoutSetup({
      headSha: CAPTURED_PULL_FORK.head.sha,
      checkOutHeld: async (folder, _gates, claim) => {
        await claim()
        throw new CleanupPendingError(
          new Error('the batch passed its deadline'),
          cleanupAfterWriter(folder),
        )
      },
    })
    const result = await setup.checkout.open('51', OWN_REMOTES, 'origin')
    expect(result.ok).toBe(false)
    const folder = setup.git.calls.checkedOutHeld[0]?.folder ?? ''
    const quarantined = await setup.records.recordFor(folder)
    expect(quarantined?.isCheckoutPending).toBe(true)
    writerStopped.resolve()
    await cleanedUp.promise
    let remaining: WorktreeRecord | undefined = quarantined
    for (let attempt = 1; remaining !== undefined && attempt <= 50; attempt += 1) {
      await delay(10)
      remaining = await setup.records.recordFor(folder)
    }
    expect(remaining).toBeUndefined()
  })

  it('takes over a pending checkout whose process is gone', async () => {
    const setup = await checkoutSetup({ headSha: CAPTURED_PULL_FORK.head.sha })
    const gonePid = await exitedProcessId()
    const folder = await reservedPending(setup, 'crashed-checkout', 1000, {
      host: hostnameOf(),
      pid: gonePid,
      processStart: 1,
    })
    const record = await reopenedRecord(setup, folder)
    expect(record?.checkoutId).not.toBe('crashed-checkout')
    expect(record?.isCheckoutPending).toBeUndefined()
  })

  it('never takes over a pending checkout whose process still runs', async () => {
    const setup = await checkoutSetup({ headSha: CAPTURED_PULL_FORK.head.sha })
    await reservedPending(setup, 'live-checkout', 1000, await currentProcessOwner())
    expect(await setup.checkout.open('51', OWN_REMOTES, 'origin')).toEqual({
      ok: false,
      reason: UI_TEXT.gitOperationChanged,
    })
    expect(setup.git.calls.checkedOutHeld).toHaveLength(0)
  })

  it('takes over a pending checkout whose process id now names another process', async () => {
    // RVM123P4 finding 4: the checkout crashed before its folder existed and
    // the system gave its id to a live, unrelated process.
    const setup = await checkoutSetup({ headSha: CAPTURED_PULL_FORK.head.sha })
    const folder = heldFolderOf(setup.dataFolder, 51)
    const live = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      windowsHide: true,
    })
    const exited = new Promise((resolve) => {
      live.once('exit', resolve)
    })
    try {
      // Born a minute before the id's live process, in this boot (Linux).
      await reservedPending(setup, 'crashed-checkout', 1000, {
        ...(await currentProcessOwner()),
        pid: live.pid ?? 0,
        processStart: 1,
      })
      const record = await reopenedRecord(setup, folder)
      expect(record?.checkoutId).not.toBe('crashed-checkout')
      expect(record?.isCheckoutPending).toBeUndefined()
    } finally {
      live.kill('SIGKILL')
      await exited
    }
  })

  it('recovers a pending checkout whose folder never appeared within the bound', async () => {
    // RVM123P4 finding 4's bound: however alive its process id looks, a
    // checkout pending this long without its folder crashed long ago.
    const setup = await checkoutSetup({ headSha: CAPTURED_PULL_FORK.head.sha })
    const folder = await reservedPending(
      setup,
      'stranded-checkout',
      2000 - PENDING_CHECKOUT_RECOVERY_MS - 1,
      await currentProcessOwner(),
    )
    const record = await reopenedRecord(setup, folder)
    expect(record?.checkoutId).not.toBe('stranded-checkout')
  })

  it('settles a stale-reservation takeover to one owner when the displaced checkout claims after it', async () => {
    // RVM123P5 finding 2: A reserved, then paused before claiming; a
    // forward clock step made B take A's reservation over; A resumes and
    // claims. A's claim is refused (the record's fence moved), so A makes
    // nothing; B claims and finishes: one record, one folder.
    const race = await twoWindowRace()
    const aGate = deferred()
    const aWaiting = deferred()
    const bGate = deferred()
    const bWaiting = deferred()
    const windowA = race.window(2000, claimingAfter(aWaiting.resolve, aGate.promise))
    const windowB = race.window(
      2000 + PENDING_CHECKOUT_RECOVERY_MS + 1,
      claimingAfter(bWaiting.resolve, bGate.promise),
    )
    const aOpen = windowA.open('51', OWN_REMOTES, 'origin')
    await aWaiting.promise
    const bOpen = windowB.open('51', OWN_REMOTES, 'origin')
    await bWaiting.promise
    aGate.resolve()
    const aResult = await aOpen
    expect(aResult).toEqual({ ok: false, reason: UI_TEXT.gitOperationChanged })
    // A made nothing: the folder is not there for B to meet.
    expect(existsSync(race.heldFolder)).toBe(false)
    bGate.resolve()
    const bResult = await bOpen
    await race.expectOneOwner([aResult, bResult])
  })

  it('settles an own-checkout takeover to one owner when the displaced one claims after it', async () => {
    // RVM123P5 finding 2 for the user's own pull request: the same claim
    // under the records' hold, beside the repository.
    const race = await twoWindowRace()
    const aGate = deferred()
    const aWaiting = deferred()
    const bGate = deferred()
    const bWaiting = deferred()
    const windowA = race.ownWindow(2000, ownAddAfter(aWaiting.resolve, aGate.promise))
    const windowB = race.ownWindow(
      2000 + PENDING_CHECKOUT_RECOVERY_MS + 1,
      ownAddAfter(bWaiting.resolve, bGate.promise),
    )
    const aOpen = windowA.open('56', OWN_REMOTES, 'origin')
    await aWaiting.promise
    const bOpen = windowB.open('56', OWN_REMOTES, 'origin')
    await bWaiting.promise
    aGate.resolve()
    const aResult = await aOpen
    bGate.resolve()
    const bResult = await bOpen
    await race.expectOneOwner([aResult, bResult])
  })

  it('supersedes nothing once a folder appeared under the takeover’s own hold', async () => {
    // The folder check that admits a takeover runs again under the hold
    // that publishes it: a folder that appeared after B judged A's
    // reservation stale stops B there, and B's record never replaces A's.
    const race = await twoWindowRace()
    const aGate = deferred()
    const aWaiting = deferred()
    const windowA = race.window(2000, claimingAfter(aWaiting.resolve, aGate.promise))
    const bStore: WorktreeRecordStore = {
      ...race.records,
      supersede: async (...args) => {
        // Another process's folder, made after B's own check.
        await mkdir(race.heldFolder, { recursive: true })
        await writeFile(path.join(race.heldFolder, 'foreign.txt'), FOREIGN_TEXT)
        return await race.records.supersede(...args)
      },
    }
    const windowB = race.window(
      2000 + PENDING_CHECKOUT_RECOVERY_MS + 1,
      claimingAfter(() => undefined, Promise.resolve(undefined)),
      bStore,
    )
    const aOpen = windowA.open('51', OWN_REMOTES, 'origin')
    await aWaiting.promise
    const bResult = await windowB.open('51', OWN_REMOTES, 'origin')
    expect(bResult).toEqual({ ok: false, reason: UI_TEXT.gitOperationChanged })
    const record = await race.records.recordFor(race.heldFolder)
    expect(record?.isCheckoutPending).toBe(true)
    aGate.resolve()
    // A meets the foreign folder at its claim: A makes nothing, drops its
    // reservation, and the foreign folder stays as it was.
    const aResult = await aOpen
    expect(aResult.ok).toBe(false)
    expect(readFileSync(path.join(race.heldFolder, 'foreign.txt'), 'utf8')).toBe(FOREIGN_TEXT)
    expect(await race.records.list()).toEqual([])
  })

  it('drops its reservation when the held folder was someone else’s all along', async () => {
    const setup = await checkoutSetup({
      headSha: CAPTURED_PULL_FORK.head.sha,
      checkOutHeld: async (folder, _gates, claim) => {
        await mkdir(folder, { recursive: true })
        await claim()
      },
    })
    const result = await setup.checkout.open('51', OWN_REMOTES, 'origin')
    expect(result.ok).toBe(false)
    const folder = setup.git.calls.checkedOutHeld[0]?.folder ?? ''
    // Nothing of this checkout's is there: no pending record strands it.
    expect(await setup.records.recordFor(folder)).toBeUndefined()
    expect(existsSync(folder)).toBe(true)
  })

  it('opens nothing, and keeps the finished record, when trust goes as it completes', async () => {
    let isTrusted = true
    const setup = await checkoutSetup({
      headSha: CAPTURED_PULL_FORK.head.sha,
      isTrusted: () => isTrusted,
      checkOutHeld: async (_folder, gates, claim) => {
        gates.run()
        const made = await claim()
        gates.run()
        await added(made)
        isTrusted = false
      },
    })
    const result = await setup.checkout.open('51', OWN_REMOTES, 'origin')
    expect(result).toEqual({ ok: false, reason: UI_TEXT.gitRestricted })
    expect(setup.opened).toEqual([])
    const [record] = await setup.records.list()
    expect(record?.isCheckoutPending).toBeUndefined()
  })

  it.each([
    { failing: [2], case: 'the sweep after the claim cannot list', locale: 'en' },
    { failing: [1, 2], case: 'whether the claim landed cannot be known', locale: 'en' },
    { failing: [1, 2], case: 'whether the claim landed cannot be known', locale: 'es' },
  ])(
    'leaves no pending record, and opens again at once, when $case ($locale)',
    async ({ failing, locale }) => {
      // RVM123P7 finding 1: the claim's generation lands, then a listing
      // fails (EACCES). A landed claim is never undone: the checkout goes
      // on with its new fence; or, not knowing, it drops whichever of its
      // reservations the record is. Either way nothing stays pending and an
      // immediate open succeeds.
      const listings = failingListingsAfterLink(failing)
      let hasArmed = false
      const setup = await checkoutSetup({
        headSha: CAPTURED_PULL_FORK.head.sha,
        records: (dataFolder) =>
          recordsAround(
            createFileWorktreeRecordStore(dataFolder, process.platform, recordingLogger(), {
              fs: listings.fs,
            }),
            async (name, call) => {
              if (name === 'claim' && !hasArmed) {
                hasArmed = true
                listings.arm()
              }
              return await call()
            },
          ),
      })
      const table = locale === 'es' ? ES : EN
      setUiText(
        {
          ...EN,
          worktreeAddFailed: table.worktreeAddFailed,
          worktreeRecordsWriteUnknown: table.worktreeRecordsWriteUnknown,
        },
        locale,
      )
      try {
        const result = await setup.checkout.open('51', OWN_REMOTES, 'origin')
        if (failing.length === 1) {
          expect(result.ok).toBe(true)
        } else {
          expect(result).toEqual({
            ok: false,
            reason: `${table.worktreeAddFailed}: ${table.worktreeRecordsWriteUnknown}`,
          })
        }
      } finally {
        setUiText(EN, 'en')
      }
      expect(listings.failed()).toBe(failing.length)
      const left = await setup.records.list()
      expect(left.filter((record) => record.isCheckoutPending === true)).toEqual([])
      const again = await setup.checkout.open('51', OWN_REMOTES, 'origin')
      expect(again.ok).toBe(true)
      const [record] = await setup.records.list()
      expect(record?.isCheckoutPending).toBeUndefined()
    },
  )

  it('keeps the bearer out of every result and log', async () => {
    const { checkout, log } = await checkoutSetup({ headSha: CAPTURED_PULL_FORK.head.sha })
    const own = await checkout.open('56', OWN_REMOTES, 'origin')
    const foreign = await checkout.open('51', OWN_REMOTES, 'origin')
    const refused = await checkout.open('nope', OWN_REMOTES, 'origin')
    for (const value of [own, foreign, refused, log.lines]) {
      expect(JSON.stringify(value)).not.toContain(CANARY)
    }
  })
})

describe('pull request git environments (M123 lane P)', () => {
  it('fetches with the user’s environment and runs everything else quiet', () => {
    const env = { PATH: '/usr/bin', GH_TOKEN: 'user-token', GITHUB_TOKEN: 'user-token' }
    const fetchEnv = pullRequestFetchEnvironment(env)
    expect(fetchEnv['GH_TOKEN']).toBe('user-token')
    expect(fetchEnv['GIT_TERMINAL_PROMPT']).toBe('0')
    const quietEnv = quietPullRequestEnvironment(env)
    expect(quietEnv['GH_TOKEN']).toBeUndefined()
    expect(quietEnv['GITHUB_TOKEN']).toBeUndefined()
    expect(quietEnv['GIT_TERMINAL_PROMPT']).toBe('0')
    expect(quietEnv['GIT_OPTIONAL_LOCKS']).toBe('0')
  })
})

describe('worktree record store (M123 lane P)', () => {
  const heldOrigin = {
    repository: 'RandyNorthrup/muse-spark-code',
    number: 51,
    url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/51',
    title: 'A foreign pull request',
    author: 'Piangpi1997',
    headSha: CAPTURED_PULL_FORK.head.sha,
    isAuthoredByUser: false,
  } as const

  /** A ticket as the card would hand it back for `record`. */
  function cardTicket(record: WorktreeRecord, folderIdentity = 'dev:1'): TrustTicket {
    return {
      folder: record.folder,
      checkoutId: record.checkoutId ?? '',
      revision: recordRevision(record),
      fence: record.fence,
      headSha: record.pullRequest?.headSha ?? '',
      folderIdentity,
      pullRequest: { ...heldOrigin },
    }
  }

  it('reserves, completes, discards and releases records', async () => {
    const store = createMemoryWorktreeRecordStore(process.platform)
    const record = {
      folder: '/data/pr-worktrees/51-abcdef12',
      repositoryRoot: '/repo',
      createdAt: 2000,
      checkoutId: 'checkout-a',
      pullRequest: { ...heldOrigin },
      isHeld: true,
      isCheckoutPending: true,
    } as const
    const reserved = await store.reserve({ ...record })
    if (!reserved.ok) {
      throw new Error('reserve refused')
    }
    expect(reserved.stored.revision).toBe(1)
    // A second reserve never replaces the first checkout's record.
    const rival = await store.reserve({ ...record, checkoutId: 'checkout-b' })
    expect(rival.ok ? undefined : rival.current?.checkoutId).toBe('checkout-a')
    // Only the reservation itself completes: its checkout and its fence.
    const reservation = reserved.reservation
    expect(await store.complete({ ...reservation, fence: reservation.fence + 9 }, 'd:1')).toBe(
      false,
    )
    expect(await store.complete({ ...reservation, checkoutId: 'checkout-b' }, 'd:1')).toBe(false)
    expect(await store.complete(reservation, 'dev:1')).toBe(true)
    const completed = await store.recordFor(record.folder)
    if (completed === undefined) {
      throw new Error('record missing')
    }
    expect(completed.isCheckoutPending).toBeUndefined()
    expect(completed.revision).toBe(2)
    expect(completed.folderIdentity).toBe('dev:1')
    // A stale completer: its reservation no longer matches.
    expect(await store.complete(reservation, 'dev:1')).toBe(false)
    // Only a pending checkout is ever discarded.
    expect(await store.discard(reservation)).toBe(false)
    // A ticket for another identity, head, revision or fence releases nothing.
    expect(await store.release(cardTicket(completed, 'dev:2'), 3000)).toBeUndefined()
    expect(
      await store.release({ ...cardTicket(completed), headSha: '0'.repeat(40) }, 3000),
    ).toBeUndefined()
    expect(await store.release({ ...cardTicket(completed), revision: 1 }, 3000)).toBeUndefined()
    expect(
      await store.release({ ...cardTicket(completed), fence: (completed.fence ?? 0) - 1 }, 3000),
    ).toBeUndefined()
    const released = await store.release(cardTicket(completed), 3000)
    expect(released?.isHeld).toBe(false)
    expect(released?.trustConfirmedAt).toBe(3000)
    // Single use.
    expect(await store.release(cardTicket(completed), 3001)).toBeUndefined()
    expect(
      await store.release({ ...cardTicket(completed), folder: `${record.folder}-missing` }, 3000),
    ).toBeUndefined()
  })

  it('refuses a release for a checkout still pending', async () => {
    const store = createMemoryWorktreeRecordStore(process.platform)
    const folder = '/data/pr-worktrees/51-abcdef12'
    const reserved = await store.reserve({
      folder,
      repositoryRoot: '/repo',
      createdAt: 2000,
      checkoutId: 'checkout-a',
      folderIdentity: 'dev:1',
      pullRequest: { ...heldOrigin },
      isHeld: true,
      isCheckoutPending: true,
    })
    if (!reserved.ok) {
      throw new Error('reserve refused')
    }
    // Trust always lands on the finished checkout the user saw, never on
    // one still being written.
    expect(await store.release(cardTicket(reserved.stored), 3000)).toBeUndefined()
    const untrusted = await store.recordFor(folder)
    expect(untrusted?.isCheckoutPending).toBe(true)
    expect(untrusted?.trustConfirmedAt).toBeUndefined()
  })

  it('supersedes only the exact version read, and never restores it', async () => {
    const store = createMemoryWorktreeRecordStore(process.platform)
    const folder = '/data/pr-worktrees/51-abcdef12'
    const ready = {
      folder,
      repositoryRoot: '/repo',
      createdAt: 1000,
      checkoutId: 'checkout-a',
      pullRequest: { ...heldOrigin },
      isHeld: true,
      isCheckoutPending: true,
    } as const
    const reserved = await store.reserve({ ...ready })
    if (!reserved.ok) {
      throw new Error('reserve refused')
    }
    expect(await store.complete(reserved.reservation, 'dev:1')).toBe(true)
    const completed = await store.recordFor(folder)
    if (completed === undefined) {
      throw new Error('record missing')
    }
    expect(await store.release(cardTicket(completed), 1500)).toBeDefined()
    const finished = await store.recordFor(folder)
    if (finished === undefined) {
      throw new Error('record missing')
    }
    // A stale version never takes over the finished checkout.
    const stale = await store.supersede(
      folder,
      versionOf(reserved.stored),
      { ...ready, checkoutId: 'checkout-b', createdAt: 2000 },
      isFolderGone,
    )
    expect(stale.ok).toBe(false)
    const kept = await store.recordFor(folder)
    expect(kept?.trustConfirmedAt).toBe(1500)
    // The version read does: pending, unconfirmed, a new checkout id, and
    // nothing of the old trust or folder identity carried over.
    const takeover = await store.supersede(
      folder,
      versionOf(finished),
      {
        ...ready,
        checkoutId: 'checkout-b',
        createdAt: 2000,
        trustConfirmedAt: 1500,
        folderIdentity: 'dev:1',
      },
      isFolderGone,
    )
    if (!takeover.ok) {
      throw new Error('supersede refused')
    }
    expect(takeover.stored.trustConfirmedAt).toBeUndefined()
    expect(takeover.stored.folderIdentity).toBeUndefined()
    expect(takeover.stored.isCheckoutPending).toBe(true)
    // Its checkout fails with nothing made: the record goes, and the
    // displaced trust is never restored.
    expect(await store.discard(takeover.reservation)).toBe(true)
    expect(await store.recordFor(folder)).toBeUndefined()
  })

  it('names one checkout through either separator and any case on Windows', async () => {
    const store = createMemoryWorktreeRecordStore('win32')
    const record = {
      folder: String.raw`C:\data\pr-worktrees\51-abcdef12`,
      repositoryRoot: String.raw`C:\repo`,
      createdAt: 1000,
      checkoutId: 'checkout-a',
      pullRequest: { ...heldOrigin },
      isHeld: true,
      isCheckoutPending: true,
    } as const
    const reservedWin = await store.reserve({ ...record })
    if (!reservedWin.ok) {
      throw new Error('reserve refused')
    }
    // The store keeps `/` separators; either spelling still finds it.
    expect(await store.recordFor('C:/data/pr-worktrees/51-abcdef12')).toEqual({
      ...record,
      folder: 'C:/data/pr-worktrees/51-abcdef12',
      revision: 1,
      fence: reservedWin.reservation.fence,
    })
    expect(await store.recordFor(String.raw`c:\DATA\PR-WORKTREES\51-ABCDEF12`)).toBeDefined()
    // A reservation named through the other spelling is the same one.
    expect(
      store.holdsSync({
        ...reservedWin.reservation,
        folder: String.raw`c:\DATA\PR-WORKTREES\51-ABCDEF12`,
      }),
    ).toBe(true)
  })

  it('never lets a stale window’s read restore trust or drop records', async () => {
    const dataFolder = await mkdtemp(path.join(tmpdir(), 'm123p-records-'))
    const log = recordingLogger()
    const heldRoot = path.join(dataFolder, 'pr-worktrees')
    const folder = path.join(heldRoot, '51-abcdef12')
    const origin = { ...heldOrigin }
    // Window A holds a trusted checkout of the worktree.
    // The store keeps folders with `/` separators, which git accepts on
    // Windows too, so the records compare on either platform.
    const key = folder.replaceAll('\\', '/')
    const windowA = createFileWorktreeRecordStore(dataFolder, process.platform, log)
    const trusted = await windowA.reserve({
      folder,
      repositoryRoot: '/repo',
      createdAt: 1000,
      checkoutId: 'checkout-a',
      pullRequest: { ...origin },
      isHeld: true,
      trustConfirmedAt: 1500,
    })
    expect(trusted.ok).toBe(true)
    // The worktree is removed; window B checks out the updated pull
    // request at the same folder. A blind second reserve cannot merge
    // over A's record — B takes over exactly the version it read.
    const windowB = createFileWorktreeRecordStore(dataFolder, process.platform, log)
    const held = {
      folder: key,
      repositoryRoot: '/repo',
      createdAt: 2000,
      checkoutId: 'checkout-b',
      pullRequest: { ...origin },
      isHeld: true,
      isCheckoutPending: true,
    } as const
    const refused = await windowB.reserve({ ...held })
    expect(refused.ok).toBe(false)
    if (refused.ok || refused.current === undefined) {
      throw new Error('second reserve should report the trusted record')
    }
    const takeover = await windowB.supersede(
      folder,
      versionOf(refused.current),
      { ...held },
      isFolderGone,
    )
    if (!takeover.ok) {
      throw new Error('supersede refused')
    }
    // Window B records an unrelated checkout too.
    const otherFolder = path.join(heldRoot, '56-fedcba98')
    const other = await windowB.reserve({
      folder: otherFolder,
      repositoryRoot: '/repo',
      createdAt: 2000,
      checkoutId: 'checkout-c',
      pullRequest: { ...origin, number: 56 },
      isHeld: true,
      isCheckoutPending: true,
    })
    expect(other.ok).toBe(true)
    // The stale window's old trust grant can never be written back: the
    // reserve for it refuses against the fresh state.
    const stale = await windowA.reserve({
      folder,
      repositoryRoot: '/repo',
      createdAt: 1000,
      checkoutId: 'checkout-a',
      pullRequest: { ...origin },
      isHeld: true,
      trustConfirmedAt: 1500,
    })
    expect(stale.ok).toBe(false)
    // A subsequent read in the stale window sees the new record, and —
    // reads never write — the file keeps B's unconfirmed pending
    // checkout and the unrelated record.
    const fresh = createFileWorktreeRecordStore(dataFolder, process.platform, log)
    const expected = { ...held, revision: 2, fence: takeover.reservation.fence }
    expect(await windowA.recordFor(folder)).toEqual(expected)
    expect(await fresh.recordFor(folder)).toEqual(expected)
    expect(await fresh.recordFor(otherFolder)).toBeDefined()
    expect(holdForRoots([folder], [heldRoot], await fresh.list(), process.platform)?.folder).toBe(
      key,
    )
  })

  it('merges concurrent file mutations instead of losing them', async () => {
    const dataFolder = await mkdtemp(path.join(tmpdir(), 'm123p-records-race-'))
    const log = recordingLogger()
    const heldRoot = path.join(dataFolder, 'pr-worktrees')
    const folder = path.join(heldRoot, '51-abcdef12')
    const windowA = createFileWorktreeRecordStore(dataFolder, process.platform, log)
    const windowB = createFileWorktreeRecordStore(dataFolder, process.platform, log)
    // Window A holds the old trusted record.
    const trusted = await windowA.reserve({
      folder,
      repositoryRoot: '/repo',
      createdAt: 1000,
      checkoutId: 'checkout-a',
      pullRequest: { ...heldOrigin },
      isHeld: true,
      trustConfirmedAt: 1500,
    })
    if (!trusted.ok) {
      throw new Error('reserve refused')
    }
    // Window B replaces it with a new pending checkout while window A
    // adds an unrelated record: the two mutations race the same file.
    const otherFolder = path.join(heldRoot, '56-fedcba98')
    const [replaced, added] = await Promise.all([
      windowB.supersede(
        folder,
        versionOf(trusted.stored),
        {
          folder,
          repositoryRoot: '/repo',
          createdAt: 2000,
          checkoutId: 'checkout-b',
          pullRequest: { ...heldOrigin },
          isHeld: true,
          isCheckoutPending: true,
        },
        isFolderGone,
      ),
      windowA.reserve({
        folder: otherFolder,
        repositoryRoot: '/repo',
        createdAt: 2000,
        checkoutId: 'checkout-c',
        pullRequest: { ...heldOrigin, number: 56 },
        isHeld: true,
        isCheckoutPending: true,
      }),
    ])
    expect(replaced.ok).toBe(true)
    expect(added.ok).toBe(true)
    // Whichever mutation won the file first, the final registry keeps
    // B's unconfirmed pending checkout and A's unrelated record — the
    // old trust grant is never restored, and no record is dropped.
    const fresh = createFileWorktreeRecordStore(dataFolder, process.platform, log)
    const current = await fresh.recordFor(folder)
    expect(current?.isCheckoutPending).toBe(true)
    expect(current?.trustConfirmedAt).toBeUndefined()
    expect(await fresh.recordFor(otherFolder)).toBeDefined()
  })
})

// A root that answers nothing, with a helper holding the root's stdout
// open past the root's death, as a git transport can.
const BATCH_ROOT_WITH_HELPER = [
  "const { spawn } = require('node:child_process');",
  "const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'inherit', 'ignore'] });",
  'helper.unref();',
  "require('node:fs').writeFileSync(process.env['M123P_HELPER_PID_FILE'], String(helper.pid));",
  'process.stdin.resume();',
  'setTimeout(() => {}, 60000);',
].join('\n')

function unreadableBatchAnswers(): BlobAnswers {
  return new BlobAnswers(
    [{ path: 'README.md', kind: 'file', oid: '0'.repeat(40), size: 1 }],
    () => Promise.resolve(),
    () => new Error('unreadable'),
  )
}

async function batchHelperPidOf(pidFile: string): Promise<number | undefined> {
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    try {
      const pid = Number(await readFile(pidFile, 'utf8'))
      if (Number.isSafeInteger(pid)) {
        return pid
      }
    } catch {
      // Not written yet.
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })
  }
  return undefined
}

function isBatchPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('pull request batch child (M123 lane P)', () => {
  it('ends the batch past its deadline and stops the helper tree', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'm123p-batch-'))
    const pidFile = path.join(dir, 'helper.pid')
    const child = spawn(process.execPath, ['-e', BATCH_ROOT_WITH_HELPER], {
      cwd: dir,
      env: { ...process.env, M123P_HELPER_PID_FILE: pidFile },
      windowsHide: true,
      detached: process.platform !== 'win32',
    })
    child.stderr.resume()
    const helperPid = await batchHelperPidOf(pidFile)
    expect(helperPid).toBeDefined()
    if (helperPid === undefined) {
      child.kill('SIGKILL')
      throw new Error('the helper never started')
    }
    expect(isBatchPidAlive(helperPid)).toBe(true)
    const started = Date.now()
    await expect(
      runBatchChild(child, unreadableBatchAnswers(), {
        deadlineMs: 300,
        killGraceMs: 1000,
        drainGraceMs: 1000,
        platform: process.platform,
        signal: new AbortController().signal,
        writers: new HeldWriters(),
      }),
    ).rejects.toThrow()
    // Settled by its own deadline, not by the pipes the helper held.
    expect(Date.now() - started).toBeLessThan(5000)
    try {
      if (process.platform !== 'win32') {
        for (let attempt = 1; isBatchPidAlive(helperPid) && attempt <= 40; attempt += 1) {
          await new Promise((resolve) => {
            setTimeout(resolve, 50)
          })
        }
        expect(isBatchPidAlive(helperPid)).toBe(false)
      }
    } finally {
      try {
        process.kill(helperPid, 'SIGKILL')
      } catch {
        // The deadline already stopped it.
      }
      child.kill('SIGKILL')
    }
  })

  it('settles a running batch on abort instead of hanging', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'm123p-batch-abort-'))
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      cwd: dir,
      windowsHide: true,
      detached: process.platform !== 'win32',
    })
    child.stderr.resume()
    const controller = new AbortController()
    const run = runBatchChild(child, unreadableBatchAnswers(), {
      deadlineMs: 60_000,
      killGraceMs: 1000,
      drainGraceMs: 1000,
      platform: process.platform,
      signal: controller.signal,
      writers: new HeldWriters(),
    })
    const started = Date.now()
    setTimeout(() => {
      controller.abort()
    }, 200)
    await expect(run).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(5000)
    child.kill('SIGKILL')
  })

  it('invalidates the writer in flight at the deadline and waits for it before failing', async () => {
    // RVM123P3 finding 4: the deadline must retire an in-flight writer
    // before cleanup, so it can never publish after the failure.
    const { child, blobs } = await oneAnswerBatch()
    const writers = new HeldWriters()
    const writerHeld = deferred()
    const events: string[] = []
    const published: string[] = []
    const answers = new BlobAnswers(
      blobs,
      (entry) =>
        writers.run(async () => {
          events.push('writer started')
          await writerHeld.promise
          // What every real publisher asks before each step on disk.
          writers.check()
          published.push(entry.path)
        }),
      () => new Error('unreadable'),
    )
    const running = runBatchChild(child, answers, {
      deadlineMs: 200,
      killGraceMs: 1000,
      drainGraceMs: 3000,
      platform: process.platform,
      signal: new AbortController().signal,
      writers,
    })
    const outcome = (async () => {
      const result = await settled(running)
      events.push('failed')
      return result
    })()
    try {
      await new Promise((resolve) => {
        setTimeout(resolve, 700)
      })
      // Past the deadline, the failure waits for the writer in flight.
      expect(events).toEqual(['writer started'])
      writerHeld.resolve()
      const error = await outcome
      expect(events).toEqual(['writer started', 'failed'])
      expect(error).toBeInstanceOf(Error)
      expect(error).not.toBeInstanceOf(CleanupPendingError)
      // Invalidated before it resumed: it published nothing.
      expect(published).toEqual([])
    } finally {
      writerHeld.resolve()
      child.kill('SIGKILL')
    }
  })

  it('hands the cleanup to a writer that outlives its grace', async () => {
    const { child, blobs } = await oneAnswerBatch()
    const writers = new HeldWriters()
    const writerHeld = deferred()
    const published: string[] = []
    const answers = new BlobAnswers(
      blobs,
      (entry) =>
        writers.run(async () => {
          await writerHeld.promise
          writers.check()
          published.push(entry.path)
        }),
      () => new Error('unreadable'),
    )
    try {
      const error = await settled(
        runBatchChild(child, answers, {
          deadlineMs: 200,
          killGraceMs: 1000,
          drainGraceMs: 100,
          platform: process.platform,
          signal: new AbortController().signal,
          writers,
        }),
      )
      if (!(error instanceof CleanupPendingError)) {
        throw new Error('expected the cleanup to wait for the writer')
      }
      let isSettled = false
      const watching = (async () => {
        await error.settled
        isSettled = true
      })()
      await new Promise((resolve) => {
        setTimeout(resolve, 50)
      })
      expect(isSettled).toBe(false)
      writerHeld.resolve()
      await watching
      expect(isSettled).toBe(true)
      expect(published).toEqual([])
    } finally {
      writerHeld.resolve()
      child.kill('SIGKILL')
    }
  })
})

/** What a git process was started for: its command, past the per-command options. */
function commandOf(args: readonly string[]): string {
  let index = 0
  while (index < args.length) {
    const arg = args[index]
    if (arg === '-c') {
      index += 2
    } else if (arg === '--no-replace-objects') {
      index += 1
    } else {
      break
    }
  }
  const command = args[index] ?? ''
  return command === 'worktree' ? `worktree ${args[index + 1] ?? ''}` : command
}

describe('the git dispatch gate (M123 lane P)', () => {
  it('starts git in exactly two places, each right after its gate', () => {
    // A new dispatch site cannot skip the gate: every process this module
    // starts goes through the one port call in `runGit` or `startGitBatch`,
    // and each runs its gate first, in the same synchronous turn.
    const source = readFileSync(
      fileURLToPath(new URL('../../src/runtime/panel/pullRequests/checkout.ts', import.meta.url)),
      'utf8',
    )
    const count = (pattern: RegExp) => source.match(pattern)?.length ?? 0
    const direct = readFileSync(
      fileURLToPath(
        new URL('../../src/runtime/panel/pullRequests/unconfiguredGit.ts', import.meta.url),
      ),
      'utf8',
    ).replaceAll(/\/\/[^\n]*/gu, '')
    expect(direct).toMatch(/beforeSpawn\(\)\s+execFile\(/u)
    expect(direct).toMatch(/beforeSpawn\(\)\s+return spawn\(/u)
    expect(count(/\bexecFile\(/gu)).toBe(0)
    expect(count(/\bspawn\(/gu)).toBe(0)
    expect(count(/\bexecResourceFile\(/gu)).toBe(2)
    expect(count(/\bspawnResourceProcess\(/gu)).toBe(2)
    expect(count(/\bprocesses\.run\(/gu)).toBe(1)
    expect(count(/\bprocesses\.start\(/gu)).toBe(1)
    // Two start functions pass the caller's final gate through the launcher's hook.
    expect(count(/beforeSpawn: gate/gu)).toBe(2)
    expect(source).toMatch(/execResourceFile\('probe', file, args, call\)/u)
    expect(source).toMatch(/spawnResourceProcess\('probe', file, args, call\)/u)
    expect(source).toMatch(/beforeSpawn: options\.beforeSpawn/u)
    // Each port call directly after its gate, nothing between.
    expect(source).toMatch(/ {2}gate\(\)\n {2}return git\.processes\.run\(/u)
    expect(source).toMatch(/ {2}gate\(\)\n {2}return git\.processes\.start\(/u)
    // Every call site names a gate.
    const calls = Array.from(
      source.matchAll(/\b(?:runGit|startGitBatch)\(\s*([\w.]+),\s*([\w.]+),/gu),
      (match) => ({ runner: match[1], gate: match[2] }),
    )
    expect(calls.length).toBeGreaterThan(8)
    for (const call of calls) {
      expect(call.runner).toBe('git')
      expect(call.gate).toMatch(/^(gate|gates\.run|gates\.cleanup)$/u)
    }
    expect(count(/\b(?:runGit|startGitBatch)\(/gu)).toBe(calls.length + 2)
  })
})

/** Recording-only port: used by the two launch-count cases below to observe
 * the synchronous caller gate. All other real-Git cases use the production port. */
const directGitProcesses: GitProcessPort = {
  run: (file, args, options) =>
    new Promise<string>((resolve, reject) => {
      options.beforeSpawn()
      execFile(file, [...args], { ...options, windowsHide: true }, (error, stdout) => {
        if (error === null) resolve(stdout)
        else reject(error instanceof Error ? error : new Error('Fixture Git failed'))
      })
    }),
  start: (file, args, options) => {
    options.beforeSpawn()
    return spawn(file, [...args], { ...options, windowsHide: true })
  },
}

afterEach(() => vi.restoreAllMocks())

describe('runtime pull request checkout on the fixture repositories (M123 lane P)', () => {
  let fixtures: FixtureRepositories
  let gitPath: string
  let disposeAdmission: (() => Promise<void>) | undefined

  beforeAll(async () => {
    if (process.platform === 'win32') disposeAdmission = await fixtureRuntimeAdmission()
    fixtures = createFixtureRepositories(await mkdtemp(path.join(tmpdir(), 'm123p-fixtures-')))
    const resolved = resolveExecutable('git', {
      platform: process.platform,
      pathVariable: process.env['PATH'],
      fileExists: existsSync,
    })
    if (resolved === undefined) {
      throw new Error('git is not on PATH')
    }
    gitPath = resolved
  })

  afterAll(async () => {
    await disposeAdmission?.()
  })

  beforeEach(() => {
    // Fake only machine pressure, never the production launcher, collector or
    // streams. Every POSIX lease stops the real owned group on Cancel/exit.
    vi.mocked(admission.admitResource).mockImplementation(() => {
      const lease = fakeResourceLease()
      let pid: number | undefined
      const register = vi.fn((launch: ResourceProcessLaunch) => {
        pid = launch.pid
      })
      lease.kill.mockImplementation(() => {
        if (pid !== undefined && process.platform !== 'win32') {
          try {
            process.kill(-pid, 'SIGKILL')
          } catch (error: unknown) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
          }
        }
        return Promise.resolve(true)
      })
      return Promise.resolve({ ...lease, register })
    })
  })

  it.each(['remote', 'taken worktree', 'missing ref'] as const)(
    'preserves execFile diagnostics for a real git failure: %s',
    async (failure) => {
      const taken = await mkdtemp(path.join(tmpdir(), 'm123p-taken-'))
      writeFileSync(path.join(taken, 'kept'), FOREIGN_TEXT)
      const args = {
        remote: ['fetch', 'no-such-remote', 'refs/pull/51/head'],
        'taken worktree': ['worktree', 'add', '--detach', taken, 'HEAD'],
        'missing ref': ['rev-parse', '--verify', 'no-such-ref^{commit}'],
      }[failure]
      const options = {
        cwd: fixtures.fork,
        env: quietPullRequestEnvironment(fixtures.environment),
        signal: new AbortController().signal,
        timeout: 1000,
        maxBuffer: 10_000,
        beforeSpawn: () => undefined,
      }
      const baseline = await new Promise<Error>((resolve, reject) => {
        execFile(gitPath, args, { ...options, encoding: 'utf8' }, (error) => {
          if (error instanceof Error) resolve(error)
          else reject(new Error('The baseline failure unexpectedly succeeded'))
        })
      })
      const result = await settled(nodeGitProcesses.run(gitPath, args, options))
      expect(result).toBeInstanceOf(Error)
      if (!(result instanceof Error)) throw new Error('Expected governed Git failure')
      expect(result.message).toBe(redactSecrets(baseline.message).slice(0, GIT_STDERR_MAX_CHARS))
    },
  )

  it('runs real fixture git through production launch, output and batch streams by default', async () => {
    const commands = vi.spyOn(launcher, 'execResourceFile')
    const batches = vi.spyOn(launcher, 'spawnResourceProcess')
    const setup = await fixtureSetup('held')
    await heldOpen(setup.checkout, FORK_REMOTES, setup.dataFolder)
    expect(commands).toHaveBeenCalledWith(
      'contained',
      gitPath,
      expect.arrayContaining(['fetch']),
      expect.any(Object),
    )
    expect(commands).toHaveBeenCalledWith(
      'probe',
      gitPath,
      expect.arrayContaining(['ls-tree']),
      expect.any(Object),
    )
    expect(batches).toHaveBeenCalledWith(
      'probe',
      gitPath,
      expect.arrayContaining(['cat-file', '--batch']),
      expect.any(Object),
    )
  })

  function git(cwd: string, ...args: string[]): string {
    return execFileSync(gitPath, args, { cwd, env: fixtures.environment, encoding: 'utf8' }).trim()
  }

  interface FixtureOptions {
    readonly signal?: AbortSignal
    readonly batchDeadlineMs?: number
    readonly createFile?: typeof createFileExclusively
    readonly processes?: GitProcessPort
    readonly isTrusted?: () => boolean
    /** Another window over the same data folder. */
    readonly dataFolder?: string
    /** The same repository under another spelling (an 8.3 short name, say). */
    readonly repositoryRoot?: string
    readonly records?: WorktreeRecordStore
    readonly now?: number
    /** Added to every quiet git's environment (a trace file, say). */
    readonly quietEnv?: NodeJS.ProcessEnv
  }

  async function fixtureSetup(
    kind: 'own' | 'held',
    options: FixtureOptions = {},
  ): Promise<{
    checkout: RuntimePullRequestCheckout
    opened: string[]
    dataFolder: string
    sha: string
    records: WorktreeRecordStore
    heldRoots: readonly string[]
  }> {
    const repositoryRoot = options.repositoryRoot ?? (kind === 'own' ? fixtures.own : fixtures.fork)
    if (kind === 'own') {
      // The pull ref serves the branch tip, so the branch goes up first.
      git(repositoryRoot, 'push', '-q', 'origin', 'feature')
    }
    const sha = git(repositoryRoot, 'rev-parse', kind === 'own' ? 'feature' : 'HEAD')
    // The pull refs GitHub would serve, pointed at the fixture's own commits.
    git(fixtures.parentBare, 'update-ref', `refs/pull/${kind === 'own' ? '56' : '51'}/head`, sha)
    const github = fakeGitHub()
    const route = kind === 'own' ? OWN_PULLS : FORK_PULLS
    const captured = kind === 'own' ? CAPTURED_PULL_OWN : CAPTURED_PULL_FORK
    github.answer('GET', route, {
      status: 200,
      body: { ...captured, head: { ...captured.head, sha } },
    })
    const { deps } = fakeRuntimeGitDeps(repositoryRoot)
    const log = recordingLogger()
    const opened: string[] = []
    const dataFolder = options.dataFolder ?? (await mkdtemp(path.join(tmpdir(), 'm123p-held-')))
    const storageRoot = await mkdtemp(path.join(tmpdir(), 'm123p-vsc-'))
    const records = options.records ?? createMemoryWorktreeRecordStore(process.platform)
    const heldRoots = [
      heldWorktreesRoot(storageRoot, process.platform),
      heldWorktreesRoot(dataFolder, process.platform),
    ]
    const signal = options.signal ?? deps.signal
    const checkout = new RuntimePullRequestCheckout({
      ...deps,
      repositoryRoot,
      dataFolder,
      tokenSources: signedIn(github),
      platform: process.platform,
      now: () => options.now ?? 2000,
      confirm: () => Promise.resolve(true),
      openFolder: (folder) => {
        opened.push(folder)
        return Promise.resolve()
      },
      baseUrl: 'https://api.github.test',
      log,
      signal,
      ...(options.isTrusted !== undefined && { isTrusted: options.isTrusted }),
      records,
      heldRoots,
      git: createNodePullRequestCheckoutGit({
        gitPath,
        userEnv: pullRequestFetchEnvironment({ ...fixtures.environment }),
        quietEnv: quietPullRequestEnvironment({ ...fixtures.environment, ...options.quietEnv }),
        platform: process.platform,
        signal,
        log,
        ...(options.batchDeadlineMs !== undefined && { batchDeadlineMs: options.batchDeadlineMs }),
        ...(options.createFile !== undefined && { createFile: options.createFile }),
        ...(options.processes !== undefined && { processes: options.processes }),
      }),
      pathExists: (fsPath) => existsSync(fsPath),
    } satisfies RuntimeCheckoutDeps)
    return { checkout, opened, dataFolder, sha, records, heldRoots }
  }

  const FORK_REMOTES = [
    { name: 'origin', repository: { owner: 'Piangpi1997', name: 'muse-spark-code' } },
    { name: 'upstream', repository: OWN },
  ]

  it('removes a held checkout cancelled after its first file and restores no trust', async () => {
    // RVM123P3 finding 2 on the real runner: a trusted checkout's folder
    // is gone, the pull request is checked out again at the same folder,
    // and Cancel lands right after the first foreign file is published.
    const controller = new AbortController()
    let isCancelling = false
    const setup = await fixtureSetup('held', {
      signal: controller.signal,
      createFile: async (target, content, fileOptions) => {
        await createFileExclusively(target, content, fileOptions)
        if (isCancelling) {
          controller.abort()
        }
      },
    })
    const first = await setup.checkout.open('51', FORK_REMOTES, 'origin')
    if (!first.ok) {
      throw new Error('first checkout failed')
    }
    expect(await isTrustedInCard(setup.checkout, first.folder)).toBe(true)
    git(fixtures.fork, 'worktree', 'remove', '--force', first.folder)
    isCancelling = true
    const replacement = await setup.checkout.open('51', FORK_REMOTES, 'origin')
    expect(replacement.ok).toBe(false)
    // Cleaned up despite Cancel, and nothing restored the old trust.
    expect(existsSync(first.folder)).toBe(false)
    expect(await setup.records.recordFor(first.folder)).toBeUndefined()
    expect(
      holdForRoots([first.folder], setup.heldRoots, await setup.records.list(), process.platform),
    ).toBeDefined()
  })

  it('waits for a file writer in flight past the batch deadline, then cleans up', async () => {
    // RVM123P3 finding 4 on the real runner: the first file's writer is
    // held on a slow disk while the batch's deadline passes.
    const writerHeld = deferred()
    const writerReached = deferred()
    const setup = await fixtureSetup('held', {
      batchDeadlineMs: 300,
      createFile: async (target, content, fileOptions) => {
        writerReached.resolve()
        await writerHeld.promise
        await createFileExclusively(target, content, fileOptions)
      },
    })
    const opening = setup.checkout.open('51', FORK_REMOTES, 'origin')
    try {
      await writerReached.promise
      await delay(700)
      // Past the deadline: the record stays pending (held) while the
      // writer is in flight, and nothing has been cleaned up under it.
      const [pending] = await setup.records.list()
      expect(pending?.isCheckoutPending).toBe(true)
      writerHeld.resolve()
      const result = await opening
      expect(result.ok).toBe(false)
      // Drained, then cleaned up: no foreign file, no folder, no record.
      expect(existsSync(pending?.folder ?? '')).toBe(false)
      let left = await setup.records.list()
      for (let attempt = 1; attempt <= 50 && left.length > 0; attempt += 1) {
        await delay(10)
        left = await setup.records.list()
      }
      expect(left).toEqual([])
    } finally {
      writerHeld.resolve()
      await opening
    }
  })

  it('checks out the user’s own pull request beside the fixture repository', async () => {
    const { checkout, opened, sha } = await fixtureSetup('own')
    const result = await checkout.open('56', OWN_REMOTES, 'origin')
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.held).toBe(false)
    expect(existsSync(result.folder)).toBe(true)
    expect(git(result.folder, 'rev-parse', 'HEAD')).toBe(sha)
    expect(opened).toEqual([result.folder])
  })

  /**
   * Whether git lists `folder` among the fork's worktrees, compared the
   * platform's way (Windows: any case, either separator; git prints the
   * real spelling, the temp folder may be spelled otherwise).
   */
  function isListedWorktree(folder: string, repository = fixtures.fork): boolean {
    return git(repository, 'worktree', 'list', '--porcelain')
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .some((line) =>
        isSamePath(
          resolvedPath(line.slice('worktree '.length)),
          resolvedPath(folder),
          process.platform,
        ),
      )
  }

  function heldRunner(processes?: GitProcessPort): PullRequestCheckoutGit {
    return createNodePullRequestCheckoutGit({
      gitPath,
      userEnv: pullRequestFetchEnvironment({ ...fixtures.environment }),
      quietEnv: quietPullRequestEnvironment({ ...fixtures.environment }),
      platform: process.platform,
      signal: new AbortController().signal,
      log: recordingLogger(),
      ...(processes !== undefined && { processes }),
    })
  }

  it('leaves a folder another process put at the destination before the claim', async () => {
    // RVM123P4 finding 1: the destination is free when the checkout looks,
    // then another process puts a populated folder there. The claim fails
    // on it; nothing is added, and nothing of it is removed.
    const { folder, foreign } = await raceFolder()
    const sha = git(fixtures.fork, 'rev-parse', 'HEAD')
    const runner = heldRunner()
    const claim = async () => {
      mkdirSync(folder, { recursive: true })
      writeFileSync(foreign, FOREIGN_TEXT)
      return await runner.claimFolder(folder)
    }
    await expect(
      runner.checkOutHeld(folder, sha, fixtures.fork, runnerGates(), claim),
    ).rejects.toBeInstanceOf(HeldFolderTakenError)
    expect(readFileSync(foreign, 'utf8')).toBe(FOREIGN_TEXT)
    expect(isListedWorktree(folder)).toBe(false)
  })

  it('never deletes a folder put in place of the worktree while the checkout ran', async () => {
    // RVM123P4 finding 1, the replacement case: the worktree is moved away
    // and another folder put at its name before the checkout fails.
    const { folder, foreign } = await raceFolder()
    const sha = git(fixtures.fork, 'rev-parse', 'HEAD')
    const runner = heldRunner()
    let isSwapped = false
    const check = () => {
      if (isSwapped || !existsSync(path.join(folder, '.git'))) {
        return
      }
      isSwapped = true
      renameSync(folder, `${folder}-moved`)
      mkdirSync(folder)
      writeFileSync(foreign, FOREIGN_TEXT)
      throw new Error('cancelled while the folder was replaced')
    }
    await expect(
      runner.checkOutHeld(folder, sha, fixtures.fork, runnerGates(check), claimOf(runner, folder)),
    ).rejects.toThrow(/cancelled/u)
    expect(readFileSync(foreign, 'utf8')).toBe(FOREIGN_TEXT)
  })

  it('never deletes what another process drops into the claimed folder before git adds it', async () => {
    // RVM123P4 finding 1, inside the claim: the folder is this checkout's,
    // but git refuses it once another process wrote into it. Only an empty
    // folder of this checkout's own is ever removed when git added nothing.
    // The foreign file lands at the first check after the claim, by name:
    // WINSPAWN showed a gate count injects before any folder exists.
    const { folder, foreign } = await raceFolder()
    const sha = git(fixtures.fork, 'rev-parse', 'HEAD')
    const runner = heldRunner()
    const afterClaim = claimThen(runner, folder, () => {
      writeFileSync(foreign, FOREIGN_TEXT)
    })
    await expect(
      runner.checkOutHeld(
        folder,
        sha,
        fixtures.fork,
        runnerGates(afterClaim.check),
        afterClaim.claim,
      ),
      // Git's own refusal for a non-empty destination, not an earlier error:
      // a broad matcher would accept the injection landing too early.
    ).rejects.toThrow(/already exists/u)
    expect(afterClaim.didRun()).toBe(true)
    expect(readFileSync(foreign, 'utf8')).toBe(FOREIGN_TEXT)
    expect(isListedWorktree(folder)).toBe(false)
  })

  it('removes a claimed folder git never used when the checkout is refused at the add', async () => {
    // Refused at the first check after the claim, by name: the folder is
    // this checkout's and empty, so the cleanup removes it whole.
    const { folder } = await raceFolder()
    const sha = git(fixtures.fork, 'rev-parse', 'HEAD')
    const runner = heldRunner()
    const afterClaim = claimThen(runner, folder, () => {
      throw new ReservationLostError(folder)
    })
    await expect(
      runner.checkOutHeld(
        folder,
        sha,
        fixtures.fork,
        runnerGates(afterClaim.check),
        afterClaim.claim,
      ),
    ).rejects.toBeInstanceOf(ReservationLostError)
    expect(afterClaim.didRun()).toBe(true)
    expect(existsSync(folder)).toBe(false)
    expect(readdirSync(path.dirname(folder))).toEqual([])
    expect(isListedWorktree(folder)).toBe(false)
  })

  it('makes nothing when its claim is refused', async () => {
    // RVM123P5 finding 2 on the real runner: the records refused the claim
    // (another checkout took the reservation over); the tree was listed,
    // nothing was made. The claim itself is the named checkpoint: it runs
    // exactly once, after the route's read checks and before any write.
    const { folder } = await raceFolder()
    const sha = git(fixtures.fork, 'rev-parse', 'HEAD')
    let claims = 0
    let runs = 0
    let writes = 0
    await expect(
      heldRunner().checkOutHeld(
        folder,
        sha,
        fixtures.fork,
        {
          run: () => {
            runs += 1
          },
          write: () => {
            writes += 1
          },
          cleanup: () => undefined,
        },
        () => {
          claims += 1
          return Promise.reject(new ReservationLostError(folder))
        },
      ),
    ).rejects.toBeInstanceOf(ReservationLostError)
    expect(claims).toBe(1)
    expect(runs).toBeGreaterThan(0)
    expect(writes).toBe(0)
    // Not even the held root: the claim never made anything.
    expect(existsSync(path.dirname(folder))).toBe(false)
  })

  it.runIf(process.platform === 'win32')(
    'checks out a held pull request when the repository and data folder use 8.3 short names',
    async (ctx) => {
      // 8.3 short names exist only on Windows volumes with short names
      // enabled (tonight's hosted runner temp folder is C:\Users\RUNNER~1):
      // a long-named folder's short spelling carries the whole checkout —
      // the record keys, the claim, and git's long-spelled listing.
      const longData = path.join(
        await mkdtemp(path.join(tmpdir(), 'm123p-short-')),
        'very-long-data-directory-name-for-the-short-name-checkout',
      )
      await mkdir(longData)
      const shortRepo = shortPathOf(fixtures.fork)
      const shortData = shortPathOf(longData)
      const hasShortNames =
        shortRepo !== undefined &&
        shortData !== undefined &&
        shortRepo.toLowerCase() !== fixtures.fork.toLowerCase() &&
        shortData.toLowerCase() !== longData.toLowerCase()
      if (!hasShortNames) {
        ctx.skip('this volume provides no 8.3 short names')
        return
      }
      const setup = await fixtureSetup('held', {
        repositoryRoot: shortRepo,
        dataFolder: shortData,
      })
      const result = await heldOpen(setup.checkout, FORK_REMOTES, setup.dataFolder)
      try {
        expect(existsSync(result.folder)).toBe(true)
        // Git prints the long spelling while the folder is the short one:
        // only the native resolver compares them the same.
        expect(isListedWorktree(result.folder)).toBe(true)
        const [record] = await setup.records.list()
        expect(record?.folderIdentity).toBeDefined()
      } finally {
        try {
          git(shortRepo, 'worktree', 'remove', '--force', result.folder)
        } catch {
          await rm(result.folder, { recursive: true, force: true })
        }
      }
      expect(existsSync(result.folder)).toBe(false)
      expect(isListedWorktree(result.folder)).toBe(false)
    },
  )

  it('leaves a folder already at the destination alone', async () => {
    const { folder, foreign } = await raceFolder()
    mkdirSync(folder, { recursive: true })
    writeFileSync(foreign, FOREIGN_TEXT)
    const sha = git(fixtures.fork, 'rev-parse', 'HEAD')
    const runner = heldRunner()
    await expect(
      runner.checkOutHeld(folder, sha, fixtures.fork, runnerGates(), claimOf(runner, folder)),
    ).rejects.toBeInstanceOf(HeldFolderTakenError)
    expect(readFileSync(foreign, 'utf8')).toBe(FOREIGN_TEXT)
    expect(isListedWorktree(folder)).toBe(false)
  })

  it('removes its own failed held checkout whole, and nothing beside it', async () => {
    const { folder } = await raceFolder()
    const sibling = path.join(path.dirname(folder), '52-sibling')
    mkdirSync(sibling, { recursive: true })
    writeFileSync(path.join(sibling, 'kept.txt'), FOREIGN_TEXT)
    const sha = git(fixtures.fork, 'rev-parse', 'HEAD')
    const runner = heldRunner()
    const check = () => {
      if (!existsSync(path.join(folder, '.git'))) {
        return
      }
      throw new Error('cancelled after the worktree was added')
    }
    await expect(
      runner.checkOutHeld(folder, sha, fixtures.fork, runnerGates(check), claimOf(runner, folder)),
    ).rejects.toThrow(/cancelled/u)
    expect(existsSync(folder)).toBe(false)
    expect(isListedWorktree(folder)).toBe(false)
    expect(readdirSync(path.dirname(folder))).toEqual(['52-sibling'])
    expect(readFileSync(path.join(sibling, 'kept.txt'), 'utf8')).toBe(FOREIGN_TEXT)
  })

  it('stops the fetch and the held batch on cancel instead of hanging', async () => {
    const log = recordingLogger()
    const runner = createNodePullRequestCheckoutGit({
      gitPath,
      userEnv: pullRequestFetchEnvironment({ ...fixtures.environment }),
      quietEnv: quietPullRequestEnvironment({ ...fixtures.environment }),
      platform: process.platform,
      signal: AbortSignal.abort(),
      log,
    })
    // A fetch that would succeed against the fixture's origin is refused
    // before git starts, and the held batch never spawns its child.
    await expect(runner.fetch(fixtures.own, 'origin', 'feature', () => undefined)).rejects.toThrow(
      /abort/iu,
    )
    const sha = git(fixtures.own, 'rev-parse', 'HEAD')
    const folder = path.join(await mkdtemp(path.join(tmpdir(), 'm123p-cancelled-')), 'pr')
    await expect(
      runner.checkOutHeld(folder, sha, fixtures.own, runnerGates(), claimOf(runner, folder)),
    ).rejects.toThrow()
  })

  it('checks out someone else’s pull request held, byte for byte', async () => {
    const { checkout, opened, dataFolder, sha } = await fixtureSetup('held')
    const result = await heldOpen(checkout, FORK_REMOTES, dataFolder)
    expect(git(result.folder, 'rev-parse', 'HEAD')).toBe(sha)
    expect(isListedWorktree(result.folder)).toBe(true)
    const expected = await readFile(path.join(fixtures.fork, 'README.md'), 'utf8')
    expect(await readFile(path.join(result.folder, 'README.md'), 'utf8')).toBe(expected)
    expect(opened).toEqual([result.folder])
  })

  it('starts every git of a checkout right after its gate, trust and reservation included', async () => {
    // The dispatch gate at run time: every process the checkout starts,
    // own or held, starts in the very turn its gate ran (trust, Cancel)
    // and, once reserved, read the reservation. A process started after an
    // await would find the marks cleared.
    for (const kind of ['own', 'held'] as const) {
      const marks = { trust: false, reservation: false }
      const mark = (key: keyof typeof marks) => {
        marks[key] = true
        queueMicrotask(() => {
          marks[key] = false
        })
      }
      const started: {
        readonly command: string
        readonly trust: boolean
        readonly reservation: boolean
      }[] = []
      const recording: GitProcessPort = {
        run: (file, args, options) => {
          started.push({ command: commandOf(args), ...marks })
          return directGitProcesses.run(file, args, options)
        },
        start: (file, args, options) => {
          started.push({ command: commandOf(args), ...marks })
          return directGitProcesses.start(file, args, options)
        },
      }
      if (kind === 'own') {
        // An earlier test's own checkout of the same pull request goes first.
        const earlier = path.join(
          path.dirname(fixtures.own),
          `${path.basename(fixtures.own)}.worktrees`,
          'pr-56',
        )
        if (existsSync(earlier)) {
          git(fixtures.own, 'worktree', 'remove', '--force', earlier)
        }
      }
      const store = createMemoryWorktreeRecordStore(process.platform)
      const setup = await fixtureSetup(kind, {
        processes: recording,
        isTrusted: () => {
          mark('trust')
          return true
        },
        records: {
          ...store,
          holdsSync: (reservation) => {
            mark('reservation')
            return store.holdsSync(reservation)
          },
        },
      })
      const result = await setup.checkout.open(
        kind === 'own' ? '56' : '51',
        kind === 'own' ? OWN_REMOTES : FORK_REMOTES,
        'origin',
      )
      expect(result).toMatchObject({ ok: true })
      const expected =
        kind === 'own'
          ? ['fetch', 'rev-parse', 'worktree add']
          : [
              'fetch',
              'rev-parse',
              '--version',
              'config',
              'ls-tree',
              'config',
              'worktree add',
              'config',
              'read-tree',
              'cat-file',
            ]
      expect(started.map((entry) => entry.command)).toEqual(expected)
      // Fetched before any reservation; every later git also read it.
      for (const [index, entry] of started.entries()) {
        expect(entry.trust).toBe(true)
        expect(entry.reservation).toBe(index >= 2)
      }
    }
  })

  it('starts no git after its gate refuses, wherever that is', async () => {
    const sha = git(fixtures.fork, 'rev-parse', 'HEAD')
    // The route's own boundary, learned from a dry run: how many gates it
    // performs through the worktree add's start. No literal fits every
    // platform (POSIX and Windows GO recheck a different number of times),
    // so the refusals below walk the dry run's count.
    let gatesThroughAdd = 0
    {
      const { folder: dry } = await raceFolder()
      let gates = 0
      const spotAdd: GitProcessPort = {
        run: (file, args, options) => {
          if (gatesThroughAdd === 0 && args.includes('worktree') && args.includes('add')) {
            gatesThroughAdd = gates
          }
          return directGitProcesses.run(file, args, options)
        },
        start: (file, args, options) => directGitProcesses.start(file, args, options),
      }
      const dryRunner = heldRunner(spotAdd)
      await dryRunner.checkOutHeld(
        dry,
        sha,
        fixtures.fork,
        runnerGates(() => {
          gates += 1
        }),
        claimOf(dryRunner, dry),
      )
      git(fixtures.fork, 'worktree', 'remove', '--force', dry)
    }
    expect(gatesThroughAdd).toBeGreaterThan(0)
    for (let refusing = 1; refusing <= gatesThroughAdd; refusing += 1) {
      const { folder } = await raceFolder()
      let gates = 0
      let startedAfter = 0
      let isRefused = false
      const recording: GitProcessPort = {
        run: (file, args, options) => {
          startedAfter += isRefused ? 1 : 0
          return directGitProcesses.run(file, args, options)
        },
        start: (file, args, options) => {
          startedAfter += isRefused ? 1 : 0
          return directGitProcesses.start(file, args, options)
        },
      }
      const runner = heldRunner(recording)
      const check = () => {
        gates += 1
        if (gates < refusing) {
          return
        }
        isRefused = true
        throw new ReservationLostError(folder)
      }
      // Refused inside a hook listing, the checkout reports git as
      // unavailable; elsewhere, the gate's own error. Either way it stops,
      // and the refusal (not an earlier error) is what stops it.
      let outcome: unknown
      try {
        await runner.checkOutHeld(
          folder,
          sha,
          fixtures.fork,
          runnerGates(check),
          claimOf(runner, folder),
        )
        outcome = 'succeeded'
      } catch (error: unknown) {
        outcome = error
      }
      expect(isRefused).toBe(true)
      expect(
        outcome instanceof ReservationLostError ||
          (outcome instanceof Error &&
            outcome.message.includes(UI_TEXT.openPullRequestFiltersUnavailable)),
      ).toBe(true)
      expect(startedAfter).toBe(0)
      expect(existsSync(folder)).toBe(false)
      expect(isListedWorktree(folder)).toBe(false)
    }
  })

  it('starts no git once trust is revoked while the claim completes', async () => {
    // RVM123P6 finding 2: trust is valid when the checkout goes to claim
    // its folder, and revoked while the records answer; `git worktree add`
    // must not run. GIT_TRACE shows every git that ran.
    const trace = path.join(await mkdtemp(path.join(tmpdir(), 'm123p-trace-')), 'trace.txt')
    let isTrusted = true
    let folder = ''
    const store = createMemoryWorktreeRecordStore(process.platform)
    const setup = await fixtureSetup('held', {
      isTrusted: () => isTrusted,
      quietEnv: { GIT_TRACE: trace },
      records: recordsAround(store, async (_name, call) => {
        const result = await call()
        // The first answer from the records once the folder exists.
        if (folder !== '' && existsSync(folder)) {
          isTrusted = false
        }
        return result
      }),
    })
    folder = heldFolderOf(setup.dataFolder, 51)
    const result = await setup.checkout.open('51', FORK_REMOTES, 'origin')
    expect(result.ok).toBe(false)
    expect(isTrusted).toBe(false)
    const ran = existsSync(trace) ? readFileSync(trace, 'utf8') : ''
    expect(ran).toContain('ls-tree')
    expect(ran).not.toMatch(/worktree add/u)
    expect(isListedWorktree(folder)).toBe(false)
    // What it made (the empty folder) went, without git, and its record with it.
    expect(existsSync(folder)).toBe(false)
    expect(await setup.records.list()).toEqual([])
  })

  it('never strands a checkout when a delayed takeover lands after its claim', async () => {
    // RVM123P6 finding 1: A reserves and pauses before claiming. B's wall
    // clock is an hour ahead, so A's reservation looks stale; B checks the
    // folder absent and its supersede is delayed right before it publishes.
    // A resumes, claims and runs git; then B's supersede lands. Whatever
    // each window then does, the store must not end with a folder no
    // finished record names.
    const dataFolder = await mkdtemp(path.join(tmpdir(), 'm123p-delayed-'))
    const log = recordingLogger()
    const aGate = deferred()
    const aWaiting = deferred()
    let hasReserved = false
    const aRecords = recordsAround(
      createFileWorktreeRecordStore(dataFolder, process.platform, log),
      async (name, call) => {
        if (hasReserved) {
          aWaiting.resolve()
          await aGate.promise
        }
        const result = await call()
        hasReserved ||= name === 'reserve'
        return result
      },
    )
    // B pauses at its first publish (the supersede), after its last lease
    // check; its short lease lets A's claim take the records over meanwhile.
    const bLanded = deferred()
    const bPaused = deferred()
    let isBArmed = true
    const bFs: RecordStoreFs = {
      ...nodeRecordStoreFs,
      link: async (existing, target) => {
        if (isBArmed && GENERATION_FILE.test(target)) {
          isBArmed = false
          bPaused.resolve()
          await bLanded.promise
        }
        await nodeRecordStoreFs.link(existing, target)
      },
    }
    const bRecords = createFileWorktreeRecordStore(dataFolder, process.platform, log, {
      fs: bFs,
      leaseMs: 200,
    })
    const windowA = await fixtureSetup('held', { dataFolder, records: aRecords })
    const windowB = await fixtureSetup('held', {
      dataFolder,
      records: bRecords,
      now: 2000 + PENDING_CHECKOUT_RECOVERY_MS + 1,
    })
    const folder = heldFolderOf(dataFolder, 51)
    const aOpen = windowA.checkout.open('51', FORK_REMOTES, 'origin')
    await aWaiting.promise
    const bOpen = windowB.checkout.open('51', FORK_REMOTES, 'origin')
    await bPaused.promise
    aGate.resolve()
    // A runs git: its worktree is registered before B's supersede lands.
    for (let attempt = 1; attempt <= 400 && !existsSync(path.join(folder, '.git')); attempt += 1) {
      await delay(25)
    }
    expect(existsSync(path.join(folder, '.git'))).toBe(true)
    bLanded.resolve()
    const [aResult, bResult] = await Promise.all([aOpen, bOpen])
    const fresh = createFileWorktreeRecordStore(dataFolder, process.platform, log)
    const record = await fresh.recordFor(folder)
    if (existsSync(folder)) {
      // The folder is named by a finished record, and a window has it.
      expect(record).toBeDefined()
      expect(record?.isCheckoutPending).toBeUndefined()
      expect(aResult.ok || bResult.ok).toBe(true)
      expect(isListedWorktree(folder)).toBe(true)
    } else {
      expect(record).toBeUndefined()
      expect(isListedWorktree(folder)).toBe(false)
    }
    // A claimed first, so A made it: B's takeover was refused, and B at
    // most opened A's finished checkout again.
    expect(aResult.ok).toBe(true)
    expect(bResult.ok ? bResult.folder : bResult.reason).toBe(
      bResult.ok ? folder : UI_TEXT.gitOperationChanged,
    )
  })
})

describe('checkout profile selection and final gate', () => {
  const availableWindow: admission.ResourceWindowHost = {
    port: {
      status: vi.fn(),
      subscribe: vi.fn(),
      resume: vi.fn(),
      refreshStatus: vi.fn(),
      settingsChanged: vi.fn(),
    },
    createStatus: vi.fn(),
    createVsCodeItem: vi.fn(),
  }

  it.each(['run', 'start'] as const)(
    'reports each resource refusal honestly for %s',
    async (operation) => {
      vi.mocked(admission.loadResourceWindow).mockResolvedValue(availableWindow)
      for (const [error, expected] of [
        [new ResourceCapRefusedError(1), UI_TEXT.gitMachineBusy],
        [new ResourcePausedError(), resourcePausedText()],
        [new ResourceMemoryLimitError('jobMemory'), UI_TEXT.gitMemoryLimit],
        [new ResourceMemoryLimitError('processMemory'), UI_TEXT.gitMemoryLimit],
        [new ResourceUnavailableError('launchUnavailable'), UI_TEXT.gitResourceUnavailable],
        [new ResourceUnavailableError('admissionUnavailable'), UI_TEXT.gitResourceUnavailable],
      ] as const) {
        vi.spyOn(launcher, 'execResourceFile').mockRejectedValue(error)
        vi.spyOn(launcher, 'spawnResourceProcess').mockRejectedValue(error)
        const result = await settled(
          Promise.resolve<unknown>(
            nodeGitProcesses[operation]('fixture-git', ['cat-file', '--batch'], {
              cwd: tmpdir(),
              env: {},
              signal: new AbortController().signal,
              timeout: 1000,
              maxBuffer: 10_000,
              detached: process.platform !== 'win32',
              beforeSpawn: () => undefined,
            }),
          ),
        )
        expect(result).toMatchObject({ message: expected })
      }
    },
  )

  it.each(['run', 'start'] as const)(
    'keeps Cancel after the admission availability wait for %s',
    async (operation) => {
      const reached = Promise.withResolvers<undefined>()
      const lookup = Promise.withResolvers<admission.ResourceWindowHost>()
      vi.mocked(admission.loadResourceWindow).mockImplementation(() => {
        reached.resolve(undefined)
        return lookup.promise
      })
      const unavailable = new ResourceUnavailableError('admissionUnavailable')
      vi.spyOn(launcher, 'execResourceFile').mockRejectedValue(unavailable)
      vi.spyOn(launcher, 'spawnResourceProcess').mockRejectedValue(unavailable)
      const controller = new AbortController()
      const refusal = new DOMException('Cancelled during admission lookup', 'AbortError')
      const running = Promise.resolve<unknown>(
        nodeGitProcesses[operation](process.execPath, ['-v'], {
          cwd: tmpdir(),
          env: {},
          signal: controller.signal,
          timeout: 1000,
          maxBuffer: 10_000,
          detached: false,
          beforeSpawn: () => undefined,
        }),
      )
      const result = expect(running).rejects.toBe(refusal)
      await reached.promise
      controller.abort(refusal)
      lookup.resolve(availableWindow)
      await result
    },
  )

  it('uses the shared Git unconfigured-admission rule for run and batch, with the final gate', async () => {
    vi.mocked(admission.admitResource).mockResolvedValue(undefined)
    vi.mocked(admission.loadResourceWindow).mockResolvedValue(undefined)
    const beforeSpawn = vi.fn()
    const options = {
      cwd: tmpdir(),
      env: {},
      signal: new AbortController().signal,
      timeout: 1000,
      maxBuffer: 10_000,
      detached: process.platform !== 'win32',
      beforeSpawn,
    }
    expect(
      await nodeGitProcesses.run(
        process.execPath,
        ['-e', "process.stdout.write('fallback')"],
        options,
      ),
    ).toBe('fallback')
    const child = await nodeGitProcesses.start(
      process.execPath,
      ['-e', 'process.stdin.pipe(process.stdout)'],
      options,
    )
    const output: Buffer[] = []
    child.stdout.on('data', (bytes: Buffer) => {
      output.push(bytes)
    })
    child.stdin.end('batch')
    await once(child, 'close')
    expect(Buffer.concat(output).toString()).toBe('batch')
    expect(beforeSpawn).toHaveBeenCalledTimes(2)
    expect(child.outcome).toBeUndefined()
    // Refusal remains the caller's exact error, with no process started.
    const refusal = new ReservationLostError('fixture')
    for (const operation of ['run', 'start'] as const) {
      await expect(
        nodeGitProcesses[operation](process.execPath, ['-v'], {
          ...options,
          beforeSpawn: () => {
            throw refusal
          },
        }),
      ).rejects.toBe(refusal)
    }
  })

  it.each([
    '',
    'fatal: unavailable',
    `password=synthetic-secret ${'x'.repeat(GIT_STDERR_MAX_CHARS)}`,
  ])(
    'keeps bounded redacted diagnostics, with a fallback only for empty stderr: %s',
    async (stderr) => {
      const error = Object.assign(new Error('Governed command failed'), { stderr, code: 128 })
      vi.spyOn(launcher, 'execResourceFile').mockRejectedValue(error)
      const result = await settled(
        nodeGitProcesses.run('fixture-git', ['fetch', 'origin'], {
          cwd: tmpdir(),
          env: {},
          signal: new AbortController().signal,
          timeout: 1000,
          maxBuffer: 10_000,
          beforeSpawn: () => undefined,
        }),
      )
      const expected =
        stderr === ''
          ? 'Governed command failed'
          : redactSecrets(`Command failed: fixture-git fetch origin\n${stderr}`).slice(
              0,
              GIT_STDERR_MAX_CHARS,
            )
      expect(result).toMatchObject({ message: expected, code: 128 })
      expect(expected).not.toContain('synthetic-secret')
      expect(expected.length).toBeLessThanOrEqual(GIT_STDERR_MAX_CHARS)
    },
  )
  it.each([
    [['config', '--get', 'remote.origin.url'], 'probe'],
    [['config', 'remote.origin.url', 'changed'], 'contained'],
    [['remote', '-v'], 'probe'],
    [['remote', 'add', 'other', 'url'], 'contained'],
    [['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], 'probe'],
    [['unknown'], 'contained'],
  ] as const)('checks the complete arguments %j before choosing %s', async (args, profile) => {
    const spy = vi.spyOn(launcher, 'execResourceFile').mockResolvedValue({ stdout: '', stderr: '' })
    const beforeSpawn = vi.fn()
    await nodeGitProcesses.run('fixture', args, {
      cwd: tmpdir(),
      env: {},
      signal: new AbortController().signal,
      timeout: 1000,
      maxBuffer: 1000,
      beforeSpawn,
    })
    expect(spy).toHaveBeenCalledWith(
      profile,
      'fixture',
      args,
      expect.objectContaining({ beforeSpawn }),
    )
  })
})
