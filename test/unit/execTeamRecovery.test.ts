// RVCM96B2 P2-4/5/6: the durable cleanup ledger, the stale-run sweep, the
// denied-merge hold and the conflict-marker gate, against real Git.
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXEC_TEAM_HOLD_REF_PREFIX, EXEC_TEAM_RUN_PREFIX } from '../../src/shared/constants'
import {
  createHoldRef,
  currentOwner,
  isGitTimeout,
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
