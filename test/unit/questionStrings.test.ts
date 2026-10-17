import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { EN } from '../../src/shared/l10n/en'
import { tableProblems } from '../../src/shared/l10n/check'
import { TABLE_LOCALES } from '../../src/shared/l10n/locales'
import { fill } from '../../src/shared/l10n/text'
import manifestStrings from './helpers/questions/manifestStrings.json'

const keys = [
  'questionOpen',
  'questionDeferred',
  'questionAnsweredLater',
  'questionAnsweredOnReask',
  'questionDeclined',
  'questionDismissed',
  'questionExpired',
  'questionAnswer',
  'questionDismiss',
  'questionExpand',
  'questionCollapse',
  'questionNextOpen',
  'questionPreviousOpen',
  'questionCountdown',
  'questionLateAnswerDisplay',
  'announceQuestionDeferred',
  'announceQuestionReminder',
  'announceLateAnswerSent',
  'notifyOpenQuestions',
  'questionNoOpen',
  'questionAnswerFailed',
  'questionAnswerUncertain',
  'questionDismissFailed',
  'acpOpenQuestionAsked',
  'acpQuestionDeferred',
  'acpQuestionListEntry',
  'acpQuestionAnswerUsage',
  'acpQuestionNotFound',
  'acpQuestionAnswerQueued',
  'acpAnswerHelp',
  'acpQuestionsHelp',
  'openQuestionsCount',
  'openQuestionsTabCount',
] as const
const english = Object.fromEntries(keys.map((key) => [key, EN[key]]))
const tableSchema = z.record(z.string(), z.unknown())

// The shipped tables and the ready-to-apply manifest artifact must remain
// usable by lanes U/A, before those lanes introduce their own renderers.
describe('M112 strings handed to U and A', () => {
  it('provides the identifiable open label, distinct settlement labels and announcements', () => {
    expect(EN.questionOpen).toBe('Open question')
    expect(
      new Set([
        EN.questionAnswered,
        EN.questionAnsweredLater,
        EN.questionAnsweredOnReask,
        EN.questionClarified,
        EN.questionDeclined,
        EN.questionDismissed,
        EN.questionExpired,
      ]).size,
    ).toBe(7)
    expect(fill(EN.questionCountdown, { seconds: '60' })).toBe(
      'Muse keeps working in 60 s if you don’t answer',
    )
    expect(fill(EN.questionLateAnswerDisplay, { header: 'Colour' })).toBe(
      'Answer to your earlier question: Colour',
    )
    expect(EN.announceQuestionDeferred).toContain('you can answer any time')
    expect(EN.announceQuestionReminder).toContain('{header}')
    expect(EN.announceLateAnswerSent).toContain('was sent')
    expect(EN.acpQuestionAnswerUsage).toContain('/answer <n> <text>')
  })

  it.each(TABLE_LOCALES)('has real, slot-safe translations and count forms in %s', (locale) => {
    const raw: unknown = JSON.parse(readFileSync(`l10n/ui.${locale}.json`, 'utf8'))
    const table = tableSchema.parse(raw)
    const translated = Object.fromEntries(keys.map((key) => [key, table[key]]))
    expect(tableProblems(english, translated, { locale, isStrict: true })).toEqual([])
  })

  it.each(TABLE_LOCALES)('provides translated manifest keys for U in %s', (locale) => {
    const strings = tableSchema.parse(manifestStrings)
    expect(tableProblems(manifestStrings.en, strings[locale], { locale, isStrict: true })).toEqual(
      [],
    )
  })

  it('hands off the same command labels and the complete machine setting description', () => {
    expect(manifestStrings.en['command.nextOpenQuestion.title']).toBe(EN.questionNextOpen)
    expect(manifestStrings.en['command.previousOpenQuestion.title']).toBe(EN.questionPreviousOpen)
    const description = manifestStrings.en['config.questions.deferAfterSeconds.description']
    for (const detail of ['60', '0 means never', '1–9 are read as 10', '3,600', 'machine']) {
      expect(description).toContain(detail)
    }
    const patch = readFileSync('docs/certification/m112-manifest.patch', 'utf8')
    for (const locale of TABLE_LOCALES) {
      expect(patch).toContain(`+++ b/package.nls.${locale}.json`)
    }
    expect(patch).toContain('+++ b/package.nls.json')
    expect(patch).toContain('"museSpark.questions.deferAfterSeconds"')
    expect(patch).toContain('"scope": "machine"')
  })
})
