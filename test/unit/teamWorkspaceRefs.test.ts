import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { onTestFinished, describe, expect, it } from 'vitest'
import { publishTaskRef, TeamWorkspaceError } from '../../src/core/team/teamWorkspaces'
import { TeamGitError, type TeamGit } from '../../src/core/team/teamGit'
import { teamAgentsRef } from '../../src/core/team/refFence'

const BRANCH = 'agents/engineering/task-1'

/** The real git binary behind the `TeamGit` contract. */
const realGitImpl: TeamGit = (args, cwd) => {
  try {
    const out = execFileSync('git', [...args], { cwd, encoding: 'buffer' })
    return Promise.resolve(new Uint8Array(out))
  } catch (error) {
    const status =
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof error.status === 'number'
        ? error.status
        : 128
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error ? String(error.stderr) : ''
    return Promise.reject(new TeamGitError(status, stderr, args.join(' ')))
  }
}

function realGit(): TeamGit {
  return realGitImpl
}

function scratchRepo(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'm116w-ref-'))
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true })
  })
  execFileSync('git', ['init', '-b', 'main'], { cwd: root })
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'base',
    ],
    {
      cwd: root,
    },
  )
  mkdirSync(path.join(root, 'clone'), { recursive: true })
  return root
}

describe('task ref reads over real git', () => {
  it('reports a missing ref as moved-to-absent, never as unreadable', async () => {
    const root = scratchRepo()
    const agentsRef = teamAgentsRef(BRANCH)
    // The ref genuinely does not resolve (git exits 1): the publish reads
    // it absent and refuses the compare with true words.
    await expect(
      publishTaskRef(realGit(), root, root, BRANCH, agentsRef, 'a'.repeat(40)),
    ).rejects.toMatchObject({ name: 'TeamWorkspaceError', code: 'refMoved' })
  })

  it('throws a broken repository instead of reporting it absent', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'm116w-ref-broken-'))
    onTestFinished(() => {
      rmSync(root, { recursive: true, force: true })
    })
    const agentsRef = teamAgentsRef(BRANCH)
    // Not a repository at all (git exits 128): the failure reaches the
    // caller as the git failure. Reverting the exit-code narrowing reports
    // this as refMoved to "(absent)" instead.
    await expect(
      publishTaskRef(realGit(), root, root, BRANCH, agentsRef, 'a'.repeat(40)),
    ).rejects.toBeInstanceOf(TeamGitError)
    await expect(
      publishTaskRef(realGit(), root, root, BRANCH, agentsRef, 'a'.repeat(40)),
    ).rejects.not.toBeInstanceOf(TeamWorkspaceError)
  })
})
