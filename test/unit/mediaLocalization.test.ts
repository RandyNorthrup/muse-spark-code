import { readFileSync } from 'node:fs'
import * as z from 'zod/mini'
import { afterEach, describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { tableProblems } from '../../src/shared/l10n/check'
import { TABLE_LOCALES } from '../../src/shared/l10n/locales'
import { fill, formatNumber, plural, setUiText, UI_TEXT } from '../../src/shared/l10n/text'

const mediaTableSchema = z.object({
  media: z.record(z.string(), z.union([z.string(), z.record(z.string(), z.string())])),
})
const manifestHandoffSchema = z.record(z.string(), z.record(z.string(), z.string()))

afterEach(() => {
  setUiText(EN, 'en')
})

const byText = (left: string, right: string) => left.localeCompare(right)

describe('M105 frozen media wording', () => {
  it.each(TABLE_LOCALES)(
    'has complete real %s translations with slots and plural forms',
    (locale) => {
      const table: unknown = JSON.parse(
        readFileSync(new URL(`../../l10n/ui.${locale}.json`, import.meta.url), 'utf8'),
      )
      const { media } = mediaTableSchema.parse(table)
      expect(Object.keys(media).toSorted(byText)).toEqual(Object.keys(EN.media).toSorted(byText))
      expect(tableProblems(EN.media, media, { locale, isStrict: true })).toEqual([])
    },
  )

  it('keeps a sentence around its values, marks estimates and includes counts', () => {
    setUiText(EN, 'en')
    expect(plural(UI_TEXT.media.estimateTokens, 1)).toBe('1 token (est.)')
    expect(plural(UI_TEXT.media.estimateTokens, 2580)).toBe(`${formatNumber(2580)} tokens (est.)`)
    expect(
      fill(UI_TEXT.media.replayOmitted, {
        name: 'clip.mp4',
        duration: '2:14',
        model: 'text-only',
        kind: 'video',
      }),
    ).toBe('clip.mp4 (2:14) was left out: text-only does not take video.')
    expect(fill(UI_TEXT.media.uploadProgress, { uploaded: '1 MB', total: '2 MB' })).toBe(
      'Uploaded 1 MB of 2 MB',
    )
  })

  it('reads the installed language at use time', () => {
    setUiText({ ...EN, media: { ...EN.media, sendWithoutSound: 'Sans son pour ce test' } }, 'fr')
    expect(UI_TEXT.media.sendWithoutSound).toBe('Sans son pour ce test')
    setUiText(EN, 'en')
    expect(UI_TEXT.media.sendWithoutSound).toBe('Send without sound')
  })

  it('provides all nine manifest strings in all languages without adding unused package keys', () => {
    const raw: unknown = JSON.parse(
      readFileSync(
        new URL('../../docs/certification/m105-manifest-strings.json', import.meta.url),
        'utf8',
      ),
    )
    const tables = manifestHandoffSchema.parse(raw)
    const english = tables['en']
    if (english === undefined) throw new Error('Missing English manifest handoff')
    expect(Object.keys(tables).toSorted(byText)).toEqual(['en', ...TABLE_LOCALES].toSorted(byText))
    expect(Object.keys(english)).toHaveLength(9)
    for (const locale of TABLE_LOCALES) {
      expect(tableProblems(english, tables[locale], { locale, isStrict: true })).toEqual([])
    }
    const action = english['config.mediaAudioAction.description']
    expect(action).toContain('asks once before the first charge')
    expect(action).toContain('shared daily budget')
    expect(english['config.mediaAudioAction.enumDescriptions.transcribe']).toContain(
      '$0.18 per audio hour',
    )
  })
})
