import { describe, expect, it } from 'vitest'
import { classifyWorkerGitCommand } from '../../src/core/team/refFence'
import { hasRefMove, isRefMovingGitCommand } from '../../src/core/team/workers/workerFence'

describe('the shared W/I Git admission classifier', () => {
  it.each(['-nOcat', '-inOcat', '-nwofile'])(
    'refuses clustered options through every client: %s',
    (flag) => {
      const args = ['grep', flag, 'x']
      expect(classifyWorkerGitCommand(args).allowed).toBe(false)
      expect(isRefMovingGitCommand(['git', ...args])).toBe(true)
      expect(hasRefMove(`env -S "git grep ${flag} x"`, 'bash')).toBe(true)
    },
  )

  it.each([
    ['log', '-p'],
    ['show', '-p'],
    ['branch', '--show-current'],
    ['worktree', 'list'],
    ['--no-optional-locks', 'status'],
  ])('admits the same harmless Git argv through both clients: %j', (...args: string[]) => {
    expect(classifyWorkerGitCommand(args)).toEqual({ allowed: true })
    expect(isRefMovingGitCommand(['git', ...args])).toBe(false)
  })

  it.each([
    ['git', 'log'],
    ['-p', 'log'],
    ['-c', 'credential.helper=synthetic', 'status'],
    ['--config-env=core.askpass=SYNTHETIC', 'status'],
    ['branch', '-D', 'main'],
    ['worktree', 'add', '/other'],
  ])('refuses identical unsafe argv through both clients: %j', (...args: string[]) => {
    expect(classifyWorkerGitCommand(args).allowed).toBe(false)
    expect(isRefMovingGitCommand(['git', ...args])).toBe(true)
  })
})
