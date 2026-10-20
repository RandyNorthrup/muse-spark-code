// M97 lane S: what actually ships and its notice obligations. Bundle
// inputs name the set exactly, package files approximate it, and unknown
// distribution stays unknown; Apache NOTICE attribution and complete
// third-party notices are checked against what is present.

import { describe, expect, it } from 'vitest'
import { fingerprint } from '../../src/core/verify/fingerprint'
import { evaluateDependencyLicenses } from '../../src/core/legal/depLicenses'
import { dependency } from '../../src/core/legal/dependencies'
import {
  checkNotices,
  computeShipped,
  materialInSnapshot,
  type BundleEvidence,
} from '../../src/core/legal/distribution'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { snapshotFrom } from './legal/helpers'

const lock = {
  'package-lock.json': JSON.stringify({
    lockfileVersion: 3,
    packages: {
      'node_modules/leftpad': { version: '1.3.0', license: 'WTFPL' },
      'node_modules/apache-lib': { version: '2.0.0', license: 'Apache-2.0' },
    },
  }),
}

function evaluated(names: readonly string[]) {
  const deps = [
    dependency('npm', 'package-lock.json', 'leftpad', { version: '1.3.0', licenseRaw: 'WTFPL' }),
    dependency('npm', 'package-lock.json', 'apache-lib', {
      version: '2.0.0',
      licenseRaw: 'Apache-2.0',
    }),
  ].filter((dep) => names.includes(dep.name))
  return evaluateDependencyLicenses(deps, () => true).evaluated
}

const OUT = 'dist/bundle.js'
const OUT_TEXT = 'console.log(1)\n'
const record = (
  name: string,
  inputs: Record<string, string>,
  outputs: Record<string, string>,
  extra: Partial<BundleEvidence> = {},
): BundleEvidence => ({
  name,
  inputs: Object.keys(inputs),
  outputs: Object.keys(outputs),
  outside: [],
  inputHashes: Object.fromEntries(
    Object.entries(inputs).map(([file, text]) => [file, fingerprint(text)]),
  ),
  outputHashes: Object.fromEntries(
    Object.entries(outputs).map(([file, text]) => [file, fingerprint(text)]),
  ),
  ...extra,
})

describe('computeShipped', () => {
  it('reads the shipped set from bundle inputs exactly', () => {
    const shipped = computeShipped(
      snapshotFrom({ ...lock, 'node_modules/leftpad/index.js': 'module.exports = 1\n' }),
      [
        dependency('npm', 'package-lock.json', 'leftpad', { version: '1.3.0' }),
        dependency('npm', 'package-lock.json', 'apache-lib', { version: '2.0.0' }),
      ],
      { bundleInputs: ['package-lock.json', 'node_modules/leftpad/index.js'] },
    )
    expect([...shipped.shippedNames]).toEqual(['leftpad'])
    expect(shipped.summary).toContain('bundle inputs')
  })

  it('approximates the set from package files and vscodeignore', () => {
    const shipped = computeShipped(
      snapshotFrom({ ...lock, 'dist/app.js': 'x', 'dist/app.js.map': 'y' }),
      [dependency('npm', 'package-lock.json', 'leftpad', { version: '1.3.0' })],
      { packageFiles: ['dist/'], vscodeignoreText: '*.map\n' },
    )
    expect(shipped.summary).toContain('approximated')
  })

  it('proves freshness from matching input and output hashes (RVCM971 P2)', () => {
    const files = { 'src/ok.ts': 'export const value = 1\n', [OUT]: OUT_TEXT }
    const shipped = computeShipped(snapshotFrom(files), [], {
      bundleInputs: ['src/ok.ts'],
      bundles: [record('bundle', { 'src/ok.ts': files['src/ok.ts'] }, { [OUT]: OUT_TEXT })],
    })
    expect(shipped.incomplete).toEqual([])
    expect([...(shipped.shippedFiles ?? [])]).toEqual(['src/ok.ts'])
  })

  it('reads changed bytes without a rebuild as stale, by name (RVCM971 P2)', () => {
    const shipped = computeShipped(
      snapshotFrom({ 'src/ok.ts': 'export const extra = 2\n', [OUT]: OUT_TEXT }),
      [],
      {
        bundleInputs: ['src/ok.ts'],
        bundles: [
          record('bundle', { 'src/ok.ts': 'export const value = 1\n' }, { [OUT]: OUT_TEXT }),
        ],
      },
    )
    expect(shipped.incomplete).toContain(UI_TEXT.legalScanner.m036)
    expect(shipped.incomplete).toContain(UI_TEXT.legalScanner.m035)
    expect(shipped.incomplete).toContain(
      fill(UI_TEXT.legalScanner.m206, { v0: 'bundle', v1: 'src/ok.ts' }),
    )
  })

  it('reads file names without a bundle record as stale, never as fresh (RVCM971 P2)', () => {
    const shipped = computeShipped(snapshotFrom({ 'src/ok.ts': 'x' }), [], {
      bundleInputs: ['src/ok.ts'],
    })
    expect(shipped.incomplete).toContain(UI_TEXT.legalScanner.m036)
    expect(shipped.incomplete).toContain(UI_TEXT.legalScanner.m035)
  })

  it('requires every listed output to exist with its recorded hash (RVCM971B P2-2)', () => {
    const files = { 'src/ok.ts': 'x' }
    const noOutputHash = computeShipped(snapshotFrom(files), [], {
      bundleInputs: ['src/ok.ts'],
      bundles: [record('bundle', files, {}, { outputs: [OUT] })],
    })
    expect(noOutputHash.incomplete).toContain(
      fill(UI_TEXT.legalScanner.m204, { v0: 'bundle', v1: OUT }),
    )
    const secondMissing = computeShipped(snapshotFrom({ ...files, [OUT]: OUT_TEXT }), [], {
      bundleInputs: ['src/ok.ts'],
      bundles: [record('bundle', files, { [OUT]: OUT_TEXT }, { outputs: [OUT, 'dist/second.js'] })],
    })
    expect(secondMissing.incomplete).toContain(
      fill(UI_TEXT.legalScanner.m204, { v0: 'bundle', v1: 'dist/second.js' }),
    )
    const noOutputs = computeShipped(snapshotFrom(files), [], {
      bundleInputs: ['src/ok.ts'],
      bundles: [record('bundle', files, {})],
    })
    expect(noOutputs.incomplete).toContain(UI_TEXT.legalScanner.m035)
  })

  it('fails conflicting records for one input, even when each output matches (RVCM971B P2-3)', () => {
    const files = {
      'src/shared.ts': 'export const version = 2\n',
      'dist/a.js': 'a1\n',
      'dist/z.js': 'z2\n',
    }
    const shipped = computeShipped(snapshotFrom(files), [], {
      bundleInputs: ['src/shared.ts'],
      bundles: [
        record('a', { 'src/shared.ts': 'export const version = 1\n' }, { 'dist/a.js': 'a1\n' }),
        record('z', { 'src/shared.ts': files['src/shared.ts'] }, { 'dist/z.js': 'z2\n' }),
      ],
    })
    expect(shipped.incomplete).toContain(fill(UI_TEXT.legalScanner.m203, { v0: 'src/shared.ts' }))
    expect(shipped.incomplete).toContain(
      fill(UI_TEXT.legalScanner.m206, { v0: 'a', v1: 'src/shared.ts' }),
    )
  })

  it('names inputs outside the workspace instead of dropping them (RVCM971B P2-5)', () => {
    const files = { 'src/ok.ts': 'x', [OUT]: OUT_TEXT }
    const shipped = computeShipped(snapshotFrom(files), [], {
      bundleInputs: ['src/ok.ts'],
      bundles: [
        record(
          'bundle',
          { 'src/ok.ts': 'x' },
          { [OUT]: OUT_TEXT },
          {
            outside: ['../shared/review.ts'],
          },
        ),
      ],
    })
    expect(shipped.incomplete).toContain(
      fill(UI_TEXT.legalScanner.m202, { v0: 'bundle', v1: '../shared/review.ts' }),
    )
  })

  it('attributes a generated module only by its recorded hash', () => {
    const files = { 'src/ok.ts': 'x', [OUT]: OUT_TEXT }
    const bundle = record(
      'bundle',
      { 'src/ok.ts': 'x' },
      { [OUT]: OUT_TEXT },
      {
        generated: ['browser-ns:table'],
      },
    )
    const missing = computeShipped(snapshotFrom(files), [], {
      bundleInputs: ['src/ok.ts'],
      bundles: [bundle],
    })
    expect(missing.incomplete).toContain(
      fill(UI_TEXT.legalScanner.m206, { v0: 'bundle', v1: 'browser-ns:table' }),
    )
    const recorded = computeShipped(snapshotFrom(files), [], {
      bundleInputs: ['src/ok.ts'],
      bundles: [{ ...bundle, generatedHashes: { 'browser-ns:table': fingerprint('EN') } }],
    })
    expect(recorded.incomplete).toEqual([])
  })

  it('matches Windows-separator evidence against snapshot paths', () => {
    const files = { 'src/ok.ts': 'x', [OUT]: OUT_TEXT }
    const shipped = computeShipped(snapshotFrom(files), [], {
      bundleInputs: [String.raw`src\ok.ts`],
      bundles: [
        {
          name: 'bundle',
          inputs: [String.raw`src\ok.ts`],
          outputs: [String.raw`dist\bundle.js`],
          outside: [],
          inputHashes: { [String.raw`src\ok.ts`]: fingerprint('x') },
          outputHashes: { [String.raw`dist\bundle.js`]: fingerprint(OUT_TEXT) },
        },
      ],
    })
    expect(shipped.incomplete).toEqual([])
    expect([...(shipped.shippedFiles ?? [])]).toEqual(['src/ok.ts'])
  })

  it('matches a Windows-separator generated module against its build-captured hash', () => {
    const files = { 'src/ok.ts': 'x', [OUT]: OUT_TEXT }
    const windowsModule = String.raw`resource-validation:C:\work\node_modules\zod\v4\core\util.js`
    const bundle = record(
      'bundle',
      { 'src/ok.ts': 'x' },
      { [OUT]: OUT_TEXT },
      { generated: [windowsModule] },
    )
    const shipped = computeShipped(snapshotFrom(files), [], {
      bundleInputs: ['src/ok.ts'],
      bundles: [
        {
          ...bundle,
          generatedHashes: {
            'resource-validation:C:/work/node_modules/zod/v4/core/util.js': fingerprint('zod'),
          },
        },
      ],
    })
    expect(shipped.incomplete).toEqual([])
  })

  it('leaves distribution unknown without evidence', () => {
    const shipped = computeShipped(
      snapshotFrom(lock),
      [dependency('npm', 'package-lock.json', 'leftpad', { version: '1.3.0' })],
      {},
    )
    expect(shipped.shippedNames.size).toBe(0)
    expect(shipped.unknownNames).toEqual(['leftpad'])
    expect(shipped.incomplete.some((entry) => entry.includes('distribution set unknown'))).toBe(
      true,
    )
  })
})

describe('materialInSnapshot', () => {
  it('never borrows material across installed copies for a versionless dependency', () => {
    const snapshot = snapshotFrom({
      'node_modules/dup/package.json': JSON.stringify({ version: '1.0.0' }),
      'node_modules/dup/LICENSE': 'one\n',
      'node_modules/other/node_modules/dup/package.json': JSON.stringify({ version: '2.0.0' }),
      'node_modules/other/node_modules/dup/LICENSE': 'two\n',
    })
    const dep = dependency('npm', 'package.json', 'dup', {})
    expect(materialInSnapshot(snapshot, dep)).toEqual([])
  })

  it('locates the lone installed copy for a versionless dependency', () => {
    const snapshot = snapshotFrom({
      'node_modules/dup/package.json': JSON.stringify({ version: '1.0.0' }),
      'node_modules/dup/LICENSE': 'one\n',
    })
    const dep = dependency('npm', 'package.json', 'dup', {})
    expect(materialInSnapshot(snapshot, dep)).toEqual([
      'node_modules/dup/LICENSE',
      'node_modules/dup/package.json',
    ])
  })
})

describe('checkNotices', () => {
  it('asks for a notice file when the shipped set has none', () => {
    const deps = [
      dependency('npm', 'package-lock.json', 'leftpad', { version: '1.3.0', scope: 'production' }),
    ]
    const files = { ...lock, 'node_modules/leftpad/index.js': 'module.exports = 1\n' }
    const shipped = computeShipped(snapshotFrom(files), deps, {
      bundleInputs: ['node_modules/leftpad/index.js'],
    })
    const result = checkNotices(snapshotFrom(files), evaluated(['leftpad']), shipped, [])
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.category).toBe('noticeFile')
  })

  it('treats a dependency the bundles never took in as not shipping (scope ruling)', () => {
    const deps = [
      dependency('npm', 'package-lock.json', 'leftpad', { version: '1.3.0', scope: 'production' }),
    ]
    const shipped = computeShipped(snapshotFrom(lock), deps, {
      bundleInputs: ['package-lock.json'],
    })
    expect(shipped.unknownNames).toEqual([])
    expect(checkNotices(snapshotFrom(lock), evaluated(['leftpad']), shipped, []).findings).toEqual(
      [],
    )
  })

  it('counts a root notice file the package carries beside its bundles', () => {
    const files = {
      ...lock,
      'node_modules/leftpad/index.js': 'module.exports = 1\n',
      THIRD_PARTY_NOTICES: 'leftpad (WTFPL)\n',
    }
    const deps = [
      dependency('npm', 'package-lock.json', 'leftpad', { version: '1.3.0', scope: 'production' }),
    ]
    const evidence = { bundleInputs: ['node_modules/leftpad/index.js'] }
    const notices = [{ path: 'THIRD_PARTY_NOTICES', text: files.THIRD_PARTY_NOTICES }]
    const carried = computeShipped(snapshotFrom(files), deps, evidence)
    expect(
      checkNotices(snapshotFrom(files), evaluated(['leftpad']), carried, notices).findings,
    ).toEqual([])
    const excluded = computeShipped(snapshotFrom(files), deps, {
      ...evidence,
      vscodeignoreText: 'THIRD_PARTY_NOTICES\n',
    })
    expect(
      checkNotices(snapshotFrom(files), evaluated(['leftpad']), excluded, notices).findings,
    ).toHaveLength(1)
  })

  it('checks Apache NOTICE attribution against present notices', () => {
    const files = {
      ...lock,
      'node_modules/apache-lib/NOTICE': 'Copyright 2026 Upstream\n',
      'node_modules/apache-lib/index.js': 'x',
      'THIRD_PARTY_NOTICES.md': '# Notices\n\nleftpad (WTFPL)\n',
    }
    const shipped = computeShipped(
      snapshotFrom(files),
      [dependency('npm', 'package-lock.json', 'apache-lib', { version: '2.0.0' })],
      { bundleInputs: Object.keys(files) },
    )
    const result = checkNotices(
      snapshotFrom(files),
      evaluated(['apache-lib', 'leftpad']),
      shipped,
      [{ path: 'THIRD_PARTY_NOTICES.md', text: '# Notices\n\nleftpad (WTFPL)\n' }],
    )
    const apache = result.findings.find((finding) => finding.packageName === 'apache-lib')
    expect(apache?.severity).toBe('should-fix')
    expect(apache?.explanation).toContain('upstream NOTICE')
  })

  it('stays silent when attribution is complete', () => {
    const files = {
      ...lock,
      'node_modules/apache-lib/NOTICE': 'Copyright 2026 Upstream\n',
      'node_modules/apache-lib/index.js': 'x',
      'node_modules/leftpad/index.js': 'x',
      'THIRD_PARTY_NOTICES.md':
        '# Notices\n\napache-lib (Apache-2.0)\nCopyright 2026 Upstream\nleftpad (WTFPL)\n',
    }
    const shipped = computeShipped(
      snapshotFrom(files),
      [
        dependency('npm', 'package-lock.json', 'apache-lib', { version: '2.0.0' }),
        dependency('npm', 'package-lock.json', 'leftpad', { version: '1.3.0' }),
      ],
      { bundleInputs: Object.keys(files) },
    )
    const result = checkNotices(
      snapshotFrom(files),
      evaluated(['apache-lib', 'leftpad']),
      shipped,
      [{ path: 'THIRD_PARTY_NOTICES.md', text: files['THIRD_PARTY_NOTICES.md'] }],
    )
    expect(result.findings).toEqual([])
  })
})
