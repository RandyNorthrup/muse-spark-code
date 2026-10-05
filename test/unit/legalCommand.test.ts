// `/legal …` in the prompt (M97, lane B): what each shape parses to, and
// what never counts as a scan.

import { describe, expect, it } from 'vitest'
import { LEGAL_SCAN_PATHS_MAX } from '../../src/shared/constants'
import { legalCommandText, parseLegalPrompt } from '../../src/shared/legalCommand'
import { legalScanInputSchema } from '../../src/shared/legal'

describe('parseLegalPrompt', () => {
  it('scans the whole workspace on a bare /legal', () => {
    expect(parseLegalPrompt('/legal')).toEqual({})
    expect(parseLegalPrompt('  /legal  ')).toEqual({})
  })

  it('names an explicit file subset', () => {
    expect(parseLegalPrompt('/legal package.json src/index.ts')).toEqual({
      paths: ['package.json', 'src/index.ts'],
    })
  })

  it('ignores nothing else: any other text is not a scan', () => {
    expect(parseLegalPrompt('/leg')).toBeUndefined()
    expect(parseLegalPrompt('/legalize it')).toBeUndefined()
    expect(parseLegalPrompt('please /legal')).toBeUndefined()
    expect(parseLegalPrompt('/review')).toBeUndefined()
    expect(parseLegalPrompt('')).toBeUndefined()
  })

  it('never invents an option: a dash word is ordinary text', () => {
    expect(parseLegalPrompt('/legal --fix')).toBeUndefined()
    expect(parseLegalPrompt('/legal src -r')).toBeUndefined()
  })

  it('never sends more than the input schema allows', () => {
    const words = Array.from(
      { length: LEGAL_SCAN_PATHS_MAX + 1 },
      (_, index) => `f${String(index)}.ts`,
    )
    expect(parseLegalPrompt(`/legal ${words.join(' ')}`)).toBeUndefined()
    expect(parseLegalPrompt(`/legal ${'x'.repeat(1025)}`)).toBeUndefined()
    for (const input of [parseLegalPrompt('/legal'), parseLegalPrompt('/legal a.ts b/c.ts')]) {
      expect(input).toBeDefined()
      expect(legalScanInputSchema.safeParse(input).success).toBe(true)
    }
  })
})

describe('legalCommandText', () => {
  it('round-trips a bare scan and a subset', () => {
    expect(legalCommandText({})).toBe('/legal')
    expect(parseLegalPrompt(legalCommandText({}))).toEqual({})
    const input = { paths: ['a.ts', 'b/c.ts'] }
    expect(legalCommandText(input)).toBe('/legal a.ts b/c.ts')
    expect(parseLegalPrompt(legalCommandText(input))).toEqual(input)
  })
})
