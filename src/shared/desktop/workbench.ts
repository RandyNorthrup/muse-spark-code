// Muse Desktop (M111, D91.12/13) lane WB: workbench logic shared by the
// Electron main process and the renderer. No platform API lives here, so
// every function is exercised directly by the unit suites.

import { DESKTOP_QUICK_OPEN_SCORES } from '../constants'
import {
  DEFAULT_WORKBENCH_LAYOUT,
  workbenchLayoutSchema,
  type DesktopStatusItem,
  type LayoutKey,
  type TerminalPlacement,
  type WorkbenchLayout,
} from './bridge'

// Normalises a workspace root so one window serves one workspace on every
// platform: forward slashes, no trailing slash, case-folded where the
// filesystem is (Windows and macOS default volumes).
export function workspaceKey(root: string, platform: string): string {
  const slashed = root.replaceAll('\\', '/').replace(/\/+$/, '')
  const cleaned = slashed === '' ? '/' : slashed
  return platform === 'win32' || platform === 'darwin' ? cleaned.toLowerCase() : cleaned
}

export function layoutStorageKey(key: LayoutKey, platform: string): string {
  const base = workspaceKey(key.workspaceRoot, platform)
  return key.compositorWorkspace === undefined ? base : `${base}::${key.compositorWorkspace}`
}

// Parses a stored layout; a corrupt or older record is refused by name so
// the caller can say so instead of silently keeping a broken layout.
export function parseStoredLayout(raw: unknown): WorkbenchLayout {
  return workbenchLayoutSchema.parse(raw)
}

export function isStoredLayout(raw: unknown): raw is WorkbenchLayout {
  return workbenchLayoutSchema.safeParse(raw).success
}

// The panel's placement moves (D91.13): collapse docks into the footer,
// detach floats, hide keeps the sessions alive.
export type TerminalMove = 'collapse' | 'expand' | 'detach' | 'dock' | 'hide' | 'show'

export function moveTerminal(layout: WorkbenchLayout, move: TerminalMove): WorkbenchLayout {
  switch (move) {
    case 'collapse': {
      return { ...layout, terminalPlacement: 'footer', activeFooterTab: 'terminal' }
    }
    case 'expand': {
      return { ...layout, terminalPlacement: 'docked' }
    }
    case 'detach': {
      return { ...layout, terminalPlacement: 'floating' }
    }
    case 'dock': {
      return { ...layout, terminalPlacement: 'docked' }
    }
    case 'hide': {
      return { ...layout, terminalPlacement: 'hidden' }
    }
    case 'show': {
      return layout.terminalPlacement === 'hidden'
        ? { ...layout, terminalPlacement: 'docked' }
        : layout
    }
  }
}

// Whether the panel body renders at this placement (footer shows only its
// tab; hidden keeps the sessions without a surface).
export function isTerminalPanelVisible(placement: TerminalPlacement): boolean {
  return ['docked', 'floating'].includes(placement)
}

export interface TerminalTab {
  readonly id: string
  readonly title: string
}

export function nextTerminalAfterClose(
  tabs: readonly TerminalTab[],
  closedId: string,
  activeId: string | undefined,
): { tabs: readonly TerminalTab[]; activeId: string | undefined } {
  const remaining = tabs.filter((tab) => tab.id !== closedId)
  if (activeId !== closedId) return { tabs: remaining, activeId }
  const closedIndex = tabs.findIndex((tab) => tab.id === closedId)
  const next = remaining[Math.min(closedIndex, remaining.length - 1)]
  return { tabs: remaining, activeId: next?.id }
}

// Orders status items for SH1's bar: side first, then ascending priority,
// then id, so every publisher renders the same bar.
export function orderStatusItems(items: readonly DesktopStatusItem[]): DesktopStatusItem[] {
  return items.toSorted((a, b) => {
    if (a.side !== b.side) return a.side === 'left' ? -1 : 1
    if (a.priority !== b.priority) return a.priority - b.priority
    return (a.id < b.id ? -1 : 1) * (a.id === b.id ? 0 : 1)
  })
}

// Fuzzy quick-open ranking: exact name, then name prefix, then ordered
// subsequence over the whole path. Returns a score, or -1 for no match.
export function quickOpenScore(query: string, candidatePath: string): number {
  const needle = query.trim().toLowerCase()
  if (needle === '') return 0
  const haystack = candidatePath.replaceAll('\\', '/').toLowerCase()
  const name = haystack.slice(haystack.lastIndexOf('/') + 1)
  if (name === needle) return DESKTOP_QUICK_OPEN_SCORES.exactName
  if (name.startsWith(needle)) return DESKTOP_QUICK_OPEN_SCORES.namePrefix - name.length
  if (name.includes(needle)) return DESKTOP_QUICK_OPEN_SCORES.nameContains - name.length
  let at = 0
  let gaps = 0
  for (const char of needle) {
    const found = haystack.indexOf(char, at)
    if (found === -1) return -1
    gaps += found - at
    at = found + 1
  }
  return Math.max(1, DESKTOP_QUICK_OPEN_SCORES.subsequenceBase - gaps - haystack.length)
}

export function rankQuickOpen<T extends { readonly path: string }>(
  query: string,
  entries: readonly T[],
): T[] {
  return entries
    .map((entry) => ({ entry, score: quickOpenScore(query, entry.path) }))
    .filter((scored) => scored.score >= 0)
    .toSorted((a, b) => b.score - a.score || (a.entry.path < b.entry.path ? -1 : 1))
    .map((scored) => scored.entry)
}

// The Electron permission policy (D91.12): the workbench needs no device
// permission. Clipboard writes of sanitised text are the one grant; every
// other request is denied and named to the caller.
export const ALLOWED_DESKTOP_PERMISSIONS = ['clipboard-sanitized-write'] as const

export function isDesktopPermissionGranted(permission: string): boolean {
  return (ALLOWED_DESKTOP_PERMISSIONS as readonly string[]).includes(permission)
}

// Only these schemes may leave the app in the person's browser.
export function isExternalUrlAllowed(url: string): boolean {
  return URL.canParse(url) && ['https:', 'http:', 'mailto:'].includes(new URL(url).protocol)
}

// Default layout for a workspace that has none stored yet.
export function freshLayout(): WorkbenchLayout {
  return { ...DEFAULT_WORKBENCH_LAYOUT, openFiles: [] }
}
