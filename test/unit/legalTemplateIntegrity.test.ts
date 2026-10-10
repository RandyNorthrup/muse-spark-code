// M97 CM971-R3: when pinned SPDX template data fails its SHA-256 check,
// the scan names the failure and keeps the human-review limitation
// instead of exiting clean (fail closed).

import { describe, expect, it, vi } from 'vitest'
import type * as Templates from '../../src/core/legal/licenseTemplates'
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

vi.mock('../../src/core/legal/licenseTemplates', async (importOriginal) => {
  const original = await importOriginal<typeof Templates>()
  const tampered = { ...original.licenseTemplateSet(), problems: ['templates/MIT.template.txt'] }
  return { ...original, licenseTemplateSet: () => tampered }
})

describe('pinned template integrity in the scan', () => {
  it('names a failed template check and keeps human review', () => {
    const files = {
      LICENSE: FULL_MIT_LICENSE,
      'src/ok.ts':
        '// Copyright (c) 2026 Example Corp\n// SPDX-License-Identifier: MIT\nexport const v = 1\n',
      [BUNDLE_OUTPUT]: BUNDLE_TEXT,
    }
    const result = scanLegal(snapshotFrom(files), {
      headerPolicy: 'optional',
      distribution: hashEvidence(files),
    })
    expect(result.incompleteChecks).toContain(
      fill(UI_TEXT.legalScanner.m205, { v0: 'templates/MIT.template.txt' }),
    )
    expect(result.incompleteChecks).toContain(UI_TEXT.legalScanner.m110)
  })
})
