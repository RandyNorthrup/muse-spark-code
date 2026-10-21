// M113 C-M113-3: planted canary secrets prove the security kind carries no
// value. Raw vault records and item metadata naming canaries go through the
// real reader, source, collector and all four renderers; none may appear in
// any output byte.
import { describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { securitySource } from '../../src/core/reporting/sources/security'
import { createSecurityReportReader } from '../../src/runtime/reporting/reportInputs'
import {
  buildSourceSnapshot,
  reportOptions,
  REPORT_FIXTURE_AS_OF,
} from './helpers/reporting/kindFixtures'
import { fixtureCollector } from './helpers/reporting/kindFixtures'
import { finalizeReport } from '../../src/core/reporting/render/canonical'
import { CANARIES, canaryVaultSnapshot } from './helpers/reporting/canaryVault'
import { RENDERERS, REPORT_THEME } from './reportKindRenderFixtures'

setUiText(EN, 'en')

describe('security report canary', () => {
  it.each(['md', 'html', 'text', 'json'] as const)(
    'keeps every planted canary out of the %s output',
    async (format) => {
      const reader = createSecurityReportReader({
        dataDir: '/nonexistent-m113-canary',
        readVault: () => Promise.resolve(canaryVaultSnapshot()),
      })
      const context = {
        reportText: EN,
        locale: 'en',
        asOf: REPORT_FIXTURE_AS_OF,
        workspaceKey: 'fixture',
        options: reportOptions('security'),
        signal: new AbortController().signal,
      }
      const read = await reader.read(context)
      expect(read).not.toBeNull()
      const source = securitySource({ read: () => Promise.resolve(read!) }, (text) => text)
      const result = await source.read(context)
      // The vault reports; the developer audit is honestly partial.
      expect(result.record).toMatchObject({
        status: 'partial',
        reason: 'The developer audit is unavailable.',
      })
      const snapshot = buildSourceSnapshot({ security: result })
      const document = finalizeReport(fixtureCollector(snapshot, reportOptions('security')))
      const output = RENDERERS[format](document, 'en', REPORT_THEME)
      for (const canary of CANARIES) expect(output).not.toContain(canary)
      // The aggregates still report: one item, one grant scope, one use
      // (plus each section's partial-source row).
      const dataRows = (id: string) =>
        document.sections
          .find((entry) => entry.id === id)!
          .rows.filter(
            (row) => row.cells['status']?.type === 'label' && row.cells['status'].value === 'ok',
          )
      expect(dataRows('security/breakdown')).toHaveLength(1)
      expect(dataRows('security/usage')).toHaveLength(1)
      expect(dataRows('security/grants')).toHaveLength(1)
    },
  )
})
