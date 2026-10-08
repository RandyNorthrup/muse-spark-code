import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  inventoryTable,
  proveTestOnly,
  scanSpawnSites,
} from '../../scripts/lib/spawn-inventory.mjs'

const root = path.resolve('.')
const captured = {}
const order = (left, right) => left.localeCompare(right)
// Scan the source tree once, at the repository's own hook timeout.
beforeAll(() => {
  Object.assign(captured, scanSpawnSites(root))
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
    }
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
