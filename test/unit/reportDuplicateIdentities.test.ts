import { describe, expect, it } from 'vitest'
import { row, section, text } from '../../src/core/reporting/collect/common'
import type { ReportOptions } from '../../src/shared/reportSchema'

const options: ReportOptions = {
  kind: 'project',
  asOf: '2026-10-14T00:00:00.000Z',
  scope: '',
  full: false,
  network: false,
  failOn: [],
}

describe('repeated section row identities', () => {
  it('keeps the first row when two rows share a key', () => {
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
    expect(built.rows.map((entry) => entry.key)).toHaveLength(2)
    expect(built.rows.find((entry) => entry.key === first.key)?.cells['name']).toEqual({
      type: 'text',
      value: 'first wording',
    })
  })
})
