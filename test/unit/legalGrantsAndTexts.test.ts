// M97 CM971-R3: the project's own grant decides a GPL-family variant
// (source headers, GNU notices, a trailing `+`), never the licence body;
// and every licence text a dependency names, or a vendored folder
// carries, keeps its human-review limitation when it is not an exact
// template match, whatever its file name.

import { describe, expect, it } from 'vitest'
import { projectHeaderGrants } from '../../src/core/legal/headers'
import { scanProjectLicense } from '../../src/core/legal/projectLicense'
import { scanLegal } from '../../src/core/legal/scan'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import {
  BUNDLE_OUTPUT,
  BUNDLE_TEXT,
  FULL_MIT_LICENSE,
  hashEvidence,
  snapshotFrom,
} from './legal/helpers'
import { canonicalText } from './legal/templates'

const GPL_BODY = canonicalText('GPL-3.0-only')
const MODIFIED_MIT = `${FULL_MIT_LICENSE}Each copy requires a payment of one dollar to the author.\n`

describe('GPL variant from the project grant (RVCM971B P2-6)', () => {
  it('reads or-later from the sole source header, without a manifest', async () => {
    const files = {
      COPYING: GPL_BODY,
      'src/main.c': '// SPDX-License-Identifier: GPL-3.0-or-later\nint main(void) { return 0; }\n',
    }
    const snapshot = snapshotFrom(files)
    expect(projectHeaderGrants(snapshot)).toEqual(['GPL-3.0-or-later'])
    const project = scanProjectLicense(snapshot, [], projectHeaderGrants(snapshot))
    expect(project.licenses).toEqual(['GPL-3.0-or-later'])
    // The header is the project's own grant, never "outside the project license".
    const result = await scanLegal(snapshot, { headerPolicy: 'optional' })
    expect(
      result.findings.filter(
        (finding) => finding.file === 'src/main.c' && finding.severity === 'should-fix',
      ),
    ).toEqual([])
  })

  it('reads or-later from a GNU "any later version" notice in a source header', () => {
    const notice =
      '/* This program is free software: you can redistribute it and/or modify\n * it under the terms of the GNU General Public License as published by\n * the Free Software Foundation, either version 3 of the License, or\n * (at your option) any later version. */\n'
    const snapshot = snapshotFrom({ COPYING: GPL_BODY, 'src/main.c': `${notice}int x;\n` })
    expect(projectHeaderGrants(snapshot)).toEqual(['GPL-3.0-or-later'])
    expect(scanProjectLicense(snapshot, [], projectHeaderGrants(snapshot)).licenses).toEqual([
      'GPL-3.0-or-later',
    ])
  })

  it('keeps a trailing-plus manifest grant as or-later, with no false conflict', () => {
    const snapshot = snapshotFrom({ COPYING: GPL_BODY })
    const project = scanProjectLicense(snapshot, [{ raw: 'GPL-3.0+', file: 'package.json' }])
    expect(project.licenses).toEqual(['GPL-3.0-or-later'])
    expect(project.findings.filter((finding) => finding.severity !== 'advice')).toEqual([])
  })

  it('stays -only without any grant, never or-later from the body', () => {
    expect(scanProjectLicense(snapshotFrom({ COPYING: GPL_BODY })).licenses).toEqual([
      'GPL-3.0-only',
    ])
  })
})

describe('inexact texts named by dependencies keep human review (RVCM971B P2-8)', () => {
  const base = {
    LICENSE: FULL_MIT_LICENSE,
    'src/ok.ts':
      '// Copyright (c) 2026 Example Corp\n// SPDX-License-Identifier: MIT\nexport const v = 1\n',
    [BUNDLE_OUTPUT]: BUNDLE_TEXT,
  }

  it('checks a Cargo license-file with a non-standard name', async () => {
    const files = {
      ...base,
      'Cargo.toml':
        '[package]\nname = "app"\nversion = "1.0.0"\nlicense = "MIT"\n\n[dependencies]\nterms = "1.0.0"\n',
      'Cargo.lock':
        'version = 3\n\n[[package]]\nname = "app"\nversion = "1.0.0"\n\n[[package]]\nname = "terms"\nversion = "1.0.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n',
      'vendor/terms/Cargo.toml':
        '[package]\nname = "terms"\nversion = "1.0.0"\nlicense-file = "terms.txt"\n',
      'vendor/terms/terms.txt': MODIFIED_MIT,
      'vendor/terms/src/lib.rs': 'pub fn f() {}\n',
    }
    const result = await scanLegal(snapshotFrom(files), {
      headerPolicy: 'optional',
      distribution: hashEvidence(files),
    })
    expect(result.incompleteChecks).toContain(
      fill(UI_TEXT.legalScanner.m199, { v0: 'terms', v1: 'vendor/terms/terms.txt' }),
    )
    expect(result.incompleteChecks).toContain(UI_TEXT.legalScanner.m110)
  })

  it('checks a Python distribution License-File entry', async () => {
    const files = {
      ...base,
      'requirements.txt': 'termslib==1.0.0\n',
      'site-packages/termslib-1.0.0.dist-info/METADATA':
        'Metadata-Version: 2.4\nName: termslib\nVersion: 1.0.0\nLicense-Expression: MIT\nLicense-File: TERMS.rst\n',
      'site-packages/termslib-1.0.0.dist-info/licenses/TERMS.rst': MODIFIED_MIT,
    }
    const result = await scanLegal(snapshotFrom(files), {
      headerPolicy: 'optional',
      distribution: hashEvidence(files),
    })
    expect(result.incompleteChecks).toContain(
      fill(UI_TEXT.legalScanner.m199, {
        v0: 'termslib',
        v1: 'site-packages/termslib-1.0.0.dist-info/licenses/TERMS.rst',
      }),
    )
  })

  it('keeps a modified nested vendored licence under review', async () => {
    const files = { ...base, 'vendor/custom/LICENSE': MODIFIED_MIT, 'vendor/custom/a.js': 'x\n' }
    const project = scanProjectLicense(snapshotFrom(files))
    expect(project.requiresReview).toBe(true)
    expect(project.incomplete).toContain(
      fill(UI_TEXT.legalScanner.m199, { v0: 'vendor/custom', v1: 'vendor/custom/LICENSE' }),
    )
    const result = await scanLegal(snapshotFrom(files), {
      headerPolicy: 'optional',
      distribution: hashEvidence(files),
    })
    expect(result.incompleteChecks).toContain(UI_TEXT.legalScanner.m110)
    expect(
      result.findings.some((finding) => finding.explanation.includes('SPDX MIT template')),
    ).toBe(true)
  })

  it('keeps an exact nested vendored licence complete', () => {
    const files = { ...base, 'vendor/custom/LICENSE': FULL_MIT_LICENSE }
    expect(scanProjectLicense(snapshotFrom(files)).requiresReview).toBe(false)
  })
})
