// Muse Desktop (M111, D91.16) lane ST1: one page's binding between the
// shell and its service. `load` reads the page's state, `apply` carries
// one confirmed change and returns the fresh state, and `render` draws the
// page over that state. ST2's pages implement this same interface.

import type { ReactNode } from 'react'
import type { SettingsSystemClient } from '../../../shared/desktop/settings'

export interface PageBinding<Data, Change> {
  load(client: SettingsSystemClient): Promise<Data>
  apply(client: SettingsSystemClient, change: Change): Promise<Data>
  render(data: Data, onApply: (change: Change) => void): ReactNode
}
