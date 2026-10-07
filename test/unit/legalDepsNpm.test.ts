// M97 lane S: npm, pnpm and Yarn evidence. Locks resolve versions;
// licenses come from lock entries or present installed metadata, and
// every gap stays a named `not checked` entry, never a silent zero.

import { describe, expect, it } from 'vitest'
import { readNpm } from '../../src/core/legal/ecosystems/npm'
import { snapshotFrom } from './legal/helpers'

const manifest = {
  'package.json': JSON.stringify({
    name: 'example',
    version: '1.0.0',
    license: 'MIT',
    dependencies: { leftpad: '^1.0.0', express: '~4.0.0' },
    devDependencies: { vitest: '^5.0.0' },
  }),
}

const lock = {
  'package-lock.json': JSON.stringify({
    name: 'example',
    lockfileVersion: 3,
    packages: {
      '': { name: 'example', license: 'MIT' },
      'node_modules/leftpad': { version: '1.3.0', license: 'WTFPL' },
      'node_modules/express': { version: '4.21.0', dev: true },
      'node_modules/vitest': { version: '5.0.0', license: 'MIT', dev: true },
    },
  }),
}

describe('readNpm', () => {
  it('resolves manifests against locks and keeps scopes', () => {
    const result = readNpm(snapshotFrom({ ...manifest, ...lock }))
    const names = new Map(result.dependencies.map((dep) => [dep.name, dep]))
    expect(names.get('leftpad')).toMatchObject({
      version: '1.3.0',
      scope: 'production',
      licenseRaw: 'WTFPL',
    })
    expect(names.get('express')).toMatchObject({ version: '4.21.0', licenseRaw: undefined })
    expect(names.get('vitest')).toMatchObject({ version: '5.0.0', scope: 'development' })
    expect(result.projectLicenses).toEqual([{ raw: 'MIT', file: 'package.json' }])
    expect(
      result.incomplete.some(
        (entry) => entry.includes('express') || entry.includes('no license metadata'),
      ),
    ).toBe(true)
  })

  it('fills lock gaps from present installed metadata', () => {
    const result = readNpm(
      snapshotFrom({
        ...manifest,
        ...lock,
        'node_modules/express/package.json': JSON.stringify({
          name: 'express',
          version: '4.21.0',
          license: 'MIT',
        }),
      }),
    )
    const express = result.dependencies.find((dep) => dep.name === 'express')
    expect(express?.licenseRaw).toBe('MIT')
    expect(express?.evidenceFile).toBe('node_modules/express/package.json')
  })

  it('reads classic yarn locks as versions without licenses', () => {
    const result = readNpm(
      snapshotFrom({
        ...manifest,
        'yarn.lock':
          '# yarn lockfile v1\n\nleftpad@^1.0.0:\n  version "1.3.0"\n  resolved "https://registry.yarnpkg.com/leftpad/-/leftpad-1.3.0.tgz"\n',
      }),
    )
    expect(result.dependencies.find((dep) => dep.name === 'leftpad')?.version).toBe('1.3.0')
    expect(result.incomplete.some((entry) => entry.includes('yarn.lock'))).toBe(true)
  })

  it('preserves separate resolved Yarn versions of the same package', () => {
    const result = readNpm(
      snapshotFrom({ 'yarn.lock': 'x@^1:\n  version "1"\n\nx@^2:\n  version "2"\n' }),
    )
    expect(result.dependencies.filter((dep) => dep.name === 'x').map((dep) => dep.version)).toEqual(
      ['1', '2'],
    )
  })

  it('reads Berry and pnpm locks as versions without licenses', () => {
    const berry = readNpm(
      snapshotFrom({
        'yarn.lock': '"leftpad@npm:^1.0.0":\n  version: 1.3.0\n  resolution: "leftpad@npm:1.3.0"\n',
      }),
    )
    expect(berry.dependencies.find((dep) => dep.name === 'leftpad')?.version).toBe('1.3.0')
    const pnpm = readNpm(
      snapshotFrom({
        'pnpm-lock.yaml':
          'lockfileVersion: 9.0\npackages:\n  leftpad@1.3.0:\n    resolution: {integrity: sha512-x}\n',
      }),
    )
    expect(pnpm.dependencies.find((dep) => dep.name === 'leftpad')?.version).toBe('1.3.0')
    expect(pnpm.incomplete.some((entry) => entry.includes('pnpm-lock.yaml'))).toBe(true)
  })

  it('reports unresolved requirements and invalid manifests', () => {
    const unresolved = readNpm(snapshotFrom(manifest))
    expect(unresolved.incomplete.some((entry) => entry.includes('no resolved version'))).toBe(true)
    const invalid = readNpm(snapshotFrom({ 'package.json': '{oops' }))
    expect(invalid.incomplete.some((entry) => entry.includes('not valid JSON'))).toBe(true)
  })

  it('reports an empty workspace as not checked', () => {
    const result = readNpm(snapshotFrom({ 'src/ok.ts': 'export const value = 1\n' }))
    expect(result.dependencies).toEqual([])
    expect(result.incomplete).toEqual([
      'not checked: no npm manifests, locks or installed metadata found',
    ])
  })
})
