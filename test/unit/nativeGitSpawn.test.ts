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
import { createConnection } from 'node:net'
import * as z from 'zod/mini'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as admission from '../../src/core/resources/admission'
import * as jobLaunch from '../../src/host/backend/mcpJobLaunch'
import type { ResourceLease } from '../../src/core/resources/launch'
import {
  cappedStderr,
  createGitProcess,
  GitMissingError,
  processGitPath,
  type GitProcess,
} from '../../src/host/git'
import {
  fixedGitLocator,
  NativeGitRefusalError,
  NativeGitService,
} from '../../src/runtime/panel/git/service'
import { environmentValue } from '../../src/core/backends/musecode/launch'
import { GIT_PUSH_CREDENTIAL_VARIABLES, MCP_JOB_CONFIG_VARIABLE } from '../../src/shared/constants'
import type { RuntimeGitDeps } from '../../src/core/git/runtimeGit'
import {
  dirtyScratchRepository,
  fakeRuntimeGitDeps,
  hostGitPath,
  isolateGitEnvironment,
  TEST_GIT_IDENTITY,
} from './helpers/github/fakes'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>()
  return { ...actual, spawn: vi.fn(actual.spawn) }
})
vi.mock('../../src/core/resources/admission', { spy: true })
vi.mock('../../src/host/backend/mcpJobLaunch', { spy: true })

const USER_ROUTE = 'GH_TOKEN'
/** RVM123G2 R3's list: every model or provider key the earlier push environment kept. */
const MODEL_KEYS = [
  'META_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_KEY',
  'ANTHROPIC_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'HF_TOKEN',
  'META_KEY',
  'GEMINI_KEY',
] as const

// Every git here commits as the test's own identity, never the machine's (R12).
beforeEach(() => {
  isolateGitEnvironment()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.mocked(spawn).mockClear()
})

/**
 * The real runner, with `subcommand`'s resource admission held open until
 * released: the last wait before git starts.
 */
function admissionGate(subcommand: string): {
  readonly run: GitProcess
  readonly reached: Promise<undefined>
  readonly release: () => void
} {
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
  return {
    run: (args, options) => {
      shouldGateNext = args[0] === subcommand
      return real(args, options)
    },
    reached: atGate.promise,
    release: () => {
      admitted.resolve(undefined)
    },
  }
}

function scratchGit(dir: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: dir,
    env: { ...process.env, ...TEST_GIT_IDENTITY },
    encoding: 'utf8',
  })
}

/** Removes a link or junction itself, never what it leads to. */
function removeLink(link: string): void {
  if (lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() !== true) {
    return
  }
  try {
    unlinkSync(link)
  } catch {
    rmdirSync(link)
  }
}

function realGit(): string {
  return hostGitPath()
}

/** A scratch repository with one commit and one unstaged change. */
function dirtyRepository(): { readonly dir: string; readonly cleanup: () => void } {
  return dirtyScratchRepository('m123-native-spawn-')
}

function spawnedSubcommands(): string[] {
  return vi.mocked(spawn).mock.calls.map(([, args]) => (Array.isArray(args) ? String(args[0]) : ''))
}

/** A service on `dir` whose `subcommand` waits in its resource admission until released. */
function gatedService(
  dir: string,
  subcommand: string,
  overrides: Partial<RuntimeGitDeps> = {},
): { readonly gate: ReturnType<typeof admissionGate>; readonly service: NativeGitService } {
  const gate = admissionGate(subcommand)
  const service = new NativeGitService(fakeRuntimeGitDeps(dir, overrides).deps, { run: gate.run })
  return { gate, service }
}

/** The governed Windows route: an admitted lease and a prepared job helper. */
function governedWindowsJob(): void {
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
}

/** The commit was refused at its spawn: no commit ran, HEAD is still `Add a`. */
async function expectNoCommit(committing: Promise<unknown>, dir: string): Promise<void> {
  await expect(committing).rejects.toThrow('changed')
  expect(spawnedSubcommands()).not.toContain('commit')
  expect(scratchGit(dir, 'log', '-1', '--format=%s').trim()).toBe('Add a')
}

describe('the spawn boundary', () => {
  it('rechecks trust after admission, so a revoked trust starts no git add', async () => {
    const scratch = dirtyRepository()
    try {
      let isTrusted = true
      const { gate, service } = gatedService(scratch.dir, 'add', { isTrusted: () => isTrusted })
      const committing = service.commit('Never staged', true)
      await gate.reached
      isTrusted = false
      gate.release()
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
      const { gate, service } = gatedService(original.dir, 'add')
      const committing = service.commit('Into the other', true)
      await gate.reached
      // Every check before admission passed; the folder is swapped now.
      renameSync(original.dir, moved)
      symlinkSync(other.dir, original.dir, 'junction')
      gate.release()
      await expect(committing).rejects.toThrow('changed')
      expect(spawnedSubcommands()).not.toContain('add')
      // Nothing was staged in the other repository.
      expect(scratchGit(other.dir, 'diff', '--cached', '--name-only').trim()).toBe('')
    } finally {
      removeLink(original.dir)
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
      const sha = scratchGit(scratch.dir, 'rev-parse', 'HEAD').trim()
      const { gate, service } = gatedService(scratch.dir, 'worktree', { dataFolder: data })
      const adding = service.addWorktree('wt-swapped', sha)
      await gate.reached
      // The parent was a real folder when confined; now it leads outside.
      renameSync(parent, `${parent}-old`)
      symlinkSync(outside, parent, 'junction')
      gate.release()
      await expect(adding).rejects.toThrow('changed')
      expect(existsSync(path.join(outside, 'wt-swapped'))).toBe(false)
    } finally {
      removeLink(parent)
      rmSync(data, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
      scratch.cleanup()
    }
  })

  it('keeps the user environment for a push in the governed Windows job too', async () => {
    governedWindowsJob()
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
    const userEnv = {
      [USER_ROUTE]: 'route-value',
      PATH: String.raw`C:\Git\cmd`,
      // R3: model and provider keys under every alias never reach a push.
      ...Object.fromEntries(MODEL_KEYS.map((name) => [name, 'model-value'])),
    }
    await run(['push', 'origin', 'main'], {
      cwd: tmpdir(),
      env: userEnv,
      timeoutMs: 10_000,
      credentialRoutes: GIT_PUSH_CREDENTIAL_VARIABLES,
    })
    await run(['status'], { cwd: tmpdir(), env: userEnv, timeoutMs: 10_000 })
    expect(launched).toHaveLength(2)
    expect(Object.keys(launched[0] ?? {})).toContain(USER_ROUTE)
    expect(launched[0]?.['GIT_TERMINAL_PROMPT']).toBe('0')
    for (const name of MODEL_KEYS) {
      expect(Object.keys(launched[0] ?? {})).not.toContain(name)
    }
    // Every other git keeps the quiet strip on the same route.
    expect(Object.keys(launched[1] ?? {})).not.toContain(USER_ROUTE)
  })

  it('R3: gives a push on the direct route the Git routes and no model or provider key', async () => {
    vi.spyOn(admission, 'admitResource').mockResolvedValue(undefined)
    const run = createGitProcess({
      platform: process.platform,
      env: process.env,
      fileExists: existsSync,
      spawn,
    })
    const userEnv = {
      ...process.env,
      [USER_ROUTE]: 'route-value',
      ...Object.fromEntries(MODEL_KEYS.map((name) => [name, 'model-value'])),
    }
    const scratch = mkdtempSync(path.join(tmpdir(), 'm123-native-spawn-env-'))
    try {
      // Not a repository: git fails, after it started with the environment.
      await expect(
        run(['push', 'origin', 'main'], {
          cwd: scratch,
          env: userEnv,
          timeoutMs: 10_000,
          credentialRoutes: GIT_PUSH_CREDENTIAL_VARIABLES,
        }),
      ).rejects.toThrow()
      const spawnOptions = vi.mocked(spawn).mock.calls.at(-1)?.[2]
      const names = Object.keys(spawnOptions?.env ?? {})
      expect(names).toContain(USER_ROUTE)
      for (const name of MODEL_KEYS) {
        expect(names).not.toContain(name)
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
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
        locate: fixedGitLocator(process.platform, realGit()),
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
        locate: fixedGitLocator(process.platform, 'git'),
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

/** A scratch repository one commit ahead of its bare origin, and the folder holding its remotes. */
interface AheadScratch {
  readonly dir: string
  readonly remotes: string
  readonly origin: string
  readonly unapproved: string
}

/**
 * A confirmed push held in its last wait (the runner's admission, after the
 * revalidation) while `move` changes where git would send it: the spawn
 * must refuse it, and nothing may reach the unapproved remote.
 */
async function expectMovedDestinationRefused(
  prepare: (scratch: AheadScratch) => void,
  move: (scratch: AheadScratch) => void,
): Promise<void> {
  const repository = dirtyRepository()
  const remotes = mkdtempSync(path.join(tmpdir(), 'm123-native-spawn-remotes-'))
  const scratch: AheadScratch = {
    dir: repository.dir,
    remotes,
    origin: path.join(remotes, 'origin.git'),
    unapproved: path.join(remotes, 'unapproved.git'),
  }
  try {
    scratchGit(remotes, 'init', '-q', '--bare', scratch.origin)
    scratchGit(remotes, 'init', '-q', '--bare', scratch.unapproved)
    scratchGit(scratch.dir, 'remote', 'add', 'origin', scratch.origin)
    scratchGit(scratch.dir, 'push', '-q', '-u', 'origin', 'main')
    scratchGit(scratch.dir, 'commit', '-q', '-am', 'Two')
    prepare(scratch)
    const { gate, service } = gatedService(scratch.dir, 'push')
    const plan = await service.planPush()
    if (!plan.ok) {
      throw new Error('the scratch repository must be ahead')
    }
    const pushing = service.push(plan)
    await gate.reached
    move(scratch)
    gate.release()
    await expect(pushing).rejects.toThrow('changed')
    expect(spawnedSubcommands()).not.toContain('push')
    expect(scratchGit(scratch.unapproved, 'for-each-ref').trim()).toBe('')
  } finally {
    rmSync(remotes, { recursive: true, force: true })
    repository.cleanup()
  }
}

/** Whether this machine lets a test make a file link (Windows needs the privilege or Developer Mode). */
function canLinkFiles(): boolean {
  const probe = mkdtempSync(path.join(tmpdir(), 'm123-native-link-probe-'))
  try {
    writeFileSync(path.join(probe, 'target'), '')
    symlinkSync(path.join(probe, 'target'), path.join(probe, 'link'), 'file')
    return true
  } catch {
    return false
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
}

/** A git configuration file pushing `origin` to `url` (`/` separators: git reads `\` as an escape). */
function pushUrlConfig(url: string): string {
  return `[remote "origin"]\n\tpushurl = ${url.replaceAll('\\', '/')}\n`
}

describe('the final revalidation at the spawn (RVM123G2)', () => {
  it('R2: refuses at the spawn a push whose destination changed during its admission', async () => {
    await expectMovedDestinationRefused(
      () => {
        // Nothing beyond the origin: the repository's own configuration moves.
      },
      (scratch) => {
        scratchGit(scratch.dir, 'config', 'remote.origin.pushurl', scratch.unapproved)
      },
    )
  })

  it.runIf(canLinkFiles())(
    'P2: refuses at the spawn a push whose linked configuration file was rewritten during its admission',
    async () => {
      await expectMovedDestinationRefused(
        (scratch) => {
          // An included configuration file that is a link: git reads its target.
          const target = path.join(scratch.remotes, 'target.gitconfig')
          const linked = path.join(scratch.remotes, 'linked.gitconfig')
          writeFileSync(target, pushUrlConfig(scratch.origin))
          symlinkSync(target, linked, 'file')
          scratchGit(scratch.dir, 'config', 'include.path', linked.replaceAll('\\', '/'))
        },
        (scratch) => {
          // Only the target changes; the link itself stays as it was.
          writeFileSync(
            path.join(scratch.remotes, 'target.gitconfig'),
            pushUrlConfig(scratch.unapproved),
          )
        },
      )
    },
  )

  it('R9: refuses at the spawn a commit whose staged bytes changed during its admission', async () => {
    const scratch = dirtyRepository()
    try {
      scratchGit(scratch.dir, 'add', 'a.txt')
      const { gate, service } = gatedService(scratch.dir, 'commit')
      const { stamp } = await service.formStatus()
      const committing = service.commit('Staged two', false, stamp)
      await gate.reached
      writeFileSync(path.join(scratch.dir, 'a.txt'), 'three\n')
      scratchGit(scratch.dir, 'add', 'a.txt')
      gate.release()
      await expectNoCommit(committing, scratch.dir)
    } finally {
      scratch.cleanup()
    }
  })

  it('commits nothing when what `add -A` staged is not what the form showed', async () => {
    const scratch = dirtyRepository()
    try {
      const { gate, service } = gatedService(scratch.dir, 'add')
      const { stamp } = await service.formStatus()
      const committing = service.commit('All of two', true, stamp)
      await gate.reached
      // The index is untouched, so the add starts; it stages other bytes.
      writeFileSync(path.join(scratch.dir, 'a.txt'), 'unconfirmed\n')
      gate.release()
      await expectNoCommit(committing, scratch.dir)
      expect(spawnedSubcommands()).toContain('add')
    } finally {
      scratch.cleanup()
    }
  })

  it('R10: refuses at the spawn a root replaced by a link, even to the same directory', async () => {
    const scratch = dirtyRepository()
    const moved = `${scratch.dir}-moved`
    try {
      const { gate, service } = gatedService(scratch.dir, 'add')
      const committing = service.commit('Through a link to itself', true)
      await gate.reached
      renameSync(scratch.dir, moved)
      symlinkSync(moved, scratch.dir, 'junction')
      gate.release()
      await expect(committing).rejects.toThrow('changed')
      expect(spawnedSubcommands()).not.toContain('add')
    } finally {
      removeLink(scratch.dir)
      rmSync(moved, { recursive: true, force: true })
      scratch.cleanup()
    }
  })

  it('R1: rechecks at the Windows helper’s payload authorization: a trust lost after the helper started never gets GO', async () => {
    governedWindowsJob()
    let isTrusted = true
    let wasAuthorized: boolean | undefined
    vi.spyOn(jobLaunch, 'spawnMcpJob').mockImplementation((launch) => {
      // The helper is running; trust goes before it reports READY.
      isTrusted = false
      try {
        launch.authorize?.()
        wasAuthorized = true
      } catch {
        wasAuthorized = false
      }
      // Without GO the helper exits failing, and git never starts.
      return spawn(process.execPath, ['-e', 'process.exitCode = 3'], { stdio: 'pipe' })
    })
    const run = createGitProcess({
      platform: 'win32',
      env: { PATH: String.raw`C:\Program Files\Git\cmd` },
      fileExists: () => true,
      spawn,
    })
    const guard = (): void => {
      if (!isTrusted) {
        throw new NativeGitRefusalError('untrusted')
      }
    }
    await expect(
      run(['add', '-A'], { cwd: tmpdir(), env: {}, timeoutMs: 10_000, beforeRun: guard }),
    ).rejects.toThrow('untrusted')
    expect(wasAuthorized).toBe(false)
  })

  it.runIf(process.platform === 'win32')(
    'R1: withholds GO on the real control pipe when the payload is refused',
    async () => {
      const configSchema = z.object({ controlPipe: z.string(), controlNonce: z.string() })
      const answerTo = async (authorize: () => void): Promise<string> => {
        const prepared = jobLaunch.prepareMcpJobLaunch({
          executablePath: 'unused.exe',
          file: 'git',
          args: [],
          isVerbatim: false,
          cwd: tmpdir(),
          env: {},
          log: () => {
            /* The refusal is the answer read below. */
          },
          authorize,
        })
        const encoded = environmentValue(prepared.env, 'win32', MCP_JOB_CONFIG_VARIABLE) ?? ''
        const { controlPipe, controlNonce } = configSchema.parse(
          JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')),
        )
        const socket = createConnection(`\\\\.\\pipe\\${controlPipe}`)
        let answer = ''
        socket.setEncoding('utf8')
        socket.on('data', (chunk: string) => {
          answer += chunk
        })
        socket.write(`READY ${controlNonce}\n`)
        await new Promise((resolve) => {
          socket.once('close', resolve)
        })
        prepared.closeControl()
        return answer
      }
      expect(
        await answerTo(() => {
          throw new NativeGitRefusalError('untrusted')
        }),
      ).toBe('')
      expect(
        await answerTo(() => {
          /* Authorized. */
        }),
      ).toMatch(/^GO /)
    },
  )
})

describe('cappedStderr', () => {
  it('drops the partial last word once the cap cut it, never a whole one before it', () => {
    expect(cappedStderr('fatal: GITHUB_TOKEN=abcdefgh', true)).toBe('fatal: ')
    expect(cappedStderr('fatal: bad thing\n', true)).toBe('fatal: bad thing\n')
    expect(cappedStderr('fatal: GITHUB_TOKEN=abcdefgh', false)).toBe('fatal: GITHUB_TOKEN=abcdefgh')
    expect(cappedStderr('opaque-without-space', true)).toBe('')
  })
})
