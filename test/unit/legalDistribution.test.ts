// M97 lane S: what actually ships and its notice obligations. Bundle
// inputs name the set exactly, package files approximate it, and unknown
// distribution stays unknown; Apache NOTICE attribution and complete
// third-party notices are checked against what is present.

import { describe, expect, it } from 'vitest'
import { evaluateDependencyLicenses } from '../../src/core/legal/depLicenses'
import { dependency } from '../../src/core/legal/dependencies'
import { checkNotices, computeShipped } from '../../src/core/legal/distribution'
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

describe('checkNotices', () => {
  it('asks for a notice file when the shipped set has none', () => {
    const deps = [
      dependency('npm', 'package-lock.json', 'leftpad', { version: '1.3.0', scope: 'production' }),
    ]
    const shipped = computeShipped(snapshotFrom(lock), deps, {
      bundleInputs: ['package-lock.json'],
    })
    const result = checkNotices(snapshotFrom(lock), evaluated(['leftpad']), shipped, [])
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.category).toBe('noticeFile')
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
