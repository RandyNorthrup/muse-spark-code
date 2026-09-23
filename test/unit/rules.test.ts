import { describe, expect, it } from 'vitest'
import { loadRuleFile, renderRules, ruleDirectoriesFor } from '../../src/core/context/rules'
import { RULES_CONTEXT_MAX_BYTES, RULES_FILE_MAX_BYTES } from '../../src/shared/constants'
import { loaderDeps, memoryToolIo } from './helpers/fakeToolIo'

const ROOT = '/ws'

const deps = (files: Record<string, string>, platform?: NodeJS.Platform) =>
  loaderDeps(files, ROOT, platform)

describe('ruleDirectoriesFor', () => {
  it('lists the directories between the root and the file, shallowest first', () => {
    expect(ruleDirectoriesFor('src/a/b.ts')).toEqual(['src', 'src/a'])
    expect(ruleDirectoriesFor('README.md')).toEqual([])
    expect(ruleDirectoriesFor('/src//x.ts')).toEqual(['src'])
  })
})

describe('loadRuleFile', () => {
  it('reads AGENTS.md and falls back to CLAUDE.md only where AGENTS.md is absent', async () => {
    const d = deps({
      'AGENTS.md': 'root rules\n',
      'CLAUDE.md': 'shadowed\n',
      'src/CLAUDE.md': 'src rules\n',
    })
    await expect(loadRuleFile(d, '')).resolves.toEqual({
      file: { path: 'AGENTS.md', directory: '', text: 'root rules\n' },
      warning: undefined,
    })
    await expect(loadRuleFile(d, 'src')).resolves.toEqual({
      file: { path: 'src/CLAUDE.md', directory: 'src', text: 'src rules\n' },
      warning: undefined,
    })
    await expect(loadRuleFile(d, 'lib')).resolves.toEqual({ file: undefined, warning: undefined })
  })

  it('joins Windows roots with backslashes', async () => {
    const io = memoryToolIo({ 'AGENTS.md': 'win\n' }, 'C:/ws')
    const load = await loadRuleFile({ io, workspaceRoot: String.raw`C:\ws`, platform: 'win32' }, '')
    expect(load.file?.text).toBe('win\n')
  })

  it("skips a file over the load limit with Muse Code's warning", async () => {
    const big = 'x'.repeat(RULES_FILE_MAX_BYTES + 1)
    const load = await loadRuleFile(deps({ 'AGENTS.md': big }), '')
    expect(load.file).toBeUndefined()
    expect(load.warning).toBe(
      `rules file at AGENTS.md is ${String(RULES_FILE_MAX_BYTES + 1)} bytes, over the ${String(RULES_FILE_MAX_BYTES)} byte load limit; it is skipped for this session; trim it (or split it into smaller files) to load it`,
    )
  })
})

describe('renderRules', () => {
  it('renders one section per file in order and cuts the context at its limit', () => {
    const rendered = renderRules([
      { path: 'AGENTS.md', directory: '', text: 'root\n' },
      { path: 'src/AGENTS.md', directory: 'src', text: 'deeper\n' },
    ])
    expect(rendered).toEqual({
      text: '## Rules from AGENTS.md\n\nroot\n\n## Rules from src/AGENTS.md\n\ndeeper',
      warning: undefined,
    })
    const huge = renderRules([
      { path: 'AGENTS.md', directory: '', text: 'y'.repeat(RULES_CONTEXT_MAX_BYTES) },
    ])
    expect(huge.text.endsWith('\n[rules truncated]')).toBe(true)
    expect(Buffer.byteLength(huge.text)).toBeLessThanOrEqual(
      RULES_CONTEXT_MAX_BYTES + '\n[rules truncated]'.length,
    )
    expect(huge.warning).toMatch(/^rules context produced \d+ bytes, over the \d+ byte limit/)
  })
})
