// Muse Desktop (M111, D91.16) lane ST1: Date and time plus Language and
// region prove their confirmation gate. The zone, the manual moment and
// the language pair each ask before they apply.

/** @vitest-environment jsdom */
/** @vitest-environment-options {"pretendToBeVisual": true} */
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  confirmSettingsDialog,
  renderSettingsPage,
  trackSettingsRenders,
} from '../helpers/settingsPages'
import { UI_TEXT } from '../../../src/shared/constants'
import type { DateTimeState, LocaleState } from '../../../src/shared/desktop/sysd'
import { fill, formatDateTime } from '../../../src/shared/l10n/text'
import {
  DateTimePage,
  type DateTimeChange,
} from '../../../src/webview/settings/system/DateTimePage'
import { LocalePage, type LocaleChange } from '../../../src/webview/settings/system/LocalePage'

trackSettingsRenders()

const DATETIME: DateTimeState = {
  automatic: true,
  timezone: 'Europe/Berlin',
  zoneNames: ['Europe/Berlin', 'America/New_York'],
  nowUnixMs: 1_796_064_000_000,
}

function renderDateTime(data: DateTimeState, applied: DateTimeChange[]): void {
  renderSettingsPage(
    <DateTimePage
      data={data}
      onApply={(change) => {
        applied.push(change)
      }}
    />,
  )
}

describe('Date and time page', () => {
  it('asks before leaving automatic time', () => {
    const applied: DateTimeChange[] = []
    renderDateTime(DATETIME, applied)
    fireEvent.click(screen.getByRole('switch', { name: UI_TEXT.settingsSystem.datetimeAutomatic }))
    expect(screen.getByText(UI_TEXT.settingsSystem.datetimeConfirmAutoOff)).toBeDefined()
    confirmSettingsDialog()
    expect(applied).toEqual([{ kind: 'automatic', automatic: false }])
  })

  it('asks before changing the time zone, naming the zone', () => {
    const applied: DateTimeChange[] = []
    renderDateTime(DATETIME, applied)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'America/New_York' } })
    expect(
      screen.getByText(
        fill(UI_TEXT.settingsSystem.datetimeConfirmTimezone, { zone: 'America/New_York' }),
      ),
    ).toBeDefined()
    confirmSettingsDialog()
    expect(applied).toEqual([{ kind: 'timezone', timezone: 'America/New_York' }])
  })

  it('sets the manual moment only after confirmation, naming it', () => {
    const applied: DateTimeChange[] = []
    renderDateTime({ ...DATETIME, automatic: false }, applied)
    fireEvent.change(screen.getByLabelText(UI_TEXT.settingsSystem.datetimeDate), {
      target: { value: '2026-11-03' },
    })
    fireEvent.change(screen.getByLabelText(UI_TEXT.settingsSystem.datetimeTime), {
      target: { value: '09:30' },
    })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.settingsSystem.apply }))
    const when = Date.parse('2026-11-03T09:30')
    expect(
      screen.getByText(
        fill(UI_TEXT.settingsSystem.datetimeConfirmManual, { when: formatDateTime(when) }),
      ),
    ).toBeDefined()
    confirmSettingsDialog()
    expect(applied).toEqual([{ kind: 'manual', unixMs: when }])
  })

  it('keeps Apply disabled until the manual moment parses', () => {
    const applied: DateTimeChange[] = []
    renderDateTime({ ...DATETIME, automatic: false }, applied)
    const apply = screen.getByRole('button', { name: UI_TEXT.settingsSystem.apply })
    expect(apply.hasAttribute('disabled')).toBe(true)
    expect(applied).toEqual([])
  })
})

const LOCALE: LocaleState = {
  language: 'en',
  region: 'en-US',
  languages: [
    { code: 'en', name: 'English' },
    { code: 'de', name: 'Deutsch' },
  ],
  regions: [
    { code: 'en-US', name: 'United States' },
    { code: 'de-DE', name: 'Deutschland' },
  ],
}

describe('Language and region page', () => {
  it('carries the language pair from one Apply after one confirmation', () => {
    const applied: LocaleChange[] = []
    renderSettingsPage(
      <LocalePage
        data={LOCALE}
        onApply={(change) => {
          applied.push(change)
        }}
      />,
    )
    fireEvent.change(screen.getByLabelText(UI_TEXT.settingsSystem.localeLanguage), {
      target: { value: 'de' },
    })
    fireEvent.change(screen.getByLabelText(UI_TEXT.settingsSystem.localeRegion), {
      target: { value: 'de-DE' },
    })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.settingsSystem.apply }))
    expect(screen.getByText(UI_TEXT.settingsSystem.localeConfirm)).toBeDefined()
    expect(screen.getByText(UI_TEXT.settingsSystem.localeNote)).toBeDefined()
    confirmSettingsDialog()
    expect(applied).toEqual([{ kind: 'set', language: 'de', region: 'de-DE' }])
  })
})
