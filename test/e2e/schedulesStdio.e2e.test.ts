import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'

const directory = mkdtempSync(path.join(os.tmpdir(), 'm115-schedule-cli-'))
const agent = path.join(directory, 'dist', 'acp.js')
beforeAll(async () => {
  await mkdir(path.dirname(agent))
  await build({
    entryPoints: [path.resolve('src/runtime/main.ts')],
    outfile: agent,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['@napi-rs/keyring'],
    logLevel: 'silent',
  })
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ version: '0.0.0-test' }))
  await cp(path.resolve('l10n'), path.join(directory, 'l10n'), { recursive: true })
})
afterAll(async () => {
  expect(path.dirname(path.resolve(directory))).toBe(path.resolve(os.tmpdir()))
  await rm(directory, { recursive: true, force: true })
})
function run(args: readonly string[]) {
  return spawnSync(process.execPath, [agent, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { SystemRoot: process.env['SystemRoot'], LANG: 'en_US.UTF-8', LC_ALL: '' },
  })
}

describe('schedule CLI process boundary', () => {
  it('prints runnable draft and global wake syntax in help', () => {
    const result = run(['--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(UI_TEXT.scheduleV2.runtime.usage)
    expect(result.stdout).toContain('--draft')
    expect(result.stdout).toContain('run-due')
  })
  it('returns a stable JSON refusal when the real scheduler bundle is absent', () => {
    for (const args of [
      ['schedule', 'list', '--json'],
      ['schedule', 'background', 'off', '--json'],
    ]) {
      const result = run(args)
      expect(result.status).toBe(1)
      expect(JSON.parse(result.stdout)).toEqual({
        kind: 'refused',
        reason: UI_TEXT.scheduleV2.runtime.unavailable,
      })
      expect(result.stdout).not.toContain(directory)
    }
  })
  it('keeps exec scheduling and global workspace overrides refused before starting a backend', () => {
    expect(run(['exec', '--schedule', 'list']).status).toBe(2)
    expect(run(['schedule', 'run-due', '--cwd', directory]).status).toBe(2)
    expect(run(['schedule', 'background', 'off', '--cwd', directory]).status).toBe(2)
  })
  it('preserves a committed accepted id on stdout and reports cleanup separately with exit 3', async () => {
    const bundle = path.join(directory, 'dist', 'schedules.js')
    await writeFile(
      bundle,
      `exports.createRuntimeSchedules = async () => ({
        command: async () => ({ exitCode: 0, output: JSON.stringify({ kind: 'accepted', id: 'fake-accepted' }) }),
        run: async () => 'fake',
        holdWorkspace: async () => async () => {},
        close: async () => { throw new Error('private cleanup detail') }
      })`,
    )
    try {
      const result = run(['schedule', 'add', '--draft', '{}', '--json'])
      expect(result.status).toBe(3)
      expect(JSON.parse(result.stdout)).toEqual({
        kind: 'accepted',
        id: 'fake-accepted',
      })
      expect(result.stderr).toContain(UI_TEXT.scheduleV2.runtime.cleanupFailed)
      expect(result.stdout + result.stderr).not.toContain('private cleanup detail')
      expect(result.stdout).toContain('fake-accepted')
    } finally {
      await rm(bundle)
    }
  })
})
