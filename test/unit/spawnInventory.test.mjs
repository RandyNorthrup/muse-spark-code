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

const driverFiles = (caller) => ({
  'src/driver.ts': [
    "import { spawn } from 'node:child_process'",
    "export function createNativeTeamProcessDriver() { return spawn('x', []) }",
  ].join('\n'),
  'src/caller.ts': [
    "import { createNativeTeamProcessDriver as createDriver } from './driver'",
    ...caller,
  ].join('\n'),
  'test/driver.test.ts': 'createNativeTeamProcessDriver()\n',
})

// RVSPAWN017C and RVSPAWN4W probes. Each construct is its own source file, so no
// other file's child_process text can carry it past the candidate prefilter.
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
  const sitesOf = (files) => {
    const folder = fixture({ ...files, 'test/placeholder.test.ts': '' })
    const byFile = {}
    for (const site of scanSpawnSites(folder).sites) (byFile[site.file] ??= []).push(site.site)
    return byFile
  }
  // The probe's program text interpolates a value: `${code}` inside its template.
  const interpolation = ['$', '{code}'].join('')

  it('sees each launch construct in a file of its own', () => {
    expect(
      sitesOf({
        'src/destructured.ts': [
          "import { spawn } from 'node:child_process'",
          'const { spawn: launch } = { spawn }',
          "export const go = () => launch(process.execPath, ['-v'])",
        ].join('\n'),
        'src/property.ts': [
          "import * as cp from 'node:child_process'",
          'const run = cp.execFile',
          "export const go = () => run(process.execPath, ['-v'])",
        ].join('\n'),
        'src/execAlias.ts': [
          "import * as cp from 'node:child_process'",
          'const run = cp.exec',
          "export const go = () => run('node -v')",
        ].join('\n'),
        'src/bound.ts': [
          "import { spawn } from 'node:child_process'",
          'const run = spawn.bind(null)',
          "export const go = () => run(process.execPath, ['-v'])",
        ].join('\n'),
        'src/called.ts': [
          "import { spawn } from 'node:child_process'",
          "export const go = () => spawn.call(null, process.execPath, ['-v'])",
        ].join('\n'),
        'src/wrapper.ts': [
          "import { execa } from 'execa'",
          "export const go = () => execa('node', ['-v'])",
        ].join('\n'),
        'src/worker.ts': [
          "import { Worker as Thread } from 'node:worker_threads'",
          'export const go = (code: string) => new Thread(code, { eval: true })',
        ].join('\n'),
        'src/workerDefault.ts': [
          "import threads from 'node:worker_threads'",
          'export const go = (code: string) => new threads.Worker(code, { eval: true })',
        ].join('\n'),
        'src/workerDynamic.ts': [
          'export async function go(code: string) {',
          "  const { Worker: Thread } = await import('node:worker_threads')",
          '  return new Thread(code, { eval: true })',
          '}',
        ].join('\n'),
        'src/workerAlias.ts': [
          "import * as wt from 'node:worker_threads'",
          'const Thread = wt.Worker',
          'export const go = (code: string) => new Thread(code, { eval: true })',
        ].join('\n'),
        'src/workerOptions.ts': [
          "import { Worker } from 'node:worker_threads'",
          'export const go = (file: string, options: object) => new Worker(file, options)',
        ].join('\n'),
        'src/workerReexport.ts': "export { Worker as Thread } from 'node:worker_threads'",
        'src/reexport.ts': "export { spawn as launch } from 'node:child_process'",
        'src/dynamicNamespace.ts': [
          'export async function go() {',
          "  const cp = await import('node:child_process')",
          "  return cp.exec('node -v')",
          '}',
        ].join('\n'),
        'src/program.ts': [
          'export const program = (code: string) =>',
          `  \`require("node:child_process").spawn(${interpolation})\``,
        ].join('\n'),
      }),
    ).toEqual({
      'src/destructured.ts': ['src/destructured.ts#import:1', 'src/destructured.ts#call:spawn:1'],
      'src/property.ts': ['src/property.ts#import:1', 'src/property.ts#call:execFile:1'],
      'src/execAlias.ts': ['src/execAlias.ts#import:1', 'src/execAlias.ts#call:exec:1'],
      'src/bound.ts': ['src/bound.ts#import:1', 'src/bound.ts#call:spawn:1'],
      'src/called.ts': ['src/called.ts#import:1', 'src/called.ts#call:spawn:1'],
      'src/wrapper.ts': ['src/wrapper.ts#wrapper:1'],
      'src/worker.ts': ['src/worker.ts#worker:1'],
      'src/workerDefault.ts': ['src/workerDefault.ts#worker:1'],
      'src/workerDynamic.ts': ['src/workerDynamic.ts#worker:1'],
      'src/workerAlias.ts': ['src/workerAlias.ts#worker:1'],
      'src/workerOptions.ts': ['src/workerOptions.ts#worker:1'],
      'src/workerReexport.ts': ['src/workerReexport.ts#worker:1'],
      'src/reexport.ts': ['src/reexport.ts#import:1'],
      'src/dynamicNamespace.ts': [
        'src/dynamicNamespace.ts#import:1',
        'src/dynamicNamespace.ts#call:exec:1',
      ],
      'src/program.ts': ['src/program.ts#embedded:dynamic:1'],
    })
  })

  const referencesOf = (files) => {
    const folder = fixture(files)
    const { program } = scanSpawnSites(folder)
    return proveTestOnly(program, 'createNativeTeamProcessDriver', folder).references
  }

  it('follows an aliased import of a test-only symbol to its production caller', () => {
    expect(referencesOf(driverFiles(['export const driver = createDriver()']))).toEqual([
      'src/caller.ts:createDriver',
    ])
  })

  it('treats class static fields and static blocks as load-time production code', () => {
    expect(
      referencesOf(driverFiles(['export class Holder {', '  static driver = createDriver()', '}'])),
    ).toEqual(['src/caller.ts:createDriver'])
    expect(
      referencesOf(
        driverFiles(['export class Holder {', '  static {', '    createDriver()', '  }', '}']),
      ),
    ).toEqual(['src/caller.ts:createDriver'])
    // An instance method runs only when called: still test-only.
    expect(
      referencesOf(
        driverFiles([
          'export class Holder {',
          '  make() {',
          '    return createDriver()',
          '  }',
          '}',
        ]),
      ),
    ).toEqual([])
  })

  it('treats decorators, IIFEs and callbacks handed to a load-time call as production', () => {
    const decorate = 'const mark = (_value: unknown) => (target: unknown) => target'
    for (const caller of [
      [decorate, '@mark(createDriver())', 'export class Holder {}'],
      [decorate, 'export class Holder {', '  @mark(createDriver())', '  make() {}', '}'],
      ['export const driver = (() => createDriver())()'],
      ['export const drivers = [1].map(() => createDriver())'],
    ])
      expect(referencesOf(driverFiles(caller)), caller.join('\n')).toEqual([
        'src/caller.ts:createDriver',
      ])
    // A function that is only stored runs when called: its uses decide, and here there are none.
    expect(referencesOf(driverFiles(['export const make = () => createDriver()']))).toEqual([])
  })
})
