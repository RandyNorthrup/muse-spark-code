// The editor group model (M111 lane ED, D91.13 and D91.14): the tabbed
// centre shared by the node's web UI and Muse Desktop. Pure state and
// pure transitions; rendering is EditorGroup.tsx and file contents live
// with the host surface, keyed by the file tabs' paths.
//
// Two different ideas both called "preview" meet here, as in the approved
// mockups (Workbench.dc.html): an ephemeral file tab (italic, one slot per
// group, replaced by the next previewed file and kept once edited or
// double-clicked, as VS Code's preview editors behave) and a browser
// preview tab (kind 'preview'), whose content the host renders into the
// group's preview slot (D91.23; the desktop puts a browser view there).
// There is no cap on tabs, groups or splits (D121): the model is a list.

import * as z from 'zod/mini'

const nonEmptyString = z.string().check(z.minLength(1))

export const editorTabSchema = z.strictObject({
  /** `file:<path>` or `preview:<key>`; also the tab's identity. */
  id: nonEmptyString,
  kind: z.enum(['file', 'preview']),
  title: nonEmptyString,
  pinned: z.boolean(),
  /** The group's single preview-editor slot (file tabs only). */
  ephemeral: z.boolean(),
})
export type EditorTab = z.infer<typeof editorTabSchema>

export const editorPaneSchema = z.strictObject({
  id: nonEmptyString,
  tabs: z.array(editorTabSchema),
  activeId: z.nullable(nonEmptyString),
})
export type EditorPane = z.infer<typeof editorPaneSchema>

export const editorGroupStateSchema = z.strictObject({
  panes: z.array(editorPaneSchema).check(z.minLength(1)),
  activePaneId: nonEmptyString,
  split: z.enum(['right', 'down']),
  minimap: z.boolean(),
})
export type EditorGroupState = z.infer<typeof editorGroupStateSchema>

const FIRST_PANE_ID = 'pane-1'
const PANE_NUMBER = /^pane-(\d+)$/u

export function emptyEditorGroupState(): EditorGroupState {
  return {
    panes: [{ id: FIRST_PANE_ID, tabs: [], activeId: null }],
    activePaneId: FIRST_PANE_ID,
    split: 'right',
    minimap: true,
  }
}

export function fileTabId(path: string): string {
  return `file:${path}`
}

export function previewTabId(key: string): string {
  return `preview:${key}`
}

export function fileTitle(path: string): string {
  const segments = pathSegments(path)
  return segments.at(-1) ?? path
}

/** Split on either separator (CI runs on Windows); empties dropped. */
export function pathSegments(path: string): string[] {
  return path
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment !== '')
}

export interface Breadcrumb {
  readonly label: string
  /** The cumulative path up to and including this segment, `/`-joined. */
  readonly path: string
}

/** Breadcrumbs for a workspace-relative or absolute file path. */
export function breadcrumbsFor(path: string): Breadcrumb[] {
  const normalized = path.replaceAll('\\', '/')
  const isRooted = normalized.startsWith('/')
  const segments = pathSegments(normalized)
  const crumbs: Breadcrumb[] = []
  let current = isRooted ? '/' : ''
  for (const segment of segments) {
    current = current === '' || current === '/' ? `${current}${segment}` : `${current}/${segment}`
    crumbs.push({ label: segment, path: current })
  }
  return crumbs
}

function activePane(state: EditorGroupState): EditorPane {
  const pane = state.panes.find((candidate) => candidate.id === state.activePaneId)
  if (pane === undefined) throw new Error(`active pane ${state.activePaneId} is missing`)
  return pane
}

function withPane(state: EditorGroupState, pane: EditorPane): EditorGroupState {
  return {
    ...state,
    panes: state.panes.map((candidate) => (candidate.id === pane.id ? pane : candidate)),
  }
}

function findTab(
  state: EditorGroupState,
  tabId: string,
): { pane: EditorPane; tab: EditorTab; index: number } | undefined {
  for (const pane of state.panes) {
    const index = pane.tabs.findIndex((tab) => tab.id === tabId)
    const tab = pane.tabs[index]
    if (index !== -1 && tab !== undefined) return { pane, tab, index }
  }
  return undefined
}

function nextPaneId(state: EditorGroupState): string {
  let highest = 1
  for (const pane of state.panes) {
    const match = PANE_NUMBER.exec(pane.id)
    if (match?.[1] !== undefined) highest = Math.max(highest, Number(match[1]))
  }
  return `pane-${String(highest + 1)}`
}

/** Number of leading pinned tabs; pinned tabs always lead their pane. */
function pinnedCount(pane: EditorPane): number {
  let count = 0
  while (pane.tabs[count]?.pinned === true) count += 1
  return count
}

export function activateTab(
  state: EditorGroupState,
  paneId: string,
  tabId: string,
): EditorGroupState {
  const pane = state.panes.find((candidate) => candidate.id === paneId)
  return pane?.tabs.some((tab) => tab.id === tabId)
    ? { ...withPane(state, { ...pane, activeId: tabId }), activePaneId: paneId }
    : state
}

export function activatePane(state: EditorGroupState, paneId: string): EditorGroupState {
  return state.panes.some((pane) => pane.id === paneId) ? { ...state, activePaneId: paneId } : state
}

function openTab(
  state: EditorGroupState,
  tab: EditorTab,
  options: { readonly ephemeral: boolean },
): EditorGroupState {
  const existing = findTab(state, tab.id)
  if (existing !== undefined) {
    const promoted =
      !options.ephemeral && existing.tab.ephemeral
        ? withPane(state, {
            ...existing.pane,
            tabs: existing.pane.tabs.map((candidate) =>
              candidate.id === tab.id ? { ...candidate, ephemeral: false } : candidate,
            ),
          })
        : state
    return activateTab(promoted, existing.pane.id, tab.id)
  }
  const pane = activePane(state)
  const ephemeralIndex = options.ephemeral
    ? pane.tabs.findIndex((candidate) => candidate.ephemeral)
    : -1
  const tabs =
    ephemeralIndex >= 0
      ? pane.tabs.map((candidate, index) => (index === ephemeralIndex ? tab : candidate))
      : [...pane.tabs, tab]
  return activateTab(withPane(state, { ...pane, tabs }), pane.id, tab.id)
}

/** Open (or focus) a file tab. An ephemeral open takes the pane's one
preview slot, replacing the file previewed there before. */
export function openFileTab(
  state: EditorGroupState,
  path: string,
  options: { readonly ephemeral: boolean },
): EditorGroupState {
  return openTab(
    state,
    {
      id: fileTabId(path),
      kind: 'file',
      title: fileTitle(path),
      pinned: false,
      ephemeral: options.ephemeral,
    },
    options,
  )
}

/** Open (or focus) a browser preview tab in the group's preview slot. */
export function openPreviewTab(
  state: EditorGroupState,
  key: string,
  title: string,
): EditorGroupState {
  return openTab(
    state,
    { id: previewTabId(key), kind: 'preview', title, pinned: false, ephemeral: false },
    { ephemeral: false },
  )
}

/** Keep an ephemeral file tab (it was edited or double-clicked). */
export function promoteTab(state: EditorGroupState, tabId: string): EditorGroupState {
  const found = findTab(state, tabId)
  if (!found?.tab.ephemeral) return state
  return withPane(state, {
    ...found.pane,
    tabs: found.pane.tabs.map((candidate) =>
      candidate.id === tabId ? { ...candidate, ephemeral: false } : candidate,
    ),
  })
}

export function setTabPinned(
  state: EditorGroupState,
  tabId: string,
  isPinned: boolean,
): EditorGroupState {
  const found = findTab(state, tabId)
  if (found === undefined || found.tab.pinned === isPinned) return state
  const moved: EditorTab = {
    ...found.tab,
    pinned: isPinned,
    ephemeral: !isPinned && found.tab.ephemeral,
  }
  const rest = found.pane.tabs.filter((candidate) => candidate.id !== tabId)
  const restPane: EditorPane = { ...found.pane, tabs: rest }
  // Pinning lands at the end of the pinned run; unpinning at its start of
  // the unpinned run — the same index once the tab itself is removed.
  const at = pinnedCount(restPane)
  const tabs = [...rest.slice(0, at), moved, ...rest.slice(at)]
  return withPane(state, { ...found.pane, tabs })
}

function neighborId(pane: EditorPane, closedIndex: number): string | null {
  return pane.tabs[closedIndex]?.id ?? pane.tabs[closedIndex - 1]?.id ?? null
}

export function closeTab(state: EditorGroupState, tabId: string): EditorGroupState {
  const found = findTab(state, tabId)
  if (found === undefined) return state
  const tabs = found.pane.tabs.filter((candidate) => candidate.id !== tabId)
  const pane: EditorPane = {
    ...found.pane,
    tabs,
    activeId:
      found.pane.activeId === tabId
        ? neighborId({ ...found.pane, tabs }, found.index)
        : found.pane.activeId,
  }
  const next = withPane(state, pane)
  if (tabs.length > 0 || next.panes.length === 1) return next
  const panes = next.panes.filter((candidate) => candidate.id !== pane.id)
  const activePaneId =
    next.activePaneId === pane.id ? (panes.at(-1)?.id ?? next.activePaneId) : next.activePaneId
  return { ...next, panes, activePaneId }
}

/** Close every tab in the pane except the named one and the pinned tabs. */
export function closeOtherTabs(state: EditorGroupState, tabId: string): EditorGroupState {
  const found = findTab(state, tabId)
  if (found === undefined) return state
  const tabs = found.pane.tabs.filter((candidate) => candidate.id === tabId || candidate.pinned)
  return activateTab(withPane(state, { ...found.pane, tabs }), found.pane.id, tabId)
}

/** Close every unpinned tab in the pane. */
export function closeUnpinnedTabs(state: EditorGroupState, paneId: string): EditorGroupState {
  const pane = state.panes.find((candidate) => candidate.id === paneId)
  if (pane === undefined) return state
  const tabs = pane.tabs.filter((candidate) => candidate.pinned)
  const activeId = tabs.some((candidate) => candidate.id === pane.activeId)
    ? pane.activeId
    : (tabs.at(-1)?.id ?? null)
  return withPane(state, { ...pane, tabs, activeId })
}

/** Reorder within the pane; a tab never crosses the pinned boundary. */
export function moveTab(state: EditorGroupState, tabId: string, toIndex: number): EditorGroupState {
  const found = findTab(state, tabId)
  if (found === undefined) return state
  const boundary = pinnedCount(found.pane)
  const low = found.tab.pinned ? 0 : boundary
  const high = (found.tab.pinned ? boundary : found.pane.tabs.length) - 1
  const target = Math.min(Math.max(toIndex, low), high)
  if (target === found.index) return state
  const rest = found.pane.tabs.filter((candidate) => candidate.id !== tabId)
  const tabs = [...rest.slice(0, target), found.tab, ...rest.slice(target)]
  return withPane(state, { ...found.pane, tabs })
}

/** Split the tab out into a new pane beside (right) or below (down) its own. */
export function splitTab(
  state: EditorGroupState,
  tabId: string,
  direction: 'right' | 'down',
): EditorGroupState {
  const found = findTab(state, tabId)
  if (found === undefined) return state
  if (state.panes.length === 1 && found.pane.tabs.length === 1) return state
  const moved: EditorTab = { ...found.tab, ephemeral: false }
  const sourceTabs = found.pane.tabs.filter((candidate) => candidate.id !== tabId)
  const source: EditorPane = {
    ...found.pane,
    tabs: sourceTabs,
    activeId:
      found.pane.activeId === tabId
        ? neighborId({ ...found.pane, tabs: sourceTabs }, found.index)
        : found.pane.activeId,
  }
  const fresh: EditorPane = { id: nextPaneId(state), tabs: [moved], activeId: moved.id }
  const panes: EditorPane[] = []
  for (const pane of state.panes) {
    if (pane.id !== found.pane.id) {
      panes.push(pane)
      continue
    }
    if (sourceTabs.length > 0) panes.push(source)
    panes.push(fresh)
  }
  return { ...state, panes, activePaneId: fresh.id, split: direction }
}

export function cycleTab(state: EditorGroupState, step: 1 | -1): EditorGroupState {
  const pane = activePane(state)
  if (pane.tabs.length < 2 || pane.activeId === null) return state
  const index = pane.tabs.findIndex((tab) => tab.id === pane.activeId)
  const next = pane.tabs[(index + step + pane.tabs.length) % pane.tabs.length]
  return next === undefined ? state : activateTab(state, pane.id, next.id)
}

export function setMinimap(state: EditorGroupState, hasMinimap: boolean): EditorGroupState {
  return { ...state, minimap: hasMinimap }
}

/** The file path a tab edits, or undefined for a browser preview tab. */
export function tabFilePath(tab: EditorTab): string | undefined {
  return tab.kind === 'file' ? tab.id.slice('file:'.length) : undefined
}

export function activeTabOf(pane: EditorPane): EditorTab | undefined {
  return pane.tabs.find((tab) => tab.id === pane.activeId)
}

/** Parse persisted group state (a boundary: stored data is untrusted). */
export function parseEditorGroupState(input: unknown): EditorGroupState {
  const state = z.parse(editorGroupStateSchema, input)
  const paneIds = new Set(state.panes.map((pane) => pane.id))
  if (!paneIds.has(state.activePaneId)) {
    throw new Error('the active pane is not one of the saved panes')
  }
  for (const pane of state.panes) {
    if (pane.activeId !== null && pane.tabs.every((tab) => tab.id !== pane.activeId)) {
      throw new Error('a saved pane names an active tab it does not hold')
    }
    if (pane.tabs.filter((tab) => tab.ephemeral).length > 1) {
      throw new Error('a saved pane holds more than one preview tab')
    }
  }
  return state
}
