// Lane I's ref fence (PLAN.md D75, M96 acceptance 6 and the review's fixes):
// the ref guard, the read-only list's refused options, the credential-free
// worker environment, and the `agents/` ref check. Pure: no git, no fs.

import { describe, expect, it } from 'vitest'
import {
  checkAgentsRef,
  classifyReadOnlyShellCommand,
  classifyWorkerGitCommand,
  findPushedRefs,
  RefFence,
  isReflogPush,
  isTeamRefError,
  teamAgentsRef,
  teamBranchName,
  workerEnvironment,
  type ReadOnlyCommandEntry,
} from '../../src/core/team/refFence'

const READ_ONLY: readonly ReadOnlyCommandEntry[] = [
  { command: 'git', subcommand: 'diff' },
  { command: 'git', subcommand: 'log' },
  { command: 'git', subcommand: 'status' },
  { command: 'git', subcommand: 'show' },
  { command: 'ls' },
]

function shell(command: string) {
  return classifyReadOnlyShellCommand(command, {
    platform: process.platform,
    readOnly: READ_ONLY,
  })
}

describe('teamBranchName', () => {
  it('names agents/<role>/<task-id>', () => {
    expect(teamBranchName('engineering', 't1')).toBe('agents/engineering/t1')
  })

  it.each([
    ['../x'],
    ['a/b'],
    ['a..b'],
    ['-a'],
    ['.a'],
    ['a.'],
    ['a@{b}'],
    ['a b'],
    ['a~b'],
    ['a:b'],
    ['a?b'],
    ['a*b'],
    ['a[bc]'],
    [String.raw`a\b`],
  ])('refuses %s', (bad: string) => {
    expect(() => teamBranchName('engineering', bad)).toThrow(/Refused team branch/)
    expect(() => teamBranchName(bad, 't1')).toThrow(/Refused team branch/)
  })

  it('names the agents/ ref', () => {
    expect(teamAgentsRef('agents/engineering/t1')).toBe('refs/heads/agents/engineering/t1')
  })

  it('raises TeamRefError on bad names', () => {
    try {
      teamBranchName('engineering', '../evil')
      expect.unreachable()
    } catch (error: unknown) {
      expect(isTeamRefError(error)).toBe(true)
      expect(error).toMatchObject({ code: 'badName' })
    }
  })

  it('refuses non-team branches as refs', () => {
    expect(() => teamAgentsRef('main')).toThrow(/Refused team ref/)
    expect(() => teamAgentsRef('agents/only-one')).toThrow(/Refused team ref/)
    expect(() => teamAgentsRef('agents/a/b/c')).toThrow(/Refused team ref/)
  })
})

describe('classifyWorkerGitCommand', () => {
  it.each([
    ['commit'],
    ['merge'],
    ['rebase'],
    ['reset'],
    ['checkout', 'main'],
    ['switch', 'main'],
    ['push'],
    ['fetch'],
    ['pull'],
    ['clone'],
    ['remote', 'add'],
    ['branch', '-f', 'main'],
    ['branch', '-D', 'main'],
    ['tag', '-d', 'v1'],
    ['update-ref'],
    ['worktree', 'add'],
    ['stash'],
    ['config', 'user.name'],
  ])('refuses git %s', (...args: string[]) => {
    const verdict = classifyWorkerGitCommand(args)
    expect(verdict.allowed).toBe(false)
  })

  it('names the exact refused reasons', () => {
    expect(classifyWorkerGitCommand(['commit'])).toEqual({
      allowed: false,
      command: 'commit',
      reason: 'gitCommit',
    })
    expect(classifyWorkerGitCommand(['push', 'origin'])).toMatchObject({ reason: 'gitRemote' })
    expect(classifyWorkerGitCommand(['branch', '-f', 'main'])).toMatchObject({
      reason: 'gitRefMove',
    })
  })

  it('refuses smuggled configuration and other repositories', () => {
    expect(classifyWorkerGitCommand(['-c', 'credential.helper=store', 'status'])).toMatchObject({
      reason: 'gitConfig',
    })
    expect(classifyWorkerGitCommand(['-C', '/elsewhere', 'status'])).toMatchObject({
      reason: 'outsideRepo',
    })
    expect(classifyWorkerGitCommand(['--git-dir=/elsewhere', 'status'])).toMatchObject({
      reason: 'outsideRepo',
    })
  })

  it('refuses unknown subcommands fail-closed', () => {
    expect(classifyWorkerGitCommand(['frob'])).toMatchObject({ reason: 'unknownGitCommand' })
  })

  it.each([
    ['status'],
    ['log', '--oneline'],
    ['diff', '--', 'a.ts'],
    ['show', 'HEAD:a.ts'],
    ['rev-parse', 'HEAD'],
    ['ls-files'],
    ['branch', '--list'],
    ['branch', '-a'],
    ['help'],
  ])('allows git %s', (...args: string[]) => {
    expect(classifyWorkerGitCommand(args)).toEqual({ allowed: true })
  })

  it('refuses a list-shaped branch with a ref name', () => {
    expect(classifyWorkerGitCommand(['branch', '--list', 'main'])).toMatchObject({
      reason: 'gitRefMove',
    })
  })
})

describe('classifyReadOnlyShellCommand', () => {
  it('allows listed commands', () => {
    expect(shell('git log --oneline')).toEqual({ allowed: true })
    expect(shell('ls')).toEqual({ allowed: true })
  })

  it('refuses commands off the list, not asked', () => {
    expect(shell('rm -rf out')).toMatchObject({ reason: 'notReadOnly' })
    expect(shell('npm test')).toMatchObject({ reason: 'notReadOnly' })
  })

  it('refuses a write redirect', () => {
    expect(shell('echo x > f')).toMatchObject({ reason: 'shellRedirect' })
    expect(shell('echo x >> f')).toMatchObject({ reason: 'shellRedirect' })
  })

  it('refuses write cmdlets', () => {
    expect(shell('Set-Content f "x"')).toMatchObject({ reason: 'writeCommand' })
    expect(shell('Out-File -FilePath f')).toMatchObject({ reason: 'writeCommand' })
  })

  it('refuses a read-only command with a refused option', () => {
    expect(shell('git diff --output=src/a.ts')).toMatchObject({ reason: 'refusedOption' })
    expect(shell('git diff --output src/a.ts')).toMatchObject({ reason: 'refusedOption' })
  })

  it('runs the ref guard under the list', () => {
    expect(shell('git push')).toMatchObject({ reason: 'gitRemote' })
    const withPush: readonly ReadOnlyCommandEntry[] = [
      ...READ_ONLY,
      { command: 'git', subcommand: 'push' },
    ]
    expect(
      classifyReadOnlyShellCommand('git push', {
        platform: process.platform,
        readOnly: withPush,
      }),
    ).toMatchObject({ reason: 'gitRemote' })
  })

  it('refuses a write hiding in a chain', () => {
    expect(shell('git log && echo x > f')).toMatchObject({ reason: 'shellRedirect' })
    expect(shell('git log; Set-Content f x')).toMatchObject({ reason: 'writeCommand' })
  })

  it('ignores a quoted redirect', () => {
    expect(shell('git log --grep="a > b"')).toEqual({ allowed: true })
  })

  it('honours an entry’s own refused options', () => {
    const list: readonly ReadOnlyCommandEntry[] = [{ command: 'ls', refusedOptions: ['-R'] }]
    expect(
      classifyReadOnlyShellCommand('ls -R', { platform: process.platform, readOnly: list }),
    ).toMatchObject({ reason: 'refusedOption' })
    expect(
      classifyReadOnlyShellCommand('ls -l', { platform: process.platform, readOnly: list }),
    ).toEqual({ allowed: true })
  })
})

describe('workerEnvironment', () => {
  const base: NodeJS.ProcessEnv = {
    PATH: '/usr/bin',
    HOME: '/home/u',
    SSH_AUTH_SOCK: '/run/sock',
    GIT_ASKPASS: '/bin/ask',
    META_API_KEY: 'LLM_secret',
    GITHUB_TOKEN: 'tok',
    MY_PASSWORD: 'pw',
  }

  it('strips credentials, sockets and askpass without mutating the input', () => {
    const out = workerEnvironment(base, process.platform)
    expect(base['SSH_AUTH_SOCK']).toBe('/run/sock')
    expect(out['SSH_AUTH_SOCK']).toBeUndefined()
    expect(out['META_API_KEY']).toBeUndefined()
    expect(out['GITHUB_TOKEN']).toBeUndefined()
    expect(out['MY_PASSWORD']).toBeUndefined()
    expect(out['PATH']).toBe('/usr/bin')
    expect(out['HOME']).toBe('/home/u')
  })

  it('disarms git credentials', () => {
    const out = workerEnvironment(base, process.platform)
    expect(out['GIT_TERMINAL_PROMPT']).toBe('0')
    expect(out['GIT_ASKPASS']).toBe('')
    expect(out['GIT_SSH_COMMAND']).toBe('muse-spark-refuses-ssh')
    expect(out['GIT_CONFIG_COUNT']).toBe('2')
    expect(out['GIT_CONFIG_KEY_0']).toBe('credential.helper')
    expect(out['GIT_CONFIG_VALUE_0']).toBe('')
    expect(out['GIT_CONFIG_GLOBAL']).toBe(process.platform === 'win32' ? 'NUL' : '/dev/null')
    expect(out['GIT_CONFIG_SYSTEM']).toBe(process.platform === 'win32' ? 'NUL' : '/dev/null')
  })

  it('keeps the names the profile passes through', () => {
    const out = workerEnvironment(base, process.platform, ['META_API_KEY'])
    expect(out['META_API_KEY']).toBe('LLM_secret')
    expect(out['GITHUB_TOKEN']).toBeUndefined()
  })
})

describe('checkAgentsRef', () => {
  it('passes an unchanged ref', () => {
    expect(checkAgentsRef('refs/heads/agents/eng/t1', 'abc', 'abc')).toEqual({ breach: false })
    expect(checkAgentsRef('refs/heads/agents/eng/t1', undefined, undefined)).toEqual({
      breach: false,
    })
  })

  it('names the ref and both values on a move', () => {
    expect(checkAgentsRef('refs/heads/agents/eng/t1', 'abc', 'def')).toEqual({
      breach: true,
      ref: 'refs/heads/agents/eng/t1',
      oldValue: 'abc',
      newValue: 'def',
    })
  })

  it('shows an absent side', () => {
    expect(checkAgentsRef('refs/heads/agents/eng/t1', 'abc', undefined).breach).toBe(true)
    expect(checkAgentsRef('refs/heads/agents/eng/t1', undefined, 'abc')).toMatchObject({
      oldValue: '(absent)',
      newValue: 'abc',
    })
  })
})

describe('RefFence', () => {
  it('never trips another task’s fence', () => {
    const first = new RefFence()
    const second = new RefFence()
    first.recordWrite('refs/heads/agents/eng/t1', 'base1')
    second.recordWrite('refs/heads/agents/eng/t2', 'base2')
    // The second writer's branch moves: only its own fence sees it.
    expect(first.check('refs/heads/agents/eng/t1', 'base1')).toEqual({ breach: false })
    expect(second.check('refs/heads/agents/eng/t2', 'moved')).toMatchObject({ breach: true })
    expect(first.check('refs/heads/agents/eng/t1', 'base1')).toEqual({ breach: false })
  })

  it('breaches on an unowned ref', () => {
    const fence = new RefFence()
    expect(fence.check('refs/heads/agents/eng/t9', 'x').breach).toBe(true)
  })
})

describe('reflog push check', () => {
  it('spots a receive-pack push', () => {
    expect(isReflogPush('push')).toBe(true)
    expect(isReflogPush('push: forced')).toBe(true)
    expect(isReflogPush('commit: a change')).toBe(false)
    expect(isReflogPush('fetch')).toBe(false)
    expect(isReflogPush('clone: from /x')).toBe(false)
  })

  it('lists only the pushed refs', () => {
    expect(
      findPushedRefs({
        'refs/heads/main': ['commit: user work', 'push'],
        'refs/heads/other': ['commit: more'],
      }),
    ).toEqual(['refs/heads/main'])
  })
})
