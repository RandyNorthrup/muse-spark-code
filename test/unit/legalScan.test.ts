// M97 lane S: the deterministic scan. Bounds stop oversize work with
// clear incomplete markers, traversal throws instead of reading, and
// identical bytes always give identical results against the lane 0
// schema.

import { describe, expect, it } from 'vitest'
import { LEGAL_FILES_SCANNED_MAX, LEGAL_FINDINGS_MAX, UI_TEXT } from '../../src/shared/constants'
import { fingerprint } from '../../src/core/verify/fingerprint'
import { fill } from '../../src/shared/l10n/text'
import { buildRecordProblems, scanLegal } from '../../src/core/legal/scan'
import { legalScanResultSchema } from '../../src/shared/legal'
import {
  BUNDLE_OUTPUT,
  BUNDLE_TEXT,
  FULL_MIT_LICENSE,
  countingSnapshot,
  hashEvidence,
  snapshotFrom,
} from './legal/helpers'

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

  it('leaves a fully evidenced scan complete with no incomplete checks', () => {
    // C-M97-1 acceptance: a verbatim license file (Windows line endings),
    // an agreeing manifest, a headed source file and hash-proven bundle
    // inputs carry no blanket caveat, so the run exits 0 or 1 downstream,
    // not 2. CM971R2: file names alone no longer prove freshness; the
    // content hashes must match the workspace bytes.
    const files = {
      LICENSE: FULL_MIT_LICENSE.replaceAll('\n', '\r\n'),
      'package.json': JSON.stringify({ name: 'example', version: '1.0.0', license: 'MIT' }),
      'src/ok.ts': headed,
      [BUNDLE_OUTPUT]: BUNDLE_TEXT,
    }
    const result = scanLegal(snapshotFrom(files), {
      headerPolicy: 'optional',
      distribution: hashEvidence(files),
    })
    expect(legalScanResultSchema.safeParse(result).success).toBe(true)
    expect(result.findings).toEqual([])
    expect(result.incompleteChecks).toEqual([])
  })

  it('keeps a modified dependency license text under human review (RVCM971 P2)', () => {
    // Finding 3: a dependency declaring MIT whose vendored LICENSE adds a
    // payment term reads heuristically as MIT with agreeing ids; the scan
    // must still name the human-review limitation instead of exiting clean.
    const files = {
      LICENSE: FULL_MIT_LICENSE,
      'package.json': JSON.stringify({ name: 'example', version: '1.0.0', license: 'MIT' }),
      'package-lock.json': JSON.stringify({
        lockfileVersion: 3,
        packages: { 'node_modules/leftpad': { version: '1.3.0', license: 'MIT' } },
      }),
      'node_modules/leftpad/package.json': JSON.stringify({ version: '1.3.0', license: 'MIT' }),
      'node_modules/leftpad/LICENSE': `${FULL_MIT_LICENSE}You must also pay the author one dollar per installed copy.\n`,
      'src/ok.ts': headed,
      [BUNDLE_OUTPUT]: BUNDLE_TEXT,
    }
    const result = scanLegal(snapshotFrom(files), {
      headerPolicy: 'optional',
      distribution: hashEvidence(files),
    })
    expect(result.incompleteChecks.some((entry) => entry.includes('differs'))).toBe(true)
    expect(result.incompleteChecks.some((entry) => entry.includes('human review'))).toBe(true)
  })

  const metaProject = (
    inputs: Record<string, unknown>,
    record: unknown,
  ): Record<string, string> => ({
    LICENSE: FULL_MIT_LICENSE,
    'package.json': JSON.stringify({ name: 'example', version: '1.0.0', license: 'MIT' }),
    'src/ok.ts': headed,
    [BUNDLE_OUTPUT]: BUNDLE_TEXT,
    'dist/meta/bundle.json': JSON.stringify({
      inputs,
      outputs: { [BUNDLE_OUTPUT]: { bytes: BUNDLE_TEXT.length } },
    }),
    'dist/meta-hashes/bundle.json': JSON.stringify(record),
  })
  const versionTwo = {
    version: 2,
    inputs: { 'src/ok.ts': fingerprint(headed) },
    outputs: { [BUNDLE_OUTPUT]: fingerprint(BUNDLE_TEXT) },
  }

  it('derives distribution from a version-2 build record, generated modules included', () => {
    // A plugin-generated `namespace:name` module is attributed by the hash
    // the build recorded for its contents; every workspace input and
    // listed output verifies against the record.
    const files = metaProject(
      { 'src/ok.ts': { bytes: 1 }, 'browser-ns:virtual': { bytes: 1 } },
      { ...versionTwo, generated: { 'browser-ns:virtual': fingerprint('EN') } },
    )
    const result = scanLegal(snapshotFrom(files), { headerPolicy: 'optional' })
    expect(result.incompleteChecks).toEqual([])
    expect(result.findings).toEqual([])
  })

  it('lists every build-record problem, past the report bound (CM971-R3)', () => {
    const inputs = Object.fromEntries(
      Array.from({ length: 150 }, (_entry, index) => [
        `src/missing${String(index)}.ts`,
        { bytes: 1 },
      ]),
    )
    const files = metaProject({ ...inputs, 'browser-ns:virtual': { bytes: 1 } }, versionTwo)
    const problems = buildRecordProblems(snapshotFrom(files))
    expect(problems).toHaveLength(151)
    expect(problems).toContain(
      fill(UI_TEXT.legalScanner.m206, { v0: 'bundle', v1: 'browser-ns:virtual' }),
    )
    expect(
      buildRecordProblems(
        snapshotFrom(
          metaProject(
            { 'src/ok.ts': { bytes: 1 }, 'browser-ns:virtual': { bytes: 1 } },
            { ...versionTwo, generated: { 'browser-ns:virtual': fingerprint('EN') } },
          ),
        ),
      ),
    ).toEqual([])
  })

  it('names a generated module the build did not record (CM971-R3)', () => {
    const files = metaProject(
      { 'src/ok.ts': { bytes: 1 }, 'browser-ns:virtual': { bytes: 1 } },
      versionTwo,
    )
    const result = scanLegal(snapshotFrom(files), { headerPolicy: 'optional' })
    expect(result.incompleteChecks).toContain(
      fill(UI_TEXT.legalScanner.m206, { v0: 'bundle', v1: 'browser-ns:virtual' }),
    )
  })

  it('names inputs outside the workspace instead of treating them as constants (RVCM971B P2-5)', () => {
    const files = metaProject(
      {
        'src/ok.ts': { bytes: 1 },
        '../shared/review.ts': { bytes: 1 },
        '/abs/path.js': { bytes: 1 },
      },
      versionTwo,
    )
    const result = scanLegal(snapshotFrom(files), { headerPolicy: 'optional' })
    for (const outside of ['../shared/review.ts', '/abs/path.js'])
      expect(result.incompleteChecks).toContain(
        fill(UI_TEXT.legalScanner.m202, { v0: 'bundle', v1: outside }),
      )
  })

  it('refuses a version-1 record, which re-read files after the build (RVCM971B P2-4)', () => {
    const files = metaProject({ 'src/ok.ts': { bytes: 1 } }, { ...versionTwo, version: 1 })
    const result = scanLegal(snapshotFrom(files), { headerPolicy: 'optional' })
    expect(result.incompleteChecks).toContain(
      fill(UI_TEXT.legalScanner.m206, { v0: 'bundle', v1: 'src/ok.ts' }),
    )
  })

  it('reads stale bundle bytes as stale, not as fresh (RVCM971 P2)', () => {
    // Finding 4: retaining a prior input list while changing a source file
    // without rebuilding must keep the stale-input and freshness reasons.
    const files = {
      LICENSE: FULL_MIT_LICENSE,
      'package.json': JSON.stringify({ name: 'example', version: '1.0.0', license: 'MIT' }),
      'src/ok.ts': `${headed}export const extra = 2\n`,
      [BUNDLE_OUTPUT]: BUNDLE_TEXT,
    }
    const stale = scanLegal(snapshotFrom(files), {
      headerPolicy: 'optional',
      distribution: hashEvidence({ ...files, 'src/ok.ts': headed }),
    })
    expect(stale.incompleteChecks).toContain(UI_TEXT.legalScanner.m036)
    expect(stale.incompleteChecks).toContain(UI_TEXT.legalScanner.m035)
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
    // Only the removed whole-report finding truncation is gone: the combined
    // tree's stricter license-expression handling fills the retained
    // incomplete list past its bound, and that bound still reports itself.
    expect(
      result.incompleteChecks.some(
        (entry) => entry.includes('finding') && entry.includes('omitted past the'),
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

  it.each([
    { prefix: 'a/', isExplicit: false },
    { prefix: '000', isExplicit: false },
    { prefix: 'NOTICE.', isExplicit: false },
    { prefix: 'a/', isExplicit: true },
  ])(
    'retains build evidence past $prefix file-cap noise (explicit inputs $isExplicit)',
    ({ prefix, isExplicit }) => {
      const files = {
        ...Object.fromEntries(
          Array.from({ length: LEGAL_FILES_SCANNED_MAX }, (_, index) => [
            `${prefix}f${String(index)}.txt`,
            'x',
          ]),
        ),
        LICENSE: FULL_MIT_LICENSE,
        'package.json': '{"name":"own","license":"MIT"}',
        'src/z.ts': headed,
        [BUNDLE_OUTPUT]: BUNDLE_TEXT,
        'dist/meta/bundle.json': JSON.stringify({
          inputs: { 'src/z.ts': { bytes: 1 } },
          outputs: { [BUNDLE_OUTPUT]: { bytes: 1 } },
        }),
        'dist/meta-hashes/bundle.json': JSON.stringify({
          version: 2,
          inputs: { 'src/z.ts': fingerprint(headed) },
          outputs: { [BUNDLE_OUTPUT]: fingerprint(BUNDLE_TEXT) },
        }),
      }
      const { snapshot, readPaths } = countingSnapshot(files)
      const result = scanLegal(snapshot, {
        headerPolicy: 'off',
        ...(isExplicit && { distribution: { bundleInputs: ['src/z.ts'] } }),
      })
      expect(result.distribution).toContain('known bundle inputs')
      expect(result.incompleteChecks.includes(UI_TEXT.legalScanner.m035)).toBe(isExplicit)
      expect(
        result.incompleteChecks.some(
          (note) =>
            note.includes('distribution set unknown') ||
            note.includes('build-recorded') ||
            note.includes('license text did not match'),
        ),
      ).toBe(false)
      expect(result.evidenceFiles?.map((entry) => entry.path)).toContain('src/z.ts')
      expect(result.evidenceFiles?.some((entry) => entry.path === BUNDLE_OUTPUT)).toBe(!isExplicit)
      expect(new Set(readPaths()).size).toBeLessThanOrEqual(Object.keys(files).length)
      expect(result.incompleteChecks.join(' ')).not.toContain('more not read')
    },
  )

  it('rejects an unknown header policy instead of guessing', () => {
    expect(() => {
      Reflect.apply(scanLegal, undefined, [snapshotFrom(project), { headerPolicy: 'sometimes' }])
    }).toThrow('Unknown header policy')
  })
})
