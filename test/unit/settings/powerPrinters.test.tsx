// Muse Desktop (M111, D91.16) lane ST1: Power, Printers and Storage
// prove their confirmation gate, and the number drafts prove that only
// safe integers reach the service.

/** @vitest-environment jsdom */
/** @vitest-environment-options {"pretendToBeVisual": true} */
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../../src/shared/constants'
import type { PowerState, PrintersState, StorageState } from '../../../src/shared/desktop/sysd'
import { fill } from '../../../src/shared/l10n/text'
import { parseDraftInt } from '../../../src/webview/settings/system/numbers'
import { PowerPage, type PowerChange } from '../../../src/webview/settings/system/PowerPage'
import {
  PrintersPage,
  type PrintersChange,
} from '../../../src/webview/settings/system/PrintersPage'
import { StoragePage, type StorageChange } from '../../../src/webview/settings/system/StoragePage'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function confirmDialog(): void {
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.settingsSystem.confirmApply }))
}

const POWER: PowerState = {
  batteries: [{ percent: 55, state: 'discharging', minutesLeft: 125 }],
  profile: 'balanced',
  displayOffMinutes: 10,
  sleepMinutes: 30,
  onLidClose: 'sleep',
  onPowerButton: 'prompt',
}

function renderPower(applied: PowerChange[]): void {
  const host = render(
    <PowerPage
      data={POWER}
      onApply={(change) => {
        applied.push(change)
      }}
    />,
  )
  cleanups.push(host.unmount)
}

describe('Power page', () => {
  it('asks before changing the power mode', () => {
    const applied: PowerChange[] = []
    renderPower(applied)
    fireEvent.click(
      screen.getByRole('radio', { name: UI_TEXT.settingsSystem.powerProfilePerformance }),
    )
    expect(applied).toEqual([])
    expect(
      screen.getByText(
        fill(UI_TEXT.settingsSystem.powerConfirmProfile, {
          profile: UI_TEXT.settingsSystem.powerProfilePerformance,
        }),
      ),
    ).toBeDefined()
    confirmDialog()
    expect(applied).toEqual([{ kind: 'profile', profile: 'performance' }])
  })

  it('carries both timers from one Apply after one confirmation', () => {
    const applied: PowerChange[] = []
    renderPower(applied)
    fireEvent.change(screen.getByLabelText(UI_TEXT.settingsSystem.powerDisplayOff), {
      target: { value: '5' },
    })
    fireEvent.change(screen.getByLabelText(UI_TEXT.settingsSystem.powerSleep), {
      target: { value: '0' },
    })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.settingsSystem.apply }))
    expect(screen.getByText(UI_TEXT.settingsSystem.powerConfirmTimeouts)).toBeDefined()
    confirmDialog()
    expect(applied).toEqual([{ kind: 'timeouts', displayOffMinutes: 5, sleepMinutes: 0 }])
  })

  it('asks before changing what the lid does', () => {
    const applied: PowerChange[] = []
    renderPower(applied)
    fireEvent.change(screen.getByLabelText(UI_TEXT.settingsSystem.powerLid), {
      target: { value: 'lock' },
    })
    expect(screen.getByText(UI_TEXT.settingsSystem.powerConfirmActions)).toBeDefined()
    confirmDialog()
    expect(applied).toEqual([{ kind: 'actions', onLidClose: 'lock', onPowerButton: 'prompt' }])
  })
})

const PRINTERS: PrintersState = {
  printers: [
    { id: 'pr-1', name: 'Office', status: 'idle', isDefault: true },
    { id: 'pr-2', name: 'Home', status: 'offline', isDefault: false },
  ],
}

describe('Printers page', () => {
  it('asks before switching the default printer', () => {
    const applied: PrintersChange[] = []
    const host = render(
      <PrintersPage
        data={PRINTERS}
        onApply={(change) => {
          applied.push(change)
        }}
      />,
    )
    cleanups.push(host.unmount)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.settingsSystem.useAsDefault }))
    expect(
      screen.getByText(fill(UI_TEXT.settingsSystem.printersConfirmDefault, { name: 'Home' })),
    ).toBeDefined()
    confirmDialog()
    expect(applied).toEqual([{ kind: 'default', id: 'pr-2' }])
  })

  it('adds by address only after confirmation, trimmed', () => {
    const applied: PrintersChange[] = []
    const host = render(
      <PrintersPage
        data={{ printers: [] }}
        onApply={(change) => {
          applied.push(change)
        }}
      />,
    )
    cleanups.push(host.unmount)
    expect(screen.getByText(UI_TEXT.settingsSystem.printersNoPrinters)).toBeDefined()
    fireEvent.change(screen.getByLabelText(UI_TEXT.settingsSystem.printersUri), {
      target: { value: '  ipp://printer.local  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.settingsSystem.printersAdd }))
    confirmDialog()
    expect(applied).toEqual([{ kind: 'add', uri: 'ipp://printer.local' }])
  })

  it('asks before removing a printer', () => {
    const applied: PrintersChange[] = []
    const host = render(
      <PrintersPage
        data={PRINTERS}
        onApply={(change) => {
          applied.push(change)
        }}
      />,
    )
    cleanups.push(host.unmount)
    fireEvent.click(
      screen.getAllByRole('button', { name: UI_TEXT.settingsSystem.printersRemove })[1]!,
    )
    confirmDialog()
    expect(applied).toEqual([{ kind: 'remove', id: 'pr-2' }])
  })
})

const STORAGE: StorageState = {
  volumes: [
    {
      id: 'vol-1',
      name: 'System',
      sizeBytes: 512_000_000_000,
      usedBytes: 60_000_000_000,
      mountPoint: '/',
      removable: false,
      ejectable: false,
    },
    {
      id: 'vol-2',
      name: 'Backup stick',
      sizeBytes: 64_000_000_000,
      usedBytes: 8_000_000_000,
      mountPoint: '/media/backup',
      removable: true,
      ejectable: true,
    },
  ],
}

describe('Storage page', () => {
  it('asks before ejecting, and offers eject only for ejectable volumes', () => {
    const applied: StorageChange[] = []
    const host = render(
      <StoragePage
        data={STORAGE}
        onApply={(change) => {
          applied.push(change)
        }}
      />,
    )
    cleanups.push(host.unmount)
    expect(
      screen.getAllByRole('button', { name: UI_TEXT.settingsSystem.storageEject }),
    ).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.settingsSystem.storageEject }))
    expect(
      screen.getByText(fill(UI_TEXT.settingsSystem.storageConfirmEject, { name: 'Backup stick' })),
    ).toBeDefined()
    confirmDialog()
    expect(applied).toEqual([{ kind: 'eject', id: 'vol-2' }])
  })
})

describe('number drafts', () => {
  it('accepts safe integers and refuses everything else', () => {
    expect(parseDraftInt('125')).toBe(125)
    expect(parseDraftInt(' 0 ')).toBe(0)
    expect(parseDraftInt('-3')).toBe(-3)
    expect(parseDraftInt('')).toBeUndefined()
    expect(parseDraftInt('huge')).toBeUndefined()
    expect(parseDraftInt('12.5')).toBeUndefined()
    expect(parseDraftInt('99999999999999999999999')).toBeUndefined()
  })
})
