import { describe, expect, it } from 'vitest'
import { instructionsFor } from '../../src/core/backends/modelapi/instructions'
import type { SkillDefinition } from '../../src/core/context/skills'

const base = {
  workspaceRoot: '/ws',
  platform: 'linux' as const,
  shellToolName: 'bash',
  shellName: 'bash',
}

const shout: SkillDefinition = {
  id: 'shout',
  name: 'shout',
  description: 'Repeat in caps',
  body: '# Shout',
  source: 'project',
  isUserInvocable: true,
  argumentHint: undefined,
}

describe('instructionsFor', () => {
  it('describes the tools and the shell in a trusted workspace without context', () => {
    const text = instructionsFor({
      ...base,
      hasShell: true,
      context: { rules: undefined, skills: [], memory: undefined },
    })
    expect(text).toContain('The workspace root is /ws on linux.')
    expect(text).toContain('The shell tool (bash) runs one bash command line')
    expect(text).not.toContain('# Workspace rules')
    expect(text).not.toContain('# Skills')
    expect(text).not.toContain('# Project memory')
  })

  it('says there is no shell in Restricted Mode', () => {
    const text = instructionsFor({
      ...base,
      hasShell: false,
      context: { rules: undefined, skills: [], memory: undefined },
    })
    expect(text).toContain("There is no shell tool: the workspace is in VS Code's Restricted Mode")
    expect(text).not.toContain('and the shell tool to run commands')
  })

  it('appends the rules, the skill catalogue and the memory index as sections', () => {
    const text = instructionsFor({
      ...base,
      hasShell: true,
      context: {
        rules: 'PREAMBLE\n\n## Rules from AGENTS.md\n\nend with PINEAPPLE',
        skills: [shout],
        memory: {
          path: '.agents/memory/MEMORY.md',
          text: '- [A](a.md) | hook',
          warning: undefined,
        },
      },
    })
    const rulesAt = text.indexOf(
      '# Workspace rules\n\nPREAMBLE\n\n## Rules from AGENTS.md\n\nend with PINEAPPLE',
    )
    const skillsAt = text.indexOf('# Skills')
    const memoryAt = text.indexOf('# Project memory')
    expect(rulesAt).toBeGreaterThan(0)
    expect(skillsAt).toBeGreaterThan(rulesAt)
    expect(memoryAt).toBeGreaterThan(skillsAt)
    expect(text).toContain('call read_skill with its id before starting')
    expect(text).toContain('- shout: Repeat in caps')
    expect(text).toContain('the index (.agents/memory/MEMORY.md) is below')
    expect(text.endsWith('- [A](a.md) | hook')).toBe(true)
  })
})
