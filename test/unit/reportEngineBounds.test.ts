import { describe, expect, it } from 'vitest'
import { REPORT_KINDS, REPORT_MAX_ROWS } from '../../src/shared/constants'
import { reportDocumentSchema, reportSectionSchema } from '../../src/shared/reportSchema'
import { REPORT_KIND_REGISTRY } from '../../src/core/reporting/registry'
import { compare, row, sourcedSection, text } from '../../src/core/reporting/collect/common'
import { finalizeReport } from '../../src/core/reporting/render/canonical'
import { buildSourceSnapshot, reportDocument, reportOptions } from './helpers/reporting/snapshot'

const cases = REPORT_KINDS.flatMap((kind) =>
  REPORT_KIND_REGISTRY[kind].sections.map((heading) => ({ kind, heading })),
)

/** The final admission boundary is shared by ordinary and combined sections. */
describe('every registered kind reserves its disclosure inside the final schema bound', () => {
  it('uses a complete registry', () => {
    expect(Object.keys(REPORT_KIND_REGISTRY).toSorted(compare)).toEqual(
      [...REPORT_KINDS].toSorted(compare),
    )
  })

  it.each(cases)('$kind/$heading accepts the exact cap and names refusals', ({ kind, heading }) => {
    const snapshot = buildSourceSnapshot()
    const options = { ...reportOptions(kind), full: true }
    const source = REPORT_KIND_REGISTRY[kind].sources[0]
    const entries = Array.from({ length: REPORT_MAX_ROWS + 1 }, (_, index) =>
      row('bound', [kind, String(index)], { name: text(String(index)) }, [source]),
    )
    const section = sourcedSection(
      snapshot,
      options,
      `${kind}/${heading}`,
      heading,
      ['name'],
      entries,
      [source],
    )
    expect(section.rows).toHaveLength(REPORT_MAX_ROWS)
    expect(section.rows.filter((entry) => entry.key.startsWith('0-source/'))).toHaveLength(1)
    expect(section.omittedRows).toBe(2)
    expect(reportSectionSchema.safeParse(section).success).toBe(true)
    const document = reportDocument(kind, [snapshot.sources[source].record])
    document.sections = [section]
    expect(reportDocumentSchema.safeParse(finalizeReport(document)).success).toBe(true)
    const exact = sourcedSection(
      snapshot,
      options,
      `${kind}/${heading}`,
      heading,
      ['name'],
      entries.slice(0, REPORT_MAX_ROWS - 1),
      [source],
    )
    expect(exact.rows).toHaveLength(REPORT_MAX_ROWS)
    expect(exact.omittedRows).toBe(0)
  })
})
