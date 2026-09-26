import { describe, expect, it } from 'vitest'
import { instructionsFor } from '../../src/core/backends/modelapi/instructions'
import type { SkillDefinition } from '../../src/core/context/skills'

const base = {
  workspaceRoot: '/ws',
  platform: 'linux' as const,
  shellToolName: 'bash',
  shellName: 'bash',
  today: '2026-09-22',
  environment: { git: undefined },
}
const noContext = { rules: undefined, skills: [], memory: undefined }

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
    expect(text).toContain('ask through ask_user instead of listing the options in prose')
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
    expect(text.indexOf('# How to work')).toBeLessThan(rulesAt)
  })

  it('pins the goal section last, after the memory index (M45)', () => {
    const text = instructionsFor({
      ...base,
      hasShell: true,
      context: {
        ...noContext,
        memory: { path: '.agents/memory/MEMORY.md', text: '- [A](a.md)', warning: undefined },
      },
      goalSection: '# Session goal\n\n- Objective: Ship it',
    })
    expect(text.endsWith('# Session goal\n\n- Objective: Ship it')).toBe(true)
    expect(text.indexOf('# Session goal')).toBeGreaterThan(text.indexOf('# Project memory'))
  })

  it('states the date, the git facts and the working rules (M12)', () => {
    const text = instructionsFor({
      ...base,
      hasShell: true,
      context: noContext,
      environment: {
        git: { branch: 'main', changedFiles: 3, recentCommits: ['abc fix', 'def add'] },
      },
    })
    expect(text).toContain(
      "# Environment\n\n- Today's date: 2026-09-22\n- Git branch: main\n- Working tree at session start: 3 changed entries in git status.\n- Recent commits:\n  - abc fix\n  - def add",
    )
    expect(text).toContain('# How to work\n\n- Read a file before editing it')
    expect(text).toContain(
      '- Never create commits, branches or pushes unless the user asks for them.',
    )
    expect(text.indexOf('# Environment')).toBeLessThan(text.indexOf('# How to work'))
  })

  it('says so without a repository, and clean without changes or commits', () => {
    const none = instructionsFor({ ...base, hasShell: true, context: noContext })
    expect(none).toContain(
      "- Today's date: 2026-09-22\n- Git: not a repository, or git could not answer.",
    )
    const clean = instructionsFor({
      ...base,
      hasShell: true,
      context: noContext,
      environment: { git: { branch: 'main', changedFiles: 0, recentCommits: [] } },
    })
    expect(clean).toContain('- Git branch: main\n- Working tree at session start: clean.')
    expect(clean).not.toContain('Recent commits')
  })
})
