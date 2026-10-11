// The runtime Git service (M123 lane G, PLAN.md D104): the argument
// allowlist, the push/fetch environment rule, and status, commit, push,
// fetch and worktrees on lane 0's fixture repositories. Pushes go to
// local bare repositories through `insteadOf`, so no network is touched.
// Secret names are asserted, never values: a failing assertion must not
// print a canary.

import path from 'node:path'
import { tmpdir } from 'node:os'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalPath } from '../../src/host/canonicalPath'
import {
  createGitProcess,
  isGitExitError,
  type GitProcess,
  type GitProcessOptions,
} from '../../src/host/git'
import * as launcher from '../../src/core/resources/launcher'
import { ResourcePausedError } from '../../src/core/resources/launch'
import {
  assertNativeGitArgs,
  CommitRefusedError,
  nativeFetchArgs,
  nativePushArgs,
  nativePushEnvironment,
  nativePushTerminalCommand,
  nativeWorktreeAddArgs,
  NativeGitRefusalError,
  NativeGitService,
  refusalOf,
  type NativePushPlan,
} from '../../src/runtime/panel/git/service'
import { takeCredentials } from '../../src/runtime/credentialVariables'
import {
  keepGitCredentialRoutes,
  runtimeGitUserEnvironment,
} from '../../src/runtime/gitUserEnvironment'
import {
  dirtyScratchRepository,
  fakeRuntimeGitDeps,
  hostGitPath,
  isolateGitEnvironment,
} from './helpers/github/fakes'
import { createFixtureRepositories, type FixtureRepositories } from './helpers/github/repositories'
import type { RuntimeGitDeps } from '../../src/core/git/runtimeGit'

const QUIET_CANARY_ENV = 'M123_G_TEST_QUIET_CANARY_TOKEN'
const MODEL_CANARY_ENV = 'META_API_KEY'
const GIT_ROUTE_ENV = 'GH_TOKEN'

// Every git here commits as the test's own identity, never the machine's (R12).
beforeEach(() => {
  isolateGitEnvironment()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

/** Removes a link or junction itself, never what it leads to. */
function removeLink(link: string): void {
  try {
    unlinkSync(link)
  } catch {
    // A Windows junction is removed as a directory entry.
    rmdirSync(link)
  }
}

function sortedEnvNames(keys: readonly string[]): readonly string[] {
  return keys.toSorted((left, right) => left.localeCompare(right))
}

function okPlan(): NativePushPlan {
  return {
    ok: true,
    remote: 'origin',
    remoteUrl: 'https://github.com/o/r.git',
    branch: 'feature',
    target: 'feature',
    refspec: 'feature',
    setUpstream: false,
    commits: 1,
    pushUrls: ['https://github.com/o/r.git'],
    headOid: undefined,
    configFiles: [],
  }
}

describe('assertNativeGitArgs', () => {
  it('accepts every command the service builds', () => {
    const accepted: readonly string[][] = [
      ['status', '--porcelain=v2', '--branch', '--untracked-files=all', '-z'],
      ['remote'],
      ['diff', '--no-color', '--no-ext-diff', '--no-textconv'],
      ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--cached'],
      ['add', '-A'],
      ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir'],
      ['config', '--get', 'commit.gpgsign'],
      ['config', '--get', 'remote.origin.url'],
      ['config', '--get', 'remote.origin.pushurl'],
      ['config', '--list', '--show-origin', '--name-only', '-z'],
      ['remote', 'get-url', '--push', '--all', 'origin'],
      ['commit', '-m', 'A message with -dash and : colon'],
      ['push', 'origin', 'feature'],
      ['push', '-u', 'origin', 'feature'],
      ['fetch', 'origin'],
      ['fetch', 'origin', 'main'],
      ['worktree', 'add', '--no-checkout', '--detach', '/tmp/wt-1', 'abc0001'],
    ]
    for (const args of accepted) {
      expect(() => {
        assertNativeGitArgs(args)
      }).not.toThrow()
    }
  })

  it('refuses anything else, including force markers and options', () => {
    const evil: readonly string[][] = [
      [],
      ['log', '--oneline'],
      ['status', '--porcelain=v2', '--branch', '--untracked-files=all', '-z', '--ignored'],
      ['diff', '--no-color', 'HEAD~1'],
      ['add', '-u'],
      ['config', '--add', 'user.name', 'x'],
      ['config', '--get', 'credential.helper'],
      ['config', '--get', 'remote.-x.url'],
      ['config', '--get', 'remote.a b.url'],
      ['config', '--get', 'user.name'],
      ['config', 'remote.origin.url'],
      ['commit', 'a message without -m'],
      ['commit', '--amend', '--no-edit'],
      ['push', '--force', 'origin', 'feature'],
      ['push', 'origin', '+feature'],
      ['push', '--force-with-lease', 'origin', 'feature'],
      ['push', '-u', '--force', 'origin', 'feature'],
      ['push', '-origin', 'feature'],
      ['fetch', '-p', 'origin'],
      ['fetch', 'origin', 'main:main'],
      ['worktree', 'add', '--detach', '../escape', 'abc0001'],
      ['worktree', 'add', '--no-checkout', '--detach', 'relative/path', 'abc0001'],
      ['worktree', 'add', '--no-checkout', '--detach', '/tmp/wt-1', '--all'],
      ['rev-parse', 'HEAD'],
      ['rev-parse', '--show-toplevel'],
      ['config', '--list', '--show-origin'],
      ['config', '--list', '--show-origin', '--name-only', '-z', '--global'],
      ['remote', 'get-url', '--push', '--all', '-x'],
      ['remote', 'get-url', 'origin'],
      ['remote', 'set-url', 'origin', 'https://evil.invalid/r.git'],
    ]
    for (const args of evil) {
      expect(() => {
        assertNativeGitArgs(args)
      }, JSON.stringify(args)).toThrow(/Refused git/)
    }
  })
})

describe('nativePushArgs', () => {
  it('pushes exactly the remote and the refspec, never a force mode', () => {
    expect(nativePushArgs(okPlan())).toEqual(['push', 'origin', 'feature'])
    expect(nativePushArgs({ ...okPlan(), setUpstream: true })).toEqual([
      'push',
      '-u',
      'origin',
      'feature',
    ])
    // The terminal runs the same git the service does.
    expect(nativePushTerminalCommand(okPlan(), '/opt/git/bin/git')).toEqual([
      '/opt/git/bin/git',
      'push',
      'origin',
      'feature',
    ])
  })

  it('builds fetch and worktree commands the allowlist then rechecks', () => {
    expect(nativeFetchArgs('origin')).toEqual(['fetch', 'origin'])
    expect(nativeFetchArgs('origin', 'main')).toEqual(['fetch', 'origin', 'main'])
    expect(nativeWorktreeAddArgs('/tmp/wt-1', 'abc0001')).toEqual([
      'worktree',
      'add',
      '--no-checkout',
      '--detach',
      '/tmp/wt-1',
      'abc0001',
    ])
    // Builders interpolate; the allowlist refuses the evil results at spawn.
    expect(() => {
      assertNativeGitArgs(nativeFetchArgs('-evil'))
    }).toThrow(/Refused/)
    expect(() => {
      assertNativeGitArgs(nativeFetchArgs('origin', '+main'))
    }).toThrow(/Refused/)
    expect(() => {
      assertNativeGitArgs(nativeWorktreeAddArgs('relative', 'abc0001'))
    }).toThrow(/Refused/)
  })
})

describe('nativePushEnvironment', () => {
  it('keeps the user environment and its Git routes, and stops at no prompt', () => {
    const env = nativePushEnvironment({
      GH_TOKEN: 'kept',
      SSH_AUTH_SOCK: '/run/agent',
      GIT_TERMINAL_PROMPT: '1',
      PATH: '/usr/bin',
    })
    expect(env['GH_TOKEN']).toBe('kept')
    expect(env['SSH_AUTH_SOCK']).toBe('/run/agent')
    expect(env['GIT_TERMINAL_PROMPT']).toBe('0')
    expect(sortedEnvNames(Object.keys(env))).toEqual(
      sortedEnvNames(['GH_TOKEN', 'SSH_AUTH_SOCK', 'GIT_TERMINAL_PROMPT', 'PATH']),
    )
  })

  it('R3: gives a push no credential but the Git routes: never a model or provider key', () => {
    const env = nativePushEnvironment({
      PATH: '/usr/bin',
      GH_TOKEN: 'route',
      GITHUB_TOKEN: 'route',
      META_API_KEY: 'model',
      OPENAI_API_KEY: 'model',
      OPENAI_KEY: 'model',
      ANTHROPIC_KEY: 'model',
      ANTHROPIC_AUTH_TOKEN: 'provider',
      AWS_BEARER_TOKEN_BEDROCK: 'provider',
      HF_TOKEN: 'provider',
      META_KEY: 'model',
      GEMINI_KEY: 'model',
      NPM_TOKEN: 'other',
    })
    expect(sortedEnvNames(Object.keys(env))).toEqual(
      sortedEnvNames(['PATH', 'GH_TOKEN', 'GITHUB_TOKEN', 'GIT_TERMINAL_PROMPT']),
    )
  })
})

describe('NativeGitService on the fixture repositories', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'm123-native-service-'))
  const dataFolder = mkdtempSync(path.join(tmpdir(), 'm123-native-data-'))
  const made: FixtureRepositories[] = []
  const fixtures = (): FixtureRepositories => {
    const [ready] = made
    if (ready === undefined) {
      throw new Error('the fixture repositories are missing')
    }
    return ready
  }
  const depsFor = (repositoryRoot: string, overrides: Partial<RuntimeGitDeps> = {}) =>
    fakeRuntimeGitDeps(repositoryRoot, {
      dataFolder,
      isTrusted: () => true,
      ...overrides,
    }).deps
  let git: GitProcess | undefined
  const gitRunner = (): GitProcess => {
    if (git === undefined) {
      throw new Error('the git runner is missing')
    }
    return git
  }

  beforeAll(() => {
    made.push(createFixtureRepositories(root))
    git = createGitProcess({
      platform: process.platform,
      env: fixtures().environment,
      fileExists: existsSync,
      spawn,
    })
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(dataFolder, { recursive: true, force: true })
  })

  it('plans the own fixture as a plain push of one commit, bound to where git sends it', async () => {
    const service = new NativeGitService(depsFor(fixtures().own), { run: gitRunner() })
    const plan = await service.planPush()
    expect(plan).toMatchObject({
      ok: true,
      remote: 'origin',
      remoteUrl: expect.stringContaining('github.com'),
      branch: 'feature',
      target: 'feature',
      refspec: 'feature',
      setUpstream: false,
      commits: 1,
      headOid: expect.stringMatching(/^[0-9a-f]{40}$/),
    })
    if (!plan.ok) {
      throw new Error('the own fixture must plan a push')
    }
    // The fixture's `insteadOf` sends github.com to a local bare repository:
    // the plan names that, where the push really goes.
    expect(plan.pushUrls).toHaveLength(1)
    expect(plan.pushUrls[0]?.includes('github.com')).toBe(false)
    expect(plan.configFiles.some((file) => file.endsWith(path.join('.git', 'config')))).toBe(true)
  })

  it('plans the shared push-plan refusals: behind, detached', async () => {
    const behind = new NativeGitService(depsFor(fixtures().behind), { run: gitRunner() })
    expect(await behind.planPush()).toEqual({ ok: false, refusal: 'behind' })
    const detached = new NativeGitService(depsFor(fixtures().detached), { run: gitRunner() })
    expect(await detached.planPush()).toEqual({ ok: false, refusal: 'detached' })
  })

  it('pushes the own fixture to its local origin', async () => {
    const service = new NativeGitService(depsFor(fixtures().own), { run: gitRunner() })
    const plan = await service.planPush()
    if (!plan.ok) {
      throw new Error('the own fixture stopped being ahead')
    }
    await service.push(plan)
    expect(await service.planPush()).toEqual({ ok: false, refusal: 'upToDate' })
    const sha = execFileSync(
      'git',
      ['--git-dir', fixtures().parentBare, 'rev-parse', 'refs/heads/feature'],
      {
        env: fixtures().environment,
        encoding: 'utf8',
      },
    ).trim()
    expect(sha).toMatch(/^[0-9a-f]{40}$/)
  })

  it('makes a first push track the remote branch', async () => {
    const direct = mkdtempSync(path.join(tmpdir(), 'm123-native-firstpush-'))
    try {
      const environment = fixtures().environment
      execFileSync('git', ['clone', '-q', fixtures().parentBare, direct], { env: environment })
      execFileSync('git', ['checkout', '-q', '-b', 'fresh'], { cwd: direct, env: environment })
      writeFileSync(path.join(direct, 'fresh.txt'), 'fresh\n')
      execFileSync('git', ['add', 'fresh.txt'], { cwd: direct, env: environment })
      execFileSync('git', ['commit', '-q', '-m', 'Fresh branch'], { cwd: direct, env: environment })
      const service = new NativeGitService(depsFor(direct), { run: gitRunner() })
      const plan = await service.planPush()
      expect(plan).toMatchObject({ ok: true, setUpstream: true })
      if (!plan.ok) {
        throw new Error('a fresh branch must plan a first push')
      }
      await service.push(plan)
      expect(
        execFileSync('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
          cwd: direct,
          env: environment,
          encoding: 'utf8',
        }).trim(),
      ).toBe('origin/fresh')
    } finally {
      rmSync(direct, { recursive: true, force: true })
    }
  })

  it('refuses a push whose refspec or remote is not plain, at the last line', async () => {
    const service = new NativeGitService(depsFor(fixtures().own), { run: gitRunner() })
    await expect(service.push({ ...okPlan(), refspec: '+feature' })).rejects.toThrow('refused')
    await expect(service.push({ ...okPlan(), remote: '-u' })).rejects.toThrow('refused')
  })

  it('commits staged and unstaged changes, and refuses a failing hook', async () => {
    const direct = mkdtempSync(path.join(tmpdir(), 'm123-native-commit-'))
    try {
      const environment = fixtures().environment
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: direct, env: environment })
      writeFileSync(path.join(direct, 'a.txt'), 'one\n')
      execFileSync('git', ['add', 'a.txt'], { cwd: direct, env: environment })
      execFileSync('git', ['commit', '-q', '-m', 'Add a'], { cwd: direct, env: environment })
      writeFileSync(path.join(direct, 'a.txt'), 'two\n')
      writeFileSync(path.join(direct, 'b.txt'), 'new\n')
      const service = new NativeGitService(depsFor(direct), { run: gitRunner() })
      const committed = await service.commit('Change a and add b', true)
      expect(committed).toEqual({ branch: 'main', subject: 'Change a and add b' })
      const { snapshot } = await service.status()
      expect([...snapshot.staged, ...snapshot.unstaged, ...snapshot.untracked]).toEqual([])
    } finally {
      rmSync(direct, { recursive: true, force: true })
    }
    const hooked = new NativeGitService(depsFor(fixtures().failingHook), { run: gitRunner() })
    writeFileSync(path.join(fixtures().failingHook, 'hooked.txt'), 'hooked\n')
    await expect(hooked.commit('Hooked change', true)).rejects.toThrow(/fixture hook refuses/)
  })

  it('refuses an empty message, a credential shape, and nothing to commit', async () => {
    const service = new NativeGitService(depsFor(fixtures().own), { run: gitRunner() })
    const problems: Record<string, string> = {}
    for (const [name, message, includeUnstaged] of [
      ['empty', ' '.repeat(3), false],
      ['credential', 'Ship ghp_abcdefghijklmnopqrstuvwxyz0123456789', false],
      ['staged', 'Nothing staged', false],
      ['committable', 'Nothing at all', true],
    ] as const) {
      try {
        await service.commit(message, includeUnstaged)
        throw new Error('must refuse')
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(CommitRefusedError)
        problems[name] = (error as CommitRefusedError).problem
      }
    }
    expect(problems).toEqual({
      empty: 'empty',
      credential: 'credentialShaped',
      staged: 'nothingStaged',
      committable: 'nothingToCommit',
    })
  })

  it('refuses a commit when the repository moved under the form', async () => {
    const direct = mkdtempSync(path.join(tmpdir(), 'm123-native-stamp-'))
    try {
      const environment = fixtures().environment
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: direct, env: environment })
      writeFileSync(path.join(direct, 'a.txt'), 'one\n')
      const service = new NativeGitService(depsFor(direct), { run: gitRunner() })
      await expect(service.commit('Stale form', true, '{"oid":"stale"}')).rejects.toThrow('changed')
    } finally {
      rmSync(direct, { recursive: true, force: true })
    }
  })

  it('refuses every entry while the editor calls the project untrusted', async () => {
    const deps = depsFor(fixtures().own, { isTrusted: () => false })
    const service = new NativeGitService(deps, { run: gitRunner() })
    await expect(service.status()).rejects.toThrow('untrusted')
    await expect(service.planPush()).rejects.toThrow('untrusted')
    await expect(service.commit('x', false)).rejects.toThrow('untrusted')
    await expect(service.push(okPlan())).rejects.toThrow('untrusted')
    await expect(service.fetch('origin')).rejects.toThrow('untrusted')
    await expect(service.resolveRoot()).rejects.toThrow('untrusted')
  })

  it('refuses a root that is not the repository git sees', async () => {
    const service = new NativeGitService(depsFor(tmpdir()), { run: gitRunner() })
    await expect(service.status()).rejects.toThrow()
  })

  it('fetches in the user environment', async () => {
    const service = new NativeGitService(depsFor(fixtures().behind), { run: gitRunner() })
    await expect(service.fetch('origin')).resolves.toBeUndefined()
    await expect(service.fetch('-evil')).rejects.toThrow('Refused')
  })

  it('checks a worktree out under the runtime data folder, confined', async () => {
    const service = new NativeGitService(depsFor(fixtures().own), { run: gitRunner() })
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: fixtures().own,
      env: fixtures().environment,
      encoding: 'utf8',
    }).trim()
    const wtPath = await service.addWorktree('wt-1', sha)
    try {
      const slashed = (folder: string): string => folder.replaceAll('\\', '/')
      const canonicalData = slashed(await canonicalPath(dataFolder))
      expect(slashed(wtPath).startsWith(`${canonicalData}/`)).toBe(true)
      expect(existsSync(wtPath)).toBe(true)
    } finally {
      execFileSync('git', ['worktree', 'remove', '--force', wtPath], {
        cwd: fixtures().own,
        env: fixtures().environment,
        stdio: 'ignore',
      })
    }
    await expect(service.addWorktree('../escape', sha)).rejects.toThrow('refused')
    await expect(service.addWorktree('-flag', sha)).rejects.toThrow('refused')
    await expect(service.addWorktree('wt-2', '--all')).rejects.toThrow('refused')
  })

  it('keeps the user environment through the real runner for a push and a fetch only', async () => {
    // End to end: hooks dump the environment git actually started with, so
    // the quiet strip (reads, commits) and the user's Git routes (push,
    // fetch) are proved on the child, not on an object handed to it.
    const direct = mkdtempSync(path.join(tmpdir(), 'm123-native-env-'))
    vi.stubEnv(QUIET_CANARY_ENV, 'quiet-canary')
    vi.stubEnv(MODEL_CANARY_ENV, 'model-canary')
    vi.stubEnv(GIT_ROUTE_ENV, 'route-canary')
    try {
      const environment = { ...fixtures().environment, ...process.env }
      execFileSync('git', ['clone', '-q', fixtures().parentBare, direct], { env: environment })
      // `/` separators: the hook's sh reads the path on Windows too.
      const dump = path.join(direct, 'hook-env.txt').replaceAll('\\', '/')
      const hook = `#!/bin/sh\nenv > "${dump}"\nexit 1\n`
      writeFileSync(path.join(direct, '.git', 'hooks', 'pre-commit'), hook, { mode: 0o755 })
      writeFileSync(path.join(direct, '.git', 'hooks', 'pre-push'), hook, { mode: 0o755 })
      const readDump = (): string => (existsSync(dump) ? readFileSync(dump, 'utf8') : '')
      const service = new NativeGitService(depsFor(direct), { run: gitRunner() })
      // A read carries no token variable of ours and never prompts.
      writeFileSync(path.join(direct, 'read.txt'), 'read\n')
      await expect(service.commit('Dump on read', true)).rejects.toThrow(/code 1/)
      const readEnv = readDump()
      expect(readEnv.includes(`${QUIET_CANARY_ENV}=`)).toBe(false)
      expect(readEnv.includes(`${MODEL_CANARY_ENV}=`)).toBe(false)
      expect(readEnv.includes(`${GIT_ROUTE_ENV}=`)).toBe(false)
      expect(readEnv.includes('GIT_TERMINAL_PROMPT=0')).toBe(true)
      // A push keeps the user's helpers, agent and Git token routes, still
      // without a prompt, and gains nothing of ours: no other credential (R3).
      execFileSync('git', ['commit', '-q', '--no-verify', '-m', 'For push'], {
        cwd: direct,
        env: environment,
      })
      const plan = await service.planPush()
      if (!plan.ok) {
        throw new Error('the scratch clone must be ahead for the push drill')
      }
      await expect(service.push(plan)).rejects.toThrow()
      const pushEnv = readDump()
      expect(pushEnv.includes(`${GIT_ROUTE_ENV}=`)).toBe(true)
      expect(pushEnv.includes(`${QUIET_CANARY_ENV}=`)).toBe(false)
      expect(pushEnv.includes(`${MODEL_CANARY_ENV}=`)).toBe(false)
      expect(pushEnv.includes('GIT_TERMINAL_PROMPT=0')).toBe(true)
      expect(pushEnv.includes('http.extraHeader')).toBe(false)
    } finally {
      rmSync(direct, { recursive: true, force: true })
    }
  })

  it('passes the window signal to every git it starts', async () => {
    const signals: (AbortSignal | undefined)[] = []
    const recording: GitProcess = (args, options: GitProcessOptions) => {
      signals.push(options.signal)
      return gitRunner()(args, options)
    }
    const controller = new AbortController()
    const deps = depsFor(fixtures().own, { signal: controller.signal })
    const service = new NativeGitService(deps, { run: recording })
    await service.status()
    await service.planPush()
    await service.fetch('origin')
    expect(signals.length > 0).toBe(true)
    for (const signal of signals) {
      expect(signal).toBe(controller.signal)
    }
  })

  it('stops a push when the window closes', async () => {
    const direct = mkdtempSync(path.join(tmpdir(), 'm123-native-abort-'))
    try {
      const environment = fixtures().environment
      execFileSync('git', ['clone', '-q', fixtures().parentBare, direct], { env: environment })
      execFileSync('git', ['checkout', '-q', '-b', 'slow'], { cwd: direct, env: environment })
      writeFileSync(path.join(direct, 'slow.txt'), 'slow\n')
      execFileSync('git', ['add', 'slow.txt'], { cwd: direct, env: environment })
      execFileSync('git', ['commit', '-q', '-m', 'Slow'], { cwd: direct, env: environment })
      // A short sleeper: Cancel kills git at once, and the run settles
      // once the orphaned hook drains (no tree-stop without admission).
      writeFileSync(path.join(direct, '.git', 'hooks', 'pre-push'), '#!/bin/sh\nsleep 1\n', {
        mode: 0o755,
      })
      const controller = new AbortController()
      const service = new NativeGitService(depsFor(direct, { signal: controller.signal }), {
        run: gitRunner(),
      })
      const plan = await service.planPush()
      if (!plan.ok) {
        throw new Error('the slow branch must plan a first push')
      }
      const pushing = service.push(plan)
      setTimeout(() => {
        controller.abort()
      }, 300).unref()
      // Cancel wins the race: killed mid-hook, or refused before spawn,
      // and either way reported as closed, never as git's failure.
      await expect(pushing).rejects.toThrow('closed')
      expect(controller.signal.aborted).toBe(true)
      const fresh = new NativeGitService(depsFor(direct), { run: gitRunner() })
      await expect(fresh.status()).resolves.toBeDefined()
    } finally {
      rmSync(direct, { recursive: true, force: true })
    }
  })

  /** A scratch repository with one commit and the given unstaged file. */
  function scratchRepository(folder: string, file: string, text: string): void {
    const environment = fixtures().environment
    mkdirSync(folder, { recursive: true })
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: folder, env: environment })
    writeFileSync(path.join(folder, 'base.txt'), 'base\n')
    execFileSync('git', ['add', 'base.txt'], { cwd: folder, env: environment })
    execFileSync('git', ['commit', '-q', '-m', 'Base'], { cwd: folder, env: environment })
    writeFileSync(path.join(folder, file), text)
  }

  function commitCount(folder: string): number {
    return Number(
      execFileSync('git', ['rev-list', '--count', 'HEAD'], {
        cwd: folder,
        env: fixtures().environment,
        encoding: 'utf8',
      }).trim(),
    )
  }

  /** The fixture runner, pausing before the second `status` and recording each git that reached its spawn. */
  function pausingRunner(): {
    readonly run: GitProcess
    readonly spawned: string[]
    readonly reached: Promise<undefined>
    readonly release: () => void
  } {
    const gate = Promise.withResolvers<undefined>()
    const atGate = Promise.withResolvers<undefined>()
    const spawned: string[] = []
    let statusCalls = 0
    const run: GitProcess = async (args, options) => {
      const [subcommand = ''] = args
      if (subcommand === 'status') {
        statusCalls += 1
        if (statusCalls === 1) {
          atGate.resolve(undefined)
          await gate.promise
        }
      }
      return await gitRunner()(args, {
        ...options,
        beforeRun: () => {
          options.beforeRun?.()
          spawned.push(subcommand)
        },
      })
    }
    return {
      run,
      spawned,
      reached: atGate.promise,
      release: () => {
        gate.resolve(undefined)
      },
    }
  }

  it('stops a pending commit when its operation is aborted: nothing is staged or committed', async () => {
    const base = mkdtempSync(path.join(tmpdir(), 'm123-native-opsignal-'))
    try {
      const dir = path.join(base, 'repo')
      scratchRepository(dir, 'a.txt', 'a\n')
      const paused = pausingRunner()
      const operation = new AbortController()
      const service = new NativeGitService(depsFor(dir), { run: paused.run })
      const committing = service.commit('Stopped', true, undefined, { signal: operation.signal })
      await paused.reached
      operation.abort()
      paused.release()
      await expect(committing).rejects.toThrow('closed')
      expect(paused.spawned).not.toContain('add')
      expect(paused.spawned).not.toContain('commit')
      expect(commitCount(dir)).toBe(1)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('stops a pending commit when its owner check fails: nothing is staged or committed', async () => {
    const base = mkdtempSync(path.join(tmpdir(), 'm123-native-opcheck-'))
    try {
      const dir = path.join(base, 'repo')
      scratchRepository(dir, 'a.txt', 'a\n')
      const paused = pausingRunner()
      let isMoved = false
      const service = new NativeGitService(depsFor(dir), { run: paused.run })
      const committing = service.commit('Moved on', true, undefined, {
        check: () => {
          if (isMoved) {
            throw new NativeGitRefusalError('changed')
          }
        },
      })
      await paused.reached
      isMoved = true
      paused.release()
      await expect(committing).rejects.toThrow('changed')
      expect(paused.spawned).not.toContain('add')
      expect(commitCount(dir)).toBe(1)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('stays bound to the root it was made with: a link or a new folder in its place is refused', async () => {
    const base = mkdtempSync(path.join(tmpdir(), 'm123-native-rebind-'))
    try {
      const original = path.join(base, 'repo')
      const other = path.join(base, 'other')
      scratchRepository(original, 'inside.txt', 'inside\n')
      scratchRepository(other, 'outside.txt', 'outside\n')
      const linked = new NativeGitService(depsFor(original), { run: gitRunner() })
      await expect(linked.status()).resolves.toBeDefined()
      // Rename the approved folder and put a link (a junction on Windows) to another repository in its place.
      renameSync(original, path.join(base, 'repo-moved'))
      symlinkSync(other, original, 'junction')
      await expect(linked.commit('Through the link', true)).rejects.toThrow('changed')
      expect(commitCount(other)).toBe(1)
      // A replacement folder at the same path is another directory too.
      removeLink(original)
      const replaced = new NativeGitService(depsFor(path.join(base, 'repo-moved')), {
        run: gitRunner(),
      })
      await expect(replaced.status()).resolves.toBeDefined()
      renameSync(path.join(base, 'repo-moved'), path.join(base, 'repo-gone'))
      scratchRepository(path.join(base, 'repo-moved'), 'impostor.txt', 'impostor\n')
      await expect(replaced.commit('Into the impostor', true)).rejects.toThrow('changed')
      expect(commitCount(path.join(base, 'repo-moved'))).toBe(1)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('refuses a worktree storage parent that leads outside the data folder', async () => {
    const data = mkdtempSync(path.join(tmpdir(), 'm123-native-data-link-'))
    const outside = mkdtempSync(path.join(tmpdir(), 'm123-native-outside-'))
    try {
      symlinkSync(outside, path.join(data, 'pr-worktrees'), 'junction')
      const service = new NativeGitService(depsFor(fixtures().own, { dataFolder: data }), {
        run: gitRunner(),
      })
      const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: fixtures().own,
        env: fixtures().environment,
        encoding: 'utf8',
      }).trim()
      await expect(service.addWorktree('wt-outside', sha)).rejects.toThrow('changed')
      expect(existsSync(path.join(outside, 'wt-outside'))).toBe(false)
    } finally {
      removeLink(path.join(data, 'pr-worktrees'))
      rmSync(data, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('runs the git the host resolved, not the one on PATH', async () => {
    const missing = path.join(tmpdir(), 'm123-no-such-git', 'bin', 'git')
    // The production runner: no `run` override.
    const service = new NativeGitService(depsFor(fixtures().own, { gitPath: missing }))
    const spy = vi.spyOn(launcher, 'execResourceFile')
    try {
      await expect(service.status()).rejects.toThrow('Governed command unavailable')
      // Asked for the missing git itself: never a PATH search instead.
      expect(spy.mock.calls[0]?.[1]).toBe(missing)
    } finally {
      spy.mockRestore()
    }
  })

  it('pushes in the user environment the host captured, not the scrubbed process one', async () => {
    const direct = mkdtempSync(path.join(tmpdir(), 'm123-native-userenv-'))
    try {
      const environment = fixtures().environment
      execFileSync('git', ['clone', '-q', fixtures().parentBare, direct], { env: environment })
      execFileSync('git', ['checkout', '-q', '-b', 'routed'], { cwd: direct, env: environment })
      writeFileSync(path.join(direct, 'routed.txt'), 'routed\n')
      execFileSync('git', ['add', 'routed.txt'], { cwd: direct, env: environment })
      execFileSync('git', ['commit', '-q', '-m', 'Routed'], { cwd: direct, env: environment })
      const pushEnvs: NodeJS.ProcessEnv[] = []
      const readEnvs: NodeJS.ProcessEnv[] = []
      const recording: GitProcess = (args, options) => {
        ;(args[0] === 'push' ? pushEnvs : readEnvs).push(options.env)
        return gitRunner()(args, options)
      }
      const captured = {
        ...process.env,
        [GIT_ROUTE_ENV]: 'route',
        [MODEL_CANARY_ENV]: 'model',
        M123_G_USER_ROUTE_TOKEN: 'not-a-git-route',
      }
      const service = new NativeGitService(depsFor(direct, { userEnvironment: () => captured }), {
        run: recording,
      })
      const plan = await service.planPush()
      if (!plan.ok) {
        throw new Error('the routed branch must plan a first push')
      }
      await service.push(plan)
      expect(pushEnvs).toHaveLength(1)
      const pushed = Object.keys(pushEnvs[0] ?? {})
      expect(pushed).toContain(GIT_ROUTE_ENV)
      // R3: only the Git routes, even when the host hands over more.
      expect(pushed).not.toContain(MODEL_CANARY_ENV)
      expect(pushed).not.toContain('M123_G_USER_ROUTE_TOKEN')
      for (const env of readEnvs) {
        expect(Object.keys(env)).not.toContain(GIT_ROUTE_ENV)
      }
    } finally {
      rmSync(direct, { recursive: true, force: true })
    }
  })
})

describe('the standalone runtime’s captured Git routes', () => {
  it('keeps the Git routes taken at start for the push, never a model or provider key', () => {
    const env: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      GH_TOKEN: 'route-a',
      GITHUB_TOKEN: 'route-b',
      META_API_KEY: 'model-key',
      OPENAI_API_KEY: 'model-key',
      HF_TOKEN: 'provider-key',
      // R3: the aliases the earlier filter put back.
      OPENAI_KEY: 'model-key',
      ANTHROPIC_KEY: 'model-key',
      META_KEY: 'model-key',
      GEMINI_KEY: 'model-key',
      ANTHROPIC_AUTH_TOKEN: 'provider-key',
      AWS_BEARER_TOKEN_BEDROCK: 'provider-key',
      NPM_TOKEN: 'other-key',
    }
    try {
      keepGitCredentialRoutes(takeCredentials(env))
      // Taken out of the runtime's own environment at start…
      expect(sortedEnvNames(Object.keys(env))).toEqual(['PATH'])
      // …and only the Git routes come back, for the push and the fetch.
      expect(sortedEnvNames(Object.keys(runtimeGitUserEnvironment(env)))).toEqual(
        sortedEnvNames(['GH_TOKEN', 'GITHUB_TOKEN', 'PATH']),
      )
    } finally {
      keepGitCredentialRoutes([])
    }
  })
})

/**
 * Real git behind the launcher spy: the spy records the governed call
 * (profile, file, arguments) while git itself runs ungoverned. The
 * governor's own admission is its suites' subject, not this one's.
 */
function emulateGit(): void {
  vi.spyOn(launcher, 'execResourceFile').mockImplementation(
    async (_profile, file, args, options) =>
      await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        execFile(
          file,
          [...args],
          {
            cwd: options.cwd,
            env: options.env,
            timeout: options.timeout,
            maxBuffer: options.maxBuffer,
            windowsHide: true,
            signal: options.signal,
          },
          (error, stdout, stderr) => {
            if (error === null) {
              resolve({ stdout, stderr })
              return
            }
            const code = 'code' in error && typeof error.code === 'number' ? error.code : -1
            reject(Object.assign(new Error('Governed command failed'), { stdout, stderr, code }))
          },
        )
      }),
  )
}

function governedService(dir: string): NativeGitService {
  return new NativeGitService(
    fakeRuntimeGitDeps(dir, { gitPath: hostGitPath(), isTrusted: () => true }).deps,
  )
}

describe('the governed launch (train spawn inventory)', () => {
  beforeEach(() => {
    isolateGitEnvironment()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('runs reads through the probe profile, with the hosted git', async () => {
    const scratch = dirtyScratchRepository('m123-governed-reads-')
    emulateGit()
    try {
      const { snapshot } = await governedService(scratch.dir).status()
      expect(snapshot.branch).toBe('main')
      const spy = vi.mocked(launcher.execResourceFile)
      expect(spy).toHaveBeenCalled()
      for (const [profile, file] of spy.mock.calls) {
        expect(profile).toBe('probe')
        expect(file).toBe(hostGitPath())
      }
    } finally {
      vi.restoreAllMocks()
      scratch.cleanup()
    }
  })

  it('runs writes through the contained profile and reads through probe', async () => {
    const scratch = dirtyScratchRepository('m123-governed-writes-')
    emulateGit()
    try {
      const { branch } = await governedService(scratch.dir).commit('Governed write', true)
      expect(branch).toBe('main')
      const launches = vi.mocked(launcher.execResourceFile).mock.calls.map(([profile, , args]) => ({
        profile,
        subcommand: args[0] ?? '',
      }))
      expect(launches).toContainEqual({ profile: 'contained', subcommand: 'add' })
      expect(launches).toContainEqual({ profile: 'contained', subcommand: 'commit' })
      for (const launch of launches) {
        const isWrite = launch.subcommand === 'add' || launch.subcommand === 'commit'
        expect(launch.profile).toBe(isWrite ? 'contained' : 'probe')
      }
    } finally {
      vi.restoreAllMocks()
      scratch.cleanup()
    }
  })

  it('reports a refused launch as busy, never as git’s failure', async () => {
    const scratch = dirtyScratchRepository('m123-governed-busy-')
    vi.spyOn(launcher, 'execResourceFile').mockRejectedValue(new ResourcePausedError())
    try {
      const service = governedService(scratch.dir)
      await expect(service.status()).rejects.toBeInstanceOf(NativeGitRefusalError)
      let refusal: ReturnType<typeof refusalOf> = undefined
      try {
        await service.status()
      } catch (error: unknown) {
        refusal = refusalOf(error)
      }
      expect(refusal).toBe('busy')
      expect(vi.mocked(launcher.execResourceFile)).toHaveBeenCalled()
    } finally {
      vi.restoreAllMocks()
      scratch.cleanup()
    }
  })

  it('keeps a non-zero exit as git’s own exit error', async () => {
    const scratch = dirtyScratchRepository('m123-governed-exit-')
    vi.spyOn(launcher, 'execResourceFile').mockRejectedValue(
      Object.assign(new Error('Governed command failed'), {
        stdout: '',
        stderr: 'fatal: not a git repository',
        code: 128,
      }),
    )
    try {
      let failure: unknown
      try {
        await governedService(scratch.dir).status()
      } catch (error: unknown) {
        failure = error
      }
      expect(isGitExitError(failure)).toBe(true)
      expect(refusalOf(failure)).toBeUndefined()
    } finally {
      vi.restoreAllMocks()
      scratch.cleanup()
    }
  })
})
