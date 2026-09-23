import { describe, expect, it } from 'vitest'
import { loadRuleFile, renderRules, ruleDirectoriesFor } from '../../src/core/context/rules'
import { RULES_CONTEXT_MAX_BYTES, RULES_FILE_MAX_BYTES } from '../../src/shared/constants'
import { encoded, loaderDeps, memoryContextIo } from './helpers/fakeContextIo'

const ROOT = '/ws'

describe('ruleDirectoriesFor', () => {
  it('lists the directories between the root and the file, shallowest first', () => {
    expect(ruleDirectoriesFor('src/a/b.ts')).toEqual(['src', 'src/a'])
    expect(ruleDirectoriesFor('README.md')).toEqual([])
    expect(ruleDirectoriesFor('/src//x.ts')).toEqual(['src'])
  })
})

describe('loadRuleFile', () => {
  it('reads AGENTS.md and falls back to CLAUDE.md only where AGENTS.md is absent', async () => {
    const d = loaderDeps({
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
    const { io } = loaderDeps({ 'AGENTS.md': 'win\n' }, { root: 'C:/ws' })
    const load = await loadRuleFile({ io, workspaceRoot: String.raw`C:\ws`, platform: 'win32' }, '')
    expect(load.file?.text).toBe('win\n')
  })

  it('reads a UTF-16 file by its byte-order mark and drops a UTF-8 one (D27)', async () => {
    const d = loaderDeps({
      'AGENTS.md': encoded.utf16le('Réponds en français.\r\n'),
      'src/AGENTS.md': encoded.utf16be('深い規則\n'),
      'lib/AGENTS.md': encoded.utf8Bom('marked\n'),
    })
    await expect(loadRuleFile(d, '')).resolves.toMatchObject({
      file: { text: 'Réponds en français.\r\n' },
    })
    await expect(loadRuleFile(d, 'src')).resolves.toMatchObject({ file: { text: '深い規則\n' } })
    await expect(loadRuleFile(d, 'lib')).resolves.toMatchObject({ file: { text: 'marked\n' } })
  })

  it('skips a file that is not text, without falling back to CLAUDE.md', async () => {
    const d = loaderDeps({
      'AGENTS.md': encoded.utf16leWithoutBom('garbage\n'),
      'CLAUDE.md': 'not read\n',
      'src/AGENTS.md': encoded.latin1('café\n'),
    })
    await expect(loadRuleFile(d, '')).resolves.toEqual({
      file: undefined,
      warning:
        'rules file at AGENTS.md contains NUL characters (a binary file, or UTF-16 text without a byte-order mark); it is skipped for this session',
    })
    await expect(loadRuleFile(d, 'src')).resolves.toEqual({
      file: undefined,
      warning:
        'rules file at src/AGENTS.md is not valid UTF-8 text; it is skipped for this session',
    })
  })

  it('skips a rules file that leads outside the workspace through a link (D24)', async () => {
    const files = new Map([
      [`${ROOT}/CLAUDE.md`, 'not read\n'],
      ['/home/me/.ssh/id_ed25519', 'PRIVATE KEY\n'],
    ])
    const io = memoryContextIo(files, { [`${ROOT}/AGENTS.md`]: '/home/me/.ssh/id_ed25519' })
    const d = { io, workspaceRoot: ROOT, platform: 'linux' as const }
    await expect(loadRuleFile(d, '')).resolves.toEqual({
      file: undefined,
      warning:
        'rules file at AGENTS.md is refused: path /ws/AGENTS.md leads outside the workspace through a link; it is skipped for this session',
    })
  })

  it("skips a file over the load limit with Muse Code's warning", async () => {
    const big = 'x'.repeat(RULES_FILE_MAX_BYTES + 1)
    const load = await loadRuleFile(loaderDeps({ 'AGENTS.md': big }), '')
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
