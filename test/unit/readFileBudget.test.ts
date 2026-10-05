import { describe, expect, it } from 'vitest'
import {
  readFileCharacterBudget,
  executeTool,
  type ToolContext,
} from '../../src/core/backends/modelapi/tools'
import { TOOL_OUTPUT_CLIP_MARKER, TOOL_OUTPUT_MAX_CHARS } from '../../src/shared/constants'
import { memoryToolIo } from './helpers/fakeToolIo'

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
    const base: ToolContext = { workspaceRoot: '/ws', platform: 'linux', io, seen: new Map() }
    const args = JSON.stringify({ path: 'large.txt' })
    const small = await executeTool('read_file', args, { ...base, contextTokens: 8192 })
    const muse = await executeTool('read_file', args, { ...base, contextTokens: 1_048_576 })
    const unknown = await executeTool('read_file', args, base)
    expect(small.output.length).toBe(4096 + TOOL_OUTPUT_CLIP_MARKER.length)
    expect(small.output).toBe(small.visibleOutput)
    expect(small.output.endsWith(TOOL_OUTPUT_CLIP_MARKER)).toBe(true)
    expect(muse.output).toBe(unknown.output)
    expect(muse.output.length).toBe(TOOL_OUTPUT_MAX_CHARS + TOOL_OUTPUT_CLIP_MARKER.length)
  })
})
