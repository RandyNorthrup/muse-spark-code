import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  spawnSync.mockReturnValue({ status: 0 })
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`scanner exit ${code}`)
  })
})
afterEach(() => vi.restoreAllMocks())

it('invokes every rule with one serial worker option that pinned Semgrep accepts', async () => {
  await expect(import('../../scripts/sast.mjs')).rejects.toThrow('scanner exit 0')
  expect(spawnSync).toHaveBeenCalledTimes(1)
  const [command, args, options] = spawnSync.mock.calls[0]
  expect(command).toBe('semgrep')
  expect(args.filter((arg) => arg === '--jobs')).toHaveLength(1)
  expect(args[args.indexOf('--jobs') + 1]).toBe('1')
  expect(args).toEqual(
    expect.arrayContaining([
      'scan',
      '--config',
      'auto',
      '--error',
      '--exclude=dist',
      '--exclude=coverage',
      '--exclude=node_modules',
      '--exclude=.vscode-test',
      '--exclude=.claude',
      '--exclude=vendor',
    ]),
  )
  expect(options.shell).toBeUndefined()
  expect(options.env.PYTHONUTF8).toBe('1')
})

it.each([1, 2])('propagates scanner failure %s instead of reporting success', async (status) => {
  spawnSync.mockReturnValue({ status })
  await expect(import('../../scripts/sast.mjs')).rejects.toThrow(`scanner exit ${status}`)
  expect(spawnSync).toHaveBeenCalledTimes(1)
})
