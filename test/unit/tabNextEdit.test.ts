import { describe, expect, it } from 'vitest'
import {
  isNextEditStable,
  toNextEditItems,
  type NextEditCandidate,
} from '../../src/host/tab/nextEdit'

// Next edit suggestions (M94b, PLAN.md D73): built ready behind the
// `inlineCompletionsAdditions` proposal, switched on only when a stable
// `vscode.d.ts` carries it. No stable release does yet (verified through
// @types/vscode 1.140.0 on 2026-10-22), so the shipped switch stays off
// on every host, and nothing proposal-shaped ever leaves the provider.
describe('next edit suggestions (M94b)', () => {
  const candidate: NextEditCandidate = {
    insertText: 'const total = items.length;\n',
    range: {
      start: { line: 12, character: 0 },
      end: { line: 12, character: 0 },
    },
    showRange: {
      start: { line: 4, character: 0 },
      end: { line: 6, character: 20 },
    },
  }

  it('stays off on the engine floor, this stable and the latest verified stable', () => {
    for (const hostVersion of ['1.99.0', '1.139.0', '1.140.0']) {
      expect(isNextEditStable(hostVersion)).toBe(false)
      expect(toNextEditItems([candidate], hostVersion)).toEqual([])
    }
  })

  it('fails closed on versions it cannot parse', () => {
    for (const hostVersion of ['', 'vscode', '1.x.0', '1.200.beta']) {
      expect(isNextEditStable(hostVersion, '1.200.0')).toBe(false)
    }
    expect(isNextEditStable('1.200.0', 'not-a-version')).toBe(false)
  })

  it('switches on exactly at the first stable release that carries the API', () => {
    expect(isNextEditStable('1.199.9', '1.200.0')).toBe(false)
    expect(isNextEditStable('1.200.0', '1.200.0')).toBe(true)
    expect(isNextEditStable('1.201.0', '1.200.0')).toBe(true)
    expect(isNextEditStable('2.0.0', '1.200.0')).toBe(true)
    // An insider build of that release predates its stable API.
    expect(isNextEditStable('1.200.0-insider', '1.200.0')).toBe(false)
  })

  it('emits the proposal-shaped items once the API is stable', () => {
    expect(toNextEditItems([candidate], '1.200.0', '1.200.0')).toEqual([
      {
        insertText: 'const total = items.length;\n',
        range: {
          start: { line: 12, character: 0 },
          end: { line: 12, character: 0 },
        },
        isInlineEdit: true,
        showRange: {
          start: { line: 4, character: 0 },
          end: { line: 6, character: 20 },
        },
      },
    ])
    expect(toNextEditItems([], '1.200.0', '1.200.0')).toEqual([])
  })
})
