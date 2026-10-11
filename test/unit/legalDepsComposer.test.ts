// M97 lane S: Composer evidence. The lock carries per-package
// licenses; platform requirements are the runtime, not packages.

import { describe, expect, it } from 'vitest'
import { readComposer } from '../../src/core/legal/ecosystems/composer'
import { snapshotFrom } from './legal/helpers'

const manifest = {
  'composer.json': JSON.stringify({
    name: 'example/app',
    license: 'MIT',
    require: { php: '>=8.2', 'monolog/monolog': '^3.0' },
    'require-dev': { 'phpunit/phpunit': '^11.0' },
  }),
}

const lock = {
  'composer.lock': JSON.stringify({
    packages: [{ name: 'monolog/monolog', version: '3.7.0', license: ['MIT'] }],
    'packages-dev': [{ name: 'phpunit/phpunit', version: '11.4.0', license: 'BSD-3-Clause' }],
  }),
}

describe('readComposer', () => {
  it('resolves the lock and keeps licenses and scopes', () => {
    const result = readComposer(snapshotFrom({ ...manifest, ...lock }))
    expect(result.projectLicenses).toEqual([{ raw: 'MIT', file: 'composer.json' }])
    const names = new Map(result.dependencies.map((dep) => [dep.name, dep]))
    expect(names.get('monolog/monolog')).toMatchObject({
      version: '3.7.0',
      scope: 'production',
      licenseRaw: 'MIT',
    })
    expect(names.get('phpunit/phpunit')).toMatchObject({
      scope: 'development',
      licenseRaw: 'BSD-3-Clause',
    })
    expect(names.has('php')).toBe(false)
  })

  it('reads license arrays as an OR choice', () => {
    const result = readComposer(
      snapshotFrom({
        'composer.lock': JSON.stringify({
          packages: [{ name: 'dual/pkg', version: '1.0.0', license: ['MIT', 'GPL-2.0-or-later'] }],
        }),
      }),
    )
    expect(result.dependencies.find((dep) => dep.name === 'dual/pkg')?.licenseRaw).toBe(
      'MIT OR GPL-2.0-or-later',
    )
  })

  it('reports unresolved requirements and invalid manifests', () => {
    const unresolved = readComposer(snapshotFrom(manifest))
    expect(unresolved.incomplete.some((entry) => entry.includes('no locked version'))).toBe(true)
    const invalid = readComposer(snapshotFrom({ 'composer.json': '{oops' }))
    expect(invalid.incomplete.some((entry) => entry.includes('not valid JSON'))).toBe(true)
  })

  it('reports an empty workspace as not checked', () => {
    const result = readComposer(snapshotFrom({ 'src/ok.ts': 'export const value = 1\n' }))
    expect(result.incomplete).toEqual([
      'not checked: no composer.json, composer.lock or installed.json found',
    ])
  })
})
