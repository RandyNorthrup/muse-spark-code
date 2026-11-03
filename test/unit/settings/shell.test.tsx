// Muse Desktop (M111, D91.16) lane ST1: the shell proves its nav, its
// honest unavailable state and the page frame's loading, retry and
// apply-failure paths. The frame's `load` is a plain prop; the tests
// drive it with resolved and refused promises, never a sysd double.

/** @vitest-environment jsdom */
/** @vitest-environment-options {"pretendToBeVisual": true} */
import { fireEvent, screen } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { renderSettingsPage, trackSettingsRenders } from '../helpers/settingsPages'
import { UI_TEXT } from '../../../src/shared/constants'
import type { SettingsSystemPageId } from '../../../src/shared/desktop/settings'
import { SysdError, SYSD_ERROR_CODES } from '../../../src/shared/desktop/sysd'
import { fill } from '../../../src/shared/l10n/text'
import { SettingsApp, SettingsNav } from '../../../src/webview/settings/shell/SettingsApp'
import {
  PageFrame,
  runPageApply,
  type PageReport,
} from '../../../src/webview/settings/system/frame'

trackSettingsRenders()

function renderNav(active: SettingsSystemPageId, selected: SettingsSystemPageId[]): void {
  renderSettingsPage(
    <SettingsNav
      active={active}
      onSelect={(id) => {
        selected.push(id)
      }}
    />,
  )
}

describe('settings nav', () => {
  it('lists all eleven pages with the active one selected', () => {
    const selected: SettingsSystemPageId[] = []
    renderNav('network', selected)
    expect(screen.getAllByRole('option')).toHaveLength(11)
    expect(
      screen
        .getByRole('option', { name: UI_TEXT.settingsSystem.navNetwork })
        .getAttribute('aria-selected'),
    ).toBe('true')
    expect(
      screen
        .getByRole('option', { name: UI_TEXT.settingsSystem.navSound })
        .getAttribute('aria-selected'),
    ).toBe('false')
  })

  it('selects on click', () => {
    const selected: SettingsSystemPageId[] = []
    renderNav('appearance', selected)
    fireEvent.click(screen.getByRole('option', { name: UI_TEXT.settingsSystem.navLocale }))
    expect(selected).toEqual(['locale'])
  })

  it('moves with arrows and wraps at the ends', () => {
    const selected: SettingsSystemPageId[] = []
    renderNav('appearance', selected)
    const listbox = screen.getByRole('listbox')
    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    fireEvent.keyDown(listbox, { key: 'ArrowUp' })
    expect(selected).toEqual(['displays', 'locale'])
  })

  it('jumps with Home and End and ignores other keys', () => {
    const selected: SettingsSystemPageId[] = []
    renderNav('sound', selected)
    const listbox = screen.getByRole('listbox')
    fireEvent.keyDown(listbox, { key: 'End' })
    fireEvent.keyDown(listbox, { key: 'Home' })
    fireEvent.keyDown(listbox, { key: 'a' })
    expect(selected).toEqual(['locale', 'appearance'])
  })
})

describe('settings app without a client', () => {
  it('says the service is unavailable instead of rendering dead pages', () => {
    renderSettingsPage(<SettingsApp client={undefined} />)
    expect(screen.getByRole('alert')).toBeDefined()
    expect(screen.getByText(UI_TEXT.settingsSystem.unavailableTitle)).toBeDefined()
    expect(screen.getByText(UI_TEXT.settingsSystem.unavailableDetail)).toBeDefined()
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

describe('page frame', () => {
  it('shows loading, then the loaded data', async () => {
    const { promise: pending, resolve: resolveLoad } = Promise.withResolvers<string>()
    const load = (): Promise<string> => pending
    renderSettingsPage(<PageFrame load={load}>{(data) => <p>{`ready:${data}`}</p>}</PageFrame>)
    expect(screen.getByRole('status')).toBeDefined()
    resolveLoad('sys')
    expect(await screen.findByText('ready:sys')).toBeDefined()
  })

  it('shows the refused load with its code, and retries', async () => {
    let attempts = 0
    const load = (): Promise<string> => {
      attempts += 1
      return attempts === 1
        ? Promise.reject(new SysdError(SYSD_ERROR_CODES.unavailable, 'no sysd'))
        : Promise.resolve('sys')
    }
    renderSettingsPage(<PageFrame load={load}>{(data) => <p>{`ready:${data}`}</p>}</PageFrame>)
    expect(
      await screen.findByText(
        fill(UI_TEXT.settingsSystem.loadFailed, { code: String(SYSD_ERROR_CODES.unavailable) }),
      ),
    ).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.settingsSystem.retry }))
    expect(await screen.findByText('ready:sys')).toBeDefined()
    expect(attempts).toBe(2)
  })

  it('banners a refused apply and re-reads afterwards', async () => {
    const seen: string[] = []
    let report!: PageReport<string>
    renderSettingsPage(
      <PageFrame load={() => Promise.resolve('sys')}>
        {(data, frameReport) => {
          report = frameReport
          seen.push(data)
          return <p>{`ready:${data}`}</p>
        }}
      </PageFrame>,
    )
    expect(await screen.findByText('ready:sys')).toBeDefined()
    await runPageApply(report, () => {
      throw new SysdError(SYSD_ERROR_CODES.denied, 'polkit refused')
    })
    expect(
      await screen.findByText(
        fill(UI_TEXT.settingsSystem.applyFailed, { code: String(SYSD_ERROR_CODES.denied) }),
      ),
    ).toBeDefined()
    expect(await screen.findByText('ready:sys')).toBeDefined()
    expect(seen).toEqual(['sys', 'sys'])
  })

  it('never renders one loader’s data for another loader', async () => {
    const host = renderSettingsPage(
      <PageFrame load={() => Promise.resolve('first')}>
        {(data) => <p>{`ready:${data}`}</p>}
      </PageFrame>,
    )
    expect(await screen.findByText('ready:first')).toBeDefined()
    host.rerender(
      <PageFrame load={() => Promise.resolve('second')}>
        {(data) => <p>{`ready:${data}`}</p>}
      </PageFrame>,
    )
    expect(screen.getByRole('status')).toBeDefined()
    expect(screen.queryByText('ready:first')).toBeNull()
    expect(await screen.findByText('ready:second')).toBeDefined()
  })

  it('resets drafts when fresh state lands after an apply', async () => {
    let report!: PageReport<string>
    renderSettingsPage(
      <PageFrame load={() => Promise.resolve('first')}>
        {(data, frameReport) => {
          report = frameReport
          return <DraftChild data={data} />
        }}
      </PageFrame>,
    )
    expect(await screen.findByDisplayValue('first')).toBeDefined()
    fireEvent.change(screen.getByDisplayValue('first'), { target: { value: 'edited' } })
    await runPageApply(report, () => Promise.resolve('second'))
    expect(await screen.findByDisplayValue('second')).toBeDefined()
  })
})

function DraftChild({ data }: { readonly data: string }): ReactNode {
  const [draft, setDraft] = useState(data)
  return (
    <input
      aria-label="draft"
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value)
      }}
    />
  )
}
