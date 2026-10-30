import { describe, expect, it } from 'vitest'
import {
  breadcrumbsFor,
  closeOtherTabs,
  closeTab,
  closeUnpinnedTabs,
  cycleTab,
  emptyEditorGroupState,
  fileTabId,
  moveTab,
  openFileTab,
  openPreviewTab,
  parseEditorGroupState,
  promoteTab,
  setTabPinned,
  splitTab,
  tabFilePath,
  type EditorGroupState,
} from '../../../src/webview/editor/groupState'
import { languageIdForPath, languageName } from '../../../src/webview/editor/languages'

function titles(state: EditorGroupState, pane = 0): string[] {
  return state.panes[pane]?.tabs.map((tab) => tab.title) ?? []
}

function opened(...paths: string[]): EditorGroupState {
  let state = emptyEditorGroupState()
  for (const path of paths) state = openFileTab(state, path, { ephemeral: false })
  return state
}

describe('M111 ED editor group model (D91.13, D91.14)', () => {
  it('keeps one preview-editor slot per pane and replaces it in place', () => {
    let state = opened('src/package.json')
    state = openFileTab(state, 'src/a.ts', { ephemeral: true })
    expect(titles(state)).toEqual(['package.json', 'a.ts'])
    state = openFileTab(state, 'src/b.ts', { ephemeral: true })
    // The second preview takes the first preview's slot, not a new tab.
    expect(titles(state)).toEqual(['package.json', 'b.ts'])
    expect(state.panes[0]?.tabs[1]?.ephemeral).toBe(true)
  })

  it('promotes the preview tab when it is edited or reopened as kept', () => {
    let state = openFileTab(emptyEditorGroupState(), 'a.ts', { ephemeral: true })
    state = promoteTab(state, fileTabId('a.ts'))
    expect(state.panes[0]?.tabs[0]?.ephemeral).toBe(false)
    state = openFileTab(state, 'b.ts', { ephemeral: true })
    expect(titles(state)).toEqual(['a.ts', 'b.ts'])
    state = openFileTab(state, 'b.ts', { ephemeral: false })
    expect(state.panes[0]?.tabs[1]?.ephemeral).toBe(false)
  })

  it('focuses an already-open file instead of duplicating its tab', () => {
    let state = opened('a.ts', 'b.ts')
    state = openFileTab(state, 'a.ts', { ephemeral: true })
    expect(titles(state)).toEqual(['a.ts', 'b.ts'])
    expect(state.panes[0]?.activeId).toBe(fileTabId('a.ts'))
    // An ephemeral open never demotes a kept tab.
    expect(state.panes[0]?.tabs[0]?.ephemeral).toBe(false)
  })

  it('gives a browser preview tab its own slot beside the file tabs', () => {
    let state = opened('index.html')
    state = openPreviewTab(state, 'http://localhost:5173', 'Preview · localhost:5173')
    expect(titles(state)).toEqual(['index.html', 'Preview · localhost:5173'])
    const preview = state.panes[0]?.tabs[1]
    expect(preview?.kind).toBe('preview')
    expect(preview === undefined ? 'missing' : tabFilePath(preview)).toBeUndefined()
    state = openPreviewTab(state, 'http://localhost:5173', 'Preview · localhost:5173')
    expect(state.panes[0]?.tabs).toHaveLength(2)
  })

  it('keeps pinned tabs leading, and pinning promotes a preview tab', () => {
    let state = opened('a.ts', 'b.ts', 'c.ts')
    state = setTabPinned(state, fileTabId('c.ts'), true)
    expect(titles(state)).toEqual(['c.ts', 'a.ts', 'b.ts'])
    state = setTabPinned(state, fileTabId('b.ts'), true)
    expect(titles(state)).toEqual(['c.ts', 'b.ts', 'a.ts'])
    state = setTabPinned(state, fileTabId('c.ts'), false)
    expect(titles(state)).toEqual(['b.ts', 'c.ts', 'a.ts'])
    let preview = openFileTab(emptyEditorGroupState(), 'x.ts', { ephemeral: true })
    preview = setTabPinned(preview, fileTabId('x.ts'), true)
    expect(preview.panes[0]?.tabs[0]).toMatchObject({ pinned: true, ephemeral: false })
  })

  it('never moves a tab across the pinned boundary', () => {
    let state = opened('a.ts', 'b.ts', 'c.ts')
    state = setTabPinned(state, fileTabId('a.ts'), true)
    state = moveTab(state, fileTabId('c.ts'), 0)
    expect(titles(state)).toEqual(['a.ts', 'c.ts', 'b.ts'])
    state = moveTab(state, fileTabId('a.ts'), 2)
    expect(titles(state)).toEqual(['a.ts', 'c.ts', 'b.ts'])
  })

  it('activates the neighbour when the active tab closes', () => {
    let state = opened('a.ts', 'b.ts', 'c.ts')
    state = closeTab(state, fileTabId('c.ts'))
    expect(state.panes[0]?.activeId).toBe(fileTabId('b.ts'))
    state = closeTab(state, fileTabId('a.ts'))
    expect(state.panes[0]?.activeId).toBe(fileTabId('b.ts'))
    state = closeTab(state, fileTabId('b.ts'))
    expect(state.panes[0]?.activeId).toBeNull()
    expect(state.panes).toHaveLength(1)
  })

  it('closes other unpinned tabs but keeps the pinned ones', () => {
    let state = opened('a.ts', 'b.ts', 'c.ts', 'd.ts')
    state = setTabPinned(state, fileTabId('a.ts'), true)
    state = closeOtherTabs(state, fileTabId('c.ts'))
    expect(titles(state)).toEqual(['a.ts', 'c.ts'])
    state = closeUnpinnedTabs(state, state.panes[0]?.id ?? '')
    expect(titles(state)).toEqual(['a.ts'])
  })

  it('splits a tab into its own pane, right or down, and merges back on close', () => {
    let state = opened('a.ts', 'b.ts')
    state = splitTab(state, fileTabId('b.ts'), 'right')
    expect(state.panes).toHaveLength(2)
    expect(state.split).toBe('right')
    expect(titles(state, 0)).toEqual(['a.ts'])
    expect(titles(state, 1)).toEqual(['b.ts'])
    expect(state.activePaneId).toBe(state.panes[1]?.id)
    state = closeTab(state, fileTabId('b.ts'))
    expect(state.panes).toHaveLength(1)
    expect(titles(state)).toEqual(['a.ts'])
  })

  it('does not split the only tab of the only pane into an identical pane', () => {
    const state = opened('a.ts')
    expect(splitTab(state, fileTabId('a.ts'), 'down')).toBe(state)
  })

  it('opens a previewed file in each pane independently after a split', () => {
    let state = opened('a.ts', 'b.ts')
    state = splitTab(state, fileTabId('b.ts'), 'down')
    state = openFileTab(state, 'c.ts', { ephemeral: true })
    expect(titles(state, 1)).toEqual(['b.ts', 'c.ts'])
    state = openFileTab(state, 'd.ts', { ephemeral: true })
    expect(titles(state, 1)).toEqual(['b.ts', 'd.ts'])
    expect(titles(state, 0)).toEqual(['a.ts'])
  })

  it('cycles tabs with wraparound', () => {
    let state = opened('a.ts', 'b.ts', 'c.ts')
    state = cycleTab(state, 1)
    expect(state.panes[0]?.activeId).toBe(fileTabId('a.ts'))
    state = cycleTab(state, -1)
    expect(state.panes[0]?.activeId).toBe(fileTabId('c.ts'))
  })

  it('builds breadcrumbs from either separator', () => {
    expect(breadcrumbsFor('src/webview/App.tsx')).toEqual([
      { label: 'src', path: 'src' },
      { label: 'webview', path: 'src/webview' },
      { label: 'App.tsx', path: 'src/webview/App.tsx' },
    ])
    expect(breadcrumbsFor(String.raw`src\webview\App.tsx`)).toEqual(
      breadcrumbsFor('src/webview/App.tsx'),
    )
    expect(breadcrumbsFor('/repo/file.ts')).toEqual([
      { label: 'repo', path: '/repo' },
      { label: 'file.ts', path: '/repo/file.ts' },
    ])
  })

  it('round-trips persisted state and refuses corrupt saves', () => {
    const state = splitTab(opened('a.ts', 'b.ts'), fileTabId('b.ts'), 'right')
    expect(parseEditorGroupState(structuredClone(state))).toEqual(state)
    expect(() => parseEditorGroupState({ ...state, activePaneId: 'pane-99' })).toThrow()
    expect(() =>
      parseEditorGroupState({
        ...state,
        panes: state.panes.map((pane, index) =>
          index === 0 ? { ...pane, activeId: 'file:missing.ts' } : pane,
        ),
      }),
    ).toThrow()
    expect(() => parseEditorGroupState({ panes: [] })).toThrow()
  })

  it('resolves languages by name first, then extension, else plain text', () => {
    expect(languageIdForPath('src/App.tsx')).toBe('tsx')
    expect(languageIdForPath(String.raw`src\main.ts`)).toBe('typescript')
    expect(languageIdForPath('script.PY')).toBe('python')
    expect(languageIdForPath('deploy/Dockerfile')).toBe('dockerfile')
    expect(languageIdForPath('native/CMakeLists.txt')).toBe('cmake')
    expect(languageIdForPath('.gitignore')).toBeNull()
    expect(languageIdForPath('notes.unknownext')).toBeNull()
    expect(languageIdForPath('Makefile')).toBeNull()
    expect(languageName('tsx')).toBe('TSX')
    expect(languageName(null)).toBeUndefined()
  })
})
