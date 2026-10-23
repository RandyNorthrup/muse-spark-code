// Muse Desktop (M111, D91) lane 0 component contracts: the shapes the
// owner-approved mockups define (docs/design/m111-mockups/, approved
// 2026-10-23). Lanes SH1, SH2, WB, ST and the preview lanes build to these
// contracts; changing one is a plan change, not an implementation detail.
// Where a mockup and D91 disagree D91 governs (the tiled detached terminal
// in Tiled.dc.html: D91.13 calls a detached terminal FLOATING).

import { z } from 'zod'

/** The workbench's regions at 1920×1080 and 1280×800 (sheets 01–06). */
export const WORKBENCH_REGIONS = [
  'top-bar',
  'rail',
  'sidebar',
  'editor',
  'chat',
  'bottom-panel',
  'status-bar',
] as const
export type WorkbenchRegion = (typeof WORKBENCH_REGIONS)[number]

/** Frame sizes, in CSS pixels, bound to the M114 tokens of the same name. */
export const DESKTOP_FRAME = {
  topBarHeightPx: 32,
  statusBarHeightPx: 24,
  railWidthPx: 48,
  railButtonPx: 44,
  railIconPx: 20,
  railFlipMs: 280,
} as const

/** At 1280×800 the panes shrink to these widths/heights (canvas note q2). */
export const COMPACT_PANES = {
  chatWidthPx: 340,
  sidebarWidthPx: 232,
  terminalHeightPx: 176,
  minimapWidthPx: 48,
} as const

/** The top bar opens exactly one popover at a time (sheets 07–08, note q3). */
export const BAR_POPOVERS = [
  'workspaces',
  'network',
  'sound',
  'power',
  'clock',
  'agents',
  'session',
] as const
export type BarPopover = (typeof BAR_POPOVERS)[number]

/** Every kind a launcher result can be (sheet 09). */
export const LAUNCHER_RESULT_KINDS = [
  'app',
  'file',
  'folder',
  'command',
  'agent',
  'session',
  'setting',
  'calculation',
  'symbol',
  'window',
] as const
export type LauncherResultKind = (typeof LAUNCHER_RESULT_KINDS)[number]

/** The launcher's modes (sheet 10); calculation stays on this machine. */
export const LAUNCHER_MODES = ['all', 'calculate', 'symbols', 'agents', 'settings'] as const
export type LauncherMode = (typeof LAUNCHER_MODES)[number]

export const launcherResultSchema = z.strictObject({
  kind: z.enum(LAUNCHER_RESULT_KINDS),
  id: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().optional(),
})
export type LauncherResult = z.infer<typeof launcherResultSchema>

/** Sign-in factors the greeter and lock screen offer (sheets 11–12). */
export const AUTH_FACTORS = ['password', 'pin', 'security-key', 'fingerprint'] as const
export type AuthFactor = (typeof AUTH_FACTORS)[number]

/** Lock-screen actions that work without signing in (sheet 12, note q4). */
export const LOCK_ACTIONS = ['stop-everything', 'lock-admin', 'stop-machine'] as const
export type LockAction = (typeof LOCK_ACTIONS)[number]

/** System prompt kinds (sheet 13). */
export const SYSTEM_PROMPT_KINDS = [
  'administrator-password',
  'agent-admin',
  'wifi-password',
  'bluetooth-pairing',
] as const
export type SystemPromptKind = (typeof SYSTEM_PROMPT_KINDS)[number]

/** Tiling rules (sheet 14, note q5) with D91.13's floating detached terminal. */
export const TILING = {
  windowCorner: '--ms-radius-lg',
  innerGap: '--ms-space-4',
  outerGap: '--ms-space-8',
  focusedBorder: '--ms-focus',
  focusedBorderWidth: '--ms-focus-width',
  smartGapsAlone: true,
  detachedTerminal: 'floating',
} as const

/** One onboarding pack from the signed pack index (sheet 15). */
export const onboardingPackSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  downloadBytes: z.number().int().nonnegative(),
  diskBytes: z.number().int().nonnegative(),
  licences: z.array(z.string().min(1)),
  recommended: z.boolean(),
})
export type OnboardingPack = z.infer<typeof onboardingPackSchema>

/** Preview device presets use generic names only (sheets 16–17, note q6). */
export const PREVIEW_DEVICES = [
  { id: 'phone', widthPx: 390, heightPx: 844 },
  { id: 'tablet', widthPx: 820, heightPx: 1180 },
  { id: 'laptop', widthPx: 1280, heightPx: 800 },
  { id: 'desktop', widthPx: 1920, heightPx: 1080 },
] as const
export type PreviewDevice = (typeof PREVIEW_DEVICES)[number]

export const previewViewportSchema = z.strictObject({
  deviceId: z.enum(['phone', 'tablet', 'laptop', 'desktop']),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
})
export type PreviewViewport = z.infer<typeof previewViewportSchema>

/** Content classes that never mirror, even in a right-to-left layout. */
export const RTL_LTR_ONLY = ['file-name', 'code', 'terminal', 'message-text', 'editor'] as const
export type RtlLtrOnly = (typeof RTL_LTR_ONLY)[number]

// Pseudo-RTL rule (sheet 18, note q7): UI strings mirror with a bidi
// override like Android's ar-XB pseudo-locale; file names, code, terminal
// output, message text and the editor with its minimap stay left-to-right.
export function isMirroredInRtl(kind: 'ui-string' | RtlLtrOnly): boolean {
  return kind === 'ui-string'
}
