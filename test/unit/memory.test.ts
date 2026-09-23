import { describe, expect, it } from 'vitest'
import { loadMemoryIndex } from '../../src/core/context/memory'
import { MEMORY_INDEX_MAX_BYTES, MEMORY_INDEX_MAX_LINES } from '../../src/shared/constants'
import { loaderDeps } from './helpers/fakeToolIo'

const ROOT = '/ws'

const deps = (files: Record<string, string>, platform?: NodeJS.Platform) =>
  loaderDeps(files, ROOT, platform)

describe('loadMemoryIndex', () => {
  it('returns the index when the workspace keeps one, and nothing otherwise', async () => {
    await expect(loadMemoryIndex(deps({}))).resolves.toBeUndefined()
    await expect(
      loadMemoryIndex(
        deps({ '.agents/memory/MEMORY.md': '- [Build](build.md) | npm run build\n' }),
      ),
    ).resolves.toEqual({
      path: '.agents/memory/MEMORY.md',
      text: '- [Build](build.md) | npm run build',
      warning: undefined,
    })
  })

  it("cuts an index over the line limit with Muse Code's marker and a warning", async () => {
    const lines = Array.from(
      { length: MEMORY_INDEX_MAX_LINES + 5 },
      (_, i) => `- [n${String(i)}](n.md) | h`,
    )
    const index = await loadMemoryIndex(deps({ '.agents/memory/MEMORY.md': lines.join('\n') }))
    expect(index?.text.split('\n')).toHaveLength(MEMORY_INDEX_MAX_LINES + 1)
    expect(index?.text.endsWith('\n[MEMORY.md truncated]')).toBe(true)
    expect(index?.warning).toBe(
      `.agents/memory/MEMORY.md: ${String(MEMORY_INDEX_MAX_LINES + 5)} lines exceeds the ${String(MEMORY_INDEX_MAX_LINES)} line index limit; it is truncated for this session`,
    )
  })

  it('cuts an index over the byte limit', async () => {
    const text = `- ${'x'.repeat(MEMORY_INDEX_MAX_BYTES)}\n`
    const index = await loadMemoryIndex(deps({ '.agents/memory/MEMORY.md': text }, 'win32'))
    expect(Buffer.byteLength(index?.text ?? '')).toBeLessThanOrEqual(
      MEMORY_INDEX_MAX_BYTES + '\n[MEMORY.md truncated]'.length,
    )
    expect(index?.warning).toMatch(/bytes exceeds the \d+ byte index limit/)
  })
})
