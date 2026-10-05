// Lane I's merge (PLAN.md D75, M96 acceptance 19): the per-file three-way
// merge with `git merge-file`, conflicts, protected paths, the
// `write-paths` check, the breach check, and Undo merge. Real temporary
// repositories; no model calls.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyTeamMerge,
  isTeamMergeError,
  planTeamMerge,
  undoTeamMerge,
  type TeamMergeIo,
  type TeamMergeSpec,
} from '../../src/core/team/teamMerge'
import { cleanupTeamRoots, teamFixtureRepo, teamGitRunner, teamRealPath } from './helpers/teamGit'

const runGit = teamGitRunner()
cleanupTeamRoots()
const TEXT = new TextDecoder()

function io(): TeamMergeIo {
  return { runGit, realPath: teamRealPath }
}

async function revOf(repo: string, rev: string): Promise<string> {
  return TEXT.decode(await runGit(['rev-parse', rev], repo)).trim()
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
  await runGit(['checkout', '-qb', 'agents/engineering/t1', base], root)
  for (const [name, content] of Object.entries(files)) {
    const absolute = path.join(root, name)
    if (content === undefined) {
      await runGit(['rm', '-q', name], root)
      continue
    }
    await mkdir(path.dirname(absolute), { recursive: true })
    await writeFile(absolute, content)
  }
  await runGit(['add', '--all'], root)
  await runGit(['commit', '-qm', 'task change'], root)
  const head = await revOf(root, 'agents/engineering/t1')
  await runGit(['checkout', '-q', 'main'], root)
  return head
}

function spec(root: string, base: string, head: string, extra = {}): TeamMergeSpec {
  return { repositoryRoot: root, baseCommit: base, branchHead: head, agentRefs: [], ...extra }
}

describe('applyTeamMerge', () => {
  it('merges the branch change cleanly', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, { 'shared.txt': 'one\nTWO\nthree\n' })
    const result = await applyTeamMerge(io(), spec(root, base, head))
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

  it('writes a conflict with markers and lists it', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    const head = await taskBranch(root, base, { 'shared.txt': 'one\nTHEIRS\nthree\n' })
    await writeFile(path.join(root, 'shared.txt'), 'one\nOURS\nthree\n')
    const result = await applyTeamMerge(io(), spec(root, base, head))
    expect(result.written).toEqual([])
    expect(result.conflicts).toEqual([{ path: 'shared.txt', isBinary: false }])
    const merged = await readFile(path.join(root, 'shared.txt'), 'utf8')
    expect(merged).toContain('<<<<<<<')
    expect(merged).toContain('>>>>>>>')
    expect(merged).toContain('OURS')
    expect(merged).toContain('THEIRS')
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
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toContain('modified')
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
  })
})

describe('binary files', () => {
  it('conflicts when both sides changed one, keeping the tree’s bytes', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    await runGit(['checkout', '-qb', 'agents/engineering/t1', base], root)
    await writeFile(path.join(root, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02]))
    await runGit(['add', '--all'], root)
    await runGit(['commit', '-qm', 'binary theirs'], root)
    const head = await revOf(root, 'agents/engineering/t1')
    await runGit(['checkout', '-q', 'main'], root)
    await writeFile(path.join(root, 'blob.bin'), Buffer.from([0x00, 0x09, 0x09]))
    const result = await applyTeamMerge(io(), spec(root, base, head))
    expect(result.conflicts).toEqual([{ path: 'blob.bin', isBinary: true }])
    expect(await readFile(path.join(root, 'blob.bin'))).toEqual(Buffer.from([0x00, 0x09, 0x09]))
  })

  it('takes theirs when only the branch changed one', async () => {
    const { root, head: base } = await teamFixtureRepo(runGit)
    await runGit(['checkout', '-qb', 'agents/engineering/t1', base], root)
    const theirs = Buffer.from([0x00, 0x07, 0x07])
    await writeFile(path.join(root, 'blob.bin'), theirs)
    await runGit(['add', '--all'], root)
    await runGit(['commit', '-qm', 'binary theirs'], root)
    const head = await revOf(root, 'agents/engineering/t1')
    await runGit(['checkout', '-q', 'main'], root)
    const result = await applyTeamMerge(io(), spec(root, base, head))
    expect(result.conflicts).toEqual([])
    expect(await readFile(path.join(root, 'blob.bin'))).toEqual(Buffer.from(theirs))
  })
})

describe('no repository program', () => {
  it('runs no filter, textconv or merge driver', async () => {
    const { root } = await teamFixtureRepo(runGit)
    const canary = path.join(root, 'canary-fired')
    await runGit(['config', 'filter.canary.clean', `touch "${canary}" && cat`], root)
    await runGit(['config', 'filter.canary.smudge', `touch "${canary}" && cat`], root)
    await runGit(['config', 'merge.canary.name', 'canary merge driver'], root)
    await runGit(
      ['config', 'merge.canary.driver', `touch "${canary}" && cat "%A" > "%A" && exit 0`],
      root,
    )
    await runGit(['config', 'diff.canary.textconv', `touch "${canary}"`], root)
    await writeFile(
      path.join(root, '.gitattributes'),
      '*.txt filter=canary merge=canary diff=canary\n',
    )
    await runGit(['add', '--', '.gitattributes'], root)
    await runGit(['commit', '-qm', 'attributes'], root)
    const withAttributes = await revOf(root, 'main')
    // The setup's own checkouts and adds fire the filter, and `add --all`
    // would sweep the canary file into the branch: commit only the file the
    // task changes, and clear the canary after the setup.
    await runGit(['checkout', '-qb', 'agents/engineering/t1', withAttributes], root)
    const { rm } = await import('node:fs/promises')
    await rm(canary, { force: true })
    await writeFile(path.join(root, 'shared.txt'), 'one\nTWO\nthree\n')
    await runGit(['add', '--', 'shared.txt'], root)
    await runGit(['commit', '-qm', 'task change'], root)
    const head = await revOf(root, 'agents/engineering/t1')
    await runGit(['checkout', '-q', 'main'], root)
    await rm(canary, { force: true })
    await applyTeamMerge(io(), spec(root, withAttributes, head))
    await expect(stat(canary)).rejects.toThrow()
  })
})

describe('executable bit', () => {
  it('follows the branch’s flip', async () => {
    if (process.platform === 'win32') {
      return
    }
    const { root, head: base } = await teamFixtureRepo(runGit)
    await runGit(['checkout', '-qb', 'agents/engineering/t1', base], root)
    await writeFile(path.join(root, 'run.sh'), '#!/bin/sh\necho hi\n')
    await runGit(['add', '--all'], root)
    const { chmod } = await import('node:fs/promises')
    await chmod(path.join(root, 'run.sh'), 0o755)
    await runGit(['add', '--all'], root)
    await runGit(['commit', '-qm', 'script'], root)
    const head = await revOf(root, 'agents/engineering/t1')
    await runGit(['checkout', '-q', 'main'], root)
    const result = await applyTeamMerge(io(), spec(root, base, head))
    expect(result.written).toContain('run.sh')
    const { mode } = await stat(path.join(root, 'run.sh'))
    expect(mode & 0o100).not.toBe(0)
  })
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
