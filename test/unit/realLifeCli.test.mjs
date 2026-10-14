import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'

// The real-life run as a real child process, with inputs that must never
// reach a provider: each run below exits before anything is installed or
// sent. Each `it` names the review finding it holds.

const runner = path.join(process.cwd(), 'scripts', 'real-life', 'run.mjs')

/** Runs the runner with no key in reach and no network needed. */
function run(...args) {
  const env = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !name.startsWith('REAL_LIFE_KEY_')) env[name] = value
  }
  return spawnSync(process.execPath, [runner, ...args], {
    encoding: 'utf8',
    env,
    timeout: 30_000,
  })
}

describe('real-life command line', () => {
  it('rejects a plan with no scenario runs (4252482363)', () => {
    const record = path.join(mkdtempSync(path.join(tmpdir(), 'real-life-')), 'record')
    const finished = run(
      '--artefact',
      'package.json',
      '--routes',
      'anthropic',
      '--scenarios',
      'no-such-scenario-*',
      '--max-requests',
      '10',
      '--max-usd',
      '1',
      '--record',
      record,
    )
    expect(finished.status).toBe(2)
    expect(`${finished.stderr} ${finished.stdout}`).toMatch(/no scenario runs/i)
  })

  it('fails a requested route with no key, after making the record folder (4252482398, 4252482389)', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'real-life-'))
    const record = path.join(root, '0.19.0', 'rig-record')
    const finished = run(
      '--artefact',
      'package.json',
      '--routes',
      'anthropic',
      '--max-requests',
      '10',
      '--max-usd',
      '1',
      '--record',
      record,
    )
    expect(finished.status).toBe(2)
    expect(`${finished.stderr} ${finished.stdout}`).toMatch(/REAL_LIFE_KEY_ANTHROPIC_FLEET_1/)
    expect(existsSync(path.dirname(record))).toBe(true)
  })
})
