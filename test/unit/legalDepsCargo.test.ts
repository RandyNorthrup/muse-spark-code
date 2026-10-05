// M97 lane S: Cargo evidence. The lock's sourceless entries are the
// workspace itself; licenses come from vendored crate manifests, and
// path dependencies stay out as first-party code.

import { describe, expect, it } from 'vitest'
import { readCargo } from '../../src/core/legal/ecosystems/cargo'
import { snapshotFrom } from './legal/helpers'

const manifest = {
  'Cargo.toml': `[package]
name = "example"
version = "1.0.0"
license = "MIT OR Apache-2.0"

[dependencies]
serde = "1.0"
tokio = { version = "1.0", optional = true }
local = { path = "../local" }

[dev-dependencies]
criterion = "0.5"
`,
}

const lock = {
  'Cargo.lock': `[[package]]
name = "example"
version = "1.0.0"

[[package]]
name = "serde"
version = "1.0.228"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "tokio"
version = "1.47.0"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "criterion"
version = "0.5.1"
source = "registry+https://github.com/rust-lang/crates.io-index"
`,
}

const vendored = {
  'registry/src/index/serde-1.0.228/Cargo.toml':
    '[package]\nname = "serde"\nversion = "1.0.228"\nlicense = "MIT OR Apache-2.0"\n',
}

describe('readCargo', () => {
  it('resolves the lock and skips the workspace itself', () => {
    const result = readCargo(snapshotFrom({ ...manifest, ...lock, ...vendored }))
    expect(result.projectLicenses).toEqual([{ raw: 'MIT OR Apache-2.0', file: 'Cargo.toml' }])
    const names = new Map(result.dependencies.map((dep) => [dep.name, dep]))
    expect(names.has('example')).toBe(false)
    expect(names.has('local')).toBe(false)
    expect(names.get('serde')).toMatchObject({
      version: '1.0.228',
      licenseRaw: 'MIT OR Apache-2.0',
    })
    expect(names.get('tokio')).toMatchObject({ version: '1.47.0', scope: 'optional' })
    expect(names.get('criterion')).toMatchObject({ scope: 'development' })
    expect(result.incomplete.some((entry) => entry.includes('no license metadata'))).toBe(true)
  })

  it('reads license-file pointers as project declarations', () => {
    const result = readCargo(
      snapshotFrom({
        'Cargo.toml': '[package]\nname = "example"\nversion = "1.0.0"\nlicense-file = "LICENSE"\n',
        LICENSE: 'MIT License\n\nCopyright (c) 2026 Example\n',
      }),
    )
    expect(result.projectLicenses).toEqual([{ raw: 'SEE LICENSE IN LICENSE', file: 'Cargo.toml' }])
  })

  it('reports an empty workspace as not checked', () => {
    const result = readCargo(snapshotFrom({ 'src/ok.ts': 'export const value = 1\n' }))
    expect(result).toEqual({
      dependencies: [],
      projectLicenses: [],
      incomplete: ['not checked: no Cargo manifests or locks found'],
    })
  })
})
