import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { UI_TEXT } from '../../src/shared/l10n/text'

describe('M117 R5 check-plan help', () => {
  it('F8 translates every check-mode description without an exemption', () => {
    const tables = readdirSync('l10n').filter((name) => /^ui\..+\.json$/.test(name))
    expect(tables).toHaveLength(14)
    const shape = z.object({ referenceCliOptions: z.object({ 'estimate-check-plan': z.string() }) })
    for (const file of tables) {
      const value = shape.parse(JSON.parse(readFileSync(`l10n/${file}`, 'utf8')))
        .referenceCliOptions['estimate-check-plan']
      expect(value, file).toMatch(/^--check-plan: /)
      expect(value, file).not.toBe(UI_TEXT.referenceCliOptions['estimate-check-plan'])
    }
    expect(readFileSync('l10n/untranslated.json', 'utf8')).not.toContain(
      'referenceCliOptions.estimate-check-plan',
    )
  })
  it('F9 documents exclusive CLI and ACP checks and closure-scoped forecasts', () => {
    const readme = readFileSync('README.md', 'utf8')
    expect(readme.includes('muse-spark-code-acp estimate --check-plan')).toBe(true)
    expect(readme.includes('/estimate --check-plan')).toBe(true)
    expect(readme).toContain('dependency closure')
    expect(readme).not.toContain('including references\noutside the selected goal')
    expect(readme).toMatch(/0.*clean.*1.*problems.*2.*usage/s)
    expect(readFileSync('docs/acp.md', 'utf8')).toContain('/estimate --check-plan')
  })
})
