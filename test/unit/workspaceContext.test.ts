import * as ContextFiles from '../../src/core/context/contextFiles'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceContext } from '../../src/core/context/workspaceContext'
import type { MemoryScopeSnapshot } from '../../src/core/memory/memoryStore'
import { RULES_FILE_MAX_BYTES } from '../../src/shared/constants'
import { loaderDeps, memoryContextIo, memoryTree } from './helpers/fakeContextIo'

const ROOT = '/ws'
const USER_ROOT = '/ws/.home/.config/muse/skills'
const USER_AGENTS_ROOT = '/ws/.home/.config/muse/agents'

const skillFile = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\nBody of ${name}\n`

const agentFile = (name: string, description: string, extra = '') =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\nPrompt of ${name}\n`

const MEMORY: readonly MemoryScopeSnapshot[] = [
  { scope: 'project', index: '- [A](a.md) | hook', notes: [], hasMoreNotes: false },
]

/** A context with the bundled skills source, on while its setting is on. */
function bundledContext(initial: Record<string, string>, isEnabled: () => boolean) {
  const files = memoryTree(initial, ROOT)
  const context = new WorkspaceContext({
    io: memoryContextIo(files),
    workspaceRoot: ROOT,
    platform: 'linux',
    personalSkillsRoot: USER_ROOT,
    bundledSkills: {
      packageRoot: `${ROOT}/.ext/vendor/high-quality-projects-skill`,
      firstPartyRoot: `${ROOT}/.ext/first-party-skills`,
      isEnabled,
    },
    personalAgentsRoot: USER_AGENTS_ROOT,
    hasAgents: false,
    isWorkspaceTrusted: () => true,
    loadMemory: undefined,
    warn: () => undefined,
  })
  return { context }
}

function setup(
  initial: Record<string, string>,
  isTrusted: boolean | (() => boolean) = true,
  onRead?: (file: string) => void,
) {
  const files = memoryTree(initial, ROOT)
  const inner = memoryContextIo(files)
  const io = {
    ...inner,
    readFile: (file: string, maxBytes?: number) => {
      onRead?.(file)
      return inner.readFile(file, maxBytes)
    },
  }
  const warnings: string[] = []
  let memoryLoads = 0
  const context = new WorkspaceContext({
    io,
    workspaceRoot: ROOT,
    platform: 'linux',
    personalSkillsRoot: USER_ROOT,
    personalAgentsRoot: USER_AGENTS_ROOT,
    hasAgents: true,
    isWorkspaceTrusted: () => (typeof isTrusted === 'function' ? isTrusted() : isTrusted),
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
  it('RVM115U4 P1: unsourced rule, skill and agent catalogue entries remain explicit inputs', async () => {
    const read = ContextFiles.readContextText
    const missing = vi
      .spyOn(ContextFiles, 'readContextText')
      .mockImplementation(async (...args) => {
        const captured = await read(...args)
        return captured?.ok === true ? { ok: true, text: captured.text } : captured
      })
    try {
      const t = setup({
        'AGENTS.md': 'rule bytes',
        '.agents/skills/safe/SKILL.md': skillFile('safe', 'skill catalogue'),
        '.agents/agents/scout/AGENT.md': agentFile('scout', 'agent catalogue'),
      })
      await t.context.load()
      const material = t.context.instructionMaterial(true, false)
      expect(material).toHaveLength(3)
      expect(material.map((input) => input.source)).toEqual(
        Array.from({ length: 3 }, () => ({ kind: 'tool', callId: 'unproved-context' })),
      )
      expect(material.map((input) => input.bytes).join(' ')).toContain('rule bytes')
    } finally {
      missing.mockRestore()
    }
  })

  it('RVM115U4 P1: truncated rules retain their input inventory without full delivery evidence', async () => {
    const t = setup({ 'AGENTS.md': 'root' })
    await t.context.load()
    for (const directory of ['a', 'a/b', 'a/b/c', 'a/b/c/d', 'a/b/c/d/e']) {
      t.files.set(
        `${ROOT}/${directory}/AGENTS.md`,
        directory.repeat(Math.floor(RULES_FILE_MAX_BYTES / directory.length)),
      )
      await t.context.touch(`${directory}/file.ts`)
    }
    const rules = t.context.instructionMaterial(false, false, false)
    expect(rules).toHaveLength(6)
    expect(rules.some((rule) => rule.isFullyShown === false)).toBe(true)
  })

  it('loads the root rules, the skills, the agents and the memory snapshot once', async () => {
    const t = setup({
      'AGENTS.md': 'end with PINEAPPLE\n',
      '.agents/skills/shout/SKILL.md': skillFile('shout', 'Caps'),
      '.home/.config/muse/skills/tidy/SKILL.md': skillFile('tidy', 'Tidy up'),
      '.agents/agents/scout/AGENT.md': agentFile('scout', 'Scouting'),
      '.home/.config/muse/agents/helper/AGENT.md': agentFile('helper', 'Helping'),
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
    expect(sections.agents.map((agent) => `${agent.source}:${agent.id}`)).toEqual([
      'builtin:explore',
      'builtin:second-opinion',
      'project:scout',
      'user:helper',
    ])
    expect(sections.memory).toBe(MEMORY)
    expect(t.context.skill('tidy')?.body).toBe('Body of tidy')
    expect(t.context.skill('nope')).toBeUndefined()
    expect(t.context.agent('scout')).toMatchObject({
      kind: 'found',
      agent: { body: 'Prompt of scout' },
    })
    expect(t.context.agent('nope')).toEqual({ kind: 'unknown' })
    expect(t.warnings).toEqual([])
  })

  it('retains independent agent and memory source bytes when no skill catalogue is loaded', async () => {
    const t = setup({ '.agents/agents/scout/AGENT.md': agentFile('scout', 'Scouting') })
    await t.context.load()
    expect(t.context.instructionMaterial(false, false)).toEqual([])
    const material = t.context.instructionMaterial()
    expect(material).toHaveLength(2)
    expect(material[0]).toMatchObject({
      bytes: JSON.stringify({ id: 'scout', description: 'Scouting' }),
      source: { kind: 'file', file: { path: `${ROOT}/.agents/agents/scout/AGENT.md` } },
    })
    expect(material[1]).toEqual({
      bytes: JSON.stringify(MEMORY[0]),
      source: { kind: 'harness', operation: 'memory-snapshot' },
    })
  })

  it('reads no agent directory for a child, which cannot spawn (M76)', async () => {
    const files = memoryTree(
      { '.agents/agents/scout/AGENT.md': agentFile('scout', 'Scouting') },
      ROOT,
    )
    const inner = memoryContextIo(files)
    const touched: string[] = []
    const context = new WorkspaceContext({
      io: {
        ...inner,
        listDirectory: (directory) => {
          touched.push(directory)
          return inner.listDirectory(directory)
        },
      },
      workspaceRoot: ROOT,
      platform: 'linux',
      personalSkillsRoot: undefined,
      personalAgentsRoot: USER_AGENTS_ROOT,
      hasAgents: false,
      isWorkspaceTrusted: () => true,
      loadMemory: undefined,
      warn: () => undefined,
    })
    await context.load()
    expect(context.sections().agents).toEqual([])
    expect(context.agent('scout')).toEqual({ kind: 'unknown' })
    // The skill roots are listed; neither agent root is.
    expect(touched.length).toBeGreaterThan(0)
    expect(touched.filter((directory) => directory.endsWith('/agents'))).toEqual([])
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

  it('lists the bundled skills while museSpark.bundledSkills is on, and drops them at the refresh after it goes off (M89; first-party with them, M92)', async () => {
    const PACKAGE = `${ROOT}/.ext/vendor/high-quality-projects-skill`
    const FIRST_PARTY = `${ROOT}/.ext/first-party-skills`
    const files = memoryTree(
      {
        '.agents/skills/shout/SKILL.md': skillFile('shout', 'Caps'),
        // A personal skill with a bundled id shadows the bundled one.
        '.home/.config/muse/skills/feature_delivery/SKILL.md': skillFile(
          'feature_delivery',
          'Mine',
        ),
        '.ext/vendor/high-quality-projects-skill/skills/feature_delivery/SKILL.md': skillFile(
          'feature_delivery',
          'Bundled',
        ),
        '.ext/vendor/high-quality-projects-skill/skills/project_setup/SKILL.md': skillFile(
          'project_setup',
          'Set up',
        ),
        '.ext/first-party-skills/muse_gadgets/SKILL.md': skillFile('muse_gadgets', 'Gadgets'),
      },
      ROOT,
    )
    let isOn = true
    const context = new WorkspaceContext({
      io: memoryContextIo(files),
      workspaceRoot: ROOT,
      platform: 'linux',
      personalSkillsRoot: USER_ROOT,
      bundledSkills: { packageRoot: PACKAGE, firstPartyRoot: FIRST_PARTY, isEnabled: () => isOn },
      personalAgentsRoot: USER_AGENTS_ROOT,
      hasAgents: false,
      isWorkspaceTrusted: () => true,
      loadMemory: undefined,
      warn: () => undefined,
    })
    await context.load()
    expect(
      context.sections().skills.map((skill) => `${skill.source}:${skill.id}:${skill.description}`),
    ).toEqual([
      'project:shout:Caps',
      'user:feature_delivery:Mine',
      'bundled:muse_gadgets:Gadgets',
      'bundled:project_setup:Set up',
    ])
    expect(context.skill('project_setup')?.packageRoot).toBe(PACKAGE)
    expect(context.skill('muse_gadgets')?.packageRoot).toBe(FIRST_PARTY)
    expect(context.skill('feature_delivery')?.packageRoot).toBeUndefined()
    isOn = false
    await expect(context.refreshSkills()).resolves.toBe(true)
    expect(context.sections().skills.map((skill) => skill.id)).toEqual([
      'shout',
      'feature_delivery',
    ])
    expect(context.skill('project_setup')).toBeUndefined()
    expect(context.skill('muse_gadgets')).toBeUndefined()
    isOn = true
    await expect(context.refreshSkills()).resolves.toBe(true)
    expect(context.skill('project_setup')?.source).toBe('bundled')
    expect(context.skill('muse_gadgets')?.source).toBe('bundled')
  })

  it('toggles the legal skill under the extension bundled root alongside the vendor package, dropping both when the setting goes off (M97-B)', async () => {
    let isOn = false
    const { context } = bundledContext(
      {
        '.ext/vendor/high-quality-projects-skill/skills/project_setup/SKILL.md': skillFile(
          'project_setup',
          'Set up',
        ),
        '.ext/skills/legal/SKILL.md': skillFile('legal', 'Scan'),
      },
      () => isOn,
    )
    await context.load()
    expect(context.skill('legal')).toBeUndefined()
    isOn = true
    await expect(context.refreshSkills()).resolves.toBe(true)
    expect(context.sections().skills.map((skill) => `${skill.source}:${skill.id}`)).toEqual([
      'bundled:project_setup',
      'bundled:legal',
    ])
    expect(context.skill('legal')?.packageRoot).toBe(`${ROOT}/.ext`)
    isOn = false
    await expect(context.refreshSkills()).resolves.toBe(true)
    expect(context.skill('legal')).toBeUndefined()
    expect(context.skill('project_setup')).toBeUndefined()
  })

  it('loads nothing in an untrusted workspace', async () => {
    const t = setup(
      {
        'AGENTS.md': 'root\n',
        'src/AGENTS.md': 'src\n',
        '.agents/skills/shout/SKILL.md': skillFile('shout', 'Caps'),
        '.agents/agents/scout/AGENT.md': agentFile('scout', 'Scouting'),
      },
      false,
    )
    await t.context.load()
    await expect(t.context.touch('src/a.ts')).resolves.toBe(false)
    await expect(t.context.refreshSkills()).resolves.toBe(false)
    expect(t.context.sections()).toEqual({ rules: undefined, skills: [], agents: [], memory: [] })
    expect(t.context.agent('scout')).toEqual({ kind: 'unknown' })
    expect(t.memoryLoads()).toBe(0)
  })

  it.each(['AGENTS.md', '.agents/agents/scout/AGENT.md'])(
    'keeps no agents after trust is withdrawn while reading %s (M76)',
    async (revokedAt) => {
      let isTrusted = true
      const reads: string[] = []
      const t = setup(
        {
          'AGENTS.md': 'root\n',
          '.agents/agents/scout/AGENT.md': agentFile('scout', 'Scouting'),
        },
        () => isTrusted,
        (file) => {
          reads.push(file)
          if (file === `${ROOT}/${revokedAt}`) isTrusted = false
        },
      )
      await t.context.load()
      expect(reads).toContain(`${ROOT}/${revokedAt}`)
      expect(t.context.sections().agents).toEqual([])
      expect(t.context.agent('scout')).toEqual({ kind: 'unknown' })
      if (revokedAt === 'AGENTS.md') {
        expect(reads.some((file) => file.endsWith('/AGENT.md'))).toBe(false)
      }
    },
  )
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
      personalAgentsRoot: undefined,
      hasAgents: true,
      isWorkspaceTrusted: () => true,
      loadMemory: () => Promise.reject(new Error('EACCES: permission denied')),
      warn: (message) => {
        warnings.push(message)
      },
    })
    await context.load()
    await expect(context.touch('src/a.ts')).resolves.toBe(false)
    // The project root may hold an agent that narrows a built-in, so no
    // built-in is offered or run in its place (RV70x); the log names the root.
    expect(context.sections()).toEqual({ rules: undefined, skills: [], agents: [], memory: [] })
    expect(context.agent('explore')).toEqual({
      kind: 'unloaded',
      hole: { source: 'project', id: undefined, path: '.agents/agents' },
    })
    expect(warnings).toEqual([
      'loading the rules failed: EACCES: permission denied',
      'loading the project skills failed: EACCES: permission denied',
      'loading the project agents failed: EACCES: permission denied',
      'loading the memory failed: EACCES: permission denied',
      'loading the rules failed: EACCES: permission denied',
    ])
  })

  // RV70x finding 1: one root's listing failure rejected the whole catalogue,
  // and the fallback ran an inheriting built-in for a read-only project agent.
  it('keeps the project skills and agents when a personal root cannot be listed', async () => {
    const warnings: string[] = []
    const files = memoryTree(
      {
        '.agents/skills/shout/SKILL.md': skillFile('shout', 'Caps'),
        '.agents/agents/second-opinion/AGENT.md': agentFile(
          'second-opinion',
          'A read-only consult',
          'tools: read_file\npermission-mode: manual\n',
        ),
      },
      ROOT,
    )
    const inner = memoryContextIo(files)
    const personal = new Set([USER_ROOT, USER_AGENTS_ROOT])
    const context = new WorkspaceContext({
      io: {
        ...inner,
        listDirectory: (directory) =>
          personal.has(directory)
            ? Promise.reject(new Error('EACCES: permission denied'))
            : inner.listDirectory(directory),
      },
      workspaceRoot: ROOT,
      platform: 'linux',
      personalSkillsRoot: USER_ROOT,
      personalAgentsRoot: USER_AGENTS_ROOT,
      hasAgents: true,
      isWorkspaceTrusted: () => true,
      loadMemory: undefined,
      warn: (message) => {
        warnings.push(message)
      },
    })
    await context.load()
    expect(context.sections().skills.map((skill) => `${skill.source}:${skill.id}`)).toEqual([
      'project:shout',
    ])
    expect(context.agent('second-opinion')).toMatchObject({
      kind: 'found',
      agent: { source: 'project', tools: ['read_file'], permissionMode: 'manual' },
    })
    // Below the unread personal root, a built-in is refused, never run.
    expect(context.agent('explore')).toMatchObject({
      kind: 'unloaded',
      hole: { source: 'user', path: USER_AGENTS_ROOT },
    })
    expect(context.sections().agents.map((agent) => `${agent.source}:${agent.id}`)).toEqual([
      'project:second-opinion',
    ])
    expect(warnings).toEqual([
      'loading the user skills failed: EACCES: permission denied',
      'loading the user agents failed: EACCES: permission denied',
      'builtin agent second-opinion skipped: the project agent with the same id takes precedence',
    ])
  })

  it('has no memory when the backend keeps none', async () => {
    const context = new WorkspaceContext({
      ...loaderDeps({}),
      personalSkillsRoot: undefined,
      personalAgentsRoot: undefined,
      hasAgents: true,
      isWorkspaceTrusted: () => true,
      loadMemory: undefined,
      warn: () => undefined,
    })
    await context.load()
    expect(context.sections().memory).toEqual([])
  })
})
