import type { ExecFileOptions } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { worktreeAddHeldArgs } from '../../src/core/worktrees'
import { createGitRunner } from '../../src/host/git'
import { UNTRUSTED_CHECKOUT_OPTIONS, untrustedCheckoutArgs } from '../../src/host/git/untrustedGit'

function runner(env: NodeJS.ProcessEnv, installed: ReadonlySet<string>) {
  const calls: { file: string; args: readonly string[]; options: ExecFileOptions }[] = []
  const run = createGitRunner({
    platform: 'linux',
    env,
    fileExists: (file) => installed.has(file),
    execFile: (file, args, options) => {
      calls.push({ file, args, options })
      return Promise.resolve('ok\n')
    },
  })
  return { run, calls }
}

/** Record the same native boundary while each case chooses its real response/hold. */
function safeRunner(reply: (args: readonly string[]) => Promise<string>) {
  const calls: (readonly string[])[] = []
  const run = createGitRunner({
    platform: 'linux',
    env: { PATH: '/usr/bin' },
    fileExists: () => true,
    argsBefore: untrustedCheckoutArgs(),
    execFile: (_file, args) => {
      calls.push(args)
      return reply(args)
    },
  })
  return { run, calls }
}

/** The untrusted lane over a configuration that names only `name`. */
function configuredWith(name: string) {
  return safeRunner((args) =>
    Promise.resolve(args[0] === '--version' ? 'git version 2.50.1\n' : `${name}\0`),
  )
}

describe('createGitRunner (D24)', () => {
  it.each(['hook.driver=unsafe.command', 'hook.tab\tname.event'])(
    'refuses an unrepresentable hook name %j before running a complete held command',
    async (key) => {
      const held = worktreeAddHeldArgs('/held/pr', 'a'.repeat(40))
      const refused = configuredWith(key)
      await expect(refused.run(held, '/ws')).rejects.toThrow(
        UI_TEXT.openPullRequestFiltersUnavailable,
      )
      expect(refused.calls.some((args) => args.includes('worktree'))).toBe(false)
      // The same command runs when the name can be spelled: only the name refused it.
      const control = configuredWith('hook.driver.command')
      await control.run(held, '/ws')
      expect(control.calls.at(-1)).toEqual(expect.arrayContaining(['hook.driver.enabled=false']))
      expect(control.calls.at(-1)?.slice(-held.length)).toEqual(held)
    },
  )

  it('switches named hooks off, reads no filter or attribute, and leaves ordinary Git alone', async () => {
    const { run, calls } = safeRunner((args) => {
      if (args[0] === '--version') return Promise.resolve('git version 2.50.1\n')
      return Promise.resolve(
        args.includes('--name-only')
          ? 'filter.canary.clean\0filter.canary.smudge\0filter.canary.process\0filter.canary.required\0hook.checkout-canary.command\0hook.checkout-canary.event\0'
          : '',
      )
    })
    await run(['read-tree', 'a'.repeat(40)], '/held/pr')
    expect(calls).toHaveLength(3)
    const command = calls.at(-1)
    expect(command).toEqual([
      ...UNTRUSTED_CHECKOUT_OPTIONS,
      '-c',
      'hook.checkout-canary.enabled=false',
      '-c',
      'hook.checkout-canary.event=',
      'read-tree',
      'a'.repeat(40),
    ])
    expect(UNTRUSTED_CHECKOUT_OPTIONS).toEqual([
      '--no-replace-objects',
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'core.fsmonitor=false',
      '-c',
      'maintenance.auto=false',
      '-c',
      'gc.auto=0',
    ])
    expect(calls[1]).toEqual([
      ...UNTRUSTED_CHECKOUT_OPTIONS,
      'config',
      '--null',
      '--name-only',
      '--list',
    ])
    const ordinary = runner({ PATH: '/usr/bin' }, new Set(['/usr/bin/git']))
    await ordinary.run(['status'], '/ws')
    expect(ordinary.calls[0]?.args).toEqual(['status'])
  })

  it('enters no checkout after trust ends during names-only configuration discovery', async () => {
    const entered = Promise.withResolvers<undefined>()
    const names = Promise.withResolvers<string>()
    let isTrusted = true
    const { run, calls } = safeRunner((args) => {
      if (args[0] === '--version') return Promise.resolve('git version 2.50.1\n')
      entered.resolve(undefined)
      return names.promise
    })
    const checking = run(
      ['worktree', 'add', '--detach', '/held/pr', 'a'.repeat(40)],
      '/ws',
      undefined,
      undefined,
      () => {
        if (!isTrusted) throw new Error('trust ended')
      },
    )
    await entered.promise
    isTrusted = false
    names.resolve('filter.canary.process\0')
    await expect(checking).rejects.toThrow('trust ended')
    expect(calls.some((args) => args.includes('worktree'))).toBe(false)
  })

  it('reports a lost owner as it is when it ends after the version check, never as a missing Git feature', async () => {
    let isOwned = true
    const { run, calls } = safeRunner((args) => {
      if (args[0] === '--version') {
        // The owner goes while the version read is in flight.
        isOwned = false
        return Promise.resolve('git version 2.50.1\n')
      }
      return Promise.resolve('')
    })
    await expect(
      run(['worktree', 'add'], '/ws', undefined, undefined, () => {
        if (!isOwned) throw new Error('the repository changed')
      }),
    ).rejects.toThrow('the repository changed')
    expect(calls).toEqual([['--version']])
  })

  it('asks for the version again after a failed read instead of refusing every later checkout', async () => {
    let isVersionFailing = true
    const { run, calls } = safeRunner((args) => {
      if (args[0] === '--version') {
        return isVersionFailing
          ? Promise.reject(new Error('spawn failed'))
          : Promise.resolve('git version 2.50.1\n')
      }
      return Promise.resolve('')
    })
    const args = ['worktree', 'add', '--detach', '/held/pr', 'a'.repeat(40)]
    await expect(run(args, '/ws')).rejects.toThrow(UI_TEXT.openPullRequestFiltersUnavailable)
    isVersionFailing = false
    await expect(run(args, '/ws')).resolves.toBe('')
    expect(calls.filter((args) => args[0] === '--version')).toHaveLength(2)
  })

  it('fails explicitly before checkout when safe program controls are unsupported', async () => {
    const { run, calls } = safeRunner(() => Promise.resolve('git version 2.35.1\n'))
    await expect(run(['worktree', 'add'], '/ws')).rejects.toThrow(
      UI_TEXT.openPullRequestFiltersUnavailable,
    )
    expect(calls).toEqual([['--version']])
  })

  it.each(['filter.test.clean', 'filter.test.smudge', 'filter.test.process', 'hook.test.command'])(
    'refuses automatic configured program %s without running the requested command',
    async (key) => {
      const exec = vi.fn((_file: string, args: readonly string[]) =>
        Promise.resolve(args[0] === '--version' ? 'git version 2.50.1\n' : `${key}\0`),
      )
      const run = createGitRunner({
        platform: 'linux',
        env: { PATH: '/usr/bin' },
        fileExists: (file) => file === '/usr/bin/git',
        execFile: exec,
        isAutomatic: true,
      })
      await expect(run(['add', '--all'], '/ws')).rejects.toThrow(
        UI_TEXT.bestOfNGitProgramsUnavailable,
      )
      expect(exec.mock.calls.some(([, args]) => args.includes('add'))).toBe(false)
      expect(exec.mock.calls.at(-1)?.[1]).toContain('--name-only')
    },
  )

  it('checks the current owner after automatic configuration awaits and before actual spawn', async () => {
    const config = Promise.withResolvers<string>()
    const reading = Promise.withResolvers<undefined>()
    let isAllowed = true
    const exec = vi.fn((_file: string, args: readonly string[]) => {
      if (args[0] === '--version') return Promise.resolve('git version 2.50.1\n')
      if (args.includes('config')) {
        reading.resolve(undefined)
        return config.promise
      }
      return Promise.resolve('requested command')
    })
    const run = createGitRunner({
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      fileExists: (file) => file === '/usr/bin/git',
      execFile: exec,
      isAutomatic: true,
    })
    const running = run(['add', '--all'], '/ws', undefined, undefined, () => {
      if (!isAllowed) throw new Error('Owner changed')
    })
    await reading.promise
    isAllowed = false
    config.resolve('core.repositoryformatversion\0')
    await expect(running).rejects.toThrow('Owner changed')
    expect(exec.mock.calls.some(([, args]) => args.includes('add'))).toBe(false)
  })

  it('runs final preparation after configuration and refuses changed ownership before apply entry', async () => {
    const held = Promise.withResolvers<undefined>()
    const preparing = Promise.withResolvers<undefined>()
    let isAllowed = true
    const exec = vi.fn((_file: string, args: readonly string[]) =>
      Promise.resolve(
        args[0] === '--version' ? 'git version 2.50.1\n' : 'core.repositoryformatversion\0',
      ),
    )
    const run = createGitRunner({
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      fileExists: (file) => file === '/usr/bin/git',
      execFile: exec,
      isAutomatic: true,
    })
    const guard = Object.assign(
      () => {
        if (!isAllowed) throw new Error('Owner changed')
      },
      {
        prepare: async () => {
          expect(exec.mock.calls.at(-1)?.[1]).toContain('config')
          preparing.resolve(undefined)
          await held.promise
        },
      },
    )
    const running = run(['apply', '--index', '--binary', '-'], '/ws', undefined, 'patch', guard)
    await preparing.promise
    isAllowed = false
    held.resolve(undefined)
    await expect(running).rejects.toThrow('Owner changed')
    expect(exec.mock.calls.some(([, args]) => args.includes('apply'))).toBe(false)
  })

  it('refuses automatic Git before 2.36 rather than treating fsmonitor false as an executable', async () => {
    const exec = vi.fn(() => Promise.resolve('git version 2.35.1\n'))
    const run = createGitRunner({
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      fileExists: (file) => file === '/usr/bin/git',
      execFile: exec,
      isAutomatic: true,
    })
    await expect(run(['status'], '/ws')).rejects.toThrow(UI_TEXT.bestOfNGitProgramsUnavailable)
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('runs git by absolute path with a timeout, no window, no prompt and no optional locks', async () => {
    const { run, calls } = runner({ PATH: '.:/usr/bin', HOME: '/h' }, new Set(['/usr/bin/git']))
    await expect(run(['status', '--porcelain'], '/ws')).resolves.toBe('ok\n')
    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call?.file).toBe('/usr/bin/git')
    expect(call?.args).toEqual(['status', '--porcelain'])
    expect(call?.options).toMatchObject({
      cwd: '/ws',
      timeout: 15_000,
      windowsHide: true,
      env: { PATH: '.:/usr/bin', HOME: '/h', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
    })
  })

  it('gives a call that does real work its own timeout (M32)', async () => {
    const { run, calls } = runner({ PATH: '/usr/bin' }, new Set(['/usr/bin/git']))
    await run(['worktree', 'add', '-b', 'x', '/w/x', 'HEAD'], '/ws', 300_000)
    expect(calls[0]?.options.timeout).toBe(300_000)
  })

  it('rejects without running anything when git is only reachable relatively', async () => {
    const { run, calls } = runner({ PATH: '.:bin' }, new Set(['bin/git', 'git']))
    await expect(run(['status'], '/ws')).rejects.toThrow(/not found/)
    expect(calls).toEqual([])
  })

  it('finds git installed after a miss', async () => {
    const installed = new Set<string>()
    const { run } = runner({ PATH: '/usr/bin' }, installed)
    await expect(run(['status'], '/ws')).rejects.toThrow(/not found/)
    installed.add('/usr/bin/git')
    await expect(run(['status'], '/ws')).resolves.toBe('ok\n')
  })
})
