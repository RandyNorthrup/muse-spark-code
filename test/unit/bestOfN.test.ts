// Best-of-N planning (M77, PLAN.md D49): the run's bounds, its branch and
// worktree names, the paid-use shape, and the git shapes around the take.

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { processGitRunner } from '../../src/host/git'
import { worktreeAddArgs, parseWorktreeList } from '../../src/core/worktrees'
import { BEST_OF_N_DIFF_MAX_CHARS } from '../../src/shared/constants'
import {
  bestOfNBranch,
  bestOfNChangedLines,
  bestOfNDiffArgs,
  bestOfNDiffStatArgs,
  bestOfNPaidRequest,
  bestOfNTakeArgs,
  bestOfNWorktreeFolder,
  clipBestOfNDiff,
  isBestOfNRunId,
  parseBestOfNNumstat,
} from '../../src/core/bestOfN/bestOfN'
import { defaultBestOfNRequest, validateBestOfNRequest } from '../../src/shared/bestOfN'

describe('validateBestOfNRequest', () => {
  it('accepts the defaults', () => {
    expect(validateBestOfNRequest(defaultBestOfNRequest('refactor this'))).toEqual([])
  })

  it('refuses a blank prompt', () => {
    expect(
      validateBestOfNRequest({ prompt: ' '.repeat(3), attempts: 3, requestCeilingPerAttempt: 20 }),
    ).toEqual(['prompt'])
  })

  it('accepts any whole-number count of 1 or more (D121: no ceiling of ours)', () => {
    expect(
      validateBestOfNRequest({ prompt: 'go', attempts: 1, requestCeilingPerAttempt: 1 }),
    ).toEqual([])
    expect(
      validateBestOfNRequest({ prompt: 'go', attempts: 201, requestCeilingPerAttempt: 500 }),
    ).toEqual([])
  })

  it('refuses attempt counts below 1 or not whole, in field order', () => {
    for (const attempts of [0, -2, 2.5, NaN]) {
      expect(
        validateBestOfNRequest({ prompt: 'go', attempts, requestCeilingPerAttempt: 20 }),
      ).toEqual(['attempts'])
    }
  })

  it('refuses ceilings below 1 or not whole', () => {
    for (const requestCeilingPerAttempt of [0, -1, 7.5]) {
      expect(
        validateBestOfNRequest({ prompt: 'go', attempts: 3, requestCeilingPerAttempt }),
      ).toEqual(['ceiling'])
    }
  })

  it('reports every bad field at once', () => {
    expect(
      validateBestOfNRequest({ prompt: '', attempts: 0, requestCeilingPerAttempt: 0 }),
    ).toEqual(['prompt', 'attempts', 'ceiling'])
  })
})

describe('bestOfNBranch', () => {
  it('names the attempt branch under the run', () => {
    expect(bestOfNBranch('bon-m1-1', 0)).toBe('best-of-n/bon-m1-1/0')
    expect(bestOfNBranch('bon-m1-1', 4)).toBe('best-of-n/bon-m1-1/4')
  })

  it('refuses run ids that are not one branch segment', () => {
    expect(isBestOfNRunId('bon-m1-1')).toBe(true)
    for (const runId of ['', '../escape', 'a/b', 'has space', '-leading']) {
      expect(isBestOfNRunId(runId)).toBe(false)
      expect(() => bestOfNBranch(runId, 0)).toThrow()
    }
    expect(() => bestOfNBranch('bon-m1-1', -1)).toThrow()
  })

  it('roots the worktree beside the repository like every worktree', () => {
    expect(bestOfNWorktreeFolder('/repo/app', 'bon-m1-1', 2, 'linux')).toBe(
      '/repo/app.worktrees/best-of-n-bon-m1-1-2',
    )
  })
})

describe('bestOfNPaidRequest', () => {
  it('asks once with the prompt, the rates, N and the ceiling', () => {
    expect(bestOfNPaidRequest('muse-spark-1.3', 'refactor this', 3, 20)).toEqual({
      feature: 'bestOfN',
      modelId: 'muse-spark-1.3',
      prompt: 'refactor this',
      attempts: 3,
      requestCeilingPerAttempt: 20,
    })
  })
})

describe('best-of-N with real Git worktrees', () => {
  it('applies the frozen binary tree to the index without committing or following later edits', async () => {
    const tempRoot = path.resolve('temp')
    await mkdir(tempRoot, { recursive: true })
    const folder = await mkdtemp(path.join(tempRoot, 'rlm77-git-'))
    const root = path.join(folder, 'repository')
    const git = processGitRunner()
    // A disposable repository has no external programs: the PC's global LFS
    // drivers otherwise correctly refuse automatic best-of-N operations.
    // This child-only environment changes no user config or repository hook.
    const config = path.join(folder, 'empty.gitconfig')
    await writeFile(config, '')
    const automatic = processGitRunner({
      isAutomatic: true,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config },
    })
    try {
      await git(['init', '-b', 'main', root], folder)
      const original = await readFile(new URL('../../src/shared/bestOfN.ts', import.meta.url))
      const changed = await readFile(new URL('../../src/core/bestOfN/bestOfN.ts', import.meta.url))
      const binary = await readFile(new URL('../../media/icon.png', import.meta.url))
      const ignore = await readFile(new URL('../../.gitignore', import.meta.url))
      await writeFile(path.join(root, 'bestOfN.ts'), original)
      await writeFile(path.join(root, 'icon.png'), binary)
      await writeFile(path.join(root, '.gitignore'), ignore)
      await git(['add', '--all', '--'], root)
      await git(['commit', '-m', 'Capture real repository files for worktree proof'], root)
      const baseOutput = await git(['rev-parse', 'HEAD'], root)
      const base = baseOutput.trim()
      const branch = bestOfNBranch('bon-recovery', 0)
      const worktree = bestOfNWorktreeFolder(root, 'bon-recovery', 0, process.platform)
      await automatic(worktreeAddArgs(worktree, branch, base), root)
      const listed = parseWorktreeList(await git(['worktree', 'list', '--porcelain'], root))
      expect(listed.map((entry) => entry.branch)).toEqual(['main', branch])
      await writeFile(path.join(worktree, 'bestOfN.ts'), changed)
      const changedBinary = Buffer.from(binary).reverse()
      await writeFile(path.join(worktree, 'icon.png'), changedBinary)
      await writeFile(path.join(worktree, 'new.ts'), original)
      await mkdir(path.join(worktree, 'temp'))
      await writeFile(path.join(worktree, 'temp', 'ignored.ts'), original)
      await automatic(['add', '--all', '--'], worktree)
      const treeOutput = await automatic(['write-tree'], worktree)
      const tree = treeOutput.trim()
      const files = parseBestOfNNumstat(await automatic(bestOfNDiffStatArgs(base, tree), root))
      expect(files.map((file) => file.path)).toEqual(['bestOfN.ts', 'icon.png', 'new.ts'])
      expect(files.find((file) => file.path === 'icon.png')).toEqual({
        path: 'icon.png',
        insertions: 0,
        deletions: 0,
      })
      const patch = await automatic(
        ['diff', '--binary', ...bestOfNDiffArgs(base, tree).slice(1)],
        root,
      )
      // The preview is immutable even if the attempt changes after capture.
      await writeFile(path.join(worktree, 'bestOfN.ts'), original)
      await automatic(bestOfNTakeArgs(), root, undefined, patch)
      expect(await readFile(path.join(root, 'bestOfN.ts'))).toEqual(changed)
      expect(await readFile(path.join(root, 'new.ts'))).toEqual(original)
      expect(await readFile(path.join(root, 'icon.png'))).toEqual(changedBinary)
      const appliedTree = await git(['write-tree'], root)
      const currentHead = await git(['rev-parse', 'HEAD'], root)
      const commitCount = await git(['rev-list', '--count', 'HEAD'], root)
      const unstaged = await git(['diff', '--name-only'], root)
      expect(appliedTree.trim()).toBe(tree)
      expect(currentHead.trim()).toBe(base)
      expect(commitCount.trim()).toBe('1')
      expect(unstaged.trim()).toBe('')
      // A changed target is refused, never silently overwritten by a retry.
      await writeFile(path.join(root, 'bestOfN.ts'), original)
      await expect(automatic(bestOfNTakeArgs(), root, undefined, patch)).rejects.toThrow()
      expect(await readFile(path.join(root, 'bestOfN.ts'))).toEqual(original)
      const refusedTree = await git(['write-tree'], root)
      expect(refusedTree.trim()).toBe(tree)
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })
})

describe('best-of-N git shapes', () => {
  it('compares the frozen tree directly against the captured base', () => {
    expect(bestOfNDiffStatArgs('HEAD', 'best-of-n/bon-1/0')).toEqual([
      'diff',
      '--numstat',
      '-z',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      'HEAD',
      'best-of-n/bon-1/0',
      '--',
    ])
    expect(bestOfNDiffArgs('HEAD', 'best-of-n/bon-1/0')).toEqual([
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      'HEAD',
      'best-of-n/bon-1/0',
      '--',
    ])
  })

  it('applies and stages the selected binary patch from stdin', () => {
    expect(bestOfNTakeArgs()).toEqual(['apply', '--index', '--binary', '-'])
  })

  it('parses the numstat, counting binary files as changed without lines', () => {
    expect(parseBestOfNNumstat('3\t1\tsrc/a.ts\n-\t-\tlogo.png\n')).toEqual([
      { path: 'src/a.ts', insertions: 3, deletions: 1 },
      { path: 'logo.png', insertions: 0, deletions: 0 },
    ])
    expect(parseBestOfNNumstat('')).toEqual([])
    expect(bestOfNChangedLines(parseBestOfNNumstat('3\t1\tsrc/a.ts\n2\t0\tsrc/b.ts\n'))).toBe(6)
  })

  it('refuses a stat line that is not added, deleted and path', () => {
    expect(() => parseBestOfNNumstat('no-tabs-here\n')).toThrow()
    expect(() => parseBestOfNNumstat('x\t1\tsrc/a.ts\n')).toThrow()
  })

  it('clips the comparison text at the cap, marked', () => {
    expect(clipBestOfNDiff('short')).toEqual({ text: 'short', isClipped: false })
    const long = 'x'.repeat(BEST_OF_N_DIFF_MAX_CHARS + 1)
    const clipped = clipBestOfNDiff(long)
    expect(clipped.isClipped).toBe(true)
    expect(clipped.text).toHaveLength(BEST_OF_N_DIFF_MAX_CHARS)
  })
})
