// M96d cross-branch advisories: real branches, real merge-bases, the
// landing's own routine (real git merge-file, real table merges). One
// window's changed files are compared against another's; only proven
// conflicts advise, and advisories never block anything.
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import {
  CrossBranchAdvisor,
  type CrossBranchAdvisory,
  type CrossBranchWindowReport,
} from '../../src/core/team/coordinator/advisories'
import { type MergeRoutineDeps, type MergeVersion } from '../../src/core/team/mergeRoutine'
import { mergeChangelog } from '../../src/core/team/merge/changelog'
import { mergeJsonTable } from '../../src/core/team/merge/jsonTable'
import { SharedFiles } from '../../src/core/team/sharedFiles'
import { resolveWorkingGit } from './helpers/realGit'

const workingGit: Promise<string> = resolveWorkingGit()
const GIT = await workingGit

function git(args: readonly string[], cwd: string): string {
  return execFileSync(GIT, [...args], { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
}

function gitBytes(args: readonly string[], cwd: string): Buffer {
  return execFileSync(GIT, [...args], { cwd, encoding: 'buffer', stdio: ['pipe', 'pipe', 'pipe'] })
}

function scratchRepo(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'm96d-advise-'))
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true })
  })
  git(['init', '-b', 'main'], root)
  git(['config', 'user.name', 'Advise'], root)
  git(['config', 'user.email', 'advise@example.invalid'], root)
  return root
}

function commitAll(root: string, message: string): string {
  git(['add', '.'], root)
  git(['commit', '-m', message], root)
  return git(['rev-parse', 'HEAD'], root).trim()
}

/** The real version at a revision, or null when the path is absent there. */
function versionAt(root: string, rev: string, file: string): MergeVersion | null {
  const entry = git(['ls-tree', rev, '--', file], root).trim()
  if (entry === '') return null
  const match = /^(\d+) \w+ ([0-9a-f]+)\t/.exec(entry)
  const mode = match?.[1]
  const sha = match?.[2]
  if (sha === undefined || (mode !== '100644' && mode !== '100755' && mode !== '120000'))
    throw new Error(`unexpected ls-tree for ${file}: ${entry}`)
  return { bytes: gitBytes(['cat-file', '-p', sha], root), mode }
}

function exitStatusOf(error: unknown): number | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
    ? error.status
    : undefined
}

/**
The landing's text merge: pinned conflict style, scratch outside any
repository, exit 0 clean and 1-127 conflict counts. Marker labels
differ (this seam carries no path) but detection is identical. The
structured merges are the real lane-C functions.
*/
function textOf(version: MergeVersion | null): string {
  return version === null ? '' : version.bytes.toString('utf8')
}

function modeOf(input: {
  ours: MergeVersion | null
  theirs: MergeVersion | null
}): MergeVersion['mode'] {
  return input.ours?.mode ?? input.theirs?.mode ?? '100644'
}

function realRoutine(scratch: string): MergeRoutineDeps {
  return {
    jsonTable: (input) => {
      const result = mergeJsonTable(textOf(input.base), textOf(input.ours), textOf(input.theirs))
      return Promise.resolve(
        result.kind === 'merged'
          ? { status: 'clean', file: { bytes: Buffer.from(result.text), mode: modeOf(input) } }
          : { status: 'conflict', markers: null },
      )
    },
    changelog: (input) => {
      const result = mergeChangelog(textOf(input.base), textOf(input.ours), textOf(input.theirs))
      return Promise.resolve(
        result.kind === 'merged'
          ? { status: 'clean', file: { bytes: Buffer.from(result.text), mode: modeOf(input) } }
          : { status: 'conflict', markers: null },
      )
    },
    text: (base, ours, theirs) => {
      const oursTmp = path.join(scratch, 'ours')
      const baseTmp = path.join(scratch, 'base')
      const theirsTmp = path.join(scratch, 'theirs')
      writeFileSync(oursTmp, ours)
      writeFileSync(baseTmp, base)
      writeFileSync(theirsTmp, theirs)
      try {
        execFileSync(
          GIT,
          ['-c', 'merge.conflictstyle=merge', 'merge-file', oursTmp, baseTmp, theirsTmp],
          { cwd: scratch, stdio: ['pipe', 'pipe', 'pipe'] },
        )
      } catch (error: unknown) {
        // NARROW: merge-file counts conflicts 1-127; anything else is real.
        const status = exitStatusOf(error)
        if (status === undefined || status < 1 || status > 127) throw error
        return Promise.resolve({ bytes: readFileSync(oursTmp), conflicts: true })
      }
      return Promise.resolve({ bytes: readFileSync(oursTmp), conflicts: false })
    },
  }
}

function lines(first: number, last: number): string {
  return Array.from(
    { length: last - first + 1 },
    (_, index) => `line${String(first + index)}\n`,
  ).join('')
}

interface AdviseRepo {
  root: string
  scratch: string
  headA: string
  headB: string
}

/** Two real branches over one base, with conflicting and clean changes. */
function adviseRepo(): AdviseRepo {
  const root = scratchRepo()
  const scratch = mkdtempSync(path.join(tmpdir(), 'm96d-advise-merge-'))
  onTestFinished(() => {
    rmSync(scratch, { recursive: true, force: true })
  })
  writeFileSync(path.join(root, 'shared.txt'), lines(1, 10))
  writeFileSync(path.join(root, 'clean.txt'), lines(1, 10))
  writeFileSync(path.join(root, 'notes.txt'), 'notes\n')
  writeFileSync(path.join(root, 'del.txt'), 'delete me\n')
  writeFileSync(path.join(root, 'gonetoo.txt'), 'gone\n')
  writeFileSync(path.join(root, 'bin.dat'), Buffer.from([0, 1, 2, 3]))
  const l10n = path.join(root, 'l10n')
  mkdirSync(l10n, { recursive: true })
  writeFileSync(path.join(l10n, 'ui.json'), '{"k1": "v1", "k2": "v2"}\n')
  writeFileSync(path.join(l10n, 'other.json'), '{"k1": "v1", "k2": "v2"}\n')
  commitAll(root, 'base')
  git(['checkout', '-b', 'branch-a'], root)
  writeFileSync(path.join(root, 'shared.txt'), lines(1, 4) + 'A5\n' + lines(6, 10))
  writeFileSync(path.join(root, 'clean.txt'), 'line1\nA2\n' + lines(3, 10))
  writeFileSync(path.join(l10n, 'ui.json'), '{"k1": "A", "k2": "v2"}\n')
  writeFileSync(path.join(l10n, 'other.json'), '{"k1": "A", "k2": "v2"}\n')
  rmSync(path.join(root, 'del.txt'))
  rmSync(path.join(root, 'gonetoo.txt'))
  writeFileSync(path.join(root, 'bin.dat'), Buffer.from([0, 1, 2, 4]))
  writeFileSync(path.join(root, 'added.txt'), 'A\n')
  const headA = commitAll(root, 'window A')
  git(['checkout', 'main'], root)
  git(['checkout', '-b', 'branch-b'], root)
  writeFileSync(path.join(root, 'shared.txt'), lines(1, 4) + 'B5\n' + lines(6, 10))
  writeFileSync(path.join(root, 'clean.txt'), lines(1, 7) + 'B8\n' + lines(9, 10))
  writeFileSync(path.join(l10n, 'ui.json'), '{"k1": "B", "k2": "v2"}\n')
  writeFileSync(path.join(l10n, 'other.json'), '{"k1": "v1", "k2": "B"}\n')
  writeFileSync(path.join(root, 'notes.txt'), 'notes B\n')
  writeFileSync(path.join(root, 'del.txt'), 'delete me B\n')
  rmSync(path.join(root, 'gonetoo.txt'))
  writeFileSync(path.join(root, 'bin.dat'), Buffer.from([0, 1, 2, 5]))
  writeFileSync(path.join(root, 'added.txt'), 'B\n')
  const headB = commitAll(root, 'window B')
  return { root, scratch, headA, headB }
}

function windowReport(
  root: string,
  windowId: string,
  branch: string,
  head: string,
  files: readonly string[],
): CrossBranchWindowReport {
  return {
    windowId,
    repository: 'repo',
    branch,
    files: new Map(files.map((file) => [file, versionAt(root, head, file)])),
  }
}

describe('M96d cross-branch advisories on real branches', () => {
  it('advises exactly the conflicts the landing routine proves', async () => {
    const repo = adviseRepo()
    const shared = new SharedFiles()
    const seen: CrossBranchAdvisory[] = []
    const advisor = new CrossBranchAdvisor({
      base: (repository, branches, file) => {
        expect(repository).toBe('repo')
        const mergeBase = git(['merge-base', branches[0], branches[1]], repo.root).trim()
        return Promise.resolve(versionAt(repo.root, mergeBase, file))
      },
      routine: realRoutine(repo.scratch),
      shared,
      onAdvisory: (advisory) => {
        seen.push(advisory)
      },
      report: () => {
        throw new Error('unexpected advisory report')
      },
    })
    const windowA = windowReport(repo.root, 'window-a', 'branch-a', repo.headA, [
      'shared.txt',
      'clean.txt',
      'l10n/ui.json',
      'l10n/other.json',
      'del.txt',
      'gonetoo.txt',
      'bin.dat',
      'added.txt',
    ])
    const windowB = windowReport(repo.root, 'window-b', 'branch-b', repo.headB, [
      'shared.txt',
      'clean.txt',
      'l10n/ui.json',
      'l10n/other.json',
      'notes.txt',
      'del.txt',
      'gonetoo.txt',
      'bin.dat',
      'added.txt',
    ])
    await advisor.poll([windowA, windowB])
    expect(
      seen.map((advisory) => advisory.path).toSorted((left, right) => left.localeCompare(right)),
    ).toEqual(['added.txt', 'bin.dat', 'del.txt', 'l10n/ui.json', 'shared.txt'])
    for (const advisory of seen) {
      expect(advisory).toMatchObject({
        repository: 'repo',
        windowId: 'window-a',
        otherWindowId: 'window-b',
        branch: 'branch-a',
        otherBranch: 'branch-b',
      })
    }
    // Disjoint text hunks, by-key tables, single-sided paths and a
    // double delete stay silent: only proven conflicts advise.
    expect(seen.some((advisory) => advisory.path === 'clean.txt')).toBe(false)
    expect(seen.some((advisory) => advisory.path === 'l10n/other.json')).toBe(false)
    expect(seen.some((advisory) => advisory.path === 'notes.txt')).toBe(false)
    expect(seen.some((advisory) => advisory.path === 'gonetoo.txt')).toBe(false)
    // A repeat poll advises nothing new: the conflicts are all seen.
    await advisor.poll([windowA, windowB])
    expect(seen).toHaveLength(5)
    // Resolving one clears it; re-breaking it fires again.
    const resolved = new Map(windowB.files)
    resolved.set('shared.txt', versionAt(repo.root, repo.headA, 'shared.txt'))
    await advisor.poll([windowA, { ...windowB, files: resolved }])
    expect(seen).toHaveLength(5)
    await advisor.poll([windowA, windowB])
    expect(seen).toHaveLength(6)
    expect(seen.at(-1)).toMatchObject({ path: 'shared.txt' })
  })
})

function stubVersion(text: string): MergeVersion {
  return { bytes: Buffer.from(text), mode: '100644' }
}

describe('M96d cross-branch advisory scope', () => {
  it('compares only other branches of the same repository', async () => {
    const routineCalls: string[] = []
    // The stub routine conflicts on every call: any comparison shows.
    const routine: MergeRoutineDeps = {
      jsonTable: (input) => {
        routineCalls.push(`table:${input.path}`)
        return Promise.resolve({ status: 'conflict', markers: null })
      },
      changelog: (input) => {
        routineCalls.push(`log:${input.path}`)
        return Promise.resolve({ status: 'conflict', markers: null })
      },
      text: () => {
        routineCalls.push('text')
        return Promise.resolve({ bytes: Buffer.from('x'), conflicts: true })
      },
    }
    const seen: CrossBranchAdvisory[] = []
    const advisor = new CrossBranchAdvisor({
      base: () => Promise.resolve(stubVersion('base')),
      routine,
      shared: new SharedFiles(),
      onAdvisory: (advisory) => {
        seen.push(advisory)
      },
      report: () => {
        throw new Error('unexpected advisory report')
      },
    })
    const filesA = new Map<string, MergeVersion | null>([['notes.txt', stubVersion('a')]])
    const filesB = new Map<string, MergeVersion | null>([['notes.txt', stubVersion('b')]])
    // Same repository but the same branch: not another branch, no compare.
    await advisor.poll([
      { windowId: 'w1', repository: 'repo', branch: 'main', files: filesA },
      { windowId: 'w2', repository: 'repo', branch: 'main', files: filesB },
    ])
    expect(routineCalls).toEqual([])
    expect(seen).toEqual([])
    // Same paths, another repository: never compared.
    await advisor.poll([
      { windowId: 'w1', repository: 'repo-a', branch: 'a', files: filesA },
      { windowId: 'w2', repository: 'repo-b', branch: 'b', files: filesB },
    ])
    expect(routineCalls).toEqual([])
    expect(seen).toEqual([])
    // Another branch of the same repository: compared, and it conflicts.
    await advisor.poll([
      { windowId: 'w1', repository: 'repo', branch: 'a', files: filesA },
      { windowId: 'w2', repository: 'repo', branch: 'b', files: filesB },
    ])
    expect(routineCalls).toEqual(['text'])
    expect(seen).toEqual([
      {
        repository: 'repo',
        windowId: 'w1',
        otherWindowId: 'w2',
        branch: 'a',
        otherBranch: 'b',
        path: 'notes.txt',
      },
    ])
  })

  it('routes each path through the shared-file table', async () => {
    const kinds: string[] = []
    const routine: MergeRoutineDeps = {
      jsonTable: (input) => {
        kinds.push(`table:${input.path}`)
        return Promise.resolve({ status: 'clean', file: input.ours })
      },
      changelog: (input) => {
        kinds.push(`log:${input.path}`)
        return Promise.resolve({ status: 'clean', file: input.ours })
      },
      text: () => {
        kinds.push('text')
        return Promise.resolve({ bytes: Buffer.from('x'), conflicts: false })
      },
    }
    const advisor = new CrossBranchAdvisor({
      base: () => Promise.resolve(stubVersion('base')),
      routine,
      shared: new SharedFiles(),
      onAdvisory: () => {
        throw new Error('unexpected advisory')
      },
      report: () => {
        throw new Error('unexpected advisory report')
      },
    })
    const left = new Map<string, MergeVersion | null>([
      ['l10n/ui.json', stubVersion('ours')],
      ['CHANGELOG.md', stubVersion('ours')],
      ['notes.txt', stubVersion('changed-ours')],
    ])
    const right = new Map<string, MergeVersion | null>([
      ['l10n/ui.json', stubVersion('theirs')],
      ['CHANGELOG.md', stubVersion('theirs')],
      ['notes.txt', stubVersion('changed-theirs')],
    ])
    await advisor.poll([
      { windowId: 'w1', repository: 'repo', branch: 'a', files: left },
      { windowId: 'w2', repository: 'repo', branch: 'b', files: right },
    ])
    expect(kinds).toEqual(['table:l10n/ui.json', 'log:CHANGELOG.md', 'text'])
  })

  it('stays silent on unknown bases and refused merges', async () => {
    const seen: CrossBranchAdvisory[] = []
    let routineCalls = 0
    const advisor = new CrossBranchAdvisor({
      base: () => Promise.resolve(undefined),
      routine: {
        jsonTable: (input) => Promise.resolve({ status: 'clean', file: input.ours }),
        changelog: (input) => Promise.resolve({ status: 'clean', file: input.ours }),
        text: () => {
          routineCalls += 1
          return Promise.resolve({ bytes: Buffer.from('x'), conflicts: false })
        },
      },
      shared: new SharedFiles(),
      onAdvisory: (advisory) => {
        seen.push(advisory)
      },
      report: () => {
        throw new Error('unexpected advisory report')
      },
    })
    const files = new Map<string, MergeVersion | null>([['notes.txt', stubVersion('a')]])
    // No base, no proof: the routine never runs and nothing advises.
    await advisor.poll([
      { windowId: 'w1', repository: 'repo', branch: 'a', files },
      { windowId: 'w2', repository: 'repo', branch: 'b', files },
    ])
    expect(routineCalls).toBe(0)
    expect(seen).toEqual([])
    // A refused merge proves no conflict either.
    const refusing = new CrossBranchAdvisor({
      base: () => Promise.resolve(stubVersion('base')),
      routine: {
        jsonTable: () => Promise.resolve({ status: 'refused', reason: 'too big' }),
        changelog: (input) => Promise.resolve({ status: 'clean', file: input.ours }),
        text: () => Promise.resolve({ bytes: Buffer.from('x'), conflicts: false }),
      },
      shared: new SharedFiles(),
      onAdvisory: (advisory) => {
        seen.push(advisory)
      },
      report: () => {
        throw new Error('unexpected advisory report')
      },
    })
    const tables = new Map<string, MergeVersion | null>([['l10n/ui.json', stubVersion('a')]])
    await refusing.poll([
      { windowId: 'w1', repository: 'repo', branch: 'a', files: tables },
      { windowId: 'w2', repository: 'repo', branch: 'b', files: tables },
    ])
    expect(seen).toEqual([])
  })

  it('lets a repeated window report supersede its earlier one', async () => {
    const seen: CrossBranchAdvisory[] = []
    const advisor = new CrossBranchAdvisor({
      base: () => Promise.resolve(stubVersion('base')),
      routine: {
        jsonTable: () => Promise.resolve({ status: 'conflict', markers: null }),
        changelog: () => Promise.resolve({ status: 'conflict', markers: null }),
        text: () => Promise.resolve({ bytes: Buffer.from('x'), conflicts: true }),
      },
      shared: new SharedFiles(),
      onAdvisory: (advisory) => {
        seen.push(advisory)
      },
      report: () => {
        throw new Error('unexpected advisory report')
      },
    })
    const full = new Map<string, MergeVersion | null>([['notes.txt', stubVersion('a')]])
    const empty = new Map<string, MergeVersion | null>()
    const other: CrossBranchWindowReport = {
      windowId: 'w2',
      repository: 'repo',
      branch: 'b',
      files: new Map<string, MergeVersion | null>([['notes.txt', stubVersion('b')]]),
    }
    // The later empty report wins: no shared path, no advisory.
    await advisor.poll([
      { windowId: 'w1', repository: 'repo', branch: 'a', files: full },
      { windowId: 'w1', repository: 'repo', branch: 'a', files: empty },
      other,
    ])
    expect(seen).toEqual([])
    // And the reverse order advises: the later full report wins.
    await advisor.poll([
      { windowId: 'w1', repository: 'repo', branch: 'a', files: empty },
      { windowId: 'w1', repository: 'repo', branch: 'a', files: full },
      other,
    ])
    expect(seen.map((advisory) => advisory.path)).toEqual(['notes.txt'])
  })

  it('posts poll failures to the owner instead of dropping them', async () => {
    const reported: unknown[] = []
    const advisor = new CrossBranchAdvisor({
      base: () => Promise.reject(new Error('base exploded')),
      routine: {
        jsonTable: (input) => Promise.resolve({ status: 'clean', file: input.ours }),
        changelog: (input) => Promise.resolve({ status: 'clean', file: input.ours }),
        text: () => Promise.resolve({ bytes: Buffer.from('x'), conflicts: false }),
      },
      shared: new SharedFiles(),
      onAdvisory: () => {
        throw new Error('unexpected advisory')
      },
      report: (error) => {
        reported.push(error)
      },
    })
    const files = new Map<string, MergeVersion | null>([['notes.txt', stubVersion('a')]])
    await advisor.pollGuarded([
      { windowId: 'w1', repository: 'repo', branch: 'a', files },
      { windowId: 'w2', repository: 'repo', branch: 'b', files },
    ])
    expect(reported).toHaveLength(1)
  })
})
