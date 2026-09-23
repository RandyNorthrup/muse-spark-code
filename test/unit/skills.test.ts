import { describe, expect, it } from 'vitest'
import {
  loadSkills,
  parseSkillFile,
  personalSkillsRoot,
  projectSkillsRoot,
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
      expect.stringMatching(
        /^project skill huge skipped: SKILL\.md is \d+ bytes, over the \d+ byte limit$/,
      ),
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
