// The import's scan, plan and apply (M83, PLAN.md D49) over fixture folders
// for each tool. The scope rule: the user's own folders go only to the
// user's files, a repository's only to that project's files and only in a
// trusted workspace, every repository path confined to the workspace.

import { describe, expect, it, vi } from 'vitest'
import {
  applyImportWrites,
  type ImportCandidate,
  type ImportDestinations,
  type ImportPlanState,
  type ImportScanInput,
  importDisplayPath,
  planImportApply,
  scanAgentImports,
} from '../../src/core/import/agentImport'
import {
  AGENT_IMPORT_FILE_MAX_BYTES,
  type AgentImportSource,
  RULES_FILE_MAX_BYTES,
} from '../../src/shared/constants'
import {
  type MemoryImportIo,
  memoryImportIo,
  type MemoryImportTree,
} from './helpers/memoryImportIo'
import { SYNTHETIC } from './helpers/syntheticTokens'

const HOME = '/home/u'
const WS = '/ws'
const SECRET = SYNTHETIC.githubToken

function agentFile(name: string, body: string, fields = ''): string {
  return `---\nname: ${name}\ndescription: ${name} agent\n${fields}---\n\n${body}\n`
}

// Every tool's own files, user and project, where their documentation places them.
const FIXTURES: Record<string, string> = {
  // Claude Code: user and local-scope servers in ~/.claude.json, hooks in settings.
  [`${HOME}/.claude.json`]: JSON.stringify({
    oauthAccount: { emailAddress: 'someone@example.com' },
    mcpServers: { github: { command: 'gh-mcp', env: { GH_HOST: 'github.example.com' } } },
    projects: { [WS]: { mcpServers: { local: { command: 'local-mcp' } } } },
  }),
  [`${HOME}/.claude/settings.json`]: JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard' }] }] },
  }),
  [`${HOME}/.claude/agents/reviewer.md`]: agentFile('reviewer', 'Review carefully.'),
  [`${HOME}/.claude/commands/review.md`]: '---\ndescription: Reviews\n---\n\nReview.\n',
  [`${HOME}/.claude/commands/frontend/component.md`]: 'Make a component.\n',
  [`${HOME}/.claude/CLAUDE.md`]: 'My own rules.\n',
  [`${WS}/.mcp.json`]: JSON.stringify({ mcpServers: { shared: { command: 'shared-mcp' } } }),
  [`${WS}/.claude/settings.json`]: JSON.stringify({
    hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'fmt' }] }] },
  }),
  [`${WS}/.claude/commands/ship.md`]: 'Ship it.\n',
  [`${WS}/CLAUDE.md`]: 'Project rules.\n',
  // Codex: config.toml servers and prompts at home; a project config.
  [`${HOME}/.codex/config.toml`]: '[mcp_servers.docs]\ncommand = "docs-mcp"\n',
  [`${HOME}/.codex/prompts/explain.md`]: 'Explain.\n',
  [`${HOME}/.codex/AGENTS.md`]: 'Codex rules.\n',
  [`${WS}/.codex/config.toml`]: '[mcp_servers.projectdocs]\ncommand = "p"\n',
  [`${WS}/AGENTS.md`]: '# Project\n',
  // Cursor: mcp.json and commands at home; agents and rules in the project.
  [`${HOME}/.cursor/mcp.json`]: JSON.stringify({ mcpServers: { web: { url: 'https://w/mcp' } } }),
  [`${HOME}/.cursor/commands/tidy.md`]: 'Tidy.\n',
  [`${WS}/.cursor/rules/ts.mdc`]: '---\ndescription: TypeScript\nglobs: *.ts\n---\n\nStrict.\n',
  [`${WS}/.cursorrules`]: 'Legacy rules.\n',
  [`${WS}/.cursor/agents/helper.md`]: agentFile('helper', 'Help.'),
}

const ALL_SOURCES: readonly AgentImportSource[] = ['claudeCode', 'codex', 'cursor']

function input(
  tree: MemoryImportTree,
  overrides: Partial<ImportScanInput> = {},
): ImportScanInput & { readonly io: MemoryImportIo } {
  return {
    platform: 'linux',
    homeDir: HOME,
    claudeConfigDir: undefined,
    codexHome: undefined,
    workspaceRoot: WS,
    isWorkspaceTrusted: () => true,
    isActive: () => true,
    sources: ALL_SOURCES,
    ...overrides,
    io: memoryImportIo(tree),
  }
}

function targetOf(candidate: ImportCandidate): string {
  const { target } = candidate
  switch (target.kind) {
    case 'none': {
      return `none:${target.reason}`
    }
    case 'file': {
      return `${target.scope} ${target.root}/${target.relativePath}`
    }
    case 'hook': {
      return `hook:${target.file}`
    }
    case 'rules':
    case 'server': {
      return target.kind
    }
  }
}

function summary(candidates: readonly ImportCandidate[]): readonly string[] {
  return candidates.map(
    (candidate) =>
      `${candidate.kind} ${candidate.source} ${candidate.origin} ${candidate.label} -> ${targetOf(candidate)}`,
  )
}

describe('scanAgentImports', () => {
  it.each(['trust', 'activation'])(
    'does not resolve project folders without live %s',
    async (guard) => {
      const setup = input(
        { files: FIXTURES },
        {
          isWorkspaceTrusted: () => guard !== 'trust',
          isActive: () => guard !== 'activation',
        },
      )
      const realPath = vi.fn(setup.io.realPath)
      setup.io.realPath = realPath
      await scanAgentImports(setup)
      if (guard === 'activation') expect(realPath).not.toHaveBeenCalled()
      else expect(setup.io.reads.every((file) => !file.startsWith(`${WS}/`))).toBe(true)
      if (guard === 'activation') expect(setup.io.reads).toEqual([])
    },
  )

  it('finds every tool’s entries and sends each only where its scope allows', async () => {
    const scan = await scanAgentImports(input({ files: FIXTURES }))
    expect(summary(scan.candidates)).toEqual([
      'mcpServer claudeCode user github -> server',
      'mcpServer claudeCode user local -> server',
      'hook claudeCode user PreToolUse -> hook:settings',
      'agent claudeCode user reviewer -> user agents/reviewer/AGENT.md',
      'command claudeCode user frontend/component -> user skills/frontend-component/SKILL.md',
      'command claudeCode user review -> user skills/review/SKILL.md',
      'rules claudeCode user CLAUDE.md -> none:userRules',
      'mcpServer claudeCode project shared -> none:projectServer',
      'hook claudeCode project PostToolUse -> hook:hooks',
      'command claudeCode project ship -> project skills/ship/SKILL.md',
      'rules claudeCode project CLAUDE.md -> rules',
      'mcpServer codex user docs -> server',
      'command codex user explain -> user skills/explain/SKILL.md',
      'rules codex user AGENTS.md -> none:userRules',
      'mcpServer codex project projectdocs -> none:projectServer',
      'mcpServer cursor user web -> server',
      'command cursor user tidy -> user skills/tidy/SKILL.md',
      'agent cursor project helper -> project agents/helper/AGENT.md',
      'rules cursor project ts.mdc -> rules',
      'rules cursor project .cursorrules -> rules',
    ])
    expect(scan.warnings).toEqual([])
  })

  it('reads no repository file in an untrusted workspace (the scope drill)', async () => {
    const setup = input({ files: FIXTURES }, { isWorkspaceTrusted: () => false })
    const scan = await scanAgentImports(setup)
    expect(scan.candidates.length).toBeGreaterThan(0)
    expect(scan.candidates.every((candidate) => candidate.origin === 'user')).toBe(true)
    expect(setup.io.reads.filter((path) => path.startsWith(`${WS}/`))).toEqual([])
  })

  it('offers a repository’s entries only for the project and the user’s only for theirs', async () => {
    const scan = await scanAgentImports(input({ files: FIXTURES }))
    const crossings = scan.candidates.filter((candidate) => {
      const { target } = candidate
      switch (target.kind) {
        case 'file': {
          return target.scope !== candidate.origin
        }
        case 'hook': {
          return target.file !== (candidate.origin === 'user' ? 'settings' : 'hooks')
        }
        case 'server': {
          return candidate.origin !== 'user'
        }
        case 'rules': {
          return candidate.origin !== 'project'
        }
        case 'none': {
          return false
        }
      }
    })
    expect(crossings).toEqual([])
  })

  it('refuses a repository folder or file that leads outside the workspace', async () => {
    const setup = input({
      files: { ...FIXTURES, '/outside/cmds/steal.md': 'Steal.\n', '/outside/key': SECRET },
      links: {
        [`${WS}/.claude/commands`]: '/outside/cmds',
        [`${WS}/.cursorrules`]: '/outside/key',
      },
    })
    const scan = await scanAgentImports(setup)
    const labels = scan.candidates.map((candidate) => candidate.label)
    expect(labels).not.toContain('steal')
    expect(labels).not.toContain('.cursorrules')
    expect(setup.io.reads).not.toContain(`${WS}/.cursorrules`)
    expect(scan.warnings).toEqual([
      'leads outside the workspace, skipped',
      'leads outside the workspace, skipped',
    ])
  })

  it('follows the user’s own links, which are theirs to make', async () => {
    const scan = await scanAgentImports(
      input(
        {
          files: { [`${HOME}/dotfiles/claude/commands/dot.md`]: 'Dot.\n' },
          links: { [`${HOME}/.claude`]: `${HOME}/dotfiles/claude` },
        },
        { sources: ['claudeCode'] },
      ),
    )
    expect(summary(scan.candidates)).toEqual([
      'command claudeCode user dot -> user skills/dot/SKILL.md',
    ])
  })

  it('reads the home folder’s tool folders once, as the user’s, when it is the workspace', async () => {
    const scan = await scanAgentImports(
      input({ files: FIXTURES }, { workspaceRoot: HOME, sources: ['claudeCode'] }),
    )
    expect(scan.candidates.length).toBeGreaterThan(0)
    expect(scan.candidates.every((candidate) => candidate.origin === 'user')).toBe(true)
  })

  it('honours CLAUDE_CONFIG_DIR and CODEX_HOME and refuses a relative one', async () => {
    const files = {
      '/cfg/claude/.claude.json': JSON.stringify({ mcpServers: { a: { command: 'a' } } }),
      '/cfg/claude/commands/c.md': 'C.\n',
      '/cfg/codex/prompts/p.md': 'P.\n',
    }
    const scan = await scanAgentImports(
      input(
        { files },
        { claudeConfigDir: '/cfg/claude', codexHome: '/cfg/codex', workspaceRoot: undefined },
      ),
    )
    expect(scan.candidates.map((candidate) => candidate.label)).toEqual(['a', 'c', 'p'])
    const relative = await scanAgentImports(
      input({ files }, { codexHome: 'codex', sources: ['codex'], workspaceRoot: undefined }),
    )
    expect(relative.candidates).toEqual([])
    expect(relative.warnings).toEqual([
      "CODEX_HOME is not an absolute path, so that tool's own files are not read",
    ])
  })

  it('warns in fixed words, never with a file’s content', async () => {
    const scan = await scanAgentImports(
      input(
        {
          files: {
            [`${HOME}/.cursor/mcp.json`]: `{ "mcpServers": { "x": { "env": { "T": "${SECRET}" `,
            [`${HOME}/.codex/config.toml`]: `[mcp_servers.x\ncommand = "${SECRET}"`,
            [`${HOME}/.claude/settings.json`]: `{"hooks": "${SECRET}"}`,
            [`${HOME}/.cursor/commands/big.md`]: 'x'.repeat(70 * 1024),
            [`${HOME}/.cursor/commands/empty.md`]: '---\ndescription: none\n---\n',
          },
          failing: { [`${HOME}/.cursor/agents`]: 'EACCES' },
        },
        { workspaceRoot: undefined },
      ),
    )
    expect(scan.candidates).toEqual([])
    expect(scan.warnings).toEqual([
      'is not a readable settings file, skipped',
      'is not a readable Codex configuration, skipped',
      'is not an MCP servers file, skipped',
      'could not be listed (failed)',
      'is over the 65536 byte limit, skipped',
      'has no usable name or holds nothing, skipped',
    ])
    expect(scan.warnings.join('\n')).not.toContain(SECRET)
  })

  it('copies every active server env value unchanged at conversion, keeping its name', async () => {
    const scan = await scanAgentImports(input({ files: FIXTURES }))
    const servers = scan.candidates.filter((candidate) => candidate.kind === 'mcpServer')
    expect(JSON.stringify(servers)).toContain('"GH_HOST":"github.example.com"')
  })
})

// D64 preserves source content in permitted destinations.
describe('scanAgentImports: entries that may hold a credential', () => {
  const credentialFiles: Record<string, string> = {
    [`${HOME}/.claude.json`]: JSON.stringify({
      mcpServers: {
        github: { command: 'gh-mcp', env: { GITHUB_TOKEN: SECRET } },
        [`named-${SECRET}`]: { command: 'plain' },
      },
    }),
    [`${HOME}/.claude/settings.json`]: JSON.stringify({
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: `curl -H "Authorization: Bearer ${SECRET}"` }] },
        ],
        PreToolUse: [{ matcher: `Bash(${SECRET})`, hooks: [{ type: 'command', command: 'x' }] }],
      },
    }),
    [`${HOME}/.claude/commands/review.md`]: `---\ndescription: Reviews\n---\n\nUse ${SECRET}.\n`,
    // RV83d #7: a cue in the description that masking once cut mid-scalar.
    [`${HOME}/.claude/commands/keys.md`]: '---\ndescription: token=opaque-demo-value\n---\n\nGo.\n',
    [`${HOME}/.claude/agents/scout.md`]: agentFile('scout', 'Review.\npassword:\n  opaque'),
    [`${WS}/CLAUDE.md`]: "Project rules.\nTOKEN='prefix\nopaque-demo-value'\n",
  }

  it('keeps credential spellings unchanged in same-exposure targets', async () => {
    const setup = input({ files: credentialFiles }, { sources: ['claudeCode'] })
    const scan = await scanAgentImports(setup)
    expect(scan.candidates.some((candidate) => candidate.target.kind === 'none')).toBe(false)
    const plan = await planImportApply(scan.candidates, DESTINATIONS, planState(setup.io))
    expect(plan.skipped).toEqual([])
    expect(JSON.stringify(plan)).toContain(SECRET)
    expect(plan.writes).toHaveLength(4)
    expect(plan.copies).toHaveLength(1)
  })
})

describe('importDisplayPath', () => {
  it('shows workspace paths relative, home paths under ~, and others whole', () => {
    const context = { platform: 'linux', homeDir: HOME, workspaceRoot: WS } as const
    expect(importDisplayPath(`${WS}/a/b.md`, context)).toBe('a/b.md')
    expect(importDisplayPath(`${HOME}/.claude/x`, context)).toBe('~/.claude/x')
    expect(importDisplayPath('/etc/x', context)).toBe('/etc/x')
  })
})

const ROOT_IDENTITY = { canonical: WS, fileId: '' } as const

const DESTINATIONS: ImportDestinations = {
  platform: 'linux',
  homeDir: HOME,
  workspaceRoot: WS,
  workspaceIdentity: ROOT_IDENTITY,
  personalRoot: `${HOME}/.config/muse`,
  museSettingsFile: `${HOME}/.config/muse/settings.json`,
}

function planState(io: MemoryImportIo, overrides: Partial<ImportPlanState> = {}): ImportPlanState {
  const agentsFile = io.files.get(`${WS}/AGENTS.md`)
  return {
    io,
    isPresent: io.isPresent,
    rulesFile:
      agentsFile === undefined ? { status: 'missing' } : { status: 'read', text: agentsFile },
    museSettings: { status: 'missing' },
    hooksFile: 'missing',
    ...overrides,
  }
}

/** The fixture folders scanned and planned with every entry checked. */
async function plannedFixtures() {
  const setup = input({ files: FIXTURES })
  const scan = await scanAgentImports(setup)
  const plan = await planImportApply(scan.candidates, DESTINATIONS, planState(setup.io))
  return { setup, scan, plan }
}

describe('planImportApply', () => {
  it('writes files that do not exist, appends rules, and gives servers and hooks as copies', async () => {
    const { plan } = await plannedFixtures()
    expect(plan.writes.map((write) => `${write.mode} ${write.absolutePath}`)).toEqual([
      `create ${HOME}/.config/muse/agents/reviewer/AGENT.md`,
      `create ${HOME}/.config/muse/skills/frontend-component/SKILL.md`,
      `create ${HOME}/.config/muse/skills/review/SKILL.md`,
      `create ${WS}/.agents/skills/ship/SKILL.md`,
      `create ${HOME}/.config/muse/skills/explain/SKILL.md`,
      `create ${HOME}/.config/muse/skills/tidy/SKILL.md`,
      `create ${WS}/.agents/agents/helper/AGENT.md`,
      `append ${WS}/AGENTS.md`,
    ])
    // Neither Muse Code's settings file nor the hooks file is ever a write.
    const written = plan.writes.map((write) => write.absolutePath)
    expect(written).not.toContain(DESTINATIONS.museSettingsFile)
    expect(written).not.toContain(`${WS}/.muse/hooks.json`)
    expect(plan.copies.map((copy) => copy.file)).toEqual(['settings', 'hooks'])
    const [settings, hooks] = plan.copies
    expect(JSON.parse(settings?.text ?? '')).toEqual({
      schema_version: 1,
      mcpServers: {
        github: {
          type: 'stdio',
          command: 'gh-mcp',
          env: { GH_HOST: 'github.example.com' },
          mode: 'optional',
        },
        local: { type: 'stdio', command: 'local-mcp', mode: 'optional' },
        docs: { type: 'stdio', command: 'docs-mcp', mode: 'optional' },
        web: { type: 'streamable-http', url: 'https://w/mcp', mode: 'optional' },
      },
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard' }] }] },
    })
    expect(JSON.parse(hooks?.text ?? '')).toEqual({
      hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'fmt' }] }] },
    })
    expect(plan.skipped.map((skip) => skip.reason)).toEqual([
      'userRules',
      'projectServer',
      'userRules',
      'projectServer',
    ])
    const append = plan.writes.at(-1)
    expect(append?.content).toContain('## Imported from Claude Code (CLAUDE.md)')
    expect(append?.content).toContain('## Imported from Cursor (.cursor/rules/ts.mdc)')
    expect(append?.content).toContain('Files it applies to: *.ts')
  })

  it('never replaces what exists, keeps the first of two with one place, and skips known servers', async () => {
    const setup = input({
      files: {
        ...FIXTURES,
        [`${HOME}/.config/muse/skills/review/SKILL.md`]: 'mine',
        [`${WS}/AGENTS.md`]: '# Project\n\n## Imported from Claude Code (CLAUDE.md)\n\nOld.\n',
        [`${WS}/.cursor/commands/ship.md`]: 'Cursor ship.\n',
      },
    })
    const scan = await scanAgentImports(setup)
    const plan = await planImportApply(
      scan.candidates,
      DESTINATIONS,
      planState(setup.io, {
        museSettings: {
          status: 'read',
          text: JSON.stringify({ mcp_servers: { github: { command: 'mine' } } }),
        },
      }),
    )
    const reasonOf = (id: string): string | undefined =>
      plan.skipped.find((skip) => skip.candidateId === id)?.reason
    expect(reasonOf('command:claudeCode:user:review')).toBe('exists')
    expect(reasonOf('rules:claudeCode:project:CLAUDE.md')).toBe('exists')
    expect(reasonOf('command:cursor:project:ship')).toBe('duplicate')
    expect(reasonOf('mcpServer:claudeCode:user:github')).toBe('exists')
    expect(plan.hasLegacyMcpKey).toBe(true)
    const settings = plan.copies.find((copy) => copy.file === 'settings')
    expect(settings?.isNewFile).toBe(false)
    expect(JSON.parse(settings?.text ?? '')).not.toHaveProperty('schema_version')
  })
})

describe('applyImportWrites', () => {
  it('creates and appends, and refuses a destination that now leads outside', async () => {
    const { setup, scan, plan } = await plannedFixtures()
    // A link planted after the preview: the project's skills now lead out.
    const io = memoryImportIo({
      files: Object.fromEntries(setup.io.files),
      links: { [`${WS}/.agents/skills`]: '/outside/skills' },
    })
    const result = await applyImportWrites(plan.writes, io, 'linux')
    const ship = scan.candidates.find((candidate) => candidate.label === 'ship')
    expect(plan.writes.filter((write) => write.isProject).map((write) => write.root)).toEqual([
      WS,
      WS,
      WS,
    ])
    expect(result.skipped).toEqual([{ candidateId: ship?.id, reason: 'outside' }])
    expect(io.files.has('/outside/skills/ship/SKILL.md')).toBe(false)
    expect(io.files.get(`${HOME}/.config/muse/skills/review/SKILL.md`)).toBe(
      "---\nname: review\ndescription: 'Reviews'\n---\n\nReview.\n",
    )
    expect(io.files.get(`${WS}/AGENTS.md`)).toMatch(
      /^# Project\n\n## Imported from Claude Code \(CLAUDE\.md\)\n\nProject rules\.\n\n## Imported from Cursor/,
    )
  })

  it('never replaces a file that appeared since the preview, and reports a failure by its code', async () => {
    const write = {
      candidateIds: ['a'],
      sourceExposure: 'project-tracked',
      homeDir: HOME,
      workspaceRoot: WS,
      absolutePath: `${WS}/.agents/skills/a/SKILL.md`,
      content: 'new',
      mode: 'create',
      sections: [],
      root: WS,
      isProject: true,
      rootIdentity: ROOT_IDENTITY,
    } as const
    const failingPath = `${WS}/.agents/skills/b/SKILL.md`
    const io = memoryImportIo({
      files: { [write.absolutePath]: 'theirs' },
      failing: { [failingPath]: 'EROFS' },
    })
    const result = await applyImportWrites(
      [write, { ...write, candidateIds: ['b'], absolutePath: failingPath }],
      io,
      'linux',
    )
    expect(io.files.get(write.absolutePath)).toBe('theirs')
    expect(result.skipped).toEqual([
      { candidateId: 'a', reason: 'exists' },
      { candidateId: 'b', reason: 'failed' },
    ])
    expect(result.failures).toEqual([{ absolutePath: failingPath, code: 'EROFS' }])
  })

  it('does not add a rules section that reached AGENTS.md while the preview was open', async () => {
    const { setup, plan } = await plannedFixtures()
    // A second import, accepted first, already appended the Claude Code section.
    setup.io.files.set(
      `${WS}/AGENTS.md`,
      '# Project\n\n## Imported from Claude Code (CLAUDE.md)\n\nProject rules.\n',
    )
    const result = await applyImportWrites(plan.writes, setup.io, 'linux')
    expect(result.skipped).toEqual([
      { candidateId: 'rules:claudeCode:project:CLAUDE.md', reason: 'exists' },
    ])
    const text = setup.io.files.get(`${WS}/AGENTS.md`) ?? ''
    expect(text.split('## Imported from Claude Code (CLAUDE.md)')).toHaveLength(2)
    expect(text).toContain('## Imported from Cursor (.cursorrules)')
  })

  it('confines a user write by its text to the Muse config folder', async () => {
    const io = memoryImportIo()
    const result = await applyImportWrites(
      [
        {
          candidateIds: ['x'],
          sourceExposure: 'personal',
          homeDir: HOME,
          workspaceRoot: WS,
          absolutePath: `${HOME}/.ssh/authorized_keys`,
          content: 'x',
          mode: 'create',
          sections: [],
          root: `${HOME}/.config/muse`,
          isProject: false,
          rootIdentity: undefined,
        },
      ],
      io,
      'linux',
    )
    expect(result.skipped).toEqual([{ candidateId: 'x', reason: 'outside' }])
    expect(io.files.size).toBe(0)
  })
})

// The review round (Grok, 2026-09-28): what the plan and the write refuse.
function reasonsOf(
  skipped: readonly { readonly candidateId: string; readonly reason: string }[],
): Readonly<Record<string, string>> {
  return Object.fromEntries(skipped.map((skip) => [skip.candidateId, skip.reason]))
}

describe('refusals', () => {
  it.each(['allowed-tools: Read\n', 'model: sonnet\n', 'context: fork\n'])(
    'does not turn a restricted command into an unrestricted skill: %s',
    async (metadata) => {
      const setup = input({
        files: {
          [`${HOME}/.claude/commands/check.md`]: `---\ndescription: Check\n${metadata}---\n\nCheck.\n`,
        },
      })
      const scan = await scanAgentImports(setup)
      expect(summary(scan.candidates)).toEqual([
        'command claudeCode user check -> none:unsupported',
      ])
      const plan = await planImportApply(scan.candidates, DESTINATIONS, planState(setup.io))
      expect(plan.writes).toEqual([])
      expect(plan.skipped.map((skip) => skip.reason)).toEqual(['unsupported'])
    },
  )

  it('writes a compatible agent as its own bytes, keeping every restriction it names', async () => {
    const setup = input(
      {
        files: {
          [`${WS}/.claude/agents/review/scout.md`]: agentFile(
            'scout',
            'Review carefully.',
            'tools: read_file, search\nmodel: muse-spark-1.3\npermission-mode: plan\neffort: high\n',
          ),
        },
      },
      { sources: ['claudeCode'] },
    )
    const scan = await scanAgentImports(setup)
    const plan = await planImportApply(scan.candidates, DESTINATIONS, planState(setup.io))
    const applied = await applyImportWrites(plan.writes, setup.io, 'linux')
    expect(applied.written.map((write) => write.absolutePath)).toEqual([
      `${WS}/.agents/agents/review-scout/AGENT.md`,
    ])
    const written = setup.io.files.get(`${WS}/.agents/agents/review-scout/AGENT.md`)
    expect(written).toBe(
      '---\nname: scout\ndescription: scout agent\ntools: read_file, search\nmodel: muse-spark-1.3\npermission-mode: plan\neffort: high\n---\n\nReview carefully.\n',
    )
  })

  it.each([
    'tools: Read, Grep\n',
    'tools: \n  - read_file\n',
    'tools: " , "\n',
    'disallowedTools: bash\n',
    'permissionMode: plan\n',
    'model: sonnet\n',
    'Model: muse-spark-1.3\n',
    'Permission-mode: plan\n',
    'description: |\n  Multiline description\n',
  ])('lists an unsupported agent restriction without writing it: %s', async (fields) => {
    const setup = input({
      files: { [`${HOME}/.claude/agents/scout.md`]: agentFile('scout', 'Review.', fields) },
    })
    const scan = await scanAgentImports(setup)
    expect(summary(scan.candidates)).toEqual(['agent claudeCode user scout -> none:unsupported'])
    const plan = await planImportApply(scan.candidates, DESTINATIONS, planState(setup.io))
    expect(plan.writes).toEqual([])
    expect(plan.skipped.map((skip) => skip.reason)).toEqual(['unsupported'])
  })

  it('lists an agent missing required metadata as unsupported', async () => {
    const scan = await scanAgentImports(
      input({
        files: {
          [`${HOME}/.claude/agents/scout.md`]: '---\nname: scout\n---\n\nReview.\n',
        },
      }),
    )
    expect(summary(scan.candidates)).toEqual(['agent claudeCode user scout -> none:unsupported'])
  })

  it('reads namespaced Claude Code agents to the promised depth, retaining their front matter', async () => {
    const scan = await scanAgentImports(
      input(
        {
          files: {
            [`${HOME}/.claude/agents/review/security.md`]: agentFile('Security Reviewer', 'Check.'),
            [`${HOME}/.claude/agents/plain.md`]: agentFile('plain', 'Plain.'),
            [`${HOME}/.claude/agents/review/audit/deep.md`]: agentFile('deep', 'Deep.'),
            [`${HOME}/.claude/agents/review/audit/more/ignored.md`]: 'Too deep.\n',
            [`${HOME}/.claude/agents/security.md`]: agentFile('security', 'Root security.'),
            [`${HOME}/.claude/agents/review/security-plain.md`]: agentFile(
              'security-plain',
              'Namespaced security.',
            ),
          },
        },
        { sources: ['claudeCode'], workspaceRoot: undefined },
      ),
    )
    expect(summary(scan.candidates)).toEqual([
      'agent claudeCode user plain -> user agents/plain/AGENT.md',
      'agent claudeCode user review/audit/deep -> user agents/review-audit-deep/AGENT.md',
      'agent claudeCode user review/security-plain -> user agents/review-security-plain/AGENT.md',
      'agent claudeCode user review/Security Reviewer -> user agents/review-security-reviewer/AGENT.md',
      'agent claudeCode user security -> user agents/security/AGENT.md',
    ])
  })

  it('offers nothing for a file it could not read or one that leads outside', async () => {
    const setup = input({ files: FIXTURES })
    const scan = await scanAgentImports(setup)
    const plan = await planImportApply(
      scan.candidates,
      DESTINATIONS,
      planState(setup.io, {
        rulesFile: { status: 'outside' },
        museSettings: { status: 'unreadable' },
        hooksFile: 'outside',
      }),
    )
    const reasons = reasonsOf(plan.skipped)
    expect(reasons['rules:claudeCode:project:CLAUDE.md']).toBe('outside')
    expect(reasons['mcpServer:claudeCode:user:github']).toBe('unreadable')
    expect(reasons['hook:claudeCode:user:PreToolUse']).toBe('unreadable')
    expect(reasons['hook:claudeCode:project:PostToolUse']).toBe('outside')
    expect(plan.copies).toEqual([])
    expect(plan.writes.every((write) => write.mode === 'create')).toBe(true)
  })

  it('keeps AGENTS.md within the size Muse Code loads, planned and written', async () => {
    const nearlyFull = `# Project\n\n${'x'.repeat(RULES_FILE_MAX_BYTES - 40)}\n`
    const full = input({ files: { ...FIXTURES, [`${WS}/AGENTS.md`]: nearlyFull } })
    const fullScan = await scanAgentImports(full)
    const fullPlan = await planImportApply(fullScan.candidates, DESTINATIONS, planState(full.io))
    expect(reasonsOf(fullPlan.skipped)['rules:claudeCode:project:CLAUDE.md']).toBe('tooLarge')
    // Planned against a small file that grew before the write.
    const { setup, plan } = await plannedFixtures()
    setup.io.files.set(`${WS}/AGENTS.md`, nearlyFull)
    const result = await applyImportWrites(plan.writes, setup.io, 'linux')
    expect(result.skipped.map((skip) => skip.reason)).toEqual(['tooLarge', 'tooLarge', 'tooLarge'])
    expect(setup.io.files.get(`${WS}/AGENTS.md`)).toBe(nearlyFull)
  })
})

// Every agent's hooks (M91, PLAN.md D70): Codex into Muse Code's files, the
// extended Claude Code set and every other format into `spark-hooks.json`
// with its import record, every refusal with its reason.
const CLINE_SCRIPT = `${WS}/.clinerules/hooks/PreToolUse`
const HOOK_FIXTURES: Record<string, string> = {
  // Claude Code extension events, user and project.
  [`${HOME}/.claude/settings.json`]: JSON.stringify({
    hooks: {
      TaskCreated: [{ hooks: [{ type: 'command', command: 'todo' }] }],
      WorktreeCreate: [{ hooks: [{ type: 'command', command: 'wt' }] }],
      FileChanged: [{ hooks: [{ type: 'command', command: 'watch' }] }],
    },
  }),
  [`${WS}/.claude/settings.json`]: JSON.stringify({
    hooks: {
      FileChanged: [{ matcher: '*.ts', hooks: [{ type: 'command', command: 'watch' }] }],
      Setup: [{ hooks: [{ type: 'command', command: 'init' }] }],
    },
  }),
  // Codex: hooks.json, the config's servers, notify program and [hooks] table.
  [`${HOME}/.codex/hooks.json`]: JSON.stringify({
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'halt' }] }] },
  }),
  [`${HOME}/.codex/config.toml`]: [
    'notify = "ping"',
    '[mcp_servers.docs]',
    'command = "docs-mcp"',
    '[[hooks.PreToolUse]]',
    'matcher = "apply_patch"',
    '[[hooks.PreToolUse.hooks]]',
    'type = "command"',
    'command = "guard"',
    '',
  ].join('\n'),
  [`${WS}/.codex/hooks.json`]: JSON.stringify({
    hooks: {
      Interrupt: [{ hooks: [{ type: 'command', command: 'note', async: true }] }],
      PostToolUseFailure: [{ hooks: [{ type: 'command', command: 'x' }] }],
    },
  }),
  // Cursor: a guard, a weaker watch, and a Tab hook that waits.
  [`${HOME}/.cursor/hooks.json`]: JSON.stringify({
    version: 1,
    hooks: {
      preToolUse: [{ command: 'guard', matcher: 'Shell' }],
      subagentStart: [{ command: 'watch' }],
      beforeTabFileRead: [{ command: 'tab' }],
    },
  }),
  // Gemini: a tool guard and a narrowing tool selection.
  [`${HOME}/.gemini/settings.json`]: JSON.stringify({
    hooks: {
      BeforeTool: [
        {
          matcher: '^run_shell_command$',
          hooks: [{ type: 'command', command: 'guard', timeout: 5000 }],
        },
      ],
      BeforeToolSelection: [{ hooks: [{ type: 'command', command: 'pick' }] }],
    },
  }),
  // Copilot: a project CLI file, a user VS Code Local file, and inline settings with an env.
  [`${WS}/.github/hooks/audit.json`]: JSON.stringify({
    version: 1,
    hooks: { preToolUse: [{ type: 'command', bash: './audit.sh' }] },
  }),
  [`${HOME}/.copilot/hooks/session.json`]: JSON.stringify({
    hooks: { SessionStart: [{ type: 'command', command: 'hello' }] },
  }),
  [`${HOME}/.copilot/settings.json`]: JSON.stringify({
    hooks: { preToolUse: [{ bash: 'guard', env: { TOKEN: 'secret' } }] },
  }),
  // Windsurf: only the legacy file, so it is the one in effect.
  [`${WS}/.windsurf/hooks.json`]: JSON.stringify({
    hooks: {
      pre_write_code: [{ command: 'guard' }],
      post_cascade_response_with_transcript: [{ command: 'x' }],
    },
  }),
  // Kiro v1: a file trigger, a spec-task trigger, a Manual trigger, and a newer format.
  [`${WS}/.kiro/hooks/lint.json`]: JSON.stringify({
    version: 'v1',
    hooks: [
      {
        name: 'lint',
        trigger: 'PostFileSave',
        matcher: String.raw`\.ts$`,
        action: { type: 'command', command: 'lint' },
      },
      { name: 'spec', trigger: 'PreTaskExec', action: { type: 'command', command: 'check' } },
      { name: 'hand', trigger: 'Manual', action: { type: 'command', command: 'run' } },
    ],
  }),
  [`${HOME}/.kiro/hooks/new.json`]: JSON.stringify({ version: 'v2', hooks: [] }),
  // Cline v1: an executable per-event script and a newer-format file.
  [CLINE_SCRIPT]: '#!/bin/sh\nguard\n',
  [`${WS}/.clinerules/hooks/hooks.json`]: JSON.stringify({ version: 1 }),
}

const HOOK_SOURCES: readonly AgentImportSource[] = [
  'claudeCode',
  'codex',
  'cursor',
  'gemini',
  'copilot',
  'windsurf',
  'kiro',
  'cline',
]

function hookInput(tree: MemoryImportTree, overrides: Partial<ImportScanInput> = {}) {
  return input(
    { files: HOOK_FIXTURES, executables: [CLINE_SCRIPT], ...tree },
    { ...overrides, sources: overrides.sources ?? HOOK_SOURCES },
  )
}

function sparkGroups(text: string | undefined, event: string): readonly Record<string, unknown>[] {
  const parsed = JSON.parse(text ?? '{}') as { hooks?: Record<string, Record<string, unknown>[]> }
  return parsed.hooks?.[event] ?? []
}

describe('scanAgentImports: every agent’s hooks', () => {
  it('converts Codex into Muse files and everything else into spark files, refusals listed', async () => {
    const scan = await scanAgentImports(hookInput({}))
    expect(summary(scan.candidates)).toEqual([
      'hook claudeCode user TaskCreated -> hook:sparkUser',
      'hook claudeCode user WorktreeCreate -> none:weaker',
      'hook claudeCode user FileChanged -> none:needsMatcher',
      'hook claudeCode project FileChanged -> hook:sparkProject',
      'hook claudeCode project Setup -> hook:sparkProject',
      'mcpServer codex user docs -> server',
      'hook codex user notify -> none:notify',
      'hook codex user PreToolUse -> hook:settings',
      'hook codex user Stop -> hook:settings',
      'hook codex project Interrupt -> hook:hooks',
      'hook codex project PostToolUseFailure -> none:unmapped',
      'hook cursor user preToolUse -> hook:sparkUser',
      'hook cursor user subagentStart -> none:weaker',
      'hook cursor user beforeTabFileRead -> none:keptWaiting',
      'hook gemini user BeforeTool -> hook:sparkUser',
      'hook gemini user BeforeToolSelection -> hook:sparkUser',
      'hook copilot user SessionStart -> hook:sparkUser',
      'hook copilot project preToolUse -> hook:sparkProject',
      'hook copilot user preToolUse -> none:field',
      'hook windsurf project pre_write_code -> hook:sparkProject',
      'hook windsurf project post_cascade_response_with_transcript -> none:unmapped',
      'hook kiro user new.json -> none:unknownFormat',
      'hook kiro project lint -> hook:sparkProject',
      'hook kiro project spec -> hook:sparkProject',
      'hook kiro project hand -> none:unmapped',
      'hook cline project hooks.json -> none:unknownFormat',
      'hook cline project PreToolUse -> hook:sparkProject',
    ])
    expect(scan.warnings).toEqual([])
  })

  it('plans Muse copies without records and spark copies with each source’s record', async () => {
    const setup = hookInput({})
    const scan = await scanAgentImports(setup)
    const plan = await planImportApply(scan.candidates, DESTINATIONS, planState(setup.io))
    expect(plan.copies.map((copy) => copy.file)).toEqual([
      'settings',
      'hooks',
      'sparkUser',
      'sparkProject',
    ])
    const textOf = (file: string): string | undefined =>
      plan.copies.find((copy) => copy.file === file)?.text
    // Muse Code's own files carry no import record: its parser refuses unknown group fields.
    for (const file of ['settings', 'hooks']) {
      expect(textOf(file)).not.toContain('"format"')
      expect(textOf(file)).not.toContain('"sourceEntry"')
    }
    expect(JSON.parse(textOf('settings') ?? '{}')).toMatchObject({
      mcpServers: { docs: { command: 'docs-mcp' } },
      hooks: { PreToolUse: [{ matcher: 'Edit|Write' }], Stop: [{}] },
    })
    const spark = `${textOf('sparkUser') ?? ''}${textOf('sparkProject') ?? ''}`
    for (const format of ['gemini', 'cursor', 'copilot', 'windsurf', 'kiro', 'cline']) {
      expect(spark).toContain(`"format": "${format}"`)
    }
    expect(sparkGroups(textOf('sparkUser'), 'PreToolUse')).toMatchObject([
      { format: 'cursor', sourceEvent: 'preToolUse' },
      { format: 'gemini', sourceEvent: 'BeforeTool' },
    ])
    expect(sparkGroups(textOf('sparkProject'), 'PostToolUse')).toMatchObject([
      { format: 'kiro', sourceEvent: 'PostFileSave', pathPattern: String.raw`\.ts$` },
    ])
    expect(sparkGroups(textOf('sparkUser'), 'SessionStart')).toMatchObject([
      { format: 'copilot', flavor: 'vscode', sourceEvent: 'SessionStart' },
    ])
    expect(plan.skipped).toContainEqual(expect.objectContaining({ reason: 'field', field: 'env' }))
  })

  it('notes the Kiro task meaning in plain words on its candidates', async () => {
    const scan = await scanAgentImports(hookInput({}))
    const spec = scan.candidates.find((candidate) => candidate.label === 'spec')
    expect(spec?.previewNote).toBe('Kiro spec-task triggers run on todo items here')
    const lint = scan.candidates.find((candidate) => candidate.label === 'lint')
    expect(lint?.previewNote).toBeUndefined()
  })

  it('shows metadata only: no command text reaches labels, notes, dropped fields or reasons', async () => {
    const scan = await scanAgentImports(hookInput({}))
    const commands = ['guard', 'halt', 'audit', 'lint', 'check', 'hello', './audit.sh', 'ping']
    for (const candidate of scan.candidates) {
      for (const text of [candidate.label, candidate.previewNote ?? '', ...candidate.dropped]) {
        for (const command of commands) {
          expect(text.includes(command) && text !== command).toBe(false)
        }
      }
    }
  })

  it('reads no project hook without live trust (the scope drill)', async () => {
    const setup = hookInput({}, { isWorkspaceTrusted: () => false })
    const scan = await scanAgentImports(setup)
    expect(scan.candidates.length).toBeGreaterThan(0)
    expect(scan.candidates.every((candidate) => candidate.origin === 'user')).toBe(true)
    expect(setup.io.reads.filter((path) => path.startsWith(`${WS}/`))).toEqual([])
  })

  it('lists a broken Kiro file in fixed words, never with its content', async () => {
    const scan = await scanAgentImports(
      hookInput({ files: { ...HOOK_FIXTURES, [`${WS}/.kiro/hooks/bad.json`]: '{ broken' } }),
    )
    expect(scan.candidates.some((candidate) => candidate.label === 'bad.json')).toBe(false)
    expect(scan.warnings).toContain('is not a readable Kiro hooks file, skipped')
    expect(scan.warnings.join('\n')).not.toContain('broken')
  })
})

// RVM91I round 2: the scanner-level regressions.
function only(
  files: Record<string, string>,
  sources: readonly AgentImportSource[],
  tree: Omit<MemoryImportTree, 'files'> = {},
) {
  return input({ files, ...tree }, { sources })
}

describe('scanAgentImports: RVM91I scanner regressions', () => {
  it('RVM91I-2 reads Gemini and Codex switches before their hooks, across user and project', async () => {
    const gemini = await scanAgentImports(
      only(
        {
          [`${HOME}/.gemini/settings.json`]: JSON.stringify({
            hooks: { BeforeTool: [{ hooks: [{ type: 'command', command: 'g' }] }] },
          }),
          [`${WS}/.gemini/settings.json`]: JSON.stringify({ hooksConfig: { enabled: false } }),
        },
        ['gemini'],
      ),
    )
    expect(summary(gemini.candidates)).toEqual(['hook gemini user BeforeTool -> none:disabled'])
    const codex = await scanAgentImports(
      only(
        {
          [`${HOME}/.codex/hooks.json`]: JSON.stringify({
            hooks: { Stop: [{ hooks: [{ type: 'command', command: 'halt' }] }] },
          }),
          [`${WS}/.codex/config.toml`]: '[features]\nhooks = false\n',
        },
        ['codex'],
      ),
    )
    expect(summary(codex.candidates)).toEqual(['hook codex user Stop -> none:disabled'])
  })

  it('RVM91I-6 refuses a personal Cline script that leads into the open project', async () => {
    const hooksDir = `${HOME}/Documents/Cline/Hooks`
    const userScript = `${hooksDir}/PreToolUse`
    const tree = { [`${WS}/scripts/guard`]: '#!/bin/sh\n', [`${hooksDir}/README.txt`]: 'notes' }
    const setup = only(tree, ['cline'], {
      links: { [userScript]: `${WS}/scripts/guard` },
      executables: [`${WS}/scripts/guard`],
    })
    const scan = await scanAgentImports(setup)
    expect(summary(scan.candidates)).toEqual(['hook cline user PreToolUse -> none:outside'])
    const plan = await planImportApply(scan.candidates, DESTINATIONS, planState(setup.io))
    expect(plan.copies).toEqual([])
    // Untrusted, it is not offered and the script is not touched.
    const untrusted = input(
      { files: tree, links: { [userScript]: `${WS}/scripts/guard` } },
      { sources: ['cline'], isWorkspaceTrusted: () => false },
    )
    const untrustedScan = await scanAgentImports(untrusted)
    expect(untrustedScan.candidates).toEqual([])
    expect(untrusted.io.reads).toEqual([])
  })

  it('RVM91I-8/9 offers each lifecycle script once, and only by Cline’s discovery rules', async () => {
    const dir = `${WS}/.clinerules/hooks`
    const files = {
      [`${dir}/TaskStart`]: 'x',
      [`${dir}/TaskComplete`]: 'x',
      [`${dir}/PreToolUse.sh`]: 'x',
      [`${dir}/PostToolUse`]: 'x',
    }
    const scan = await scanAgentImports(
      only(files, ['cline'], { executables: [`${dir}/TaskStart`, `${dir}/TaskComplete`] }),
    )
    expect(summary(scan.candidates)).toEqual([
      'hook cline project PostToolUse -> none:disabled',
      'hook cline project TaskComplete -> hook:sparkProject',
      'hook cline project TaskStart -> hook:sparkProject',
    ])
    // Off Windows a `.ps1` is ignored, and a script without an execute bit is off.
    const wrongPlatform = await scanAgentImports(
      input(
        { files: { [`${dir}/PreToolUse.ps1`]: 'x', [`${dir}/PreToolUse`]: 'x' } },
        { sources: ['cline'], platform: 'linux' },
      ),
    )
    expect(summary(wrongPlatform.candidates)).toEqual([
      'hook cline project PreToolUse -> none:disabled',
    ])
  })

  it('RVM91I-14 takes .devin/hooks.json over the legacy .windsurf/hooks.json', async () => {
    const both = {
      [`${WS}/.devin/hooks.json`]: JSON.stringify({
        hooks: { pre_run_command: [{ command: 'active' }] },
      }),
      [`${WS}/.windsurf/hooks.json`]: JSON.stringify({
        hooks: { pre_read_code: [{ command: 'obsolete' }] },
      }),
    }
    const scan = await scanAgentImports(only(both, ['windsurf']))
    expect(summary(scan.candidates)).toEqual([
      'hook windsurf project pre_run_command -> hook:sparkProject',
    ])
    expect(scan.candidates[0]?.originPath).toBe(`${WS}/.devin/hooks.json`)
    // The legacy file is used when the active one defines no hooks.
    const empty = await scanAgentImports(
      only({ ...both, [`${WS}/.devin/hooks.json`]: JSON.stringify({ hooks: {} }) }, ['windsurf']),
    )
    expect(summary(empty.candidates)).toEqual([
      'hook windsurf project pre_read_code -> hook:sparkProject',
    ])
  })

  it('RVM91I-15 reads the repository settings blocks as project hooks and honours COPILOT_HOME', async () => {
    const files = {
      [`${WS}/.github/copilot/settings.json`]: JSON.stringify({
        hooks: { preToolUse: [{ type: 'command', bash: 'repo-guard' }] },
      }),
      [`${WS}/.github/copilot/settings.local.json`]: JSON.stringify({
        hooks: { postToolUse: [{ type: 'command', bash: 'local-log' }] },
      }),
      [`${HOME}/alt-copilot/hooks/mine.json`]: JSON.stringify({
        version: 1,
        hooks: { sessionStart: [{ type: 'command', bash: 'hi' }] },
      }),
      [`${HOME}/.copilot/hooks/ignored.json`]: JSON.stringify({
        version: 1,
        hooks: { sessionEnd: [{ type: 'command', bash: 'bye' }] },
      }),
    }
    const scan = await scanAgentImports(
      input({ files }, { sources: ['copilot'], copilotHome: `${HOME}/alt-copilot` }),
    )
    expect(summary(scan.candidates)).toEqual([
      'hook copilot user sessionStart -> hook:sparkUser',
      'hook copilot project preToolUse -> hook:sparkProject',
      'hook copilot project postToolUse -> hook:sparkProject',
    ])
  })

  it('RVM91I-2 keeps every Copilot hook off under a repository disableAllHooks', async () => {
    const scan = await scanAgentImports(
      only(
        {
          [`${WS}/.github/copilot/settings.json`]: JSON.stringify({ disableAllHooks: true }),
          [`${WS}/.github/hooks/a.json`]: JSON.stringify({
            version: 1,
            hooks: { preToolUse: [{ type: 'command', bash: 'g' }] },
          }),
        },
        ['copilot'],
      ),
    )
    expect(summary(scan.candidates)).toEqual(['hook copilot project preToolUse -> none:disabled'])
  })
})

describe('scanAgentImports: RVM91I2 regressions', () => {
  const native = { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'guard' }] }] } }
  const gemini = { hooks: { BeforeTool: [{ hooks: [{ type: 'command', command: 'guard' }] }] } }
  const copilot = { version: 1, hooks: { preToolUse: [{ bash: 'guard' }] } }

  it.each(['claudeCode', 'gemini', 'copilot'] as const)(
    'R2-1 refuses %s hooks when a source switch file is oversized or unreadable',
    async (source) => {
      const dir = { claudeCode: '.claude', gemini: '.gemini', copilot: '.github/copilot' }[source]
      const user =
        source === 'copilot' ? `${HOME}/.copilot/hooks/guard.json` : `${HOME}/${dir}/settings.json`
      const project = `${WS}/${dir}/settings.json`
      for (const failure of ['oversized', 'EACCES', 'malformed']) {
        const setup = only(
          {
            [user]: JSON.stringify({ claudeCode: native, gemini, copilot }[source]),
            [project]:
              failure === 'malformed'
                ? '{'
                : JSON.stringify({
                    disableAllHooks: true,
                    hooksConfig: { enabled: false },
                    detail: 'x'.repeat(AGENT_IMPORT_FILE_MAX_BYTES),
                  }),
          },
          [source],
          failure === 'EACCES' ? { failing: { [project]: 'EACCES' } } : {},
        )
        const scan = await scanAgentImports(setup)
        expect(scan.candidates).toHaveLength(1)
        expect(scan.candidates[0]?.target).toEqual({ kind: 'none', reason: 'unreadable' })
        const plan = await planImportApply(scan.candidates, DESTINATIONS, planState(setup.io))
        expect(plan.copies).toEqual([])
        expect(plan.skipped[0]?.reason).toBe('unreadable')
      }
    },
  )

  it('R2-1 allows personal hooks when optional source switch files are absent', async () => {
    const setup = only({ [`${HOME}/.copilot/hooks/guard.json`]: JSON.stringify(copilot) }, [
      'copilot',
    ])
    const scan = await scanAgentImports(setup)
    expect(scan.candidates[0]?.target.kind).toBe('hook')
  })

  it('R2-2 rechecks a Cline link retargeted during the executable await and trust loss', async () => {
    const dir = `${HOME}/Documents/Cline/Hooks`
    const script = `${dir}/PreToolUse`
    let isTrusted = true
    const setup = input(
      {
        files: {
          [`${dir}/README.txt`]: 'notes',
          [`${HOME}/guard`]: 'script',
          [`${WS}/guard`]: 'project',
        },
        links: { [script]: `${HOME}/guard` },
        executables: [`${HOME}/guard`],
      },
      { sources: ['cline'], isWorkspaceTrusted: () => isTrusted },
    )
    setup.io.isExecutable = () => {
      setup.io.links.set(script, `${WS}/guard`)
      isTrusted = false
      return Promise.resolve(true)
    }
    const scan = await scanAgentImports(setup)
    expect(scan.candidates.every((candidate) => candidate.target.kind === 'none')).toBe(true)
    const plan = await planImportApply(scan.candidates, DESTINATIONS, planState(setup.io))
    expect(plan.copies).toEqual([])
  })

  it('R2-2 refuses a personal Cline executable retargeted after preview during planning', async () => {
    const dir = `${HOME}/Documents/Cline/Hooks`
    const script = `${dir}/PreToolUse`
    const setup = only(
      { [`${dir}/README.txt`]: 'notes', [`${HOME}/guard`]: 'script', [`${WS}/guard`]: 'project' },
      ['cline'],
      { links: { [script]: `${HOME}/guard` }, executables: [`${HOME}/guard`] },
    )
    const scan = await scanAgentImports(setup)
    expect(scan.candidates[0]?.target.kind).toBe('hook')
    setup.io.links.set(script, `${WS}/guard`)
    const plan = await planImportApply(scan.candidates, DESTINATIONS, planState(setup.io))
    expect(plan.copies).toEqual([])
    expect(plan.skipped).toEqual([{ candidateId: scan.candidates[0]?.id, reason: 'outside' }])
  })

  // gh/copilot_reference_hooks-configuration.md:73-75: strict inline, independent files.
  it('R2-4 refuses valid Copilot inline siblings beside a malformed item', async () => {
    const block = { hooks: { preToolUse: [{ bash: 'send-report' }, { bash: 123 }] } }
    const setup = only(
      {
        [`${WS}/.github/copilot/settings.json`]: JSON.stringify(block),
        [`${WS}/.github/hooks/independent.json`]: JSON.stringify(copilot),
      },
      ['copilot'],
    )
    const scan = await scanAgentImports(setup)
    const inline = scan.candidates.filter((candidate) =>
      candidate.originPath.endsWith('settings.json'),
    )
    expect(inline).toHaveLength(2)
    expect(inline.every((candidate) => candidate.target.kind === 'none')).toBe(true)
    expect(inline[0]?.target).toEqual({ kind: 'none', reason: 'field', field: 'hooks' })
    expect(
      scan.candidates.find((candidate) => candidate.originPath.endsWith('independent.json'))?.target
        .kind,
    ).toBe('hook')
  })

  // raw-codex-gemini.md:77: merged matching plans inherit sequential:true.
  it('R2-9 refuses Gemini sequential event siblings across user and project files', async () => {
    const setup = only(
      {
        [`${HOME}/.gemini/settings.json`]: JSON.stringify(gemini),
        [`${WS}/.gemini/settings.json`]: JSON.stringify({
          hooks: {
            BeforeTool: [{ sequential: true, hooks: [{ type: 'command', command: 'produce' }] }],
            AfterTool: [{ hooks: [{ type: 'command', command: 'observe' }] }],
          },
        }),
      },
      ['gemini'],
    )
    const scan = await scanAgentImports(setup)
    const before = scan.candidates.filter((candidate) => candidate.label === 'BeforeTool')
    expect(before).toHaveLength(2)
    expect(before.map((candidate) => candidate.target)).toEqual([
      { kind: 'none', reason: 'field', field: 'sequential' },
      { kind: 'none', reason: 'field', field: 'sequential' },
    ])
    expect(scan.candidates.find((candidate) => candidate.label === 'AfterTool')?.target.kind).toBe(
      'hook',
    )
  })

  it('R2-11 refuses a discovered Cursor file with no required version', async () => {
    const setup = only(
      {
        [`${HOME}/.cursor/hooks.json`]: JSON.stringify({
          hooks: { preToolUse: [{ command: 'guard' }] },
        }),
      },
      ['cursor'],
    )
    const scan = await scanAgentImports(setup)
    expect(summary(scan.candidates)).toEqual(['hook cursor user hooks.json -> none:unknownFormat'])
  })
})

describe('RVM91I2 Cline await boundaries', () => {
  it('R2-2 checks project script confinement again after its executable await', async () => {
    const script = `${WS}/.clinerules/hooks/PreToolUse`
    const setup = only({ [script]: 'project', [`${HOME}/outside`]: 'outside' }, ['cline'], {
      executables: [script],
    })
    setup.io.isExecutable = () => {
      setup.io.links.set(script, `${HOME}/outside`)
      return Promise.resolve(true)
    }
    const scan = await scanAgentImports(setup)
    expect(scan.candidates).toEqual([])
    expect(scan.warnings).toContain('leads outside the workspace, skipped')
  })

  it('R2-2 refuses a personal link retargeted at final exposure classification', async () => {
    const dir = `${HOME}/Documents/Cline/Hooks`
    const script = `${dir}/PreToolUse`
    const setup = only(
      { [`${dir}/README.txt`]: 'notes', [`${HOME}/guard`]: 'user', [`${WS}/guard`]: 'project' },
      ['cline'],
      { links: { [script]: `${HOME}/guard` }, executables: [`${HOME}/guard`] },
    )
    const realPath = setup.io.realPath
    let reads = 0
    setup.io.realPath = (path) => {
      if (path === script) {
        reads += 1
        if (reads === 3) setup.io.links.set(script, `${WS}/guard`)
      }
      return realPath(path)
    }
    const scan = await scanAgentImports(setup)
    expect(scan.candidates[0]?.sourceExposure).toBe('project-tracked')
    expect(scan.candidates[0]?.target).toEqual({ kind: 'none', reason: 'outside' })
  })
})

describe('RVM91I2 Cline source workspace identity', () => {
  it('R2-2 confines a project executable to its original workspace again during planning', async () => {
    const script = `${WS}/.clinerules/hooks/PreToolUse`
    const setup = only({ [script]: 'project', '/other/guard': 'other project' }, ['cline'], {
      executables: [script],
    })
    const scan = await scanAgentImports(setup)
    expect(scan.candidates[0]?.target.kind).toBe('hook')
    setup.io.links.set(script, '/other/guard')
    const plan = await planImportApply(
      scan.candidates,
      { ...DESTINATIONS, workspaceRoots: () => [WS, '/other'] },
      planState(setup.io),
    )
    expect(plan.copies).toEqual([])
    expect(plan.skipped[0]?.reason).toBe('outside')
  })

  it('R2-2 rechecks project trust after exposure classification awaits', async () => {
    const script = `${WS}/.clinerules/hooks/PreToolUse`
    let isTrusted = true
    const setup = input(
      { files: { [script]: 'project' }, executables: [script] },
      { sources: ['cline'], isWorkspaceTrusted: () => isTrusted },
    )
    setup.io.isIgnored = () => {
      isTrusted = false
      return Promise.resolve(false)
    }
    const scan = await scanAgentImports(setup)
    expect(scan.candidates).toEqual([])
  })
})
