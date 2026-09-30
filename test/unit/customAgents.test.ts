import { describe, expect, it } from 'vitest'
import {
  type AgentsLoad,
  builtinAgents,
  loadAgents,
  narrowApprovalMode,
  narrowTools,
  parseAgentFile,
  personalAgentsRoot,
  projectAgentsRoot,
  resolveAgentEffort,
  resolveAgentModel,
} from '../../src/core/context/customAgents'
import {
  AGENT_FILE_MAX_BYTES,
  BUILTIN_AGENT_EXPLORE_ID,
  BUILTIN_AGENT_SECOND_OPINION_ID,
  MODEL_API_SUBAGENT_TOOLS,
  MODEL_API_TOOLS,
} from '../../src/shared/constants'
import { loaderDeps } from './helpers/fakeContextIo'

const ROOT = '/ws'
const USER_ROOT = '/ws/.home/.config/muse/agents'

const memoryIo = (files: Record<string, string | Uint8Array>) => loaderDeps(files).io

const agentFile = (name: string, description: string, extra = '', body = `# ${name}\n\nDo it.`) =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n${body}\n`

function agentIds(load: AgentsLoad): string[] {
  return load.agents.map((agent) => `${agent.source}:${agent.id}`)
}

describe('parseAgentFile', () => {
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

  it('ignores unknown keys and treats an empty tools list as absent', () => {
    expect(parseAgentFile(agentFile('x', 'd', 'future: yes\ntools: " , "\n'))).toMatchObject({
      ok: true,
      agent: { tools: undefined, model: undefined, effort: undefined, approvalMode: undefined },
    })
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
      expect.stringMatching(/^project agent big skipped: AGENT\.md is \d+ bytes, over the/),
      'project agent broken skipped: front matter is missing',
      'project agent mismatched: front matter name other differs from the directory; the directory name is the selector',
    ])
  })

  it('skips an agent directory without its file', async () => {
    const io = memoryIo({ '.agents/agents/empty/other.txt': 'not an agent\n' })
    const load = await loadAgents({ io, platform: 'linux' }, roots)
    expect(load.agents.map((agent) => agent.id)).toEqual(['explore', 'second-opinion'])
    expect(load.warnings).toEqual(['project agent empty skipped: AGENT.md is missing'])
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
