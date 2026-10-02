// M80 lane C: the one sanitized Git runner (SPEC §6.3, D-M4, G23). Parity
// with the host's GIT_METADATA_OPTIONS and gitFilterOptions; an allow-list
// environment that drops every inherited GIT_* and never carries the key;
// the token only in the one authenticated command; and, against a real
// repository whose configuration names fsmonitor, filter, diff, hook,
// signer, pager, editor and credential programs (proved armed with plain
// Git first), no fixture program runs in checkout, input diff or patch.

import { appendFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkoutHead } from '../../action/lib/checkout.mjs'
import {
  ACTION_FILTER_NAMES_ARGS,
  filterOverrides,
  GIT_FILTER_NAME_MAX_CHARS,
  GIT_FILTER_NAMES_MAX,
  GIT_METADATA_OPTIONS,
  gitEnvironment,
  requireGit,
  safeGit,
  safeGitOptions,
  subcommandOf,
} from '../../action/lib/git.mjs'
import { generateDiff } from '../../action/lib/inputs.mjs'
import { childEnvironment } from '../../action/lib/lifecycle.mjs'
import { gitFilterOptions } from '../../src/host/git'
import {
  GIT_FILTER_NAME_MAX_CHARS as HOST_NAME_MAX_CHARS,
  GIT_FILTER_NAMES_ARGS,
  GIT_FILTER_NAMES_MAX as HOST_NAMES_MAX,
  GIT_METADATA_OPTIONS as HOST_METADATA_OPTIONS,
} from '../../src/shared/constants'
import {
  allocate,
  fixtureRepo,
  gitPath,
  NODE,
  plainGit,
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

function names(...keys: string[]): string {
  return keys.map((key) => `${key}${NUL}`).join('')
}

describe('source parity with the host policy', () => {
  it('reproduces GIT_METADATA_OPTIONS and the filter name limits exactly', () => {
    expect(GIT_METADATA_OPTIONS).toEqual(HOST_METADATA_OPTIONS)
    expect(GIT_FILTER_NAMES_MAX).toBe(HOST_NAMES_MAX)
    expect(GIT_FILTER_NAME_MAX_CHARS).toBe(HOST_NAME_MAX_CHARS)
    expect(ACTION_FILTER_NAMES_ARGS.slice(0, -1)).toEqual(GIT_FILTER_NAMES_ARGS.slice(0, -1))
    expect(ACTION_FILTER_NAMES_ARGS.at(-1)).toBe(
      GIT_FILTER_NAMES_ARGS.at(-1)?.replace('required)', 'required|smudge)'),
    )
  })

  it('suppresses the same drivers as gitFilterOptions, plus smudge', () => {
    for (const output of [
      '',
      names('filter.lfs.clean', 'filter.lfs.process'),
      names('filter.a.b.required', 'filter.x.clean', 'filter.a.b.clean'),
      'filter.solo.clean',
    ]) {
      const action = filterOverrides(output)
      const withoutSmudge = action.filter(
        (arg, index) =>
          !arg.endsWith('.smudge=') && !(arg === '-c' && action[index + 1]?.endsWith('.smudge=')),
      )
      expect(withoutSmudge, output).toEqual(gitFilterOptions(output))
    }
    expect(filterOverrides(names('filter.evil.smudge'))).toEqual([
      '-c',
      'filter.evil.clean=',
      '-c',
      'filter.evil.process=',
      '-c',
      'filter.evil.required=false',
      '-c',
      'filter.evil.smudge=',
    ])
  })

  it('fails closed on the names gitFilterOptions refuses', () => {
    const tooMany = names(
      ...Array.from({ length: HOST_NAMES_MAX + 1 }, (_, i) => `filter.f${String(i)}.clean`),
    )
    const tooLong = names(`filter.${'n'.repeat(HOST_NAME_MAX_CHARS)}.clean`)
    for (const output of [
      names('filter.bad=name.clean'),
      names('core.fsmonitor'),
      tooMany,
      tooLong,
    ]) {
      expect(() => filterOverrides(output)).toThrow(/invalid/)
      expect(() => gitFilterOptions(output)).toThrow()
    }
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
      'GIT_ATTR_NOSYSTEM',
      'GIT_CONFIG_COUNT',
      'GIT_CONFIG_GLOBAL',
      'GIT_CONFIG_KEY_0',
      'GIT_CONFIG_NOSYSTEM',
      'GIT_CONFIG_VALUE_0',
      'GIT_OPTIONAL_LOCKS',
      'GIT_TERMINAL_PROMPT',
    ])
    expect(gitEnvironment({ baseEnv: hostile, paths, readOnly: false })).not.toHaveProperty(
      'GIT_OPTIONAL_LOCKS',
    )
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

describe('safeGit against armed fixture programs (G23)', () => {
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

  it('runs no planted program in checkout, input diff, intent-to-add or patch diff', async () => {
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
    arm(paths.checkout)
    const staged = { baseSha: repo.base, headSha: repo.head, maxDiffBytes: 1_000_000 }
    const diff = await generateDiff({ owner, git, paths, baseEnv, staged })
    expect(diff.truncated).toBe(false)
    expect(readFileSync(paths.diff, 'utf8')).toContain('+second')
    writeFileSync(path.join(paths.checkout, 'notes.txt'), 'first\nsecond\nthird\n')
    writeFileSync(path.join(paths.checkout, 'new.txt'), 'brand new\n')
    const run = (args: string[], isReadOnly: boolean, stdoutPath?: string) =>
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
    requireGit(await run(['add', '--intent-to-add', '--all'], false), 'add')
    requireGit(
      await run(
        ['diff', '--binary', '--no-ext-diff', '--no-textconv', repo.head],
        true,
        paths.staging,
      ),
      'diff',
    )
    const patch = readFileSync(paths.staging, 'utf8')
    expect(patch).toContain('+third')
    expect(patch).toContain('+brand new')
    expect(patch).toContain('.gitattributes')
    requireGit(await run(['rev-parse', 'HEAD'], true), 'rev-parse')
    expect(sentinelHits(layout)).toEqual([])
    await owner.cleanup()
  })

  it('re-reads the filter names before every command (configuration changed in between)', async () => {
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
    requireGit(
      await safeGit({
        owner,
        git,
        cwd: paths.checkout,
        args: ['add', '--all'],
        paths,
        baseEnv,
        readOnly: false,
      }),
      'add',
    )
    appendFileSync(
      path.join(paths.checkout, '.git', 'config'),
      `[filter "late"]\n\tclean = ${setting('late-clean')}\n\trequired = true\n`,
    )
    writeFileSync(path.join(paths.checkout, 'notes.txt'), 'edited again\n')
    requireGit(
      await safeGit({
        owner,
        git,
        cwd: paths.checkout,
        args: ['add', '--all'],
        paths,
        baseEnv,
        readOnly: false,
      }),
      'add',
    )
    expect(sentinelHits(layout)).toEqual([])
    await owner.cleanup()
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
