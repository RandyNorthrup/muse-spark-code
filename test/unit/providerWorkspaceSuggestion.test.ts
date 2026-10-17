// M95 lane K (PLAN.md D74, M95 acceptance 6 and Tests): a workspace
// suggests a preset id at most; a URL-shaped value configures nothing.

import { describe, expect, it } from 'vitest'
import { workspaceSuggestedPreset } from '../../src/host/providers/workspaceSuggestion'

const KNOWN = new Set(['openrouter', 'ollama'])

function isKnownPreset(id: string): boolean {
  return KNOWN.has(id)
}

describe('workspaceSuggestedPreset', () => {
  it('offers a known preset id', () => {
    expect(workspaceSuggestedPreset('openrouter', (id) => KNOWN.has(id))).toBe('openrouter')
    expect(workspaceSuggestedPreset('  ollama  ', (id) => KNOWN.has(id))).toBe('ollama')
  })

  it('ignores an empty, unknown or URL-shaped value', () => {
    expect(workspaceSuggestedPreset('', isKnownPreset)).toBeUndefined()
    expect(workspaceSuggestedPreset(undefined, isKnownPreset)).toBeUndefined()
    expect(workspaceSuggestedPreset('groq', isKnownPreset)).toBeUndefined()
    expect(workspaceSuggestedPreset('https://attacker.example/v1', isKnownPreset)).toBeUndefined()
    expect(workspaceSuggestedPreset('http://127.0.0.1:11434', isKnownPreset)).toBeUndefined()
    expect(workspaceSuggestedPreset('custom:server', isKnownPreset)).toBeUndefined()
    expect(workspaceSuggestedPreset('open router', isKnownPreset)).toBeUndefined()
  })
})
