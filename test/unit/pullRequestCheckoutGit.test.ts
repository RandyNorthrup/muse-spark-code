// M71's "Open a pull request in a conversation" against real git: a local
// repository plays GitHub's side (its `refs/pull/<n>/head`), the fetch runs
// real `git fetch` as VS Code's git extension would, and someone else's pull
// request is added under the extension's storage with nothing checked out,
// its files written by the extension (heldCheckout.ts). Every negative case
// has a positive control: git's own checkout of the same commit, which runs
// the same canary.

import { existsSync, lstatSync, readdirSync, statSync } from 'node:fs'
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
import { processGitProcess, processGitRunner } from '../../src/host/git'
import { captureGitOwner, type GitRepository } from '../../src/host/git/gitExtension'
import { createHeldCheckout } from '../../src/host/git/heldCheckout'
import { openPullRequestInConversation } from '../../src/host/git/pullRequestCheckout'
import { untrustedGitRunner } from '../../src/host/git/untrustedGit'
import { WorktreeRegistry } from '../../src/host/git/worktreeRegistry'
import { FakeLogOutputChannel } from './helpers/fakes'
import { checkoutNotices, memoryMemento } from './helpers/fakeGit'
import { FAKE_GITHUB_BASE, FAKE_GITHUB_TOKEN, fakeGitHub } from './helpers/fakeGitHub'
import { CAPTURED_PULL_FORK } from './helpers/githubCapture'
import { removeFolder } from './helpers/temporaryFolders'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'

// Each step starts git; a loaded Windows machine needs longer than 5 s.
const REAL_GIT_TIMEOUT_MS = 60_000
const REPOSITORY = { owner: 'RandyNorthrup', name: 'muse-spark-code' }
const IS_NAME_FOLDING = process.platform === 'win32' || process.platform === 'darwin'

// Only owned canaries participate, independent of a developer's global programs.
const gitEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
}
const git = processGitRunner({ env: gitEnv })
const gitWithInput = processGitProcess()
/** The folders and the pull request's head, set up once for the suite. */
const fixture = { base: '', origin: '', work: '', headSha: '', hookMarker: '', program: '' }

/** git's output, trimmed. */
async function gitOutput(args: readonly string[], cwd: string): Promise<string> {
  const output = await git(args, cwd)
  return output.trim()
}

/** git reading `input` on stdin, its output trimmed. */
async function gitInput(args: readonly string[], cwd: string, input: string): Promise<string> {
  const output = await gitWithInput(args, {
    cwd,
    env: gitEnv,
    input,
    timeoutMs: REAL_GIT_TIMEOUT_MS,
  })
  return output.toString('utf8').trim()
}

function unused(): Promise<never> {
  return Promise.reject(new Error('not used by the checkout'))
}

/** Smudge filters named `names`, each appending its name to `marker` when it runs. */
async function configureSmudgeFilters(
  include: string,
  names: readonly string[],
  marker: string,
): Promise<void> {
  for (const name of names) {
    const command = [process.execPath, fixture.program, name, marker]
      .map((arg) => posixQuoted(arg.replaceAll('\\', '/')))
      .join(' ')
    await git(['config', '--file', include, `filter.${name}.smudge`, command], fixture.work)
    await git(['config', '--file', include, `filter.${name}.required`, 'true'], fixture.work)
  }
}

/** The include that applies only inside the repository's linked worktrees. */
async function linkedWorktreeCondition(): Promise<string> {
  const directory = await gitOutput(['rev-parse', '--absolute-git-dir'], fixture.work)
  const kind = process.platform === 'win32' ? 'gitdir/i' : 'gitdir'
  return `includeIf.${kind}:${directory.replaceAll('\\', '/')}/worktrees/.path`
}

/** A commit of exactly these tree records in the origin, at `refs/pull/<number>/head`. */
async function craftedPullRequest(number: number, records: readonly string[]): Promise<string> {
  const tree = await gitInput(['mktree'], fixture.origin, `${records.join('\n')}\n`)
  const commit = await gitInput(
    ['commit-tree', tree, '-m', `crafted ${String(number)}`],
    fixture.origin,
    '',
  )
  await git(['update-ref', `refs/pull/${String(number)}/head`, commit], fixture.origin)
  return commit
}

async function blob(content: string): Promise<string> {
  return await gitInput(['hash-object', '-w', '--stdin'], fixture.origin, content)
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
  // The pull request's own canary program, at an absolute owned path: a
  // missing relative program must never make a negative case look safe.
  fixture.program = path.join(base, 'pr-program.cjs')
  await writeFile(
    fixture.program,
    await git(['show', `${fixture.headSha}:.filter-canary.cjs`], fixture.origin),
  )
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

interface CheckoutOptions {
  readonly headSha?: string
  readonly number?: number
  /** The environment every git of the checkout runs with. */
  readonly env?: NodeJS.ProcessEnv
}

/** The whole production route, for someone else's pull request. */
async function checkout(storageName: string, options: CheckoutOptions = {}) {
  const { base, work } = fixture
  const number = options.number ?? 51
  const headSha = options.headSha ?? fixture.headSha
  const env = options.env ?? gitEnv
  const storage = path.join(base, storageName)
  const folder = heldWorktreeFolder(storage, REPOSITORY, number, process.platform)
  // Git's checkout working directory differs by implementation. An absolute
  // path to the PR's hook plus its owned marker proves actual execution.
  await git(['config', 'core.hooksPath', path.join(folder, '.githooks')], work)
  await rm(fixture.hookMarker, { force: true })
  const github = fakeGitHub()
  github.answer('GET', `/repos/RandyNorthrup/muse-spark-code/pulls/${String(number)}`, {
    status: 200,
    body: { ...CAPTURED_PULL_FORK, number, head: { ...CAPTURED_PULL_FORK.head, sha: headSha } },
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
    runGit: processGitRunner({ env }),
    checkOutHeld: createHeldCheckout({
      platform: process.platform,
      runGit: untrustedGitRunner(env),
      gitProcess: processGitProcess(),
      env,
      log: new FakeLogOutputChannel(),
    }),
    admit: (start) => start(),
    githubToken: () => Promise.resolve(FAKE_GITHUB_TOKEN),
    github: new GitHubClient({
      fetch: github.fetch,
      userAgent: 'muse-spark-code/test',
      log: new FakeLogOutputChannel(),
      baseUrl: FAKE_GITHUB_BASE,
    }),
    registry,
    askPullRequest: () => Promise.resolve(`#${String(number)}`),
    confirm: () => Promise.resolve(true),
    pathExists: existsSync,
    openFolder: (opening) => {
      opened.push(opening)
      return Promise.resolve()
    },
    ...checkoutNotices(errors),
    now: () => 1,
    log: new FakeLogOutputChannel(),
  })
  return { storage, folder, registry, opened, errors }
}

/** Git's own checkout of the same commit, hooks off: the positive control. */
async function nativeCheckout(label: string, env: NodeJS.ProcessEnv = gitEnv) {
  const control = path.join(fixture.base, label)
  await processGitRunner({ env })(
    ['-c', 'core.hooksPath=/dev/null', ...worktreeAddDetachedArgs(control, fixture.headSha)],
    fixture.work,
  )
  return control
}

/** `ls-files --stage -z` or `ls-tree -r -z` as `<mode> <oid>\t<path>` records. */
function indexEntries(text: string): readonly string[] {
  return text
    .split('\0')
    .filter((entry) => entry !== '')
    .map((entry) => entry.replace(/ (blob )?([\da-f]+)( 0)?\t/u, ' $2\t'))
}

/** Every file of the commit, as the held worktree must hold it. */
async function expectCommitBytes(folder: string, commit: string): Promise<void> {
  const listing = await git(
    ['ls-tree', '-r', '-z', '--full-tree', '--name-only', commit],
    fixture.work,
  )
  for (const file of listing.split('\0')) {
    if (file === '') continue
    const stored = await git(['cat-file', 'blob', `${commit}:${file}`], fixture.work)
    expect(await readFile(path.join(folder, ...file.split('/')), 'utf8')).toBe(stored)
  }
}

describe('a pull request checked out with real git (M71)', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it.each(['tree attributes', 'destination attributes file'] as const)(
    'runs no filter that only the new worktree’s own configuration defines (%s)',
    async (selector) => {
      const label = selector === 'tree attributes' ? 'tree' : 'destination-file'
      const marker = path.join(fixture.base, `conditional-${label}-ran.txt`)
      const include = path.join(fixture.base, `conditional-${label}.config`)
      const names =
        selector === 'tree attributes'
          ? ['canary', 'macro-canary', 'nested-canary']
          : ['hidden-canary']
      await configureSmudgeFilters(include, names, marker)
      if (selector === 'destination attributes file') {
        // Neither the commit nor the source configuration names this filter.
        const linked = path.join(fixture.base, 'linked.attributes')
        await writeFile(linked, 'a.txt filter=hidden-canary\n')
        await git(
          ['config', '--file', include, 'core.attributesFile', linked.replaceAll('\\', '/')],
          fixture.work,
        )
      }
      const condition = await linkedWorktreeCondition()
      await git(['config', condition, include], fixture.work)
      try {
        expect(await git(['config', '--name-only', '--list'], fixture.work)).not.toContain(
          `filter.${names[0] ?? ''}.smudge`,
        )
        const held = await checkout(`conditional-${label}`)
        // First: whatever else happened, no filter program ran.
        expect(existsSync(marker)).toBe(false)
        expect(held.errors).toEqual([])
        expect(held.opened).toEqual([held.folder])
        await expectCommitBytes(held.folder, fixture.headSha)
        const control = await nativeCheckout(`conditional-${label}-control`)
        expect(existsSync(control)).toBe(true)
        const ran = await readFile(marker, 'utf8')
        for (const name of names) expect(ran).toContain(`${name}\n`)
      } finally {
        await git(['config', '--unset-all', condition], fixture.work)
      }
    },
  )

  it.each(['configured', 'empty-XDG'])(
    'runs no filter that info or global attributes select, and changes neither file (%s)',
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
      const label = `local-attributes-${mode}`
      const marker = path.join(fixture.base, `${label}-ran.txt`)
      await writeFile(info, '[attr]shared filter=shared-canary\nexotic.dat shared\n')
      await writeFile(global, 'a.txt filter=global-canary\n')
      const condition = await linkedWorktreeCondition()
      const include = path.join(fixture.base, 'attributes-filters.config')
      await configureSmudgeFilters(include, ['shared-canary', 'global-canary'], marker)
      await git(['config', condition, include], fixture.work)
      if (mode === 'configured') await git(['config', 'core.attributesFile', global], fixture.work)
      const original = await Promise.all([readFile(info), readFile(global)])
      try {
        const held = await checkout(`${label}-held`, { env: attributeEnv })
        expect(existsSync(marker)).toBe(false)
        expect(held.errors).toEqual([])
        expect(await Promise.all([readFile(info), readFile(global)])).toEqual(original)
        await nativeCheckout(`${label}-control`, attributeEnv)
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
    'runs no configured required %s filter while git’s own checkout runs the PR program',
    async (lane) => {
      const label = `filter-${lane}`
      const marker = path.join(fixture.base, `${label}-ran.txt`)
      const command = [process.execPath, fixture.program, lane, marker]
        .map((arg) => posixQuoted(arg.replaceAll('\\', '/')))
        .join(' ')
      await git(['config', `filter.canary.${lane}`, command], fixture.work)
      await git(['config', 'filter.canary.required', 'true'], fixture.work)
      try {
        const negative = await checkout(label)
        expect(existsSync(marker)).toBe(false)
        expect(negative.errors).toEqual([])
        expect(negative.opened).toEqual([negative.folder])
        expect(await readFile(path.join(negative.folder, 'payload.dat'), 'utf8')).toBe(
          'stored filter input\n',
        )
        expect(negative.registry.recordFor(negative.folder)?.isHeld).toBe(true)
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
    const { storage, folder, registry, opened, errors } = await checkout('storage')
    expect(errors).toEqual([])
    expect(opened).toEqual([folder])
    expect(await gitOutput(['rev-parse', 'HEAD'], folder)).toBe(headSha)
    // Detached: no branch was made in the user's repository for it.
    expect(await gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'], folder)).toBe('HEAD')
    expect(await gitOutput(['branch', '--list'], work)).toBe('* main')
    expect(existsSync(path.join(folder, '.githooks', 'post-checkout'))).toBe(true)
    expect(existsSync(fixture.hookMarker)).toBe(false)
    await expectCommitBytes(folder, headSha)
    // The index is the commit's (read-tree), so git sees exactly its files.
    const staged = await git(['ls-files', '--stage', '-z'], folder)
    const tree = await git(['ls-tree', '-r', '-z', '--full-tree', headSha], folder)
    expect(indexEntries(staged)).toEqual(indexEntries(tree))
    expect(
      holdFor(
        [folder],
        [heldWorktreesRoot(storage, process.platform)],
        registry.records(),
        process.platform,
      ),
    ).toMatchObject({ folder, pullRequest: { number: 51, headSha } })
  })

  it('writes a link as a file of its target, a submodule as an empty folder, and the execute bit', async () => {
    const records = [
      `100644 blob ${await blob('plain\n')}\tplain.txt`,
      `100755 blob ${await blob('#!/bin/sh\necho ran\n')}\trun.sh`,
      `120000 blob ${await blob('plain.txt')}\tlink`,
      `160000 commit ${fixture.headSha}\tsub`,
    ]
    const commit = await craftedPullRequest(52, records)
    const held = await checkout('kinds', { headSha: commit, number: 52 })
    expect(held.errors).toEqual([])
    expect(held.opened).toEqual([held.folder])
    expect(lstatSync(path.join(held.folder, 'link')).isFile()).toBe(true)
    expect(await readFile(path.join(held.folder, 'link'), 'utf8')).toBe('plain.txt')
    expect(statSync(path.join(held.folder, 'sub')).isDirectory()).toBe(true)
    expect(readdirSync(path.join(held.folder, 'sub'))).toEqual([])
    expect(await readFile(path.join(held.folder, 'run.sh'), 'utf8')).toBe('#!/bin/sh\necho ran\n')
    // Windows keeps no execute bit.
    if (process.platform === 'win32') return
    expect(statSync(path.join(held.folder, 'run.sh')).mode & 0o111).not.toBe(0)
    expect(statSync(path.join(held.folder, 'plain.txt')).mode & 0o111).toBe(0)
  })

  it('refuses a `.git` path, and two names that fold alike where they do, before adding anything', async () => {
    const hook = await blob('#!/bin/sh\necho owned\n')
    const inner = await gitInput(['mktree'], fixture.origin, `100755 blob ${hook}\tpost-checkout\n`)
    const hooks = await gitInput(['mktree'], fixture.origin, `040000 tree ${inner}\thooks\n`)
    const dotGit = await craftedPullRequest(53, [`040000 tree ${hooks}\t.GIT`])
    const refused = await checkout('dot-git', { headSha: dotGit, number: 53 })
    expect(refused.errors.at(-1)).toContain(
      fill(UI_TEXT.openPullRequestUnsafePath, { path: '".GIT/hooks/post-checkout"' }),
    )
    expect(existsSync(refused.folder)).toBe(false)
    expect(refused.registry.records()).toEqual([])
    expect(refused.opened).toEqual([])
    const upper = await blob('upper\n')
    const lower = await blob('lower\n')
    const folding = await craftedPullRequest(54, [
      `100644 blob ${upper}\tREADME.md`,
      `100644 blob ${lower}\treadme.md`,
    ])
    const folded = await checkout('folding', { headSha: folding, number: 54 })
    if (IS_NAME_FOLDING) {
      expect(folded.errors.at(-1)).toContain(
        fill(UI_TEXT.openPullRequestPathCollision, {
          first: '"README.md"',
          second: '"readme.md"',
        }),
      )
      expect(existsSync(folded.folder)).toBe(false)
      expect(folded.opened).toEqual([])
    } else {
      expect(folded.errors).toEqual([])
      expect(await readFile(path.join(folded.folder, 'README.md'), 'utf8')).toBe('upper\n')
      expect(await readFile(path.join(folded.folder, 'readme.md'), 'utf8')).toBe('lower\n')
    }
  })

  it('refuses a stale approved commit already present in the source repository', async () => {
    const commitPeel = '^{commit}'
    const oldHead = await gitOutput(['rev-parse', 'HEAD'], fixture.work)
    expect(oldHead).not.toBe(fixture.headSha)
    await git(['cat-file', '-e', `${oldHead}${commitPeel}`], fixture.work)
    const { registry, opened, errors } = await checkout('storage-stale', { headSha: oldHead })
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
