import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { tableProblems } from '../../src/shared/l10n/check'
import { EN } from '../../src/shared/l10n/en'
import { TABLE_LOCALES } from '../../src/shared/l10n/locales'
import { BASE_LOCALE, fill, plural, setUiText, UI_TEXT } from '../../src/shared/l10n/text'

const english = {
  teamTraffic: EN.teamTraffic,
  teamTaskStates: EN.teamTaskStates,
  teamPriorities: EN.teamPriorities,
  teamSchedulerSettings: EN.teamSchedulerSettings,
  teamTrafficMetrics: EN.teamTrafficMetrics,
  teamRunners: EN.teamRunners,
  teamTrafficNotices: EN.teamTrafficNotices,
  teamSchedulerCommands: EN.teamSchedulerCommands,
  teamStallReasons: EN.teamStallReasons,
  teamSharedFileKinds: EN.teamSharedFileKinds,
  teamTaskSizes: EN.teamTaskSizes,
}

afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

describe('M96c translated scheduler surfaces', () => {
  it.each(TABLE_LOCALES)('has complete real translations and intact slots in %s', (locale) => {
    const table = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(readFileSync(`l10n/ui.${locale}.json`, 'utf8')))
    const selected = Object.fromEntries(Object.keys(english).map((key) => [key, table[key]]))
    expect(
      tableProblems(english, selected, {
        locale,
        isStrict: true,
        untranslated: new Set(),
      }),
    ).toEqual([])
  })

  it('provides X2 with the same seven manifest titles in English and all 14 languages', () => {
    const manifest = z
      .record(z.string(), z.record(z.string(), z.string()))
      .parse(JSON.parse(readFileSync('docs/certification/m96c-0c-manifest.json', 'utf8')))
    for (const locale of [BASE_LOCALE, ...TABLE_LOCALES]) {
      const commands =
        locale === BASE_LOCALE
          ? EN.teamSchedulerCommands
          : z
              .object({ teamSchedulerCommands: z.record(z.string(), z.string()) })
              .parse(JSON.parse(readFileSync(`l10n/ui.${locale}.json`, 'utf8')))
              .teamSchedulerCommands
      expect(manifest[locale]).toEqual(
        Object.fromEntries(
          Object.entries(commands).map(([key, title]) => [`command.${key}.title`, title]),
        ),
      )
    }
  })

  it('keeps price and shared daily budget visible in the consent template', () => {
    const text = fill(UI_TEXT.teamTrafficNotices.paidNotice, { price: '$2', budget: '$10' })
    expect(text).toContain('$2')
    expect(text).toContain('$10')
    expect(text).toContain('Before the first charge')
    expect(text).toContain('museSpark.paidDailyBudgetUsd')
    expect(text).toContain('Your subscription does not pay')
    expect(text).not.toMatch(/\{\w+\}/)
  })

  it('reads recovery text at use time and pluralises the window and worker counts', () => {
    setUiText(
      {
        ...EN,
        teamTraffic: { ...EN.teamTraffic, resumeQueue: 'Warteschlange fortsetzen' },
      },
      'de',
    )
    expect(UI_TEXT.teamTraffic.resumeQueue).toBe('Warteschlange fortsetzen')
    setUiText(EN, BASE_LOCALE)
    expect(
      plural(UI_TEXT.teamTraffic.machineLoad, 1, {
        workers: plural(UI_TEXT.teamTraffic.workerCount, 1),
      }),
    ).toBe('1 window runs 1 worker on this machine.')
    expect(
      plural(UI_TEXT.teamTraffic.machineLoad, 2, {
        workers: plural(UI_TEXT.teamTraffic.workerCount, 4),
      }),
    ).toBe('2 windows run 4 workers on this machine.')
  })
})
