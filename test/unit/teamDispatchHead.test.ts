// M116 (D212): the playbook's dispatch base over the team's own governed
// git, against the real git binary. A copy branches from the orchestrator's
// base commit (its own commit off a dirty tree); in-place work lands in the
// tree itself, so its base is raw HEAD.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { readDispatchHead } from '../../src/core/team/teamWorkspaces'
import { realTeamGit as realGitImpl } from './helpers/teamGit'

const commitAs = (root: string, ...args: readonly string[]): void => {
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], {
    cwd: root,
  })
}

const headOf = (root: string): string =>
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()

function scratchRepo(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'm116-team-head-'))
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true })
  })
  execFileSync('git', ['init', '-b', 'main'], { cwd: root })
  commitAs(root, 'commit', '--allow-empty', '-m', 'base')
  return root
}

describe('readDispatchHead', () => {
  it('reads the branch ref with the base commit on a clean tree', async () => {
    const root = scratchRepo()
    await expect(readDispatchHead(realGitImpl, root, 'own-branch')).resolves.toEqual({
      ref: 'refs/heads/main',
      commit: headOf(root),
    })
  })

  it('reads a copy base off a dirty tree, and raw HEAD in place', async () => {
    const root = scratchRepo()
    writeFileSync(path.join(root, 'dirty.txt'), 'uncommitted\n')
    const head = headOf(root)
    const copy = await readDispatchHead(realGitImpl, root, 'own-branch')
    expect(copy.ref).toBe('refs/heads/main')
    expect(copy.commit).not.toBe(head)
    await expect(readDispatchHead(realGitImpl, root, 'in-place')).resolves.toEqual({
      ref: 'refs/heads/main',
      commit: head,
    })
  })

  it('reads a detached checkout as having no branch, never as branch HEAD', async () => {
    const root = scratchRepo()
    const head = headOf(root)
    execFileSync('git', ['checkout', '--detach', 'HEAD'], { cwd: root })
    await expect(readDispatchHead(realGitImpl, root, 'own-branch')).resolves.toEqual({
      ref: undefined,
      commit: head,
    })
  })

  it('refuses a repository with no commits: there is no base to record', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'm116-team-head-empty-'))
    onTestFinished(() => {
      rmSync(root, { recursive: true, force: true })
    })
    execFileSync('git', ['init', '-b', 'main'], { cwd: root })
    await expect(readDispatchHead(realGitImpl, root, 'own-branch')).rejects.toMatchObject({
      name: 'TeamGitError',
    })
  })
})
