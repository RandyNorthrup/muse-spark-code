// Lane R (M96, PLAN.md D75): the role keys, narrowing and the ceiling.

import { describe, expect, it } from 'vitest'
import { parseAgentFileForRole } from '../../../src/core/context/customAgents'
import {
  TEAM_ROLE_FRONT_MATTER_KEYS,
  applyNewRoleCeiling,
  hasRoleWriteTool,
  isAllowanceForFile,
  loadRoles,
  narrowProjectRole,
  offeredRoles,
  newRoleAsks,
  newRoleCeilingTools,
  parseRoleFile,
  resolveRole,
  resolveRoleWorkspace,
  roleFileSha256,
  type RoleDefinition,
} from '../../../src/core/team/roles'
import { builtinRoleFile, builtinRoles } from '../../../src/core/team/builtInRoles'
import { loaderDeps } from '../helpers/fakeContextIo'

const roleFile = (name: string, description: string, extra = '', body = 'Do the job.') =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n${body}\n`

function asRole(id: string, source: RoleDefinition['source'], text: string): RoleDefinition {
  const parsed = parseRoleFile(text)
  if (!parsed.ok) {
    throw new Error(`test role ${id} refused: ${parsed.reason}`)
  }
  return { ...parsed.role, id, source, sha256: undefined }
}

const researchShadow = () => asRole('research', 'builtin', builtinRoleFile('research'))
const designShadow = () => asRole('design', 'builtin', builtinRoleFile('design'))

const PROJECT_ROOT = '/ws/.agents/agents'
const USER_ROOT = '/ws/.home/.config/muse/agents'
const roots = [
  { directory: PROJECT_ROOT, source: 'project' as const, confineTo: '/ws' },
  { directory: USER_ROOT, source: 'user' as const, confineTo: undefined },
]

describe('parseRoleFile', () => {
  it('reads every role key, and keeps M76 meaning when one is missing', () => {
    const parsed = parseRoleFile(
      roleFile(
        'scout',
        'Scouting',
        'when-to-use: Use me\n' +
          'done: Found it\n' +
          'workspace: read-only\n' +
          'tools: read_file, search\n' +
          'write-paths: docs/**\n' +
          'skills: cartography\n' +
          'report: qa\n' +
          'delegates: qa\n' +
          'model: muse-spark-1.3\n' +
          'effort: max\n' +
          'permission-mode: plan\n',
      ),
    )
    expect(parsed).toEqual({
      ok: true,
      role: {
        name: 'scout',
        description: 'Scouting',
        whenToUse: 'Use me',
        done: 'Found it',
        body: 'Do the job.',
        workspace: 'read-only',
        tools: ['read_file', 'search'],
        writePaths: ['docs/**'],
        skills: ['cartography'],
        report: 'qa',
        delegates: ['qa'],
        model: 'muse-spark-1.3',
        effort: 'max',
        approvalMode: 'denyUnmatched',
      },
    })
    const minimal = parseRoleFile(roleFile('scout', 'Scouting'))
    expect(minimal).toMatchObject({
      ok: true,
      role: {
        whenToUse: undefined,
        done: undefined,
        workspace: undefined,
        tools: undefined,
        writePaths: undefined,
        skills: undefined,
        report: undefined,
        delegates: undefined,
        model: undefined,
        effort: undefined,
        approvalMode: undefined,
      },
    })
  })

  it('refuses a file with an unknown or malformed role key, naming it', () => {
    expect(parseRoleFile(roleFile('x', 'd', 'bogus: 1\n'))).toEqual({
      ok: false,
      reason: 'front matter names an unknown role key: bogus',
    })
    expect(parseRoleFile(roleFile('x', 'd', 'workspace: everywhere\n'))).toEqual({
      ok: false,
      reason: 'front matter has an invalid workspace',
    })
    expect(parseRoleFile(roleFile('x', 'd', 'report: essay\n'))).toEqual({
      ok: false,
      reason: 'front matter has an invalid report',
    })
    expect(parseRoleFile(roleFile('x', 'd', `when-to-use: ${'u'.repeat(241)}\n`))).toEqual({
      ok: false,
      reason: 'front matter has an invalid when-to-use',
    })
    expect(parseRoleFile(roleFile('x', 'd', 'write-paths: docs/**, \n'))).toEqual({
      ok: false,
      reason: 'front matter has an invalid write-paths',
    })
    expect(parseRoleFile(roleFile('x', 'd', 'skills: Not A Skill!\n'))).toEqual({
      ok: false,
      reason: 'front matter has an invalid skills',
    })
    expect(parseRoleFile(roleFile('x', 'd', 'delegates: qa, nope!\n'))).toEqual({
      ok: false,
      reason: 'front matter has an invalid delegates',
    })
    expect(parseRoleFile('# no front matter')).toEqual({
      ok: false,
      reason: 'front matter is missing',
    })
  })

  it('hands the role keys over from M76 unchanged, with the unknown keys listed', () => {
    const handed = parseAgentFileForRole(
      roleFile('x', 'd', 'workspace: read-only\nbogus: 1\n'),
      TEAM_ROLE_FRONT_MATTER_KEYS,
    )
    expect(handed).toMatchObject({ ok: true })
    if (!handed.ok) {
      return
    }
    expect(handed.roleFields.get('workspace')).toBe('read-only')
    expect(handed.unknownKeys).toEqual(['bogus'])
    expect(handed.agent.description).toBe('d')
  })
})

describe('resolveRoleWorkspace', () => {
  it('keeps a filed workspace, else own-branch for writers and read-only otherwise', () => {
    expect(resolveRoleWorkspace({ workspace: 'in-place', tools: ['read_file'] })).toBe('in-place')
    expect(resolveRoleWorkspace({ workspace: undefined, tools: ['read_file', 'edit_file'] })).toBe(
      'own-branch',
    )
    expect(resolveRoleWorkspace({ workspace: undefined, tools: ['read_file'] })).toBe('read-only')
    expect(resolveRoleWorkspace({ workspace: undefined, tools: undefined })).toBe('own-branch')
  })

  it('counts rename as a write', () => {
    expect(hasRoleWriteTool(['rename_symbol'])).toBe(true)
    expect(hasRoleWriteTool(['read_file'])).toBe(false)
  })
})

const narrowedResearch = (extra: string) =>
  narrowProjectRole(
    researchShadow(),
    asRole('research', 'project', roleFile('Research', 'Reading', extra)),
  )

describe('narrowProjectRole', () => {
  it('resolves an omitted project permission mode to the most restrictive ceiling', () => {
    const project = asRole(
      'research',
      'project',
      roleFile('Research', 'Reading', 'tools: read_file\n'),
    )
    for (const approvalMode of ['denyUnmatched', undefined] as const) {
      expect(narrowProjectRole({ ...researchShadow(), approvalMode }, project)).toMatchObject({
        ok: true,
        role: { approvalMode: 'denyUnmatched' },
      })
    }
    expect(
      narrowProjectRole(
        { ...researchShadow(), approvalMode: undefined },
        { ...project, approvalMode: 'allowAll' },
      ).ok,
    ).toBe(false)
  })

  it('allows literal and subtree write-path narrowing while refusing escapes and wider globs', () => {
    const shadow = { ...designShadow(), writePaths: ['docs/**'] }
    const project = { ...shadow, source: 'project' as const }
    for (const writePaths of [['docs/release.md'], ['docs/releases/**'], ['docs/releases/*.md']]) {
      expect(narrowProjectRole(shadow, { ...project, writePaths }).ok).toBe(true)
    }
    for (const writePaths of [
      ['src/release.md'],
      ['docs/../src/*.md'],
      ['docs/**/../../*'],
      ['**/*.md'],
      undefined,
    ]) {
      expect(narrowProjectRole(shadow, { ...project, writePaths }).ok).toBe(false)
    }
    expect(
      narrowProjectRole(
        { ...shadow, writePaths: ['**/*.md'] },
        { ...project, writePaths: ['docs/release.md'] },
      ).ok,
    ).toBe(true)
  })
  it('accepts a project role that only narrows', () => {
    const narrowed = narrowedResearch('tools: read_file\n')
    expect(narrowed.ok).toBe(true)
  })

  it('refuses a wider workspace, tool, glob or delegates', () => {
    const designTools =
      builtinRoles()
        .find((role) => role.id === 'design')
        ?.tools.join(', ') ?? ''

    expect(narrowedResearch('workspace: own-branch\n')).toEqual({
      ok: false,
      reason: "a project role's workspace (own-branch) is wider than the role it shadows",
    })
    expect(narrowedResearch('workspace: read-only\ntools: read_file, edit_file\n')).toEqual({
      ok: false,
      reason: 'a project role adds a tool the role it shadows does not have',
    })
    expect(
      narrowProjectRole(
        designShadow(),
        asRole(
          'design',
          'project',
          roleFile('Design', 'Designing', `tools: ${designTools}\nwrite-paths: docs/**, src/**\n`),
        ),
      ),
    ).toEqual({
      ok: false,
      reason: 'a project role writes where the role it shadows does not',
    })
    expect(narrowedResearch('workspace: read-only\ntools: read_file\ndelegates: qa\n')).toEqual({
      ok: false,
      reason: 'a project role delegates where the role it shadows does not',
    })
  })

  it('resolves a missing key first, so leaving one out never widens', () => {
    // Research files tools; omitting them resolves to the whole session,
    // whose write tools also widen the default workspace: the workspace
    // refusal fires first.
    expect(narrowedResearch('done: Less.\n')).toEqual({
      ok: false,
      reason: "a project role's workspace (own-branch) is wider than the role it shadows",
    })
    // Pinning the workspace still refuses the missing tools.
    expect(narrowedResearch('workspace: read-only\ndone: Less.\n')).toEqual({
      ok: false,
      reason: 'a project role adds a tool the role it shadows does not have',
    })
  })

  it('never sets in-place, and names no model or skills', () => {
    expect(narrowedResearch('workspace: in-place\ntools: read_file\n').ok).toBe(false)
    expect(narrowedResearch('model: muse-spark-1.3\n')).toEqual({
      ok: false,
      reason: 'a project role names no model: the pool chooses it',
    })
    expect(narrowedResearch('skills: cartography\n')).toEqual({
      ok: false,
      reason: 'a project role names no skills: they come from user configuration',
    })
  })

  it('holds the approval ceiling, and leaves purpose text free', () => {
    const ceiling = narrowProjectRole(
      { ...researchShadow(), approvalMode: 'denyUnmatched' },
      {
        ...asRole('research', 'project', roleFile('Research', 'Reading', 'tools: read_file\n')),
        approvalMode: 'promptUnmatched',
      },
    )
    expect(ceiling).toEqual({
      ok: false,
      reason: 'a project role never widens the approval ceiling',
    })
    const free = narrowProjectRole(
      researchShadow(),
      asRole(
        'research',
        'project',
        roleFile(
          'Research',
          'Other purpose',
          'tools: read_file\nwhen-to-use: Other routing\ndone: Other done\nreport: summary\n',
        ) + 'Other method.',
      ),
    )
    expect(free.ok).toBe(true)
  })
})

const ceilingProjectRole = (): RoleDefinition => ({
  ...asRole(
    'cartography',
    'project',
    roleFile(
      'Cartography',
      'Mapping',
      'workspace: own-branch\ntools: read_file, edit_file\nwrite-paths: docs/**\ndelegates: qa\n',
    ),
  ),
  sha256: roleFileSha256('file'),
})

describe('the new-id ceiling', () => {
  it('starts read-only with the read and codeIntel groups', () => {
    expect(newRoleCeilingTools()).toEqual(
      expect.arrayContaining(['read_file', 'list_files', 'search', 'find_definition', 'repo_map']),
    )
    expect(newRoleCeilingTools()).not.toContain('edit_file')
  })

  it('shows the wider asks, and applies them only for the filed SHA-256', () => {
    const role = ceilingProjectRole()
    expect(newRoleAsks(role)).toEqual({
      workspace: 'own-branch',
      tools: ['edit_file'],
      writePaths: true,
      delegates: true,
    })
    const ceiling = applyNewRoleCeiling(role, undefined)
    expect(ceiling.workspace).toBe('read-only')
    expect(ceiling.tools).toEqual(expect.arrayContaining(['read_file']))
    expect(ceiling.tools).not.toContain('edit_file')
    expect(ceiling.writePaths).toBeUndefined()
    expect(ceiling.delegates).toEqual([])
    expect(isAllowanceForFile(undefined, role.sha256 ?? '')).toBe(false)
    expect(isAllowanceForFile({ sha256: 'other' }, role.sha256 ?? '')).toBe(false)
    expect(applyNewRoleCeiling(role, { sha256: role.sha256 ?? '' })).toEqual({
      ...role,
      approvalMode: 'denyUnmatched',
    })
    // An edit asks again.
    expect(isAllowanceForFile({ sha256: role.sha256 ?? '' }, roleFileSha256('edited'))).toBe(false)
  })
})

describe('loadRoles', () => {
  it('refuses forbidden powers for every project id before any allowance can apply', async () => {
    for (const id of ['cartography', 'research']) {
      for (const extra of [
        'workspace: in-place\n',
        'model: muse-spark-1.3\n',
        'skills: cartography\n',
      ]) {
        const text = roleFile(id, 'Mapping', `tools: read_file\n${extra}`)
        const load = await loadRoles(
          loaderDeps({ [`.agents/agents/${id}/AGENT.md`]: text }),
          roots,
          { trustedWorkspace: true },
        )
        expect(resolveRole(load, id)).toMatchObject({
          kind: 'unloaded',
          hole: { id, source: 'project' },
        })
        expect(offeredRoles(load).some((role) => role.id === id)).toBe(false)
      }
    }
  })

  it('rejects forbidden new-role powers even with a matching allowance', () => {
    for (const extra of [
      'workspace: in-place\n',
      'model: muse-spark-1.3\n',
      'skills: cartography\n',
    ]) {
      const text = roleFile('Cartography', 'Mapping', extra)
      const role = { ...asRole('cartography', 'project', text), sha256: roleFileSha256(text) }
      for (const allowance of [undefined, { sha256: role.sha256 }]) {
        expect(() => applyNewRoleCeiling(role, allowance)).toThrow(/a project role/u)
      }
    }
  })

  it('retains the strict missing ceiling on a new project id, including a hash allowance', async () => {
    const text = roleFile('Cartography', 'Mapping', 'tools: read_file\n')
    const load = await loadRoles(
      loaderDeps({ '.agents/agents/cartography/AGENT.md': text }),
      roots,
      { trustedWorkspace: true },
    )
    const role = load.roles.find((candidate) => candidate.id === 'cartography')
    expect(role?.approvalMode).toBe('denyUnmatched')
    if (role === undefined) throw new Error('project role missing')
    expect(applyNewRoleCeiling(role, { sha256: roleFileSha256(text) }).approvalMode).toBe(
      'denyUnmatched',
    )
  })
  it('loads the seven built-ins with nothing configured', async () => {
    const load = await loadRoles(loaderDeps({}), roots, { trustedWorkspace: true })
    expect(load.roles.map((role) => `${role.source}:${role.id}`)).toEqual(
      builtinRoles().map((role) => `builtin:${role.id}`),
    )
    expect(load.warnings).toEqual([])
    expect(resolveRole(load, 'research')).toMatchObject({ kind: 'found' })
    expect(resolveRole(load, 'nope')).toEqual({ kind: 'unknown' })
  })

  it('loads a project role only in a trusted workspace', async () => {
    const files = {
      '.agents/agents/cartography/AGENT.md': roleFile('Cartography', 'Mapping'),
    }
    const trusted = await loadRoles(loaderDeps(files), roots, { trustedWorkspace: true })
    const role = trusted.roles.find((candidate) => candidate.id === 'cartography')
    expect(role?.source).toBe('project')
    expect(role?.sha256).toBe(roleFileSha256(files['.agents/agents/cartography/AGENT.md']))
    const untrusted = await loadRoles(loaderDeps(files), roots, { trustedWorkspace: false })
    expect(untrusted.roles.find((candidate) => candidate.id === 'cartography')).toBeUndefined()
    expect(
      untrusted.holes.find((hole) => hole.source === 'project' && hole.id === undefined),
    ).toBeDefined()
    expect(resolveRole(untrusted, 'cartography')).toMatchObject({ kind: 'unloaded' })
  })

  it('refuses a widening shadow instead of falling back, and lets personal shadow built-ins', async () => {
    const files = {
      '.agents/agents/research/AGENT.md': roleFile(
        'Research',
        'Reading',
        'workspace: own-branch\n',
      ),
      '.home/.config/muse/agents/research/AGENT.md': roleFile(
        'Research',
        'My reading',
        'tools: read_file\n',
      ),
    }
    const load = await loadRoles(loaderDeps(files), roots, { trustedWorkspace: true })
    // The project file widens research (own-branch with the whole session's
    // tools): the name refuses instead of falling back, M76's fail-closed
    // rule, and the personal file is not offered while the hole stands.
    expect(
      load.holes.find((hole) => hole.source === 'project' && hole.id === 'research'),
    ).toBeDefined()
    expect(load.roles.find((role) => role.id === 'research')?.source).toBe('user')
    expect(resolveRole(load, 'research')).toMatchObject({ kind: 'unloaded' })
    expect(offeredRoles(load).find((role) => role.id === 'research')).toBeUndefined()
  })
})
