// M97 lane S: dependency declarations and compatibility. Malformed,
// unknown, deprecated and proprietary declarations become findings; an
// OR choice with a clean branch softens to a note; shipped strong
// copyleft is a blocker, never a categorical incompatibility verdict.

import { describe, expect, it } from 'vitest'
import { compatibilityFamilies, evaluateCompatibility } from '../../src/core/legal/compat'
import {
  evaluateDependencyLicenses,
  type EvaluatedDependency,
} from '../../src/core/legal/depLicenses'
import { dependency, type LegalDependency } from '../../src/core/legal/dependencies'
import { SPDX_LICENSE_IDS } from '../../src/core/legal/data'
import { snapshotFrom } from './legal/helpers'

function shippedDep(
  name: string,
  licenseRaw: string | undefined,
  scope: LegalDependency['scope'] = 'production',
): LegalDependency {
  return dependency('npm', 'package-lock.json', name, { version: '1.0.0', scope, licenseRaw })
}

function evaluate(
  deps: readonly LegalDependency[],
  shipped: readonly string[] = [],
): readonly EvaluatedDependency[] {
  const names = new Set(shipped)
  return evaluateDependencyLicenses(deps, (dep) => names.has(dep.name)).evaluated
}

describe('evaluateDependencyLicenses', () => {
  it('preserves SPDX noncommercial terms for restricted-use review', () => {
    const result = evaluateDependencyLicenses(
      [shippedDep('restricted', 'PolyForm-Noncommercial-1.0.0')],
      () => true,
    )
    expect(result.evaluated).toHaveLength(1)
    const reviewed = evaluateCompatibility(result.evaluated, ['MIT'])
    expect(reviewed[0]?.explanation).toContain('restricted terms')
  })

  it('stays silent for recognized permissive declarations', () => {
    const result = evaluateDependencyLicenses([shippedDep('leftpad', 'WTFPL')], () => false)
    expect(result.findings).toEqual([])
    expect(result.evaluated).toHaveLength(1)
  })

  it('flags malformed expressions as should-fix', () => {
    const result = evaluateDependencyLicenses([shippedDep('broken', 'MIT or')], () => false)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({
      severity: 'should-fix',
      category: 'dependencyLicense',
    })
    expect(result.evaluated).toHaveLength(0)
  })

  it('flags unknown, deprecated and custom terms as advice', () => {
    const result = evaluateDependencyLicenses(
      [
        shippedDep('mystery', 'Foo-1.0'),
        shippedDep('oldie', 'GPL-2.0'),
        shippedDep('custom', 'LicenseRef-Mine'),
      ],
      () => false,
    )
    expect(result.findings).toHaveLength(3)
    expect(result.findings.every((finding) => finding.severity === 'advice')).toBe(true)
  })

  it('treats shipped UNLICENSED as should-fix and dev-only as advice', () => {
    const shipped = evaluateDependencyLicenses([shippedDep('secret', 'UNLICENSED')], () => true)
    expect(shipped.findings[0]?.severity).toBe('should-fix')
    const dev = evaluateDependencyLicenses(
      [shippedDep('secret', 'UNLICENSED', 'development')],
      () => false,
    )
    expect(dev.findings[0]?.severity).toBe('advice')
  })

  it('leaves absent declarations to the coverage gaps', () => {
    const result = evaluateDependencyLicenses([shippedDep('bare', undefined)], () => false)
    expect(result.findings).toEqual([])
    expect(result.evaluated).toHaveLength(0)
  })
})

describe('evaluateCompatibility', () => {
  it('blocks shipped strong copyleft against a permissive project', () => {
    const findings = evaluateCompatibility(evaluate([shippedDep('gpl', 'GPL-3.0-only')], ['gpl']), [
      'MIT',
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ severity: 'blocker' })
    expect(findings[0]?.explanation).toContain('may oblige source disclosure')
    expect(findings[0]?.explanation).not.toContain('incompatible')
  })

  it('advises development-only copyleft and conditions unknown distribution', () => {
    const dev = evaluateCompatibility(
      evaluate([shippedDep('gpl', 'GPL-3.0-only', 'development')]),
      ['MIT'],
    )
    expect(dev[0]?.severity).toBe('advice')
    const unknown = evaluateCompatibility(evaluate([shippedDep('gpl', 'GPL-3.0-only')]), ['MIT'])
    expect(unknown[0]?.severity).toBe('should-fix')
  })

  it('softens a clean OR branch to a confirmation note', () => {
    const findings = evaluateCompatibility(
      evaluate([shippedDep('dual', 'GPL-3.0-only OR MIT')], ['dual']),
      ['MIT'],
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('advice')
    expect(findings[0]?.explanation).toContain('dual-licensed')
  })

  it('asks the linking question for shipped LGPL and file terms for MPL', () => {
    const lgpl = evaluateCompatibility(evaluate([shippedDep('lib', 'LGPL-2.1-only')], ['lib']), [
      'MIT',
    ])
    expect(lgpl[0]?.severity).toBe('should-fix')
    expect(lgpl[0]?.explanation).toContain('relinking')
    const mpl = evaluateCompatibility(evaluate([shippedDep('mod', 'MPL-2.0')], ['mod']), ['MIT'])
    expect(mpl[0]?.severity).toBe('should-fix')
  })

  it('blocks shipped SSPL and conditions source-available terms', () => {
    const sspl = evaluateCompatibility(evaluate([shippedDep('db', 'SSPL-1.0')], ['db']), ['MIT'])
    expect(sspl[0]?.severity).toBe('blocker')
    const busl = evaluateCompatibility(evaluate([shippedDep('queue', 'BUSL-1.1')], ['queue']), [
      'MIT',
    ])
    expect(busl[0]?.severity).toBe('should-fix')
    expect(busl[0]?.explanation).toContain('not an open-source grant')
  })

  it('stays silent when the project shares the copyleft', () => {
    const findings = evaluateCompatibility(evaluate([shippedDep('gpl', 'GPL-3.0-only')], ['gpl']), [
      'GPL-3.0-only',
    ])
    expect(findings).toEqual([])
  })

  it('names unclassified licenses for a human read', () => {
    const findings = evaluateCompatibility(evaluate([shippedDep('odd', 'CC-BY-SA-4.0')], ['odd']), [
      'MIT',
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('advice')
  })
})

describe('compatibilityFamilies', () => {
  it('names only current SPDX identifiers', () => {
    const families = compatibilityFamilies()
    const listed1 = [families.strong, families.weak, families.restricted, families.permissive]
    for (const set of listed1) {
      for (const id of set) {
        expect(SPDX_LICENSE_IDS.has(id)).toBe(true)
      }
    }
  })

  it('keeps BUSL-1.1 distinct from Boost BSL-1.0', () => {
    const families = compatibilityFamilies()
    expect(families.restricted.has('BUSL-1.1')).toBe(true)
    expect(families.permissive.has('BSL-1.0')).toBe(true)
    expect(families.restricted.has('BSL-1.0')).toBe(false)
  })
})

describe('snapshotFrom', () => {
  it('serves sorted paths and exact reads', () => {
    const snapshot = snapshotFrom({ 'b.ts': 'b', 'a.ts': 'a' })
    expect(snapshot.files).toEqual(['a.ts', 'b.ts'])
    expect(snapshot.readFile('a.ts')).toBe('a')
    expect(snapshot.readFile('missing.ts')).toBeUndefined()
  })
})
