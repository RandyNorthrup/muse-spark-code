import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { installerEnvironment } from '../../scripts/real-life/lib/install.mjs'
import { keySource, missingKeys } from '../../scripts/real-life/lib/keys.mjs'
import { ensureRecordDir, parseUsageOutput } from '../../scripts/real-life/lib/record.mjs'

// Pure guards for the real-life run (scripts/real-life/): each `it` names
// the review finding it holds. Values go in as data; nothing is faked.

describe('real-life installer environment', () => {
  it('keeps no credential variable out of the child npm (4252482350)', () => {
    const env = installerEnvironment({
      PATH: '/usr/bin',
      HOME: '/home/person',
      npm_execpath: '/usr/lib/node_modules/npm/bin/npm-cli.js',
      REAL_LIFE_KEY_ANTHROPIC_FLEET_1: 'a-provider-key',
      META_API_KEY: 'a-provider-key',
    })
    expect(env.PATH).toBe('/usr/bin')
    expect(env.HOME).toBe('/home/person')
    expect(env.npm_execpath).toBe('/usr/lib/node_modules/npm/bin/npm-cli.js')
    expect(env.REAL_LIFE_KEY_ANTHROPIC_FLEET_1).toBeUndefined()
    expect(env.META_API_KEY).toBeUndefined()
  })
})

describe('real-life usage readings', () => {
  it('reads a good usage output (4252482371)', () => {
    const read = parseUsageOutput({
      code: 0,
      stdout: '{"records":[{"id":"a","cost":{"usd":"0.002","certainty":"reported"}}]}',
    })
    expect(read.ok).toBe(true)
    expect(read.records?.length).toBe(1)
  })

  it('refuses a failed command, malformed JSON and a missing records array (4252482371)', () => {
    for (const run of [
      { code: 1, stdout: '' },
      { code: 0, stdout: 'not JSON' },
      { code: 0, stdout: '{"records":{}}' },
      { code: 0, stdout: '{"somethingElse":[]}' },
      { code: 0, stdout: 'null' },
    ]) {
      const read = parseUsageOutput(run)
      expect(read.ok).toBe(false)
      expect(read.reason).not.toBe('')
    }
  })
})

describe('real-life record destination', () => {
  it('creates a missing record folder (4252482389)', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'real-life-'))
    const file = path.join(root, '0.19.0', 'rig-2026-10-14')
    ensureRecordDir(file)
    expect(existsSync(path.dirname(file))).toBe(true)
  })
})

describe('real-life key check', () => {
  it('names the routes whose key the source does not hold (4252482398)', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'real-life-'))
    const missing = missingKeys(
      [
        { id: 'openai', kind: 'provider', stored: 'openai' },
        { id: 'openai-again', kind: 'provider', stored: 'openai' },
        { id: 'musecode', kind: 'museCode' },
      ],
      keySource(`dpapi:${root}`),
    )
    expect(missing.map((one) => one.id)).toEqual(['openai'])
    expect(missing[0]?.reason).toMatch(/no stored key named openai/)
  })
})
