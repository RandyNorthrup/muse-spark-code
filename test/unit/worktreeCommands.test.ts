import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PickItem } from '../../src/host/commands/pickItem'
import {
  newWorktree,
  removeWorktree,
  type WorktreeDeps,
} from '../../src/host/commands/worktreeCommands'
import { processGitRunner } from '../../src/host/git'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'

// The real git, as the extension runs it (git.ts): these tests make and
// remove real worktrees in a throwaway repository.
const realGit = processGitRunner()
const REAL_GIT_TIMEOUT_MS = 60_000

// realpath: macOS's tmpdir is a symlink, and git reports resolved paths.
const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'muse-worktrees-')))
const repo = path.join(base, 'app')

function git(args: readonly string[], cwd = repo): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@e.x', ...args], {
    cwd,
    encoding: 'utf8',
  })
}

beforeAll(async () => {
  await mkdir(repo)
  git(['init', '-q', '-b', 'main'])
  await writeFile(path.join(repo, 'a.txt'), 'a\n')
  git(['add', 'a.txt'])
  git(['commit', '-q', '-m', 'first'])
  git(['branch', 'release'])
}, REAL_GIT_TIMEOUT_MS)

afterAll(async () => {
  await removeFolder(base)
})

interface HarnessOptions {
  readonly workspaceRoot?: string | undefined
  readonly isTrusted?: boolean
  /** What the input box returns; undefined dismisses it. */
  readonly branch?: string | undefined
  /** Each pick's answer, in order; a function sees the rows. */
  readonly picks?: readonly (string | undefined | ((items: readonly PickItem[]) => string))[]
  readonly confirms?: readonly boolean[]
  readonly opens?: boolean
}

function harness(options: HarnessOptions = {}) {
  const validations: (string | undefined)[] = []
  const shownPicks: (readonly PickItem[])[] = []
  const confirmations: [string, string, string][] = []
  const opened: string[] = []
  const information: string[] = []
  const warnings: string[] = []
  const errors: string[] = []
  const picks = [...(options.picks ?? [])]
  const confirms = [...(options.confirms ?? [])]
  const deps: WorktreeDeps = {
    workspaceRoot: 'workspaceRoot' in options ? options.workspaceRoot : repo,
    platform: process.platform,
    isWorkspaceTrusted: () => options.isTrusted ?? true,
    runGit: realGit,
    pathExists: existsSync,
    askBranchName: async (validate) => {
      if (!('branch' in options) || options.branch === undefined) {
        return undefined
      }
      validations.push(await validate(options.branch))
      return options.branch
    },
    pick: (items) => {
      shownPicks.push(items)
      const next = picks.shift()
      return Promise.resolve(typeof next === 'function' ? next(items) : next)
    },
    confirm: (message, detail, action) => {
      confirmations.push([message, detail, action])
      return Promise.resolve(confirms.shift() ?? false)
    },
    offerOpen: () => Promise.resolve(options.opens ?? true),
    openFolder: (fsPath) => {
      opened.push(fsPath)
      return Promise.resolve()
    },
    showInformation: (message) => {
      information.push(message)
    },
    showWarning: (message) => {
      warnings.push(message)
    },
    showError: (message) => {
      errors.push(message)
    },
    log: new FakeLogOutputChannel(),
  }
  return {
    deps,
    validations,
    shownPicks,
    confirmations,
    opened,
    information,
    warnings,
    errors,
  }
}

const worktreesFolder = () => path.join(base, 'app.worktrees')

/** The row of the worktree on branch `dirty`. */
function pickDirty(items: readonly PickItem[]): string {
  return items.find((item) => item.label === 'dirty')?.id ?? ''
}

// Each flow runs git several times; a loaded Windows machine needs longer
// than the default 5 s, as the other real-process suites do (toolIo, processTree).
describe('newWorktree against a real repository', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('creates the branch in a folder beside the repository and opens it', async () => {
    const t = harness({ branch: 'feature/login', picks: ['release'] })
    await newWorktree(t.deps)
    expect(t.validations).toEqual([undefined])
    expect(t.shownPicks[0]?.map((item) => [item.id, item.description])).toEqual([
      ['HEAD', 'current branch: main'],
      ['release', undefined],
    ])
    const folder = path.join(worktreesFolder(), 'feature-login')
    expect(t.errors).toEqual([])
    expect(t.opened).toEqual([folder])
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], folder).trim()).toBe('feature/login')
    expect(git(['rev-parse', 'feature/login']).trim()).toBe(git(['rev-parse', 'release']).trim())
  })

  it('refuses a name git rejects, a branch that exists, and a folder already there', async () => {
    const invalid = harness({ branch: 'bad..name' })
    await newWorktree(invalid.deps)
    expect(invalid.validations).toEqual(['git does not accept that as a branch name.'])
    const taken = harness({ branch: 'release' })
    await newWorktree(taken.deps)
    expect(taken.validations).toEqual(['A branch with that name already exists.'])
    const blank = harness({ branch: '  ' })
    await newWorktree(blank.deps)
    expect(blank.validations).toEqual(['Type a branch name.'])
    await mkdir(path.join(worktreesFolder(), 'squatter'), { recursive: true })
    const occupied = harness({ branch: 'squatter', picks: ['HEAD'] })
    await newWorktree(occupied.deps)
    expect(occupied.errors).toEqual([
      `That folder already exists: ${path.join(worktreesFolder(), 'squatter')}`,
    ])
  })

  it('stops on dismissals, reports git’s own failure, and leaves opening to the user', async () => {
    const noName = harness({})
    await newWorktree(noName.deps)
    expect(noName.shownPicks).toEqual([])
    const noBase = harness({ branch: 'nobase', picks: [undefined] })
    await newWorktree(noBase.deps)
    expect(existsSync(path.join(worktreesFolder(), 'nobase'))).toBe(false)
    const badBase = harness({ branch: 'badbase', picks: ['no-such-ref'] })
    await newWorktree(badBase.deps)
    expect(badBase.errors[0]).toMatch(/^git could not create the worktree: .*no-such-ref/)
    const closed = harness({ branch: 'quiet', picks: ['HEAD'], opens: false })
    await newWorktree(closed.deps)
    expect(closed.opened).toEqual([])
    expect(existsSync(path.join(worktreesFolder(), 'quiet'))).toBe(true)
  })

  it('needs a trusted workspace inside a repository', async () => {
    const none = harness({ workspaceRoot: undefined })
    await newWorktree(none.deps)
    expect(none.warnings).toEqual(['Open a folder in a git repository first.'])
    const untrusted = harness({ isTrusted: false })
    await newWorktree(untrusted.deps)
    expect(untrusted.warnings[0]).toMatch(
      /^Worktrees need git, which does not run in Restricted Mode/,
    )
    const outside = await mkdtemp(path.join(tmpdir(), 'muse-not-a-repo-'))
    try {
      const notRepo = harness({ workspaceRoot: outside, branch: 'x' })
      await newWorktree(notRepo.deps)
      expect(notRepo.errors[0]).toMatch(
        /^This workspace is not in a git repository: .*not a git repository/i,
      )
    } finally {
      await removeFolder(outside)
    }
  })
})

describe('removeWorktree against a real repository', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('lists every linked worktree but this window’s, and removes one after a yes', async () => {
    git(['worktree', 'add', '-q', '-b', 'to-remove', path.join(worktreesFolder(), 'to-remove')])
    const folder = path.join(worktreesFolder(), 'to-remove')
    const t = harness({
      picks: [(items) => items.find((item) => item.label === 'to-remove')?.id ?? ''],
      confirms: [true],
    })
    await removeWorktree(t.deps)
    const listed = t.shownPicks[0]?.map((item) => item.label) ?? []
    expect(listed).toContain('to-remove')
    expect(listed).not.toContain('main')
    expect(t.confirmations[0]).toEqual([
      'Remove this worktree? Its folder is deleted.',
      `${folder}\nThe branch stays: to-remove`,
      'Remove',
    ])
    expect(existsSync(folder)).toBe(false)
    expect(t.information).toEqual([`Removed the worktree at ${folder}`])
    expect(git(['branch', '--list', 'to-remove']).trim()).not.toBe('')
  })

  it('asks a second time before discarding uncommitted changes', async () => {
    const folder = path.join(worktreesFolder(), 'dirty')
    git(['worktree', 'add', '-q', '-b', 'dirty', folder])
    await writeFile(path.join(folder, 'new.txt'), 'unsaved work\n')
    const declined = harness({ picks: [pickDirty], confirms: [true, false] })
    await removeWorktree(declined.deps)
    expect(declined.confirmations[1]?.[2]).toBe('Remove and discard changes')
    expect(existsSync(folder)).toBe(true)
    const forced = harness({ picks: [pickDirty], confirms: [true, true] })
    await removeWorktree(forced.deps)
    expect(existsSync(folder)).toBe(false)
  })

  it('keeps the worktree open in this window, and says when nothing else is there', async () => {
    const folder = path.join(worktreesFolder(), 'here')
    git(['worktree', 'add', '-q', '-b', 'here', folder])
    const inside = harness({ workspaceRoot: folder, picks: [undefined] })
    await removeWorktree(inside.deps)
    expect(inside.shownPicks[0]?.map((item) => item.label)).not.toContain('here')
    const onlyMain = await mkdtemp(path.join(tmpdir(), 'muse-lonely-'))
    try {
      git(['init', '-q', '-b', 'main'], onlyMain)
      const lonely = harness({ workspaceRoot: onlyMain })
      await removeWorktree(lonely.deps)
      expect(lonely.information).toEqual([
        'There is no other worktree to remove (the main checkout and this window’s own are kept).',
      ])
    } finally {
      await removeFolder(onlyMain)
    }
  })

  it('stops on a dismissed pick or a declined confirmation', async () => {
    const folder = path.join(worktreesFolder(), 'kept')
    git(['worktree', 'add', '-q', '-b', 'kept', folder])
    const dismissed = harness({ picks: [undefined] })
    await removeWorktree(dismissed.deps)
    const declined = harness({
      picks: [(items) => items.find((item) => item.label === 'kept')?.id ?? ''],
      confirms: [false],
    })
    await removeWorktree(declined.deps)
    expect(existsSync(folder)).toBe(true)
  })
})
