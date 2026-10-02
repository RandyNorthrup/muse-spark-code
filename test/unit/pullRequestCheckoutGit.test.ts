// M71's "Open a pull request in a conversation" against real git: a local
// repository plays GitHub's side (its `refs/pull/51/head`), the fetch runs
// real `git fetch` as VS Code's git extension would, and the extension's own
// git adds the worktree, detached at the pull request's head, in a folder
// under the extension's storage that does not exist yet.

import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GitHubClient } from '../../src/core/git/github'
import {
  heldWorktreeFolder,
  heldWorktreesRoot,
  holdFor,
} from '../../src/core/worktreeConversations'
import { worktreeAddDetachedArgs } from '../../src/core/worktrees'
import { posixQuoted } from '../../src/core/shellQuote'
import { processGitRunner } from '../../src/host/git'
import { captureGitOwner, type GitRepository } from '../../src/host/git/gitExtension'
import { openPullRequestInConversation } from '../../src/host/git/pullRequestCheckout'
import { WorktreeRegistry } from '../../src/host/git/worktreeRegistry'
import { FakeLogOutputChannel } from './helpers/fakes'
import { checkoutNotices, memoryMemento } from './helpers/fakeGit'
import { FAKE_GITHUB_BASE, FAKE_GITHUB_TOKEN, fakeGitHub } from './helpers/fakeGitHub'
import { CAPTURED_PULL_FORK } from './helpers/githubCapture'
import { removeFolder } from './helpers/temporaryFolders'
import { UI_TEXT } from '../../src/shared/constants'

// Each step starts git; a loaded Windows machine needs longer than 5 s.
const REAL_GIT_TIMEOUT_MS = 60_000
const REPOSITORY = { owner: 'RandyNorthrup', name: 'muse-spark-code' }

// Only owned canaries participate, independent of a developer's global programs.
const gitEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
}
const git = processGitRunner({ env: gitEnv })
const untrustedGit = processGitRunner({ isUntrustedCheckout: true, env: gitEnv })
/** The folders and the pull request's head, set up once for the suite. */
const fixture = { base: '', origin: '', work: '', headSha: '', hookMarker: '' }

/** git's output, trimmed. */
async function gitOutput(args: readonly string[], cwd: string): Promise<string> {
  const output = await git(args, cwd)
  return output.trim()
}

function unused(): Promise<never> {
  return Promise.reject(new Error('not used by the checkout'))
}

/** The same destination-only configuration for the native attribute witnesses. */
async function configureSmudgeFilters(
  include: string,
  names: readonly string[],
  program: string,
  marker: string,
): Promise<void> {
  for (const name of names) {
    const command = [process.execPath, program, name, marker]
      .map((arg) => posixQuoted(arg.replaceAll('\\', '/')))
      .join(' ')
    await git(['config', '--file', include, `filter.${name}.smudge`, command], fixture.work)
    await git(['config', '--file', include, `filter.${name}.required`, 'true'], fixture.work)
  }
}

beforeAll(async () => {
  fixture.base = await mkdtemp(path.join(tmpdir(), 'muse-m71-pr-'))
  const { base } = fixture
  fixture.hookMarker = path.join(base, 'pr-hook-ran.txt')
  const origin = path.join(base, 'origin')
  const work = path.join(base, 'work')
  fixture.origin = origin
  fixture.work = work
  await git(['init', '-q', '-b', 'main', origin], base)
  await git(['config', 'core.autocrlf', 'false'], origin)
  await git(['config', 'commit.gpgSign', 'false'], origin)
  for (const [key, value] of [
    ['user.email', 'test@example.invalid'],
    ['user.name', 'Muse Spark test'],
  ] as const) {
    await git(['config', key, value], origin)
  }
  await writeFile(path.join(origin, 'a.txt'), 'one\n')
  await git(['add', 'a.txt'], origin)
  await git(['commit', '-q', '-m', 'first'], origin)
  await git(['clone', '-q', origin, work], base)
  await git(['config', 'core.autocrlf', 'false'], work)
  // Someone else's change, where GitHub keeps a pull request's head.
  await git(['checkout', '-q', '-b', 'contrib'], origin)
  await writeFile(path.join(origin, 'a.txt'), 'two\n')
  const hooks = path.join(origin, '.githooks')
  await mkdir(hooks)
  const hook = path.join(hooks, 'post-checkout')
  const quotedMarker = posixQuoted(fixture.hookMarker.replaceAll('\\', '/'))
  await writeFile(hook, `#!/bin/sh\nprintf ran > ${quotedMarker}\n`)
  await chmod(hook, 0o755)
  await writeFile(
    path.join(origin, '.gitattributes'),
    'payload.dat filter=canary\n[attr]foreign filter=macro-canary\nmacro.dat foreign\n',
  )
  await writeFile(path.join(origin, 'payload.dat'), 'stored filter input\n')
  await writeFile(path.join(origin, 'exotic.dat'), 'exotic stored input\n')
  await writeFile(path.join(origin, 'macro.dat'), 'macro input\n')
  await mkdir(path.join(origin, 'nested'))
  await writeFile(
    path.join(origin, 'nested', '.gitattributes'),
    'payload.dat filter=nested-canary\n',
  )
  await writeFile(path.join(origin, 'nested', 'payload.dat'), 'nested input\n')
  await writeFile(
    path.join(origin, '.filter-canary.cjs'),
    "require('node:fs').appendFileSync(process.argv[3],process.argv[2]+'\\n');if(process.argv[2]==='process')process.exit(1);process.stdin.pipe(process.stdout);\n",
  )
  await git(['add', '--all'], origin)
  await git(['update-index', '--chmod=+x', '.githooks/post-checkout'], origin)
  await git(['commit', '-q', '-m', 'their change'], origin)
  await git(['config', 'core.hooksPath', '.githooks'], work)
  fixture.headSha = await gitOutput(['rev-parse', 'HEAD'], origin)
  await git(['update-ref', 'refs/pull/51/head', fixture.headSha], origin)
  await git(['checkout', '-q', 'main'], origin)
}, REAL_GIT_TIMEOUT_MS)

afterAll(async () => {
  await removeFolder(fixture.base)
})

/** VS Code's git extension as far as the checkout uses it: a real `git fetch`. */
function extensionRepository(): GitRepository {
  const { work } = fixture
  return {
    rootUri: { fsPath: work },
    state: {
      HEAD: { name: 'main' },
      // The URL names the GitHub repository; the fetch reads the clone's own origin.
      remotes: [
        { name: 'origin', fetchUrl: 'https://github.com/RandyNorthrup/muse-spark-code.git' },
      ],
      indexChanges: [],
      workingTreeChanges: [],
      untrackedChanges: [],
    },
    status: () => Promise.resolve(),
    fetch: async (options) => {
      await git(['fetch', '-q', options.remote, options.ref], work)
    },
    diff: unused,
    commit: unused,
    push: unused,
    log: unused,
    diffBetween: unused,
  }
}

async function checkout(storageName: string, headSha = fixture.headSha) {
  const { base, work } = fixture
  const storage = path.join(base, storageName)
  const folder = heldWorktreeFolder(storage, REPOSITORY, 51, process.platform)
  // Git's checkout working directory differs by implementation. An absolute
  // path to the PR's hook plus its owned marker proves actual execution.
  await git(['config', 'core.hooksPath', path.join(folder, '.githooks')], work)
  await rm(fixture.hookMarker, { force: true })
  const github = fakeGitHub()
  github.answer('GET', '/repos/RandyNorthrup/muse-spark-code/pulls/51', {
    status: 200,
    body: { ...CAPTURED_PULL_FORK, head: { ...CAPTURED_PULL_FORK.head, sha: headSha } },
  })
  const registry = new WorktreeRegistry(memoryMemento(), process.platform, existsSync)
  const opened: string[] = []
  const errors: string[] = []
  await openPullRequestInConversation({
    workspaceRoot: work,
    platform: process.platform,
    isWorkspaceTrusted: () => true,
    isHeld: () => false,
    storageRoot: storage,
    repository: () => Promise.resolve(extensionRepository()),
    captureGitOwner,
    runGit: git,
    runUntrustedGit: untrustedGit,
    admit: (start) => start(),
    githubToken: () => Promise.resolve(FAKE_GITHUB_TOKEN),
    github: new GitHubClient({
      fetch: github.fetch,
      userAgent: 'muse-spark-code/test',
      log: new FakeLogOutputChannel(),
      baseUrl: FAKE_GITHUB_BASE,
    }),
    registry,
    askPullRequest: () => Promise.resolve('#51'),
    confirm: () => Promise.resolve(true),
    pathExists: existsSync,
    openFolder: (folder) => {
      opened.push(folder)
      return Promise.resolve()
    },
    ...checkoutNotices(errors),
    now: () => 1,
    log: new FakeLogOutputChannel(),
  })
  return { storage, registry, opened, errors }
}

describe('a pull request checked out with real git (M71)', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('refuses a real filter name containing equals before checkout while its native canary executes', async () => {
    await git(['fetch', '-q', 'origin', 'pull/51/head'], fixture.work)
    const marker = path.join(fixture.base, 'exotic-filter-ran.txt')
    const program = path.join(fixture.base, 'exotic-pr-program.cjs')
    await writeFile(
      program,
      await git(['show', `${fixture.headSha}:.filter-canary.cjs`], fixture.origin),
    )
    const command = [process.execPath, program, 'smudge', marker]
      .map((arg) => posixQuoted(arg.replaceAll('\\', '/')))
      .join(' ')
    const key = 'filter.canary=unsafe.smudge'
    await git(['config', key, command], fixture.work)
    const attributes = path.join(fixture.work, '.git', 'info', 'attributes')
    await writeFile(attributes, 'exotic.dat filter=canary=unsafe\n')
    try {
      const refused = path.join(fixture.base, 'exotic-refused')
      await expect(
        untrustedGit(worktreeAddDetachedArgs(refused, fixture.headSha), fixture.work),
      ).rejects.toThrow(UI_TEXT.openPullRequestFiltersUnavailable)
      expect(existsSync(refused)).toBe(false)
      expect(existsSync(marker)).toBe(false)
      const control = path.join(fixture.base, 'exotic-native-control')
      await git(
        ['-c', 'core.hooksPath=/dev/null', ...worktreeAddDetachedArgs(control, fixture.headSha)],
        fixture.work,
      )
      expect(await readFile(marker, 'utf8')).toContain('smudge\n')
    } finally {
      await git(['config', '--unset-all', key], fixture.work)
      await rm(attributes)
    }
  })

  it('disables destination-only conditional filters selected by foreign tree attributes and macros', async () => {
    await git(['fetch', '-q', 'origin', 'pull/51/head'], fixture.work)
    const marker = path.join(fixture.base, 'conditional-filter-ran.txt')
    const program = path.join(fixture.base, 'conditional-pr-program.cjs')
    await writeFile(
      program,
      await git(['show', `${fixture.headSha}:.filter-canary.cjs`], fixture.origin),
    )
    const include = path.join(fixture.base, 'destination-filters.config')
    const directory = await gitOutput(['rev-parse', '--absolute-git-dir'], fixture.work)
    const kind = process.platform === 'win32' ? 'gitdir/i' : 'gitdir'
    const condition = `includeIf.${kind}:${directory.replaceAll('\\', '/')}/worktrees/.path`
    await configureSmudgeFilters(
      include,
      ['canary', 'macro-canary', 'nested-canary'],
      program,
      marker,
    )
    await git(['config', condition, include], fixture.work)
    try {
      expect(await git(['config', '--name-only', '--list'], fixture.work)).not.toContain(
        'filter.canary.smudge',
      )
      expect(existsSync(path.join(fixture.work, '.gitattributes'))).toBe(false)
      const folder = path.join(fixture.base, 'conditional-held')
      await untrustedGit(worktreeAddDetachedArgs(folder, fixture.headSha), fixture.work)
      expect(existsSync(marker)).toBe(false)
      expect(await readFile(path.join(folder, 'macro.dat'), 'utf8')).toBe('macro input\n')
      const control = path.join(fixture.base, 'conditional-control')
      await git(
        ['-c', 'core.hooksPath=/dev/null', ...worktreeAddDetachedArgs(control, fixture.headSha)],
        fixture.work,
      )
      const ran = await readFile(marker, 'utf8')
      for (const name of ['canary', 'macro-canary', 'nested-canary'])
        expect(ran).toContain(`${name}\n`)
    } finally {
      await git(['config', '--unset-all', condition], fixture.work)
    }
  })

  it.each(['configured', 'empty-XDG'])(
    'disables filters from info and effective global attributes without changing their bytes (%s)',
    async (mode) => {
      await git(['fetch', '-q', 'origin', 'pull/51/head'], fixture.work)
      const info = path.join(fixture.work, '.git', 'info', 'attributes')
      // Use a portable Windows name; POSIX also witnesses significant trailing spaces.
      const configured = path.join(
        fixture.base,
        process.platform === 'win32' ? ' global.attributes' : ' global.attributes ',
      )
      const profile = path.join(fixture.base, 'attribute-profile')
      const global =
        mode === 'configured' ? configured : path.join(profile, '.config', 'git', 'attributes')
      await mkdir(path.dirname(global), { recursive: true })
      const attributeEnv = { ...gitEnv, HOME: profile, XDG_CONFIG_HOME: '' }
      const guarded = processGitRunner({ isUntrustedCheckout: true, env: attributeEnv })
      const controlGit = processGitRunner({ env: attributeEnv })
      const label = `local-attributes-${mode}`
      const marker = path.join(fixture.base, `${label}-ran.txt`)
      const program = path.join(fixture.base, 'attributes-program.cjs')
      await writeFile(
        program,
        await git(['show', `${fixture.headSha}:.filter-canary.cjs`], fixture.origin),
      )
      await writeFile(info, '[attr]shared filter=shared-canary\nexotic.dat shared\n')
      await writeFile(global, 'a.txt filter=global-canary\n')
      const directory = await gitOutput(['rev-parse', '--absolute-git-dir'], fixture.work)
      const kind = process.platform === 'win32' ? 'gitdir/i' : 'gitdir'
      const condition = `includeIf.${kind}:${directory.replaceAll('\\', '/')}/worktrees/.path`
      const include = path.join(fixture.base, 'attributes-filters.config')
      await configureSmudgeFilters(include, ['shared-canary', 'global-canary'], program, marker)
      await git(['config', condition, include], fixture.work)
      if (mode === 'configured') await git(['config', 'core.attributesFile', global], fixture.work)
      const original = await Promise.all([readFile(info), readFile(global)])
      try {
        const folder = path.join(fixture.base, `${label}-held`)
        await guarded(worktreeAddDetachedArgs(folder, fixture.headSha), fixture.work)
        expect(existsSync(marker)).toBe(false)
        expect(await Promise.all([readFile(info), readFile(global)])).toEqual(original)
        const control = path.join(fixture.base, `${label}-control`)
        await controlGit(
          ['-c', 'core.hooksPath=/dev/null', ...worktreeAddDetachedArgs(control, fixture.headSha)],
          fixture.work,
        )
        const ran = await readFile(marker, 'utf8')
        expect(ran).toContain('shared-canary\n')
        expect(ran).toContain('global-canary\n')
      } finally {
        await git(['config', '--unset-all', condition], fixture.work)
        if (mode === 'configured')
          await git(['config', '--unset-all', 'core.attributesFile'], fixture.work)
        await rm(info)
      }
    },
  )

  it.each(['clean', 'smudge', 'process'] as const)(
    'disables the configured required %s filter while native positive control executes the PR program',
    async (lane) => {
      const label = `filter-${lane}`
      const storage = path.join(fixture.base, label)
      const folder = heldWorktreeFolder(storage, REPOSITORY, 51, process.platform)
      const marker = path.join(fixture.base, `${label}-ran.txt`)
      const program = path.join(fixture.base, `${label}-pr-program.cjs`)
      // Exact executable bytes from the PR, at an absolute owned fixture path;
      // a missing relative program must never make a negative canary look safe.
      await writeFile(
        program,
        await git(['show', `${fixture.headSha}:.filter-canary.cjs`], fixture.origin),
      )
      const command = [process.execPath, program, lane, marker]
        .map((arg) => posixQuoted(arg.replaceAll('\\', '/')))
        .join(' ')
      await git(['config', `filter.canary.${lane}`, command], fixture.work)
      await git(['config', 'filter.canary.required', 'true'], fixture.work)
      try {
        const negative = await checkout(label)
        expect(existsSync(marker)).toBe(false)
        expect(negative.errors).toEqual([])
        expect(negative.opened).toEqual([folder])
        expect(await readFile(path.join(folder, 'payload.dat'), 'utf8')).toBe(
          'stored filter input\n',
        )
        expect(negative.registry.recordFor(folder)?.isHeld).toBe(true)
        if (lane === 'clean') {
          await writeFile(path.join(folder, 'payload.dat'), 'changed unfiltered input\n')
          await untrustedGit(['add', 'payload.dat'], folder)
          expect(existsSync(marker)).toBe(false)
          expect(await git(['show', ':payload.dat'], folder)).toBe('changed unfiltered input\n')
        }
        const control = path.join(fixture.base, `${label}-native-control`)
        // A clean-only required driver has no checkout smudge direction.
        // First create its positive-control worktree without requiring smudge,
        // then require the configured clean driver for the real native add.
        if (lane === 'clean') await git(['config', 'filter.canary.required', 'false'], fixture.work)
        const adding = git(
          ['-c', 'core.hooksPath=/dev/null', ...worktreeAddDetachedArgs(control, fixture.headSha)],
          fixture.work,
        )
        if (lane === 'process') await expect(adding).rejects.toThrow()
        else await adding
        if (lane === 'clean') {
          await git(['config', 'filter.canary.required', 'true'], fixture.work)
          await writeFile(path.join(control, 'payload.dat'), 'changed clean input\n')
          await git(['add', 'payload.dat'], control)
        }
        expect(await readFile(marker, 'utf8')).toContain(`${lane}\n`)
      } finally {
        await git(['config', '--unset-all', `filter.canary.${lane}`], fixture.work)
        await git(['config', '--unset-all', 'filter.canary.required'], fixture.work)
      }
    },
  )

  it('fetches its head and adds a detached worktree under the extension storage, held, without PR hooks', async () => {
    const { work, headSha } = fixture
    const { storage, registry, opened, errors } = await checkout('storage')
    const folder = heldWorktreeFolder(storage, REPOSITORY, 51, process.platform)
    expect(errors).toEqual([])
    expect(opened).toEqual([folder])
    expect(await gitOutput(['rev-parse', 'HEAD'], folder)).toBe(headSha)
    // Detached: no branch was made in the user's repository for it.
    expect(await gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'], folder)).toBe('HEAD')
    expect(await gitOutput(['branch', '--list'], work)).toBe('* main')
    expect(existsSync(path.join(folder, '.githooks', 'post-checkout'))).toBe(true)
    expect(existsSync(fixture.hookMarker)).toBe(false)
    expect(
      holdFor(
        [folder],
        [heldWorktreesRoot(storage, process.platform)],
        registry.records(),
        process.platform,
      ),
    ).toMatchObject({ folder, pullRequest: { number: 51, headSha } })
  })

  it('refuses a stale approved commit already present in the source repository', async () => {
    const commitPeel = '^{commit}'
    const oldHead = await gitOutput(['rev-parse', 'HEAD'], fixture.work)
    expect(oldHead).not.toBe(fixture.headSha)
    await git(['cat-file', '-e', `${oldHead}${commitPeel}`], fixture.work)
    const { registry, opened, errors } = await checkout('storage-stale', oldHead)
    expect(errors.at(-1)).toContain('could not be fetched')
    expect(registry.records()).toEqual([])
    expect(opened).toEqual([])
  })

  it('proves the PR hook canary executes when native checkout hooks are enabled', async () => {
    const folder = path.join(fixture.base, 'native-hook-control')
    await git(['config', 'core.hooksPath', path.join(folder, '.githooks')], fixture.work)
    await rm(fixture.hookMarker, { force: true })
    await git(['fetch', '-q', 'origin', 'pull/51/head'], fixture.work)
    await git(worktreeAddDetachedArgs(folder, fixture.headSha), fixture.work)
    expect(existsSync(fixture.hookMarker)).toBe(true)
    await rm(fixture.hookMarker, { force: true })
  })
})
