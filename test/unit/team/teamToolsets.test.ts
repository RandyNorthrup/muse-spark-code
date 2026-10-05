// Lane R (M96, PLAN.md D75): the one tool-set definition holds.

import { describe, expect, it } from 'vitest'
import {
  TEAM_BUILTIN_ROLE_IDS,
  TEAM_DELEGATE_TOOLS,
  TEAM_ROLE_TOOLSETS,
  TEAM_ROLE_WRITE_PATHS,
  TEAM_TOOL_GROUPS,
  TEAM_TOOL_GROUP_TOOLS,
  TEAM_TOOL_GROUP_WORDS,
} from '../../../src/shared/constants'
import {
  describeToolsForCharter,
  groupsForTools,
  groupWords,
  isTeamToolAdmitted,
  resolveTeamToolset,
  teamToolChecklist,
  type TeamToolsetSession,
} from '../../../src/core/team/toolsets'

const ALL_TOOLS = TEAM_TOOL_GROUPS.flatMap((group) => TEAM_TOOL_GROUP_TOOLS[group])

const FULL_SESSION: TeamToolsetSession = {
  offered: ALL_TOOLS,
  webSearchAllowed: true,
  imagesAllowed: true,
  delegates: [],
}

function roleSession(
  role: (typeof TEAM_BUILTIN_ROLE_IDS)[number],
  session: TeamToolsetSession = FULL_SESSION,
) {
  const toolset = TEAM_ROLE_TOOLSETS[role]
  return resolveTeamToolset({ groups: toolset, writePaths: TEAM_ROLE_WRITE_PATHS[role] }, session)
}

describe('resolveTeamToolset', () => {
  it('describes only offered capabilities after a partial tool meet', () => {
    for (const offered of [
      ['edit_file'],
      ['write_file'],
      ['read_file'],
      ['generate_image'],
      ['hover'],
    ]) {
      const resolved = resolveTeamToolset(
        { groups: ['read', 'write', 'images', 'codeIntel'], writePaths: ['docs/**'] },
        { ...FULL_SESSION, offered },
      )
      expect(resolved.tools).toEqual(offered)
      expect(resolved.youMay).toContain(offered[0])
      expect(resolved.youMay).not.toContain('create and edit files')
      expect(resolved.youMay).not.toContain('generate and edit images')
      expect(resolved.youMay).not.toContain('definitions, references')
      if (offered[0] === 'generate_image') {
        expect(resolved.youMay).toContain('(paid)')
      } else if (offered[0] === 'edit_file' || offered[0] === 'write_file') {
        expect(resolved.youMay).toContain('docs/**')
      }
    }
  })

  it('retains command restrictions when only one shell is offered', () => {
    const resolved = resolveTeamToolset(
      { groups: ['readOnlyShell'] },
      { ...FULL_SESSION, offered: ['bash'] },
    )
    expect(resolved.youMay).toContain('bash')
    expect(resolved.youMay).toContain('read-only shell commands')
    expect(resolved.youMay).toContain('git diff')
    expect(resolved.youMay).not.toContain('powershell')
  })
  it('gives each built-in role exactly its groups met with the session', () => {
    for (const role of TEAM_BUILTIN_ROLE_IDS) {
      const resolved = roleSession(role)
      const expected = TEAM_ROLE_TOOLSETS[role].flatMap((group) => TEAM_TOOL_GROUP_TOOLS[group])
      expect(new Set(resolved.tools)).toEqual(new Set(expected))
      expect(resolved.groups).toEqual(
        TEAM_ROLE_TOOLSETS[role].filter((group) => TEAM_TOOL_GROUP_TOOLS[group].length > 0),
      )
    }
  })

  it('keeps research and code-review from writing', () => {
    for (const role of ['research', 'code-review'] as const) {
      const resolved = roleSession(role)
      expect(resolved.tools).not.toContain('edit_file')
      expect(resolved.tools).not.toContain('write_file')
      expect(resolved.tools).not.toContain('run_checks')
    }
    // Research still runs read-only shell commands.
    expect(roleSession('research').tools).toContain('bash')
  })

  it('refuses a call to anything outside the resolved set', () => {
    const resolved = roleSession('engineering')
    expect(isTeamToolAdmitted(resolved, 'edit_file')).toBe(true)
    expect(isTeamToolAdmitted(resolved, 'ask_user')).toBe(false)
    expect(isTeamToolAdmitted(resolved, 'todo_write')).toBe(false)
    expect(isTeamToolAdmitted(resolved, 'subagent_spawn')).toBe(false)
    expect(isTeamToolAdmitted(resolved, 'add_memory')).toBe(false)
  })

  it('drops paid tools while their gate is off', () => {
    const off: TeamToolsetSession = {
      ...FULL_SESSION,
      webSearchAllowed: false,
      imagesAllowed: false,
    }
    expect(roleSession('research', off).tools).not.toContain('web_search')
    expect(roleSession('design', off).tools).not.toContain('generate_image')
    expect(roleSession('design', off).tools).not.toContain('edit_image')
    expect(roleSession('research').tools).toContain('web_search')
    expect(roleSession('design').tools).toContain('generate_image')
  })

  it('keeps delegate tools alongside a narrowed ordinary tool allowlist', () => {
    const resolved = resolveTeamToolset(
      { groups: ['read'], tools: ['read_file'] },
      {
        ...FULL_SESSION,
        offered: [...FULL_SESSION.offered, ...TEAM_DELEGATE_TOOLS],
        delegates: ['qa'],
      },
    )
    expect(resolved.tools).toEqual(['read_file', ...TEAM_DELEGATE_TOOLS])
    expect(resolved.tools).not.toContain('merge')
    expect(resolved.tools).not.toContain('list_files')
  })

  it('gives a delegating worker the team tools but never merge', () => {
    // Lane T declares the team tools in a team conversation; the worker's
    // set meets them like any offered tool.
    const offered = [...FULL_SESSION.offered, ...TEAM_DELEGATE_TOOLS]
    const resolved = resolveTeamToolset(
      { groups: ['read', 'report'] },
      { ...FULL_SESSION, offered, delegates: ['qa'] },
    )
    for (const tool of TEAM_DELEGATE_TOOLS) {
      expect(resolved.tools).toContain(tool)
    }
    expect(resolved.tools).not.toContain('merge')
    const solo = resolveTeamToolset({ groups: ['read', 'report'] }, FULL_SESSION)
    for (const tool of TEAM_DELEGATE_TOOLS) {
      expect(solo.tools).not.toContain(tool)
    }
  })

  it('meets the diagnostics tool under the session name', () => {
    const inProcess = resolveTeamToolset(
      { groups: ['diagnostics', 'report'] },
      {
        offered: ['getDiagnostics', 'report'],
        webSearchAllowed: true,
        imagesAllowed: true,
        delegates: [],
      },
    )
    expect(inProcess.groups).toContain('diagnostics')
    expect(inProcess.tools).toContain('getDiagnostics')
    const overMcp = resolveTeamToolset(
      { groups: ['diagnostics', 'report'] },
      {
        offered: ['mcp__ide__getDiagnostics', 'report'],
        webSearchAllowed: true,
        imagesAllowed: true,
        delegates: [],
      },
    )
    expect(overMcp.groups).toContain('diagnostics')
    expect(overMcp.tools).toContain('mcp__ide__getDiagnostics')
  })

  it('drops a group the session offers nothing of', () => {
    const resolved = resolveTeamToolset(
      { groups: ['read', 'codeIntel', 'report'] },
      {
        offered: ['read_file', 'report'],
        webSearchAllowed: true,
        imagesAllowed: true,
        delegates: [],
      },
    )
    expect(resolved.groups).toEqual(['read', 'report'])
    expect(resolved.tools).toEqual(['read_file', 'report'])
  })
})

describe('charter words', () => {
  it('matches the table for every group, so the table cannot drift', () => {
    for (const group of TEAM_TOOL_GROUPS) {
      expect(groupWords(group, undefined)).toBe(TEAM_TOOL_GROUP_WORDS[group])
    }
  })

  it('names the read-only commands from the list, and the write paths where they apply', () => {
    expect(describeToolsForCharter(['readOnlyShell'], undefined)).toContain('git diff')
    expect(describeToolsForCharter(['write'], ['docs/**'])).toContain('docs/**')
    expect(describeToolsForCharter(['read', 'report'], undefined)).toBe(
      'read files, list files and search the workspace; hand back your muse-team-report',
    )
  })
})

describe('groupsForTools and the checklist', () => {
  it('maps an allowlist back to its groups', () => {
    expect(groupsForTools(['read_file', 'edit_file'])).toEqual(['read', 'write'])
    expect(groupsForTools(['getDiagnostics'])).toEqual(['diagnostics'])
    expect(groupsForTools(['mcp__ide__getDiagnostics'])).toEqual(['diagnostics'])
    expect(groupsForTools(['no_such_tool'])).toEqual([])
  })

  it('meets an aliased tool the session offers under neither name with nothing', () => {
    const resolved = resolveTeamToolset(
      { groups: ['diagnostics', 'report'] },
      {
        offered: ['report'],
        webSearchAllowed: true,
        imagesAllowed: true,
        delegates: [],
      },
    )
    expect(resolved.groups).toEqual(['report'])
    expect(isTeamToolAdmitted(resolved, 'ide__getDiagnostics')).toBe(false)
  })

  it('adds no team tool a delegating session does not offer', () => {
    const resolved = resolveTeamToolset(
      { groups: ['read', 'report'] },
      {
        ...FULL_SESSION,
        delegates: ['qa'],
      },
    )
    for (const tool of TEAM_DELEGATE_TOOLS) {
      expect(resolved.tools).not.toContain(tool)
    }
  })

  it('keeps each tool once across overlapping groups', () => {
    const resolved = resolveTeamToolset(
      { groups: ['shell', 'readOnlyShell', 'report'] },
      FULL_SESSION,
    )
    expect(resolved.tools.filter((tool) => tool === 'bash')).toHaveLength(1)
  })

  it('lists every group with its tools for the panel', () => {
    const checklist = teamToolChecklist()
    expect(checklist.map((row) => row.group)).toEqual([...TEAM_TOOL_GROUPS])
    for (const row of checklist) {
      expect(row.tools).toEqual([...TEAM_TOOL_GROUP_TOOLS[row.group]])
    }
  })
})
