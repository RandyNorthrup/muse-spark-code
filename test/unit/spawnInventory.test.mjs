import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  inventoryTable,
  proveTestOnly,
  readCorpus,
  scanSpawnSites,
} from '../../scripts/lib/spawn-inventory.mjs'

const root = path.resolve('.')
const captured = {}
const order = (left, right) => left.localeCompare(right)
// Scan the source tree and read the test corpus once, at the repository's own hook timeout.
beforeAll(async () => {
  Object.assign(captured, scanSpawnSites(root, await readCorpus(root)))
})

describe('complete production process inventory', () => {
  it('requires every source process import and launch, including aliases and embedded programs', () => {
    const inventory = JSON.parse(
      fs.readFileSync(path.join(root, 'docs/certification/spawn-inventory.json'), 'utf8'),
    )

    expect(captured.sites.map((entry) => entry.site).toSorted(order)).toEqual(
      inventory.map((entry) => entry.site).toSorted(order),
    )
    expect(new Set(inventory.map((entry) => entry.site)).size).toBe(inventory.length)
    for (const entry of inventory) {
      expect([
        'contained',
        'probe',
        'handoff',
        'interactive',
        'bootstrap',
        'honestly-unavailable',
        'test-only',
      ]).toContain(entry.profile)
      expect(entry.reason.trim().length).toBeGreaterThan(0)
      const site = captured.sites.find((candidate) => candidate.site === entry.site)
      // A test-only claim is proved: no production path reaches the owning symbol.
      if (entry.profile === 'test-only' && site.site.includes('#import:')) {
        const calls = inventory.filter(
          (other) => other.site.startsWith(`${site.file}#`) && !other.site.includes('#import:'),
        )
        expect(calls.length).toBeGreaterThan(0)
        for (const call of calls) expect(call.profile).toBe('test-only')
      } else if (entry.profile === 'test-only') {
        expect(site.owner).toBe(entry.testOnly)
        expect(proveTestOnly(captured.program, entry.testOnly, root)).toMatchObject({
          references: [],
          exercised: true,
        })
      } else expect(entry.testOnly).toBeUndefined()
      // Portable call sites name their profile; the launcher's own files forward it.
      if (
        /call:(spawnResourceProcess|execResourceFile)/.test(entry.site) &&
        ![
          'src/core/resources/admission.ts',
          'src/core/resources/process.ts',
          'src/core/resources/commands.ts',
        ].includes(site.file)
      )
        expect(site.selected).toBe(entry.profile)
      if (entry.site.includes('call:handoffResourceFile')) expect(entry.profile).toBe('handoff')
      if (entry.site.includes('call:runBootstrap')) expect(entry.profile).toBe('bootstrap')
      // No temp root only where a call site literally asks for a probe: never a
      // forwarder, an import or a raw launch, and never by default.
      if (entry.profile !== 'probe') continue
      expect(entry.site).toMatch(/#call:(spawnResourceProcess|execResourceFile):\d+$/)
      expect(site.selected).toBe('probe')
    }
    // Every literal probe in source is a recorded probe, and nothing else is one.
    expect(
      captured.sites
        .filter((site) => site.selected === 'probe')
        .map((site) => site.site)
        .toSorted(order),
    ).toEqual(
      inventory
        .filter((entry) => entry.profile === 'probe')
        .map((entry) => entry.site)
        .toSorted(order),
    )
    const certification = fs.readFileSync(
      path.join(root, 'docs/certification/int0170-combined.md'),
      'utf8',
    )
    const rows = certification
      .split('\n')
      .filter((line) => /^\|\s*`src\/.*#/.test(line))
      .map((line) =>
        line
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim()),
      )
    const expected = inventoryTable(inventory)
      .split('\n')
      .slice(2)
      .map((line) =>
        line
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim()),
      )
    expect(rows).toEqual(expected)
  })
})

// RVSPAWN017C's probes: each construct is a site the guard must see.
describe('inventory guard probes', () => {
  const roots = []
  afterAll(() => {
    for (const folder of roots) fs.rmSync(folder, { recursive: true, force: true })
  })
  const fixture = (files) => {
    const folder = fs.mkdtempSync(path.join(tmpdir(), 'l-SPAWN017C-guard-'))
    roots.push(folder)
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(folder, name)), { recursive: true })
      fs.writeFileSync(path.join(folder, name), text)
    }
    return folder
  }

  it('sees destructured and property launch aliases, process wrappers and worker programs', () => {
    // The probe's program text interpolates a value: \`${code}\` inside its template.
    const interpolation = ['$', '{code}'].join('')
    const folder = fixture({
      'src/probe.ts': [
        "import * as cp from 'node:child_process'",
        "import { spawn } from 'node:child_process'",
        "import { execa } from 'execa'",
        "import { Worker } from 'node:worker_threads'",
        'export function reviewExtraLaunch() {',
        '  const { spawn: launch } = { spawn }',
        "  return launch(process.execPath, ['-e', 'process.exit(0)'])",
        '}',
        'export function viaProperty() {',
        '  const run = cp.execFile',
        "  return run(process.execPath, ['-v'])",
        '}',
        "export const wrapped = () => execa('node', ['-v'])",
        'export function worker(code: string) {',
        '  return new Worker(',
        `    \`require("node:child_process").spawn(${interpolation})\`,`,
        '    { eval: true },',
        '  )',
        '}',
        '',
      ].join('\n'),
      'test/placeholder.test.ts': '',
    })
    const sites = scanSpawnSites(folder).sites.map((site) => site.site)
    expect(sites).toEqual(
      expect.arrayContaining([
        'src/probe.ts#call:spawn:1',
        'src/probe.ts#call:execFile:1',
        'src/probe.ts#wrapper:1',
        'src/probe.ts#worker:1',
        'src/probe.ts#embedded:dynamic:1',
      ]),
    )
  })

  it('follows an aliased import of a test-only symbol to its production caller', () => {
    const folder = fixture({
      'src/driver.ts': [
        "import { spawn } from 'node:child_process'",
        "export function createNativeTeamProcessDriver() { return spawn('x', []) }",
        '',
      ].join('\n'),
      'src/caller.ts': [
        "import { createNativeTeamProcessDriver as createDriver } from './driver'",
        'export const driver = createDriver()',
        '',
      ].join('\n'),
      'test/driver.test.ts': 'createNativeTeamProcessDriver()\n',
    })
    const { program } = scanSpawnSites(folder)
    expect(proveTestOnly(program, 'createNativeTeamProcessDriver', folder).references).toEqual([
      'src/caller.ts:createDriver',
    ])
  })
})
