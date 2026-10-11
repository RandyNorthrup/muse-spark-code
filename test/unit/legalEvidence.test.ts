import { describe, expect, it } from 'vitest'
import { readNpm } from '../../src/core/legal/ecosystems/npm'
import { readPython } from '../../src/core/legal/ecosystems/python'
import { readCargo } from '../../src/core/legal/ecosystems/cargo'
import { readGo } from '../../src/core/legal/ecosystems/go'
import { readJvm } from '../../src/core/legal/ecosystems/jvm'
import { readNuGet } from '../../src/core/legal/ecosystems/nuget'
import { readComposer } from '../../src/core/legal/ecosystems/composer'
import { readGems } from '../../src/core/legal/ecosystems/gems'
import { evaluateCompatibility } from '../../src/core/legal/compat'
import { evaluateDependencyLicenses } from '../../src/core/legal/depLicenses'
import { dependency } from '../../src/core/legal/dependencies'
import { parseSpdxExpression, orAlternatives } from '../../src/core/legal/spdx'
import { scanLegal } from '../../src/core/legal/scan'
import { scanHeaders } from '../../src/core/legal/headers'
import { LEGAL_SCAN_PATHS_MAX, LEGAL_PATH_MAX_CHARS } from '../../src/shared/constants'
import { snapshotFrom } from './legal/helpers'

describe('legal evidence regressions', () => {
  it('reports conflicting Maven and NuGet metadata instead of choosing one license', () => {
    const jvm = readJvm(
      snapshotFrom({
        'build.gradle': 'implementation "g:x:1"\n',
        'repo/a.pom':
          '<project><groupId>g</groupId><artifactId>x</artifactId><version>1</version><licenses><license><name>MIT</name></license></licenses></project>',
        'repo/b.pom':
          '<project><groupId>g</groupId><artifactId>x</artifactId><version>1</version><licenses><license><name>GPL-3.0-only</name></license></licenses></project>',
      }),
    )
    expect(jvm.incomplete.join(' ')).toContain('conflict')
    expect(jvm.dependencies[0]?.licenseRaw).toBeUndefined()
    const nuget = readNuGet(
      snapshotFrom({
        'own.csproj': '<Project><PackageReference Include="X" Version="1" /></Project>',
        'packages/x/1/a.nuspec':
          '<package><metadata><id>X</id><version>1</version><license type="expression">MIT</license></metadata></package>',
        'packages/x/1/b.nuspec':
          '<package><metadata><id>X</id><version>1</version><license type="expression">GPL-3.0-only</license></metadata></package>',
      }),
    )
    expect(nuget.incomplete.join(' ')).toContain('conflict')
    expect(nuget.dependencies[0]?.licenseRaw).toBeUndefined()
  })

  it('does not associate Maven licenses by artifact name without matching group and version', () => {
    const result = readJvm(
      snapshotFrom({
        'pom.xml':
          '<project><groupId>own</groupId><artifactId>own</artifactId><version>1</version><dependencies><dependency><groupId>good</groupId><artifactId>x</artifactId><version>1</version></dependency></dependencies></project>',
        'repo/x.pom':
          '<project><groupId>other</groupId><artifactId>x</artifactId><version>2</version><licenses><license><name>MIT</name></license></licenses></project>',
      }),
    )
    expect(result.dependencies.find((dep) => dep.name === 'good/x')?.licenseRaw).toBeUndefined()
    expect(result.incomplete.join(' ')).toContain('license')
  })

  it('uses NuGet resolved versions and refuses licenses from another installed version', () => {
    const result = readNuGet(
      snapshotFrom({
        'own.csproj': '<Project><PackageReference Include="X" Version="[1,3)" /></Project>',
        'packages.lock.json': JSON.stringify({
          version: 1,
          dependencies: { net8: { X: { type: 'Direct', resolved: '2' } } },
        }),
        'packages/x/1/x.nuspec':
          '<package><metadata><id>X</id><version>1</version><license type="expression">MIT</license></metadata></package>',
      }),
    )
    expect(result.dependencies.find((dep) => dep.name === 'X')).toMatchObject({
      version: '2',
      licenseRaw: undefined,
    })
  })

  it('keeps separate Cargo locked versions and refuses a mismatched vendored version', () => {
    const result = readCargo(
      snapshotFrom({
        'Cargo.lock':
          '[[package]]\nname = "x"\nversion = "1"\nsource = "registry+local"\n[[package]]\nname = "x"\nversion = "2"\nsource = "registry+local"\n',
        'vendor/x/Cargo.toml': '[package]\nname = "x"\nversion = "3"\nlicense = "MIT"\n',
      }),
    )
    expect(result.dependencies.filter((dep) => dep.name === 'x').map((dep) => dep.version)).toEqual(
      ['1', '2'],
    )
    expect(result.dependencies.every((dep) => dep.licenseRaw === undefined)).toBe(true)
  })

  it('preserves npm nested versions and lock/installed license conflicts', () => {
    const result = readNpm(
      snapshotFrom({
        'package-lock.json': JSON.stringify({
          lockfileVersion: 3,
          packages: {
            'node_modules/x': { version: '1', license: 'MIT' },
            'node_modules/a/node_modules/x': { version: '2', license: 'GPL-3.0-only' },
          },
        }),
        'node_modules/x/package.json': JSON.stringify({
          name: 'x',
          version: '1',
          license: 'Apache-2.0',
        }),
      }),
    )
    expect(
      result.dependencies.filter((dep) => dep.name === 'x').map((dep) => dep.version),
    ).toContain('2')
    expect(
      result.dependencies.filter((dep) => dep.name === 'x').map((dep) => dep.licenseRaw),
    ).toContain('Apache-2.0')
    expect(result.incomplete.join(' ')).toContain('conflict')
  })

  it('reports unsupported npm lock versions explicitly', () => {
    expect(
      readNpm(
        snapshotFrom({ 'package-lock.json': '{"lockfileVersion":999,"packages":{}}' }),
      ).incomplete.join(' '),
    ).toContain('unsupported')
  })

  it('resolves Python loose declarations from locks without using another installed version', () => {
    const result = readPython(
      snapshotFrom({
        'requirements.txt': 'x>=1\n',
        'uv.lock': 'version = 1\n[[package]]\nname = "x"\nversion = "2.0"\n',
        'x-1.dist-info/METADATA': 'Name: x\nVersion: 1.0\nLicense-Expression: MIT\n',
      }),
    )
    expect(result.dependencies.find((dep) => dep.name === 'x')).toMatchObject({
      version: '2.0',
      licenseRaw: undefined,
    })
    expect(result.incomplete.join(' ')).toContain('version')
  })

  it('does not treat Cargo ranges as resolved versions or assume path crates first-party', () => {
    const result = readCargo(
      snapshotFrom({
        'Cargo.toml':
          '[package]\nname = "own"\n[dependencies]\nx = "^1.0"\nlocal = { path = "vendor/local" }\n',
      }),
    )
    expect(result.dependencies.find((dep) => dep.name === 'x')?.version).toBeUndefined()
    expect(result.incomplete.join(' ')).toContain('path')
  })

  it('reads vendored Go transitive modules without go.sum', () => {
    const result = readGo(
      snapshotFrom({
        'go.mod': 'module own\nrequire example/x v1\n',
        'vendor/modules.txt': '# example/x v1\n# example/transitive v2\n',
        'vendor/example/transitive/LICENSE': 'MIT License\n',
      }),
    )
    expect(result.dependencies.find((dep) => dep.name === 'example/transitive')).toMatchObject({
      version: 'v2',
      licenseRaw: 'MIT',
    })
  })

  it('keeps Gradle locked transitive packages and dynamic coverage visible', () => {
    const result = readJvm(
      snapshotFrom({
        'build.gradle': 'dependencies {\n implementation libs.x\n}\n',
        'gradle.lockfile': 'example:transitive:2.0=runtimeClasspath\n',
      }),
    )
    expect(result.dependencies.find((dep) => dep.name === 'example/transitive')?.version).toBe(
      '2.0',
    )
    expect(result.incomplete.join(' ')).toContain('static')
  })

  it('keeps NuGet transitive packages instead of mistaking installed nuspecs for the project', () => {
    const result = readNuGet(
      snapshotFrom({
        'packages.lock.json': JSON.stringify({
          version: 1,
          dependencies: { net8: { X: { type: 'Transitive', resolved: '2.0' } } },
        }),
        'packages/x/2.0/x.nuspec':
          '<package><metadata><id>X</id><version>2.0</version><license type="expression">MIT</license></metadata></package>',
      }),
    )
    expect(result.dependencies.find((dep) => dep.name === 'X')).toMatchObject({
      version: '2.0',
      licenseRaw: 'MIT',
    })
    expect(result.projectLicenses).toEqual([])
  })

  it('keeps Composer dev transitive scope and conflicting installed licenses', () => {
    const result = readComposer(
      snapshotFrom({
        'composer.lock': JSON.stringify({
          'packages-dev': [{ name: 'a/x', version: '1', license: 'MIT' }],
        }),
        'vendor/composer/installed.json': JSON.stringify({
          packages: [{ name: 'a/x', version: '1', license: 'GPL-3.0-only' }],
        }),
      }),
    )
    expect(
      result.dependencies
        .filter((dep) => dep.name === 'a/x')
        .every((dep) => dep.scope === 'development'),
    ).toBe(true)
    expect(result.dependencies.map((dep) => dep.licenseRaw)).toContain('GPL-3.0-only')
    expect(result.incomplete.join(' ')).toContain('conflict')
  })

  it('reads a standalone project gemspec and reports dynamic coverage', () => {
    const result = readGems(
      snapshotFrom({
        'own.gemspec':
          'Gem::Specification.new do |s|\ns.name = "own"\ns.license = "MIT"\ns.add_dependency "x"\ns.version = SOME_VERSION\nend\n',
      }),
    )
    expect(result.projectLicenses).toEqual([{ file: 'own.gemspec', raw: 'MIT' }])
    expect(result.dependencies.find((dep) => dep.name === 'x')).toBeDefined()
    expect(result.incomplete.join(' ')).toContain('static')
  })

  it('expands nested OR choices and keeps WITH exceptions in compatibility', () => {
    const expression = parseSpdxExpression('Apache-2.0 AND (GPL-3.0-only OR MIT)')
    expect(expression.ok).toBe(true)
    if (expression.ok)
      expect(orAlternatives(expression.root)).toEqual([
        ['Apache-2.0', 'GPL-3.0-only'],
        ['Apache-2.0', 'MIT'],
      ])
    const licensed = evaluateDependencyLicenses(
      [
        dependency('npm', 'package-lock.json', 'x', {
          licenseRaw: 'GPL-2.0-only WITH Classpath-exception-2.0',
        }),
      ],
      () => true,
    )
    const result = evaluateCompatibility(licensed.evaluated, ['MIT'])
    expect(result[0]?.severity).toBe('should-fix')
    expect(result[0]?.explanation).toContain('Classpath-exception-2.0')
  })

  it('does not let missing copyright suppress a conflicting SPDX header', () => {
    const result = scanHeaders(
      snapshotFrom({ 'x.ts': '// SPDX-License-Identifier: GPL-3.0-only\n' }),
      'required',
      ['MIT'],
    )
    expect(
      result.findings.some((finding) => finding.explanation.includes('outside the project')),
    ).toBe(true)
  })

  it('rejects excessive input path counts and overlong paths before reading', () => {
    expect(() =>
      scanLegal(snapshotFrom({}), {
        headerPolicy: 'off',
        paths: Array.from({ length: LEGAL_SCAN_PATHS_MAX + 1 }, () => 'x'),
      }),
    ).toThrow()
    expect(() =>
      scanLegal(snapshotFrom({ ['a'.repeat(LEGAL_PATH_MAX_CHARS + 1)]: 'x' }), {
        headerPolicy: 'off',
      }),
    ).toThrow()
  })
})

describe('legal scan uncertainty', () => {
  it('reports a dependency LICENSE conflict instead of trusting its metadata', () => {
    const report = scanLegal(
      snapshotFrom({
        'package.json': '{"license":"MIT"}',
        'package-lock.json': JSON.stringify({
          lockfileVersion: 3,
          packages: { 'node_modules/x': { version: '1', license: 'MIT' } },
        }),
        'node_modules/x/LICENSE': 'GNU GENERAL PUBLIC LICENSE\nVersion 3\n',
      }),
      { headerPolicy: 'off' },
    )
    expect(
      report.findings.some(
        (finding) => finding.packageName === 'x' && finding.explanation.includes('conflict'),
      ),
    ).toBe(true)
  })

  it('does not treat an upstream NOTICE as a packaged notice or a bare package name as preserved attribution', () => {
    const report = scanLegal(
      snapshotFrom({
        'package.json': '{"license":"MIT"}',
        'package-lock.json': JSON.stringify({
          lockfileVersion: 3,
          packages: { 'node_modules/x': { version: '1', license: 'Apache-2.0' } },
        }),
        'node_modules/x/index.js': 'x',
        'node_modules/x/NOTICE': 'Copyright 2026 Upstream Holder\n',
        'THIRD_PARTY_NOTICES.md': 'x (Apache-2.0)\n',
      }),
      { headerPolicy: 'off', distribution: { bundleInputs: ['node_modules/x/index.js'] } },
    )
    expect(
      report.findings.some(
        (finding) =>
          finding.file === 'node_modules/x/NOTICE' && finding.explanation.includes('NOTICE'),
      ),
    ).toBe(true)
  })

  it('keeps sidecar/REUSE evidence available for a selected source subset and rejects empty sidecars', () => {
    const valid = scanLegal(
      snapshotFrom({
        'x.ts': 'x',
        'x.ts.license': 'SPDX-FileCopyrightText: 2026 Holder\nSPDX-License-Identifier: MIT\n',
      }),
      { headerPolicy: 'required', paths: ['x.ts'] },
    )
    expect(valid.findings.some((finding) => finding.category === 'copyrightHeader')).toBe(false)
    const empty = scanLegal(snapshotFrom({ 'x.ts': 'x', 'x.ts.license': '' }), {
      headerPolicy: 'required',
    })
    expect(empty.findings.some((finding) => finding.category === 'copyrightHeader')).toBe(true)
  })

  it('scrubs secrets and email values and bounds malicious evidence fields without crashing', () => {
    const synthetic = 'ghp_' + 'test'.repeat(10)
    const report = scanLegal(
      snapshotFrom({
        LICENSE: 'custom terms for private@example.invalid\n' + synthetic,
        'package.json': JSON.stringify({ license: 'x'.repeat(3000) }),
      }),
      { headerPolicy: 'off' },
    )
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain(synthetic)
    expect(serialized).not.toContain('private@example.invalid')
    expect(report.incompleteChecks.join(' ')).toContain('bound')
  })
})

describe('legal static reader edge cases', () => {
  it('keeps npm v1 nested transitive entries', () => {
    const result = readNpm(
      snapshotFrom({
        'package-lock.json': JSON.stringify({
          lockfileVersion: 1,
          dependencies: {
            a: { version: '1', dependencies: { b: { version: '2', license: 'MIT' } } },
          },
        }),
      }),
    )
    expect(result.dependencies.find((dep) => dep.name === 'b')).toMatchObject({
      version: '2',
      licenseRaw: 'MIT',
    })
  })

  it('reports unsupported pnpm versions instead of asserting no dependency evidence', () => {
    const result = readNpm(
      snapshotFrom({ 'pnpm-lock.yaml': 'lockfileVersion: 999\npackages:\n  x@1:\n' }),
    )
    expect(result.incomplete.join(' ')).toContain('unsupported')
  })

  it('does not accept string literals as headers and checks vendor headers rather than declaring them generated', () => {
    const result = scanHeaders(
      snapshotFrom({
        'x.ts': 'const x = "Copyright 2026 Fake";\nconst y = "SPDX-License-Identifier: MIT";\n',
        'vendor/x.ts': '// Copyright 2026 Upstream\n// SPDX-License-Identifier: GPL-3.0-only\n',
      }),
      'required',
      ['MIT'],
    )
    expect(
      result.findings.some(
        (finding) => finding.file === 'x.ts' && finding.category === 'copyrightHeader',
      ),
    ).toBe(true)
    expect(
      result.findings.some(
        (finding) =>
          finding.file === 'vendor/x.ts' && finding.explanation.includes('outside the project'),
      ),
    ).toBe(true)
  })

  it('does not read Python description body as license metadata', () => {
    const result = readPython(
      snapshotFrom({
        'x.dist-info/METADATA':
          'Name: x\nVersion: 1\n\nDescription mentioning:\nLicense-Expression: MIT\n',
      }),
    )
    expect(result.dependencies.find((dep) => dep.name === 'x')?.licenseRaw).toBeUndefined()
  })
})
