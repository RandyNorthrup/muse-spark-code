// M97 lane S: the deterministic scan. Bounds stop oversize work with
// clear incomplete markers, traversal throws instead of reading, and
// identical bytes always give identical results against the lane 0
// schema.

import { describe, expect, it } from 'vitest'
import { LEGAL_FILES_SCANNED_MAX, LEGAL_FINDINGS_MAX } from '../../src/shared/constants'
import { scanLegal } from '../../src/core/legal/scan'
import { legalScanResultSchema } from '../../src/shared/legal'
import { countingSnapshot, snapshotFrom } from './legal/helpers'

const headed = `// Copyright (c) 2026 Example Corp
// SPDX-License-Identifier: MIT
export const value = 1
`

const project = {
  LICENSE: 'MIT License\n\nCopyright (c) 2026 Example Corp\n',
  'package.json': JSON.stringify({ name: 'example', version: '1.0.0', license: 'MIT' }),
  'src/ok.ts': headed,
}

// The case scans past the old twenty-thousand file stop; a hosted runner
// with coverage took 3.5 s, near the default deadline.
// PLAN.md §8 (2026-10-07).
const LEGAL_CAP_SCAN_TIMEOUT_MS = 15_000

describe('scanLegal', () => {
  it('cancels before invoking any supplied reader', () => {
    let reads = 0
    const controller = new AbortController()
    controller.abort()
    expect(() =>
      scanLegal(
        {
          files: ['x.ts'],
          readFile: () => {
            reads += 1
            return 'x'
          },
        },
        { headerPolicy: 'off', signal: controller.signal },
      ),
    ).toThrow('cancelled')
    expect(reads).toBe(0)
  })

  it('scans a clean project with a valid envelope', () => {
    const result = scanLegal(snapshotFrom(project), { headerPolicy: 'optional' })
    expect(legalScanResultSchema.safeParse(result).success).toBe(true)
    expect(result.version).toBe(1)
    expect(result.ruleVersion).toBe('1')
    expect(result.dataVersion).not.toBe('')
    expect(result.findings).toEqual([])
    expect(result.exclusions).toEqual([])
  })

  it('sorts findings deterministically with stable rule ids', () => {
    const files = {
      ...project,
      'src/a.ts': 'export const a = 1\n',
      'src/b.ts': 'export const b = 1\n',
    }
    const first = scanLegal(snapshotFrom(files), { headerPolicy: 'required' })
    const second = scanLegal(snapshotFrom(files), { headerPolicy: 'required' })
    expect(first).toEqual(second)
    const ids = first.findings.map((finding) => finding.id)
    expect(ids).toEqual([...ids].toSorted((a, b) => a.localeCompare(b, 'en')))
    expect(
      ids.every((id) =>
        /^(project-license|header|dependency|compat|notice|distribution)\/1\/\d+$/.test(id),
      ),
    ).toBe(true)
  })

  it(
    'reads every file past the old twenty-thousand scan stop, with no incomplete marker',
    () => {
      const files: Record<string, string> = { ...project }
      for (let index = 0; index < LEGAL_FILES_SCANNED_MAX + 5; index += 1) {
        files[`src/many${String(index)}.ts`] = headed
      }
      const { snapshot, readPaths } = countingSnapshot(files)
      const result = scanLegal(snapshot, { headerPolicy: 'optional' })
      expect(result.incompleteChecks.some((entry) => entry.includes('more not read'))).toBe(false)
      expect(new Set(readPaths())).toEqual(new Set(Object.keys(files)))
    },
    LEGAL_CAP_SCAN_TIMEOUT_MS,
  )

  it('keeps every finding past the old five-hundred truncation, blockers first', () => {
    // Six rules with a hundred findings each: headers, dependencies,
    // compatibility, notices, distribution and project licenses.
    const files: Record<string, string> = {
      LICENSE: 'MIT License\n\nCopyright (c) 2026 Example Corp\n',
      'package.json': JSON.stringify({ name: 'example', version: '1.0.0', license: 'MIT' }),
      'THIRD-PARTY-NOTICES': 'Notices for this distribution.\n',
    }
    const packages: Record<string, unknown> = {}
    for (let index = 0; index < 150; index += 1) {
      files[`src/bare${String(index)}.ts`] = 'export const value = 1\n'
      files[`src/asset${String(index)}.png`] = 'binary asset'
      files[`src/ref${String(index)}.ts`] =
        '// Adapted from https://stackoverflow.com/questions/123/example\nexport const value = 1\n'
      packages[`node_modules/bad${String(index)}`] = { version: '1', license: 'not a license!!' }
      packages[`node_modules/gpl${String(index)}`] = { version: '1', license: 'GPL-3.0-only' }
    }
    files['package-lock.json'] = JSON.stringify({ lockfileVersion: 3, packages })
    const result = scanLegal(snapshotFrom(files), { headerPolicy: 'required' })
    expect(result.findings.length).toBeGreaterThan(LEGAL_FINDINGS_MAX)
    expect(
      result.incompleteChecks.some(
        (entry) => entry.includes('past the') && entry.includes('bound'),
      ),
    ).toBe(false)
  })

  it('refuses traversal paths instead of reading them', () => {
    expect(() =>
      scanLegal(snapshotFrom({ '../evil.ts': 'x' }), { headerPolicy: 'optional' }),
    ).toThrow('outside the workspace')
    expect(() => scanLegal(snapshotFrom({ '/abs.ts': 'x' }), { headerPolicy: 'optional' })).toThrow(
      'outside the workspace',
    )
    expect(() =>
      scanLegal(snapshotFrom({ 'src/ok.ts': headed }), {
        headerPolicy: 'optional',
        paths: ['../evil.ts'],
      }),
    ).toThrow('outside the workspace')
  })

  it('limits header checks to an explicit subset but keeps workspace facts', () => {
    const files = {
      ...project,
      'src/bare.ts': 'export const value = 1\n',
    }
    const scoped = scanLegal(snapshotFrom(files), {
      headerPolicy: 'required',
      paths: ['src/ok.ts'],
    })
    expect(scoped.scope).toBe('src/ok.ts')
    expect(scoped.findings).toEqual([])
    const whole = scanLegal(snapshotFrom(files), { headerPolicy: 'required' })
    expect(whole.scope).toBe('')
    expect(whole.findings.length).toBeGreaterThan(0)
  })

  it('rejects an unknown header policy instead of guessing', () => {
    expect(() => {
      Reflect.apply(scanLegal, undefined, [snapshotFrom(project), { headerPolicy: 'sometimes' }])
    }).toThrow('Unknown header policy')
  })
})
