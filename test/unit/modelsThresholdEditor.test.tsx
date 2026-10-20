// @vitest-environment jsdom
// The thresholds editor's invalid input (D119): bad values read failed
// without reaching the save, while a valid edit saves.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import type { AccountThresholds } from '../../src/shared/accounts'
import { ThresholdEditor } from '../../src/webview/models/sections/accounts/ThresholdEditor'

beforeEach(() => {
  setUiText(EN, BASE_LOCALE)
})

afterEach(() => {
  cleanup()
})

function renderEditor(onSave: (thresholds: AccountThresholds) => void) {
  const value: AccountThresholds = {}
  render(
    <ThresholdEditor
      value={value}
      capabilities={{ planWindows: [], hasRateHeadroom: false }}
      isPending={false}
      onSave={onSave}
    />,
  )
}

function setInput(text: string) {
  const input = document.querySelector('input[name="requests.day"]')
  if (input === null) throw new Error('missing input requests.day')
  fireEvent.change(input, { target: { value: text } })
}

describe('threshold editor validation', () => {
  it('reads an exponent count as failed without saving', () => {
    const saved: AccountThresholds[] = []
    renderEditor((thresholds) => {
      saved.push(thresholds)
    })
    // A counts field takes whole numbers: 1e2 passes the input's native
    // checks but fails the shape, exactly as a typed exponent would.
    setInput('1e2')
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.goalEditSave }))
    expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.accounts.invalidAccount)
    expect(saved).toEqual([])
  })

  it('saves a valid edit', () => {
    const saved: AccountThresholds[] = []
    renderEditor((thresholds) => {
      saved.push(thresholds)
    })
    setInput('12')
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.goalEditSave }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ requests: { day: 12 } })
  })
})
