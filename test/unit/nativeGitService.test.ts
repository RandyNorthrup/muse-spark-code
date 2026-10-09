// The runtime Git service (M123 lane G, PLAN.md D104): the argument
// allowlist, the push/fetch environment rule, and status, commit, push,
// fetch and worktrees on lane 0's fixture repositories. Pushes go to
// local bare repositories through `insteadOf`, so no network is touched.
// Secret names are asserted, never values: a failing assertion must not
// print a canary.

import path from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { canonicalPath } from '../../src/host/canonicalPath'
import { createGitProcess, type GitProcess, type GitProcessOptions } from '../../src/host/git'
import {
  assertNativeGitArgs,
  CommitRefusedError,
  nativeFetchArgs,
  nativePushArgs,
  nativePushEnvironment,
  nativePushTerminalCommand,
  nativeWorktreeAddArgs,
  NativeGitService,
} from '../../src/runtime/panel/git/service'
import type { PushPlan } from '../../src/core/git/pushPlan'
import { fakeRuntimeGitDeps } from './helpers/github/fakes'
import { createFixtureRepositories, type FixtureRepositories } from './helpers/github/repositories'
import type { RuntimeGitDeps } from '../../src/core/git/runtimeGit'

const QUIET_CANARY_ENV = 'M123_G_TEST_QUIET_CANARY_TOKEN'
const PUSH_CANARY_ENV = 'M123_G_TEST_PUSH_CANARY_TOKEN'

function sortedEnvNames(keys: readonly string[]): readonly string[] {
  return keys.toSorted((left, right) => left.localeCompare(right))
}

function okPlan(): Extract<PushPlan, { ok: true }> {
  return {
    ok: true,
    remote: 'origin',
    remoteUrl: 'https://github.com/o/r.git',
    branch: 'feature',
    target: 'feature',
    refspec: 'feature',
    setUpstream: false,
    commits: 1,
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
      ['rev-parse', '--show-toplevel'],
      ['config', '--get', 'commit.gpgsign'],
      ['config', '--get', 'remote.origin.url'],
      ['config', '--get', 'remote.origin.pushurl'],
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
    expect(nativePushTerminalCommand(okPlan())[0]).toBe('git')
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
  it('keeps the user environment and stops at no prompt', () => {
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

  it('plans the own fixture as a plain push of one commit', async () => {
    const service = new NativeGitService(depsFor(fixtures().own), { run: gitRunner() })
    expect(await service.planPush()).toEqual({
      ok: true,
      remote: 'origin',
      remoteUrl: expect.stringContaining('github.com'),
      branch: 'feature',
      target: 'feature',
      refspec: 'feature',
      setUpstream: false,
      commits: 1,
    })
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
    // the quiet strip (reads, commits) and the user pass-through (push,
    // fetch) are proved on the child, not on an object handed to it.
    const direct = mkdtempSync(path.join(tmpdir(), 'm123-native-env-'))
    const previousQuiet = process.env[QUIET_CANARY_ENV]
    const previousPush = process.env[PUSH_CANARY_ENV]
    process.env[QUIET_CANARY_ENV] = 'quiet-canary'
    process.env[PUSH_CANARY_ENV] = 'push-canary'
    try {
      const environment = { ...fixtures().environment, ...process.env }
      execFileSync('git', ['clone', '-q', fixtures().parentBare, direct], { env: environment })
      const dump = path.join(direct, 'hook-env.txt')
      const hook = `#!/bin/sh\nenv > "${dump}"\nexit 1\n`
      writeFileSync(path.join(direct, '.git', 'hooks', 'pre-commit'), hook, { mode: 0o755 })
      writeFileSync(path.join(direct, '.git', 'hooks', 'pre-push'), hook, { mode: 0o755 })
      const readDump = (): string => {
        try {
          return execFileSync('cat', [dump], { encoding: 'utf8' })
        } catch {
          return ''
        }
      }
      const service = new NativeGitService(depsFor(direct), { run: gitRunner() })
      // A read carries no token variable of ours and never prompts.
      writeFileSync(path.join(direct, 'read.txt'), 'read\n')
      await expect(service.commit('Dump on read', true)).rejects.toThrow(/code 1/)
      const readEnv = readDump()
      expect(readEnv.includes(`${QUIET_CANARY_ENV}=`)).toBe(false)
      expect(readEnv.includes(`${PUSH_CANARY_ENV}=`)).toBe(false)
      expect(readEnv.includes('GIT_TERMINAL_PROMPT=0')).toBe(true)
      // A push keeps the user's helpers, agent and token variables, still
      // without a prompt, and gains nothing of ours.
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
      expect(pushEnv.includes(`${QUIET_CANARY_ENV}=quiet-canary`)).toBe(true)
      expect(pushEnv.includes(`${PUSH_CANARY_ENV}=push-canary`)).toBe(true)
      expect(pushEnv.includes('GIT_TERMINAL_PROMPT=0')).toBe(true)
      expect(pushEnv.includes('http.extraHeader')).toBe(false)
    } finally {
      if (previousQuiet === undefined) {
        Reflect.deleteProperty(process.env, QUIET_CANARY_ENV)
      } else {
        process.env[QUIET_CANARY_ENV] = previousQuiet
      }
      if (previousPush === undefined) {
        Reflect.deleteProperty(process.env, PUSH_CANARY_ENV)
      } else {
        process.env[PUSH_CANARY_ENV] = previousPush
      }
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
      const pushing = service.push({
        ...okPlan(),
        branch: 'slow',
        target: 'slow',
        refspec: 'slow',
        setUpstream: true,
        commits: 1,
      })
      setTimeout(() => {
        controller.abort()
      }, 300).unref()
      // Cancel wins the race: killed mid-hook, or refused before spawn.
      await expect(pushing).rejects.toThrow(/closing|stopped/)
      expect(controller.signal.aborted).toBe(true)
      const fresh = new NativeGitService(depsFor(direct), { run: gitRunner() })
      await expect(fresh.status()).resolves.toBeDefined()
    } finally {
      rmSync(direct, { recursive: true, force: true })
    }
  })
})
