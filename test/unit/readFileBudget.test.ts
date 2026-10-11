import { describe, expect, it } from 'vitest'
import {
  readFileCharacterBudget,
  executeTool,
  type ToolContext,
} from '../../src/core/backends/modelapi/tools'
import { TOOL_OUTPUT_CLIP_MARKER, TOOL_OUTPUT_MAX_CHARS } from '../../src/shared/constants'
import { memoryToolIo } from './helpers/fakeToolIo'

const numbered = (text: string | undefined) => text?.match(/^\d+\|a+$/gm)

describe('read_file model budget (M101 item 13)', () => {
  it('scales down with loaded windows and retains the existing cap for Muse', () => {
    expect(readFileCharacterBudget(8192)).toBe(4096)
    expect(readFileCharacterBudget(32_768)).toBe(16_384)
    expect(readFileCharacterBudget(1_048_576)).toBe(TOOL_OUTPUT_MAX_CHARS)
    for (const window of [undefined, 0, -1, Infinity, NaN, 1.5]) {
      expect(readFileCharacterBudget(window)).toBe(TOOL_OUTPUT_MAX_CHARS)
    }
  })

  it('applies the selected budget to both tool and visible read output', async () => {
    const io = memoryToolIo({ 'large.txt': 'a'.repeat(1000).concat('\n').repeat(100) }, '/ws')
    const base: ToolContext = {
      workspaceRoot: '/ws',
      platform: 'linux',
      io,
      seen: new Map(),
      provisionalSeen: new Map(),
    }
    const args = JSON.stringify({ path: 'large.txt' })
    const small = await executeTool('read_file', args, { ...base, contextTokens: 8192 })
    const muse = await executeTool('read_file', args, { ...base, contextTokens: 1_048_576 })
    const unknown = await executeTool('read_file', args, base)
    const expectedSmall = [1, 2, 3, 4].map((line) => `${String(line)}|${'a'.repeat(1000)}`)
    expect(numbered(small.output)).toEqual(expectedSmall)
    expect(numbered(small.visibleOutput)).toEqual(expectedSmall)
    expect(small.output.length).toBeLessThanOrEqual(4096)
    expect(small.output).toContain('[lines 1-4 of 100; offset=5]')
    expect(small.visibleOutput).toContain('Lines 1–4 of 100; offset=5')
    expect(small.output).not.toContain(TOOL_OUTPUT_CLIP_MARKER)
    const next = await executeTool('read_file', JSON.stringify({ path: 'large.txt', offset: 5 }), {
      ...base,
      contextTokens: 8192,
    })
    expect(numbered(next.output)).toEqual(
      [5, 6, 7, 8].map((line) => `${String(line)}|${'a'.repeat(1000)}`),
    )
    expect(muse.output).toBe(unknown.output)
    expect(numbered(muse.output)).toHaveLength(63)
    expect(muse.output.length).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_CHARS)
    expect(muse.output).toContain('[lines 1-63 of 100; offset=64]')
  })
})
