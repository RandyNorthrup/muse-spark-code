// Muse Desktop (M111, D91.16) lane ST1: the settings app's shared contract.
// ST1 owns the system pages; ST2 adds its own page ids beside these. The
// appearance override lives in the person's desktop.json (M111
// Configuration), written only by the settings app; every other page reads
// and changes its service through sysd (./sysd.ts).

import * as z from 'zod/mini'
import type { SysdClient } from './sysd'

// ST1's system pages, in nav order.
export const SETTINGS_SYSTEM_PAGE_IDS = [
  'appearance',
  'displays',
  'sound',
  'network',
  'bluetooth',
  'cellular',
  'power',
  'printers',
  'storage',
  'datetime',
  'locale',
] as const
export type SettingsSystemPageId = (typeof SETTINGS_SYSTEM_PAGE_IDS)[number]

export const settingsSystemPageIdSchema = z.enum(SETTINGS_SYSTEM_PAGE_IDS)

// The Appearance override (D91.19): `system` follows the portal's
// appearance, the rest pin one generated mode. `hc-light`/`hc-dark` are
// the high-contrast modes lane TH generates.
export const APPEARANCE_OVERRIDES = ['system', 'light', 'dark', 'hc-light', 'hc-dark'] as const
export type AppearanceOverride = (typeof APPEARANCE_OVERRIDES)[number]

export const appearanceOverrideSchema = z.enum(APPEARANCE_OVERRIDES)

// Follow the system appearance until the person picks an override.
export const APPEARANCE_OVERRIDE_DEFAULT: AppearanceOverride = 'system'

// What the settings shell needs: sysd for the system pages (lane SY's
// transport) and the desktop.json appearance read/write beside it. The
// shell holds one of these; its absence is the honest "service
// unavailable" state, never an empty page.
export interface SettingsSystemClient {
  readonly sysd: SysdClient
  getAppearance(): Promise<AppearanceOverride>
  setAppearance(value: AppearanceOverride): Promise<void>
}
