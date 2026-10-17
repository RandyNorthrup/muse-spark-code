// The other agents' shapes converted to Muse Code's (M83): the MCP entry
// Muse Code 1.4.0-R4302.1's `migrate` skill writes, hooks that never widen,
// SKILL.md front matter a YAML reader takes, and rules sections. A server or
// hook values are preserved in exposure-checked targets.

import { describe, expect, it } from 'vitest'
import { parseSkillFile } from '../../src/core/context/skills'
import {
  appendSeparator,
  commandToSkill,
  convertClaudeSparkHook,
  convertCodexHook,
  convertCodexServer,
  convertHook,
  convertJsonServer,
  convertWindsurfHook,
  hasCodexNotify,
  readClaudeHooks,
  readClaudeState,
  readCodexConfig,
  readCodexHooksToml,
  readMcpFile,
  readWindsurfHooks,
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

// Codex hooks (M91): `hooks.json` and the inline `[hooks]` table of
// `config.toml`, converted into Muse Code's own files.
describe('Codex hooks', () => {
  const hooksToml = [
    'notify = "ping"',
    '[mcp_servers.docs]',
    'command = "docs-mcp"',
    '[[hooks.PreToolUse]]',
    'matcher = "Bash"',
    '[[hooks.PreToolUse.hooks]]',
    'type = "command"',
    'command = "guard"',
    '[[hooks.Interrupt]]',
    '[[hooks.Interrupt.hooks]]',
    'type = "command"',
    'command = "note"',
    'async = true',
    '',
  ].join('\n')

  it('reads the inline hooks table and the notify program from config.toml', () => {
    expect(hasCodexNotify(hooksToml)).toBe(true)
    expect(hasCodexNotify('[mcp_servers.docs]\ncommand = "d"\n')).toBe(false)
    expect(hasCodexNotify('[broken')).toBe(false)
    expect(readCodexHooksToml(hooksToml)?.map((hook) => hook.event)).toEqual([
      'PreToolUse',
      'Interrupt',
    ])
    expect(readCodexHooksToml(hooksToml)?.[0]).toMatchObject({ matcher: 'Bash' })
    // No hooks table is a valid file with nothing in it.
    expect(readCodexHooksToml('[mcp_servers.docs]\ncommand = "d"\n')).toEqual([])
    // A hooks table of the wrong shape is unreadable, with nothing from it.
    expect(readCodexHooksToml('hooks = 3\n')).toBeUndefined()
    expect(readCodexHooksToml('[broken')).toBeUndefined()
  })

  it.each([
    'SessionStart',
    'SessionEnd',
    'PreToolUse',
    'PermissionRequest',
    'PostToolUse',
    'PreCompact',
    'PostCompact',
    'SubagentStart',
    'SubagentStop',
  ])('converts a %s command hook with its matcher kept', (event) => {
    expect(
      convertCodexHook({
        event,
        matcher: 'Bash',
        raw: { type: 'command', command: 'guard' },
      }),
    ).toMatchObject({
      ok: true,
      value: {
        event,
        group: { matcher: 'Bash', hooks: [{ type: 'command', command: 'guard' }] },
      },
    })
  })

  it.each(['UserPromptSubmit', 'Stop'])('drops the matcher %s ignores', (event) => {
    expect(
      convertCodexHook({
        event,
        matcher: 'Bash',
        raw: { type: 'command', command: 'guard' },
      }),
    ).toMatchObject({
      ok: true,
      value: { event, group: { hooks: [{ type: 'command', command: 'guard' }] } },
    })
  })

  it('converts Interrupt only with async:true, and keeps commandWindows', () => {
    expect(
      convertCodexHook({
        event: 'Interrupt',
        matcher: undefined,
        raw: { type: 'command', command: 'note', async: true },
      }),
    ).toMatchObject({ ok: true, value: { event: 'Interrupt' } })
    expect(
      convertCodexHook({
        event: 'Interrupt',
        matcher: undefined,
        raw: { type: 'command', command: 'note' },
      }),
    ).toEqual({ ok: false, reason: 'unsupported' })
    expect(
      convertCodexHook({
        event: 'PostToolUse',
        matcher: undefined,
        raw: { type: 'command', command: 'fmt', commandWindows: 'fmt.ps1' },
      }),
    ).toMatchObject({
      ok: true,
      value: {
        group: { hooks: [{ type: 'command', command: 'fmt', commandWindows: 'fmt.ps1' }] },
      },
    })
  })

  it('names apply_patch Edit|Write in matchers', () => {
    expect(
      convertCodexHook({
        event: 'PreToolUse',
        matcher: 'apply_patch|Bash',
        raw: { type: 'command', command: 'guard' },
      }),
    ).toMatchObject({
      ok: true,
      value: { group: { matcher: 'Edit|Write|Bash' } },
    })
  })

  it.each([
    ['a prompt handler', { type: 'prompt', prompt: 'check' }, 'unsupported', undefined],
    ['an agent handler', { type: 'agent', prompt: 'check' }, 'unsupported', undefined],
    ['an MCP handler', { type: 'mcp_tool', command: 'x' }, 'unsupported', undefined],
    [
      'additionalContextLimit',
      { type: 'command', command: 'x', additionalContextLimit: 3 },
      'field',
      'additionalContextLimit',
    ],
    ['an unknown field', { type: 'command', command: 'x', shell: 'sh' }, 'unsupported', undefined],
    ['a blank command', { type: 'command', command: ' ' }, 'unsupported', undefined],
    ['a long timeout', { type: 'command', command: 'x', timeout: 601 }, 'unsupported', undefined],
  ])('refuses %s', (_name, raw, reason, field) => {
    expect(convertCodexHook({ event: 'PreToolUse', matcher: undefined, raw })).toEqual(
      field === undefined ? { ok: false, reason } : { ok: false, reason, field },
    )
  })

  it('leaves events Codex does not send unmapped', () => {
    expect(
      convertCodexHook({
        event: 'PostToolUseFailure',
        matcher: undefined,
        raw: { type: 'command', command: 'x' },
      }),
    ).toEqual({ ok: false, reason: 'unmapped' })
  })
})

// Claude Code's extension events (M91): the native `spark-hooks.json` shape,
// without a format tag.
describe('Claude Code extension hooks', () => {
  it.each([
    'InstructionsLoaded',
    'UserPromptExpansion',
    'PermissionDenied',
    'PreModelSwitch',
    'PostModelSwitch',
    'TaskCreated',
    'TaskCompleted',
    'FileChanged',
    'WorktreeRemove',
  ])('carries %s into spark-hooks.json with no format tag', (event) => {
    const converted = convertClaudeSparkHook({
      event,
      matcher: event === 'FileChanged' ? '*.ts' : undefined,
      raw: { type: 'command', command: 'watch' },
    })
    expect(converted).toMatchObject({ ok: true, value: { event } })
    expect(converted).toMatchObject({
      ok: true,
      value: { group: { hooks: [{ command: 'watch' }] } },
    })
    if (converted.ok) {
      expect(converted.value.group).not.toHaveProperty('format')
    }
  })

  it.each(['WorktreeCreate', 'ConfigChange'])(
    'refuses %s as weaker: it observes here what blocks there',
    (event) => {
      expect(
        convertClaudeSparkHook({
          event,
          matcher: undefined,
          raw: { type: 'command', command: 'x' },
        }),
      ).toEqual({ ok: false, reason: 'weaker' })
    },
  )

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['match-all', '*'],
  ])('refuses FileChanged with a %s matcher as needsMatcher', (_name, matcher) => {
    expect(
      convertClaudeSparkHook({
        event: 'FileChanged',
        matcher,
        raw: { type: 'command', command: 'x' },
      }),
    ).toEqual({ ok: false, reason: 'needsMatcher' })
  })

  it('leaves Muse-native and other extension-less events unmapped', () => {
    for (const event of ['Stop', 'Manual', 'Interrupt']) {
      expect(
        convertClaudeSparkHook({
          event,
          matcher: undefined,
          raw: { type: 'command', command: 'x' },
        }),
      ).toEqual({ ok: false, reason: 'unmapped' })
    }
  })

  it('refuses prompt handlers as unsupported', () => {
    expect(
      convertClaudeSparkHook({
        event: 'Stop',
        matcher: undefined,
        raw: { type: 'prompt', prompt: 'check' },
      }),
    ).toEqual({ ok: false, reason: 'unmapped' })
    expect(
      convertClaudeSparkHook({
        event: 'TaskCreated',
        matcher: undefined,
        raw: { type: 'prompt', prompt: 'check' },
      }),
    ).toEqual({ ok: false, reason: 'unsupported' })
  })
})

// Windsurf hooks (M91): exit codes only, with a `Windsurf` format tag.
describe('Windsurf hooks', () => {
  it.each([
    ['pre_read_code', 'PreToolUse', 'Read'],
    ['post_read_code', 'PostToolUse', 'Read'],
    ['pre_write_code', 'PreToolUse', 'Edit|Write'],
    ['post_write_code', 'PostToolUse', 'Edit|Write'],
    ['pre_run_command', 'PreToolUse', 'Bash'],
    ['post_run_command', 'PostToolUse', 'Bash'],
    ['pre_mcp_tool_use', 'PreToolUse', 'mcp__.*'],
    ['post_mcp_tool_use', 'PostToolUse', 'mcp__.*'],
  ])('maps %s to %s on %s', (source, event, matcher) => {
    expect(
      convertWindsurfHook({ event: source, matcher: undefined, raw: { command: 'guard' } }),
    ).toMatchObject({
      ok: true,
      value: { event, group: { matcher, format: 'windsurf', sourceEvent: source } },
    })
  })

  it('reads the hooks file, converts prompts and answers, and waits on worktrees', () => {
    const hooks = readWindsurfHooks(
      JSON.stringify({
        hooks: {
          pre_user_prompt: [{ command: 'expand' }],
          post_cascade_response: [{ command: 'summarize' }],
          post_setup_worktree: [{ command: 'setup' }],
        },
      }),
    )
    expect(hooks?.map((hook) => hook.event)).toEqual([
      'pre_user_prompt',
      'post_cascade_response',
      'post_setup_worktree',
    ])
    expect(hooks?.map((hook) => convertWindsurfHook(hook))).toMatchObject([
      { ok: true, value: { event: 'UserPromptSubmit' } },
      { ok: true, value: { event: 'Stop', group: { async: true } } },
      // WorktreeCreate is an extension event: M91b routes imports there.
      { ok: false, reason: 'unsupported' },
    ])
    expect(readWindsurfHooks('not json')).toBeUndefined()
  })

  it('keeps the Windows spelling and drops show_output', () => {
    expect(
      convertWindsurfHook({
        event: 'pre_run_command',
        matcher: undefined,
        raw: { powershell: 'guard.ps1', show_output: true },
      }),
    ).toEqual({
      ok: true,
      value: {
        event: 'PreToolUse',
        group: {
          matcher: 'Bash',
          format: 'windsurf',
          sourceEvent: 'pre_run_command',
          hooks: [{ type: 'command', commandWindows: 'guard.ps1' }],
          sourceEntry: { powershell: 'guard.ps1', show_output: true },
        },
      },
      dropped: ['show_output'],
    })
  })

  it('leaves the transcript answer unmapped', () => {
    expect(
      convertWindsurfHook({
        event: 'post_cascade_response_with_transcript',
        matcher: undefined,
        raw: { command: 'x' },
      }),
    ).toEqual({ ok: false, reason: 'unmapped' })
  })

  it('refuses an unknown field by name and an entry with no runnable spelling', () => {
    expect(
      convertWindsurfHook({
        event: 'pre_run_command',
        matcher: undefined,
        raw: { command: 'x', working_directory: 'sub' },
      }),
    ).toEqual({ ok: false, reason: 'field', field: 'working_directory' })
    expect(
      convertWindsurfHook({
        event: 'pre_run_command',
        matcher: undefined,
        raw: { show_output: true },
      }),
    ).toEqual({ ok: false, reason: 'unsupported' })
  })
})
