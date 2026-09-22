import { describe, expect, it } from 'vitest'
import { parseHostToWebviewMessage, parseWebviewToHostMessage } from '../../src/shared/protocol'

describe('parseWebviewToHostMessage', () => {
  it('accepts a ready message', () => {
    expect(parseWebviewToHostMessage({ type: 'ready' })).toEqual({
      ok: true,
      message: { type: 'ready' },
    })
  })

  it.each([
    ['unknown type', { type: 'launch-missiles' }],
    ['missing type', {}],
    ['non-object', 'ready'],
    ['null', null],
  ])('rejects %s', (_label, input) => {
    const result = parseWebviewToHostMessage(input)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0)
    }
  })
})

describe('parseHostToWebviewMessage', () => {
  const init = {
    type: 'init',
    extensionVersion: '1.0.0',
    emptyStateHint: 'hint',
    composerPlaceholder: 'placeholder',
  }

  it('accepts a complete init message', () => {
    expect(parseHostToWebviewMessage(init)).toEqual({ ok: true, message: init })
  })

  it('rejects an init message with a missing field', () => {
    const { composerPlaceholder: _dropped, ...incomplete } = init
    expect(parseHostToWebviewMessage(incomplete).ok).toBe(false)
  })

  it('rejects an init message with a wrong field type', () => {
    expect(parseHostToWebviewMessage({ ...init, extensionVersion: 1 }).ok).toBe(false)
  })
})
