import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadUiTable } from '../../src/host/l10n'
import {
  PLAYBOOK_CONFIGURABLE_RULES,
  PLAYBOOK_FINDING_CLASSES,
  PLAYBOOK_RESOLUTIONS,
  PLAYBOOK_SAFETY_RULE,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { TABLE_LOCALES } from '../../src/shared/l10n/locales'
import {
  BASE_LOCALE,
  UI_TEXT,
  fill,
  formatDate,
  formatNumber,
  formatUnit,
  plural,
  setUiText,
} from '../../src/shared/l10n/text'
import {
  playbookWhyNoteSchema,
  type PlaybookRound,
  type PlaybookWhyNote,
} from '../../src/shared/playbook'

afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

describe('M116 shared strings', () => {
  it('has labels for every rule, class, resolution and every schema note code', () => {
    expect(Object.keys(UI_TEXT.playbookRules)).toEqual([
      ...PLAYBOOK_CONFIGURABLE_RULES,
      PLAYBOOK_SAFETY_RULE,
    ])
    expect(Object.keys(UI_TEXT.playbookClasses)).toEqual(PLAYBOOK_FINDING_CLASSES)
    expect(Object.keys(UI_TEXT.playbookResolutions)).toEqual(PLAYBOOK_RESOLUTIONS)
    const dispositions: Record<PlaybookRound['answers'][number]['status'], string> =
      UI_TEXT.playbookDispositions
    expect(Object.keys(dispositions)).toEqual(['fixed', 'disputed', 'residual', 'override'])
    expect(UI_TEXT.playbookNotes.lineageRequired).toContain('{module}')
    expect(UI_TEXT.playbookNotes.reviewerConflict).toContain('{module}')
    // The typed map requires a template for every schema code; parsing each
    // table key catches the other direction (a template with an unknown code).
    const notes: Record<PlaybookWhyNote['code'], string> = UI_TEXT.playbookNotes
    for (const code of Object.keys(notes))
      expect(
        playbookWhyNoteSchema.safeParse({ rule: 'threeStrikes', code, at: 0, needsUser: false })
          .success,
      ).toBe(true)
    expect(UI_TEXT.playbookDesignPending).toBe('Awaiting redesign review')
  })

  it.each(TABLE_LOCALES)(
    'installs %s after import and fills the shared note, immutable safety rule and count',
    async (locale) => {
      const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
      const installed = await loadUiTable({
        language: locale,
        log,
        readExtensionFile: (segments) =>
          readFile(new URL(`../../${segments.join('/')}`, import.meta.url), 'utf8'),
      })
      expect(installed.locale).toBe(locale)
      expect(log.warn).not.toHaveBeenCalled()
      expect(UI_TEXT.playbookNotes.redesignRequired).not.toBe(EN.playbookNotes.redesignRequired)
      const note = fill(UI_TEXT.playbookNotes.redesignRequired, {
        round: 3,
        module: 'src/core/schedules/store',
        classes: UI_TEXT.playbookClasses.concurrency,
      })
      expect(note).toContain('src/core/schedules/store')
      expect(note).toContain(UI_TEXT.playbookClasses.concurrency)
      expect(note).toContain(formatNumber(3))
      expect(note).not.toMatch(/\{\w+\}/u)
      expect(fill(UI_TEXT.playbookNotes.offloaded, { worker: 'macmini' })).toContain('macmini')
      expect(
        playbookWhyNoteSchema.parse({
          rule: 'offload',
          code: 'offloaded',
          workerId: 'macmini',
          at: 0,
          needsUser: false,
        }).workerId,
      ).toBe('macmini')
      expect(UI_TEXT.playbookSafetyAlwaysOn).not.toBe(EN.playbookSafetyAlwaysOn)
      for (const code of ['lineageRequired', 'reviewerConflict'] as const) {
        expect(UI_TEXT.playbookNotes[code]).not.toBe(EN.playbookNotes[code])
        expect(fill(UI_TEXT.playbookNotes[code], { module: 'src/core/jobs' })).not.toMatch(
          /\{\w+\}/u,
        )
      }
      for (const status of ['fixed', 'disputed', 'residual', 'override'] as const)
        expect(UI_TEXT.playbookDispositions[status]).not.toBe(EN.playbookDispositions[status])
      const disabled = fill(UI_TEXT.playbookDisabledDetail, {
        actor: 'owner',
        date: formatDate(0),
        reason: 'migration',
      })
      expect(disabled).not.toMatch(/\{\w+\}/u)
      expect(disabled).toContain('owner')
      expect(disabled).toContain('migration')
      expect(disabled).toContain(formatDate(0))
      expect(
        fill(UI_TEXT.playbookNotes.permissionLaundering, { duration: formatUnit(1, 'hour') }),
      ).not.toMatch(/\{\w+\}/u)
      for (const count of [0, 1, 2, 3, 5]) {
        const badge = plural(UI_TEXT.playbookStrikeBadge, count)
        expect(badge).not.toMatch(/\{\w+\}/u)
        expect(badge).toContain(formatNumber(count))
      }
    },
  )
})
