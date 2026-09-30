// `/review`'s material from real git (M70, PLAN.md D49): a throwaway
// repository, driven through the collector the extension builds (the
// review's git options, the pickers), so every preset reads what git really
// prints: the uncommitted changes, a branch against its base, one commit.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PickItem } from '../../src/host/commands/pickItem'
import { processGitRunner } from '../../src/host/git'
import {
  createReviewCollector,
  type ReviewCollection,
  reviewMarker,
} from '../../src/host/review/reviewCollector'
import {
  REVIEW_DIFF_MAX_CHARS,
  REVIEW_FILTER_NAME_MAX_CHARS,
  REVIEW_FILTER_NAMES_MAX,
  REVIEW_MARKER_BYTES,
} from '../../src/shared/constants'
import { removeFolder } from './helpers/temporaryFolders'
import { aliasedReviewRepositories } from './helpers/reviewRoots'

const REAL_GIT_TIMEOUT_MS = 60_000
const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-review-')))

function git(cwd: string, args: readonly string[]): string {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@e.x',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.autocrlf=false',
      ...args,
    ],
    { cwd, encoding: 'utf8' },
  )
}

async function repository(name: string): Promise<string> {
  const folder = path.join(base, name)
  await mkdir(folder)
  git(folder, ['init', '-q', '-b', 'main'])
  git(folder, ['config', 'core.autocrlf', 'false'])
  return folder
}

async function commitFile(folder: string, file: string, text: string, message: string) {
  await mkdir(path.dirname(path.join(folder, file)), { recursive: true })
  await writeFile(path.join(folder, file), text)
  git(folder, ['add', file])
  git(folder, ['commit', '-q', '-m', message])
}

function collector(folder: string, pick: (items: readonly PickItem[]) => string | undefined) {
  const pickOne = vi.fn((items: readonly PickItem[]) => Promise.resolve(pick(items)))
  const collect = createReviewCollector({
    workspaceRoot: folder,
    runGit: processGitRunner(),
    pickOne,
  })
  return {
    pickOne,
    collect: (request: Parameters<typeof collect>[0]) => collect(request, () => true),
  }
}

function material(collection: ReviewCollection) {
  if (collection.kind !== 'material') {
    throw new Error(`expected material, got ${JSON.stringify(collection)}`)
  }
  return collection.material
}

const repo = path.join(base, 'app')

beforeAll(async () => {
  await repository('app')
  await commitFile(repo, 'src/a.ts', 'export const a = 1\n', 'first')
  git(repo, ['branch', 'feature'])
  await commitFile(repo, 'src/b.ts', 'export const b = 2\n', 'second: add b')
  git(repo, ['checkout', '-q', 'feature'])
  await commitFile(repo, 'src/c.ts', 'export const c = 3\n', 'third: add c on feature')
}, REAL_GIT_TIMEOUT_MS)

afterAll(async () => {
  await removeFolder(base)
})

describe('the uncommitted changes', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('diffs staged and unstaged changes against HEAD, names untracked files, and leaves out files that may hold secrets', async () => {
    const folder = await repository('dirty')
    await commitFile(folder, 'src/a.ts', 'export const a = 1\n', 'first')
    await commitFile(folder, '.env', 'TOKEN=old\n', 'env')
    await writeFile(path.join(folder, 'src/a.ts'), 'export const a = 2\n')
    await writeFile(path.join(folder, 'staged.ts'), 'staged\n')
    git(folder, ['add', 'staged.ts'])
    await writeFile(path.join(folder, 'new.ts'), 'untracked\n')
    await writeFile(path.join(folder, '.env'), 'TOKEN=sk-live-secret\n')
    await mkdir(path.join(folder, 'keys'))
    await writeFile(path.join(folder, 'keys', 'server.PEM'), 'PRIVATE KEY\n')
    const found = material(
      await collector(folder, () => undefined).collect({ scope: 'uncommitted', focus: 'general' }),
    )
    expect(found.subject).toEqual({ kind: 'uncommitted', hasCommits: true })
    expect(found.diff).toContain('+export const a = 2')
    expect(found.diff).toContain('+staged')
    // The secret never leaves: not in the diff, not in the lists but by name.
    expect(found.diff).not.toContain('sk-live-secret')
    expect(found.diff).not.toContain('TOKEN')
    expect(found.changedFiles).toEqual(['M\tsrc/a.ts', 'A\tstaged.ts'])
    expect(found.untracked).toEqual(['new.ts'])
    expect(found.privateFiles.toSorted((left, right) => left.localeCompare(right))).toEqual([
      '.env',
      'keys/server.PEM',
    ])
    expect(found.fullLength).toBeUndefined()
  })

  it('reads a repository with no commit yet: what is staged, then what changed since', async () => {
    const folder = await repository('unborn')
    await writeFile(path.join(folder, 'first.ts'), 'one\n')
    git(folder, ['add', 'first.ts'])
    await writeFile(path.join(folder, 'first.ts'), 'one\ntwo\n')
    const found = material(
      await collector(folder, () => undefined).collect({ scope: 'uncommitted', focus: 'general' }),
    )
    expect(found.subject).toEqual({ kind: 'uncommitted', hasCommits: false })
    expect(found.diff).toContain('+one')
    expect(found.diff).toContain('+two')
  })

  it('refuses a clean tree, a tree where only secrets changed, and a folder outside git, with no material', async () => {
    const clean = await repository('clean')
    await commitFile(clean, 'a.ts', 'a\n', 'first')
    const { collect } = collector(clean, () => undefined)
    expect(await collect({ scope: 'uncommitted', focus: 'general' })).toEqual({
      kind: 'refused',
      refusal: 'noChanges',
    })
    await writeFile(path.join(clean, '.env.production'), 'KEY=1\n')
    expect(await collect({ scope: 'uncommitted', focus: 'security' })).toEqual({
      kind: 'refused',
      refusal: 'onlyPrivate',
    })
    const outside = await mkdtemp(path.join(tmpdir(), 'muse-review-outside-'))
    try {
      expect(
        await collector(outside, () => undefined).collect({
          scope: 'uncommitted',
          focus: 'general',
        }),
      ).toEqual({
        kind: 'refused',
        refusal: 'notRepository',
      })
    } finally {
      await removeFolder(outside)
    }
  })

  it('cuts a long diff after its last whole line and says how long it was', async () => {
    const folder = await repository('long')
    await commitFile(folder, 'big.txt', '', 'empty')
    const line = `${'x'.repeat(99)}\n`
    await writeFile(
      path.join(folder, 'big.txt'),
      line.repeat(Math.ceil(REVIEW_DIFF_MAX_CHARS / 100) + 10),
    )
    const found = material(
      await collector(folder, () => undefined).collect({ scope: 'uncommitted', focus: 'general' }),
    )
    expect(found.diff.length).toBeLessThanOrEqual(REVIEW_DIFF_MAX_CHARS)
    expect(found.diff.endsWith('\n')).toBe(true)
    expect(found.fullLength).toBeGreaterThan(REVIEW_DIFF_MAX_CHARS)
  })
})

describe('a branch against its base', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('diffs from the merge base, so the base branch’s own later commits are not the branch’s', async () => {
    const found = material(
      await collector(repo, () => undefined).collect({
        scope: 'branch',
        focus: 'general',
        base: 'main',
      }),
    )
    expect(found.subject).toMatchObject({ kind: 'branch', branch: 'feature', base: 'main' })
    expect(found.diff).toContain('+export const c = 3')
    expect(found.diff).not.toContain('export const b')
  })

  it('asks for the base with the default one first, and a dismissed picker is a cancel', async () => {
    let offered: readonly PickItem[] = []
    const picking = collector(repo, (items) => {
      offered = items
      return 'main'
    })
    const found = material(await picking.collect({ scope: 'branch', focus: 'general' }))
    expect(offered[0]).toMatchObject({ id: 'main', label: 'main' })
    expect(offered.map((item) => item.id)).toContain('feature')
    expect(found.subject).toMatchObject({ base: 'main' })
    const dismissed = collector(repo, () => undefined)
    expect(await dismissed.collect({ scope: 'branch', focus: 'general' })).toEqual({
      kind: 'cancelled',
    })
  })

  it('refuses a base git does not know, and one that would read as an option', async () => {
    const { collect } = collector(repo, () => undefined)
    expect(await collect({ scope: 'branch', focus: 'general', base: 'no-such-branch' })).toEqual({
      kind: 'refused',
      refusal: 'unknownRevision',
      revision: 'no-such-branch',
    })
    // The request schema refuses it before; git never sees it either.
    expect(await collect({ scope: 'branch', focus: 'general', base: '--output=x' })).toMatchObject({
      kind: 'refused',
      refusal: 'unknownRevision',
    })
  })
})

describe('one commit', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('diffs a commit against its parent, with its message, and lists the latest commits to pick from', async () => {
    let offered: readonly PickItem[] = []
    const { collect } = collector(repo, (items) => {
      offered = items
      return items[0]?.id
    })
    const found = material(await collect({ scope: 'commit', focus: 'general' }))
    expect(offered.map((item) => item.description)).toEqual(['third: add c on feature', 'first'])
    expect(found.subject).toMatchObject({ kind: 'commit', message: 'third: add c on feature' })
    expect(found.diff).toContain('+export const c = 3')
    expect(found.diff).not.toContain('export const a')
    expect(found.untracked).toEqual([])
  })

  it('reads a root commit whole', async () => {
    const root = git(repo, ['rev-list', '--max-parents=0', 'HEAD']).trim()
    const found = material(
      await collector(repo, () => undefined).collect({
        scope: 'commit',
        focus: 'general',
        commit: root,
      }),
    )
    expect(found.diff).toContain('+export const a = 1')
    expect(found.changedFiles).toEqual(['A\tsrc/a.ts'])
  })

  it('refuses a commit git does not know', async () => {
    expect(
      await collector(repo, () => undefined).collect({
        scope: 'commit',
        focus: 'general',
        commit: 'deadbeef',
      }),
    ).toEqual({ kind: 'refused', refusal: 'unknownRevision', revision: 'deadbeef' })
  })
})

describe('review collection ownership and trust', () => {
  it('runs no git after collection admission was withdrawn', async () => {
    const runGit = vi.fn(() => Promise.resolve('true\n'))
    const collect = createReviewCollector({ workspaceRoot: base, runGit, pickOne: vi.fn() })
    await expect(collect({ scope: 'uncommitted', focus: 'general' }, () => false)).resolves.toEqual(
      {
        kind: 'cancelled',
      },
    )
    expect(runGit).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'checks actual git admission after a held base picker: allowed=%s',
    async (isKeptAllowed) => {
      const folder = await repository(`picker-owner-${String(isKeptAllowed)}`)
      await commitFile(folder, 'a.ts', 'export const a = 1\n', 'base')
      git(folder, ['checkout', '-q', '-b', 'feature'])
      await commitFile(folder, 'a.ts', 'export const a = 2\n', 'change')
      const entered = Promise.withResolvers<undefined>()
      const picked = Promise.withResolvers<string | undefined>()
      const runGit = vi.fn(processGitRunner())
      const collect = createReviewCollector({
        workspaceRoot: folder,
        runGit,
        pickOne: () => {
          entered.resolve(undefined)
          return picked.promise
        },
      })
      let isAllowed = true
      const collecting = collect({ scope: 'branch', focus: 'general' }, () => isAllowed)
      await entered.promise
      const callsBeforeChoice = runGit.mock.calls.length
      isAllowed = isKeptAllowed
      picked.resolve('main')
      const found = await collecting
      if (isKeptAllowed) {
        expect(found.kind).toBe('material')
        expect(material(found).diff).toContain('+export const a = 2')
        expect(runGit.mock.calls.length).toBeGreaterThan(callsBeforeChoice)
      } else {
        expect(found).toEqual({ kind: 'cancelled' })
        expect(runGit).toHaveBeenCalledTimes(callsBeforeChoice)
      }
    },
  )

  it('starts no subsequent git call after a running git query loses its owner', async () => {
    const query = Promise.withResolvers<string>()
    const runGit = vi.fn(() => query.promise)
    const collect = createReviewCollector({ workspaceRoot: base, runGit, pickOne: vi.fn() })
    let isAllowed = true
    const collecting = collect({ scope: 'uncommitted', focus: 'general' }, () => isAllowed)
    await vi.waitFor(() => {
      expect(runGit).toHaveBeenCalledOnce()
    })
    isAllowed = false
    query.resolve('true\n')
    await expect(collecting).resolves.toEqual({ kind: 'cancelled' })
    expect(runGit).toHaveBeenCalledOnce()
  })
})

describe('physical review request ownership', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it.each([
    { scope: 'branch', change: 'unchanged' },
    { scope: 'branch', change: 'retarget' },
    { scope: 'branch', change: 'replacement' },
    { scope: 'commit', change: 'unchanged' },
    { scope: 'commit', change: 'retarget' },
    { scope: 'commit', change: 'replacement' },
  ] as const)(
    'keeps physical ownership through a held $scope picker, change=$change',
    async ({ scope, change }) => {
      const roots = await aliasedReviewRepositories(base, `picker-${scope}-${change}`)
      const entered = Promise.withResolvers<readonly PickItem[]>()
      const picked = Promise.withResolvers<string | undefined>()
      const runGit = vi.fn(processGitRunner())
      const collect = createReviewCollector({
        workspaceRoot: roots.alias,
        runGit,
        pickOne: (items) => {
          entered.resolve(items)
          return picked.promise
        },
      })
      const collecting = collect({ scope, focus: 'general' }, () => true)
      const choices = await entered.promise
      const callsBeforeChoice = runGit.mock.calls.length
      if (change === 'retarget') {
        roots.retarget()
      } else if (change === 'replacement') {
        await roots.replace()
      }
      picked.resolve(choices[0]?.id)
      const result = await collecting
      expect(runGit.mock.calls.every(([, cwd]) => cwd === roots.first)).toBe(true)
      if (change === 'unchanged') {
        expect(material(result).diff).toContain('OWNED_A_EDIT')
        expect(material(result).diff).not.toContain('OWNED_B_EDIT')
        expect(result.kind === 'material' && result.isCurrent()).toBe(true)
      } else {
        expect(result).toEqual({ kind: 'cancelled' })
        expect(runGit).toHaveBeenCalledTimes(callsBeforeChoice)
      }
    },
  )

  it.each(['retarget', 'replacement'] as const)(
    'discards an awaited native Git result after physical root %s',
    async (change) => {
      const roots = await aliasedReviewRepositories(base, `git-${change}`)
      const entered = Promise.withResolvers<undefined>()
      const release = Promise.withResolvers<undefined>()
      const native = processGitRunner()
      const runGit = vi.fn(async (...args: Parameters<typeof native>) => {
        const output = await native(...args)
        if (args[0].includes('diff') && !args[0].includes('--name-status')) {
          entered.resolve(undefined)
          await release.promise
        }
        return output
      })
      const collect = createReviewCollector({
        workspaceRoot: roots.alias,
        runGit,
        pickOne: vi.fn(),
      })
      const collecting = collect({ scope: 'uncommitted', focus: 'general' }, () => true)
      await entered.promise
      const beforeChange = runGit.mock.calls.length
      if (change === 'retarget') {
        roots.retarget()
      } else {
        await roots.replace()
      }
      release.resolve(undefined)
      expect(await collecting).toEqual({ kind: 'cancelled' })
      expect(runGit).toHaveBeenCalledTimes(beforeChange)
      expect(runGit.mock.calls.every(([, cwd]) => cwd === roots.first)).toBe(true)
    },
  )

  it('enters actual Git at its captured canonical cwd even if the alias retargets at runner entry', async () => {
    const roots = await aliasedReviewRepositories(base, 'runner-entry')
    const native = processGitRunner()
    let actualRoot: string | undefined
    const collect = createReviewCollector({
      workspaceRoot: roots.alias,
      runGit: async (...args) => {
        roots.retarget()
        actualRoot = realpathSync.native(args[1])
        return await native(...args)
      },
      pickOne: vi.fn(),
    })
    expect(await collect({ scope: 'uncommitted', focus: 'general' }, () => true)).toEqual({
      kind: 'cancelled',
    })
    expect(actualRoot).toBe(roots.first)
  })

  it('keeps released material bound to its original physical root', async () => {
    const roots = await aliasedReviewRepositories(base, 'released-material')
    const collect = createReviewCollector({
      workspaceRoot: roots.alias,
      runGit: processGitRunner(),
      pickOne: vi.fn(),
    })
    const result = await collect({ scope: 'uncommitted', focus: 'general' }, () => true)
    expect(result.kind).toBe('material')
    if (result.kind !== 'material') {
      throw new Error('expected owned material')
    }
    expect(result.isCurrent()).toBe(true)
    roots.retarget()
    expect(result.isCurrent()).toBe(false)
    unlinkSync(roots.alias)
    symlinkSync(roots.first, roots.alias, process.platform === 'win32' ? 'junction' : 'dir')
    expect(result.isCurrent()).toBe(false)
  })
})

/** Harmless native Git program: its marker proves execution independently of argv. */
async function markerProgram(folder: string, kind: 'clean' | 'process' | 'fsmonitor') {
  const script = path.join(folder, 'review-program.cjs')
  const marker = path.join(folder, 'review-program-marker')
  const behavior = {
    clean: 'process.stdin.pipe(process.stdout)',
    process: 'process.exitCode = 1',
    fsmonitor: String.raw`process.stdout.write(process.argv[3] === '2' ? 'review-token\0/\0' : '/\0')`,
  }[kind]
  await writeFile(
    script,
    `require('node:fs').writeFileSync(process.argv[2], 'called')\n${behavior}\n`,
  )
  return {
    marker,
    command: [process.execPath, script, marker]
      .map((file) => `"${file.replaceAll('\\', '/')}"`)
      .join(' '),
  }
}

describe('review Git programs', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it.each(['clean', 'process'] as const)(
    'suppresses a real configured %s filter and keeps raw worktree changes',
    async (kind) => {
      const folder = await repository(`filter-${kind}`)
      await commitFile(folder, '.gitattributes', 'a.txt filter=reviewProbe\n', 'attributes')
      await commitFile(folder, 'a.txt', 'old\n', 'file')
      const program = await markerProgram(folder, kind)
      git(folder, ['config', `filter.reviewProbe.${kind}`, program.command])
      git(folder, ['config', 'filter.reviewProbe.required', 'true'])
      await writeFile(path.join(folder, 'a.txt'), 'new raw text\n')
      const ordinary = () => git(folder, ['diff', '--no-ext-diff', '--no-textconv', 'HEAD'])
      if (kind === 'clean') {
        expect(ordinary()).toContain('+new raw text')
      } else {
        expect(ordinary).toThrow()
      }
      expect(await readFile(program.marker, 'utf8')).toBe('called')
      await unlink(program.marker)
      const found = material(
        await collector(folder, () => undefined).collect({
          scope: 'uncommitted',
          focus: 'general',
        }),
      )
      expect(found.diff).toContain('+new raw text')
      await expect(readFile(program.marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      // Suppression is per-command; the repository's user's configuration remains intact.
      expect(git(folder, ['config', '--get', `filter.reviewProbe.${kind}`]).trim()).toBe(
        program.command,
      )
    },
  )

  it('refreshes configured filters after a base picker without executing a newly configured program', async () => {
    const folder = await repository('filter-picker')
    await commitFile(folder, '.gitattributes', 'a.txt filter=lateProbe\n', 'attributes')
    await commitFile(folder, 'a.txt', 'old\n', 'file')
    git(folder, ['checkout', '-q', '-b', 'feature'])
    await writeFile(path.join(folder, 'a.txt'), 'after picker\n')
    const program = await markerProgram(folder, 'clean')
    const entered = Promise.withResolvers<undefined>()
    const picked = Promise.withResolvers<string | undefined>()
    const collect = createReviewCollector({
      workspaceRoot: folder,
      runGit: processGitRunner(),
      pickOne: () => {
        entered.resolve(undefined)
        return picked.promise
      },
    })
    const collecting = collect({ scope: 'branch', focus: 'general' }, () => true)
    await entered.promise
    git(folder, ['config', 'filter.lateProbe.clean', program.command])
    git(folder, ['config', 'filter.lateProbe.required', 'true'])
    picked.resolve('main')
    expect(material(await collecting).diff).toContain('+after picker')
    await expect(readFile(program.marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('suppresses an actual fsmonitor hook whose seeded index makes an ordinary status invoke it', async () => {
    const folder = await repository('fsmonitor-hook')
    await commitFile(folder, 'a.txt', 'old\n', 'file')
    const program = await markerProgram(folder, 'fsmonitor')
    git(folder, ['config', 'core.fsmonitor', program.command])
    git(folder, ['update-index', '--fsmonitor'])
    git(folder, ['status', '--porcelain'])
    git(folder, ['status', '--porcelain'])
    expect(await readFile(program.marker, 'utf8')).toBe('called')
    await unlink(program.marker)
    await writeFile(path.join(folder, 'a.txt'), 'changed\n')
    expect(
      material(
        await collector(folder, () => undefined).collect({
          scope: 'uncommitted',
          focus: 'general',
        }),
      ).diff,
    ).toContain('+changed')
    await expect(readFile(program.marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

/** A successful repository diff behind configurable names-only discovery. */
function namesOnlyCollector(names: string | Error) {
  const runGit = vi.fn((args: readonly string[]) => {
    const command = args.find((arg) => !arg.startsWith('-') && !arg.includes('='))
    if (command === 'config') {
      return names instanceof Error ? Promise.reject(names) : Promise.resolve(names)
    }
    if (command === 'rev-parse') {
      return Promise.resolve(
        args.includes('--is-inside-work-tree') ? 'true\n' : '0123456789abcdef\n',
      )
    }
    return Promise.resolve(command === 'diff' && !args.includes('--name-status') ? '+raw\n' : '')
  })
  return {
    runGit,
    collect: createReviewCollector({ workspaceRoot: base, runGit, pickOne: vi.fn() }),
  }
}

describe('bounded names-only filter discovery', () => {
  it('reads no values and overrides clean, process and required for every review command', async () => {
    const t = namesOnlyCollector(
      'filter.Probe.clean\u{0}filter.Probe.process\u{0}filter.Probe.required\u{0}',
    )
    const result = await t.collect({ scope: 'uncommitted', focus: 'general' }, () => true)
    expect(result.kind).toBe('material')
    const queries = t.runGit.mock.calls.filter(([args]) => args.includes('config'))
    expect(queries.length).toBeGreaterThan(0)
    for (const [args] of queries) {
      expect(args).toContain('--name-only')
      expect(args).toContain('--null')
      expect(args).toContain('--get-regexp')
      expect(args).not.toContain('--list')
    }
    const commands = t.runGit.mock.calls.filter(([args]) => !args.includes('config'))
    expect(commands.length).toBeGreaterThan(0)
    for (const [args] of commands) {
      expect(args).toContain('filter.Probe.clean=')
      expect(args).toContain('filter.Probe.process=')
      expect(args).toContain('filter.Probe.required=false')
    }
  })

  it.each([
    'filter.bad=name.clean\u{0}',
    `filter.${'x'.repeat(REVIEW_FILTER_NAME_MAX_CHARS)}.clean\u{0}`,
    Array.from(
      { length: REVIEW_FILTER_NAMES_MAX + 1 },
      (_, index) => `filter.p${String(index)}.clean\u{0}`,
    ).join(''),
    Object.assign(new Error('unreadable configuration'), { code: 'EACCES' }),
  ])(
    'refuses malformed, excessive or unreadable filter discovery before a diff: %s',
    async (names) => {
      const t = namesOnlyCollector(names)
      expect(await t.collect({ scope: 'uncommitted', focus: 'general' }, () => true)).toMatchObject(
        { kind: 'refused', refusal: 'gitFailed' },
      )
      expect(t.runGit.mock.calls.some(([args]) => args.includes('diff'))).toBe(false)
    },
  )

  it('treats only Git no-match exit 1 as an empty filter inventory', async () => {
    const t = namesOnlyCollector(Object.assign(new Error('no matching keys'), { code: 1 }))
    const result = await t.collect({ scope: 'uncommitted', focus: 'general' }, () => true)
    expect(result.kind).toBe('material')
  })
})

describe('reviewMarker', () => {
  it('is fresh random hexadecimal each time', () => {
    const first = reviewMarker()
    expect(first).toMatch(new RegExp(`^[0-9a-f]{${String(REVIEW_MARKER_BYTES * 2)}}$`))
    expect(reviewMarker()).not.toBe(first)
  })
})

describe('a git failure', () => {
  it('is gitFailed, named in the log by its subcommand and exit, never by what git printed', async () => {
    const runGit = vi.fn((args: readonly string[]) => {
      const command = args.find((arg) => !arg.startsWith('-') && !arg.includes('='))
      if (command === 'config') {
        return Promise.resolve('')
      }
      if (command === 'rev-parse' && args.includes('--is-inside-work-tree')) {
        return Promise.resolve('true\n')
      }
      return command === 'rev-parse'
        ? Promise.resolve('0123456789abcdef\n')
        : Promise.reject(
            Object.assign(new Error('fatal: /home/someone/secret-project: bad object'), {
              code: 128,
            }),
          )
    })
    const collect = createReviewCollector({ workspaceRoot: base, runGit, pickOne: vi.fn() })
    const collection = await collect({ scope: 'uncommitted', focus: 'general' }, () => true)
    expect(collection).toEqual({
      kind: 'refused',
      refusal: 'gitFailed',
      failure: 'git diff exited 128',
    })
    // Every call runs with the review's own configuration first.
    expect(runGit.mock.calls[0]?.[0].slice(0, 6)).toEqual([
      '-c',
      'core.fsmonitor=',
      '-c',
      'log.showSignature=false',
      '-c',
      'core.quotePath=false',
    ])
  })
})
