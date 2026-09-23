import { describe, expect, it } from 'vitest'
import { loadMemoryIndex } from '../../src/core/context/memory'
import { MEMORY_INDEX_MAX_BYTES, MEMORY_INDEX_MAX_LINES } from '../../src/shared/constants'
import { encoded, loaderDeps, memoryContextIo } from './helpers/fakeContextIo'

const ROOT = '/ws'

describe('loadMemoryIndex', () => {
  it('returns the index when the workspace keeps one, and nothing otherwise', async () => {
    await expect(loadMemoryIndex(loaderDeps({}))).resolves.toBeUndefined()
    await expect(
      loadMemoryIndex(
        loaderDeps({ '.agents/memory/MEMORY.md': '- [Build](build.md) | npm run build\n' }),
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
    const index = await loadMemoryIndex(
      loaderDeps({ '.agents/memory/MEMORY.md': lines.join('\n') }),
    )
    expect(index?.text.split('\n')).toHaveLength(MEMORY_INDEX_MAX_LINES + 1)
    expect(index?.text.endsWith('\n[MEMORY.md truncated]')).toBe(true)
    expect(index?.warning).toBe(
      `.agents/memory/MEMORY.md: ${String(MEMORY_INDEX_MAX_LINES + 5)} lines exceeds the ${String(MEMORY_INDEX_MAX_LINES)} line index limit; it is truncated for this session`,
    )
  })

  it('reads a UTF-16 index and refuses one that is not text or leads outside (D27)', async () => {
    await expect(
      loadMemoryIndex(
        loaderDeps({ '.agents/memory/MEMORY.md': encoded.utf16le('- [Ü](u.md) | ü\n') }),
      ),
    ).resolves.toMatchObject({ text: '- [Ü](u.md) | ü' })
    await expect(
      loadMemoryIndex(
        loaderDeps({ '.agents/memory/MEMORY.md': encoded.utf16leWithoutBom('- x\n') }),
      ),
    ).rejects.toThrow(/^\.agents\/memory\/MEMORY\.md contains NUL characters/)
    const io = memoryContextIo(new Map([['/elsewhere/MEMORY.md', '- secret\n']]), {
      [`${ROOT}/.agents/memory`]: '/elsewhere',
    })
    await expect(loadMemoryIndex({ io, workspaceRoot: ROOT, platform: 'linux' })).rejects.toThrow(
      '.agents/memory/MEMORY.md is refused: path /ws/.agents/memory/MEMORY.md leads outside the workspace through a link',
    )
  })

  it('cuts an index over the byte limit', async () => {
    const text = `- ${'x'.repeat(MEMORY_INDEX_MAX_BYTES)}\n`
    const index = await loadMemoryIndex(
      loaderDeps({ '.agents/memory/MEMORY.md': text }, { platform: 'win32' }),
    )
    expect(Buffer.byteLength(index?.text ?? '')).toBeLessThanOrEqual(
      MEMORY_INDEX_MAX_BYTES + '\n[MEMORY.md truncated]'.length,
    )
    expect(index?.warning).toMatch(/bytes exceeds the \d+ byte index limit/)
  })
})
