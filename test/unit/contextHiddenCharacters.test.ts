// Hidden characters in rules and skills (RLF-SECTEXT, research §6 E):
// a rules file or skill body holding bidirectional controls,
// zero-width spaces/joiners outside emoji sequences, or tag characters
// warns once per file per session through the context warning path,
// names the file and the class, and loads unchanged. A tab, a
// zero-width joiner inside an emoji sequence, and anything else the
// Cc/Cf test would catch warn on nothing. Real files on disk, the real
// host reader, the real session context.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { findHiddenCharacters } from '../../src/core/context/hiddenCharacters'
import { WorkspaceContext } from '../../src/core/context/workspaceContext'
import { fileContextIo } from '../../src/host/backend/contextIo'

const roots: string[] = []
afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true })
  }
})

/** A workspace root holding exactly these files, tracked for cleanup. */
function makeWorkspace(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'muse-hidden-text-'))
  roots.push(root)
  for (const [relative, text] of Object.entries(files)) {
    const file = path.join(root, relative)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, text)
  }
  return root
}

/** The session context over a workspace, collecting its warnings. */
function loadContext(workspaceRoot: string): { context: WorkspaceContext; warnings: string[] } {
  const warnings: string[] = []
  const context = new WorkspaceContext({
    io: fileContextIo,
    workspaceRoot,
    platform: process.platform,
    personalSkillsRoot: undefined,
    personalAgentsRoot: undefined,
    hasAgents: false,
    isWorkspaceTrusted: () => true,
    loadMemory: undefined,
    warn: (message) => {
      warnings.push(message)
    },
  })
  return { context, warnings }
}

function skillFile(body: string): string {
  return `---\nname: probe\ndescription: A probe skill.\n---\n\n${body}\n`
}

describe('findHiddenCharacters: only the three warned classes', () => {
  it('names the first hit scanning left to right', () => {
    expect(findHiddenCharacters('plain')).toBeUndefined()
    expect(findHiddenCharacters('a\u{202E}b')).toBe('bidi')
    expect(findHiddenCharacters('a\u{200B}b')).toBe('zeroWidth')
    expect(findHiddenCharacters('a\u{200D}b')).toBe('zeroWidth')
    expect(findHiddenCharacters('a\u{FEFF}b')).toBe('zeroWidth')
    expect(findHiddenCharacters('tag \u{E0041} here')).toBe('tag')
    expect(findHiddenCharacters('\u{202E} then \u{E0041}')).toBe('bidi')
    expect(findHiddenCharacters('\u{E0041} then \u{202E}')).toBe('tag')
  })

  it('tolerates a tab, a line break, and a joiner inside an emoji sequence', () => {
    expect(findHiddenCharacters('with\ttab and\nnewline')).toBeUndefined()
    expect(
      findHiddenCharacters('\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467} family'),
    ).toBeUndefined()
    expect(findHiddenCharacters('\u{1F44D}\u{1F3FD} ok')).toBeUndefined()
  })

  it('stays silent on anything else the Cc/Cf test would catch', () => {
    expect(findHiddenCharacters('soft\u{AD}hyphen')).toBeUndefined()
    expect(findHiddenCharacters('esc\u{1B}x')).toBeUndefined()
    expect(findHiddenCharacters('del\u{7F}x')).toBeUndefined()
  })
})

describe('WorkspaceContext: a rules file with hidden characters warns and loads unchanged', () => {
  it('names a bidirectional control in AGENTS.md, once, and keeps the text', async () => {
    const root = makeWorkspace({ 'AGENTS.md': '# Rules\n\nAlways greet \u{202E}the user.\n' })
    const { context, warnings } = loadContext(root)
    await context.load()
    await context.load()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('AGENTS.md')
    expect(warnings[0]).toContain('bidirectional controls')
    expect(warnings[0]).toContain('loaded unchanged')
    expect(context.sections().rules).toContain('greet \u{202E}the user')
  })

  it('names a zero-width space and a lone joiner', async () => {
    const root = makeWorkspace({ 'AGENTS.md': 'a\u{200B}b\n' })
    const { context, warnings } = loadContext(root)
    await context.load()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('zero-width spaces and joiners')
    expect(context.sections().rules).toContain('a\u{200B}b')

    const lone = makeWorkspace({ 'AGENTS.md': 'a\u{200D}b\n' })
    const second = loadContext(lone)
    await second.context.load()
    expect(second.warnings).toHaveLength(1)
    expect(second.warnings[0]).toContain('zero-width spaces and joiners')
  })

  it('names a tag character in a subdirectory rules file', async () => {
    const root = makeWorkspace({
      'AGENTS.md': '# Root rules.\n',
      'sub/CLAUDE.md': '# Sub rules \u{E0041}.\n',
    })
    const { context, warnings } = loadContext(root)
    await context.load()
    expect(warnings).toHaveLength(0)
    await context.touch(path.join('sub', 'file.ts'))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(path.join('sub', 'CLAUDE.md').replaceAll(path.sep, '/'))
    expect(warnings[0]).toContain('tag characters')
    expect(context.sections().rules).toContain('Sub rules \u{E0041}.')
  })

  it('warns on nothing for tabs and an emoji joiner sequence', async () => {
    const root = makeWorkspace({
      'AGENTS.md':
        '# Rules\n\n\tUse tabs.\n\n\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467} counts as one.\n',
    })
    const { context, warnings } = loadContext(root)
    await context.load()
    expect(warnings).toHaveLength(0)
    expect(context.sections().rules).toContain(
      '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467} counts as one',
    )
  })
})

describe('WorkspaceContext: a skill body with hidden characters warns once across refreshes', () => {
  it('names the skill file and keeps the body', async () => {
    const root = makeWorkspace({
      'AGENTS.md': '# Rules.\n',
      '.agents/skills/probe/SKILL.md': skillFile('Run \u{202E}this first.'),
    })
    const { context, warnings } = loadContext(root)
    await context.load()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('project skill probe (SKILL.md)')
    expect(warnings[0]).toContain('bidirectional controls')
    expect(context.skill('probe')?.body).toContain('Run \u{202E}this first.')
    await context.refreshSkills()
    await context.refreshSkills()
    expect(warnings).toHaveLength(1)
  })

  it('warns on nothing for a clean skill', async () => {
    const root = makeWorkspace({
      'AGENTS.md': '# Rules.\n',
      '.agents/skills/probe/SKILL.md': skillFile('Run this first.'),
    })
    const { context, warnings } = loadContext(root)
    await context.load()
    expect(warnings).toHaveLength(0)
    expect(context.skill('probe')?.body).toContain('Run this first.')
  })
})
