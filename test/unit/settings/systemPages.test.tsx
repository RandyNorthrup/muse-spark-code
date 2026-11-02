// Muse Desktop (M111, D91.16) lane ST1: Appearance, Displays and Sound
// prove their confirmation gate. Every change stages a dialog that names
// it; Confirm carries the exact change to onApply, Cancel and Escape
// carry nothing.

/** @vitest-environment jsdom */
/** @vitest-environment-options {"pretendToBeVisual": true} */
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../../src/shared/constants'
import type { AppearanceOverride } from '../../../src/shared/desktop/settings'
import type { DisplaysState, SoundState } from '../../../src/shared/desktop/sysd'
import { fill } from '../../../src/shared/l10n/text'
import {
  AppearancePage,
  type AppearanceChange,
} from '../../../src/webview/settings/system/AppearancePage'
import {
  DisplaysPage,
  type DisplaysChange,
} from '../../../src/webview/settings/system/DisplaysPage'
import { SoundPage, type SoundChange } from '../../../src/webview/settings/system/SoundPage'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function renderAppearance(data: AppearanceOverride, applied: AppearanceChange[]): void {
  const host = render(
    <AppearancePage
      data={data}
      onApply={(change) => {
        applied.push(change)
      }}
    />,
  )
  cleanups.push(host.unmount)
}

function confirmDialog(): void {
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.settingsSystem.confirmApply }))
}

function cancelDialog(): void {
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.desktop.cancel }))
}

describe('Appearance page', () => {
  it('asks before changing the theme, and applies the exact override', () => {
    const applied: AppearanceChange[] = []
    renderAppearance('system', applied)
    fireEvent.click(screen.getByRole('radio', { name: UI_TEXT.settingsSystem.appearanceThemeDark }))
    expect(applied).toEqual([])
    expect(
      screen.getByText(
        fill(UI_TEXT.settingsSystem.appearanceConfirm, {
          theme: UI_TEXT.settingsSystem.appearanceThemeDark,
        }),
      ),
    ).toBeDefined()
    confirmDialog()
    expect(applied).toEqual(['dark'])
  })

  it('drops the change when the dialog is cancelled', () => {
    const applied: AppearanceChange[] = []
    renderAppearance('light', applied)
    fireEvent.click(
      screen.getByRole('radio', { name: UI_TEXT.settingsSystem.appearanceThemeHcDark }),
    )
    cancelDialog()
    expect(applied).toEqual([])
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('drops the change on Escape', () => {
    const applied: AppearanceChange[] = []
    renderAppearance('system', applied)
    fireEvent.click(
      screen.getByRole('radio', { name: UI_TEXT.settingsSystem.appearanceThemeLight }),
    )
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    expect(applied).toEqual([])
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})

const DISPLAYS: DisplaysState = {
  outputs: [
    {
      id: 'out-1',
      name: 'Laptop panel',
      connected: true,
      enabled: true,
      primary: true,
      widthPx: 1920,
      heightPx: 1080,
      refreshMilliHz: 60_000,
      scalePercent: 100,
      brightnessPercent: 70,
      modes: [
        { widthPx: 1920, heightPx: 1080, refreshMilliHz: 60_000 },
        { widthPx: 1280, heightPx: 720, refreshMilliHz: 60_000 },
      ],
    },
    {
      id: 'out-2',
      name: 'Desk monitor',
      connected: true,
      enabled: false,
      primary: false,
      widthPx: 2560,
      heightPx: 1440,
      refreshMilliHz: 144_000,
      scalePercent: 100,
      modes: [{ widthPx: 2560, heightPx: 1440, refreshMilliHz: 144_000 }],
    },
  ],
}

function renderDisplays(applied: DisplaysChange[]): void {
  const host = render(
    <DisplaysPage
      data={DISPLAYS}
      onApply={(change) => {
        applied.push(change)
      }}
    />,
  )
  cleanups.push(host.unmount)
}

describe('Displays page', () => {
  it('asks before disabling an output', () => {
    const applied: DisplaysChange[] = []
    renderDisplays(applied)
    const switches = screen.getAllByRole('switch', { name: UI_TEXT.settingsSystem.displaysEnabled })
    fireEvent.click(switches[0]!)
    expect(applied).toEqual([])
    expect(
      screen.getByText(fill(UI_TEXT.settingsSystem.displaysConfirm, { name: 'Laptop panel' })),
    ).toBeDefined()
    confirmDialog()
    expect(applied).toEqual([{ kind: 'enabled', id: 'out-1', enabled: false }])
  })

  it('applies mode, scale and brightness drafts together after one confirmation', () => {
    const applied: DisplaysChange[] = []
    renderDisplays(applied)
    fireEvent.change(screen.getAllByLabelText(UI_TEXT.settingsSystem.displaysResolution)[0]!, {
      target: { value: '1280x720x60000' },
    })
    fireEvent.change(screen.getAllByLabelText(UI_TEXT.settingsSystem.displaysScale)[0]!, {
      target: { value: '125' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: UI_TEXT.settingsSystem.apply })[0]!)
    confirmDialog()
    expect(applied).toEqual([
      {
        kind: 'output',
        value: {
          id: 'out-1',
          widthPx: 1280,
          heightPx: 720,
          refreshMilliHz: 60_000,
          scalePercent: 125,
        },
        brightnessPercent: 70,
      },
    ])
  })

  it('refuses a non-numeric scale without calling onApply', () => {
    const applied: DisplaysChange[] = []
    renderDisplays(applied)
    fireEvent.change(screen.getAllByLabelText(UI_TEXT.settingsSystem.displaysScale)[0]!, {
      target: { value: 'huge' },
    })
    const apply = screen.getAllByRole('button', {
      name: UI_TEXT.settingsSystem.apply,
    })[0]!
    expect(apply.hasAttribute('disabled')).toBe(true)
    expect(applied).toEqual([])
  })

  it('shows a brightness slider only for the enabled output that has one', () => {
    const applied: DisplaysChange[] = []
    renderDisplays(applied)
    expect(screen.getByText('Desk monitor')).toBeDefined()
    expect(screen.getAllByLabelText(UI_TEXT.settingsSystem.displaysBrightness)).toHaveLength(1)
  })
})

const SOUND: SoundState = {
  outputs: [
    { id: 'sink-1', name: 'Speakers', volumePercent: 40, muted: false, isDefault: true },
    { id: 'sink-2', name: 'Headphones', volumePercent: 80, muted: true, isDefault: false },
  ],
  inputs: [],
}

function renderSound(applied: SoundChange[]): void {
  const host = render(
    <SoundPage
      data={SOUND}
      onApply={(change) => {
        applied.push(change)
      }}
    />,
  )
  cleanups.push(host.unmount)
}

describe('Sound page', () => {
  it('asks before muting, and carries the exact device', () => {
    const applied: SoundChange[] = []
    renderSound(applied)
    fireEvent.click(screen.getAllByRole('switch')[0]!)
    expect(applied).toEqual([])
    expect(
      screen.getByText(fill(UI_TEXT.settingsSystem.soundConfirmMute, { name: 'Speakers' })),
    ).toBeDefined()
    confirmDialog()
    expect(applied).toEqual([{ kind: 'muted', id: 'sink-1', direction: 'output', muted: true }])
  })

  it('asks before switching the default output', () => {
    const applied: SoundChange[] = []
    renderSound(applied)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.settingsSystem.useAsDefault }))
    confirmDialog()
    expect(applied).toEqual([{ kind: 'default', id: 'sink-2', direction: 'output' }])
  })
})
