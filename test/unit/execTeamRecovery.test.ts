// RVCM96B2 P2-4/5/6: the durable cleanup ledger, the stale-run sweep, the
// denied-merge hold and the conflict-marker gate, against real Git.
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { TeamGitError, type TeamGit } from '../../src/core/team/teamWorkspaces'
import {
  EXEC_TEAM_CLEANUP_FILE,
  EXEC_TEAM_HOLD_REF_PREFIX,
  EXEC_TEAM_RUN_PREFIX,
} from '../../src/shared/constants'
import {
  createHoldRef,
  currentOwner,
  isBirthMatch,
  isGitTimeout,
  isProcessAlive,
  predictedAgentsRef,
  pruneCleanupRef,
  recordCleanupOwner,
  recordCleanupRef,
  recordHoldRef,
  releaseHoldRef,
  removeStaleCleanupRefs,
  scanConflictMarkers,
  sweepStaleTeamRuns,
  withGitBounds,
} from '../../src/runtime/exec/execTeamRecovery'
import { cleanupTeamRoots, teamFixtureRepo, teamGitRunner, trackTeamRoot } from './helpers/teamGit'

cleanupTeamRoots()
const git = teamGitRunner()
const REAL_GIT_TIMEOUT_MS = 30_000

/** A killed child exits 1 with no output: never absence, always failure. */
const failingGit: TeamGit = () => Promise.reject(new TeamGitError(1, '', 'rev-parse'))
/** `rev-parse --verify` proving the ref is gone. */
const absentGit: TeamGit = () =>
  Promise.reject(new TeamGitError(128, 'fatal: Needed a single revision', 'rev-parse'))

const sha = async (repo: string, rev: string): Promise<string> =>
  new TextDecoder().decode(await git(['rev-parse', rev], repo)).trim()

async function commitAll(repo: string, message: string): Promise<string> {
  await git(['add', '-A'], repo)
  await git(
    ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-m', message],
    repo,
  )
  return await sha(repo, 'HEAD')
}

describe('execTeamRecovery cleanup ledger', () => {
  it('records the owner and owned refs, then prunes what the run removed', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), `${EXEC_TEAM_RUN_PREFIX}ledger-`))
    trackTeamRoot(folder)
    const { root } = await teamFixtureRepo(git)
    const ref = predictedAgentsRef('engineering', 't1') ?? ''
    await recordCleanupOwner(folder, currentOwner())
    await recordCleanupRef(folder, { repo: root, role: 'engineering', taskId: 't1', ref })
    const stored = JSON.parse(await readFile(path.join(folder, 'team-cleanup.json'), 'utf8')) as {
      refs: readonly { ref: string }[]
    }
    expect(stored.refs.map((entry) => entry.ref)).toEqual([ref])
    await pruneCleanupRef(folder, root, ref)
    const pruned = JSON.parse(await readFile(path.join(folder, 'team-cleanup.json'), 'utf8')) as {
      refs: readonly unknown[]
    }
    expect(pruned.refs).toEqual([])
  })

  it(
    'sweeps a dead run folder and only the owned refs its ledger names',
    async () => {
      const tmpRoot = await mkdtemp(path.join(tmpdir(), 'm96b-sweep-'))
      trackTeamRoot(tmpRoot)
      const { root, head } = await teamFixtureRepo(git)
      const owned = predictedAgentsRef('engineering', 't9') ?? ''
      await git(['update-ref', owned, head], root)
      // A ref no ledger names is never touched, even under a swept folder.
      await git(['update-ref', 'refs/heads/agents/engineering/stranger', head], root)
      const folder = await mkdtemp(path.join(tmpRoot, `${EXEC_TEAM_RUN_PREFIX}s-`))
      await recordCleanupOwner(folder, { pid: 1, startedAt: 1 })
      await recordCleanupRef(folder, { repo: root, role: 'engineering', taskId: 't9', ref: owned })
      const swept = await sweepStaleTeamRuns({ tmpRoot, git, isAlive: () => false })
      expect(swept.sweptFolders).toEqual([folder])
      expect(swept.sweptRefs).toEqual([`${root}:${owned}`])
      await expect(git(['rev-parse', '--verify', owned], root)).rejects.toThrow()
      expect(
        new TextDecoder()
          .decode(
            await git(['rev-parse', '--verify', 'refs/heads/agents/engineering/stranger'], root),
          )
          .trim(),
      ).toBe(head)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps a live run and skips folders without a readable ledger',
    async () => {
      const tmpRoot = await mkdtemp(path.join(tmpdir(), 'm96b-sweep-'))
      trackTeamRoot(tmpRoot)
      const { root, head } = await teamFixtureRepo(git)
      const owned = predictedAgentsRef('engineering', 't7') ?? ''
      await git(['update-ref', owned, head], root)
      const live = await mkdtemp(path.join(tmpRoot, `${EXEC_TEAM_RUN_PREFIX}live-`))
      await recordCleanupOwner(live, currentOwner())
      await recordCleanupRef(live, { repo: root, role: 'engineering', taskId: 't7', ref: owned })
      const bare = await mkdtemp(path.join(tmpRoot, `${EXEC_TEAM_RUN_PREFIX}bare-`))
      const kept = await sweepStaleTeamRuns({ tmpRoot, git, isAlive: () => true })
      expect(kept.sweptFolders).toEqual([])
      expect(kept.skipped).toEqual(expect.arrayContaining([live, bare]))
      expect(
        new TextDecoder().decode(await git(['rev-parse', '--verify', owned], root)).trim(),
      ).toBe(head)
      // The default liveness probe sees this process alive and keeps its runs.
      const mine = await mkdtemp(path.join(tmpRoot, `${EXEC_TEAM_RUN_PREFIX}mine-`))
      await recordCleanupOwner(mine, currentOwner())
      const probed = await sweepStaleTeamRuns({ tmpRoot, git })
      expect(probed.sweptFolders).not.toContain(mine)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'never sweeps held branches, and reconciles owned refs at close',
    async () => {
      const tmpRoot = await mkdtemp(path.join(tmpdir(), 'm96b-sweep-'))
      trackTeamRoot(tmpRoot)
      const { root, head } = await teamFixtureRepo(git)
      const folder = await mkdtemp(path.join(tmpRoot, `${EXEC_TEAM_RUN_PREFIX}h-`))
      const owned = predictedAgentsRef('engineering', 't5') ?? ''
      await git(['update-ref', owned, head], root)
      await recordCleanupOwner(folder, currentOwner())
      await recordCleanupRef(folder, { repo: root, role: 'engineering', taskId: 't5', ref: owned })
      const held = await createHoldRefFor(folder, root, head)
      const swept = await sweepStaleTeamRuns({ tmpRoot, git, isAlive: () => false })
      expect(swept.sweptRefs).toEqual([`${root}:${owned}`])
      expect(
        new TextDecoder().decode(await git(['rev-parse', '--verify', held], root)).trim(),
      ).toBe(head)
      // Close-time reconciliation removes a ref the run missed, then prunes it.
      const stray = predictedAgentsRef('engineering', 't6') ?? ''
      await git(['update-ref', stray, head], root)
      const closing = await mkdtemp(path.join(tmpdir(), `${EXEC_TEAM_RUN_PREFIX}close-`))
      trackTeamRoot(closing)
      await recordCleanupOwner(closing, currentOwner())
      await recordCleanupRef(closing, { repo: root, role: 'engineering', taskId: 't6', ref: stray })
      const errors: unknown[] = []
      await removeStaleCleanupRefs({
        git,
        folder: closing,
        onError: (error) => {
          errors.push(error)
        },
      })
      expect(errors).toEqual([])
      await expect(git(['rev-parse', '--verify', stray], root)).rejects.toThrow()
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'serializes concurrent ledger updates so a record racing a prune loses nothing (P2-6)',
    async () => {
      const tmpRoot = await mkdtemp(path.join(tmpdir(), 'm96b-sweep-'))
      trackTeamRoot(tmpRoot)
      const folder = path.join(tmpRoot, `${EXEC_TEAM_RUN_PREFIX}race-`)
      await mkdir(folder, { recursive: true })
      await recordCleanupOwner(folder, currentOwner())
      const first = {
        repo: '/repo',
        role: 'engineering',
        taskId: 'race-1',
        ref: 'refs/heads/agents/engineering/race-1',
      }
      const second = {
        repo: '/repo',
        role: 'engineering',
        taskId: 'race-2',
        ref: 'refs/heads/agents/engineering/race-2',
      }
      await Promise.all([recordCleanupRef(folder, first), recordCleanupRef(folder, second)])
      const readRefs = async (): Promise<Set<string>> => {
        const stored = JSON.parse(
          await readFile(path.join(folder, 'team-cleanup.json'), 'utf8'),
        ) as { refs: readonly { ref: string }[] }
        return new Set(stored.refs.map((entry) => entry.ref))
      }
      expect(await readRefs()).toEqual(
        new Set(['refs/heads/agents/engineering/race-1', 'refs/heads/agents/engineering/race-2']),
      )
      // Either serialization order of a prune racing a record ends the same way.
      const third = {
        repo: '/repo',
        role: 'engineering',
        taskId: 'race-3',
        ref: 'refs/heads/agents/engineering/race-3',
      }
      await Promise.all([
        pruneCleanupRef(folder, '/repo', 'refs/heads/agents/engineering/race-1'),
        recordCleanupRef(folder, third),
      ])
      expect(await readRefs()).toEqual(
        new Set(['refs/heads/agents/engineering/race-2', 'refs/heads/agents/engineering/race-3']),
      )
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'skips a malformed ledger and still sweeps later dead runs (P2-12)',
    async () => {
      const tmpRoot = await mkdtemp(path.join(tmpdir(), 'm96b-sweep-'))
      trackTeamRoot(tmpRoot)
      const { root, head } = await teamFixtureRepo(git)
      const broken = path.join(tmpRoot, `${EXEC_TEAM_RUN_PREFIX}aaa-broken`)
      await mkdir(broken, { recursive: true })
      await writeFile(path.join(broken, 'team-cleanup.json'), '{')
      const owned = predictedAgentsRef('engineering', 't12') ?? ''
      await git(['update-ref', owned, head], root)
      const folder = path.join(tmpRoot, `${EXEC_TEAM_RUN_PREFIX}zzz-valid`)
      await mkdir(folder, { recursive: true })
      await recordCleanupOwner(folder, { pid: 1, startedAt: 1 })
      await recordCleanupRef(folder, { repo: root, role: 'engineering', taskId: 't12', ref: owned })
      const swept = await sweepStaleTeamRuns({ tmpRoot, git, isAlive: () => false })
      expect(swept.sweptFolders).toEqual([folder])
      expect(swept.sweptRefs).toEqual([`${root}:${owned}`])
      expect(swept.skipped).toEqual(expect.arrayContaining([broken]))
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps a ref whose read failed and reports it instead of pruning (P2-8)',
    async () => {
      const tmpRoot = await mkdtemp(path.join(tmpdir(), 'm96b-sweep-'))
      trackTeamRoot(tmpRoot)
      const { root, head } = await teamFixtureRepo(git)
      const owned = predictedAgentsRef('engineering', 't13') ?? ''
      await git(['update-ref', owned, head], root)
      const folder = await mkdtemp(path.join(tmpRoot, `${EXEC_TEAM_RUN_PREFIX}close-`))
      await recordCleanupOwner(folder, currentOwner())
      await recordCleanupRef(folder, { repo: root, role: 'engineering', taskId: 't13', ref: owned })
      const errors: unknown[] = []
      await expect(
        removeStaleCleanupRefs({
          git: failingGit,
          folder,
          onError: (error) => {
            errors.push(error)
          },
        }),
      ).rejects.toThrow()
      expect(errors.length).toBeGreaterThan(0)
      // The record survives for the next sweep; the ref is untouched.
      const stored = JSON.parse(await readFile(path.join(folder, 'team-cleanup.json'), 'utf8')) as {
        refs: readonly { ref: string }[]
      }
      expect(stored.refs.map((entry) => entry.ref)).toEqual([owned])
      expect(
        new TextDecoder().decode(await git(['rev-parse', '--verify', owned], root)).trim(),
      ).toBe(head)
      // A verified absence still prunes without error.
      const quiet: unknown[] = []
      await removeStaleCleanupRefs({
        git: absentGit,
        folder,
        onError: (error) => {
          quiet.push(error)
        },
      })
      expect(quiet).toEqual([])
      const pruned = JSON.parse(await readFile(path.join(folder, 'team-cleanup.json'), 'utf8')) as {
        refs: readonly unknown[]
      }
      expect(pruned.refs).toEqual([])
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

async function createHoldRefFor(folder: string, repo: string, head: string): Promise<string> {
  const ref = await createHoldRef(git, repo, repo, 'engineering', 'held', head)
  await recordHoldRef(folder, { repo, role: 'engineering', taskId: 'held', ref })
  return ref
}

describe('execTeamRecovery hold refs', () => {
  it(
    'fetches the branch objects so the hold survives its copy',
    async () => {
      const { root } = await teamFixtureRepo(git)
      const copy = await mkdtemp(path.join(tmpdir(), 'm96b-hold-copy-'))
      trackTeamRoot(copy)
      await git(['clone', '--shared', '--no-checkout', root, copy], tmpdir())
      await git(['checkout', '-b', 'agents/engineering/holdme', 'HEAD'], copy)
      await writeFile(path.join(copy, 'held.txt'), 'kept\n')
      const head = await commitAll(copy, 'held work')
      const ref = await createHoldRef(git, root, copy, 'engineering', 'holdme', head)
      expect(ref).toBe(`${EXEC_TEAM_HOLD_REF_PREFIX}engineering/holdme`)
      // The objects are in the user's repository, not only in the removed copy.
      const shown = await git(['show', `${ref}:held.txt`], root)
      expect(new TextDecoder().decode(shown)).toBe('kept\n')
      await releaseHoldRef(git, root, 'engineering', 'holdme')
      await expect(git(['rev-parse', '--verify', ref], root)).rejects.toThrow()
      await releaseHoldRef(git, root, 'engineering', 'holdme')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses bad names and bad heads before creating anything',
    async () => {
      const { root, head } = await teamFixtureRepo(git)
      await expect(
        createHoldRef(git, root, root, 'engineering', '../escape', head),
      ).rejects.toThrow()
      await expect(
        createHoldRef(git, root, root, 'engineering', 't1', 'not-a-sha'),
      ).rejects.toThrow()
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('execTeamRecovery marker gate', () => {
  it(
    'passes ordinary content and refuses added conflict markers with file and line',
    async () => {
      const { root } = await teamFixtureRepo(git)
      const base = await sha(root, 'HEAD')
      await writeFile(path.join(root, 'tracked.txt'), 'before\nsecond line  \nthird\n')
      await writeFile(path.join(root, 'crlf.txt'), 'one\r\ntwo  \r\n')
      await writeFile(path.join(root, 'breaks.md'), 'hard  \nbreak\n')
      const cleanHead = await commitAll(root, 'ordinary content')
      expect(
        await scanConflictMarkers(git, root, base, cleanHead, [
          'tracked.txt',
          'crlf.txt',
          'breaks.md',
        ]),
      ).toEqual({
        status: 'clean',
      })
      await writeFile(
        path.join(root, 'tracked.txt'),
        'before\n<<<<<<< ours\nours line\n=======\ntheirs line\n>>>>>>> theirs\n',
      )
      const dirtyHead = await commitAll(root, 'conflicted change')
      expect(await scanConflictMarkers(git, root, base, dirtyHead, ['tracked.txt'])).toEqual({
        status: 'markers',
        detail: 'tracked.txt:2',
      })
      expect(await scanConflictMarkers(git, root, base, dirtyHead, [])).toEqual({ status: 'clean' })
      expect(
        await scanConflictMarkers(git, root, base, dirtyHead, ['tracked.txt'], 10),
      ).toMatchObject({ status: 'too-large' })
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it('passes a newly added setext heading whose ======= stands alone (P2-13)', async () => {
    const { root } = await teamFixtureRepo(git)
    const base = await sha(root, 'HEAD')
    await writeFile(path.join(root, 'heading.md'), 'Heading\n=======\n')
    const head = await commitAll(root, 'setext heading')
    expect(await scanConflictMarkers(git, root, base, head, ['heading.md'])).toEqual({
      status: 'clean',
    })
  })
})

describe('execTeamRecovery git bounds', () => {
  it('marks its own timeout so callers fall back instead of surfacing English', async () => {
    const unsettled = new Promise<string>(() => {
      // Never settles: the bound must fire.
    })
    await expect(withGitBounds(unsettled, 20)).rejects.toSatisfy(isGitTimeout)
    await expect(withGitBounds(Promise.resolve('done'), 1000)).resolves.toBe('done')
  })
})

const KNOWN_HEAD = '0123456789abcdef0123456789abcdef01234567'

/** Every git call fails as a ref moved under the deleter (exit 1, never absence). */
const clashGit: TeamGit = (args) =>
  args[0] === 'rev-parse'
    ? Promise.resolve(new TextEncoder().encode(`${KNOWN_HEAD}\n`))
    : Promise.reject(new TeamGitError(1, 'cannot lock ref: moved under us', 'update-ref'))

describe('execTeamRecovery ownership proof (RVCM96B2D P2-7/P2-10)', () => {
  it(
    'skips a dead run whose ledger names another installation (P2-7)',
    async () => {
      const tmpRoot = await mkdtemp(path.join(tmpdir(), 'm96b-own-'))
      trackTeamRoot(tmpRoot)
      const elsewhere = await mkdtemp(path.join(tmpdir(), 'm96b-own-else-'))
      trackTeamRoot(elsewhere)
      const { root, head } = await teamFixtureRepo(git)
      const owned = predictedAgentsRef('engineering', 't41') ?? ''
      await git(['update-ref', owned, head], root)
      const folder = await mkdtemp(path.join(tmpRoot, `${EXEC_TEAM_RUN_PREFIX}foreign-`))
      await writeFile(
        path.join(folder, EXEC_TEAM_CLEANUP_FILE),
        JSON.stringify({
          owner: { pid: 1, startedAt: 1 },
          runsRoot: elsewhere,
          refs: [{ repo: root, role: 'engineering', taskId: 't41', ref: owned }],
          holds: [],
        }),
      )
      const swept = await sweepStaleTeamRuns({ tmpRoot, git, isAlive: () => false })
      expect(swept.sweptFolders).toEqual([])
      expect(swept.sweptRefs).toEqual([])
      expect(swept.skipped).toContain(folder)
      expect(await sha(root, owned)).toBe(head)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'skips a run folder that links outside the runs root (P2-7)',
    async () => {
      const tmpRoot = await mkdtemp(path.join(tmpdir(), 'm96b-own-'))
      trackTeamRoot(tmpRoot)
      const outside = await mkdtemp(path.join(tmpdir(), 'm96b-own-out-'))
      trackTeamRoot(outside)
      const { root, head } = await teamFixtureRepo(git)
      const owned = predictedAgentsRef('engineering', 't42') ?? ''
      await git(['update-ref', owned, head], root)
      // The ledger names this sweep's runs root, so only the canonical-path
      // check stands between the sweep and the outside folder's refs.
      await writeFile(
        path.join(outside, EXEC_TEAM_CLEANUP_FILE),
        JSON.stringify({
          owner: { pid: 1, startedAt: 1 },
          runsRoot: tmpRoot,
          refs: [{ repo: root, role: 'engineering', taskId: 't42', ref: owned }],
          holds: [],
        }),
      )
      const link = path.join(tmpRoot, `${EXEC_TEAM_RUN_PREFIX}link-`)
      await symlink(outside, link, 'dir')
      const swept = await sweepStaleTeamRuns({ tmpRoot, git, isAlive: () => false })
      expect(swept.sweptFolders).toEqual([])
      expect(swept.sweptRefs).toEqual([])
      expect(swept.skipped).toContain(link)
      expect(await sha(root, owned)).toBe(head)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'treats a ledger without a runs root as proof of nothing (P2-7)',
    async () => {
      const tmpRoot = await mkdtemp(path.join(tmpdir(), 'm96b-own-'))
      trackTeamRoot(tmpRoot)
      const { root, head } = await teamFixtureRepo(git)
      const owned = predictedAgentsRef('engineering', 't44') ?? ''
      await git(['update-ref', owned, head], root)
      const folder = await mkdtemp(path.join(tmpRoot, `${EXEC_TEAM_RUN_PREFIX}legacy-`))
      await writeFile(
        path.join(folder, EXEC_TEAM_CLEANUP_FILE),
        JSON.stringify({
          owner: { pid: 1, startedAt: 1 },
          refs: [{ repo: root, role: 'engineering', taskId: 't44', ref: owned }],
          holds: [],
        }),
      )
      const swept = await sweepStaleTeamRuns({ tmpRoot, git, isAlive: () => false })
      expect(swept.sweptFolders).toEqual([])
      expect(swept.skipped).toContain(folder)
      expect(await sha(root, owned)).toBe(head)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it('reads a dead pid as gone before any birth check (P2-10)', async () => {
    await expect(isProcessAlive(2_147_483_647, 1)).resolves.toBe(false)
  })

  it('reads this process with its recorded birth as alive (P2-10)', async () => {
    await expect(isProcessAlive(process.pid, currentOwner().startedAt)).resolves.toBe(true)
  })

  it('matches births only inside the skew, unknown birth reads alive (P2-10)', () => {
    expect(isBirthMatch(1_700_000_000_000, 1_700_000_000_000)).toBe(true)
    expect(isBirthMatch(1_700_000_000_000, 1_700_000_000_000 + 59_999)).toBe(true)
    expect(isBirthMatch(1_700_000_000_000, 1_700_000_000_000 + 60_001)).toBe(false)
    expect(isBirthMatch(undefined, 1)).toBe(true)
  })

  it('deletes an owned ref carrying the verified revision (P2-7 CAS)', async () => {
    const seen: string[][] = []
    const casGit: TeamGit = (args) => {
      if (args[0] === 'rev-parse') {
        return Promise.resolve(new TextEncoder().encode(`${KNOWN_HEAD}\n`))
      }
      if (args[0] === 'update-ref' && args.length === 4 && args[3] === KNOWN_HEAD) {
        seen.push([...args])
        return Promise.resolve(new TextEncoder().encode(''))
      }
      return Promise.reject(new TeamGitError(1, 'unexpected git call', 'git'))
    }
    const folder = await mkdtemp(path.join(tmpdir(), `${EXEC_TEAM_RUN_PREFIX}cas-`))
    trackTeamRoot(folder)
    await recordCleanupOwner(folder, { pid: 1, startedAt: 1 })
    const ref = predictedAgentsRef('engineering', 't43') ?? ''
    await recordCleanupRef(folder, { repo: '/fake/repo', role: 'engineering', taskId: 't43', ref })
    const errors: unknown[] = []
    await removeStaleCleanupRefs({
      git: casGit,
      folder,
      onError: (error: unknown) => {
        errors.push(error)
      },
    })
    expect(errors).toEqual([])
    expect(seen).toEqual([['update-ref', '-d', ref, KNOWN_HEAD]])
  })

  it(
    'keeps the entry when the compare-and-swap delete fails (P2-7)',
    async () => {
      const folder = await mkdtemp(path.join(tmpdir(), `${EXEC_TEAM_RUN_PREFIX}clash-`))
      trackTeamRoot(folder)
      await recordCleanupOwner(folder, { pid: 1, startedAt: 1 })
      const ref = predictedAgentsRef('engineering', 't45') ?? ''
      await recordCleanupRef(folder, {
        repo: '/fake/repo',
        role: 'engineering',
        taskId: 't45',
        ref,
      })
      const errors: unknown[] = []
      await expect(
        removeStaleCleanupRefs({
          git: clashGit,
          folder,
          onError: (error: unknown) => {
            errors.push(error)
          },
        }),
      ).rejects.toThrow(/team cleanup failures/)
      expect(errors).toHaveLength(1)
      const kept = JSON.parse(
        await readFile(path.join(folder, EXEC_TEAM_CLEANUP_FILE), 'utf8'),
      ) as { refs: readonly { ref: string }[] }
      expect(kept.refs.map((entry) => entry.ref)).toEqual([ref])
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
