// The runtime Git service's binding and refusal paths, proved on a real
// repository: a missing, swapped or unreadable root refuses as `changed`,
// an unreadable prompt file stays out of the prompt, and the runner's own
// failures reach the caller (aborts as `closed`, everything else unchanged).

import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { GitHubSignIn } from '../../src/core/git/githubSignIn'
import { createMemoryPullRequestLinkStore } from '../../src/core/git/pullRequestLinksStore'
import type { RuntimeGitDeps } from '../../src/core/git/runtimeGit'
import type { GitProcess } from '../../src/host/git'
import { NativeGitRefusalError, NativeGitService } from '../../src/runtime/panel/git/service'
import { neverCalled, silentLogger, testGit } from './helpers/nativeGitHarness'

const root = mkdtempSync(path.join(tmpdir(), 'm123-native-service-'))
const dataFolder = mkdtempSync(path.join(root, 'data-'))
const git = testGit(root)

function makeRepository(): string {
  return git.makeRepository().repo
}

function depsFor(repositoryRoot: string): RuntimeGitDeps {
  return {
    repositoryRoot,
    gitPath: git.git,
    links: createMemoryPullRequestLinkStore(),
    isTrusted: () => true,
    confirmPush: neverCalled('confirmPush'),
    pickRemote: neverCalled('pickRemote'),
    userEnvironment: neverCalled('userEnvironment'),
    openInTerminal: neverCalled('openInTerminal'),
    openFolder: neverCalled('openFolder'),
    openExternal: neverCalled('openExternal'),
    dataFolder,
    userAgent: 'native-git-service-test',
    signal: new AbortController().signal,
    log: silentLogger,
    worktreeState: () => ({}),
    confirmWorktreeTrust: () => Promise.resolve(),
    confirm: () => Promise.resolve(false),
    github: new GitHubSignIn({
      sources: () => [],
      now: () => Date.now(),
      login: () => Promise.resolve(undefined),
      log: silentLogger,
    }),
  }
}

function serviceFor(repositoryRoot: string, run?: GitProcess): NativeGitService {
  return new NativeGitService(depsFor(repositoryRoot), run === undefined ? {} : { run })
}

async function reasonOf(call: () => Promise<unknown>): Promise<string> {
  try {
    await call()
  } catch (error: unknown) {
    if (error instanceof NativeGitRefusalError) {
      return error.reason
    }
    throw error
  }
  throw new Error('the call did not refuse')
}

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('NativeGitService binding', () => {
  it('resolves a live repository to its canonical root', async () => {
    const repo = makeRepository()
    await expect(serviceFor(repo).resolveRoot()).resolves.toBe(repo)
  })

  it('refuses a root that was never there', async () => {
    const missing = path.join(root, 'never-there')
    await expect(reasonOf(() => serviceFor(missing).resolveRoot())).resolves.toBe('changed')
  })

  it('refuses a root through a file', async () => {
    const file = path.join(root, 'a-file')
    writeFileSync(file, 'x\n')
    await expect(reasonOf(() => serviceFor(path.join(file, 'child')).resolveRoot())).resolves.toBe(
      'changed',
    )
  })

  it('refuses when the root is swept before the bind lands', async () => {
    const repo = makeRepository()
    const service = serviceFor(repo)
    rmSync(repo, { recursive: true, force: true })
    await expect(reasonOf(() => service.resolveRoot())).resolves.toBe('changed')
  })

  it('refuses after the root is deleted', async () => {
    const repo = makeRepository()
    const service = serviceFor(repo)
    await service.resolveRoot()
    rmSync(repo, { recursive: true, force: true })
    await expect(reasonOf(() => service.resolveRoot())).resolves.toBe('changed')
  })

  it.runIf(process.platform !== 'win32')(
    'reports the spawn failure when the root cannot be read',
    async () => {
      const repo = makeRepository()
      const service = serviceFor(repo)
      chmodSync(repo, 0o000)
      try {
        await expect(service.resolveRoot()).rejects.toMatchObject({ code: 'EACCES' })
      } finally {
        chmodSync(repo, 0o755)
      }
    },
  )
})

describe('NativeGitService reads', () => {
  it.runIf(process.platform !== 'win32')(
    'leaves an unreadable prompt file out of the prompt',
    async () => {
      const repo = makeRepository()
      const service = serviceFor(repo)
      const file = path.join(repo, 'secret.txt')
      writeFileSync(file, 'hidden\n')
      const shown = await service.newFileParts(['secret.txt'], 1024)
      expect(shown).toContain('secret.txt')
      chmodSync(file, 0o000)
      try {
        await expect(service.newFileParts(['secret.txt'], 1024)).resolves.toBe('')
      } finally {
        chmodSync(file, 0o644)
      }
    },
  )

  it('checks out a linked worktree past the existing storage parent', async () => {
    const repo = makeRepository()
    mkdirSync(path.join(dataFolder, 'pr-worktrees'), { recursive: true })
    const service = serviceFor(repo)
    const worktree = await service.addWorktree('check1', 'HEAD')
    try {
      // A linked worktree's git entry is a file, not a directory.
      expect(existsSync(path.join(worktree, '.git'))).toBe(true)
      const nestedService = serviceFor(worktree)
      const nested = await nestedService.addWorktree('nested1', 'HEAD')
      try {
        expect(existsSync(path.join(nested, '.git'))).toBe(true)
      } finally {
        git.run(repo, 'worktree', 'remove', '--force', nested)
      }
    } finally {
      git.run(repo, 'worktree', 'remove', '--force', worktree)
    }
  })
})

describe('NativeGitService runner failures', () => {
  it('reports an aborted run as closed with its cause', async () => {
    const repo = makeRepository()
    const abort = new AbortController()
    const aborted = new Error('the operation aborted')
    const run: GitProcess = () => {
      abort.abort()
      return Promise.reject(aborted)
    }
    try {
      await serviceFor(repo, run).resolveRoot({ signal: abort.signal })
    } catch (error: unknown) {
      if (!(error instanceof NativeGitRefusalError)) throw error
      expect(error.reason).toBe('closed')
      expect(error.cause).toBe(aborted)
      return
    }
    throw new Error('the aborted run did not refuse')
  })

  it('rethrows the runner failure itself when nothing was cancelled', async () => {
    const repo = makeRepository()
    const failure = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })
    const run: GitProcess = () => Promise.reject(failure)
    let seen: unknown
    try {
      await serviceFor(repo, run).resolveRoot()
    } catch (error: unknown) {
      seen = error
    }
    expect(seen).toBe(failure)
  })
})
