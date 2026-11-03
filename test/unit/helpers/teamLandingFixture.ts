// Real-git landing fixture shared by the M96c landing proofs: a real
// repository, a worker clone with one committed change published back as
// the agents ref, and the real git binary behind the `TeamGit` contract.
import { execFile, spawnSync } from 'node:child_process'
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TeamGitError, type TeamGit } from '../../../src/core/team/teamGit'
import type { TeamMergePort } from '../../../src/core/team/teamHostService'
import {
  parseLandingEntry,
  scanLandingEntries,
  type LandingRecord,
} from '../../../src/host/team/landingJournal'
import { createTeamJournal } from '../../../src/host/team/teamJournal'
import type { TeamLandingPolicy } from '../../../src/host/team/teamLandingEntry'
import {
  createWindowAuthority,
  createWindowIdentity,
  type WindowIdentity,
} from '../../../src/host/team/windowIdentity'
import { HOOK_CONFIG_MAX_BYTES } from '../../../src/shared/constants'

export function fixtureGit(cwd: string, args: readonly string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        '-c',
        'core.autocrlf=false',
        ...args,
      ],
      { cwd },
      (error, stdout) => {
        if (error === null) resolve(stdout)
        else reject(new Error('git fixture command failed', { cause: error }))
      },
    )
    child.stdin?.end(input)
  })
}

/** The real git binary behind the `TeamGit` contract, honouring the
explicit environment (staging supplies a temporary GIT_INDEX_FILE). */
export const landingRunGit: TeamGit = (args, cwd, input, env) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        '-c',
        'core.autocrlf=false',
        ...args,
      ],
      { cwd, ...(env !== undefined && { env }) },
      (error, stdout, stderr) => {
        if (error === null) resolve(Buffer.from(stdout))
        else {
          const code = typeof error.code === 'number' ? error.code : 128
          reject(new TeamGitError(code, stderr, args.join(' ')))
        }
      },
    )
    child.stdin?.end(input)
  })

export interface LandingFixture {
  readonly root: string
  readonly storage: string
  readonly workerCopy: string
  readonly baseCommit: string
  readonly head: string
  readonly agentsRef: string
  readonly taskId: string
  /** The files the worker changed, from "before" to "after". */
  readonly changedFiles: readonly string[]
  dispose(): Promise<void>
}

/**
How a suite hands the product the workspace and storage folders (PLAN.md
D24): as created under the temporary folder, through a directory link to
each (a junction on Windows, a symbolic link elsewhere: macOS's /var is
one), or on Windows by the 8.3 short names `cmd.exe` reports (a TEMP under
a long profile name; `RUNNER~1` on hosted runners). Each names the same
folders; a volume that makes no 8.3 names reports the long spelling.
*/
type LandingSpelling = 'asCreated' | 'link' | 'shortName'
export const LANDING_SPELLINGS: readonly LandingSpelling[] =
  process.platform === 'win32' ? ['asCreated', 'link', 'shortName'] : ['asCreated', 'link']

function shortName(folder: string): string {
  const reported = spawnSync('cmd.exe', ['/d', '/c', `for %I in ("${folder}") do @echo %~sI`], {
    encoding: 'utf8',
    windowsVerbatimArguments: true,
  })
  if (reported.status !== 0) throw new Error('cmd.exe did not report the short name')
  return reported.stdout.trim()
}

/** The two folders in the asked spelling, and a removal for what the spelling made. */
async function spelled(
  spelling: LandingSpelling,
  root: string,
  storage: string,
): Promise<{ root: string; storage: string; unlink: () => Promise<void> }> {
  switch (spelling) {
    case 'asCreated': {
      return { root, storage, unlink: () => Promise.resolve() }
    }
    case 'shortName': {
      return { root: shortName(root), storage: shortName(storage), unlink: () => Promise.resolve() }
    }
    case 'link': {
      const links = await mkdtemp(path.join(tmpdir(), 'muse-m96c-landing-links-'))
      const linkedRoot = path.join(links, 'workspace')
      const linkedStorage = path.join(links, 'storage')
      await symlink(root, linkedRoot, 'junction')
      await symlink(storage, linkedStorage, 'junction')
      return {
        root: linkedRoot,
        storage: linkedStorage,
        // The links go first, alone, so no removal walks through one.
        unlink: async () => {
          await rm(linkedRoot, { force: true })
          await rm(linkedStorage, { force: true })
          await rm(links, { recursive: true, force: true })
        },
      }
    }
  }
}

/** One worker's clone of `root` at its HEAD, its files at "after", published as its agents ref. */
async function publishedWorker(
  root: string,
  workerCopy: string,
  taskId: string,
  files: readonly string[],
): Promise<Pick<LandingFixture, 'workerCopy' | 'head' | 'agentsRef' | 'taskId' | 'changedFiles'>> {
  await fixtureGit(path.dirname(workerCopy), ['clone', '--no-hardlinks', root, workerCopy])
  for (const file of files) await writeFile(path.join(workerCopy, file), 'after\n')
  await fixtureGit(workerCopy, ['add', '-A'])
  await fixtureGit(workerCopy, ['commit', '-m', 'work'])
  const headOut = await fixtureGit(workerCopy, ['rev-parse', 'HEAD'])
  const head = headOut.trim()
  const agentsRef = `refs/muse-agents/${taskId}`
  await fixtureGit(root, ['fetch', '--no-tags', '--', workerCopy, `${head}:${agentsRef}`])
  return { workerCopy, head, agentsRef, taskId, changedFiles: files }
}

/** A user tree with `files` at "before" and a worker branch with them at "after". */
export async function makeLandingFixture(
  taskId: string,
  spelling: LandingSpelling = 'asCreated',
  files: readonly string[] = ['file.txt'],
): Promise<LandingFixture> {
  const root = await mkdtemp(path.join(tmpdir(), 'muse-m96c-landing-'))
  const storage = await mkdtemp(path.join(tmpdir(), 'muse-m96c-landing-store-'))
  await fixtureGit(root, ['init', '-b', 'main'])
  for (const file of files) await writeFile(path.join(root, file), 'before\n')
  await fixtureGit(root, ['add', '-A'])
  await fixtureGit(root, ['commit', '-m', 'base'])
  const baseOut = await fixtureGit(root, ['rev-parse', 'HEAD'])
  const baseCommit = baseOut.trim()
  const worker = await publishedWorker(root, path.join(storage, 'worker-copy'), taskId, files)
  const handed = await spelled(spelling, root, storage)
  return {
    ...worker,
    root: handed.root,
    storage: handed.storage,
    baseCommit,
    dispose: async () => {
      await handed.unlink()
      await rm(root, { recursive: true, force: true })
      await rm(storage, { recursive: true, force: true })
    },
  }
}

/** A second worker over the same tree and storage: a new `file` at "after", on its own ref. */
export async function addLandingWorker(
  fixture: LandingFixture,
  taskId: string,
  file: string,
): Promise<LandingFixture> {
  const workerCopy = path.join(fixture.storage, `worker-copy-${taskId}`)
  return {
    ...fixture,
    ...(await publishedWorker(fixture.root, workerCopy, taskId, [file])),
  }
}

/** Every landing record on disk, through the product's own reader of every window's store. */
export async function landingRecords(storage: string): Promise<readonly LandingRecord[]> {
  const owner = createWindowIdentity(Date.now())
  const scanned = await scanLandingEntries(
    createTeamJournal({
      storageDirectory: await realpath(storage),
      owner,
      authority: createWindowAuthority(owner, () => Promise.resolve()),
      maxRecordBytes: HOOK_CONFIG_MAX_BYTES,
      platform: process.platform,
    }),
  )
  if (scanned.blocked) throw new Error('a landing journal is unreadable')
  return scanned.entries.map((entry) => {
    if (entry.raw.kind !== 'record') throw new Error('a landing record is broken')
    return parseLandingEntry(entry.name, entry.raw.value)
  })
}

/** Each landing record's status, as `landingRecords` reads it. */
export async function landingStatuses(storage: string): Promise<readonly string[]> {
  const records = await landingRecords(storage)
  return records.map((record) => record.status)
}

/** One passing `true` workspace check; suites override one port at a time. */
export function landingPolicy(
  owner: WindowIdentity,
  overrides: Partial<TeamLandingPolicy> = {},
): TeamLandingPolicy {
  return {
    owner,
    checks: () => ({
      commands: [{ name: 'check', command: 'true', timeoutSeconds: 60 }],
      platform: process.platform,
      setupCommand: '',
      cacheKey: '',
    }),
    runChecks: () => Promise.resolve({ passed: true }),
    confirmWithoutChecks: () => Promise.resolve(false),
    validateTarget: () => Promise.resolve(),
    hints: () => Promise.resolve([]),
    ...overrides,
  }
}

/** What a window hands the product's landing and recovery for this fixture's folders. */
export function landingDeps(
  fixture: Pick<LandingFixture, 'root' | 'storage'>,
  policy: TeamLandingPolicy,
) {
  return {
    root: fixture.root,
    storage: fixture.storage,
    platform: process.platform,
    isTrusted: () => true,
    runGit: landingRunGit,
    writePaths: undefined,
    policy,
  }
}

/** The merge-port task shape `landTeamTask` consumes for this fixture. */
export function landingTask(fixture: LandingFixture): Parameters<TeamMergePort['merge']>[0] {
  return {
    taskId: fixture.taskId,
    role: { role: 'engineering', pool: [] },
    outcome: {
      report: { status: 'done' as const, summary: 'done' },
      usage: {
        input: 0,
        cachedInput: 0,
        output: 0,
        reasoning: 0,
        modelCalls: 0,
        estimated: false,
      },
      folder: fixture.workerCopy,
      agentsRef: fixture.agentsRef,
      baseCommit: fixture.baseCommit,
      head: fixture.head,
      changedFiles: [...fixture.changedFiles],
    },
  }
}
