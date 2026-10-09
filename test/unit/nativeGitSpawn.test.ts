// The runtime Git service at the spawn boundary (M123 lane G, RVM123G):
// trust rechecked at the actual spawn after admission (#3), the governed
// Windows job keeping D104's user environment for a push (#10), the git the
// host resolved and nothing else on PATH (#12), and git's stderr never
// ending in a credential cut short (#5). Admission and the job launch are
// spied, as spawnGovernance.test.ts does; secret names are asserted, never
// values.

import type * as ChildProcess from 'node:child_process'
import { execFileSync, spawn } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  renameSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as admission from '../../src/core/resources/admission'
import * as jobLaunch from '../../src/host/backend/mcpJobLaunch'
import type { ResourceLease } from '../../src/core/resources/launch'
import { resolveExecutable } from '../../src/core/executables'
import {
  cappedStderr,
  createGitProcess,
  GitMissingError,
  processGitPath,
  type GitProcess,
} from '../../src/host/git'
import { NativeGitService } from '../../src/runtime/panel/git/service'
import { fakeRuntimeGitDeps } from './helpers/github/fakes'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>()
  return { ...actual, spawn: vi.fn(actual.spawn) }
})
vi.mock('../../src/core/resources/admission', { spy: true })
vi.mock('../../src/host/backend/mcpJobLaunch', { spy: true })

const USER_ROUTE = 'GH_TOKEN'

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(spawn).mockClear()
})

function realGit(): string {
  const found = resolveExecutable('git', {
    platform: process.platform,
    pathVariable: process.env['PATH'],
    fileExists: existsSync,
  })
  if (found === undefined) {
    throw new Error('the tests need git on PATH')
  }
  return found
}

/** A scratch repository with one commit and one unstaged change. */
function dirtyRepository(): { readonly dir: string; readonly cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'm123-native-spawn-'))
  const environment = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  }
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env: environment })
  writeFileSync(path.join(dir, 'a.txt'), 'one\n')
  execFileSync('git', ['add', 'a.txt'], { cwd: dir, env: environment })
  execFileSync('git', ['commit', '-q', '-m', 'Add a'], { cwd: dir, env: environment })
  writeFileSync(path.join(dir, 'a.txt'), 'two\n')
  return {
    dir,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

function spawnedSubcommands(): string[] {
  return vi.mocked(spawn).mock.calls.map(([, args]) => (Array.isArray(args) ? String(args[0]) : ''))
}

describe('the spawn boundary', () => {
  it('rechecks trust after admission, so a revoked trust starts no git add', async () => {
    const scratch = dirtyRepository()
    try {
      let isTrusted = true
      let shouldGateNext = false
      const admitted = Promise.withResolvers<undefined>()
      const atGate = Promise.withResolvers<undefined>()
      vi.spyOn(admission, 'admitResource').mockImplementation(async () => {
        if (shouldGateNext) {
          shouldGateNext = false
          atGate.resolve(undefined)
          await admitted.promise
        }
        return undefined
      })
      const real = createGitProcess({
        platform: process.platform,
        env: process.env,
        fileExists: existsSync,
        spawn,
      })
      const run: GitProcess = (args, options) => {
        // Only `add` waits in admission; the flag is read synchronously by it.
        shouldGateNext = args[0] === 'add'
        return real(args, options)
      }
      const { deps } = fakeRuntimeGitDeps(scratch.dir, { isTrusted: () => isTrusted })
      const service = new NativeGitService(deps, { run })
      const committing = service.commit('Never staged', true)
      await atGate.promise
      isTrusted = false
      admitted.resolve(undefined)
      await expect(committing).rejects.toThrow('untrusted')
      expect(spawnedSubcommands()).not.toContain('add')
      expect(spawnedSubcommands()).not.toContain('commit')
    } finally {
      scratch.cleanup()
    }
  })

  it('refuses at the spawn a root swapped for a link while git waited for admission', async () => {
    const original = dirtyRepository()
    const other = dirtyRepository()
    const moved = `${original.dir}-moved`
    try {
      writeFileSync(path.join(other.dir, 'b.txt'), 'outside\n')
      let shouldGateNext = false
      const admitted = Promise.withResolvers<undefined>()
      const atGate = Promise.withResolvers<undefined>()
      vi.spyOn(admission, 'admitResource').mockImplementation(async () => {
        if (shouldGateNext) {
          shouldGateNext = false
          atGate.resolve(undefined)
          await admitted.promise
        }
        return undefined
      })
      const real = createGitProcess({
        platform: process.platform,
        env: process.env,
        fileExists: existsSync,
        spawn,
      })
      const run: GitProcess = (args, options) => {
        shouldGateNext = args[0] === 'add'
        return real(args, options)
      }
      const service = new NativeGitService(fakeRuntimeGitDeps(original.dir).deps, { run })
      const committing = service.commit('Into the other', true)
      await atGate.promise
      // Every check before admission passed; the folder is swapped now.
      renameSync(original.dir, moved)
      symlinkSync(other.dir, original.dir, 'junction')
      admitted.resolve(undefined)
      await expect(committing).rejects.toThrow('changed')
      expect(spawnedSubcommands()).not.toContain('add')
      // Nothing was staged in the other repository.
      expect(
        execFileSync('git', ['diff', '--cached', '--name-only'], {
          cwd: other.dir,
          encoding: 'utf8',
        }).trim(),
      ).toBe('')
    } finally {
      if (lstatSync(original.dir, { throwIfNoEntry: false })?.isSymbolicLink() === true) {
        try {
          unlinkSync(original.dir)
        } catch {
          rmdirSync(original.dir)
        }
      }
      rmSync(moved, { recursive: true, force: true })
      original.cleanup()
      other.cleanup()
    }
  })

  it('refuses at the spawn a worktree storage parent swapped for a link during admission', async () => {
    const scratch = dirtyRepository()
    const data = mkdtempSync(path.join(tmpdir(), 'm123-native-data-swap-'))
    const outside = mkdtempSync(path.join(tmpdir(), 'm123-native-outside-swap-'))
    const parent = path.join(data, 'pr-worktrees')
    try {
      const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: scratch.dir,
        encoding: 'utf8',
      }).trim()
      let shouldGateNext = false
      const admitted = Promise.withResolvers<undefined>()
      const atGate = Promise.withResolvers<undefined>()
      vi.spyOn(admission, 'admitResource').mockImplementation(async () => {
        if (shouldGateNext) {
          shouldGateNext = false
          atGate.resolve(undefined)
          await admitted.promise
        }
        return undefined
      })
      const real = createGitProcess({
        platform: process.platform,
        env: process.env,
        fileExists: existsSync,
        spawn,
      })
      const run: GitProcess = (args, options) => {
        shouldGateNext = args[0] === 'worktree'
        return real(args, options)
      }
      const { deps } = fakeRuntimeGitDeps(scratch.dir, { dataFolder: data })
      const service = new NativeGitService(deps, { run })
      const adding = service.addWorktree('wt-swapped', sha)
      await atGate.promise
      // The parent was a real folder when confined; now it leads outside.
      renameSync(parent, `${parent}-old`)
      symlinkSync(outside, parent, 'junction')
      admitted.resolve(undefined)
      await expect(adding).rejects.toThrow('changed')
      expect(existsSync(path.join(outside, 'wt-swapped'))).toBe(false)
    } finally {
      if (lstatSync(parent, { throwIfNoEntry: false })?.isSymbolicLink() === true) {
        try {
          unlinkSync(parent)
        } catch {
          rmdirSync(parent)
        }
      }
      rmSync(data, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
      scratch.cleanup()
    }
  })

  it('keeps the user environment for a push in the governed Windows job too', async () => {
    const lease: ResourceLease = {
      register: vi.fn(),
      complete: vi.fn(),
      background: vi.fn(),
      kill: vi.fn(() => Promise.resolve(true)),
      isTreeGone: vi.fn(() => Promise.resolve(true)),
    }
    vi.spyOn(admission, 'admitResource').mockResolvedValue(lease)
    vi.spyOn(admission, 'resourceWindowsJob').mockResolvedValue({
      assemblyPath: String.raw`C:\job\MuseSparkMcpJob.dll`,
      executablePath: String.raw`C:\job\MuseSparkMcpLauncher.exe`,
      verify: () => Promise.resolve(),
    })
    const launched: NodeJS.ProcessEnv[] = []
    vi.spyOn(jobLaunch, 'spawnMcpJob').mockImplementation((launch) => {
      launched.push(launch.env)
      // A real child that exits at once, standing in for the launcher.
      return spawn(process.execPath, ['-e', ''], { stdio: 'pipe' })
    })
    const run = createGitProcess({
      platform: 'win32',
      env: { PATH: String.raw`C:\Program Files\Git\cmd` },
      fileExists: () => true,
      spawn,
    })
    const userEnv = { [USER_ROUTE]: 'route-value', PATH: String.raw`C:\Git\cmd` }
    await run(['push', 'origin', 'main'], {
      cwd: tmpdir(),
      env: userEnv,
      timeoutMs: 10_000,
      isUserEnvironment: true,
    })
    await run(['status'], { cwd: tmpdir(), env: userEnv, timeoutMs: 10_000 })
    expect(launched).toHaveLength(2)
    expect(Object.keys(launched[0] ?? {})).toContain(USER_ROUTE)
    expect(launched[0]?.['GIT_TERMINAL_PROMPT']).toBe('0')
    // Every other git keeps the quiet strip on the same route.
    expect(Object.keys(launched[1] ?? {})).not.toContain(USER_ROUTE)
  })

  it('runs the git the caller resolved, never a PATH search, and refuses a relative one', async () => {
    const scratch = dirtyRepository()
    try {
      vi.spyOn(admission, 'admitResource').mockResolvedValue(undefined)
      const pinned = createGitProcess({
        platform: process.platform,
        env: { PATH: '' },
        fileExists: () => false,
        spawn,
        executable: realGit(),
      })
      await expect(
        pinned(['rev-parse', '--show-toplevel'], {
          cwd: scratch.dir,
          env: process.env,
          timeoutMs: 10_000,
        }),
      ).resolves.toBeInstanceOf(Buffer)
      expect(vi.mocked(spawn).mock.calls.at(-1)?.[0]).toBe(realGit())
      // The native route's lookup is the same D24 search.
      expect(processGitPath()).toBe(realGit())
      const relative = createGitProcess({
        platform: process.platform,
        env: process.env,
        fileExists: existsSync,
        spawn,
        executable: 'git',
      })
      await expect(
        relative(['rev-parse', '--show-toplevel'], {
          cwd: scratch.dir,
          env: process.env,
          timeoutMs: 10_000,
        }),
      ).rejects.toBeInstanceOf(GitMissingError)
    } finally {
      scratch.cleanup()
    }
  })
})

describe('cappedStderr', () => {
  it('drops the partial last word once the cap cut it, never a whole one before it', () => {
    expect(cappedStderr('fatal: GITHUB_TOKEN=abcdefgh', true)).toBe('fatal: ')
    expect(cappedStderr('fatal: bad thing\n', true)).toBe('fatal: bad thing\n')
    expect(cappedStderr('fatal: GITHUB_TOKEN=abcdefgh', false)).toBe('fatal: GITHUB_TOKEN=abcdefgh')
    expect(cappedStderr('opaque-without-space', true)).toBe('')
  })
})
