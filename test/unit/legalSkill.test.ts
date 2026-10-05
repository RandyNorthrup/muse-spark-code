// The bundled `/legal` skill (M97, lane B): listed, loaded and toggled on
// both backends through D68's mechanism, without touching the pinned
// upstream vendor package. A user skill with the same id shadows its text;
// the host's scan and the `/legal` command stay host-owned regardless.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extensionSkillsRoot, loadSkills, parseSkillFile } from '../../src/core/context/skills'
import { WorkspaceContext } from '../../src/core/context/workspaceContext'
import { memoryContextIo, memoryTree } from './helpers/fakeContextIo'

const ROOT = '/ws'
const USER_ROOT = '/ws/.home/.config/muse/skills'
const USER_AGENTS_ROOT = '/ws/.home/.config/muse/agents'
const PACKAGE = '/ext/vendor/high-quality-projects-skill'
const EXTENSION_SKILLS = '/ext/skills'

const skillFile = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`

const roots = [
  { directory: `${ROOT}/.agents/skills`, source: 'project' as const, confineTo: ROOT },
  { directory: USER_ROOT, source: 'user' as const, confineTo: undefined },
  {
    directory: `${PACKAGE}/skills`,
    source: 'bundled' as const,
    confineTo: PACKAGE,
    packageRoot: PACKAGE,
  },
  {
    directory: EXTENSION_SKILLS,
    source: 'bundled' as const,
    confineTo: '/ext',
    packageRoot: '/ext',
  },
]

describe('extensionSkillsRoot', () => {
  it('sits beside the vendored package on both path styles', () => {
    expect(extensionSkillsRoot('/ext/vendor/high-quality-projects-skill', 'linux')).toBe(
      '/ext/skills',
    )
    expect(
      extensionSkillsRoot(String.raw`C:\ext\vendor\high-quality-projects-skill`, 'win32'),
    ).toBe(String.raw`C:\ext\skills`)
  })
})

describe('loadSkills: the extension’s own bundled root (M97)', () => {
  it('loads the legal skill with the extension root as its package', async () => {
    const files = new Map([
      [`${PACKAGE}/skills/project_setup/SKILL.md`, skillFile('project_setup', 'Bundled setup')],
      [`${EXTENSION_SKILLS}/legal/SKILL.md`, skillFile('legal', 'Scan')],
    ])
    const load = await loadSkills({ io: memoryContextIo(files), platform: 'linux' }, roots)
    expect(load.skills.map((skill) => `${skill.source}:${skill.id}`)).toEqual([
      'bundled:project_setup',
      'bundled:legal',
    ])
    expect(load.skills.find((skill) => skill.id === 'project_setup')?.packageRoot).toBe(PACKAGE)
    expect(load.skills.find((skill) => skill.id === 'legal')?.packageRoot).toBe('/ext')
  })

  it('a project or personal skill named legal shadows its text, never the host scan', async () => {
    const files = new Map([
      [`${ROOT}/.agents/skills/legal/SKILL.md`, skillFile('legal', 'Mine')],
      [`${EXTENSION_SKILLS}/legal/SKILL.md`, skillFile('legal', 'Bundled')],
    ])
    const load = await loadSkills({ io: memoryContextIo(files), platform: 'linux' }, roots)
    // The model reads the user's text; `/legal` still runs the host's scan
    // (the command never consults skills).
    expect(load.skills.map((skill) => `${skill.source}:${skill.id}:${skill.description}`)).toEqual([
      'project:legal:Mine',
    ])
  })
})

describe('WorkspaceContext: the extension’s skills toggle with the bundled setting (M97)', () => {
  it('lists legal while the setting is on and drops it with the package when off', async () => {
    const files = memoryTree(
      {
        '.ext/vendor/high-quality-projects-skill/skills/project_setup/SKILL.md': skillFile(
          'project_setup',
          'Set up',
        ),
        '.ext/skills/legal/SKILL.md': skillFile('legal', 'Scan'),
      },
      ROOT,
    )
    let isOn = true
    const context = new WorkspaceContext({
      io: memoryContextIo(files),
      workspaceRoot: ROOT,
      platform: 'linux',
      personalSkillsRoot: USER_ROOT,
      bundledSkills: {
        packageRoot: `${ROOT}/.ext/vendor/high-quality-projects-skill`,
        isEnabled: () => isOn,
      },
      personalAgentsRoot: USER_AGENTS_ROOT,
      hasAgents: false,
      isWorkspaceTrusted: () => true,
      loadMemory: undefined,
      warn: () => undefined,
    })
    await context.load()
    expect(context.sections().skills.map((skill) => `${skill.source}:${skill.id}`)).toEqual([
      'bundled:project_setup',
      'bundled:legal',
    ])
    expect(context.skill('legal')?.packageRoot).toBe(`${ROOT}/.ext`)
    isOn = false
    await expect(context.refreshSkills()).resolves.toBe(true)
    expect(context.sections().skills.map((skill) => skill.id)).toEqual([])
    expect(context.skill('legal')).toBeUndefined()
  })
})

describe('skills/legal/SKILL.md as shipped', () => {
  it('parses with the legal name and a description', () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
    const text = readFileSync(path.join(root, 'skills', 'legal', 'SKILL.md'), 'utf8')
    const parsed = parseSkillFile(text)
    expect(parsed).toMatchObject({ ok: true, skill: { name: 'legal' } })
    const skill = parsed.ok ? parsed.skill : undefined
    expect(skill?.description.length).toBeGreaterThan(0)
    expect(skill?.isUserInvocable).toBe(true)
  })
})
