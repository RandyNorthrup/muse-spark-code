import { describe, expect, it } from 'vitest'
import {
  type EditorContext,
  editorContextSummary,
  editorContextText,
} from '../../src/core/editorContext'
import { SELECTION_TEXT_MAX_CHARS } from '../../src/shared/constants'
import { editorContextLabel } from '../../src/shared/editorContext'

const selection: EditorContext = {
  relativePath: 'src/webview/App.tsx',
  startLine: 5,
  endLine: 10,
  isEmpty: false,
  selectedText: 'const a = 1\nconst b = 2',
}

describe('editorContextLabel', () => {
  it('reads like the Claude Code chip: basename, then the selected lines', () => {
    expect(editorContextLabel(selection)).toBe('App.tsx L5-10')
    expect(editorContextLabel({ ...selection, endLine: 5 })).toBe('App.tsx L5')
    expect(editorContextLabel({ ...selection, isEmpty: true })).toBe('App.tsx')
    expect(editorContextLabel({ ...selection, relativePath: 'PLAN.md', isEmpty: true })).toBe(
      'PLAN.md',
    )
  })
})

describe('editorContextSummary', () => {
  it('drops the selected text', () => {
    expect(editorContextSummary(selection)).toEqual({
      relativePath: 'src/webview/App.tsx',
      startLine: 5,
      endLine: 10,
      isEmpty: false,
    })
  })
})

describe('editorContextText', () => {
  it('wraps a selection in ide_selection with the lines and the text', () => {
    expect(editorContextText(selection)).toBe(
      '<ide_selection>The user selected the lines 5 to 10 from src/webview/App.tsx:\nconst a = 1\nconst b = 2\n</ide_selection>',
    )
  })

  it('names the file only when nothing is selected', () => {
    expect(editorContextText({ ...selection, isEmpty: true })).toBe(
      '<ide_opened_file>The user opened the file src/webview/App.tsx in the IDE. This may or may not be related to the current task.</ide_opened_file>',
    )
  })

  it('shares the path but not the text of an excluded file', () => {
    const text = editorContextText({ ...selection, selectedText: undefined })
    expect(text).toContain('The user selected the lines 5 to 10 from src/webview/App.tsx.')
    expect(text).toContain('not shared')
    expect(text).not.toContain('const a')
  })

  it('clips an oversized selection with a marker', () => {
    const text = editorContextText({
      ...selection,
      selectedText: 'x'.repeat(SELECTION_TEXT_MAX_CHARS + 10),
    })
    expect(text).toContain('[selection clipped]')
    expect(text.length).toBeLessThan(SELECTION_TEXT_MAX_CHARS + 200)
  })
})
