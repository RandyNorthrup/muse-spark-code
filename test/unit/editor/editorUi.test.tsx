/** @vitest-environment jsdom */
/** @vitest-environment-options {"pretendToBeVisual": true} */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { EditorView } from '@codemirror/view'
import { UI_TEXT } from '../../../src/shared/constants'
import { fill } from '../../../src/shared/l10n/text'
import { installCodeMirrorDom } from '../helpers/codemirrorDom'
import { Editor, EditorDiff } from '../../../src/webview/editor/Editor'
import { EditorGroup, type EditorBuffer } from '../../../src/webview/editor/EditorGroup'
import {
  emptyEditorGroupState,
  openFileTab,
  openPreviewTab,
  setTabPinned,
  type EditorGroupState,
} from '../../../src/webview/editor/groupState'

installCodeMirrorDom()

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function buffer(text: string): EditorBuffer {
  return { text, savedText: text, revision: 0 }
}

interface Harness {
  readonly changes: [string, string][]
  readonly refused: string[]
  readonly breadcrumbs: string[]
  readonly viewports: { deviceId: string; widthPx: number; heightPx: number }[]
  readonly group: () => EditorGroupState
}

function mountGroup(
  initial: EditorGroupState,
  buffers: Readonly<Record<string, EditorBuffer>>,
): Harness {
  const harness: Harness = {
    changes: [],
    refused: [],
    breadcrumbs: [],
    viewports: [],
    group: () => current,
  }
  let current = initial
  function Host() {
    const [state, setState] = useState(initial)
    const [liveBuffers, setLiveBuffers] = useState<Readonly<Record<string, EditorBuffer>>>(buffers)
    current = state
    return (
      <EditorGroup
        state={state}
        onStateChange={setState}
        buffers={liveBuffers}
        onBufferChange={(path, text) => {
          harness.changes.push([path, text])
          setLiveBuffers((previous) => {
            const existing = previous[path]
            return existing === undefined
              ? previous
              : { ...previous, [path]: { ...existing, text } }
          })
        }}
        canClose={(tab) => {
          const path = tab.id.startsWith('file:') ? tab.id.slice('file:'.length) : undefined
          const open = path === undefined ? undefined : liveBuffers[path]
          return open === undefined || open.text === open.savedText
        }}
        onCloseRefused={(tab) => {
          harness.refused.push(tab.id)
        }}
        onBreadcrumb={(path) => {
          harness.breadcrumbs.push(path)
        }}
        renderPreview={(tab, viewport) => (
          <p>{`preview body ${tab.title} ${String(viewport.widthPx)}x${String(viewport.heightPx)}`}</p>
        )}
        onPreviewViewport={(_tab, viewport) => {
          harness.viewports.push(viewport)
        }}
      />
    )
  }
  const rendered = render(<Host />)
  cleanups.push(() => {
    rendered.unmount()
  })
  return harness
}

function editorView(container: HTMLElement): EditorView {
  const textbox = container.querySelector('.cm-content')
  if (textbox === null) throw new Error('the editor content is missing')
  const view = EditorView.findFromDOM(textbox as HTMLElement)
  if (view === null) throw new Error('the editor view is missing')
  return view
}

function typeIn(container: HTMLElement, text: string): void {
  const view = editorView(container)
  act(() => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
  })
}

describe('M111 ED editor group over real CodeMirror (D91.14)', () => {
  it('renders pinned, preview and kept tabs with breadcrumbs that navigate', async () => {
    let state = emptyEditorGroupState()
    state = openFileTab(state, 'src/app/main.ts', { ephemeral: false })
    state = setTabPinned(state, 'file:src/app/main.ts', true)
    state = openFileTab(state, 'src/app/util.ts', { ephemeral: true })
    const harness = mountGroup(state, {
      'src/app/main.ts': buffer('const main = 1\n'),
      'src/app/util.ts': buffer('export const util = 2\n'),
    })
    expect(
      screen.getByRole('tab', {
        name: fill(UI_TEXT.editorGroup.tabPinned, { title: 'main.ts' }),
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('tab', {
        name: fill(UI_TEXT.editorGroup.tabPreview, { title: 'util.ts' }),
      }),
    ).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'src' }))
    expect(harness.breadcrumbs).toEqual(['src'])
    fireEvent.click(screen.getByRole('button', { name: 'app' }))
    expect(harness.breadcrumbs).toEqual(['src', 'src/app'])
    expect(screen.getByText('util.ts', { selector: '[aria-current="page"]' })).toBeInTheDocument()
    await waitFor(() => {
      expect(document.querySelector('.cm-content')?.textContent).toContain('util')
    })
  })

  it('keeps a preview tab once edited and reports the change', async () => {
    const state = openFileTab(emptyEditorGroupState(), 'notes.txt', { ephemeral: true })
    const harness = mountGroup(state, { 'notes.txt': buffer('hello\n') })
    const container = document.body
    await waitFor(() => {
      expect(container.querySelector('.cm-content')?.textContent).toContain('hello')
    })
    typeIn(container, 'hello world\n')
    expect(harness.changes).toContainEqual(['notes.txt', 'hello world\n'])
    await waitFor(() => {
      expect(
        screen.getByRole('tab', {
          name: fill(UI_TEXT.editorGroup.tabUnsaved, { title: 'notes.txt' }),
        }),
      ).toBeInTheDocument()
    })
    expect(harness.group().panes[0]?.tabs[0]?.ephemeral).toBe(false)
  })

  it('finds and replaces through the real search panel in the display language', async () => {
    const state = openFileTab(emptyEditorGroupState(), 'doc.txt', { ephemeral: false })
    const harness = mountGroup(state, { 'doc.txt': buffer('one two one\n') })
    await waitFor(() => {
      expect(document.querySelector('.cm-content')?.textContent).toContain('one two one')
    })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.editorGroup.findLabel }))
    const searchInput = document.querySelector<HTMLInputElement>('.cm-panel input[name="search"]')
    const replaceInput = document.querySelector<HTMLInputElement>('.cm-panel input[name="replace"]')
    if (searchInput === null || replaceInput === null) {
      throw new Error('the search panel did not open')
    }
    expect(searchInput.placeholder).toBe(UI_TEXT.editorGroup.findLabel)
    fireEvent.change(searchInput, { target: { value: 'one' } })
    fireEvent.change(replaceInput, { target: { value: '1' } })
    const replaceAll = document.querySelector<HTMLButtonElement>(
      '.cm-panel button[name="replaceAll"]',
    )
    if (replaceAll === null) throw new Error('the replace-all button is missing')
    expect(replaceAll.textContent).toBe(UI_TEXT.editorGroup.replaceAll)
    fireEvent.click(replaceAll)
    await waitFor(() => {
      expect(editorView(document.body).state.doc.toString()).toBe('1 two 1\n')
    })
    expect(harness.changes.at(-1)).toEqual(['doc.txt', '1 two 1\n'])
  })

  it('loads the TypeScript language pack and shows line and column', async () => {
    const state = openFileTab(emptyEditorGroupState(), 'src/code.ts', { ephemeral: false })
    mountGroup(state, { 'src/code.ts': buffer('const value: number = 42\n') })
    await waitFor(() => {
      const spans = [...document.querySelectorAll('.cm-content span')]
      expect(spans.some((span) => span.textContent === 'const')).toBe(true)
    })
    expect(
      screen.getByText(fill(UI_TEXT.editorGroup.lineColumn, { line: 1, column: 1 })),
    ).toBeInTheDocument()
    const select = screen.getByLabelText<HTMLSelectElement>(
      new RegExp(UI_TEXT.editorGroup.language, 'u'),
      { selector: 'select' },
    )
    expect(select.value).toBe('typescript')
  })

  it('shows the minimap and removes it from the status toggle', async () => {
    const state = openFileTab(emptyEditorGroupState(), 'long.txt', { ephemeral: false })
    mountGroup(state, {
      'long.txt': buffer(
        Array.from({ length: 40 }, (_unused, index) => `line ${String(index)}`).join('\n'),
      ),
    })
    await waitFor(() => {
      expect(document.querySelector('.ms-editor-minimap-canvas')).not.toBeNull()
    })
    expect(document.querySelector('.ms-editor-minimap-viewport')).not.toBeNull()
    const toggle = screen.getByRole('button', { name: UI_TEXT.editorGroup.minimap })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(toggle)
    await waitFor(() => {
      expect(document.querySelector('.ms-editor-minimap')).toBeNull()
    })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('splits the active tab into a second group with its own editor', async () => {
    let state = emptyEditorGroupState()
    state = openFileTab(state, 'a.txt', { ephemeral: false })
    state = openFileTab(state, 'b.txt', { ephemeral: false })
    mountGroup(state, { 'a.txt': buffer('aaa\n'), 'b.txt': buffer('bbb\n') })
    await waitFor(() => {
      expect(document.querySelector('.cm-content')?.textContent).toContain('bbb')
    })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.editorGroup.splitRight }))
    await waitFor(() => {
      expect(screen.getAllByRole('tablist')).toHaveLength(2)
    })
    expect(
      screen.getByRole('tablist', {
        name: fill(UI_TEXT.editorGroup.tabsInGroup, { group: 2 }),
      }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(document.querySelectorAll('.cm-content')).toHaveLength(2)
    })
  })

  it('refuses to close a dirty tab and says so through the host', async () => {
    const state = openFileTab(emptyEditorGroupState(), 'dirty.txt', { ephemeral: false })
    const harness = mountGroup(state, { 'dirty.txt': buffer('keep me\n') })
    await waitFor(() => {
      expect(document.querySelector('.cm-content')?.textContent).toContain('keep me')
    })
    typeIn(document.body, 'changed\n')
    const tab = await screen.findByRole('tab', {
      name: fill(UI_TEXT.editorGroup.tabUnsaved, { title: 'dirty.txt' }),
    })
    fireEvent(tab, new MouseEvent('auxclick', { button: 1, bubbles: true }))
    expect(harness.refused).toEqual(['file:dirty.txt'])
    expect(
      screen.getByRole('tab', {
        name: fill(UI_TEXT.editorGroup.tabUnsaved, { title: 'dirty.txt' }),
      }),
    ).toBeInTheDocument()
  })

  it('hosts a browser preview tab in the group’s preview slot with device sizes', async () => {
    let state = openFileTab(emptyEditorGroupState(), 'index.html', { ephemeral: false })
    state = openPreviewTab(state, 'http://localhost:5173', 'Preview · localhost:5173')
    const harness = mountGroup(state, { 'index.html': buffer('<p>hi</p>\n') })
    expect(await screen.findByText(/preview body/u)).toHaveTextContent('1920x1080')
    const select = screen.getByLabelText<HTMLSelectElement>(
      new RegExp(UI_TEXT.editorGroup.previewSize, 'u'),
      { selector: 'select' },
    )
    fireEvent.change(select, { target: { value: 'phone' } })
    expect(harness.viewports).toEqual([{ deviceId: 'phone', widthPx: 390, heightPx: 844 }])
    expect(await screen.findByText(/preview body/u)).toHaveTextContent('390x844')
    const frame = document.querySelector<HTMLElement>('.ms-editor-preview-frame')
    expect(frame?.style.width).toBe('390px')
  })

  it('closes a clean tab from its close button and moves between tabs by keyboard', async () => {
    let state = emptyEditorGroupState()
    state = openFileTab(state, 'one.txt', { ephemeral: false })
    state = openFileTab(state, 'two.txt', { ephemeral: false })
    mountGroup(state, { 'one.txt': buffer('one\n'), 'two.txt': buffer('two\n') })
    await waitFor(() => {
      expect(document.querySelector('.cm-content')?.textContent).toContain('two')
    })
    const two = screen.getByRole('tab', { name: 'two.txt' })
    two.focus()
    fireEvent.keyDown(two, { key: 'ArrowLeft' })
    await waitFor(() => {
      expect(document.querySelector('.cm-content')?.textContent).toContain('one')
    })
    expect(screen.getByRole('tab', { name: 'one.txt' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(
      screen.getByRole('button', {
        name: fill(UI_TEXT.editorGroup.closeTab, { title: 'two.txt' }),
      }),
    )
    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: 'two.txt' })).toBeNull()
    })
  })

  it('reports a language that cannot load and stays editable as plain text', async () => {
    const failures: string[] = []
    const rendered = render(
      <Editor
        text={'IDENTIFICATION DIVISION.\n'}
        label={UI_TEXT.nodeLabels.editor}
        languageId="cobol"
        minimap={false}
        onChange={() => undefined}
        onCursor={() => undefined}
        onLanguageFailed={(languageId) => {
          failures.push(languageId)
        }}
        handleId="pane-1"
        onHandle={() => undefined}
      />,
    )
    cleanups.push(() => {
      rendered.unmount()
    })
    await waitFor(() => {
      expect(failures).toEqual(['cobol'])
    })
    expect(rendered.container.querySelector('.cm-content')?.textContent).toContain('IDENTIFICATION')
  })

  it('renders a read-only language-highlighted diff', async () => {
    const failures: string[] = []
    const rendered = render(
      <EditorDiff
        original={'const a = 1\n'}
        modified={'const a = 2\n'}
        languageId="typescript"
        onLanguageFailed={(languageId) => {
          failures.push(languageId)
        }}
      />,
    )
    cleanups.push(() => {
      rendered.unmount()
    })
    await waitFor(() => {
      expect(rendered.container.querySelectorAll('.cm-content')).toHaveLength(2)
    })
    const [original, modified] = rendered.container.querySelectorAll('.cm-content')
    expect(original?.getAttribute('contenteditable')).toBe('false')
    expect(original?.textContent).toContain('const a = 1')
    expect(modified?.textContent).toContain('const a = 2')
    expect(failures).toEqual([])
  })
})
