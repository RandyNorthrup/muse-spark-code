// M80 lane C: the one sanitized Git runner (SPEC §6.3, D-M4, G23). Parity
// with the host's GIT_METADATA_OPTIONS; an allow-list environment that drops
// every inherited GIT_* and never carries the key; the token only in the one
// authenticated command; configuration closed by its shape (RVM80CD P1):
// every effective name outside the command's own overrides must be one a
// fresh `git init` writes. Against real repositories whose configuration
// names fsmonitor, filter, diff, hook, signer, pager, editor, credential,
// URL-rewrite, include, ssh and upload-pack programs (proved armed with
// plain Git first), no fixture program runs in any phase.

import { execFileSync } from 'node:child_process'
import { appendFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkoutHead } from '../../action/lib/checkout.mjs'
import {
  checkConfigNames,
  GIT_METADATA_OPTIONS,
  gitEnvironment,
  INERT_CONFIG_NAMES,
  remoteProtocol,
  requireGit,
  safeGit,
  safeGitOptions,
  subcommandOf,
} from '../../action/lib/git.mjs'
import { generateDiff } from '../../action/lib/inputs.mjs'
import { childEnvironment } from '../../action/lib/lifecycle.mjs'
import { GIT_METADATA_OPTIONS as HOST_METADATA_OPTIONS } from '../../src/shared/constants'
import {
  allocate,
  fixtureRepo,
  gitPath,
  NODE,
  plainGit,
  PROCESS_SUITE,
  SENTINEL,
  sentinelHits,
  tempLayout,
  TEST_KEY,
  TEST_TOKEN,
  testOwner,
  type FixtureRepo,
  type TempLayout,
} from './helpers/actionFixtures'

const NUL = String.fromCodePoint(0)
const posix = (value: string) => value.replaceAll('\\', '/')

/** A `config --null --name-only --list --show-scope` listing of scope/name pairs. */
function listing(...entries: (readonly [string, string])[]): string {
  return entries.map(([scope, name]) => `${scope}${NUL}${name}${NUL}`).join('')
}

// Every route by which Git configuration can name a program or redirect a
// transport that this suite knows of, as Git lists the names. The check is an
// allow-list, so this list proves coverage; it is not the mechanism.
const PROGRAM_ROUTES = [
  'url.ssh://git@example.invalid/.insteadof',
  'url.https://elsewhere.example/.pushinsteadof',
  'include.path',
  'includeif.gitdir:/repo/.path',
  'core.sshcommand',
  'core.fsmonitor',
  'core.hookspath',
  'core.pager',
  'core.editor',
  'core.askpass',
  'core.gitproxy',
  'core.alternaterefscommand',
  'core.attributesfile',
  'remote.origin.url',
  'remote.origin.uploadpack',
  'remote.origin.receivepack',
  'credential.helper',
  'credential.https://github.com.helper',
  'diff.external',
  'diff.evil.command',
  'diff.evil.textconv',
  'filter.lfs.clean',
  'filter.lfs.smudge',
  'filter.lfs.process',
  'merge.evil.driver',
  'gpg.program',
  'gpg.ssh.program',
  'sequence.editor',
  'alias.st',
  'protocol.allow',
  'protocol.ext.allow',
  'http.extraheader',
  'http.proxy',
  'uploadpack.packobjectshook',
  'extensions.worktreeconfig',
]

describe('source parity with the host policy', () => {
  it('reproduces GIT_METADATA_OPTIONS exactly', () => {
    expect(GIT_METADATA_OPTIONS).toEqual(HOST_METADATA_OPTIONS)
  })

  it('adds the Action overrides to every command', () => {
    const options = safeGitOptions({ emptyHooks: '/private/hooks' })
    for (const setting of [
      'core.fsmonitor=false',
      'core.hooksPath=/private/hooks',
      'diff.external=',
      'commit.gpgsign=false',
      'tag.gpgsign=false',
      'core.askPass=',
      'credential.helper=',
    ]) {
      expect(options, setting).toContain(setting)
    }
    expect(subcommandOf(['-c', 'user.name=x', '--no-pager', 'commit', '-m', 'y'])).toBe('commit')
  })
})

describe('configuration closed by its shape (RVM80CD P1)', () => {
  it('accepts what a fresh git init writes and the command’s own overrides', () => {
    expect(() => {
      checkConfigNames('')
    }).not.toThrow()
    expect(() => {
      checkConfigNames(
        listing(
          ...[...INERT_CONFIG_NAMES].map((name) => ['local', name] as const),
          ['command', 'core.fsmonitor'],
          ['command', 'http.extraheader'],
          ['command', 'credential.helper'],
        ),
      )
    }).not.toThrow()
  })

  it.each(PROGRAM_ROUTES)('refuses %s from every file scope, naming no key', (name) => {
    for (const scope of ['local', 'worktree', 'global', 'system']) {
      expect(() => {
        checkConfigNames(listing(['local', 'core.bare'], [scope, name]))
      }).toThrow('git configuration names a setting this Action does not allow')
    }
  })

  it('fails closed on a malformed listing', () => {
    expect(() => {
      checkConfigNames(`local${NUL}`)
    }).toThrow(/malformed/)
  })

  it('lets a network command use only the validated remote’s own transport', () => {
    expect(remoteProtocol('https://github.com/owner/repo.git')).toBe('https')
    expect(remoteProtocol(path.resolve('fixture.git'))).toBe('file')
    for (const remote of [
      'ssh://git@github.com/owner/repo.git',
      'git@github.com:owner/repo.git',
      'ext::sh -c x',
      'file:///repo.git',
      'HTTPS://github.com/owner/repo.git',
      'relative/repo.git',
    ]) {
      expect(() => remoteProtocol(remote), remote).toThrow(/https/)
    }
  })
})

describe('the Git environment', () => {
  const paths = { emptyGitConfig: '/private/config', home: '/private/home', tmp: '/private/tmp' }

  it('drops every inherited GIT_* name and never carries the key', () => {
    const hostile = {
      PATH: '/usr/bin',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.fsmonitor',
      GIT_CONFIG_VALUE_0: '/evil',
      GIT_CONFIG_PARAMETERS: "'core.hooksPath'='/evil'",
      git_dir: '/elsewhere',
      GIT_EXEC_PATH: '/evil',
      MUSE_SPARK_MODEL_API_KEY: TEST_KEY,
    }
    const fromParent = childEnvironment({
      platform: 'linux',
      parentEnv: hostile,
      paths,
      nodePath: '/opt/node/bin/node',
    })
    expect(Object.values(fromParent)).not.toContain(TEST_KEY)
    const env = gitEnvironment({ baseEnv: hostile, paths, readOnly: true })
    expect(env).toMatchObject({
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/private/config',
      GIT_ATTR_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.extraHeader',
      GIT_CONFIG_VALUE_0: '',
    })
    expect(
      Object.keys(env)
        .filter((name) => name.toUpperCase().startsWith('GIT_'))
        .toSorted((left, right) => left.localeCompare(right)),
    ).toEqual([
      'GIT_ALLOW_PROTOCOL',
      'GIT_ATTR_NOSYSTEM',
      'GIT_CONFIG_COUNT',
      'GIT_CONFIG_GLOBAL',
      'GIT_CONFIG_KEY_0',
      'GIT_CONFIG_NOSYSTEM',
      'GIT_CONFIG_VALUE_0',
      'GIT_OPTIONAL_LOCKS',
      'GIT_TERMINAL_PROMPT',
    ])
    expect(env['GIT_ALLOW_PROTOCOL']).toBe('https')
    expect(gitEnvironment({ baseEnv: hostile, paths, readOnly: false })).not.toHaveProperty(
      'GIT_OPTIONAL_LOCKS',
    )
  })

  it('stops repository discovery above the working directory and pins one transport', () => {
    const cwd = path.resolve('workspace', 'pr')
    const env = gitEnvironment({ baseEnv: {}, paths, readOnly: false, cwd, protocol: 'file' })
    expect(env['GIT_CEILING_DIRECTORIES']).toBe(path.dirname(cwd))
    expect(env['GIT_ALLOW_PROTOCOL']).toBe('file')
  })

  it('carries the token only as the one authenticated command header, after a reset', () => {
    const env = gitEnvironment({
      baseEnv: {},
      paths,
      readOnly: false,
      auth: { kind: 'push', token: TEST_TOKEN },
    })
    const basic = Buffer.from(`x-access-token:${TEST_TOKEN}`).toString('base64')
    expect(env).toMatchObject({
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_VALUE_0: '',
      GIT_CONFIG_KEY_1: 'http.extraHeader',
      GIT_CONFIG_VALUE_1: `AUTHORIZATION: basic ${basic}`,
    })
    expect(JSON.stringify(env)).not.toContain(TEST_TOKEN)
  })
})

describe('safeGit against armed fixture programs (G23)', PROCESS_SUITE, () => {
  let layout: TempLayout
  let repo: FixtureRepo
  let git: string

  beforeEach(() => {
    layout = tempLayout()
    repo = fixtureRepo(layout)
    git = gitPath(layout)
  })
  afterEach(() => {
    layout.cleanup()
  })

  function command(name: string): string {
    return `"${posix(NODE)}" "${posix(SENTINEL)}" "${posix(layout.sentinels)}" ${name}`
  }

  /** The command as a Git configuration value: its quotes escaped, so Git keeps them. */
  function setting(name: string): string {
    return command(name).replaceAll('"', String.raw`\"`)
  }

  /** Configuration and hooks an agent's edit or a hostile environment could plant. */
  function arm(repository: string): void {
    const hooks = path.join(layout.root, `hooks-${String(Date.now())}`)
    mkdirSync(hooks, { recursive: true })
    for (const hook of [
      'pre-commit',
      'post-checkout',
      'post-index-change',
      'reference-transaction',
      'pre-push',
    ]) {
      const file = path.join(hooks, hook)
      writeFileSync(file, `#!/bin/sh\n${command(`hook-${hook}`)}\n`)
      chmodSync(file, 0o755)
    }
    const settings = [
      `[core]\n\tfsmonitor = ${setting('fsmonitor')}`,
      `\thooksPath = ${posix(hooks)}`,
      `\tpager = ${setting('pager')}`,
      `\teditor = ${setting('editor')}`,
      `\taskPass = ${setting('askpass')}`,
      `[filter "evil"]\n\tclean = ${setting('filter-clean')}`,
      `\tsmudge = ${setting('filter-smudge')}`,
      `\tprocess = ${setting('filter-process')}`,
      '\trequired = true',
      `[diff "evil"]\n\tcommand = ${setting('diff-command')}`,
      `\ttextconv = ${setting('diff-textconv')}`,
      `[diff]\n\texternal = ${setting('diff-external')}`,
      `[gpg]\n\tprogram = ${setting('gpg')}`,
      '[commit]\n\tgpgsign = true',
      `[credential]\n\thelper = ${setting('credential')}`,
    ]
    appendFileSync(path.join(repository, '.git', 'config'), `${settings.join('\n')}\n`)
    writeFileSync(path.join(repository, '.gitattributes'), '* filter=evil diff=evil\n')
  }

  function hostileParent(): Record<string, string> {
    const home = path.join(layout.root, 'hostile-home')
    mkdirSync(home, { recursive: true })
    writeFileSync(
      path.join(home, '.gitconfig'),
      `[core]\n\tfsmonitor = ${command('home-fsmonitor')}\n`,
    )
    return {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
      HOME: home,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.fsmonitor',
      GIT_CONFIG_VALUE_0: command('env-fsmonitor'),
      GIT_CONFIG_PARAMETERS: `'core.pager'='${command('env-pager')}'`,
      GIT_EXTERNAL_DIFF: command('env-external-diff'),
      GIT_TEMPLATE_DIR: path.join(layout.root, 'nowhere'),
      MUSE_SPARK_MODEL_API_KEY: TEST_KEY,
    }
  }

  async function checkedOut(paths: ActionPaths, baseEnv: Record<string, string>) {
    const { owner } = testOwner(paths)
    await checkoutHead({
      owner,
      git,
      paths,
      baseEnv,
      directory: paths.checkout,
      remote: repo.bare,
      shas: [repo.head, repo.base],
      token: '',
    })
    return owner
  }

  it('the fixture is armed: plain Git runs the planted programs', () => {
    const plain = path.join(layout.root, 'plain')
    plainGit(layout, layout.root, ['clone', '--quiet', repo.bare, plain])
    arm(plain)
    writeFileSync(path.join(plain, 'notes.txt'), 'changed\n')
    try {
      plainGit(layout, plain, ['add', '--all'])
      plainGit(layout, plain, ['diff', 'HEAD'])
    } catch {
      // Planted programs may fail the command; that they ran is the point.
    }
    const hits = sentinelHits(layout)
    expect(
      hits.some((hit) => hit.startsWith('filter-clean') || hit.startsWith('filter-process')),
    ).toBe(true)
    expect(hits.some((hit) => hit.startsWith('fsmonitor'))).toBe(true)
  })

  it('works in a clean checkout, then refuses every phase once configuration names a program', async () => {
    const paths = allocate(layout)
    const parent = hostileParent()
    const baseEnv = childEnvironment({
      platform: process.platform,
      parentEnv: parent,
      paths,
      nodePath: NODE,
    })
    const owner = await checkedOut(paths, {
      ...baseEnv,
      ...Object.fromEntries(Object.entries(parent).filter(([name]) => name.startsWith('GIT_'))),
    })
    const staged = { baseSha: repo.base, headSha: repo.head, maxDiffBytes: 1_000_000 }
    const diff = await generateDiff({ owner, git, paths, baseEnv, staged })
    expect(diff.truncated).toBe(false)
    expect(readFileSync(paths.diff, 'utf8')).toContain('+second')
    writeFileSync(path.join(paths.checkout, 'notes.txt'), 'first\nsecond\nthird\n')
    writeFileSync(path.join(paths.checkout, 'new.txt'), 'brand new\n')
    const run = (args: readonly string[], isReadOnly: boolean, stdoutPath?: string) =>
      safeGit({
        owner,
        git,
        cwd: paths.checkout,
        args,
        paths,
        baseEnv,
        readOnly: isReadOnly,
        ...(stdoutPath !== undefined && { stdoutPath }),
      })
    const patchArgs = ['diff', '--binary', '--no-ext-diff', '--no-textconv', repo.head]
    requireGit(await run(['add', '--intent-to-add', '--all'], false), 'add')
    requireGit(await run(patchArgs, true, paths.staging), 'diff')
    const patch = readFileSync(paths.staging, 'utf8')
    expect(patch).toContain('+third')
    expect(patch).toContain('+brand new')
    await expect(
      safeGit({
        owner,
        git,
        cwd: paths.checkout,
        args: patchArgs,
        paths,
        baseEnv,
        readOnly: true,
        stdoutPath: paths.staging,
        stdoutPrefixMaxBytes: 10,
      }),
    ).rejects.toThrow('only for the read-only review diff')
    arm(paths.checkout)
    await expect(generateDiff({ owner, git, paths, baseEnv, staged })).rejects.toThrow(
      /does not allow/,
    )
    const phases: [readonly string[], boolean][] = [
      [['add', '--intent-to-add', '--all'], false],
      [patchArgs, true],
      [['rev-parse', 'HEAD'], true],
      [['status'], false],
    ]
    for (const [args, isReadOnly] of phases) {
      await expect(run(args, isReadOnly), args.join(' ')).rejects.toThrow(/does not allow/)
    }
    expect(sentinelHits(layout)).toEqual([])
    await owner.cleanup()
  })

  it('re-reads the configuration before every command (configuration changed in between)', async () => {
    const paths = allocate(layout)
    const baseEnv = childEnvironment({
      platform: process.platform,
      parentEnv: process.env,
      paths,
      nodePath: NODE,
    })
    const owner = await checkedOut(paths, baseEnv)
    writeFileSync(path.join(paths.checkout, '.gitattributes'), '*.txt filter=late\n')
    writeFileSync(path.join(paths.checkout, 'notes.txt'), 'edited\n')
    const add = () =>
      safeGit({
        owner,
        git,
        cwd: paths.checkout,
        args: ['add', '--all'],
        paths,
        baseEnv,
        readOnly: false,
      })
    requireGit(await add(), 'add')
    appendFileSync(
      path.join(paths.checkout, '.git', 'config'),
      `[filter "late"]\n\tclean = ${setting('late-clean')}\n\trequired = true\n`,
    )
    writeFileSync(path.join(paths.checkout, 'notes.txt'), 'edited again\n')
    await expect(add()).rejects.toThrow(/does not allow/)
    expect(sentinelHits(layout)).toEqual([])
    await owner.cleanup()
  })

  /** URL rewrites, an include, ssh and upload/receive-pack programs (RVM80CD P1). */
  function armRoutes(repository: string): void {
    const included = path.join(layout.root, `included-${String(Date.now())}.config`)
    writeFileSync(included, `[core]\n\tfsmonitor = ${setting('include-fsmonitor')}\n`)
    const settings = [
      '[url "ssh://git@example.invalid/"]\n\tinsteadOf = https://github.com/',
      '\tpushInsteadOf = https://github.com/',
      `[core]\n\tsshCommand = ${setting('ssh-command')}`,
      `[include]\n\tpath = ${posix(included)}`,
      `[remote "origin"]\n\tuploadpack = ${setting('upload-pack')}`,
      `\treceivepack = ${setting('receive-pack')}`,
    ]
    appendFileSync(path.join(repository, '.git', 'config'), `${settings.join('\n')}\n`)
  }

  it('the route fixture is armed: plain Git runs its rewrite, ssh, include and upload-pack programs', () => {
    const plain = path.join(layout.root, 'plain-routes')
    plainGit(layout, layout.root, ['clone', '--quiet', repo.bare, plain])
    armRoutes(plain)
    for (const args of [
      ['ls-remote', 'https://github.com/owner/repo.git'],
      ['fetch', '--quiet', 'origin'],
      ['status'],
    ]) {
      try {
        plainGit(layout, plain, args)
      } catch {
        // Planted programs fail the command; that they ran is the point.
      }
    }
    const hits = sentinelHits(layout)
    for (const route of ['ssh-command', 'upload-pack', 'include-fsmonitor']) {
      expect(
        hits.some((hit) => hit.startsWith(route)),
        route,
      ).toBe(true)
    }
  })

  it('refuses fetch, push and status through those routes; no program runs', async () => {
    const paths = allocate(layout)
    const baseEnv = childEnvironment({
      platform: process.platform,
      parentEnv: process.env,
      paths,
      nodePath: NODE,
    })
    const owner = await checkedOut(paths, baseEnv)
    armRoutes(paths.checkout)
    const remote = 'https://github.com/owner/repo.git'
    const run = (args: string[], auth?: { kind: 'checkout' | 'push'; token: string }) =>
      safeGit({
        owner,
        git,
        cwd: paths.checkout,
        args,
        paths,
        baseEnv,
        readOnly: false,
        protocol: remoteProtocol(remote),
        ...(auth !== undefined && { auth }),
      })
    await expect(
      run(['fetch', '--quiet', remote, `+${repo.head}:refs/muse-spark/x`], {
        kind: 'checkout',
        token: TEST_TOKEN,
      }),
    ).rejects.toThrow(/does not allow/)
    await expect(
      run(['push', '--quiet', remote, 'HEAD:refs/heads/feature'], {
        kind: 'push',
        token: TEST_TOKEN,
      }),
    ).rejects.toThrow(/does not allow/)
    await expect(run(['status'])).rejects.toThrow(/does not allow/)
    expect(sentinelHits(layout)).toEqual([])
    await owner.cleanup()
  })

  it('never acts on a repository above its working directory', async () => {
    const parent = path.join(layout.root, 'parent-repo')
    plainGit(layout, layout.root, ['clone', '--quiet', repo.bare, parent])
    const inside = path.join(parent, 'not-a-checkout')
    mkdirSync(inside)
    const paths = allocate(layout)
    const { owner } = testOwner(paths)
    const outcome = await safeGit({
      owner,
      git,
      cwd: inside,
      args: ['rev-parse', '--verify', 'HEAD'],
      paths,
      baseEnv: childEnvironment({
        platform: process.platform,
        parentEnv: process.env,
        paths,
        nodePath: NODE,
      }),
      readOnly: true,
    })
    expect(outcome.code).not.toBe(0)
    await owner.cleanup()
  })

  it('the transport pin alone refuses a rewrite to another protocol', () => {
    const plain = path.join(layout.root, 'pinned-routes')
    plainGit(layout, layout.root, ['clone', '--quiet', repo.bare, plain])
    armRoutes(plain)
    const paths = allocate(layout)
    const env = gitEnvironment({
      baseEnv: childEnvironment({
        platform: process.platform,
        parentEnv: process.env,
        paths,
        nodePath: NODE,
      }),
      paths,
      readOnly: true,
      cwd: plain,
    })
    expect(() =>
      execFileSync(git, ['ls-remote', 'https://github.com/owner/repo.git'], {
        cwd: plain,
        env,
        stdio: 'pipe',
      }),
    ).toThrow()
    expect(sentinelHits(layout)).toEqual([])
  })

  it('refuses a token on the wrong command and a read-only flag on a writing command', async () => {
    const paths = allocate(layout)
    const { owner } = testOwner(paths)
    const base = { owner, git, cwd: layout.root, paths, baseEnv: {} }
    await expect(
      safeGit({
        ...base,
        args: ['push', 'x'],
        readOnly: false,
        auth: { kind: 'checkout', token: TEST_TOKEN },
      }),
    ).rejects.toThrow(/only for git fetch/)
    await expect(
      safeGit({
        ...base,
        args: ['fetch', 'x'],
        readOnly: false,
        auth: { kind: 'push', token: TEST_TOKEN },
      }),
    ).rejects.toThrow(/only for git push/)
    await expect(safeGit({ ...base, args: ['commit', '-m', 'x'], readOnly: true })).rejects.toThrow(
      /not read-only/,
    )
    await owner.cleanup()
  })
})
