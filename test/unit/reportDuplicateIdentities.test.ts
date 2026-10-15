import { describe, expect, it } from 'vitest'
import { row, section, text } from '../../src/core/reporting/collect/common'
import { reportSectionSchema, type ReportOptions } from '../../src/shared/reportSchema'

const options: ReportOptions = {
  kind: 'project',
  asOf: '2026-10-14T00:00:00.000Z',
  scope: '',
  full: false,
  network: false,
  failOn: [],
}

describe('repeated section row identities', () => {
  it('carries both rows when two distinct rows share an identity', () => {
    const first = row('0-question', ['Q-DUP'], { name: text('first wording') }, ['plan'])
    const second = row('0-question', ['Q-DUP'], { name: text('second wording') }, ['plan'])
    expect(first.key).toBe(second.key)
    const built = section(
      'needsYou',
      'needsYou',
      ['name'],
      [first, second, row('0-question', ['Q-OTHER'], { name: text('other') }, ['plan'])],
      options,
    )
    // Neither distinct record may vanish silently: the section stays valid
    // (unique row keys) and every wording is still in the report.
    expect(reportSectionSchema.safeParse(built).success).toBe(true)
    expect(built.rows).toHaveLength(3)
    expect(new Set(built.rows.map((entry) => entry.key)).size).toBe(3)
    expect(built.rows.map((entry) => entry.cells['name'])).toContainEqual({
      type: 'text',
      value: 'first wording',
    })
    expect(built.rows.map((entry) => entry.cells['name'])).toContainEqual({
      type: 'text',
      value: 'second wording',
    })
    expect(built.omittedRows).toBe(0)
  })

  it('keeps one copy of a truly identical repeated row', () => {
    const first = row('0-question', ['Q-DUP'], { name: text('same wording') }, ['plan'])
    const again = row('0-question', ['Q-DUP'], { name: text('same wording') }, ['plan'])
    const built = section('needsYou', 'needsYou', ['name'], [first, again], options)
    expect(built.rows).toHaveLength(1)
    expect(built.omittedRows).toBe(0)
  })
})
