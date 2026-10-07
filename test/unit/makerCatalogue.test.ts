import { describe, expect, it } from 'vitest'
import { instructionsFor } from '../../src/core/backends/modelapi/instructions'
import { loadSkills } from '../../src/core/context/skills'
import { memoryContextIo } from './helpers/fakeContextIo'

const BUNDLED = '/ext/first-party-skills'
const roots = [
  { directory: '/ws/.agents/skills', source: 'project' as const, confineTo: '/ws' },
  { directory: '/user/skills', source: 'user' as const, confineTo: undefined },
  { directory: BUNDLED, source: 'bundled' as const, confineTo: BUNDLED, packageRoot: BUNDLED },
]
function skill(name: string): string {
  return `---\nname: ${name}\ndescription: ${name}\n---\n\nGuidance.`
}

function instructions(skills: Awaited<ReturnType<typeof loadSkills>>['skills']): string {
  return instructionsFor({
    workspaceRoot: '/ws',
    platform: 'linux',
    shellToolName: 'bash',
    shellName: 'sh',
    hasShell: true,
    hasMemory: false,
    hasCodeIntel: false,
    today: '2026-10-05',
    environment: { git: undefined },
    context: { rules: undefined, skills, agents: [], memory: [] },
  })
}

describe('maker catalogue admission', () => {
  it('keeps a marker-free catalogue byte-identical to the base when maker skills are installed', async () => {
    const files = new Map([[`${BUNDLED}/muse_gadgets/SKILL.md`, skill('muse_gadgets')]])
    const deps = { io: memoryContextIo(files), platform: 'linux' as const }
    const base = await loadSkills(deps, roots)
    const before = JSON.stringify(base)
    files.set(`${BUNDLED}/maker_firmware/SKILL.md`, skill('maker_firmware'))
    files.set(`${BUNDLED}/maker_kicad/SKILL.md`, skill('maker_kicad'))
    expect(JSON.stringify(await loadSkills(deps, roots))).toBe(before)
    expect(JSON.stringify(await loadSkills({ ...deps, makerSkillIds: [] }, roots))).toBe(before)
    const after = await loadSkills(deps, roots)
    expect(Buffer.from(instructions(after.skills))).toEqual(Buffer.from(instructions(base.skills)))
  })

  it('offers only detected bundled maker skills and keeps the existing bundled catalogue', async () => {
    const io = memoryContextIo(
      new Map([
        [`${BUNDLED}/muse_gadgets/SKILL.md`, skill('muse_gadgets')],
        [`${BUNDLED}/maker_firmware/SKILL.md`, skill('maker_firmware')],
        [`${BUNDLED}/maker_kicad/SKILL.md`, skill('maker_kicad')],
      ]),
    )
    const result = await loadSkills(
      { io, platform: 'linux', makerSkillIds: ['maker_firmware', 'maker_simulation'] },
      roots,
    )
    expect(result.skills.map((entry) => entry.id)).toEqual(['maker_firmware', 'muse_gadgets'])
    expect(result.skills[0]?.packageRoot).toBe(BUNDLED)
    expect(result.warnings).toEqual([])
  })

  it('never suppresses a maker skill the user supplied and preserves project precedence', async () => {
    const io = memoryContextIo(
      new Map([
        ['/ws/.agents/skills/maker_firmware/SKILL.md', skill('project')],
        ['/user/skills/maker_firmware/SKILL.md', skill('personal')],
        ['/user/skills/maker_kicad/SKILL.md', skill('personal_kicad')],
        [`${BUNDLED}/maker_firmware/SKILL.md`, skill('bundled')],
      ]),
    )
    const result = await loadSkills({ io, platform: 'linux' }, roots)
    expect(result.skills.map((entry) => `${entry.source}:${entry.id}`)).toEqual([
      'project:maker_firmware',
      'user:maker_kicad',
    ])
  })
})
