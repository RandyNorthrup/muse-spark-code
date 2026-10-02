// The other agents' shapes converted to Muse Code's (M83): the MCP entry
// Muse Code 1.4.0-R4302.1's `migrate` skill writes, hooks that never widen,
// SKILL.md front matter a YAML reader takes, and rules sections.

import { describe, expect, it } from 'vitest'
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

const MASK = '[masked]'

describe('convertJsonServer', () => {
  it('converts a stdio server with its env masked and mode optional', () => {
    expect(
      convertJsonServer(
        {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp', '--api-key', 'ctx7-secret'],
          env: { CONTEXT7_API_KEY: 'ctx7-secret', NODE_ENV: 'production' },
          timeout: 30,
          alwaysLoad: true,
        },
        MASK,
      ),
    ).toEqual({
      ok: true,
      value: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp', '--api-key', MASK],
        env: { CONTEXT7_API_KEY: MASK, NODE_ENV: MASK },
        mode: 'optional',
      },
      dropped: ['timeout', 'alwaysLoad'],
    })
  })

  it('reads a bare command as stdio and a bare URL (Cursor) as streamable HTTP', () => {
    expect(convertJsonServer({ command: 'docs-mcp' }, MASK)).toMatchObject({
      ok: true,
      value: { type: 'stdio', command: 'docs-mcp' },
    })
    expect(
      convertJsonServer(
        { url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer abc' } },
        MASK,
      ),
    ).toEqual({
      ok: true,
      value: {
        type: 'streamable-http',
        url: 'https://mcp.example.com/mcp',
        headers: { Authorization: MASK },
        mode: 'optional',
      },
      dropped: [],
    })
  })

  it.each([
    ['an SSE transport', { type: 'sse', url: 'https://x/sse' }],
    ['a WebSocket transport', { type: 'ws', url: 'wss://x' }],
    ['OAuth', { type: 'http', url: 'https://x', oauth: { clientId: 'a' } }],
    ['a header helper', { type: 'http', url: 'https://x', headersHelper: './h.sh' }],
    ['a non-string env value', { command: 'x', env: { A: 1 } }],
    ['neither a command nor a URL', { type: 'stdio' }],
  ])('refuses %s as unsupported', (_name, raw) => {
    expect(convertJsonServer(raw, MASK)).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('skips a server that is turned off', () => {
    expect(convertJsonServer({ command: 'x', enabled: false }, MASK)).toEqual({
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
url = "https://docs.example.com/mcp?key=abc"
http_headers = { "X-Api-Key" = "abc" }
tool_timeout_sec = 60
cwd = "/tmp"

[mcp_servers.off]
command = "off"
enabled = false

[mcp_servers.oauth]
url = "https://o.example.com/mcp"
auth = "oauth"
`

describe('Codex config.toml', () => {
  it('reads every mcp_servers table, sub-tables included, and converts each', () => {
    const servers = readCodexConfig(CODEX_CONFIG)
    expect(servers?.map((server) => server.name)).toEqual([
      'context7',
      'remote docs',
      'off',
      'oauth',
    ])
    const converted = servers?.map((server) => convertCodexServer(server.raw, MASK))
    expect(converted).toEqual([
      {
        ok: true,
        value: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp'],
          env: { CONTEXT7_API_KEY: MASK },
          mode: 'optional',
          enabled: true,
        },
        dropped: ['startup_timeout_ms'],
      },
      {
        ok: true,
        value: {
          type: 'streamable-http',
          url: `https://docs.example.com/mcp?key=${MASK}`,
          headers: { 'X-Api-Key': MASK },
          mode: 'optional',
          tool_timeout_sec: 60,
        },
        dropped: ['cwd'],
      },
      { ok: false, reason: 'disabled' },
      { ok: false, reason: 'unsupported' },
    ])
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
    expect(found.map((hook) => convertHook(hook, MASK))).toEqual([
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
      {
        ok: true,
        value: {
          event: 'PostToolUse',
          group: {
            matcher: 'Edit',
            // From the credential's value to the end of the line, failing closed.
            hooks: [{ type: 'command', command: `TOKEN=${MASK}`, async: true }],
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
  it('masks the matcher and the status line as well as the command', () => {
    const [hook] =
      readClaudeHooks(
        JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: `Bash|${SYNTHETIC.githubToken}`,
                hooks: [
                  {
                    type: 'command',
                    command: 'x',
                    statusMessage: `token=${SYNTHETIC.githubToken}`,
                  },
                ],
              },
            ],
          },
        }),
      ) ?? []
    const converted = hook === undefined ? undefined : convertHook(hook, MASK)
    expect(JSON.stringify(converted)).not.toContain(SYNTHETIC.githubToken)
    expect(converted).toMatchObject({
      ok: true,
      value: {
        group: {
          matcher: `Bash|${MASK}`,
          hooks: [{ statusMessage: `token=${MASK}` }],
        },
      },
    })
  })
})
