import { describe, expect, it } from 'vitest'
import { scanLegal } from '../../src/core/legal/scan'
import { evaluateCompatibility } from '../../src/core/legal/compat'
import { evaluateDependencyLicenses } from '../../src/core/legal/depLicenses'
import { dependency } from '../../src/core/legal/dependencies'
import { readNpm } from '../../src/core/legal/ecosystems/npm'
import { readComposer } from '../../src/core/legal/ecosystems/composer'
import { readGems } from '../../src/core/legal/ecosystems/gems'
import { readPython } from '../../src/core/legal/ecosystems/python'
import { parseTomlSection } from '../../src/core/legal/ecosystems/toml'
import { identifyLicenseText } from '../../src/core/legal/projectLicense'
import { scanHeaders, scanAttributionRisks } from '../../src/core/legal/headers'
import { snapshotFrom } from './legal/helpers'

describe('RVM97SW scanner regressions', () => {
  it('F1 scrubs every string in the complete result, including scope', () => {
    const credential = `LLM_${'synthetic'.repeat(4)}`
    const privatePath = `src/person@example.com/${credential}.ts`
    const result = scanLegal(snapshotFrom({ [privatePath]: 'const x = 1' }), {
      paths: [privatePath],
      headerPolicy: 'required',
    })
    const visit = (value: unknown): void => {
      if (typeof value === 'string') {
        expect(value).not.toContain('person@example.com')
        expect(value).not.toContain(credential)
      } else if (Array.isArray(value)) {
        for (const entry of value) visit(entry)
      } else if (typeof value === 'object' && value !== null) {
        for (const entry of Object.values(value)) visit(entry)
      }
    }
    visit(result)
  })

  it('F10 excluded root notices cannot satisfy packaged Apache attribution', () => {
    const result = scanLegal(
      snapshotFrom({
        'package.json': JSON.stringify({ name: 'demo', license: 'MIT', files: ['node_modules/a'] }),
        'node_modules/a/package.json': JSON.stringify({
          name: 'a',
          version: '1',
          license: 'Apache-2.0',
        }),
        'node_modules/a/NOTICE': 'Copyright Upstream',
        THIRD_PARTY_NOTICES: 'a\nCopyright Upstream',
      }),
      { headerPolicy: 'off' },
    )
    expect(result.findings.some((finding) => finding.category === 'noticeFile')).toBe(true)
  })

  it('F11 only the exact bundled package version is shipped', () => {
    const result = scanLegal(
      snapshotFrom({
        'package.json': JSON.stringify({ name: 'demo', license: 'MIT' }),
        'node_modules/a/package.json': JSON.stringify({ version: '1', license: 'MIT' }),
        'package-lock.json': JSON.stringify({
          lockfileVersion: 3,
          packages: {
            'node_modules/a': { version: '1', license: 'MIT' },
            'node_modules/b/node_modules/a': { version: '2', license: 'GPL-3.0-only', dev: true },
          },
        }),
        'node_modules/a/index.js': 'x',
        'node_modules/b/node_modules/a/package.json': JSON.stringify({
          version: '2',
          license: 'GPL-3.0-only',
        }),
        'node_modules/b/node_modules/a/index.js': 'x',
      }),
      { headerPolicy: 'off', distribution: { bundleInputs: ['node_modules/a/index.js'] } },
    )
    expect(result.findings.filter((finding) => finding.severity === 'blocker')).toEqual([])
  })

  it.each([
    ['GPL-3.0-only AND (MIT WITH LLVM-exception)', 'blocker'],
    ['MIT OR (GPL-2.0-only WITH Classpath-exception-2.0)', 'advice'],
    ['GPL-3.0-only OR LGPL-2.1-only', 'should-fix'],
    ['GPL-3.0', 'blocker'],
  ])('F12 preserves branch semantics for %s', (licenseRaw, severity) => {
    const evaluated = evaluateDependencyLicenses(
      [dependency('npm', 'package-lock.json', 'a', { version: '1', licenseRaw })],
      () => true,
    ).evaluated
    expect(
      evaluateCompatibility(evaluated, ['MIT']).some((finding) => finding.severity === severity),
    ).toBe(true)
  })

  it('F13 npm keeps installed evidence for each exact version', () => {
    const result = readNpm(
      snapshotFrom({
        'package-lock.json': JSON.stringify({
          lockfileVersion: 3,
          packages: {
            'node_modules/a': { version: '1', license: 'MIT' },
            'node_modules/b/node_modules/a': { version: '2', license: 'MIT' },
          },
        }),
        'node_modules/a/package.json': JSON.stringify({ version: '1', license: 'GPL-3.0-only' }),
        'node_modules/b/node_modules/a/package.json': JSON.stringify({
          version: '2',
          license: 'MIT',
        }),
      }),
    )
    expect(
      result.dependencies.some((dep) => dep.version === '1' && dep.licenseRaw === 'GPL-3.0-only'),
    ).toBe(true)
  })

  it('F11 nested installed material cannot mark its parent package shipped', () => {
    const result = scanLegal(
      snapshotFrom({
        'package.json': '{"name":"demo","license":"MIT"}',
        'node_modules/a/package.json': '{"version":"1","license":"GPL-3.0-only"}',
        'node_modules/a/index.js': 'parent',
        'node_modules/a/node_modules/a/package.json': '{"version":"2","license":"MIT"}',
        'node_modules/a/node_modules/a/index.js': 'nested',
      }),
      {
        headerPolicy: 'off',
        distribution: { bundleInputs: ['node_modules/a/node_modules/a/index.js'] },
      },
    )
    expect(result.findings.filter((finding) => finding.severity === 'blocker')).toEqual([])
  })

  it('F13 Composer never borrows license evidence from another installed version', () => {
    const result = readComposer(
      snapshotFrom({
        'composer.lock': JSON.stringify({ packages: [{ name: 'acme/pkg', version: '1.0' }] }),
        'vendor/composer/installed.json': JSON.stringify([
          { name: 'acme/pkg', version: '2.0', license: ['MIT'] },
        ]),
      }),
    )
    expect(result.dependencies[0]?.licenseRaw).toBeUndefined()
  })

  it('F13 gems never borrow license evidence from another installed version', () => {
    const result = readGems(
      snapshotFrom({
        'Gemfile.lock': 'GEM\n  specs:\n    a (1.0)\n',
        'vendor/specifications/a-2.0.gemspec': 's.name = "a"\ns.license = "MIT"',
      }),
    )
    expect(result.dependencies[0]?.licenseRaw).toBeUndefined()
  })

  it('F14 reads Poetry direct dependencies without a lock', () => {
    const result = readPython(
      snapshotFrom({
        'pyproject.toml':
          '[tool.poetry]\nname = "demo"\n[tool.poetry.dependencies]\npython = "^3.12"\nrestricted-lib = "1.0"\n',
      }),
    )
    expect(result.dependencies).toContainEqual(
      expect.objectContaining({ name: 'restricted-lib', version: '1.0' }),
    )
    expect(result.dependencies.some((dep) => dep.name === 'python')).toBe(false)
  })

  it('F15 reads inline TOML comments while preserving quoted hash characters', () => {
    const fields = parseTomlSection(
      '[project] # section\nname = "demo😀#name" # note\nlicense = "GPL-3.0-only" # terms',
      'project',
    )
    expect(fields.get('name')).toBe('demo😀#name')
    expect(fields.get('license')).toBe('GPL-3.0-only')
  })

  it('F16 license title outranks incidental license mentions', () => {
    expect(
      identifyLicenseText(
        'GNU GENERAL PUBLIC LICENSE\nVersion 3\n\nCompatibility note mentions MIT License.',
      ),
    ).toMatchObject({ id: 'GPL-3.0-only' })
  })

  it('F17 checks every holder and conflicting SPDX declaration', () => {
    const result = scanHeaders(
      snapshotFrom({
        'src/a.ts':
          '// Copyright 2020 First\n// Copyright 2026-2020 Second\n// SPDX-License-Identifier: MIT\n// SPDX-License-Identifier: GPL-3.0-only\n',
      }),
      'required',
      ['MIT'],
    )
    expect(result.findings.some((finding) => finding.line === 2)).toBe(true)
    expect(result.findings.some((finding) => finding.line === 4)).toBe(true)
  })

  it.each([
    'SPDX-FileCopyrightText: Owner\nSPDX-License-Identifier: ??? totally malformed',
    'SPDX-FileCopyrightText: Owner\nSPDX-License-Identifier: MIT\nSPDX-License-Identifier: ??? malformed',
  ])('F18 malformed asset sidecars do not establish provenance: %s', (sidecar) => {
    const result = scanAttributionRisks(
      snapshotFrom({
        'icon.svg': '<svg/>',
        'icon.svg.license': sidecar,
      }),
    )
    expect(result.findings.some((finding) => finding.file === 'icon.svg')).toBe(true)
  })

  it('F17 preserves copyright symbols and en-dash year ranges', () => {
    const result = scanHeaders(
      snapshotFrom({
        'src/a.ts': '// Copyright © 2026–2020 Owner\n// SPDX-License-Identifier: MIT\n',
      }),
      'required',
      ['MIT'],
    )
    expect(result.findings).toContainEqual(
      expect.objectContaining({ line: 1, category: 'copyrightHeader' }),
    )
  })

  it('F19 ordinary bin sources and code strings are not generated exclusions', () => {
    const result = scanHeaders(
      snapshotFrom({
        'src/a.ts': 'const note = "do not edit user settings"',
        'bin/cli.js': 'const x = 1',
      }),
      'required',
      [],
    )
    expect(result.excluded).toEqual([])
    expect(new Set(result.findings.map((finding) => finding.file))).toEqual(
      new Set(['src/a.ts', 'bin/cli.js']),
    )
  })
  it('F17 conflicting SPDX declarations stay visible without a project license', () => {
    const result = scanHeaders(
      snapshotFrom({
        'a.ts':
          '// Copyright 2020 Owner\n// SPDX-License-Identifier: MIT\n// SPDX-License-Identifier: GPL-3.0-only',
      }),
      'required',
      [],
    )
    expect(result.findings.some((finding) => finding.line === 3)).toBe(true)
  })
})
