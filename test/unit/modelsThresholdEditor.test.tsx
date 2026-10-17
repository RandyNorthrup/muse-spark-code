// @vitest-environment jsdom
// The thresholds editor's invalid input (D119): bad values read failed
// without reaching the save, while a valid edit saves.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

function setInput(name: string, text: string) {
  const input = document.querySelector(`input[name="${CSS.escape(name)}"]`)
  if (input === null) throw new Error(`missing input ${name}`)
  fireEvent.change(input, { target: { value: text } })
}

describe('threshold editor validation', () => {
  it('reads an exponent count as failed without saving', () => {
    const onSave = vi.fn()
    renderEditor(onSave)
    // A counts field takes whole numbers: 1e2 passes the input's native
    // checks but fails the shape, exactly as a typed exponent would.
    setInput('requests.day', '1e2')
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.goalEditSave }))
    expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.accounts.invalidAccount)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves a valid edit', () => {
    const onSave = vi.fn()
    renderEditor(onSave)
    setInput('requests.day', '12')
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.goalEditSave }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ requests: { day: 12 } })
  })
})
