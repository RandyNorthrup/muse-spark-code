import { describe, expect, it } from 'vitest'
import {
  loadSkills,
  parseSkillFile,
  personalSkillsRoot,
  projectSkillsRoot,
} from '../../src/core/context/skills'
import { SKILL_FILE_MAX_BYTES } from '../../src/shared/constants'
import { memoryToolIo } from './helpers/fakeToolIo'

const ROOT = '/ws'
const USER_ROOT = '/ws/.home/.config/muse/skills'

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
    { directory: `${ROOT}/.agents/skills`, source: 'project' as const },
    { directory: USER_ROOT, source: 'user' as const },
  ]

  it('loads valid skills from every root, project first, ids sorted, project shadowing user', async () => {
    const io = memoryToolIo(
      {
        '.agents/skills/zeta/SKILL.md': skillFile('zeta', 'Last'),
        '.agents/skills/alpha/SKILL.md': skillFile('alpha', 'First'),
        '.home/.config/muse/skills/alpha/SKILL.md': skillFile('alpha', 'Personal alpha'),
        '.home/.config/muse/skills/beta/SKILL.md': skillFile('beta', 'Personal beta'),
      },
      ROOT,
    )
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
    const io = memoryToolIo(
      {
        '.agents/skills/Bad Id/SKILL.md': skillFile('bad', 'x'),
        '.agents/skills/empty/README.md': 'not a skill',
        '.agents/skills/huge/SKILL.md': skillFile(
          'huge',
          'x',
          '',
          'y'.repeat(SKILL_FILE_MAX_BYTES),
        ),
        '.agents/skills/broken/SKILL.md': '# no front matter',
        '.agents/skills/renamed/SKILL.md': skillFile('other-name', 'Named differently'),
      },
      ROOT,
    )
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
    const io = memoryToolIo({}, ROOT)
    await expect(loadSkills({ io, platform: 'linux' }, roots)).resolves.toEqual({
      skills: [],
      warnings: [],
    })
  })
})
