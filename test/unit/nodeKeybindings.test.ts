// The home-node file tree and editor resolve their gestures through the
// shared keyboard registry (no handler owns key literals). These pins keep
// the registry's actions identical to the gestures the views dispatch.
import { describe, expect, it } from 'vitest'
import { webviewKey } from '../../src/shared/keybindings'

function event(key: string, modifiers?: { shift?: boolean; ctrl?: boolean; meta?: boolean }) {
  return {
    key,
    shiftKey: modifiers?.shift ?? false,
    altKey: false,
    ctrlKey: modifiers?.ctrl ?? false,
    metaKey: modifiers?.meta ?? false,
  }
}

describe('node keyboard contexts', () => {
  it('moves, jumps, accepts, expands and collapses the file tree', () => {
    expect(webviewKey('node.tree', event('ArrowDown'))).toBe('next')
    expect(webviewKey('node.tree', event('ArrowUp'))).toBe('previous')
    expect(webviewKey('node.tree', event('Home'))).toBe('first')
    expect(webviewKey('node.tree', event('End'))).toBe('last')
    expect(webviewKey('node.tree', event('Enter'))).toBe('accept')
    expect(webviewKey('node.tree', event(' '))).toBe('accept')
    expect(webviewKey('node.tree', event('ArrowRight'))).toBe('expand')
    expect(webviewKey('node.tree', event('ArrowLeft'))).toBe('collapse')
  })

  it('leaves unmapped tree keys to the browser', () => {
    expect(webviewKey('node.tree', event('Escape'))).toBeUndefined()
    expect(webviewKey('node.tree', event('a'))).toBeUndefined()
    expect(webviewKey('node.tree', event('F2'))).toBeUndefined()
  })

  it('saves the open file on the primary S and nothing else', () => {
    expect(webviewKey('node.editor', event('s', { ctrl: true }))).toBe('save')
    expect(webviewKey('node.editor', event('s', { meta: true }))).toBe('save')
    expect(webviewKey('node.editor', event('s', { ctrl: true, shift: true }))).toBeUndefined()
    expect(webviewKey('node.editor', event('s'))).toBeUndefined()
    expect(webviewKey('node.editor', event('Enter', { ctrl: true }))).toBeUndefined()
  })
})
