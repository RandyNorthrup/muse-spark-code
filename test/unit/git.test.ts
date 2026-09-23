import type { ExecFileOptions } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { createGitRunner } from '../../src/host/git'

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
