// M88 lane P: Alt+B toggles the highlighted History row's bookmark from the
// search box. It matches on `event.code`, so macOS's Option characters
// (Option+B is `∫`) never change it, and the reference reads `Alt+B`.
import { describe, expect, it } from 'vitest'
import { referenceKeyboardActions, webviewKey } from '../../src/shared/keybindings'

function key(overrides: object = {}) {
  return {
    key: 'b',
    code: 'KeyB',
    shiftKey: false,
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    ...overrides,
  }
}

describe('history bookmark key', () => {
  it('toggles on Alt+B by code', () => {
    expect(webviewKey('history.bookmark', key())).toBe('toggle')
  })

  it('still toggles when macOS turns Option+B into ∫', () => {
    expect(webviewKey('history.bookmark', key({ key: '∫' }))).toBe('toggle')
  })

  it('ignores a plain B and other rows', () => {
    expect(webviewKey('history.bookmark', key({ altKey: false }))).toBeUndefined()
    expect(webviewKey('history.bookmark', key({ code: 'KeyN', key: 'n' }))).toBeUndefined()
    expect(webviewKey('history.archive', key())).toBeUndefined()
  })

  it('reads Alt+B in the reference, beside the unchanged Delete row', () => {
    const rows = referenceKeyboardActions()
    const bookmark = rows.find((row) => row.command === 'history.bookmark')
    expect(bookmark?.key).toBe('Alt+B')
    expect(rows.find((row) => row.command === 'history.archive')?.key).toBe('Delete')
  })
})
