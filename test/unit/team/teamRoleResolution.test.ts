import { describe, expect, it } from 'vitest'
import {
  AGENT_FILE_MAX_BYTES,
  AGENT_MAX_FILES,
  TEAM_TOOL_GROUPS,
  TEAM_DELEGATE_TOOLS,
  TEAM_TOOL_GROUP_TOOLS,
  TEAM_WORKSPACE_MODES,
  TEAM_WORKSPACE_ORDER,
  UI_TEXT,
} from '../../../src/shared/constants'
import { APPROVAL_MODES } from '../../../src/shared/permissionModes'
import { narrowApprovalMode } from '../../../src/core/context/customAgents'
import { isGlobMatch } from '../../../src/core/backends/modelapi/globLimits'
import {
  loadRoles,
  meetRolePermissions,
  offeredRoles,
  parseRoleFile,
  resolveRole,
  roleFileSha256,
  type RoleCeiling,
  type RoleDefinition,
  type RoleEnvironment,
  type RoleInput,
  type RoleUnknown,
} from '../../../src/core/team/roles'
import { builtinRoleFile } from '../../../src/core/team/builtInRoles'
import { buildTeamCharter } from '../../../src/core/team/charter'
import { groupsForTools, isTeamToolAdmitted } from '../../../src/core/team/toolsets'
import { loaderDeps } from '../helpers/fakeContextIo'

const PROJECT = '/ws/.agents/agents'
const PERSONAL = '/ws/.home/.config/muse/agents'
const ROOTS = [
  { directory: PROJECT, source: 'project' as const, confineTo: '/ws' },
  { directory: PERSONAL, source: 'user' as const, confineTo: undefined },
]
const ENVIRONMENT: RoleEnvironment = {
  session: {
    offered: TEAM_TOOL_GROUPS.flatMap((group) => TEAM_TOOL_GROUP_TOOLS[group]),
    delegates: ['qa', 'research'],
    webSearchAllowed: true,
    imagesAllowed: true,
  },
  approvalMode: 'allowAll',
  ceilings: [],
  allowances: {},
}
const INPUTS = { kind: 'known' as const, value: ENVIRONMENT }
const file = (extra = '') => `---\nname: engineering\ndescription: Work\n${extra}---\n\nWork.\n`
function definition(extra = ''): RoleDefinition {
  const parsed = parseRoleFile(file(extra))
  if (!parsed.ok) throw new Error(parsed.reason)
  return { ...parsed.role, id: 'engineering', source: 'user', sha256: undefined }
}

function assertNarrowed(result: RoleDefinition, ceiling: RoleCeiling): void {
  expect(TEAM_WORKSPACE_ORDER[result.workspace ?? 'in-place']).toBeLessThanOrEqual(
    TEAM_WORKSPACE_ORDER[ceiling.workspace ?? 'in-place'],
  )
  expect(narrowApprovalMode(ceiling.approvalMode ?? 'denyUnmatched', result.approvalMode)).toBe(
    result.approvalMode,
  )
  if (ceiling.tools !== undefined) expect(result.tools).toBeDefined()
  if (result.workspace === 'read-only' || result.writePaths?.length === 0) {
    expect(result.tools ?? []).not.toContain('edit_file')
  }
  const tools = result.tools ?? []
  for (const tool of tools) expect(ceiling.tools?.includes(tool) ?? true).toBe(true)
  const delegates = result.delegates ?? []
  for (const id of delegates) expect(ceiling.delegates?.includes(id)).toBe(true)
  const paths = ['docs/a.md', 'docs/releases/a.md', 'src/a.ts', 'a.md']
  for (const path of paths) {
    const canWrite =
      result.writePaths === undefined || result.writePaths.some((glob) => isGlobMatch(path, glob))
    const isAllowed =
      ceiling.writePaths === undefined || ceiling.writePaths.some((glob) => isGlobMatch(path, glob))
    expect(canWrite && !isAllowed).toBe(false)
  }
}

describe('Round-3 role resolution invariants', () => {
  it('RVM96R3 P2-1: withdraws delegation tools when final ceilings permit no delegate', async () => {
    const cases: Pick<RoleEnvironment, 'ceilings' | 'session'>[] = [
      { session: { ...ENVIRONMENT.session, delegates: [] }, ceilings: [] },
      {
        session: ENVIRONMENT.session,
        ceilings: [{ approvalMode: 'allowAll', delegates: [] }],
      },
      {
        session: ENVIRONMENT.session,
        ceilings: [{ approvalMode: 'allowAll', delegates: ['research'] }],
      },
    ]
    for (const environment of cases) {
      const loaded = await loadRoles(
        loaderDeps({
          '.home/.config/muse/agents/engineering/AGENT.md': file(
            'tools: read_file\ndelegates: qa\n',
          ),
        }),
        ROOTS,
        {
          trustedWorkspace: true,
          inputs: {
            kind: 'known',
            value: {
              ...ENVIRONMENT,
              ...environment,
              session: {
                ...environment.session,
                offered: ['read_file', ...TEAM_DELEGATE_TOOLS],
              },
            },
          },
        },
      )
      const found = resolveRole(loaded, 'engineering')
      if (found.kind !== 'found') throw new Error('role refused')
      expect(found.role.delegates).toEqual([])
      expect(found.role.tools).toEqual(['read_file'])
      const tools = { tools: found.role.tools ?? [], groups: [], youMay: '' }
      for (const tool of TEAM_DELEGATE_TOOLS) expect(isTeamToolAdmitted(tools, tool)).toBe(false)
      const charter = buildTeamCharter(
        { ...found.role, workspace: 'read-only', delegates: [], report: 'summary' },
        tools,
      )
      expect(charter.generated).toContain('start a worker;')
      expect(charter.generated).not.toContain('use these tools: roster')
    }
  })

  it('property: every successful intersection is no broader than every applicable ceiling', () => {
    const lists = [undefined, [], ['read_file'], ['read_file', 'edit_file']]
    const paths = [undefined, [], ['docs/**'], ['docs/releases/a.md']]
    const policies: RoleCeiling[] = TEAM_WORKSPACE_MODES.flatMap((workspace) =>
      APPROVAL_MODES.flatMap((approvalMode) =>
        lists.map((tools, index) => ({
          workspace,
          approvalMode,
          tools,
          writePaths: paths[index],
          delegates: index % 2 === 0 ? ['qa'] : [],
        })),
      ),
    )
    for (const first of policies) {
      for (const second of policies) {
        const role = {
          ...definition(),
          workspace: 'in-place' as const,
          approvalMode: 'allowAll' as const,
          delegates: ['qa', 'research'],
        }
        const result = meetRolePermissions(role, [first, second])
        expect(result.ok).toBe(true)
        if (!result.ok) throw new Error(result.reason)
        assertNarrowed(result.role, first)
        assertNarrowed(result.role, second)
        // Reversing compatible ceilings must not change effective permissions.
        expect(meetRolePermissions(role, [second, first])).toEqual(result)
      }
    }
  })

  it('property: any Unknown input refuses the whole catalogue under every precedence order', async () => {
    const issues: RoleUnknown['issue'][] = [
      'missing',
      'unreadable',
      'malformed',
      'ambiguous',
      'untrusted',
      'widening',
    ]
    const inputs: RoleUnknown['input'][] = ['catalogue', 'role', 'environment']
    for (const input of inputs) {
      for (const issue of issues) {
        for (const source of ['user', 'project'] as const) {
          const unknown: RoleUnknown = {
            kind: 'unknown',
            input,
            issue,
            source,
            id: 'engineering',
            path: '/blocked',
          }
          for (const roots of [ROOTS, ROOTS.toReversed()]) {
            const loaded = await loadRoles(
              loaderDeps({ '.agents/agents/engineering/AGENT.md': builtinRoleFile('engineering') }),
              roots,
              { trustedWorkspace: true, inputs: unknown },
            )
            expect(loaded.snapshot).toEqual(unknown)
            expect(offeredRoles(loaded)).toEqual([])
            for (const id of ['engineering', 'research', 'absent']) {
              expect(resolveRole(loaded, id)).toMatchObject({
                kind: 'unloaded',
                reason: UI_TEXT.teamRoleResolutionUnknown,
              })
            }
          }
        }
      }
    }
  })

  it('property: file, new-id, session, paid and runtime ceilings all narrow the final role', async () => {
    const text = file(
      'workspace: own-branch\ntools: read_file, edit_file, generate_image\nwrite-paths: docs/**\n',
    )
    for (const source of ['user', 'project'] as const) {
      for (const isAllowed of [false, true]) {
        for (const areImagesAllowed of [false, true]) {
          for (const approvalMode of APPROVAL_MODES) {
            const runtime = {
              ...ENVIRONMENT,
              approvalMode,
              session: {
                ...ENVIRONMENT.session,
                offered: ['read_file', 'edit_file', 'generate_image'],
                imagesAllowed: areImagesAllowed,
              },
              allowances: isAllowed ? { 'new-role': { sha256: roleFileSha256(text) } } : {},
              ceilings: [
                {
                  workspace: 'own-branch' as const,
                  tools: ['read_file', 'generate_image'],
                  approvalMode: 'onRequest' as const,
                  delegates: [],
                },
              ],
            }
            const root = source === 'user' ? '.home/.config/muse/agents' : '.agents/agents'
            const loaded = await loadRoles(
              loaderDeps({ [`${root}/new-role/AGENT.md`]: text }),
              ROOTS,
              { trustedWorkspace: true, inputs: { kind: 'known', value: runtime } },
            )
            const found = resolveRole(loaded, 'new-role')
            if (found.kind !== 'found') throw new Error(found.reason)
            expect(found.role.tools).not.toContain('edit_file')
            expect(found.role.approvalMode).toBe('denyUnmatched')
            if (!areImagesAllowed || (source === 'project' && !isAllowed))
              expect(found.role.tools).not.toContain('generate_image')
            if (source !== 'project' || isAllowed) {
              continue
            }

            expect(found.role.workspace).toBe('read-only')
            expect(found.role.writePaths).toEqual([])
          }
        }
      }
    }
  })

  it('captures immutable runtime inputs before IO and detaches every resolved array', async () => {
    const offered = ['read_file', 'edit_file']
    const tools = ['read_file']
    const runtime = {
      ...ENVIRONMENT,
      session: { ...ENVIRONMENT.session, offered },
      ceilings: [
        { workspace: 'read-only' as const, tools, approvalMode: 'denyUnmatched' as const },
      ],
    }
    const deps = loaderDeps({
      '.home/.config/muse/agents/engineering/AGENT.md': file('tools: read_file, edit_file\n'),
    })
    const original = deps.io.listDirectory
    deps.io.listDirectory = (directory) => {
      offered.push('write_file')
      tools.push('edit_file')
      return original(directory)
    }
    const loaded = await loadRoles(deps, ROOTS, {
      trustedWorkspace: true,
      inputs: { kind: 'known', value: runtime },
    })
    expect(loaded.roles.find((role) => role.id === 'engineering')?.tools).toEqual(['read_file'])
    expect(Object.isFrozen(loaded)).toBe(true)
    if (loaded.snapshot.kind !== 'known') throw new Error('snapshot refused')
    expect(Object.isFrozen(loaded.snapshot.value.environment.session.offered)).toBe(true)
    expect(Object.isFrozen(loaded.snapshot.value.environment.ceilings[0]?.tools)).toBe(true)
    for (const role of loaded.roles) {
      expect(Object.isFrozen(role)).toBe(true)
      expect(Object.isFrozen(role.tools)).toBe(true)
    }
  })
})

describe('named role review regressions', () => {
  it('RVM96A R1: omitted project permission mode stays strict under a permissive parent', async () => {
    const loaded = await loadRoles(
      loaderDeps({
        '.agents/agents/engineering/AGENT.md': file('workspace: read-only\ntools: read_file\n'),
      }),
      ROOTS,
      { trustedWorkspace: true, inputs: INPUTS },
    )
    expect(resolveRole(loaded, 'engineering')).toMatchObject({
      kind: 'found',
      role: { approvalMode: 'denyUnmatched', tools: ['read_file'] },
    })
  })

  it('RVM96A R2: every project id refuses forbidden powers even with an exact hash allowance', async () => {
    for (const id of ['engineering', 'new-role']) {
      for (const power of [
        'workspace: in-place\n',
        'model: muse-spark-1.3\n',
        'skills: cartography\n',
      ]) {
        const text = file(`tools: read_file\n${power}`)
        const loaded = await loadRoles(
          loaderDeps({ [`.agents/agents/${id}/AGENT.md`]: text }),
          ROOTS,
          {
            trustedWorkspace: true,
            inputs: {
              kind: 'known',
              value: { ...ENVIRONMENT, allowances: { [id]: { sha256: roleFileSha256(text) } } },
            },
          },
        )
        expect(resolveRole(loaded, id)).toMatchObject({
          kind: 'unloaded',
          unknown: { issue: 'widening' },
        })
        expect(offeredRoles(loaded)).toEqual([])
      }
    }
  })

  it('RVM96A R34: proves literal/subtree inclusion and refuses unproved or escaping glob languages', () => {
    const role = {
      ...definition(),
      workspace: 'own-branch' as const,
      tools: ['edit_file'],
      writePaths: ['docs/**'],
    }
    for (const writePaths of [['docs/release.md'], ['docs/releases/**'], ['docs/releases/*.md']]) {
      const met = meetRolePermissions({ ...role, writePaths }, [role])
      expect(met.ok).toBe(true)
      if (met.ok) expect(met.role.writePaths).toEqual(writePaths)
    }
    expect(
      meetRolePermissions({ ...role, writePaths: ['docs/*.md'] }, [
        { ...role, writePaths: ['**/*.md'] },
      ]),
    ).toEqual({ ok: false, reason: 'write-path-inclusion-unproven' })
    const escaping = { ...role, writePaths: ['docs/{../src,foo}/**'] }
    expect(meetRolePermissions(escaping, [escaping]).ok).toBe(false)
    expect(meetRolePermissions(escaping, []).ok).toBe(false)
  })

  it('RVM96A R35: a charter describes exactly the final tools after all ceilings', async () => {
    const loaded = await loadRoles(loaderDeps({}), ROOTS, {
      trustedWorkspace: true,
      inputs: {
        kind: 'known',
        value: { ...ENVIRONMENT, session: { ...ENVIRONMENT.session, offered: ['edit_file'] } },
      },
    })
    const found = resolveRole(loaded, 'engineering')
    if (found.kind !== 'found') throw new Error('role refused')
    const tools = found.role.tools ?? []
    expect(tools).toEqual(['edit_file'])
    const charter = buildTeamCharter(
      {
        ...found.role,
        workspace: found.role.workspace ?? 'read-only',
        delegates: found.role.delegates ?? [],
        report: found.role.report ?? 'summary',
      },
      { tools, groups: groupsForTools(tools) },
    )
    expect(charter.generated).toContain('edit_file')
    expect(charter.generated).not.toContain('write_file')
    expect(charter.generated).not.toContain('create and edit files')
  })

  it('RVM96RB2 R1: failed personal or project listings block built-in writer fallback', async () => {
    for (const blocked of [PERSONAL, PROJECT]) {
      const deps = loaderDeps({
        '.agents/agents/engineering/AGENT.md': file('workspace: read-only\ntools: read_file\n'),
      })
      const original = deps.io.listDirectory
      deps.io.listDirectory = (directory) =>
        directory === blocked ? Promise.reject(new Error('EACCES')) : original(directory)
      const loaded = await loadRoles(deps, ROOTS, { trustedWorkspace: true, inputs: INPUTS })
      expect(resolveRole(loaded, 'engineering')).toMatchObject({
        kind: 'unloaded',
        unknown: { input: 'catalogue', issue: 'unreadable' },
      })
      expect(offeredRoles(loaded)).toEqual([])
    }
  })

  it('RVM96RB2 R2: an unreadable personal ceiling blocks a broader project shadow', async () => {
    const deps = loaderDeps({
      '.agents/agents/engineering/AGENT.md': builtinRoleFile('engineering'),
      '.home/.config/muse/agents/engineering/AGENT.md': file(
        'workspace: read-only\ntools: read_file\n',
      ),
    })
    const original = deps.io.readFile
    deps.io.readFile = (file, maxBytes) =>
      file.startsWith(PERSONAL) ? Promise.reject(new Error('EACCES')) : original(file, maxBytes)
    const loaded = await loadRoles(deps, ROOTS, { trustedWorkspace: true, inputs: INPUTS })
    expect(resolveRole(loaded, 'engineering')).toMatchObject({
      kind: 'unloaded',
      unknown: { source: 'user', issue: 'unreadable' },
    })
    expect(resolveRole(loaded, 'research').kind).toBe('unloaded')
  })
})

describe('snapshot boundary failures', () => {
  it('refuses missing listed files, malformed files, duplicate selectors and invalid directory names', async () => {
    for (const text of [undefined, '# malformed', file('tools: read_file\n')]) {
      for (const ids of [['engineering'], ['engineering', 'engineering'], ['Bad ID']]) {
        const deps = loaderDeps(
          text === undefined ? {} : { '.home/.config/muse/agents/engineering/AGENT.md': text },
        )
        deps.io.listDirectory = (directory) => Promise.resolve(directory === PERSONAL ? ids : [])
        const loaded = await loadRoles(deps, ROOTS, { trustedWorkspace: true, inputs: INPUTS })
        if (text?.startsWith('---') === true && ids.length === 1 && ids[0] === 'engineering') {
          expect(loaded.snapshot.kind).toBe('known')
        } else {
          expect(loaded.snapshot.kind).toBe('unknown')
          expect(resolveRole(loaded, 'research').kind).toBe('unloaded')
        }
      }
    }
  })

  it('refuses oversized files, missing roots, and ambiguous roles across same-source roots', async () => {
    const deps = loaderDeps({
      '.home/.config/muse/agents/engineering/AGENT.md': file('tools: read_file\n'),
    })
    const duplicate = await loadRoles(
      deps,
      [...ROOTS, { directory: PERSONAL, source: 'user', confineTo: undefined }],
      {
        trustedWorkspace: true,
        inputs: INPUTS,
      },
    )
    expect(duplicate.snapshot).toMatchObject({ kind: 'unknown', issue: 'ambiguous' })
    const oversized = await loadRoles(
      loaderDeps({
        '.home/.config/muse/agents/engineering/AGENT.md': 'x'.repeat(AGENT_FILE_MAX_BYTES + 1),
      }),
      ROOTS,
      { trustedWorkspace: true, inputs: INPUTS },
    )
    expect(oversized.snapshot.kind).toBe('unknown')
    deps.io.realPath = () => Promise.reject(new Error('ENOENT'))
    const missingRoot = await loadRoles(deps, ROOTS, { trustedWorkspace: true, inputs: INPUTS })
    expect(missingRoot.snapshot.kind).toBe('unknown')
  })

  it('refuses malformed root paths and missing project confinement before reading them', async () => {
    for (const directory of [PROJECT, 'relative/agents']) {
      const deps = loaderDeps({ '.agents/agents/engineering/AGENT.md': file('tools: read_file\n') })
      deps.io.readFile = () => {
        throw new Error('must not read an unconfined root')
      }
      const loaded = await loadRoles(
        deps,
        [{ directory, source: 'project', confineTo: undefined }],
        { trustedWorkspace: true, inputs: INPUTS },
      )
      expect(loaded.snapshot).toMatchObject({
        kind: 'unknown',
        input: 'catalogue',
        issue: 'malformed',
      })
    }
  })

  it('refuses the whole catalogue when its entry cap would discard a ceiling', async () => {
    const files = Object.fromEntries(
      Array.from({ length: AGENT_MAX_FILES + 1 }, (_, index) => [
        `.home/.config/muse/agents/role-${String(index)}/AGENT.md`,
        file('tools: read_file\n'),
      ]),
    )
    const loaded = await loadRoles(loaderDeps(files), ROOTS, {
      trustedWorkspace: true,
      inputs: INPUTS,
    })
    expect(loaded.snapshot.kind).toBe('unknown')
    expect(offeredRoles(loaded)).toEqual([])
  })

  it('refuses malformed runtime catalogues, permissions, ceilings and allowances', async () => {
    const missing = await loadRoles(loaderDeps({}), ROOTS, { trustedWorkspace: true })
    expect(missing.snapshot).toMatchObject({ kind: 'unknown', issue: 'missing' })
    expect(offeredRoles(missing)).toEqual([])
    const malformed: unknown[] = [
      undefined,
      {},
      { ...ENVIRONMENT, session: undefined },
      { ...ENVIRONMENT, session: { ...ENVIRONMENT.session, offered: undefined } },
      { ...ENVIRONMENT, approvalMode: 'maybe' },
      { ...ENVIRONMENT, ceilings: undefined },
      { ...ENVIRONMENT, ceilings: [{ approvalMode: 'maybe' }] },
      { ...ENVIRONMENT, ceilings: [{ approvalMode: 'allowAll', writePaths: ['docs/**\u{200B}'] }] },
      { ...ENVIRONMENT, ceilings: [{ approvalMode: 'allowAll', tools: ['bad tool'] }] },
      { ...ENVIRONMENT, ceilings: [{ approvalMode: 'allowAll', delegates: ['Bad Role'] }] },
      { ...ENVIRONMENT, session: { ...ENVIRONMENT.session, offered: ['bad tool'] } },
      { ...ENVIRONMENT, session: { ...ENVIRONMENT.session, delegates: ['Bad Role'] } },
      { ...ENVIRONMENT, allowances: { 'Bad Role': { sha256: roleFileSha256('allowed') } } },
      {
        ...ENVIRONMENT,
        ceilings: [{ approvalMode: 'allowAll', writePaths: ['docs/{../src,foo}/**'] }],
      },
      { ...ENVIRONMENT, allowances: undefined },
      { ...ENVIRONMENT, allowances: { engineering: { sha256: 'bad' } } },
    ]
    for (const value of malformed) {
      const inputs: RoleInput<unknown> = { kind: 'known', value }
      const loaded = await loadRoles(loaderDeps({}), ROOTS, { trustedWorkspace: true, inputs })
      expect(loaded.snapshot).toMatchObject({ kind: 'unknown', input: 'environment' })
      expect(offeredRoles(loaded)).toEqual([])
    }
  })

  it('meets personal and project delegate ceilings separately from ordinary tool allowlists', async () => {
    const text = file('tools: read_file\ndelegates: qa\n')
    const loaded = await loadRoles(
      loaderDeps({
        '.home/.config/muse/agents/engineering/AGENT.md': text,
        '.agents/agents/engineering/AGENT.md': text,
      }),
      ROOTS,
      {
        trustedWorkspace: true,
        inputs: {
          kind: 'known',
          value: {
            ...ENVIRONMENT,
            session: {
              ...ENVIRONMENT.session,
              offered: [...ENVIRONMENT.session.offered, ...TEAM_DELEGATE_TOOLS],
            },
          },
        },
      },
    )
    expect(resolveRole(loaded, 'engineering')).toMatchObject({
      kind: 'found',
      role: { tools: ['read_file', ...TEAM_DELEGATE_TOOLS], delegates: ['qa'] },
    })
  })

  it('meets aliases without granting the rest of their group or paid tools behind a closed gate', async () => {
    const loaded = await loadRoles(
      loaderDeps({
        '.home/.config/muse/agents/engineering/AGENT.md': file(
          'tools: ide__getDiagnostics, generate_image\n',
        ),
      }),
      ROOTS,
      {
        trustedWorkspace: true,
        inputs: {
          kind: 'known',
          value: {
            ...ENVIRONMENT,
            session: {
              ...ENVIRONMENT.session,
              offered: ['getDiagnostics', 'generate_image', 'edit_image'],
              imagesAllowed: false,
            },
          },
        },
      },
    )
    expect(resolveRole(loaded, 'engineering')).toMatchObject({
      kind: 'found',
      role: { tools: ['getDiagnostics'] },
    })
  })
})
