// Shared by the M111 settings page suites (lane ST1): every suite renders
// real pages, unmounts them after each test and answers the confirmation
// dialog, so neither block is repeated per file.
import { fireEvent, render, screen, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach } from 'vitest'
import { UI_TEXT } from '../../../src/shared/constants'

const cleanups: (() => void)[] = []

export function trackSettingsRenders(): void {
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup()
  })
}

export function renderSettingsPage(element: ReactElement): RenderResult {
  const host = render(element)
  cleanups.push(host.unmount)
  return host
}

export function confirmSettingsDialog(): void {
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.settingsSystem.confirmApply }))
}
