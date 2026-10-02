import { describe, expect, it } from 'vitest'
import {
  type AgentsLoad,
  builtinAgents,
  loadAgents,
  narrowApprovalMode,
  narrowTools,
  offeredAgents,
  parseAgentFile,
  personalAgentsRoot,
  projectAgentsRoot,
  resolveAgent,
  resolveAgentEffort,
  resolveAgentModel,
} from '../../src/core/context/customAgents'
import {
  AGENT_DESCRIPTION_MAX_CHARS,
  AGENT_FILE_MAX_BYTES,
  AGENT_MAX_FILES,
  AGENT_MODEL_MAX_CHARS,
  AGENT_NAME_MAX_CHARS,
  AGENT_TOOLS_MAX,
  BUILTIN_AGENT_EXPLORE_ID,
  BUILTIN_AGENT_SECOND_OPINION_ID,
  MODEL_API_SUBAGENT_TOOLS,
  MODEL_API_TOOLS,
} from '../../src/shared/constants'
import { loaderDeps, memoryContextIo, memoryTree } from './helpers/fakeContextIo'

const ROOT = '/ws'
const USER_ROOT = '/ws/.home/.config/muse/agents'

const memoryIo = (files: Record<string, string | Uint8Array>) => loaderDeps(files).io

const agentFile = (name: string, description: string, extra = '', body = `# ${name}\n\nDo it.`) =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n${body}\n`

function agentIds(load: AgentsLoad): string[] {
  return load.agents.map((agent) => `${agent.source}:${agent.id}`)
}

const parseWith = (name: string, description: string, extra = '') =>
  parseAgentFile(agentFile(name, description, extra))

describe('parseAgentFile', () => {
  it.each(['manual', 'acceptEdits'] as const)(
    'retains the %s UI policy even though both modes map to promptUnmatched (RV76 P1)',
    (permissionMode) => {
      expect(
        parseWith('writer', 'Writes files', `permission-mode: ${permissionMode}\n`),
      ).toMatchObject({
        ok: true,
        agent: { approvalMode: 'promptUnmatched', permissionMode },
      })
    },
  )

  it('reads the full front matter and the body', () => {
    expect(
      parseAgentFile(
        agentFile(
          'scout',
          'Scouting',
          'tools: read_file, search\nmodel: muse-spark-1.3\neffort: max\npermission-mode: plan\n',
        ),
      ),
    ).toEqual({
      ok: true,
      agent: {
        name: 'scout',
        description: 'Scouting',
        body: '# scout\n\nDo it.',
        tools: ['read_file', 'search'],
        model: 'muse-spark-1.3',
        effort: 'max',
        approvalMode: 'denyUnmatched',
        permissionMode: 'plan',
      },
    })
  })

  it("leaves the session's tools, model, effort and mode alone when absent", () => {
    expect(parseAgentFile(agentFile('scout', 'Scouting'))).toEqual({
      ok: true,
      agent: {
        name: 'scout',
        description: 'Scouting',
        body: '# scout\n\nDo it.',
        tools: undefined,
        model: undefined,
        effort: undefined,
        approvalMode: undefined,
      },
    })
  })

  it('names what is wrong with a malformed file', () => {
    expect(parseAgentFile('# no front matter')).toEqual({
      ok: false,
      reason: 'front matter is missing',
    })
    expect(parseAgentFile('---\nname: x\n')).toEqual({
      ok: false,
      reason: 'front matter is not closed',
    })
    expect(parseAgentFile('---\ndescription: d\n---\n')).toEqual({
      ok: false,
      reason: 'front matter has an invalid name',
    })
    expect(parseAgentFile('---\nname: x\ndescription:\n---\n')).toEqual({
      ok: false,
      reason: 'front matter has an invalid description',
    })
    expect(parseAgentFile(agentFile('x', 'd', 'effort: ultra\npermission-mode: super\n'))).toEqual({
      ok: false,
      reason: 'front matter has an invalid effort, permission-mode',
    })
  })

  it('ignores unknown keys, comments and blank lines, and keeps each tool once', () => {
    const extra = '# a note\n\nfuture: yes\ntools: read_file, search, read_file\n'
    expect(parseAgentFile(agentFile('x', 'd', extra))).toMatchObject({
      ok: true,
      agent: { tools: ['read_file', 'search'], model: undefined, effort: undefined },
    })
  })

  // A tools line that does not name tools must never read as "every tool":
  // the file is refused, because what it could not say was a narrowing.
  it.each([
    ['an empty tools line', 'tools:\n'],
    ['a blank list', 'tools: " , "\n'],
    ['a trailing comma', 'tools: read_file,\n'],
    ['a YAML flow list', 'tools: [read_file, search]\n'],
    ['a tool name with a space', 'tools: read file\n'],
    [
      'too many tools',
      `tools: ${Array.from({ length: AGENT_TOOLS_MAX + 1 }, (_, index) => `t${String(index)}`).join(',')}\n`,
    ],
  ])('refuses %s', (_name, extra) => {
    expect(parseAgentFile(agentFile('x', 'd', extra))).toEqual({
      ok: false,
      reason: 'front matter has an invalid tools',
    })
  })

  it('refuses a YAML block list or an indented value instead of dropping its lines', () => {
    const reason =
      'front matter has a line that is not "key: value" (lists and indented values are not supported)'
    expect(parseAgentFile(agentFile('x', 'd', 'tools:\n  - read_file\n  - search\n'))).toEqual({
      ok: false,
      reason,
    })
    expect(parseAgentFile(agentFile('x', 'd', 'permission-mode: plan\n  extra\n'))).toEqual({
      ok: false,
      reason,
    })
  })

  it('refuses a repeated key, whichever line would have won', () => {
    expect(
      parseAgentFile(agentFile('x', 'd', 'permission-mode: plan\npermission-mode: auto\n')),
    ).toEqual({ ok: false, reason: 'front matter repeats permission-mode' })
    expect(parseAgentFile(agentFile('x', 'd', 'tools: read_file\ntools: bash\n'))).toEqual({
      ok: false,
      reason: 'front matter repeats tools',
    })
  })

  it('bounds every field that reaches a prompt', () => {
    const parse = parseWith
    expect(parse('n'.repeat(AGENT_NAME_MAX_CHARS), 'd')).toMatchObject({ ok: true })
    expect(parse('n'.repeat(AGENT_NAME_MAX_CHARS + 1), 'd')).toEqual({
      ok: false,
      reason: 'front matter has an invalid name',
    })
    expect(parse('x', 'd'.repeat(AGENT_DESCRIPTION_MAX_CHARS))).toMatchObject({ ok: true })
    expect(parse('x', 'd'.repeat(AGENT_DESCRIPTION_MAX_CHARS + 1))).toEqual({
      ok: false,
      reason: 'front matter has an invalid description',
    })
    expect(parse('x', 'd', `model: ${'m'.repeat(AGENT_MODEL_MAX_CHARS + 1)}\n`)).toEqual({
      ok: false,
      reason: 'front matter has an invalid model',
    })
  })

  it.each([
    ['a direction override', 'safe \u{202E}evil'],
    ['a zero-width character', 'safe\u{200B}evil'],
    ['a terminal escape', 'safe \u{1B}[2Jevil'],
    ['a NUL', 'safe\u{0}evil'],
  ])('refuses %s in a name, a description or a model', (_name, hidden) => {
    expect(parseAgentFile(agentFile('x', hidden))).toEqual({
      ok: false,
      reason: 'front matter has an invalid description',
    })
    expect(parseAgentFile(agentFile(hidden, 'd'))).toEqual({
      ok: false,
      reason: 'front matter has an invalid name',
    })
    expect(parseAgentFile(agentFile('x', 'd', `model: ${hidden}\n`))).toEqual({
      ok: false,
      reason: 'front matter has an invalid model',
    })
  })

  it('keeps a tab in a description', () => {
    expect(parseAgentFile(agentFile('x', 'a\tb'))).toMatchObject({ ok: true })
  })
})

describe('agent roots', () => {
  it('follow the workspace and the Muse config home on both path styles', () => {
    expect(projectAgentsRoot('/ws', 'linux')).toBe('/ws/.agents/agents')
    expect(projectAgentsRoot(String.raw`C:\ws`, 'win32')).toBe(String.raw`C:\ws\.agents\agents`)
    expect(
      personalAgentsRoot({ platform: 'linux', homeDir: '/home/r', xdgConfigHome: undefined }),
    ).toBe('/home/r/.config/muse/agents')
    expect(
      personalAgentsRoot({ platform: 'linux', homeDir: '/home/r', xdgConfigHome: '/xdg' }),
    ).toBe('/xdg/muse/agents')
    expect(
      personalAgentsRoot({
        platform: 'win32',
        homeDir: String.raw`C:\Users\r`,
        xdgConfigHome: undefined,
      }),
    ).toBe(String.raw`C:\Users\r\.config\muse\agents`)
  })
})

describe('builtinAgents', () => {
  it('ships Explore read-only and Second opinion at high effort', () => {
    const agents = builtinAgents()
    expect(agents.map((agent) => `${agent.source}:${agent.id}`)).toEqual([
      `builtin:${BUILTIN_AGENT_EXPLORE_ID}`,
      `builtin:${BUILTIN_AGENT_SECOND_OPINION_ID}`,
    ])
    const explore = agents[0]
    expect(explore?.description).not.toBe('')
    expect(explore?.body).not.toBe('')
    expect(explore?.tools).toEqual([
      MODEL_API_TOOLS.readFile,
      MODEL_API_TOOLS.search,
      MODEL_API_TOOLS.listFiles,
      MODEL_API_TOOLS.readSkill,
    ])
    for (const tool of [
      MODEL_API_TOOLS.writeFile,
      MODEL_API_TOOLS.editFile,
      MODEL_API_TOOLS.bash,
      MODEL_API_TOOLS.powershell,
      MODEL_API_TOOLS.askUser,
      MODEL_API_SUBAGENT_TOOLS.spawn,
    ]) {
      expect(explore?.tools).not.toContain(tool)
    }
    const second = agents[1]
    expect(second?.tools).toBeUndefined()
    expect(second?.model).toBeUndefined()
    expect(second?.effort).toBe('high')
    expect(second?.approvalMode).toBeUndefined()
  })
})

describe('loadAgents', () => {
  const roots = [
    { directory: `${ROOT}/.agents/agents`, source: 'project' as const, confineTo: ROOT },
    { directory: USER_ROOT, source: 'user' as const, confineTo: undefined },
  ]

  it('lists the built-ins first, then project before user, ids sorted', async () => {
    const io = memoryIo({
      '.agents/agents/zeta/AGENT.md': agentFile('zeta', 'Last'),
      '.agents/agents/alpha/AGENT.md': agentFile('alpha', 'First'),
      '.home/.config/muse/agents/beta/AGENT.md': agentFile('beta', 'Personal beta'),
    })
    const load = await loadAgents({ io, platform: 'linux' }, roots)
    expect(agentIds(load)).toEqual([
      'builtin:explore',
      'builtin:second-opinion',
      'project:alpha',
      'project:zeta',
      'user:beta',
    ])
    expect(load.warnings).toEqual([])
  })

  it('lets a file shadow a built-in or a personal agent with the same id', async () => {
    const io = memoryIo({
      '.agents/agents/explore/AGENT.md': agentFile('explore', 'Project explorer'),
      '.agents/agents/scout/AGENT.md': agentFile('scout', 'Project scout'),
      '.home/.config/muse/agents/scout/AGENT.md': agentFile('scout', 'Personal scout'),
    })
    const load = await loadAgents({ io, platform: 'linux' }, roots)
    expect(agentIds(load)).toEqual(['builtin:second-opinion', 'project:explore', 'project:scout'])
    expect(load.warnings).toEqual([
      'user agent scout skipped: the project agent with the same id takes precedence',
      'builtin agent explore skipped: the project agent with the same id takes precedence',
    ])
  })

  it('skips what it cannot load, naming each reason', async () => {
    const big = `---\nname: big\ndescription: big\n---\n\n${'x'.repeat(AGENT_FILE_MAX_BYTES)}\n`
    const io = memoryIo({
      '.agents/agents/BAD/AGENT.md': agentFile('BAD', 'Bad id'),
      '.agents/agents/big/AGENT.md': big,
      '.agents/agents/broken/AGENT.md': 'no front matter',
      '.agents/agents/mismatched/AGENT.md': agentFile('other', 'Other name'),
    })
    const load = await loadAgents({ io, platform: 'linux' }, roots)
    expect(agentIds(load)).toEqual([
      'builtin:explore',
      'builtin:second-opinion',
      'project:mismatched',
    ])
    expect(load.warnings).toEqual([
      'project agent BAD skipped: the directory name is not a valid agent id',
      `project agent big skipped: AGENT.md is over the ${String(AGENT_FILE_MAX_BYTES)} byte limit`,
      'project agent broken skipped: front matter is missing',
      'project agent mismatched: front matter name other differs from the directory; the directory name is the selector',
    ])
  })

  it('reads each agent file within its cap, never whole', async () => {
    const requested: (number | undefined)[] = []
    const inner = memoryIo({
      '.agents/agents/huge/AGENT.md': 'x'.repeat(10 * AGENT_FILE_MAX_BYTES),
    })
    const io = {
      ...inner,
      readFile: (file: string, maxBytes?: number) => {
        requested.push(maxBytes)
        return inner.readFile(file, maxBytes)
      },
    }
    const load = await loadAgents({ io, platform: 'linux' }, roots)
    expect(requested).toEqual([AGENT_FILE_MAX_BYTES])
    expect(load.warnings).toEqual([
      `project agent huge skipped: AGENT.md is over the ${String(AGENT_FILE_MAX_BYTES)} byte limit`,
    ])
  })

  it('reads the approved canonical file when a project link changes after confinement', async () => {
    const alias = `${ROOT}/.agents/agents/scout`
    const links = { [alias]: `${ROOT}/kept/scout` }
    const files = memoryTree(
      { 'kept/scout/AGENT.md': agentFile('scout', 'Kept', '', 'Confined prompt') },
      ROOT,
    )
    files.set('/outside/scout/AGENT.md', agentFile('scout', 'Outside', '', 'Outside prompt'))
    const inner = memoryContextIo(files, links)
    const io = {
      ...inner,
      realPath: async (file: string) => {
        const checked = await inner.realPath(file)
        // The link was inside when checked; another process replaces it
        // before the read. Reading the alias again would expose outside text.
        if (file === `${alias}/AGENT.md`) links[alias] = '/outside/scout'
        return checked
      },
    }
    const load = await loadAgents({ io, platform: 'linux' }, roots)
    expect(load.agents.find((agent) => agent.id === 'scout')?.body).toBe('Confined prompt')
    expect(load.warnings).toEqual([])
  })

  it('loads at most AGENT_MAX_FILES files, naming each one left out', async () => {
    const id = (index: number) => `a${String(index).padStart(3, '0')}`
    const files: Record<string, string> = {}
    for (let index = 0; index < AGENT_MAX_FILES + 2; index += 1) {
      files[`.agents/agents/${id(index)}/AGENT.md`] = agentFile(id(index), 'Many')
    }
    files['.home/.config/muse/agents/mine/AGENT.md'] = agentFile('mine', 'Personal')
    const load = await loadAgents({ io: memoryIo(files), platform: 'linux' }, roots)
    const loaded = load.agents.filter((agent) => agent.source !== 'builtin')
    expect(loaded).toHaveLength(AGENT_MAX_FILES)
    expect(load.warnings).toEqual([
      `project agent ${id(AGENT_MAX_FILES)} skipped: only the first ${String(AGENT_MAX_FILES)} agents are loaded`,
      `project agent ${id(AGENT_MAX_FILES + 1)} skipped: only the first ${String(AGENT_MAX_FILES)} agents are loaded`,
      `user agent mine skipped: only the first ${String(AGENT_MAX_FILES)} agents are loaded`,
    ])
  })

  it('refuses a file whose front matter it cannot read whole, naming why', async () => {
    const io = memoryIo({
      '.agents/agents/listy/AGENT.md': agentFile(
        'listy',
        'Tools as a YAML list',
        'tools:\n  - read_file\n',
      ),
    })
    const load = await loadAgents({ io, platform: 'linux' }, roots)
    expect(load.agents.map((agent) => agent.id)).toEqual(['explore', 'second-opinion'])
    expect(load.warnings).toEqual([
      'project agent listy skipped: front matter has a line that is not "key: value" (lists and indented values are not supported)',
    ])
  })

  it('skips an agent directory without its file', async () => {
    const io = memoryIo({ '.agents/agents/empty/other.txt': 'not an agent\n' })
    const load = await loadAgents({ io, platform: 'linux' }, roots)
    expect(load.agents.map((agent) => agent.id)).toEqual(['explore', 'second-opinion'])
    expect(load.warnings).toEqual(['project agent empty skipped: AGENT.md is missing'])
    // A directory without a definition holds none: nothing is refused for it.
    expect(load.holes).toEqual([])
    expect(resolveAgent(load, 'explore')).toMatchObject({
      kind: 'found',
      agent: { source: 'builtin' },
    })
  })
})

const DENIED = 'EACCES: permission denied'

/** The memory files, with one directory's listing or one file's read refused. */
function deniedIo(
  files: Record<string, string>,
  denied: { readonly directory?: string; readonly file?: string },
) {
  const io = memoryIo(files)
  return {
    ...io,
    listDirectory: (directory: string) =>
      directory === denied.directory
        ? Promise.reject(new Error(DENIED))
        : io.listDirectory(directory),
    readFile: (file: string, maxBytes?: number) =>
      file === denied.file ? Promise.reject(new Error(DENIED)) : io.readFile(file, maxBytes),
  }
}

describe('agent precedence over a root that did not load (M76 review, RV70x)', () => {
  const roots = [
    { directory: `${ROOT}/.agents/agents`, source: 'project' as const, confineTo: ROOT },
    { directory: USER_ROOT, source: 'user' as const, confineTo: undefined },
  ]
  const readOnlyConsult = agentFile(
    'second-opinion',
    'A read-only consult',
    'tools: read_file\npermission-mode: manual\n',
  )

  // RV70x finding 1: the personal root's EACCES used to discard the read
  // project file and hand its id to the inheriting built-in.
  it('keeps a loaded project agent when the personal root cannot be listed', async () => {
    const io = deniedIo(
      { '.agents/agents/second-opinion/AGENT.md': readOnlyConsult },
      { directory: USER_ROOT },
    )
    const load = await loadAgents({ io, platform: 'linux' }, roots)
    expect(resolveAgent(load, 'second-opinion')).toMatchObject({
      kind: 'found',
      agent: { source: 'project', tools: ['read_file'], permissionMode: 'manual' },
    })
    expect(load.warnings).toEqual([
      `loading the user agents failed: ${DENIED}`,
      'builtin agent second-opinion skipped: the project agent with the same id takes precedence',
    ])
    // The personal root may hold an agent above a built-in: none runs instead.
    expect(resolveAgent(load, 'explore')).toEqual({
      kind: 'unloaded',
      hole: { source: 'user', id: undefined, path: USER_ROOT },
    })
    expect(agentIds({ ...load, agents: offeredAgents(load) })).toEqual(['project:second-opinion'])
  })

  it('refuses every lower definition by name when the project root cannot be listed', async () => {
    const io = deniedIo(
      { '.home/.config/muse/agents/helper/AGENT.md': agentFile('helper', 'Helping') },
      { directory: `${ROOT}/.agents/agents` },
    )
    const load = await loadAgents({ io, platform: 'linux' }, roots)
    const hole = { source: 'project', id: undefined, path: '.agents/agents' }
    for (const id of ['helper', 'explore', 'nope']) {
      expect(resolveAgent(load, id)).toEqual({ kind: 'unloaded', hole })
    }
    expect(offeredAgents(load)).toEqual([])
    expect(load.warnings).toEqual([`loading the project agents failed: ${DENIED}`])
  })

  it.each([
    {
      name: 'unreadable',
      files: { '.agents/agents/explore/AGENT.md': agentFile('explore', 'Mine') },
      deniedFile: `${ROOT}/.agents/agents/explore/AGENT.md`,
    },
    {
      name: 'refused front matter',
      files: {
        '.agents/agents/explore/AGENT.md': agentFile('explore', 'Mine', 'tools:\n  - read_file\n'),
      },
      deniedFile: undefined,
    },
    {
      name: 'over the cap',
      files: {
        '.agents/agents/explore/AGENT.md': agentFile(
          'explore',
          'Mine',
          '',
          'x'.repeat(AGENT_FILE_MAX_BYTES),
        ),
      },
      deniedFile: undefined,
    },
  ])(
    'refuses a name whose project file did not load instead of running the built-in: $name',
    async ({ files, deniedFile }) => {
      const io = deniedIo(files, deniedFile === undefined ? {} : { file: deniedFile })
      const load = await loadAgents({ io, platform: 'linux' }, roots)
      expect(resolveAgent(load, 'explore')).toEqual({
        kind: 'unloaded',
        hole: { source: 'project', id: 'explore', path: '.agents/agents/explore/AGENT.md' },
      })
      // Other names are untouched by that one file.
      expect(resolveAgent(load, 'second-opinion')).toMatchObject({
        kind: 'found',
        agent: { source: 'builtin' },
      })
      expect(offeredAgents(load).map((agent) => agent.id)).toEqual(['second-opinion'])
    },
  )

  it('refuses a personal agent shadowed by a project file that did not load', async () => {
    const io = memoryIo({
      '.agents/agents/scout/AGENT.md': 'no front matter',
      '.home/.config/muse/agents/scout/AGENT.md': agentFile('scout', 'Personal scout'),
    })
    const load = await loadAgents({ io, platform: 'linux' }, roots)
    expect(resolveAgent(load, 'scout')).toMatchObject({
      kind: 'unloaded',
      hole: { source: 'project', id: 'scout' },
    })
  })

  it('answers unknown only when every root was listed', async () => {
    const load = await loadAgents({ io: memoryIo({}), platform: 'linux' }, roots)
    expect(resolveAgent(load, 'nope')).toEqual({ kind: 'unknown' })
  })
})

describe('narrowApprovalMode', () => {
  it('keeps the session mode without an agent ceiling', () => {
    expect(narrowApprovalMode('allowAll', undefined)).toBe('allowAll')
    expect(narrowApprovalMode('denyUnmatched', undefined)).toBe('denyUnmatched')
  })

  it('takes the agent ceiling when it narrows, never when it widens', () => {
    expect(narrowApprovalMode('allowAll', 'onRequest')).toBe('onRequest')
    expect(narrowApprovalMode('allowAll', 'denyUnmatched')).toBe('denyUnmatched')
    expect(narrowApprovalMode('onRequest', 'promptUnmatched')).toBe('promptUnmatched')
    expect(narrowApprovalMode('promptUnmatched', 'denyUnmatched')).toBe('denyUnmatched')
    expect(narrowApprovalMode('onRequest', 'allowAll')).toBe('onRequest')
    expect(narrowApprovalMode('promptUnmatched', 'onRequest')).toBe('promptUnmatched')
    expect(narrowApprovalMode('denyUnmatched', 'allowAll')).toBe('denyUnmatched')
    expect(narrowApprovalMode('onRequest', 'onRequest')).toBe('onRequest')
  })
})

describe('narrowTools', () => {
  const session = ['read_file', 'search', 'write_file', 'bash']

  it('keeps the session set without an agent allowlist', () => {
    expect(narrowTools(session, undefined)).toBeUndefined()
  })

  it('meets the allowlist with what the session offers', () => {
    expect(narrowTools(session, ['search', 'write_file'])).toEqual(['search', 'write_file'])
    expect(narrowTools(session, ['search', 'nope'])).toEqual(['search'])
    expect(narrowTools(session, ['nope'])).toEqual([])
  })
})

describe('resolveAgentModel', () => {
  it('prefers the agent model, else the session model', () => {
    expect(resolveAgentModel('muse-spark-1.3', 'muse-spark-1.2')).toBe('muse-spark-1.2')
    expect(resolveAgentModel('muse-spark-1.3', undefined)).toBe('muse-spark-1.3')
  })
})

describe('resolveAgentEffort', () => {
  it('keeps a served tier and drops a stale one to the highest served', () => {
    expect(resolveAgentEffort('muse-spark-1.3', 'max')).toBe('max')
    expect(resolveAgentEffort('muse-spark-1.2', 'max')).toBe('xhigh')
    expect(resolveAgentEffort('muse-spark-1.2', undefined)).toBe('high')
    expect(resolveAgentEffort('unknown-model', undefined)).toBe('high')
  })
})
