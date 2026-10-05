// M97 lane S: pip, uv and Poetry evidence. Pins and lock stanzas
// resolve versions; licenses come from present METADATA or stay
// unknown, and dynamic or missing versions are named gaps.

import { describe, expect, it } from 'vitest'
import { readPython } from '../../src/core/legal/ecosystems/python'
import { snapshotFrom } from './legal/helpers'

const pyproject = {
  'pyproject.toml': `[project]
name = "example"
version = "1.0.0"
license = {text = "MIT"}
dependencies = ["requests==2.31.0", "flask>=3.0"]

[project.optional-dependencies]
test = ["pytest==8.0.0"]
`,
}

const metadata = {
  'site-packages/requests-2.31.0.dist-info/METADATA':
    'Metadata-Version: 2.1\nName: requests\nVersion: 2.31.0\nLicense-Expression: Apache-2.0\n',
}

describe('readPython', () => {
  it('reads PEP 639 licenses, pins and optional groups', () => {
    const result = readPython(snapshotFrom({ ...pyproject, ...metadata }))
    expect(result.projectLicenses).toEqual([{ raw: 'MIT', file: 'pyproject.toml' }])
    const names = new Map(result.dependencies.map((dep) => [dep.name, dep]))
    expect(names.get('requests')).toMatchObject({
      version: '2.31.0',
      scope: 'production',
      licenseRaw: 'Apache-2.0',
    })
    expect(names.get('flask')).toMatchObject({ version: undefined, scope: 'production' })
    expect(names.get('pytest')).toMatchObject({ version: '8.0.0', scope: 'optional' })
    expect(result.incomplete.some((entry) => entry.includes('no resolved version'))).toBe(true)
  })

  it('reads poetry licenses and lock stanzas', () => {
    const result = readPython(
      snapshotFrom({
        'pyproject.toml': '[tool.poetry]\nname = "example"\nversion = "1.0.0"\nlicense = "MIT"\n',
        'poetry.lock':
          '[[package]]\nname = "requests"\nversion = "2.31.0"\ndescription = "HTTP"\noptional = false\npython-versions = ">=3.8"\n',
      }),
    )
    expect(result.projectLicenses).toEqual([{ raw: 'MIT', file: 'pyproject.toml' }])
    expect(result.dependencies.find((dep) => dep.name === 'requests')?.version).toBe('2.31.0')
    expect(result.incomplete.some((entry) => entry.includes('poetry.lock'))).toBe(true)
  })

  it('follows requirements includes and reports absent ones', () => {
    const result = readPython(
      snapshotFrom({
        'requirements.txt': '-r more.txt\nrequests==2.31.0\n(((\n',
        'uv.lock': '[[package]]\nname = "requests"\nversion = "2.31.0"\n',
      }),
    )
    expect(
      result.incomplete.some((entry) => entry.includes('more.txt') && entry.includes('absent')),
    ).toBe(true)
    expect(result.incomplete.some((entry) => entry.includes('does not parse'))).toBe(true)
    expect(result.dependencies.find((dep) => dep.name === 'requests')?.version).toBe('2.31.0')
  })

  it('prefers License-Expression over short License text', () => {
    const result = readPython(
      snapshotFrom({
        'x-1.0.dist-info/METADATA': 'Metadata-Version: 2.1\nName: x\nVersion: 1.0\nLicense: MIT\n',
        'y-1.0.dist-info/METADATA':
          'Metadata-Version: 2.4\nName: y\nVersion: 1.0\nLicense-Expression: Apache-2.0 OR MIT\nLicense: A very long license text that is not an identifier and keeps going past any reasonable short field length for sure.\n',
      }),
    )
    const names = new Map(result.dependencies.map((dep) => [dep.name, dep]))
    expect(names.get('x')?.licenseRaw).toBe('MIT')
    expect(names.get('y')?.licenseRaw).toBe('Apache-2.0 OR MIT')
  })

  it('reports an empty workspace as not checked', () => {
    const result = readPython(snapshotFrom({ 'src/ok.ts': 'export const value = 1\n' }))
    expect(result.dependencies).toEqual([])
    expect(result.incomplete).toEqual([
      'not checked: no Python manifests, locks or distribution metadata found',
    ])
  })
})
