// Lane I's merge (PLAN.md D75, M96 acceptance 19): the per-file three-way
// merge with `git merge-file`, conflicts, protected paths, the
// `write-paths` check, the breach check, and Undo merge. Real temporary
// repositories; no model calls.

import {
  appendFile,
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import type * as FsPromises from 'node:fs/promises'
import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  applyTeamMerge,
  isTeamMergeError,
  planTeamMerge,
  undoTeamMerge,
  type TeamMergeIo,
  type TeamMergeSpec,
  type TeamMergeUndo,
  type TeamMergeResult,
} from '../../src/core/team/teamMerge'
import {
  cleanupTeamRoots,
  teamFixtureRepo,
  teamFixtureCommit,
  prepareTeamFixtureCommits,
  copyPreparedTeamTask,
  copyTeamFixture,
  teamGitRunner,
  teamRealPath,
  teamShortRoot,
  teamWindowsPath,
} from './helpers/teamGit'

const runGit = teamGitRunner()
cleanupTeamRoots()
const MULTI_CONFLICT_BASE = 'one\n' + 'stable\n'.repeat(20) + 'two\n'
prepareTeamFixtureCommits([
  ...[
    { 'shared.txt': 'one\nTWO\nthree\n' },
    { 'shared.txt': 'ONE\ntwo\nthree\n' },
    { 'shared.txt': 'one\nTHEIRS\nthree\n' },
    { 'shared.txt': 'theirs\n' },
    { 'new.txt': 'added\n', 'tracked.txt': undefined },
    { 'new.txt': 'theirs\n' },
    { 'tracked.txt': undefined },
    { 'a.txt': 'A\n', 'b.txt': 'B\n' },
    { 'shared.txt': 'branch\n' },
    { 'shared.txt': undefined },
    { 'new.txt': 'branch\n' },
    { 'tracked.txt': 'merged\n' },
    { 'tracked.txt': 'changed\n' },
    { 'src/a.ts': 'code\n', 'docs/ok.md': 'fine\n' },
    { 'docs/ok.md': 'fine\n' },
    { 'DOCS/ok.md': 'fine\n' },
    { 'shared.txt': 'one\nTWO\nthree\n', '.vscode/settings.json': '{}\n' },
    { '.vscode/settings.json': '{}\n' },
    { 'shared.txt': 'changed\n' },
    { 'shared.txt': 'one\nTWO\nthree\n', 'new.txt': 'added\n', 'tracked.txt': undefined },
    { 'shared.txt': 'one\nTWO\nthree\n', 'new.txt': 'added\n' },
    { 'tracked.txt': 'changed\n', 'docs/ok.md': 'nested\n' },
    { 'docs/ok.md': 'before\n' },
    { 'docs/ok.md': 'merged\n' },
    { 'docs/ok.md': 'changed\n' },
  ].map((files) => ({ files })),
  { files: { 'tracked.txt': 'before\n', 'shared.txt': MULTI_CONFLICT_BASE } },
  {
    parentFiles: { 'tracked.txt': 'before\n', 'shared.txt': MULTI_CONFLICT_BASE },
    files: {
      'shared.txt': MULTI_CONFLICT_BASE.replace('one', 'theirs-one').replace('two', 'theirs-two'),
      'aaa-clean.txt': 'clean addition\n',
    },
  },
  { files: { 'blob.bin': '\0\u{1}\u{2}' } },
  { files: { 'blob.bin': '\0\u{7}\u{7}' } },
  { files: { link: 'tracked.txt' }, modes: { link: '120000' } },
  {
    files: { 'tracked.txt': 'before\n', 'private.txt': 'private\n' },
    modes: { 'tracked.txt': '100755' },
  },
  { files: { 'run.sh': '#!/bin/sh\necho hi\n' }, modes: { 'run.sh': '100755' } },
  ...['before\n', 'changed\n'].map((content) => ({
    files: { 'tracked.txt': content },
    modes: { 'tracked.txt': '100755' },
  })),
  ...[{ 'docs/ok.md': 'merged\n' }, { 'docs/ok.md': 'changed\n' }, { 'docs/ok.md': undefined }].map(
    (files) => ({ files, parentFiles: { 'docs/ok.md': 'before\n' } }),
  ),
])
const TEXT = new TextDecoder()

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>()
  return { ...actual, rename: vi.fn(actual.rename), rm: vi.fn(actual.rm) }
})

function io(): TeamMergeIo {
  return { runGit, realPath: teamRealPath }
}

function atLiveRef(ref: string, beforeRead: () => Promise<void>): typeof runGit {
  return async (args, cwd, input, env) => {
    if (args[0] === 'rev-parse' && args[2] === ref) {
      await beforeRead()
    }
    return await runGit(args, cwd, input, env)
  }
}

async function expectRefusedUndo(
  root: string,
  undo: TeamMergeUndo,
  content: string,
): Promise<void> {
  expect(await undoTeamMerge(root, undo)).toEqual({ restored: [], refused: ['tracked.txt'] })
  expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe(content)
}

async function revOf(repo: string, rev: string): Promise<string> {
  return TEXT.decode(await runGit(['rev-parse', rev], repo)).trim()
}

async function expectNoLandedFiles(root: string): Promise<void> {
  for (const file of ['a.txt', 'b.txt']) {
    await expect(readFile(path.join(root, file))).rejects.toMatchObject({ code: 'ENOENT' })
  }
}

async function refsOf(repo: string): Promise<string> {
  return TEXT.decode(await runGit(['for-each-ref'], repo))
}

/** A task branch with `change` committed on top of the base, back on main. */
async function taskBranch(
  root: string,
  base: string,
  files: Readonly<Record<string, string | undefined>>,
): Promise<string> {
  const head = await teamFixtureCommit(runGit, root, base, files)
  await makeTaskCopy(root, head)
  return head
}

async function makeTaskCopy(root: string, head: string): Promise<void> {
  const folder = path.join(root, '..', 'task-copy')
  if (copyPreparedTeamTask(head, folder) !== undefined) return
  copyTeamFixture(root, folder)
  // Most callers already have the task checked out. Binary fixtures call
  // after returning to main, so update just their copy when needed.
  const headText = await readFile(path.join(folder, '.git', 'HEAD'), 'utf8')
  const current = headText.trim()
  if (current !== 'ref: refs/heads/agents/engineering/t1') {
    await runGit(['checkout', '-b', 'agents/engineering/t1-copy', head], folder)
  }
}

function spec(root: string, base: string, head: string, extra = {}): TeamMergeSpec {
  return {
    repositoryRoot: root,
    baseCommit: base,
    branchHead: head,
    agentRefs: [],
    taskFolder: path.join(root, '..', 'task-copy'),
    ...extra,
  }
}

async function expectLiveRefBreach(
  root: string,
  base: string,
  head: string,
  ref: string,
  mergeIo: TeamMergeIo,
): Promise<void> {
  await expect(mergeWithLiveRef(root, base, head, ref, mergeIo)).rejects.toMatchObject({
    code: 'refBreach',
  })
  expect(await readFile(path.join(root, 'shared.txt'), 'utf8')).toBe('one\ntwo\nthree\n')
}

async function mergeWithLiveRef(
  root: string,
  base: string,
  head: string,
  ref: string,
  mergeIo: TeamMergeIo,
): Promise<TeamMergeResult> {
  return await applyTeamMerge(
    mergeIo,
    spec(root, base, head, {
      agentRefs: [{ ref, expected: head, actual: head }],
    }),
  )
}

async function replaceDocsParent(root: string, linkType: 'dir' | 'junction'): Promise<string> {
  const outside = path.join(root, '..', 'outside')
  await mkdir(outside)
  await writeFile(path.join(outside, 'ok.md'), 'merged\n')
  await rename(path.join(root, 'docs'), path.join(root, 'original-docs'))
  await symlink(outside, path.join(root, 'docs'), linkType)
  return outside
}

async function commitDocsBase(root: string, parent: string): Promise<string> {
  await mkdir(path.join(root, 'docs'), { recursive: true })
  await writeFile(path.join(root, 'docs', 'ok.md'), 'before\n')
  const head = await teamFixtureCommit(
    runGit,
    root,
    parent,
    { 'docs/ok.md': 'before\n' },
    'refs/heads/main',
  )
  await runGit(['read-tree', '--reset', 'main'], root)
  return head
}

describe('applyTeamMerge', () => {
  it('merges the branch change cleanly', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, { 'shared.txt': 'one\nTWO\nthree\n' })
    for (const folder of [root, path.join(root, '..', 'task-copy')]) {
      const objects = await readdir(path.join(folder, '.git', 'objects'))
      expect(objects).toContain('pack')
      expect(objects.filter((name) => /^[a-f0-9]{2}$/u.test(name))).toEqual([])
    }
    const reads: (readonly string[])[] = []
    const measuredGit: typeof runGit = async (args, cwd, input, env) => {
      reads.push(args)
      return await runGit(args, cwd, input, env)
    }
    const result = await applyTeamMerge(
      { runGit: measuredGit, realPath: teamRealPath },
      spec(root, base, head),
    )
    expect(reads.filter((args) => args[0] === 'ls-tree')).toHaveLength(0)
    expect(reads.filter((args) => args[0] === 'cat-file')).toEqual([['cat-file', '--batch']])
    expect(result.conflicts).toEqual([])
    expect(result.written).toEqual(['shared.txt'])
    expect(await readFile(path.join(root, 'shared.txt'), 'utf8')).toBe('one\nTWO\nthree\n')
  })

  it('keeps the tree’s own uncommitted changes', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, { 'shared.txt': 'ONE\ntwo\nthree\n' })
    await writeFile(path.join(root, 'shared.txt'), 'one\ntwo\nTHREE-OURS\n')
    const result = await applyTeamMerge(io(), spec(root, base, head))
    expect(result.conflicts).toEqual([])
    expect(await readFile(path.join(root, 'shared.txt'), 'utf8')).toBe('ONE\ntwo\nTHREE-OURS\n')
  })

  it('returns a conflict to the task copy for rework without landing markers', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, { 'shared.txt': 'one\nTHEIRS\nthree\n' })
    await writeFile(path.join(root, 'shared.txt'), 'one\nOURS\nthree\n')
    const result = await applyTeamMerge(io(), spec(root, base, head))
    expect(result.written).toEqual([])
    expect(result.conflicts).toEqual([{ path: 'shared.txt', isBinary: false }])
    expect(result.status).toBe('rework')
    expect(result.undo.files).toEqual([])
    expect(await readFile(path.join(root, 'shared.txt'), 'utf8')).toBe('one\nOURS\nthree\n')
    const merged = await readFile(path.join(root, '..', 'task-copy', 'shared.txt'), 'utf8')
    expect(merged).toContain('<<<<<<<')
    expect(merged).toContain('>>>>>>>')
    expect(merged).toContain('OURS')
    expect(merged).toContain('THEIRS')
  })

  it('refuses rework into a task root overlapping the user tree', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    // The rework destination is the user's parent, so no separate task tree
    // is used. Import its real branch commit without copying or checking out.
    const head = await teamFixtureCommit(runGit, root, base, { 'shared.txt': 'theirs\n' })
    await writeFile(path.join(root, 'shared.txt'), 'ours\n')
    await expect(
      applyTeamMerge(io(), spec(root, base, head, { taskFolder: path.dirname(root) })),
    ).rejects.toMatchObject({
      code: 'mergeFailed',
      message: 'Conflicts need the task copy for rework',
    })
    expect(await readFile(path.join(root, 'shared.txt'), 'utf8')).toBe('ours\n')
  })

  it('refuses rework when the task copy HEAD no longer matches the reviewed head', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, { 'shared.txt': 'theirs\n' })
    await writeFile(path.join(root, 'shared.txt'), 'ours\n')
    const taskFolder = path.join(root, '..', 'task-copy')
    await runGit(['update-ref', 'HEAD', base, head], taskFolder)
    await expect(applyTeamMerge(io(), spec(root, base, head))).rejects.toMatchObject({
      code: 'refBreach',
    })
    expect(await readFile(path.join(root, 'shared.txt'), 'utf8')).toBe('ours\n')
    expect(await readFile(path.join(taskFolder, 'shared.txt'), 'utf8')).toBe('theirs\n')
  })

  it('adds and deletes files', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, {
      'new.txt': 'added\n',
      'tracked.txt': undefined,
    })
    const result = await applyTeamMerge(io(), spec(root, base, head))
    expect(result.conflicts).toEqual([])
    expect(await readFile(path.join(root, 'new.txt'), 'utf8')).toBe('added\n')
    await expect(stat(path.join(root, 'tracked.txt'))).rejects.toThrow()
  })

  it('conflicts on add/add with different bytes', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, { 'new.txt': 'theirs\n' })
    await writeFile(path.join(root, 'new.txt'), 'ours\n')
    const result = await applyTeamMerge(io(), spec(root, base, head))
    expect(result.conflicts).toEqual([{ path: 'new.txt', isBinary: false }])
  })

  it('conflicts on delete/modify, keeping the tree’s bytes', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, { 'tracked.txt': undefined })
    await writeFile(path.join(root, 'tracked.txt'), 'modified\n')
    const result = await applyTeamMerge(io(), spec(root, base, head))
    expect(result.conflicts).toEqual([{ path: 'tracked.txt', isBinary: false }])
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('modified\n')
    expect(await readFile(path.join(root, '..', 'task-copy', 'tracked.txt'), 'utf8')).toContain(
      '<<<<<<<',
    )
  })

  it('makes no commit and changes no ref', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, { 'shared.txt': 'one\nTWO\nthree\n' })
    const refsBefore = await refsOf(root)
    await applyTeamMerge(io(), spec(root, base, head))
    expect(await revOf(root, 'main')).toBe(base)
    expect(await refsOf(root)).toBe(refsBefore)
    // The change sits uncommitted in the working tree.
    expect(TEXT.decode(await runGit(['status', '--porcelain=v1', '-z'], root))).toContain(
      'shared.txt',
    )
  })

  it('leaves an already-merged tree alone', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, { 'shared.txt': 'one\nTWO\nthree\n' })
    await writeFile(path.join(root, 'shared.txt'), 'one\nTWO\nthree\n')
    const result = await applyTeamMerge(io(), spec(root, base, head))
    expect(result).toMatchObject({ written: [], conflicts: [] })
  })
})

describe('round 2: transactional landing', () => {
  it.each(['ref', 'io'])(
    'rolls back every landed file after a later %s refusal and carries Undo',
    async (failure) => {
      const { root, head: base } = await teamFixtureRepo(runGit)
      const head = await taskBranch(root, base, { 'a.txt': 'A\n', 'b.txt': 'B\n' })
      const ref = 'refs/heads/agents/engineering/t1'
      let wasInjected = false
      const racingGit = atLiveRef(ref, async () => {
        if (wasInjected) {
          return
        }
        try {
          await readFile(path.join(root, 'a.txt'))
        } catch {
          return
        }
        wasInjected = true
        if (failure === 'io') {
          throw new Error('Synthetic later I/O failure')
        }
        await runGit(['update-ref', ref, base, head], root)
      })
      await expect(
        mergeWithLiveRef(root, base, head, ref, { runGit: racingGit, realPath: teamRealPath }),
      ).rejects.toMatchObject({
        code: failure === 'ref' ? 'refBreach' : 'mergeFailed',
        undo: { files: [{ path: 'a.txt', before: undefined }] },
        rollback: { restored: ['a.txt'], refused: [] },
      })
      expect(wasInjected).toBe(true)
      await expectNoLandedFiles(root)
    },
  )

  it('rolls back landed files when scratch cleanup fails and carries Undo', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, { 'a.txt': 'A\n', 'b.txt': 'B\n' })
    const actual = await vi.importActual<typeof FsPromises>('node:fs/promises')
    const scratchToRemove: string[] = []
    vi.mocked(rm).mockImplementation(async (target, options) => {
      if (path.basename(String(target)).startsWith('muse-team-merge-')) {
        scratchToRemove.push(String(target))
        throw new Error('Synthetic scratch cleanup failure')
      }
      await actual.rm(target, options)
    })
    try {
      await expect(applyTeamMerge(io(), spec(root, base, head))).rejects.toMatchObject({
        code: 'mergeFailed',
        undo: { files: [{ path: 'a.txt' }, { path: 'b.txt' }] },
        rollback: { restored: ['a.txt', 'b.txt'], refused: [] },
      })
      await expectNoLandedFiles(root)
    } finally {
      vi.mocked(rm).mockImplementation(actual.rm)
      for (const target of scratchToRemove) {
        await actual.rm(target, { recursive: true, force: true })
      }
    }
  })

  it.each(['modified', 'deleted', 'added'])(
    'preserves a user edit after derivation of a %s file',
    async (change) => {
      const { root, head: base } = await teamFixtureRepo(runGit)
      const file = change === 'added' ? 'new.txt' : 'shared.txt'
      const head = await taskBranch(root, base, {
        [file]: change === 'deleted' ? undefined : 'branch\n',
      })
      const ref = 'refs/heads/agents/engineering/t1'
      let wasInjected = false
      const racingGit = atLiveRef(ref, async () => {
        if (wasInjected) {
          return
        }
        wasInjected = true
        await writeFile(path.join(root, file), 'late user edit\n')
      })
      await expect(
        mergeWithLiveRef(root, base, head, ref, { runGit: racingGit, realPath: teamRealPath }),
      ).rejects.toMatchObject({ code: 'treeChanged', files: [file], undo: { files: [] } })
      expect(await readFile(path.join(root, file), 'utf8')).toBe('late user edit\n')
    },
  )

  it('reports an Undo read-back mismatch honestly', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, { 'tracked.txt': 'merged\n' })
    const result = await applyTeamMerge(io(), spec(root, base, head))
    const actual = await vi.importActual<typeof FsPromises>('node:fs/promises')
    vi.mocked(rename).mockImplementationOnce(async (source, destination) => {
      await actual.rename(source, destination)
      await writeFile(path.join(root, 'tracked.txt'), 'concurrent writer\n')
    })
    await expectRefusedUndo(root, result.undo, 'concurrent writer\n')
  })

  it('refuses a symlink blob instead of silently changing its file type', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await teamFixtureCommit(runGit, root, base, { link: 'tracked.txt' }, undefined, {
      link: '120000',
    })
    await expect(applyTeamMerge(io(), spec(root, base, head))).rejects.toMatchObject({
      code: 'unsafePath',
      files: ['link'],
    })
    await expect(readFile(path.join(root, 'link'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves private permission bits when adding executable mode', async () => {
    if (process.platform === 'win32') {
      return
    }
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await teamFixtureCommit(
      runGit,
      root,
      base,
      { 'tracked.txt': 'before\n', 'private.txt': 'private\n' },
      undefined,
      { 'tracked.txt': '100755' },
    )
    await chmod(path.join(root, 'tracked.txt'), 0o600)
    const originalUmask = process.umask(0o077)
    try {
      const result = await applyTeamMerge(io(), spec(root, base, head))
      const mergedStat = await stat(path.join(root, 'tracked.txt'))
      expect(mergedStat.mode & 0o777).toBe(0o700)
      const privateStat = await stat(path.join(root, 'private.txt'))
      expect(privateStat.mode & 0o777).toBe(0o600)
      expect(await undoTeamMerge(root, result.undo)).toEqual({
        restored: ['private.txt', 'tracked.txt'],
        refused: [],
      })
      const restoredStat = await stat(path.join(root, 'tracked.txt'))
      expect(restoredStat.mode & 0o777).toBe(0o600)
    } finally {
      process.umask(originalUmask)
    }
  })
})

describe('write-paths', () => {
  it('refuses a file outside them, writing nothing', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, {
      'src/a.ts': 'code\n',
      'docs/ok.md': 'fine\n',
    })
    let failure: unknown
    try {
      await applyTeamMerge(io(), spec(root, base, head, { writePaths: ['docs/'] }))
      expect.unreachable()
    } catch (error: unknown) {
      failure = error
    }
    expect(isTeamMergeError(failure)).toBe(true)
    expect(failure).toMatchObject({ name: 'TeamMergeError', code: 'writePaths' })
    await expect(stat(path.join(root, 'docs', 'ok.md'))).rejects.toThrow()
    await expect(stat(path.join(root, 'src', 'a.ts'))).rejects.toThrow()
  })

  it('merges inside them', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, { 'docs/ok.md': 'fine\n' })
    const result = await applyTeamMerge(io(), spec(root, base, head, { writePaths: ['docs'] }))
    expect(result.written).toEqual(['docs/ok.md'])
  })
})

describe('repair regressions: charter globs', () => {
  it.each(['docs/**', '**/*.md', 'docs/*.{md,txt}'])(
    'honours the charter glob %s',
    async (glob) => {
      const { root, head: base } = await teamFixtureRepo(runGit)
      const head = await taskBranch(root, base, { 'docs/ok.md': 'fine\n' })
      const result = await applyTeamMerge(io(), spec(root, base, head, { writePaths: [glob] }))
      expect(result.written).toEqual(['docs/ok.md'])
    },
  )

  it('does not widen case-sensitive write paths', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, { 'DOCS/ok.md': 'fine\n' })
    await expect(
      applyTeamMerge(io(), spec(root, base, head, { writePaths: ['docs'] })),
    ).rejects.toMatchObject({ code: 'writePaths' })
  })
})

describe('protected paths', () => {
  const protectedChange = { '.vscode/settings.json': '{}\n' }

  it('refuses protected paths until approved, writing nothing', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, {
      'shared.txt': 'one\nTWO\nthree\n',
      ...protectedChange,
    })
    await expect(applyTeamMerge(io(), spec(root, base, head))).rejects.toMatchObject({
      name: 'TeamMergeError',
      code: 'protected',
      files: ['.vscode/settings.json'],
    })
    expect(await readFile(path.join(root, 'shared.txt'), 'utf8')).toBe('one\ntwo\nthree\n')
  })

  it('writes them once approved and reports them', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, protectedChange)
    const result = await applyTeamMerge(io(), spec(root, base, head), { allowProtected: true })
    expect(result.protectedWritten).toEqual(['.vscode/settings.json'])
    expect(await readFile(path.join(root, '.vscode', 'settings.json'), 'utf8')).toBe('{}\n')
  })
})

describe('the breach check', () => {
  it('refuses a moved ref before writing', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, { 'shared.txt': 'one\nTWO\nthree\n' })
    await expect(
      applyTeamMerge(
        io(),
        spec(root, base, head, {
          agentRefs: [
            {
              ref: 'refs/heads/agents/engineering/t1',
              expected: head,
              actual: base,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ name: 'TeamMergeError', code: 'refBreach' })
    expect(await readFile(path.join(root, 'shared.txt'), 'utf8')).toBe('one\ntwo\nthree\n')
  })
})

describe('repair regressions: live refs', () => {
  it('refuses a ref moved during asynchronous planning despite equal preview snapshots', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, { 'shared.txt': 'one\nTWO\nthree\n' })
    const ref = 'refs/heads/agents/engineering/t1'
    const racingGit: typeof runGit = async (args, cwd, input) => {
      const result = await runGit(args, cwd, input)
      if (args[0] === 'diff') {
        await runGit(['update-ref', ref, base, head], root)
      }
      return result
    }
    await expectLiveRefBreach(root, base, head, ref, { runGit: racingGit, realPath: teamRealPath })
  })
})

describe('repair regressions: final write admission', () => {
  it('refuses a ref moved between the live read and final path validation', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, { 'shared.txt': 'changed\n' })
    const ref = 'refs/heads/agents/engineering/t1'
    let canMoveRef = false
    const racingGit: typeof runGit = async (args, cwd, input) => {
      const result = await runGit(args, cwd, input)
      if (args[0] === 'rev-parse' && args[2] === ref) {
        canMoveRef = true
      }
      return result
    }
    const racingRealPath = async (candidate: string): Promise<string> => {
      if (canMoveRef && candidate === path.join(root, 'shared.txt')) {
        canMoveRef = false
        await runGit(['update-ref', ref, base, head], root)
      }
      return await teamRealPath(candidate)
    }
    await expectLiveRefBreach(root, base, head, ref, {
      runGit: racingGit,
      realPath: racingRealPath,
    })
  })
})

describe('planTeamMerge', () => {
  it('previews files, binary and protected flags without writing', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, {
      'shared.txt': 'one\nTWO\nthree\n',
      '.vscode/settings.json': '{}\n',
    })
    const planned = await planTeamMerge(io(), spec(root, base, head))
    expect(planned).toMatchObject([
      { path: '.vscode/settings.json', change: 'added', isProtected: true },
      { path: 'shared.txt', change: 'modified', isBinary: false, isProtected: false },
    ])
    expect(await readFile(path.join(root, 'shared.txt'), 'utf8')).toBe('one\ntwo\nthree\n')
    for (const corrupt of [
      (bytes: Uint8Array) => bytes.subarray(0, -1),
      (bytes: Uint8Array) => Buffer.concat([bytes, Buffer.from('extra')]),
      (bytes: Uint8Array) => Buffer.from(TEXT.decode(bytes).replace(' blob ', ' tree ')),
    ]) {
      const malformedGit: typeof runGit = async (args, cwd, input, env) => {
        const result = await runGit(args, cwd, input, env)
        return args[0] === 'cat-file' ? corrupt(result) : result
      }
      await expect(
        planTeamMerge({ runGit: malformedGit, realPath: teamRealPath }, spec(root, base, head)),
      ).rejects.toMatchObject({ code: 'mergeFailed' })
    }
  })
})

describe('binary files', () => {
  it('conflicts when both sides changed one, keeping the tree’s bytes', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await teamFixtureCommit(runGit, root, base, { 'blob.bin': '\0\u{1}\u{2}' })
    await makeTaskCopy(root, head)
    await writeFile(path.join(root, 'blob.bin'), Buffer.from([0x00, 0x09, 0x09]))
    const result = await applyTeamMerge(io(), spec(root, base, head))
    expect(result.conflicts).toEqual([{ path: 'blob.bin', isBinary: true }])
    expect(await readFile(path.join(root, 'blob.bin'))).toEqual(Buffer.from([0x00, 0x09, 0x09]))
    expect(await readFile(path.join(root, '..', 'task-copy', 'blob.bin'))).toEqual(
      Buffer.from([0x00, 0x01, 0x02]),
    )
  })

  it('takes theirs when only the branch changed one', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const theirs = Buffer.from([0x00, 0x07, 0x07])
    const head = await teamFixtureCommit(runGit, root, base, { 'blob.bin': '\0\u{7}\u{7}' })
    const result = await applyTeamMerge(io(), spec(root, base, head))
    expect(result.conflicts).toEqual([])
    expect(await readFile(path.join(root, 'blob.bin'))).toEqual(Buffer.from(theirs))
  })
})

describe('no repository program', () => {
  let fixture: { root: string; base: string; head: string; canary: string }
  beforeAll(async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const canary = path.join(root, 'canary-fired')
    const program = path.join(root, '..', 'canary.cjs')
    await writeFile(
      program,
      [
        "const fs = require('node:fs')",
        "fs.writeFileSync(process.argv[2], 'fired')",
        "if (process.argv[3] === 'filter') process.stdout.write(fs.readFileSync(0))",
      ].join('\n'),
    )
    // One owned Node program avoids spawning touch and cat through Git's
    // POSIX emulation on Windows. Forward slashes also work in Git's shell.
    const command = [process.execPath, program, canary]
      .map((part) => JSON.stringify(part.replaceAll('\\', '/')))
      .join(' ')
    const filter = `${command} filter`
    await appendFile(
      path.join(root, '.git', 'config'),
      [
        '[filter "canary"]',
        `  clean = ${JSON.stringify(filter)}`,
        `  smudge = ${JSON.stringify(filter)}`,
        '[merge "canary"]',
        '  name = canary merge driver',
        `  driver = ${JSON.stringify(`${command} merge`)}`,
        '[diff "canary"]',
        `  textconv = ${JSON.stringify(`${command} textconv`)}`,
        '',
      ].join('\n'),
    )
    const withAttributes = await teamFixtureCommit(
      runGit,
      root,
      base,
      {
        '.gitattributes': '*.txt filter=canary merge=canary diff=canary\n',
      },
      'refs/heads/main',
    )
    await runGit(['read-tree', '--reset', '-u', 'main'], root)
    const head = await teamFixtureCommit(runGit, root, withAttributes, {
      'shared.txt': 'one\nTWO\nthree\n',
    })
    // The real read-tree checkout fires the smudge filter. A clean merge
    // never needs a task copy; no recursive copy or second checkout here.
    await expect(stat(canary)).resolves.toBeDefined()
    fixture = { root, base: withAttributes, head, canary }
  })

  it('runs no filter, textconv or merge driver', async () => {
    const { root, base, head, canary } = fixture
    await rm(canary, { force: true })
    const result = await applyTeamMerge(io(), spec(root, base, head))
    expect(result.written).toEqual(['shared.txt'])
    expect(await readFile(path.join(root, 'shared.txt'), 'utf8')).toBe('one\nTWO\nthree\n')
    await expect(stat(canary)).rejects.toThrow()
  })
})

describe('executable bit', () => {
  it('follows the branch’s flip', async () => {
    if (process.platform === 'win32') {
      return
    }
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await teamFixtureCommit(
      runGit,
      root,
      base,
      { 'run.sh': '#!/bin/sh\necho hi\n' },
      undefined,
      { 'run.sh': '100755' },
    )
    const result = await applyTeamMerge(io(), spec(root, base, head))
    expect(result.written).toContain('run.sh')
    const { mode } = await stat(path.join(root, 'run.sh'))
    expect(mode & 0o100).not.toBe(0)
  })
})

describe('repair regressions: conflicts and modes', () => {
  it('returns two conflict hunks for rework and lands none of the clean files', async () => {
    const baseText = MULTI_CONFLICT_BASE
    const { root, head: base } = await teamFixtureRepo(runGit, 'before\n', baseText)
    const head = await taskBranch(root, base, {
      'shared.txt': baseText.replace('one', 'theirs-one').replace('two', 'theirs-two'),
      'aaa-clean.txt': 'clean addition\n',
    })
    const ours = baseText.replace('one', 'ours-one').replace('two', 'ours-two')
    await writeFile(path.join(root, 'shared.txt'), ours)
    const result = await applyTeamMerge(io(), spec(root, base, head))
    expect(result.status).toBe('rework')
    expect(result.conflicts).toEqual([{ path: 'shared.txt', isBinary: false }])
    expect(await readFile(path.join(root, 'shared.txt'), 'utf8')).toBe(ours)
    await expect(stat(path.join(root, 'aaa-clean.txt'))).rejects.toThrow()
    const rework = await readFile(path.join(root, '..', 'task-copy', 'shared.txt'), 'utf8')
    expect(rework.match(/<<<<<<</g)).toHaveLength(2)
  })

  it.each([false, true])(
    'merges a mode flip with content changed=%s and restores the mode on Undo',
    async (contentChanged) => {
      if (process.platform === 'win32') {
        return
      }
      const { root, head: base } = await teamFixtureRepo(runGit)
      const head = await teamFixtureCommit(
        runGit,
        root,
        base,
        { 'tracked.txt': contentChanged ? 'changed\n' : 'before\n' },
        undefined,
        { 'tracked.txt': '100755' },
      )
      const result = await applyTeamMerge(io(), spec(root, base, head))
      expect(result.modeChanged).toContain('tracked.txt')
      const mergedStat = await stat(path.join(root, 'tracked.txt'))
      expect(mergedStat.mode & 0o777).toBe(0o755)
      const undone = await undoTeamMerge(root, result.undo)
      expect(undone.refused).toEqual([])
      const restoredStat = await stat(path.join(root, 'tracked.txt'))
      expect(restoredStat.mode & 0o777).toBe(0o644)
      expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('before\n')
    },
  )
})

describe('undoTeamMerge', () => {
  it('restores every file the merge wrote', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, {
      'shared.txt': 'one\nTWO\nthree\n',
      'new.txt': 'added\n',
      'tracked.txt': undefined,
    })
    const result = await applyTeamMerge(io(), spec(root, base, head))
    expect(result.written).toHaveLength(3)
    const undone = await undoTeamMerge(root, result.undo)
    expect(undone).toEqual({
      restored: expect.arrayContaining(['shared.txt', 'new.txt', 'tracked.txt']),
      refused: [],
    })
    expect(await readFile(path.join(root, 'shared.txt'), 'utf8')).toBe('one\ntwo\nthree\n')
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('before\n')
    await expect(stat(path.join(root, 'new.txt'))).rejects.toThrow()
  })

  it.each(['added', 'modified'])(
    'refuses a replaced parent for %s without touching outside bytes',
    async (change) => {
      const { root, head: initial } = await teamFixtureRepo(runGit)
      const base = change === 'modified' ? await commitDocsBase(root, initial) : initial
      const head = await taskBranch(root, base, { 'docs/ok.md': 'merged\n' })
      const result = await applyTeamMerge(io(), spec(root, base, head))
      const outside = await replaceDocsParent(
        root,
        process.platform === 'win32' ? 'junction' : 'dir',
      )
      expect(await undoTeamMerge(root, result.undo)).toEqual({
        restored: [],
        refused: ['docs/ok.md'],
      })
      expect(await readFile(path.join(outside, 'ok.md'), 'utf8')).toBe('merged\n')
    },
  )

  it('refuses Undo after the user changes only the executable mode', async () => {
    if (process.platform === 'win32') {
      return
    }
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, { 'tracked.txt': 'changed\n' })
    const result = await applyTeamMerge(io(), spec(root, base, head))
    await chmod(path.join(root, 'tracked.txt'), 0o755)
    await expectRefusedUndo(root, result.undo, 'changed\n')
  })

  it('refuses a Windows junction ancestor on Undo', async () => {
    if (process.platform !== 'win32') {
      return
    }
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, { 'docs/ok.md': 'merged\n' })
    const result = await applyTeamMerge(io(), spec(root, base, head))
    const outside = await replaceDocsParent(root, 'junction')
    const undone = await undoTeamMerge(root, result.undo)
    expect(undone.refused).toEqual(['docs/ok.md'])
    expect(await readFile(path.join(outside, 'ok.md'), 'utf8')).toBe('merged\n')
  })

  it('refuses a file the user has since edited, restoring the rest', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, {
      'shared.txt': 'one\nTWO\nthree\n',
      'new.txt': 'added\n',
    })
    const result = await applyTeamMerge(io(), spec(root, base, head))
    await writeFile(path.join(root, 'shared.txt'), 'one\nUSER\nthree\n')
    const undone = await undoTeamMerge(root, result.undo)
    expect(undone.restored).toEqual(['new.txt'])
    expect(undone.refused).toEqual(['shared.txt'])
    expect(await readFile(path.join(root, 'shared.txt'), 'utf8')).toBe('one\nUSER\nthree\n')
  })
})

describe('Windows merge paths', () => {
  it.each(['case', 'drive', 'namespace'])(
    'merges and undoes through a %s root alias',
    async (form) => {
      if (process.platform !== 'win32') {
        return
      }
      const { root, head: base } = await teamFixtureRepo(runGit)
      const head = await taskBranch(root, base, {
        'tracked.txt': 'changed\n',
        'docs/ok.md': 'nested\n',
      })
      const alias = teamWindowsPath(root, form)
      const result = await applyTeamMerge(io(), spec(alias, base, head))
      expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('changed\n')
      expect(await undoTeamMerge(alias, result.undo)).toEqual({
        restored: ['docs/ok.md', 'tracked.txt'],
        refused: [],
      })
      expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('before\n')
    },
  )

  it.each(['added', 'modified', 'deleted'])(
    'refuses a junction parent before %s',
    async (change) => {
      if (process.platform !== 'win32') {
        return
      }
      const { root, head: initial } = await teamFixtureRepo(runGit)
      await mkdir(path.join(root, 'docs'))
      const base = change === 'added' ? initial : await commitDocsBase(root, initial)
      // The junction is refused before rework, so no task tree is used.
      const head = await teamFixtureCommit(runGit, root, base, {
        'docs/ok.md': change === 'deleted' ? undefined : 'changed\n',
      })
      await mkdir(path.join(root, 'docs'), { recursive: true })
      const outside = await replaceDocsParent(root, 'junction')
      if (change === 'added') {
        await unlink(path.join(outside, 'ok.md'))
      } else {
        await writeFile(path.join(outside, 'ok.md'), 'before\n')
      }
      await writeFile(path.join(outside, 'sentinel'), 'safe\n')
      await expect(applyTeamMerge(io(), spec(root, base, head))).rejects.toMatchObject({
        code: 'linkEscape',
      })
      if (change === 'added') {
        await expect(readFile(path.join(outside, 'ok.md'))).rejects.toMatchObject({
          code: 'ENOENT',
        })
      } else {
        expect(await readFile(path.join(outside, 'ok.md'), 'utf8')).toBe('before\n')
      }
      expect(await readFile(path.join(outside, 'sentinel'), 'utf8')).toBe('safe\n')
      expect(await revOf(root, 'main')).toBe(base)
    },
  )

  it('refuses an 8.3 root alias without overwriting the file', async () => {
    if (process.platform !== 'win32') {
      return
    }
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, { 'tracked.txt': 'changed\n' })
    const shortRoot = await teamShortRoot(root)
    if (shortRoot === undefined) {
      return // The volume did not report an 8.3 name.
    }
    await expect(applyTeamMerge(io(), spec(shortRoot, base, head))).rejects.toMatchObject({
      code: 'linkEscape',
    })
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('before\n')
  })

  it.each(['same', 'inside', 'around'])(
    'refuses a %s rework root across namespace spellings',
    async (position) => {
      if (process.platform !== 'win32') {
        return
      }
      const { root, head: base } = await teamFixtureRepo(runGit)
      const head = await taskBranch(root, base, { 'shared.txt': 'one\nTHEIRS\nthree\n' })
      const ours = 'one\nOURS\nthree\n'
      await writeFile(path.join(root, 'shared.txt'), ours)
      let taskFolder = root
      if (position === 'inside') {
        taskFolder = path.join(root, 'docs')
      } else if (position === 'around') {
        taskFolder = path.dirname(root)
      }
      await expect(
        applyTeamMerge(io(), spec(path.toNamespacedPath(root), base, head, { taskFolder })),
      ).rejects.toMatchObject({ code: 'mergeFailed' })
      expect(await readFile(path.join(root, 'shared.txt'), 'utf8')).toBe(ours)
    },
  )
})
