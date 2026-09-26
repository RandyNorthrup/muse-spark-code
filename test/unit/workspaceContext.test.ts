import { describe, expect, it } from 'vitest'
import { WorkspaceContext } from '../../src/core/context/workspaceContext'
import type { MemoryScopeSnapshot } from '../../src/core/memory/memoryStore'
import { RULES_FILE_MAX_BYTES } from '../../src/shared/constants'
import { loaderDeps, memoryContextIo, memoryTree } from './helpers/fakeContextIo'

const ROOT = '/ws'
const USER_ROOT = '/ws/.home/.config/muse/skills'

const skillFile = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\nBody of ${name}\n`

const MEMORY: readonly MemoryScopeSnapshot[] = [
  { scope: 'project', index: '- [A](a.md) | hook', notes: [], hasMoreNotes: false },
]

function setup(initial: Record<string, string>, isTrusted = true) {
  const files = memoryTree(initial, ROOT)
  const io = memoryContextIo(files)
  const warnings: string[] = []
  let memoryLoads = 0
  const context = new WorkspaceContext({
    io,
    workspaceRoot: ROOT,
    platform: 'linux',
    personalSkillsRoot: USER_ROOT,
    isWorkspaceTrusted: () => isTrusted,
    loadMemory: () => {
      memoryLoads += 1
      return Promise.resolve(MEMORY)
    },
    warn: (message) => {
      warnings.push(message)
    },
  })
  return { files, context, warnings, memoryLoads: () => memoryLoads }
}

describe('WorkspaceContext', () => {
  it('loads the root rules, the skills and the memory snapshot once', async () => {
    const t = setup({
      'AGENTS.md': 'end with PINEAPPLE\n',
      '.agents/skills/shout/SKILL.md': skillFile('shout', 'Caps'),
      '.home/.config/muse/skills/tidy/SKILL.md': skillFile('tidy', 'Tidy up'),
    })
    await Promise.all([t.context.load(), t.context.load()])
    expect(t.memoryLoads()).toBe(1)
    const sections = t.context.sections()
    expect(sections.rules).toBe(
      'Standing rules were loaded at session open. Follow higher-priority instructions first. If rules files conflict, the deeper file wins over the shallower one.\n\n## Rules from AGENTS.md\n\nend with PINEAPPLE',
    )
    expect(sections.skills.map((skill) => `${skill.source}:${skill.id}`)).toEqual([
      'project:shout',
      'user:tidy',
    ])
    expect(sections.memory).toBe(MEMORY)
    expect(t.context.skill('tidy')?.body).toBe('Body of tidy')
    expect(t.context.skill('nope')).toBeUndefined()
    expect(t.warnings).toEqual([])
  })

  it('adds a deeper rules file the first time a path beneath it is touched', async () => {
    const t = setup({
      'AGENTS.md': 'root\n',
      'src/CLAUDE.md': 'src\n',
      'src/a/AGENTS.md': 'src/a\n',
    })
    await expect(t.context.touch('src/a/b.ts')).resolves.toBe(true)
    expect(t.context.sections().rules).toContain(
      '## Rules from AGENTS.md\n\nroot\n\n## Rules from src/CLAUDE.md\n\nsrc\n\n## Rules from src/a/AGENTS.md\n\nsrc/a',
    )
    await expect(t.context.touch('src/a/c.ts')).resolves.toBe(false)
    await expect(t.context.touch('lib/x.ts')).resolves.toBe(false)
    await expect(t.context.touch('README.md')).resolves.toBe(false)
  })

  it('passes the loaders’ warnings on', async () => {
    const t = setup({
      'AGENTS.md': 'x'.repeat(RULES_FILE_MAX_BYTES + 1),
      '.agents/skills/broken/SKILL.md': 'no front matter',
    })
    await t.context.load()
    expect(t.context.sections().rules).toBeUndefined()
    expect(t.warnings).toEqual([
      expect.stringMatching(/^rules file at AGENTS\.md is \d+ bytes, over the/),
      'project skill broken skipped: front matter is missing',
    ])
  })

  it('reports whether a skills refresh changed the catalogue', async () => {
    const t = setup({ '.agents/skills/shout/SKILL.md': skillFile('shout', 'Caps') })
    await t.context.load()
    await expect(t.context.refreshSkills()).resolves.toBe(false)
    t.files.set(`${ROOT}/.agents/skills/whisper/SKILL.md`, skillFile('whisper', 'Quiet'))
    await expect(t.context.refreshSkills()).resolves.toBe(true)
    expect(t.context.sections().skills.map((skill) => skill.id)).toEqual(['shout', 'whisper'])
    t.files.delete(`${ROOT}/.agents/skills/whisper/SKILL.md`)
    await expect(t.context.refreshSkills()).resolves.toBe(true)
  })

  it('loads nothing in an untrusted workspace', async () => {
    const t = setup(
      {
        'AGENTS.md': 'root\n',
        'src/AGENTS.md': 'src\n',
        '.agents/skills/shout/SKILL.md': skillFile('shout', 'Caps'),
      },
      false,
    )
    await t.context.load()
    await expect(t.context.touch('src/a.ts')).resolves.toBe(false)
    await expect(t.context.refreshSkills()).resolves.toBe(false)
    expect(t.context.sections()).toEqual({ rules: undefined, skills: [], memory: [] })
    expect(t.memoryLoads()).toBe(0)
  })
})

describe('WorkspaceContext: failing reads', () => {
  it('turns a throwing read into warnings and keeps the turn alive', async () => {
    const warnings: string[] = []
    const { io } = loaderDeps({ 'AGENTS.md': 'root\n' })
    const failing = {
      ...io,
      readFile: () => Promise.reject(new Error('EACCES: permission denied')),
      listDirectory: () => Promise.reject(new Error('EACCES: permission denied')),
    }
    const context = new WorkspaceContext({
      io: failing,
      workspaceRoot: ROOT,
      platform: 'linux',
      personalSkillsRoot: undefined,
      isWorkspaceTrusted: () => true,
      loadMemory: () => Promise.reject(new Error('EACCES: permission denied')),
      warn: (message) => {
        warnings.push(message)
      },
    })
    await context.load()
    await expect(context.touch('src/a.ts')).resolves.toBe(false)
    expect(context.sections()).toEqual({ rules: undefined, skills: [], memory: [] })
    expect(warnings).toEqual([
      'loading the rules failed: EACCES: permission denied',
      'loading the skills failed: EACCES: permission denied',
      'loading the memory failed: EACCES: permission denied',
      'loading the rules failed: EACCES: permission denied',
    ])
  })

  it('has no memory when the backend keeps none', async () => {
    const context = new WorkspaceContext({
      ...loaderDeps({}),
      personalSkillsRoot: undefined,
      isWorkspaceTrusted: () => true,
      loadMemory: undefined,
      warn: () => undefined,
    })
    await context.load()
    expect(context.sections().memory).toEqual([])
  })
})
