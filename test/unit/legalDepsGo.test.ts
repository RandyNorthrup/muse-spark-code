// M97 lane S: Go module evidence. go.mod pins versions, go.sum alone
// proves only that a version existed, and vendored license texts close
// the gap; tool directives are development scope.

import { describe, expect, it } from 'vitest'
import { readGo } from '../../src/core/legal/ecosystems/go'
import { snapshotFrom } from './legal/helpers'

const mod = {
  'go.mod': `module example.com/hello

go 1.24.0

require (
\texample.com/mod v1.2.3
\texample.com/tool v1.0.0 // indirect
)

tool example.com/tool

replace example.com/local => ../local
`,
}

const sum = {
  'go.sum': `example.com/mod v1.2.3 h1:abc=
example.com/mod v1.2.3/go.mod h1:def=
example.com/extra v0.9.0 h1:ghi=
`,
}

const vendor = {
  'vendor/modules.txt': `## explicit; go 1.24.0
# example.com/mod v1.2.3
## explicit; go 1.24.0
# example.com/extra v0.9.0
`,
  'vendor/example.com/mod/LICENSE': 'MIT License\n\nCopyright (c) 2026 Example\n',
}

describe('readGo', () => {
  it('pins go.mod versions and scopes tools as development', () => {
    const result = readGo(snapshotFrom({ ...mod, ...sum, ...vendor }))
    const names = new Map(result.dependencies.map((dep) => [dep.name, dep]))
    expect(names.get('example.com/mod')).toMatchObject({
      version: 'v1.2.3',
      scope: 'production',
      licenseRaw: 'MIT',
    })
    expect(names.get('example.com/tool')).toMatchObject({ version: 'v1.0.0', scope: 'development' })
    expect(names.has('example.com/local')).toBe(false)
    expect(names.get('example.com/extra')).toMatchObject({
      version: 'v0.9.0',
      licenseRaw: undefined,
    })
    expect(
      result.incomplete.some(
        (entry) => entry.includes('Checksums alone') || entry.includes('checksums'),
      ),
    ).toBe(true)
  })

  it('resolves replaced versions from replace directives', () => {
    const result = readGo(
      snapshotFrom({
        'go.mod':
          'module example.com/hello\n\nrequire example.com/mod v1.0.0\n\nreplace example.com/mod => example.com/mod v1.2.3\n',
      }),
    )
    expect(result.dependencies.find((dep) => dep.name === 'example.com/mod')?.version).toBe(
      'v1.2.3',
    )
  })

  it('reports an empty workspace as not checked', () => {
    const result = readGo(snapshotFrom({ 'src/ok.ts': 'export const value = 1\n' }))
    expect(result.incomplete).toEqual([
      'not checked: no go.mod, go.sum or vendor/modules.txt found',
    ])
  })
})
