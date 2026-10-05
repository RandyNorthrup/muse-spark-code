import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  bundledSkillSourcesRoot,
  bundledSkillsPackageRoot,
  bundledSkillsRoot,
  extensionSkillsRoot,
  loadSkills,
  parseSkillFile,
  personalSkillsRoot,
  projectSkillsRoot,
  skillBodyForModel,
} from '../../src/core/context/skills'
import { SKILL_FILE_MAX_BYTES } from '../../src/shared/constants'
import { encoded, loaderDeps, memoryContextIo } from './helpers/fakeContextIo'

const ROOT = '/ws'
const USER_ROOT = '/ws/.home/.config/muse/skills'

const memoryIo = (files: Record<string, string | Uint8Array>) => loaderDeps(files).io

const skillFile = (name: string, description: string, extra = '', body = `# ${name}\n\nDo it.`) =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n${body}\n`

describe('parseSkillFile', () => {
  it('reads the front matter fields and the body', () => {
    expect(
      parseSkillFile(
        skillFile('shout', '"Repeat in caps"', "user-invocable: false\nargument-hint: 'text'\n"),
      ),
    ).toEqual({
      ok: true,
      skill: {
        name: 'shout',
        description: 'Repeat in caps',
        isUserInvocable: false,
        argumentHint: 'text',
        body: '# shout\n\nDo it.',
      },
    })
  })

  it('names what is wrong with a malformed file', () => {
    expect(parseSkillFile('# no front matter')).toEqual({
      ok: false,
      reason: 'front matter is missing',
    })
    expect(parseSkillFile('---\nname: x\n')).toEqual({
      ok: false,
      reason: 'front matter is not closed',
    })
    expect(parseSkillFile('---\ndescription: d\n---\n')).toEqual({
      ok: false,
      reason: 'front matter has no name',
    })
    expect(parseSkillFile('---\nname: x\ndescription:\n---\n')).toEqual({
      ok: false,
      reason: 'front matter has no description',
    })
    expect(parseSkillFile('---\nname: x\ndescription: d\nargument-hint:\n---\n')).toMatchObject({
      ok: true,
      skill: { argumentHint: undefined, isUserInvocable: true, body: '' },
    })
  })
})

describe('skill roots', () => {
  it('follow the workspace and the Muse config home on both path styles', () => {
    expect(projectSkillsRoot('/ws', 'linux')).toBe('/ws/.agents/skills')
    expect(projectSkillsRoot(String.raw`C:\ws`, 'win32')).toBe(String.raw`C:\ws\.agents\skills`)
    expect(
      personalSkillsRoot({ platform: 'linux', homeDir: '/home/r', xdgConfigHome: undefined }),
    ).toBe('/home/r/.config/muse/skills')
    expect(
      personalSkillsRoot({ platform: 'linux', homeDir: '/home/r', xdgConfigHome: '/xdg' }),
    ).toBe('/xdg/muse/skills')
    expect(
      personalSkillsRoot({
        platform: 'win32',
        homeDir: String.raw`C:\Users\r`,
        xdgConfigHome: undefined,
      }),
    ).toBe(String.raw`C:\Users\r\.config\muse\skills`)
  })

  it('put the bundled package inside the extension and its Muse Code copy beside the personal root (M89)', () => {
    expect(bundledSkillsPackageRoot('/ext', 'linux')).toBe(
      '/ext/vendor/high-quality-projects-skill',
    )
    expect(bundledSkillsPackageRoot(String.raw`C:\ext`, 'win32')).toBe(
      String.raw`C:\ext\vendor\high-quality-projects-skill`,
    )
    expect(bundledSkillsRoot('/ext/vendor/p', 'linux')).toBe('/ext/vendor/p/skills')
    // The extension's own skills sit beside the vendored package (M97).
    expect(extensionSkillsRoot('/ext/vendor/high-quality-projects-skill', 'linux')).toBe(
      '/ext/skills',
    )
    expect(
      extensionSkillsRoot(String.raw`C:\ext\vendor\high-quality-projects-skill`, 'win32'),
    ).toBe(String.raw`C:\ext\skills`)
    expect(
      bundledSkillSourcesRoot({ platform: 'linux', homeDir: '/home/r', xdgConfigHome: undefined }),
    ).toBe('/home/r/.config/muse/skill-sources')
    expect(
      bundledSkillSourcesRoot({ platform: 'linux', homeDir: '/home/r', xdgConfigHome: '/xdg' }),
    ).toBe('/xdg/muse/skill-sources')
    expect(
      bundledSkillSourcesRoot({
        platform: 'win32',
        homeDir: String.raw`C:\Users\r`,
        xdgConfigHome: undefined,
      }),
    ).toBe(String.raw`C:\Users\r\.config\muse\skill-sources`)
  })
})

describe('loadSkills: the bundled source (M89)', () => {
  const PACKAGE = '/ext/vendor/high-quality-projects-skill'
  const roots = [
    { directory: `${ROOT}/.agents/skills`, source: 'project' as const, confineTo: ROOT },
    { directory: USER_ROOT, source: 'user' as const, confineTo: undefined },
    {
      directory: `${PACKAGE}/skills`,
      source: 'bundled' as const,
      confineTo: PACKAGE,
      packageRoot: PACKAGE,
    },
  ]

  it('comes last: a project or personal skill with the same id shadows a bundled one', async () => {
    const files = new Map([
      [`${ROOT}/.agents/skills/project_setup/SKILL.md`, skillFile('project_setup', 'Mine')],
      [`${USER_ROOT}/feature_delivery/SKILL.md`, skillFile('feature_delivery', 'Personal')],
      [`${PACKAGE}/skills/project_setup/SKILL.md`, skillFile('project_setup', 'Bundled setup')],
      [`${PACKAGE}/skills/feature_delivery/SKILL.md`, skillFile('feature_delivery', 'Bundled')],
      [`${PACKAGE}/skills/quality_retrofit/SKILL.md`, skillFile('quality_retrofit', 'Retrofit')],
    ])
    const load = await loadSkills({ io: memoryContextIo(files), platform: 'linux' }, roots)
    expect(load.skills.map((skill) => `${skill.source}:${skill.id}:${skill.description}`)).toEqual([
      'project:project_setup:Mine',
      'user:feature_delivery:Personal',
      'bundled:quality_retrofit:Retrofit',
    ])
    expect(load.warnings).toEqual([
      'bundled skill feature_delivery skipped: the user skill with the same id takes precedence',
      'bundled skill project_setup skipped: the project skill with the same id takes precedence',
    ])
    // Only the bundled skill carries its package root.
    expect(load.skills.map((skill) => skill.packageRoot)).toEqual([undefined, undefined, PACKAGE])
  })

  it('reads only inside its package: a link out of it is skipped', async () => {
    const files = new Map([
      ['/elsewhere/sneaky/SKILL.md', skillFile('sneaky', 'Outside the package')],
      [`${PACKAGE}/skills/quality_retrofit/SKILL.md`, skillFile('quality_retrofit', 'Retrofit')],
    ])
    const io = memoryContextIo(files, { [`${PACKAGE}/skills/sneaky`]: '/elsewhere/sneaky' })
    const load = await loadSkills({ io, platform: 'linux' }, roots.slice(2))
    expect(load.skills.map((skill) => skill.id)).toEqual(['quality_retrofit'])
    expect(load.warnings).toEqual([
      `bundled skill sneaky skipped: SKILL.md is refused: path ${PACKAGE}/skills/sneaky/SKILL.md leads outside the workspace through a link`,
    ])
  })

  // The extension's own skills are a second `bundled` root, after the
  // vendored package, without touching it (M97).
  it('loads them with the extension root as their package', async () => {
    const extensionRoot = '/ext/skills'
    const files = new Map([
      [`${PACKAGE}/skills/project_setup/SKILL.md`, skillFile('project_setup', 'Bundled setup')],
      [`${extensionRoot}/legal/SKILL.md`, skillFile('legal', 'Scan')],
    ])
    const load = await loadSkills({ io: memoryContextIo(files), platform: 'linux' }, [
      ...roots,
      {
        directory: extensionRoot,
        source: 'bundled' as const,
        confineTo: '/ext',
        packageRoot: '/ext',
      },
    ])
    expect(load.skills.map((skill) => `${skill.source}:${skill.id}`)).toEqual([
      'bundled:project_setup',
      'bundled:legal',
    ])
    expect(load.skills.map((skill) => skill.packageRoot)).toEqual([PACKAGE, '/ext'])
  })

  it('a project skill named legal shadows the bundled text, never the host scan', async () => {
    const files = new Map([
      [`${ROOT}/.agents/skills/legal/SKILL.md`, skillFile('legal', 'Mine')],
      [`/ext/skills/legal/SKILL.md`, skillFile('legal', 'Bundled')],
    ])
    const load = await loadSkills({ io: memoryContextIo(files), platform: 'linux' }, [
      { directory: `${ROOT}/.agents/skills`, source: 'project' as const, confineTo: ROOT },
      {
        directory: '/ext/skills',
        source: 'bundled' as const,
        confineTo: '/ext',
        packageRoot: '/ext',
      },
    ])
    // The model reads the user's text; `/legal` still runs the host's scan
    // (the command never consults skills).
    expect(load.skills.map((skill) => `${skill.source}:${skill.id}:${skill.description}`)).toEqual([
      'project:legal:Mine',
    ])
  })
})

describe('skills/legal/SKILL.md as shipped (M97)', () => {
  it('parses with the legal name, a description, and user-invocable text', () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
    const text = readFileSync(path.join(root, 'skills', 'legal', 'SKILL.md'), 'utf8')
    const parsed = parseSkillFile(text)
    expect(parsed).toMatchObject({ ok: true, skill: { name: 'legal' } })
    const skill = parsed.ok ? parsed.skill : undefined
    expect(skill?.description.length).toBeGreaterThan(0)
    expect(skill?.isUserInvocable).toBe(true)
  })
})

describe('skillBodyForModel (M89)', () => {
  const base = {
    id: 'feature_delivery',
    name: 'feature_delivery',
    description: 'Deliver',
    body: '# Feature delivery',
    isUserInvocable: true,
    argumentHint: undefined,
  }

  it('puts exactly one line naming SKILL_ROOT before a bundled body, and nothing before the others', () => {
    expect(skillBodyForModel({ ...base, source: 'bundled', packageRoot: '/ext/vendor/p' })).toBe(
      'This skill ships with the Muse Spark extension; its package root, SKILL_ROOT, is /ext/vendor/p\n\n# Feature delivery',
    )
    expect(skillBodyForModel({ ...base, source: 'project' })).toBe('# Feature delivery')
    expect(skillBodyForModel({ ...base, source: 'user' })).toBe('# Feature delivery')
  })
})

describe('loadSkills', () => {
  const roots = [
    { directory: `${ROOT}/.agents/skills`, source: 'project' as const, confineTo: ROOT },
    { directory: USER_ROOT, source: 'user' as const, confineTo: undefined },
  ]

  it('loads valid skills from every root, project first, ids sorted, project shadowing user', async () => {
    const io = memoryIo({
      '.agents/skills/zeta/SKILL.md': skillFile('zeta', 'Last'),
      '.agents/skills/alpha/SKILL.md': skillFile('alpha', 'First'),
      '.home/.config/muse/skills/alpha/SKILL.md': skillFile('alpha', 'Personal alpha'),
      '.home/.config/muse/skills/beta/SKILL.md': skillFile('beta', 'Personal beta'),
    })
    const load = await loadSkills({ io, platform: 'linux' }, roots)
    expect(load.skills.map((skill) => `${skill.source}:${skill.id}`)).toEqual([
      'project:alpha',
      'project:zeta',
      'user:beta',
    ])
    expect(load.warnings).toEqual([
      'user skill alpha skipped: the project skill with the same id takes precedence',
    ])
  })

  it('skips and explains bad ids, missing, oversized and malformed files, and names a mismatch', async () => {
    const io = memoryIo({
      '.agents/skills/Bad Id/SKILL.md': skillFile('bad', 'x'),
      '.agents/skills/empty/README.md': 'not a skill',
      '.agents/skills/huge/SKILL.md': skillFile('huge', 'x', '', 'y'.repeat(SKILL_FILE_MAX_BYTES)),
      '.agents/skills/broken/SKILL.md': '# no front matter',
      '.agents/skills/renamed/SKILL.md': skillFile('other-name', 'Named differently'),
    })
    const load = await loadSkills({ io, platform: 'linux' }, roots.slice(0, 1))
    expect(load.skills.map((skill) => skill.id)).toEqual(['renamed'])
    expect(load.skills[0]).toMatchObject({ name: 'other-name', description: 'Named differently' })
    expect(load.warnings).toEqual([
      'project skill Bad Id skipped: the directory name is not a valid skill id',
      'project skill broken skipped: front matter is missing',
      'project skill empty skipped: SKILL.md is missing',
      `project skill huge skipped: SKILL.md is over the ${String(SKILL_FILE_MAX_BYTES)} byte limit`,
      'project skill renamed: front matter name other-name differs from the directory; the directory name is the selector',
    ])
  })

  it('is empty without roots on disk', async () => {
    const io = memoryIo({})
    await expect(loadSkills({ io, platform: 'linux' }, roots)).resolves.toEqual({
      skills: [],
      warnings: [],
    })
  })

  it('reads a UTF-16 skill file and skips one that is not text (D27)', async () => {
    const io = memoryIo({
      '.agents/skills/wide/SKILL.md': encoded.utf16le(skillFile('wide', 'Große Schrift')),
      '.agents/skills/nul/SKILL.md': encoded.utf16leWithoutBom(skillFile('nul', 'x')),
    })
    const load = await loadSkills({ io, platform: 'linux' }, roots.slice(0, 1))
    expect(load.skills.map((skill) => [skill.id, skill.description])).toEqual([
      ['wide', 'Große Schrift'],
    ])
    expect(load.warnings).toEqual([
      'project skill nul skipped: SKILL.md contains NUL characters (a binary file, or UTF-16 text without a byte-order mark)',
    ])
  })
})

describe('loadSkills: linked skill directories (D27)', () => {
  const PROJECT = `${ROOT}/.agents/skills`
  const files = new Map([
    [`${ROOT}/vendor/kept/SKILL.md`, skillFile('kept', 'A link inside the workspace')],
    ['/outside/escape/SKILL.md', skillFile('escape', 'A link out of the workspace')],
    ['/home/me/dotfiles/dot/SKILL.md', skillFile('dot', 'A personal link to dotfiles')],
    [`${PROJECT}/plain/SKILL.md`, skillFile('plain', 'An ordinary directory')],
  ])
  const io = memoryContextIo(files, {
    [`${PROJECT}/kept`]: `${ROOT}/vendor/kept`,
    [`${PROJECT}/escape`]: '/outside/escape',
    [`${USER_ROOT}/dot`]: '/home/me/dotfiles/dot',
  })

  it('follows a project link inside the workspace and any personal link, and skips a project link out of it', async () => {
    const roots = [
      { directory: PROJECT, source: 'project' as const, confineTo: ROOT },
      { directory: USER_ROOT, source: 'user' as const, confineTo: undefined },
    ]
    const load = await loadSkills({ io, platform: 'linux' }, roots)
    expect(load.skills.map((skill) => `${skill.source}:${skill.id}`)).toEqual([
      'project:kept',
      'project:plain',
      'user:dot',
    ])
    expect(load.warnings).toEqual([
      'project skill escape skipped: SKILL.md is refused: path /ws/.agents/skills/escape/SKILL.md leads outside the workspace through a link',
    ])
  })

  it('skips a skill whose read throws (a link loop) and keeps the others', async () => {
    const looping = {
      ...io,
      readFile: (absolutePath: string) =>
        absolutePath.includes('/dot/')
          ? Promise.reject(new Error('ELOOP: too many symbolic links'))
          : io.readFile(absolutePath),
    }
    const load = await loadSkills({ io: looping, platform: 'linux' }, [
      { directory: USER_ROOT, source: 'user', confineTo: undefined },
      { directory: PROJECT, source: 'project', confineTo: undefined },
    ])
    expect(load.skills.map((skill) => skill.id)).toEqual(['escape', 'kept', 'plain'])
    expect(load.warnings).toEqual([
      'user skill dot skipped: SKILL.md could not be read: ELOOP: too many symbolic links',
    ])
  })
})
