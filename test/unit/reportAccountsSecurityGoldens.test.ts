// M113 C-M113-3: committed goldens for the accounts and security kinds.
// Run with WRITE_GOLDENS=1 to regenerate after an intended change; the
// committed run compares byte for byte.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { finalizeReport } from '../../src/core/reporting/render/canonical'
import type { ReportKind } from '../../src/shared/reportSchema'
import { collectFixture } from './helpers/reporting/kindFixtures'
import { RENDERERS, REPORT_THEME } from './reportKindRenderFixtures'

setUiText(EN, 'en')

const GOLDENS = path.resolve(import.meta.dirname, '../fixtures/reports/collect')
const FORMATS = ['md', 'html', 'text', 'json'] as const

function outputFor(kind: ReportKind, format: (typeof FORMATS)[number]) {
  const document = finalizeReport(collectFixture(kind))
  return RENDERERS[format](document, 'en', REPORT_THEME)
}

describe('accounts and security goldens', () => {
  it.each(['accounts', 'security'] as const)('matches every committed %s golden', async (kind) => {
    for (const format of FORMATS) {
      const golden = path.join(GOLDENS, `${kind}.${format}.golden`)
      const output = outputFor(kind, format)
      if (process.env['WRITE_GOLDENS'] === '1') {
        await mkdir(GOLDENS, { recursive: true })
        await writeFile(golden, output)
      }
      await expect(readFile(golden, 'utf8')).resolves.toBe(output)
    }
  })
})
