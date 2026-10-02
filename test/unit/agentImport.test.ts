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
import { type AgentImportSource, RULES_FILE_MAX_BYTES } from '../../src/shared/constants'
import {
  type MemoryImportIo,
  memoryImportIo,
  type MemoryImportTree,
} from './helpers/memoryImportIo'
import { SYNTHETIC } from './helpers/syntheticTokens'

const HOME = '/home/u'
const WS = '/ws'
const MASK = '[masked]'
const HIDDEN = '(name not shown)'
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
    mask: MASK,
    hiddenName: HIDDEN,
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
    case 'credential': {
      return `credential:${target.cue}`
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
      expect(realPath).not.toHaveBeenCalled()
      if (guard === 'activation') expect(setup.io.reads).toEqual([])
    },
  )

  it('finds every tool’s entries and sends each only where its scope allows', async () => {
    const scan = await scanAgentImports(input({ files: FIXTURES }))
    expect(summary(scan.candidates)).toEqual([
      'mcpServer claudeCode user github -> server',
      'mcpServer claudeCode user local -> server',
      'hook claudeCode user PreToolUse (Bash) -> hook:settings',
      'agent claudeCode user reviewer -> user agents/reviewer/AGENT.md',
      'command claudeCode user frontend-component -> user skills/frontend-component/SKILL.md',
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
      'rules cursor project .cursor/rules/ts.mdc -> rules',
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
        case 'none':
        case 'credential': {
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
      '.claude/commands leads outside the workspace, skipped',
      '.cursorrules leads outside the workspace, skipped',
    ])
  })

  it('follows the user’s own links, which are theirs to make', async () => {
    const scan = await scanAgentImports(
      input(
        {
          files: { '/dotfiles/claude/commands/dot.md': 'Dot.\n' },
          links: { [`${HOME}/.claude`]: '/dotfiles/claude' },
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
      '~/.claude/settings.json is not a readable settings file, skipped',
      '~/.codex/config.toml is not a readable Codex configuration, skipped',
      '~/.cursor/mcp.json is not an MCP servers file, skipped',
      '~/.cursor/agents could not be listed (EACCES)',
      '~/.cursor/commands/big.md is over the 65536 byte limit, skipped',
      '~/.cursor/commands/empty.md has no usable name or holds nothing, skipped',
    ])
    expect(scan.warnings.join('\n')).not.toContain(SECRET)
  })

  it('masks every server env value at conversion, keeping its name', async () => {
    const scan = await scanAgentImports(input({ files: FIXTURES }))
    const servers = scan.candidates.filter((candidate) => candidate.kind === 'mcpServer')
    expect(JSON.stringify(servers)).not.toContain('github.example.com')
    expect(JSON.stringify(servers)).toContain(`"GH_HOST":"${MASK}"`)
  })
})

// The redesign after RV83d: an entry that may hold a credential is refused
// whole at the scan, and no candidate keeps any of its text.
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

  it('refuses each one whole, names its cue and keeps none of its text', async () => {
    const setup = input({ files: credentialFiles }, { sources: ['claudeCode'] })
    const scan = await scanAgentImports(setup)
    expect(summary(scan.candidates)).toEqual([
      'mcpServer claudeCode user github -> credential:token',
      `mcpServer claudeCode user ${HIDDEN} -> credential:token`,
      'hook claudeCode user Stop -> credential:token',
      `hook claudeCode user ${HIDDEN} -> credential:token`,
      'agent claudeCode user scout -> credential:name',
      'command claudeCode user keys -> credential:name',
      'command claudeCode user review -> credential:token',
      'rules claudeCode project CLAUDE.md -> credential:name',
    ])
    const kept = JSON.stringify(scan.candidates)
    for (const secret of [SECRET, 'opaque-demo-value', 'opaque']) {
      expect(kept).not.toContain(secret)
    }
    const plan = await planImportApply(scan.candidates, DESTINATIONS, planState(setup.io))
    expect(plan.writes).toEqual([])
    expect(plan.copies).toEqual([])
    expect(plan.skipped.map((skip) => skip.reason)).toEqual(
      Array.from({ length: 8 }, () => 'credential'),
    )
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
  workspaceRoot: WS,
  workspaceIdentity: ROOT_IDENTITY,
  personalRoot: `${HOME}/.config/muse`,
  museSettingsFile: `${HOME}/.config/muse/settings.json`,
}

function planState(io: MemoryImportIo, overrides: Partial<ImportPlanState> = {}): ImportPlanState {
  const agentsFile = io.files.get(`${WS}/AGENTS.md`)
  return {
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
        github: { type: 'stdio', command: 'gh-mcp', env: { GH_HOST: MASK }, mode: 'optional' },
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
      'agent claudeCode user review-audit-deep -> user agents/review-audit-deep/AGENT.md',
      'agent claudeCode user review-security-plain -> user agents/review-security-plain/AGENT.md',
      'agent claudeCode user review-security-reviewer -> user agents/review-security-reviewer/AGENT.md',
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
    expect(reasons['hook:claudeCode:user:PreToolUse (Bash)']).toBe('unreadable')
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
