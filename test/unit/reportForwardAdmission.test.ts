// RVREPORTJOIN P2-4: a forwarded section meets the shared row admission
// (keep the first rows, count the omitted) BEFORE the complete section is
// parsed against the row limit, for every forwarder. The 6,667-binding case
// below drives the real keybindings source into the real collector; the
// playbook case proves the shared path with a synthetic oversized section.
import { describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { REPORT_MAX_ROWS, REPORT_SECTION_ROWS } from '../../src/shared/constants'
import { ACP_COMMAND_FACTS } from '../../src/core/reporting/sources/keybindings'
import { keybindingsSource } from '../../src/core/reporting/sources/keybindings'
import { referenceKeyboardActions } from '../../src/shared/keybindings'
import { admitForwardedSection } from '../../src/core/reporting/collect/common'
import type { SourceReadContext } from '../../src/core/reporting/sources/types'
import type { ReportRow } from '../../src/shared/reportSchema'
import {
  availableSource,
  buildSourceSnapshot,
  REPORT_FIXTURE_AS_OF,
  reportOptions,
} from './helpers/reporting/kindFixtures'
import { facet, fixtureCollector, getSection } from './helpers/reporting/kindFixtures'

function contextFor(kind: Parameters<typeof reportOptions>[0]): SourceReadContext {
  return {
    reportText: EN,
    locale: 'en',
    asOf: REPORT_FIXTURE_AS_OF,
    workspaceKey: 'workspace',
    options: reportOptions(kind),
    signal: new AbortController().signal,
  }
}

describe('forwarded sections admit before parsing', () => {
  it('admits unknown sections to the row limit with the omitted counted', () => {
    expect(admitForwardedSection({ rows: [1, 2] })).toEqual({
      section: { rows: [1, 2] },
      omittedRows: 0,
    })
    expect(admitForwardedSection('bogus')).toEqual({ section: 'bogus', omittedRows: 0 })
    const rows = Array.from({ length: REPORT_MAX_ROWS + 5 }, (_, index) => index)
    const admitted = admitForwardedSection({ id: 's', rows })
    expect(admitted.omittedRows).toBe(5)
    expect((admitted.section as { rows: unknown[] }).rows).toHaveLength(REPORT_MAX_ROWS)
  })

  it('collects 6,667 editor bindings without throwing, disclosing the omitted rows', async () => {
    const bindings = Array.from({ length: 6667 }, (_, index) => ({
      command: `cmd.${String(index)}`,
      key: `ctrl+k ${String(index)}`,
    }))
    const read = await keybindingsSource(() => ({
      contributes: { commands: [], keybindings: bindings },
    })).read(contextFor('keybindings'))
    expect(read.record.status).toBe('ok')
    const editorRows = 6667 * 3
    const staticRows = referenceKeyboardActions().length + ACP_COMMAND_FACTS.length
    const document = fixtureCollector(
      buildSourceSnapshot({ keybindings: read }),
      reportOptions('keybindings'),
    )
    const section = getSection(document, 'keybindings/keybindings')
    expect(section.rows).toHaveLength(REPORT_SECTION_ROWS)
    expect(section.omittedRows).toBe(editorRows + staticRows - REPORT_SECTION_ROWS)
    expect(
      document.sources.some((source) => source.id === 'keybindings' && source.status === 'ok'),
    ).toBe(true)
  })

  it('admits an oversized playbook section on the shared forward path', () => {
    const rows: ReportRow[] = Array.from({ length: REPORT_MAX_ROWS + 5 }, (_, index) => ({
      key: `k/${String(index)}`,
      cells: { detail: { type: 'text', value: 'v' } },
      sourceIds: ['playbook'],
    }))
    const big = { ...facet('playbook', 'usage', 0), rows, omittedRows: 0 }
    const document = fixtureCollector(
      buildSourceSnapshot({ playbook: availableSource('playbook', [big]) }),
      reportOptions('playbook'),
    )
    const section = getSection(document, 'playbook/usage')
    expect(section.rows).toHaveLength(REPORT_SECTION_ROWS)
    expect(section.omittedRows).toBe(5 + (REPORT_MAX_ROWS - REPORT_SECTION_ROWS))
  })
})
