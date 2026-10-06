import { describe, expect, it, vi } from 'vitest'
import { runtimeEditorContext } from '../../../src/runtime/features/editorContext'

const selection = (uri: string) => ({
  uri,
  version: 1,
  range: { start: { line: 0, character: 1 }, end: { line: 1, character: 2 } },
  excerpt: 'chosen text',
  truncated: false,
})

describe.each([
  { platform: 'linux', root: '/ws', uri: 'file:///ws/src/file.ts' },
  { platform: 'win32', root: String.raw`C:\ws`, uri: 'file:///C:/ws/src/file.ts' },
] as const)('portable selected text on $platform', ({ platform, root, uri }) => {
  it('uses the actual excerpt and forward-slash paths for an indexed selection', () => {
    const indexed = vi.fn(() => true)
    expect(runtimeEditorContext(selection(uri), root, platform, indexed)).toEqual({
      relativePath: 'src/file.ts',
      startLine: 1,
      endLine: 2,
      isEmpty: false,
      selectedText: 'chosen text',
    })
    expect(indexed).toHaveBeenCalledWith('src/file.ts')
  })

  it('keeps only the path for an excluded or untrusted file and a bare cursor', () => {
    const value = selection(uri)
    expect(runtimeEditorContext(value, root, platform, () => false)?.selectedText).toBeUndefined()
    value.range.end = value.range.start
    expect(runtimeEditorContext(value, root, platform, () => true)?.isEmpty).toBe(true)
    expect(runtimeEditorContext(value, root, platform, () => true)?.selectedText).toBeUndefined()
  })

  it('never shares protected file content, malformed or escaping selections', () => {
    const secret = selection(uri.replace('src/file.ts', '.git/config'))
    expect(runtimeEditorContext(secret, root, platform, () => true)?.selectedText).toBeUndefined()
    expect(
      runtimeEditorContext(selection(uri.replace('/ws/', '/outside/')), root, platform, () => true),
    ).toBeUndefined()
    expect(runtimeEditorContext({ uri }, root, platform, () => true)).toBeUndefined()
    const reversed = selection(uri)
    reversed.range.end = { line: 0, character: 0 }
    expect(runtimeEditorContext(reversed, root, platform, () => true)).toBeUndefined()
  })
})
