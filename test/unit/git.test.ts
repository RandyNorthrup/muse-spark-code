import type { ExecFileOptions } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { createGitRunner } from '../../src/host/git'
import { UI_TEXT } from '../../src/shared/constants'

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

describe('createGitRunner (D24)', () => {
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
