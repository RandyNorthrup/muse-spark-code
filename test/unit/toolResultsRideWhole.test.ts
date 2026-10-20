// NOLIMITSRUN (PLAN.md D121): no trimming of ours. A tool result reaches
// the model whole; only the person's byte guard or the window share may cut
// it, with a spill the model can page through. Display text (rows, the
// panel) may still clip — it hides nothing from the model.
import { mkdtempSync, realpathSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { browserReportText } from '../../src/core/browser/browserTool'
import type { BrowserCheckReport } from '../../src/core/browser/browserRun'
import { mcpCallOutcome } from '../../src/core/backends/modelapi/mcp/functions'
import { shellOutcome } from '../../src/core/backends/modelapi/tools'
import { canonicalPath } from '../../src/host/canonicalPath'
import { writeFileAtomically } from '../../src/host/fsAtomic'
import { createMemoryIo, systemPath } from '../../src/host/backend/memoryIo'
import { MemoryStore } from '../../src/core/memory/memoryStore'
import { removeFolder } from './helpers/temporaryFolders'

const paths = { root: '' }

beforeAll(() => {
  paths.root = realpathSync(mkdtempSync(path.join(tmpdir(), 'muse-whole-result-')))
})

afterAll(async () => {
  await removeFolder(paths.root)
})

/** A finished check report whose console errors run past every 64 KiB cut of ours. */
function loudReport(): BrowserCheckReport {
  const shown = Array.from(
    { length: 400 },
    (_, index) => `error ${String(index)}: ${'x'.repeat(300)}`,
  )
  return {
    finalUrl: 'http://localhost:3000/',
    consoleErrors: { shown, more: 0 },
    failedRequests: { shown: [], more: 0 },
    blockedRequests: { shown: [], more: 0 },
    screenshot: undefined,
  }
}

function memoryTools() {
  return {
    readFile: async (absolutePath: string) => {
      try {
        return await readFile(absolutePath, 'utf8')
      } catch {
        return undefined
      }
    },
    writeFile: (absolutePath: string, content: string) =>
      writeFileAtomically(absolutePath, content, { sleep: () => Promise.resolve() }),
    realPath: canonicalPath,
    hasUnsavedChanges: () => false,
  }
}

async function noteStore(workspace: string, dataRoot: string) {
  await mkdir(path.join(workspace, '.agents', 'memory', 'notes'), { recursive: true })
  const store = new MemoryStore({
    io: createMemoryIo(memoryTools(), { warn: () => undefined }),
    platform: process.platform,
    dataRoot: () => dataRoot,
    workspaceRoot: workspace,
    systemPath,
    warn: () => undefined,
  })
  return store
}

describe('tool results ride whole to the model (NOLIMITSRUN trim)', () => {
  it('an MCP text past 64 KiB reaches the model whole', () => {
    const text = `${'m'.repeat(100_000)}\nsecond line\n`
    const outcome = mcpCallOutcome({ content: [{ type: 'text', text }] })
    expect(outcome.output).toBe(text)
  })

  it('an MCP error past 64 KiB keeps its error lead and the whole text', () => {
    const text = 'm'.repeat(100_000)
    const outcome = mcpCallOutcome({ content: [{ type: 'text', text }], isError: true })
    expect(outcome.output).toBe(`Error: ${text}`)
  })

  it('a browser check past 64 KiB reads whole to the model', () => {
    const text = browserReportText('http://localhost:3000/', loudReport(), 'marker')
    expect(text.length).toBeGreaterThan(64_000)
    expect(text).toContain('x'.repeat(300))
    expect(text).toContain('error 399:')
  })

  it('a kept-whole shell outcome carries a flood of output with its exit line', () => {
    const flood = `${'o'.repeat(50_000)}\n${'e'.repeat(50_000)}`
    const outcome = shellOutcome(
      { stdout: flood, stderr: '', exitCode: 0, isTimedOut: false, isCancelled: false },
      undefined,
      64_000,
      true,
    )
    expect(outcome.output).toContain(flood)
    expect(outcome.output).toContain('exit code 0')
    // The row keeps the elided text it always showed.
    expect(outcome.visibleOutput.length).toBeLessThan(outcome.output.length)
  })

  it('a memory note window past 64 KiB reads whole, paging only on lines left', async () => {
    const store = await noteStore(path.join(paths.root, 'memory-ws'), path.join(paths.root, 'data'))
    const note = `${'n'.repeat(2000)}\n`.repeat(60)
    expect(note.length).toBeGreaterThan(64_000)
    const placed = await store.locate('project', 'notes/long.md')
    if (!placed.ok) throw new Error(placed.reason)
    const added = await store.add(placed.value, { content: note })
    expect(added.ok).toBe(true)
    const read = await store.read(placed.value, { offset: 1, limit: 60 })
    if (!read.ok) throw new Error(read.reason)
    const value = JSON.parse(read.value) as { content: string; truncated: boolean }
    expect(value.content).toBe(note)
    expect(value.truncated).toBe(false)
  })

  it('a memory note longer than the window still says a later window follows', async () => {
    const store = await noteStore(
      path.join(paths.root, 'memory-ws2'),
      path.join(paths.root, 'data2'),
    )
    const note = 'line\n'.repeat(100)
    const placed = await store.locate('project', 'notes/paged.md')
    if (!placed.ok) throw new Error(placed.reason)
    const addedPaged = await store.add(placed.value, { content: note })
    expect(addedPaged.ok).toBe(true)
    const read = await store.read(placed.value, { offset: 1, limit: 10 })
    if (!read.ok) throw new Error(read.reason)
    const value = JSON.parse(read.value) as { content: string; truncated: boolean }
    expect(value.content).toBe('line\n'.repeat(10))
    expect(value.truncated).toBe(true)
  })
})
