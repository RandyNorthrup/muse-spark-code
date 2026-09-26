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
  hasMemory: false,
}
const noContext = { rules: undefined, skills: [], memory: [] }

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
    const text = instructionsFor({ ...base, hasShell: true, context: noContext })
    expect(text).toContain('The workspace root is /ws on linux.')
    expect(text).toContain('The shell tool (bash) runs one bash command line')
    expect(text).toContain('ask through ask_user instead of listing the options in prose')
    expect(text).not.toContain('# Workspace rules')
    expect(text).not.toContain('# Skills')
    expect(text).not.toContain('# Memory')
  })

  it('says there is no shell in Restricted Mode', () => {
    const text = instructionsFor({ ...base, hasShell: false, context: noContext })
    expect(text).toContain("There is no shell tool: the workspace is in VS Code's Restricted Mode")
    expect(text).not.toContain('and the shell tool to run commands')
  })

  it('appends the rules, the skill catalogue and the memory as sections (M10, M49)', () => {
    const text = instructionsFor({
      ...base,
      hasShell: true,
      hasMemory: true,
      context: {
        rules: 'PREAMBLE\n\n## Rules from AGENTS.md\n\nend with PINEAPPLE',
        skills: [shout],
        memory: [
          { scope: 'project', index: '- [A](a.md) | hook', notes: ['a.md'], hasMoreNotes: false },
          { scope: 'personal', index: undefined, notes: ['p.md', 'q.md'], hasMoreNotes: true },
        ],
      },
    })
    const rulesAt = text.indexOf(
      '# Workspace rules\n\nPREAMBLE\n\n## Rules from AGENTS.md\n\nend with PINEAPPLE',
    )
    const skillsAt = text.indexOf('# Skills')
    const memoryAt = text.indexOf('# Memory')
    expect(rulesAt).toBeGreaterThan(0)
    expect(skillsAt).toBeGreaterThan(rulesAt)
    expect(memoryAt).toBeGreaterThan(skillsAt)
    expect(text).toContain('call read_skill with its id before starting')
    expect(text).toContain('- shout: Repeat in caps')
    expect(text).toContain('Save concise, verified, durable facts with add_memory')
    expect(text).toContain(
      '- personal_project: this project, private to the user, kept outside the repository (the default)\n- project: .agents/memory in the repository',
    )
    expect(text).toContain(
      'The memory as this session began:\n\n## project\n\nMEMORY.md:\n- [A](a.md) | hook\n\nOther notes: a.md.\n\n## personal\n\nOther notes: p.md, q.md, and more (not listed).',
    )
    expect(text.indexOf('# How to work')).toBeLessThan(rulesAt)
  })

  it('tells the model memory exists even before any note, and nothing without the tools', () => {
    const empty = instructionsFor({ ...base, hasShell: true, hasMemory: true, context: noContext })
    expect(empty).toContain('# Memory')
    expect(empty.endsWith('No memory notes are kept yet.')).toBe(true)
    const withoutTools = instructionsFor({
      ...base,
      hasShell: true,
      context: {
        ...noContext,
        memory: [{ scope: 'project', index: '- x', notes: [], hasMoreNotes: false }],
      },
    })
    expect(withoutTools).not.toContain('# Memory')
  })

  it('pins the goal section last, after memory (M45, M49)', () => {
    const text = instructionsFor({
      ...base,
      hasShell: true,
      hasMemory: true,
      context: {
        ...noContext,
        memory: [{ scope: 'project', index: '- [A](a.md)', notes: ['a.md'], hasMoreNotes: false }],
      },
      goalSection: '# Session goal\n\n- Objective: Ship it',
    })
    expect(text.endsWith('# Session goal\n\n- Objective: Ship it')).toBe(true)
    expect(text.indexOf('# Session goal')).toBeGreaterThan(text.indexOf('# Memory'))
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
