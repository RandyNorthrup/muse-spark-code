import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { FIXTURE_HOOK_TIMEOUT_MS } from '../unit/helpers/fixtureBudget'
import { stageAgentBundle } from '../unit/helpers/stageAgentBundle'

const directory = mkdtempSync(path.join(os.tmpdir(), 'm115-schedule-cli-'))
const agent = path.join(directory, 'dist', 'acp.js')
beforeAll(async () => {
  await stageAgentBundle(directory)
}, FIXTURE_HOOK_TIMEOUT_MS)
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
  it('keeps dormant v2 grammar out of compact help and retains ordinary ACP usage', () => {
    const result = run(['--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('muse-spark-code-acp')
    expect(result.stdout).toContain('auth')
    expect(result.stdout).not.toContain(UI_TEXT.scheduleV2.runtime.usage)
    for (const grammar of ['--draft', '--scheduled-prompts', 'run-due'])
      expect(result.stdout).not.toContain(grammar)
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
})
