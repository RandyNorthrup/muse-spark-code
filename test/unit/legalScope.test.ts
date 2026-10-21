// M97 CM971-R3 scan scope (lead ruling 2026-10-10): a workspace scan
// judges what the workspace distributes. Distribution comes from the
// build records first; dependencies and files that do not ship are
// informational; `.git` and `node_modules` are expected and skipped; the
// SPDX matching guidelines' equivalences apply.

import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { identifyLicenseText } from '../../src/core/legal/projectLicense'
import { scanLegal } from '../../src/core/legal/scan'
import { createLegalSnapshot } from '../../src/core/legal/workspace'
import { LEGAL_FINDINGS_PER_RULE_MAX, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { fingerprint } from '../../src/core/verify/fingerprint'
import {
  BUNDLE_OUTPUT,
  BUNDLE_TEXT,
  FULL_MIT_LICENSE,
  hashEvidence,
  snapshotFrom,
} from './legal/helpers'
import { canonicalText } from './legal/templates'

const HEADED =
  '// Copyright (c) 2026 Example Corp\n// SPDX-License-Identifier: MIT\nexport const v = 1\n'
const MODIFIED_MIT = `${FULL_MIT_LICENSE}Each copy requires a payment of one dollar to the author.\n`

function writeTree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'legal-scope-'))
  for (const [file, text] of Object.entries(files)) {
    const absolute = path.join(root, file)
    mkdirSync(path.dirname(absolute), { recursive: true })
    writeFileSync(absolute, text)
  }
  return root
}

describe('order: what ships is admitted first, the rest is walked', () => {
  it('admits build records, their inputs and shipped package metadata; skips .git and node_modules', async () => {
    const metafile = JSON.stringify({
      inputs: { 'src/a.ts': { bytes: 1 }, 'node_modules/shipped/index.js': { bytes: 1 } },
      outputs: {
        'dist/bundle.js': {
          bytes: 1,
          inputs: {
            'src/a.ts': { bytesInOutput: 1 },
            'node_modules/shipped/index.js': { bytesInOutput: 1 },
          },
        },
      },
    })
    const root = writeTree({
      'src/a.ts': HEADED,
      'dist/bundle.js': BUNDLE_TEXT,
      'dist/meta/bundle.json': metafile,
      'dist/meta-hashes/bundle.json': '{}',
      'node_modules/shipped/index.js': 'module.exports = 1\n',
      'node_modules/shipped/package.json': '{"name":"shipped","version":"1.0.0","license":"MIT"}',
      'node_modules/shipped/LICENSE': FULL_MIT_LICENSE,
      'node_modules/dev-only/package.json': '{"name":"dev-only","version":"1.0.0"}',
      '.git/HEAD': 'ref: refs/heads/main\n',
    })
    try {
      symlinkSync(
        path.join(root, 'node_modules/shipped/index.js'),
        path.join(root, 'node_modules/.bin-link'),
      )
    } catch {
      // Links need a privilege on some Windows hosts; the walk skips node_modules either way.
    }
    const snapshot = await createLegalSnapshot(root)
    expect(snapshot.files).toEqual(
      expect.arrayContaining([
        'dist/meta/bundle.json',
        'dist/meta-hashes/bundle.json',
        'src/a.ts',
        'node_modules/shipped/index.js',
        'node_modules/shipped/package.json',
        'node_modules/shipped/LICENSE',
      ]),
    )
    expect(snapshot.files).not.toContain('node_modules/dev-only/package.json')
    expect(snapshot.files.some((file) => file.startsWith('.git/'))).toBe(false)
    expect(snapshot.incompleteChecks).toEqual([])
  })
})

describe('shipped vs not', () => {
  const lock = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      'node_modules/shipped': { version: '1.0.0', license: 'MIT' },
      'node_modules/dev-only': { version: '1.0.0', license: 'MIT', dev: true },
      'node_modules/dev-malformed': { version: '1.0.0', license: 'MIT AND', dev: true },
    },
  })
  const files = {
    LICENSE: FULL_MIT_LICENSE,
    THIRD_PARTY_NOTICES: 'shipped (MIT)\n',
    'package.json': JSON.stringify({ name: 'example', version: '1.0.0', license: 'MIT' }),
    'package-lock.json': lock,
    'src/a.ts': HEADED,
    'node_modules/shipped/package.json': '{"name":"shipped","version":"1.0.0","license":"MIT"}',
    'node_modules/shipped/index.js': 'module.exports = 1\n',
    'node_modules/shipped/LICENSE': FULL_MIT_LICENSE,
    'node_modules/dev-only/package.json': '{"name":"dev-only","version":"1.0.0","license":"MIT"}',
    'node_modules/dev-only/LICENSE': MODIFIED_MIT,
    'test/fixtures/other/package.json': JSON.stringify({
      name: 'fixture',
      license: 'GPL-3.0-only',
    }),
    [BUNDLE_OUTPUT]: BUNDLE_TEXT,
  }
  const evidence = {
    ...hashEvidence({
      'src/a.ts': HEADED,
      'node_modules/shipped/index.js': files['node_modules/shipped/index.js'],
      [BUNDLE_OUTPUT]: BUNDLE_TEXT,
    }),
  }

  it('lists a non-shipping dependency with a modified text as information, never incomplete', async () => {
    const result = await scanLegal(snapshotFrom(files), {
      headerPolicy: 'optional',
      distribution: evidence,
    })
    expect(result.incompleteChecks).toEqual([])
    expect(
      result.findings.some(
        (finding) =>
          finding.explanation.includes('do not ship') ||
          finding.explanation.includes('does not ship'),
      ),
    ).toBe(true)
    expect(result.findings.filter((finding) => finding.severity !== 'advice')).toEqual([])
  })

  it('still keeps human review for a shipping dependency with a modified text', async () => {
    const shippedModified = { ...files, 'node_modules/shipped/LICENSE': MODIFIED_MIT }
    const result = await scanLegal(snapshotFrom(shippedModified), {
      headerPolicy: 'optional',
      distribution: evidence,
    })
    expect(result.incompleteChecks).toContain(
      fill(UI_TEXT.legalScanner.m199, { v0: 'shipped', v1: 'node_modules/shipped/LICENSE' }),
    )
  })

  it('does not ship a bundle input the bundler shook out entirely', async () => {
    const metafile = JSON.stringify({
      inputs: { 'src/a.ts': { bytes: 1 }, 'node_modules/shipped/index.js': { bytes: 1 } },
      outputs: {
        [BUNDLE_OUTPUT]: {
          bytes: 1,
          inputs: {
            'src/a.ts': { bytesInOutput: 10 },
            'node_modules/shipped/index.js': { bytesInOutput: 0 },
          },
        },
      },
    })
    const record = JSON.stringify({
      version: 2,
      inputs: {
        'src/a.ts': fingerprint(HEADED),
        'node_modules/shipped/index.js': fingerprint(files['node_modules/shipped/index.js']),
      },
      outputs: { [BUNDLE_OUTPUT]: fingerprint(BUNDLE_TEXT) },
    })
    const shippedModified = {
      ...files,
      'node_modules/shipped/LICENSE': MODIFIED_MIT,
      'dist/meta/bundle.json': metafile,
      'dist/meta-hashes/bundle.json': record,
    }
    const result = await scanLegal(snapshotFrom(shippedModified), { headerPolicy: 'optional' })
    expect(result.incompleteChecks).toEqual([])
  })
})

describe('RVCM971C reader coverage follows distribution', () => {
  const cases: readonly [string, Record<string, string>][] = [
    ['Yarn', { 'yarn.lock': 'leftpad@^1.3.0:\n  version "1.3.0"\n' }],
    ['pnpm', { 'pnpm-lock.yaml': "lockfileVersion: '9.0'\npackages:\n  leftpad@1.3.0: {}\n" }],
    [
      'unresolved npm',
      { 'package.json': '{"name":"own","license":"MIT","dependencies":{"not-in-lock":"*"}}' },
    ],
    ['Python', { 'requirements.txt': 'requests==2.0.0\n' }],
    [
      'Cargo',
      {
        'Cargo.lock':
          '[[package]]\nname = "leftpad"\nversion = "1.3.0"\nsource = "registry+local"\n',
      },
    ],
    ['Go', { 'go.mod': 'module own\nrequire example/leftpad v1.3.0\n' }],
    [
      'JVM',
      {
        'pom.xml':
          '<project><dependencies><dependency><groupId>example</groupId><artifactId>leftpad</artifactId><version>1.3.0</version></dependency></dependencies></project>',
      },
    ],
    [
      'NuGet',
      { 'own.csproj': '<Project><PackageReference Include="leftpad" Version="1.3.0" /></Project>' },
    ],
    ['Composer', { 'composer.json': '{"name":"own","require":{"example/leftpad":"*"}}' }],
    ['Ruby', { Gemfile: 'gem "leftpad", "1.3.0"\n' }],
  ]
  it.each(cases)(
    'keeps non-shipping %s reader gaps out of completeness',
    async (_name, metadata) => {
      const files = {
        LICENSE: FULL_MIT_LICENSE,
        'src/a.ts': HEADED,
        [BUNDLE_OUTPUT]: BUNDLE_TEXT,
        ...metadata,
      }
      const result = await scanLegal(snapshotFrom(files), {
        headerPolicy: 'optional',
        distribution: hashEvidence({ 'src/a.ts': HEADED, [BUNDLE_OUTPUT]: BUNDLE_TEXT }),
      })
      expect(result.incompleteChecks).toEqual([])
      const unknown = await scanLegal(snapshotFrom(files), { headerPolicy: 'optional' })
      expect(unknown.incompleteChecks.length).toBeGreaterThan(0)
    },
  )

  it('keeps malformed manifest coverage even when no dependency ships', async () => {
    const files = {
      LICENSE: FULL_MIT_LICENSE,
      'package.json': '{broken',
      'src/a.ts': HEADED,
      [BUNDLE_OUTPUT]: BUNDLE_TEXT,
    }
    const result = await scanLegal(snapshotFrom(files), {
      headerPolicy: 'optional',
      distribution: hashEvidence({ 'src/a.ts': HEADED, [BUNDLE_OUTPUT]: BUNDLE_TEXT }),
    })
    expect(result.incompleteChecks).toContain(
      fill(UI_TEXT.legalScanner.m150, { v0: 'package.json' }),
    )
  })

  it('ignores unresolved non-shipping rows alongside a licensed shipped npm package', async () => {
    const files = {
      LICENSE: FULL_MIT_LICENSE,
      'yarn.lock': 'shipped@^1.0.0:\n  version "1.0.0"\n\ndevonly@^2.0.0:\n  version "2.0.0"\n',
      'package.json': '{"name":"own","license":"MIT","dependencies":{"missing":"*"}}',
      'node_modules/shipped/package.json': '{"name":"shipped","version":"1.0.0","license":"MIT"}',
      'node_modules/shipped/index.js': 'module.exports = 1',
      THIRD_PARTY_NOTICES: 'shipped',
      [BUNDLE_OUTPUT]: BUNDLE_TEXT,
    }
    const result = await scanLegal(snapshotFrom(files), {
      headerPolicy: 'optional',
      distribution: hashEvidence({
        'node_modules/shipped/index.js': files['node_modules/shipped/index.js'],
        [BUNDLE_OUTPUT]: BUNDLE_TEXT,
      }),
    })
    expect(result.incompleteChecks).toEqual([])
  })

  it.each(['BSD-2-Clause', 'Apache-2.0', 'GPL-2.0-only'])(
    'preserves a shipped exact %s text disagreeing with MIT metadata',
    async (id) => {
      const files = {
        LICENSE: FULL_MIT_LICENSE,
        THIRD_PARTY_NOTICES: 'leftpad',
        'package-lock.json':
          '{"lockfileVersion":3,"packages":{"node_modules/leftpad":{"version":"1.3.0","license":"MIT"}}}',
        'node_modules/leftpad/package.json': '{"name":"leftpad","version":"1.3.0","license":"MIT"}',
        'node_modules/leftpad/index.js': 'module.exports = 1',
        'node_modules/leftpad/LICENSE': canonicalText(id),
        [BUNDLE_OUTPUT]: BUNDLE_TEXT,
      }
      const result = await scanLegal(snapshotFrom(files), {
        headerPolicy: 'optional',
        distribution: hashEvidence({
          'node_modules/leftpad/index.js': files['node_modules/leftpad/index.js'],
          [BUNDLE_OUTPUT]: BUNDLE_TEXT,
        }),
      })
      expect(result.incompleteChecks).toContain(fill(UI_TEXT.legalScanner.m033, { v0: 'leftpad' }))
      expect(
        result.findings.find((finding) => finding.explanation.includes('License evidence conflict'))
          ?.explanation,
      ).toContain('node_modules/leftpad/LICENSE')
      if (id === 'GPL-2.0-only') {
        expect(
          result.findings.find((finding) => finding.severity === 'blocker')?.explanation,
        ).toContain('leftpad@1.3.0')
      }
    },
  )
})

describe('report bounds', () => {
  it('summarizes omitted advice instead of making the scan incomplete', async () => {
    const sources = Object.fromEntries(
      Array.from({ length: LEGAL_FINDINGS_PER_RULE_MAX + 5 }, (_, index) => [
        `src/f${String(index)}.ts`,
        'export const v = 1\n',
      ]),
    )
    const files = {
      LICENSE: FULL_MIT_LICENSE,
      'package.json': JSON.stringify({ name: 'example', version: '1.0.0', license: 'MIT' }),
      ...sources,
      [BUNDLE_OUTPUT]: BUNDLE_TEXT,
    }
    const result = await scanLegal(snapshotFrom(files), {
      headerPolicy: 'optional',
      distribution: hashEvidence(files),
    })
    expect(result.incompleteChecks).toEqual([])
    expect(
      result.findings.some((finding) => finding.explanation.includes('more advice finding')),
    ).toBe(true)
  })
})

describe('SPDX matching guideline equivalences', () => {
  it.each([
    ['Markdown emphasis', FULL_MIT_LICENSE.replace('"AS IS"', '*AS IS*')],
    ['doubled single quotes', FULL_MIT_LICENSE.replace('"AS IS"', "''AS IS''")],
    [
      'list markers',
      FULL_MIT_LICENSE.replace('The above copyright notice', '- The above copyright notice'),
    ],
    [
      'a nickname in quotes and a handle',
      FULL_MIT_LICENSE.replace(
        'Copyright (c) 2026 Example Corp',
        'Copyright (c) 2026 Menglin "Mark" Xu, @remarkablemark',
      ),
    ],
    [
      'a work lead-in',
      FULL_MIT_LICENSE.replace(
        'Copyright (c) 2026 Example Corp',
        'pngjs original work Copyright (c) 2015 Luke Page & Original Contributors',
      ),
    ],
  ])('reads %s as exact MIT', (_name, text) => {
    expect(identifyLicenseText(text)).toMatchObject({ id: 'MIT', exact: true })
  })

  it('reads a copyright line after the end of Apache-2.0 with its applied notice as exact', () => {
    const apache = canonicalText('Apache-2.0', false)
    const applied = `${apache}\nCopyright 2025 Zed Industries, Inc. and contributors\n\nLicensed under the Apache License, Version 2.0 (the "License");\nyou may not use this file except in compliance with the License.\nYou may obtain a copy of the License at\n\n    https://www.apache.org/licenses/LICENSE-2.0\n\nUnless required by applicable law or agreed to in writing, software\ndistributed under the License is distributed on an "AS IS" BASIS,\nWITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.\nSee the License for the specific language governing permissions and\nlimitations under the License.\n`
    expect(identifyLicenseText(applied)).toMatchObject({ id: 'Apache-2.0', exact: true })
  })

  it('reads MIT-0 as MIT-0, never as MIT, and a missing sentence still differs', () => {
    expect(identifyLicenseText(canonicalText('MIT-0'))).toMatchObject({ id: 'MIT-0', exact: true })
    const missing = FULL_MIT_LICENSE.replace(
      'The above copyright notice and this permission notice shall be included in all copies or substantial\nportions of the Software.\n',
      '',
    )
    expect(identifyLicenseText(missing)?.exact).toBe(false)
  })

  it('never lets a lead-in carry a restriction', () => {
    const text = FULL_MIT_LICENSE.replace(
      'Copyright (c) 2026 Example Corp',
      'Noncommercial work Copyright (c) 2026 Example Corp',
    )
    expect(identifyLicenseText(text)?.exact).toBe(false)
  })
})
