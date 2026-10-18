// The prompt's git facts over the real git binary: a filter-less
// repository resolves (exit 1 absorbed), names that cannot be read
// reject, a log git cannot traverse lists no commits, and a trust
// revoked mid-flight yields no facts rather than partial ones.

import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { describeEnvironment } from '../../src/host/backend/environment'
import { GitExitError, metadataGit } from '../../src/host/git'
import { collectingLogger as logger } from './helpers/collectingLogger'
import { removeFolder } from './helpers/temporaryFolders'

const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-git-metadata-')))
afterAll(async () => {
  await removeFolder(base)
})

type GitRunner = (args: readonly string[], cwd: string, timeoutMs?: number) => Promise<string>

function gitIn(directory: string): GitRunner {
  // The same failure shape the production runner settles with: a typed
  // exit carrying its code and what git said, from the real binary.
  return (args: readonly string[]) =>
    new Promise<string>((resolve, reject) => {
      execFile('git', [...args], { cwd: directory }, (error, stdout, stderr) => {
        if (error) {
          reject(new GitExitError(typeof error.code === 'number' ? error.code : -1, stderr, 'git'))
        } else {
          resolve(stdout)
        }
      })
    })
}

function freshRepository(): string {
  const directory = path.join(base, `repo-${String(Date.now())}-${String(Math.random()).slice(2)}`)
  execFileSync('git', ['init', '-b', 'main', directory])
  return directory
}

function commitEmpty(directory: string, message: string): void {
  execFileSync('git', ['commit', '--allow-empty', '-m', message], {
    cwd: directory,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'muse',
      GIT_AUTHOR_EMAIL: 'muse@example.com',
      GIT_COMMITTER_NAME: 'muse',
      GIT_COMMITTER_EMAIL: 'muse@example.com',
    },
  })
}

function environment(directory: string, messages: string[], isWorkspaceTrusted: () => boolean) {
  return {
    runGit: gitIn(directory),
    workspaceRoot: directory,
    isWorkspaceTrusted,
    log: logger(messages),
    now: () => Date.now(),
  }
}

describe('metadataGit', () => {
  it('absorbs exit 1 when no filter is configured', async () => {
    const workspaceRoot = freshRepository()
    const git = await metadataGit(gitIn(workspaceRoot), workspaceRoot)
    await expect(git(['--version'])).resolves.toContain('git version')
  })

  it('rejects names the repository cannot read', async () => {
    const git = await metadataGit(gitIn(base), base)
    let failure: unknown
    try {
      await git(['rev-parse', '--abbrev-ref', 'HEAD'])
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(GitExitError)
  })
})

describe('describeEnvironment', () => {
  it('says no git facts where git cannot read names', async () => {
    const messages: string[] = []
    const facts = await describeEnvironment(environment(base, messages, () => true))
    expect(facts.git).toBeUndefined()
    expect(messages).toHaveLength(1)
  })

  it('lists no commits for a log git cannot traverse', async () => {
    const workspaceRoot = freshRepository()
    commitEmpty(workspaceRoot, 'first')
    commitEmpty(workspaceRoot, 'second')
    const parent = execFileSync('git', ['rev-parse', 'HEAD^'], { cwd: workspaceRoot })
      .toString()
      .trim()
    const { rmSync } = await import('node:fs')
    rmSync(path.join(workspaceRoot, '.git', 'objects', parent.slice(0, 2), parent.slice(2)))
    const messages: string[] = []
    const facts = await describeEnvironment(environment(workspaceRoot, messages, () => true))
    // The branch and status read fine; only the log failed, so the facts
    // stand with an empty commit list instead of no facts at all.
    expect(facts.git?.branch).toBe('main')
    expect(facts.git?.recentCommits ?? []).toEqual([])
  })

  it('lists the commits once the log reads', async () => {
    const workspaceRoot = freshRepository()
    commitEmpty(workspaceRoot, 'first')
    const messages: string[] = []
    const facts = await describeEnvironment(environment(workspaceRoot, messages, () => true))
    expect(facts.git?.recentCommits ?? []).toHaveLength(1)
  })

  it('yields no facts when trust is revoked mid-flight', async () => {
    const workspaceRoot = freshRepository()
    commitEmpty(workspaceRoot, 'first')
    let checks = 0
    const messages: string[] = []
    const facts = await describeEnvironment(
      environment(workspaceRoot, messages, () => {
        checks += 1
        // The entry, branch and status reads run trusted; the log read does not.
        return checks <= 3
      }),
    )
    expect(facts.git).toBeUndefined()
    expect(messages).toHaveLength(1)
  })
})
