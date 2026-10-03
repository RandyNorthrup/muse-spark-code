// The other agents' shapes converted to Muse Code's (M83): the MCP entry
// Muse Code 1.4.0-R4302.1's `migrate` skill writes, hooks that never widen,
// SKILL.md front matter a YAML reader takes, and rules sections. A server or
// hook values are preserved in exposure-checked targets.

import { describe, expect, it } from 'vitest'
import { parseSkillFile } from '../../src/core/context/skills'
import {
  appendSeparator,
  commandToSkill,
  convertCodexServer,
  convertHook,
  convertJsonServer,
  readClaudeHooks,
  readClaudeState,
  readCodexConfig,
  readMcpFile,
  rulesHeading,
  rulesSection,
  splitFrontMatter,
} from '../../src/core/import/importConvert'
import { SYNTHETIC } from './helpers/syntheticTokens'

// One line in a YAML single-quoted scalar: quote marks inside are doubled, and it is closed.
const YAML_SINGLE_QUOTED = /^'(?:[^']|'')*'$/u

describe('convertJsonServer', () => {
  it('drops inactive and unknown fields by name, preserving only active transport values', () => {
    const stdio = convertJsonServer({
      command: 'server',
      args: ['--token', 'opaque'],
      env: { TOKEN: 'unchanged' },
      url: 'https://private.invalid/?key=hidden',
      headers: { Authorization: 'hidden' },
      unknown: 'hidden',
    })
    expect(stdio).toEqual({
      ok: true,
      value: {
        type: 'stdio',
        command: 'server',
        args: ['--token', 'opaque'],
        env: { TOKEN: 'unchanged' },
        mode: 'optional',
      },
      dropped: ['url', 'headers', 'unknown'],
    })
    const http = convertCodexServer({
      url: 'https://example.test/?key=unchanged',
      http_headers: { Authorization: 'unchanged' },
      command: 'hidden',
      args: ['hidden'],
      env: { TOKEN: 'hidden' },
      unknown: 'hidden',
    })
    expect(http).toEqual({
      ok: true,
      value: {
        type: 'streamable-http',
        url: 'https://example.test/?key=unchanged',
        headers: { Authorization: 'unchanged' },
        mode: 'optional',
      },
      dropped: ['command', 'args', 'env', 'unknown'],
    })
    expect(JSON.stringify([stdio, http])).not.toContain('hidden')
  })
  it('converts a stdio server with its env values unchanged and mode optional', () => {
    expect(
      convertJsonServer({
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp', '--port', '9'],
        env: { NODE_ENV: 'production', LOG_LEVEL: 'debug' },
        timeout: 30,
        alwaysLoad: true,
      }),
    ).toEqual({
      ok: true,
      value: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp', '--port', '9'],
        env: { NODE_ENV: 'production', LOG_LEVEL: 'debug' },
        mode: 'optional',
      },
      dropped: ['timeout', 'alwaysLoad'],
    })
  })

  it('reads a bare command as stdio and a bare URL (Cursor) as streamable HTTP', () => {
    expect(convertJsonServer({ command: 'docs-mcp' })).toMatchObject({
      ok: true,
      value: { type: 'stdio', command: 'docs-mcp' },
    })
    expect(
      convertJsonServer({
        url: 'https://mcp.example.com/mcp',
        headers: { Accept: 'application/json' },
      }),
    ).toEqual({
      ok: true,
      value: {
        type: 'streamable-http',
        url: 'https://mcp.example.com/mcp',
        headers: { Accept: 'application/json' },
        mode: 'optional',
      },
      dropped: [],
    })
  })

  it.each([
    ['a credential flag in its arguments', { command: 'npx', args: ['--api-key', 'abc'] }, 'name'],
    ['a credential-named env value', { command: 'gh-mcp', env: { GITHUB_TOKEN: 'abc' } }, 'name'],
    ['a token in an env value', { command: 'gh-mcp', env: { GH: SYNTHETIC.githubToken } }, 'token'],
    ['a credential in its command', { command: 'TOKEN=abc server' }, 'name'],
    [
      'an Authorization header',
      { url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer abc' } },
      'name',
    ],
    ['a URL query', { url: 'https://mcp.example.com/mcp?region=eu' }, 'url'],
    ['URL user-info', { url: 'https://me:pw@mcp.example.com/mcp' }, 'url'],
    ['a URL fragment', { url: 'https://mcp.example.com/mcp#key' }, 'url'],
  ])('preserves a server with %s unchanged', (_name, raw, _cue) => {
    expect(convertJsonServer(raw)).toMatchObject({ ok: true })
  })

  it.each([
    ['an SSE transport', { type: 'sse', url: 'https://x/sse' }],
    ['a WebSocket transport', { type: 'ws', url: 'wss://x' }],
    ['OAuth', { type: 'http', url: 'https://x', oauth: { clientId: 'a' } }],
    ['a header helper', { type: 'http', url: 'https://x', headersHelper: './h.sh' }],
    ['a non-string env value', { command: 'x', env: { A: 1 } }],
    ['neither a command nor a URL', { type: 'stdio' }],
    // mr83 P3: a blank command is refused, as a blank hook command is.
    ['a whitespace-only command', { command: ' '.repeat(3) }],
    ['a URL that does not parse', { url: 'not a url' }],
  ])('refuses %s as unsupported', (_name, raw) => {
    expect(convertJsonServer(raw)).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('skips a server that is turned off', () => {
    expect(convertJsonServer({ command: 'x', enabled: false })).toEqual({
      ok: false,
      reason: 'disabled',
    })
  })
})

// The shape of a real `~/.codex/config.toml` (values replaced): a sub-table
// env, a multi-line array, a literal string, numbers and comments.
const CODEX_CONFIG = String.raw`model = "gpt-5"
[projects.'c:\users\me\x']
trust_level = "trusted"

[mcp_servers.context7]
command = 'npx' # a literal string
args = [
  "-y",
  "@upstash/context7-mcp",
]
startup_timeout_ms = 20000
enabled = true
[mcp_servers.context7.env]
CONTEXT7_API_KEY = "ctx7-secret"

[mcp_servers."remote docs"]
url = "https://docs.example.com/mcp"
http_headers = { "X-Region" = "eu" }
tool_timeout_sec = 60
enabled_tools = ["search", "fetch"]
cwd = "/tmp"

[mcp_servers.keyed]
url = "https://docs.example.com/mcp?key=abc"

[mcp_servers.off]
command = "off"
enabled = false

[mcp_servers.oauth]
url = "https://o.example.com/mcp"
auth = "oauth"

[mcp_servers.blank]
command = " "
`

describe('Codex config.toml', () => {
  it('reads every mcp_servers table, sub-tables included, and converts each', () => {
    const servers = readCodexConfig(CODEX_CONFIG)
    expect(servers?.map((server) => server.name)).toEqual([
      'context7',
      'remote docs',
      'keyed',
      'off',
      'oauth',
      'blank',
    ])
    const converted = servers?.map((server) => convertCodexServer(server.raw))
    expect(converted).toEqual([
      {
        ok: true,
        value: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp'],
          env: { CONTEXT7_API_KEY: 'ctx7-secret' },
          mode: 'optional',
          enabled: true,
        },
        dropped: ['startup_timeout_ms'],
      },
      {
        ok: true,
        value: {
          type: 'streamable-http',
          url: 'https://docs.example.com/mcp',
          headers: { 'X-Region': 'eu' },
          mode: 'optional',
          tool_timeout_sec: 60,
          enabled_tools: ['search', 'fetch'],
        },
        dropped: ['cwd'],
      },
      {
        ok: true,
        value: {
          type: 'streamable-http',
          url: 'https://docs.example.com/mcp?key=abc',
          mode: 'optional',
        },
        dropped: [],
      },
      { ok: false, reason: 'disabled' },
      { ok: false, reason: 'unsupported' },
      { ok: false, reason: 'unsupported' },
    ])
  })

  it('copies tool names unchanged', () => {
    expect(
      convertCodexServer({ command: 'x', enabled_tools: [SYNTHETIC.githubToken] }),
    ).toMatchObject({ ok: true, value: { enabled_tools: [SYNTHETIC.githubToken] } })
  })

  it('reports a file that is not TOML as unreadable, with nothing from it', () => {
    expect(readCodexConfig('[mcp_servers.x\ncommand = "ctx7-secret"')).toBeUndefined()
    expect(readCodexConfig('mcp_servers = 3')).toBeUndefined()
  })
})

describe('Claude Code and Cursor MCP files', () => {
  it('reads user and local servers from .claude.json, the project matched in either case', () => {
    const state = JSON.stringify({
      oauthAccount: { emailAddress: 'someone@example.com' },
      mcpServers: { user: { command: 'u' } },
      projects: {
        'c:/Users/me/ws': { mcpServers: { local: { command: 'l' } } },
        'C:/Users/me/other': { mcpServers: { elsewhere: { command: 'e' } } },
      },
    })
    expect(readClaudeState(state, String.raw`C:\Users\me\ws`, 'win32')).toEqual({
      user: [{ name: 'user', raw: { command: 'u' } }],
      local: [{ name: 'local', raw: { command: 'l' } }],
    })
    expect(readClaudeState(state, '/c/Users/me/ws', 'linux')?.local).toEqual([])
  })

  it('reads a .mcp.json and refuses what is not one', () => {
    expect(readMcpFile('{"mcpServers":{"a":{"command":"a"}}}')).toEqual([
      { name: 'a', raw: { command: 'a' } },
    ])
    expect(readMcpFile('{"mcpServers": [1]}')).toBeUndefined()
    expect(readMcpFile('{ "token": "secret-in-a-broken-file"')).toBeUndefined()
  })
})

describe('hooks', () => {
  const settings = JSON.stringify({
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'guard.sh', timeout: 30 }] },
        { matcher: '*', hooks: [{ type: 'command', command: 'all.sh' }] },
      ],
      UserPromptSubmit: [
        { matcher: 'ignored', hooks: [{ type: 'command', command: 'prompt.sh' }] },
      ],
      PostToolUse: [
        {
          matcher: 'Edit',
          hooks: [
            { type: 'command', command: 'fmt.sh', if: 'Edit(*.ts)' },
            { type: 'prompt', prompt: 'check' },
            { type: 'command', command: 'slow.sh', timeout: 100_000 },
            { type: 'command', command: 'TOKEN=abc notify.sh', async: true },
          ],
        },
      ],
      TeammateIdle: [{ hooks: [{ type: 'command', command: 'idle.sh' }] }],
    },
  })

  it('keeps a matcher, drops one Claude Code ignores, and refuses what would widen', () => {
    const found = readClaudeHooks(settings) ?? []
    expect(found.map((hook) => convertHook(hook))).toEqual([
      {
        ok: true,
        value: {
          event: 'PreToolUse',
          group: {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'guard.sh', timeout: 30 }],
          },
        },
        dropped: [],
      },
      {
        ok: true,
        value: { event: 'PreToolUse', group: { hooks: [{ type: 'command', command: 'all.sh' }] } },
        dropped: [],
      },
      {
        ok: true,
        value: {
          event: 'UserPromptSubmit',
          group: { hooks: [{ type: 'command', command: 'prompt.sh' }] },
        },
        dropped: [],
      },
      { ok: false, reason: 'unsupported' },
      { ok: false, reason: 'unsupported' },
      { ok: false, reason: 'unsupported' },
      // The command stays unchanged in an allowed target.
      {
        ok: true,
        value: {
          event: 'PostToolUse',
          group: {
            matcher: 'Edit',
            hooks: [{ type: 'command', command: 'TOKEN=abc notify.sh', async: true }],
          },
        },
        dropped: [],
      },
      { ok: false, reason: 'unmapped' },
    ])
  })

  it('refuses a file that is not a settings file', () => {
    expect(readClaudeHooks('{"hooks": {"PreToolUse": {}}}')).toBeUndefined()
    expect(readClaudeHooks('not json')).toBeUndefined()
    expect(readClaudeHooks('{"model": "x"}')).toEqual([])
  })
})

describe('Markdown', () => {
  it('splits front matter, unquoting values, first spelling winning', () => {
    expect(
      splitFrontMatter('---\ndescription: "Review: carefully"\nDescription: later\n---\n\nBody\n'),
    ).toEqual({ fields: { description: 'Review: carefully' }, body: 'Body' })
    expect(splitFrontMatter('No fence\n')).toEqual({ fields: {}, body: 'No fence' })
    expect(splitFrontMatter('---\nopen: fence\nBody')).toEqual({
      fields: {},
      body: '---\nopen: fence\nBody',
    })
  })

  it('writes SKILL.md front matter as single-quoted YAML, the hint kept', () => {
    expect(
      commandToSkill(
        'frontend-component',
        { description: "Build it: the team's way", 'argument-hint': '[name]' },
        'Make $ARGUMENTS.',
      ),
    ).toBe(
      "---\nname: frontend-component\ndescription: 'Build it: the team''s way'\nargument-hint: '[name]'\n---\n\nMake $ARGUMENTS.\n",
    )
    expect(commandToSkill('ship', {}, 'Ship it.')).toContain("description: 'ship'")
  })

  // RV83d #7: masking the generated file cut its closing quote. Nothing is
  // masked after serializing now: a description with a cue is refused
  // before (agentImport.test.ts), and an ordinary one is written whole.
  it('writes front matter the skill reader takes, its scalars closed', () => {
    const description = 'Keyboard shortcuts for reviewing code'
    const skill = commandToSkill('review', { description, 'argument-hint': '[file]' }, 'Review.')
    expect(parseSkillFile(skill)).toMatchObject({
      ok: true,
      skill: { name: 'review', description, argumentHint: '[file]', body: 'Review.' },
    })
    const scalars = skill
      .split('\n')
      .filter((line) => line.startsWith('description: ') || line.startsWith('argument-hint: '))
      .map((line) => line.slice(line.indexOf(': ') + 2))
    expect(scalars).toHaveLength(2)
    for (const scalar of scalars) {
      expect(scalar).toMatch(YAML_SINGLE_QUOTED)
    }
  })

  it('heads a rules section with its source and keeps a Cursor rule’s scope', () => {
    const heading = rulesHeading('Cursor', '.cursor/rules/ts.mdc')
    expect(heading).toBe('## Imported from Cursor (.cursor/rules/ts.mdc)')
    expect(rulesSection(heading, 'Use strict.', { description: 'TypeScript', globs: '*.ts' })).toBe(
      `${heading}\n\nWhen it applies: TypeScript\nFiles it applies to: *.ts\n\nUse strict.`,
    )
    expect(rulesSection(heading, 'Plain.')).toBe(`${heading}\n\nPlain.`)
  })

  it.each([
    ['', ''],
    ['a\n\n', ''],
    ['a\n', '\n'],
    ['a', '\n\n'],
  ])('separates %j from appended sections with %j', (current, separator) => {
    expect(appendSeparator(current)).toBe(separator)
  })
})

describe('hook text shown and copied', () => {
  it.each([
    ['its matcher', { matcher: `Bash|${SYNTHETIC.githubToken}` }, {}, 'token'],
    ['its status line', {}, { statusMessage: 'Posting with token=abc' }, 'name'],
  ])('preserves a hook with a credential in %s unchanged', (_name, group, handler, _cue) => {
    const [hook] =
      readClaudeHooks(
        JSON.stringify({
          hooks: {
            PreToolUse: [{ ...group, hooks: [{ type: 'command', command: 'x', ...handler }] }],
          },
        }),
      ) ?? []
    const converted = hook === undefined ? undefined : convertHook(hook)
    expect(converted).toMatchObject({ ok: true })
    expect(converted).toMatchObject({
      ok: true,
      value: { group: { ...group, hooks: [{ type: 'command', command: 'x', ...handler }] } },
    })
  })

  it('refuses a whitespace-only hook command as unsupported', () => {
    const [hook] =
      readClaudeHooks(
        JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: ' \t' }] }] } }),
      ) ?? []
    expect(hook === undefined ? undefined : convertHook(hook)).toEqual({
      ok: false,
      reason: 'unsupported',
    })
  })
})
