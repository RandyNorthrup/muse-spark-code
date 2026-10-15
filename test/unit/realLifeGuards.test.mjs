import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseArguments } from '../../scripts/real-life/lib/args.mjs'
import { dataFolderOf, productEnvironment } from '../../scripts/real-life/lib/home.mjs'
import { heldUnsettled } from '../../scripts/real-life/lib/ledger.mjs'
import { installerEnvironment } from '../../scripts/real-life/lib/install.mjs'
import { keySource, missingKeys } from '../../scripts/real-life/lib/keys.mjs'
import { ensureRecordDir, parseUsageOutput } from '../../scripts/real-life/lib/record.mjs'
import { ROUTES, routeFor, takenProviderReason } from '../../scripts/real-life/lib/routes.mjs'
import {
  clearProviderMarker,
  providerMarkers,
  writeProviderMarker,
} from '../../scripts/real-life/lib/marker.mjs'

// Pure guards for the real-life run (scripts/real-life/): each `it` names
// the review finding it holds. Values go in as data; nothing is faked.

describe('real-life installer environment', () => {
  it('removes case-insensitive Node preloads from installer and product children (T7)', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'real-life-'))
    try {
      const from = {
        PATH: '/usr/bin',
        NODE_OPTIONS: '--require outside.cjs',
        node_options: '--import outside.mjs',
        NODE_PATH: '/outside',
      }
      for (const env of [installerEnvironment(from), productEnvironment(root, from)]) {
        expect(env.PATH).toBe('/usr/bin')
        expect(env.NODE_OPTIONS).toBeUndefined()
        expect(env.node_options).toBeUndefined()
        expect(env.NODE_PATH).toBeUndefined()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

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

describe('real-life model overrides', () => {
  it('rejects an override unless its route is selected exactly once (T8)', () => {
    const base = [
      '--artefact',
      'package.tgz',
      '--max-requests',
      '1',
      '--max-usd',
      '1',
      '--record',
      'record',
    ]
    for (const routes of ['openai', 'openia,openia']) {
      const parsed = parseArguments([...base, '--routes', routes, '--model', 'openia=gpt-x'])
      expect(parsed.ok).toBe(false)
      expect(parsed.reason).toMatch(/openia.*selected exactly once/u)
    }
    const selected = parseArguments([...base, '--routes', 'openai', '--model', 'openai=gpt-x'])
    expect(selected.ok).toBe(true)
    expect(selected.options.models.get('openai')).toBe('gpt-x')
  })
})

describe('real-life usage readings', () => {
  it('pins product UI parsing to English despite a translated caller locale (T9)', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'real-life-'))
    try {
      const env = productEnvironment(root, {
        LC_ALL: 'de_DE.UTF-8',
        LC_MESSAGES: 'fr_FR.UTF-8',
        LANG: 'ja_JP.UTF-8',
      })
      expect(env.LC_ALL).toBe('en_US.UTF-8')
      expect(env.LC_MESSAGES).toBe('en_US.UTF-8')
      expect(env.LANG).toBe('en_US.UTF-8')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

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

describe('real-life unread liability', () => {
  it('retains malformed, null and unreadable reservation claims as unknown (T3)', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'real-life-'))
    try {
      const daily = path.join(dataFolderOf(home), 'paid-daily')
      for (const [index, text] of ['not JSON', 'null', '{"reservedUsd":"unknown"}'].entries()) {
        const folder = path.join(daily, String(index))
        mkdirSync(folder, { recursive: true })
        writeFileSync(path.join(folder, 'claim.json'), text)
      }
      expect(heldUnsettled(home)).toEqual({ claims: 0, micro: 0, unread: expect.any(Array) })
      expect(heldUnsettled(home).unread).toHaveLength(3)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('real-life provider collision', () => {
  it('gives overlapping runs separate valid credential accounts and recovery notes (T4)', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'real-life-'))
    try {
      const names = Object.entries(ROUTES)
        .filter(([, route]) => route.kind === 'provider')
        .flatMap(([id]) =>
          ['a'.repeat(24), 'b'.repeat(24)].map((runId) => routeFor(id, new Map(), runId).provider),
        )
      expect(new Set(names).size).toBe(names.length)
      for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9-]{0,31}$/u)
      for (const name of names) writeProviderMarker(name, root)
      expect(new Set(providerMarkers(root))).toEqual(new Set(names))
      clearProviderMarker(names[0], root)
      expect(providerMarkers(root)).not.toContain(names[0])
      expect(providerMarkers(root)).toHaveLength(names.length - 1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses a taken provider name and names its removal (4252482402)', () => {
    const reason = takenProviderReason({ id: 'openai', provider: 'rl-openai' })
    expect(reason).toMatch(/rl-openai/)
    expect(reason).toMatch(/never removes or replaces/)
    expect(reason).toMatch(/auth clear --provider rl-openai/)
  })
})
