import { describe, expect, it } from 'vitest'
import {
  APPROVAL_CHOICE_IDS,
  choicesFor,
  isKnownChoice,
  PermissionEngine,
  type ToolClass,
  verdictFor,
} from '../../src/core/backends/modelapi/permissions'
import { compilePolicy } from '../../src/core/backends/modelapi/permissionPolicy'
import { isProtectedPath } from '../../src/core/protectedPaths'
import { confineWorkspacePath, resolveWorkspacePath } from '../../src/core/workspacePath'
import { APPROVAL_MODES, type ApprovalMode } from '../../src/shared/permissionModes'

const CLASSES: readonly ToolClass[] = [
  'read',
  'edit',
  'shell',
  'interactive',
  'paid',
  'mcp',
  'spawn',
  'network',
]

/** One PowerShell call as the engine judges it. */
function shell(command: string) {
  return { toolName: 'powershell', toolClass: 'shell', command } as const
}

describe('verdictFor', () => {
  it('follows the mode truth table', () => {
    const table: Record<ApprovalMode, Record<ToolClass, string>> = {
      allowAll: {
        read: 'allow',
        edit: 'allow',
        shell: 'allow',
        interactive: 'allow',
        paid: 'ask',
        mcp: 'allow',
        spawn: 'ask',
        network: 'allow',
      },
      onRequest: {
        read: 'allow',
        edit: 'allow',
        shell: 'ask',
        interactive: 'allow',
        paid: 'ask',
        mcp: 'ask',
        spawn: 'ask',
        network: 'ask',
      },
      promptUnmatched: {
        read: 'allow',
        edit: 'ask',
        shell: 'ask',
        interactive: 'allow',
        paid: 'ask',
        mcp: 'ask',
        spawn: 'ask',
        network: 'ask',
      },
      denyUnmatched: {
        read: 'allow',
        edit: 'deny',
        shell: 'deny',
        interactive: 'allow',
        paid: 'deny',
        mcp: 'deny',
        spawn: 'deny',
        network: 'deny',
      },
    }
    for (const mode of APPROVAL_MODES) {
      for (const toolClass of CLASSES) {
        expect(verdictFor(mode, toolClass), `${mode}/${toolClass}`).toBe(table[mode][toolClass])
      }
    }
  })

  it('asks for a protected write in every mode but Bypass and Plan (D24)', () => {
    expect(verdictFor('allowAll', 'edit', true)).toBe('allow')
    expect(verdictFor('onRequest', 'edit', true)).toBe('ask')
    expect(verdictFor('promptUnmatched', 'edit', true)).toBe('ask')
    expect(verdictFor('denyUnmatched', 'edit', true)).toBe('deny')
  })

  it('eases an MCP tool its server marks read-only: runs in Auto, asks in Plan (M50)', () => {
    expect(verdictFor('allowAll', 'mcp', false, true)).toBe('allow')
    expect(verdictFor('onRequest', 'mcp', false, true)).toBe('allow')
    expect(verdictFor('promptUnmatched', 'mcp', false, true)).toBe('ask')
    expect(verdictFor('denyUnmatched', 'mcp', false, true)).toBe('ask')
  })

  it('remembers "always allow" for an MCP tool, and not for another (M50)', () => {
    const engine = new PermissionEngine('promptUnmatched')
    const query = { toolName: 'mcp__docs__search', toolClass: 'mcp' } as const
    expect(engine.verdict(query)).toBe('ask')
    engine.allowForSession('mcp__docs__search')
    expect(engine.verdict(query)).toBe('allow')
    expect(engine.verdict({ ...query, toolName: 'mcp__docs__write' })).toBe('ask')
    engine.setMode('denyUnmatched')
    expect(engine.verdict(query)).toBe('deny')
    expect(engine.verdict({ ...query, isReadOnly: true })).toBe('allow')
  })
})

describe('isProtectedPath', () => {
  it('protects what configures or runs code, at any depth and in any case', () => {
    for (const path of [
      '.git/hooks/pre-commit',
      '.git/config',
      '.git',
      'vendor/lib/.git/config',
      '.GIT/HOOKS/x',
      '.husky/pre-push',
      '.vscode/tasks.json',
      '.idea/runConfigurations/a.xml',
      '.devcontainer/devcontainer.json',
      '.github/workflows/ci.yml',
      '.agents/skills/x/SKILL.md',
      '.muse/hooks.json',
      '.muse/settings.json',
      'packages/app/.MUSE/hooks.json',
      'AGENTS.md',
      'src/CLAUDE.md',
      '.envrc',
      '.gitmodules',
    ]) {
      expect(isProtectedPath(path), path).toBe(true)
    }
  })

  it('leaves ordinary files alone, including look-alikes', () => {
    for (const path of [
      'src/a.ts',
      '.github/ISSUE_TEMPLATE/bug.md',
      'docs/git/notes.md',
      '.gitignore',
      'my.git/x',
      'agents.md.bak',
      'workflows/.github',
      'muse/notes.md',
      'docs/.muse.md',
      'my.muse/hooks.json',
    ]) {
      expect(isProtectedPath(path), path).toBe(false)
    }
  })
})

// Other coding agents' folders (2026-10-04): their hooks, MCP servers,
// plugins and settings run outside this extension's approvals.
describe('isProtectedPath: other coding agents’ folders', () => {
  it.each([
    ['.claude', ['.claude/settings.json', '.claude/settings.local.json', '.claude/agents/a.md']],
    ['.codex', ['.codex/hooks.json', '.codex/config.toml']],
    ['.cursor', ['.cursor/hooks.json', '.cursor/mcp.json', '.cursor/rules/a.mdc']],
    ['.gemini', ['.gemini/settings.json']],
    ['.github/hooks', ['.github/hooks/hooks.json']],
    ['.github/copilot', ['.github/copilot/settings.json']],
    ['.devin', ['.devin/hooks.json']],
    ['.windsurf', ['.windsurf/hooks.json']],
    ['.kiro', ['.kiro/hooks/lint.kiro.hook', '.kiro/settings/mcp.json']],
    ['.clinerules', ['.clinerules/hooks/PreToolUse', '.clinerules']],
    ['.amp', ['.amp/plugins/run.ts']],
    ['.opencode', ['.opencode/plugin/run.ts', '.opencode/opencode.json']],
  ])('protects %s, at any depth and in any case', (_folder, paths) => {
    for (const path of paths) {
      expect(isProtectedPath(path), path).toBe(true)
      expect(isProtectedPath(`packages/app/${path.toUpperCase()}`), path).toBe(true)
    }
  })

  it('protects mixed case and nesting', () => {
    for (const path of [
      '.Claude/settings.json',
      'apps/web/.Cursor/mcp.json',
      '.GitHub/Hooks/hooks.json',
      'tools/.github/COPILOT/settings.json',
    ]) {
      expect(isProtectedPath(path), path).toBe(true)
    }
  })

  it('judges a Windows path as the tools resolve it: backslashes separate only on Windows', () => {
    const windows = resolveWorkspacePath(
      String.raw`C:\ws`,
      String.raw`.Claude\settings.json`,
      'win32',
    )
    expect(windows).toMatchObject({ ok: true, canonical: '.Claude/settings.json' })
    expect(windows.ok && isProtectedPath(windows.canonical)).toBe(true)
    // On macOS and Linux the backslash is part of a file name at the root.
    const posix = resolveWorkspacePath('/ws', String.raw`.Claude\settings.json`, 'linux')
    expect(posix).toMatchObject({ ok: true, canonical: String.raw`.Claude\settings.json` })
    expect(posix.ok && isProtectedPath(posix.canonical)).toBe(false)
  })

  it('judges the folder a link or junction leads to, not the name written', async () => {
    const junction = await confineWorkspacePath(
      String.raw`C:\ws`,
      String.raw`cfg\settings.json`,
      'win32',
      {
        realPath: (absolute) =>
          Promise.resolve(absolute.replace(String.raw`C:\ws\cfg`, String.raw`C:\ws\.claude`)),
      },
    )
    expect(junction).toMatchObject({ ok: true, relative: 'cfg/settings.json' })
    expect(junction.ok && isProtectedPath(junction.relative)).toBe(false)
    expect(junction.ok && isProtectedPath(junction.canonical)).toBe(true)
  })

  it('leaves look-alikes alone', () => {
    for (const path of [
      'notclaude/.claudex/file',
      '.claude-backup.txt',
      'claude/settings.json',
      'docs/.claude.md',
      'my.cursor/mcp.json',
      '.cursorignore',
      '.codex.bak/hooks.json',
      '.geminiignore',
      '.github/hooksmith/x.json',
      'hooks/.github',
      'copilot/.github',
      '.kirox/hooks/a',
      '.clinerules.md',
      'amp/plugins/run.ts',
      'opencode/plugin/run.ts',
    ]) {
      expect(isProtectedPath(path), path).toBe(false)
    }
  })
})

// The agents' own files outside those folders (2026-10-04): MCP servers they
// start, and instructions that steer the next agent to read them.
describe('isProtectedPath: other coding agents’ files', () => {
  it.each([
    ['.mcp.json', ['.mcp.json']],
    ['GEMINI.md', ['GEMINI.md']],
    ['AGENTS.md', ['AGENTS.md']],
    ['CLAUDE.md', ['CLAUDE.md']],
    ['.cursorrules', ['.cursorrules']],
    ['.windsurfrules', ['.windsurfrules']],
    ['.github/copilot-instructions.md', ['.github/copilot-instructions.md']],
    ['opencode.json', ['opencode.json', 'opencode.jsonc']],
    ['.roomodes', ['.roomodes']],
    ['.clinerules as a file', ['.clinerules']],
    ['.continue', ['.continue/rules/a.md', '.continue/mcpServers/run.yaml']],
    ['.roo', ['.roo/mcp.json', '.roo/rules/a.md', '.roo/rules-code/a.md']],
  ])('protects %s, at any depth and in any case', (_file, paths) => {
    for (const path of paths) {
      expect(isProtectedPath(path), path).toBe(true)
      expect(isProtectedPath(`packages/app/${path.toUpperCase()}`), path).toBe(true)
      expect(isProtectedPath(`src/${path.toLowerCase()}`), path).toBe(true)
    }
  })

  it('leaves look-alikes alone', () => {
    for (const path of [
      '.mcp.json.bak',
      'mcp.json',
      'docs/GEMINI-notes.md',
      'gemini.md.txt',
      '.cursorrules.md',
      'windsurfrules',
      'copilot-instructions.md',
      '.github/docs/copilot-instructions.md',
      'my-opencode.json',
      'opencode.json5',
      '.roomodes.bak',
      '.continuex/rules/a.md',
      'continue/rules/a.md',
      '.roo-backup/mcp.json',
      'roo/mcp.json',
    ]) {
      expect(isProtectedPath(path), path).toBe(false)
    }
  })
})

describe('PermissionEngine', () => {
  it('applies session rules only where the mode would ask', () => {
    const engine = new PermissionEngine('promptUnmatched')
    const edit = { toolName: 'edit_file', toolClass: 'edit' } as const
    expect(engine.verdict(edit)).toBe('ask')
    engine.allowForSession('edit_file')
    expect(engine.verdict(edit)).toBe('allow')
    expect(engine.verdict({ toolName: 'write_file', toolClass: 'edit' })).toBe('ask')
    engine.setMode('denyUnmatched')
    expect(engine.currentMode).toBe('denyUnmatched')
    // A rule never overrides a refusal.
    expect(engine.verdict(edit)).toBe('deny')
  })

  it('keys a shell rule on the exact command line (D24)', () => {
    const engine = new PermissionEngine('promptUnmatched')
    engine.allowForSession('powershell', 'npm test')
    expect(engine.verdict(shell('npm test'))).toBe('allow')
    expect(engine.verdict(shell('npm test; rm -r .'))).toBe('ask')
    expect(engine.verdict(shell('Remove-Item -Recurse .'))).toBe('ask')
  })

  it('never lets a session rule approve a protected write', () => {
    const engine = new PermissionEngine('onRequest')
    engine.allowForSession('edit_file')
    expect(engine.verdict({ toolName: 'edit_file', toolClass: 'edit', isProtected: true })).toBe(
      'ask',
    )
    expect(engine.verdict({ toolName: 'edit_file', toolClass: 'edit' })).toBe('allow')
  })

  it('never lets Bypass or a session rule approve a new paid child task', () => {
    const bypass = new PermissionEngine('allowAll')
    const manual = new PermissionEngine('promptUnmatched')
    const spawn = { toolName: 'subagent_spawn', toolClass: 'spawn' } as const
    expect(bypass.verdict(spawn)).toBe('ask')
    manual.allowForSession('subagent_spawn')
    expect(manual.verdict(spawn)).toBe('ask')
  })
})

describe('choicesFor / isKnownChoice', () => {
  it('offers once, session and reject-with-feedback in the MSP vocabulary', () => {
    const choices = choicesFor('edit_file')
    expect(choices.map((choice) => choice.choiceId)).toEqual([
      APPROVAL_CHOICE_IDS.allowOnce,
      APPROVAL_CHOICE_IDS.allowSession,
      APPROVAL_CHOICE_IDS.abort,
    ])
    expect(choices[1]).toMatchObject({
      label: 'Always allow in this session: edit_file',
      decision: 'approvedPolicyAmendment',
      scope: 'session',
    })
    expect(choices[2]).toMatchObject({ decision: 'abort', acceptsFeedback: true })
  })

  it('names the command in a shell card, and knows only its own choice ids', () => {
    expect(choicesFor('bash', 'npm test')[1]).toMatchObject({
      label: 'Always allow in this session: npm test',
    })
    expect(isKnownChoice('allow_once')).toBe(true)
    expect(isKnownChoice('abort')).toBe(true)
    expect(isKnownChoice('allow_local_prefix')).toBe(false)
  })
})

/** One web fetch as the engine judges it: its session rule is the host. */
function fetchFrom(host: string) {
  return { toolName: 'web_fetch', toolClass: 'network', command: host } as const
}

describe('web fetch (M69, PLAN.md D49)', () => {
  it('asks in every mode but Bypass, and Plan refuses it', () => {
    expect(
      Object.fromEntries(APPROVAL_MODES.map((mode) => [mode, verdictFor(mode, 'network')])),
    ).toEqual({
      allowAll: 'allow',
      onRequest: 'ask',
      promptUnmatched: 'ask',
      denyUnmatched: 'deny',
    })
    // A server's read-only hint is an MCP notion; it never eases a fetch.
    expect(verdictFor('onRequest', 'network', false, true)).toBe('ask')
  })

  it('keys "always allow in this session" on the host, and names it on the card', () => {
    const engine = new PermissionEngine('onRequest')
    expect(engine.verdict(fetchFrom('docs.example.com'))).toBe('ask')
    engine.allowForSession('web_fetch', 'docs.example.com')
    expect(engine.verdict(fetchFrom('docs.example.com'))).toBe('allow')
    expect(engine.verdict(fetchFrom('evil.example.net'))).toBe('ask')
    engine.setMode('denyUnmatched')
    expect(engine.verdict(fetchFrom('docs.example.com'))).toBe('deny')
    expect(choicesFor('web_fetch', 'docs.example.com')[1]).toMatchObject({
      label: 'Always allow in this session: docs.example.com',
    })
  })

  // M81: what widens a browser check beyond loopback when no card shows.
  it('tells whether the user chose "always" for a host, whatever the mode says', () => {
    const engine = new PermissionEngine('allowAll')
    const check = {
      toolName: 'browser_check',
      toolClass: 'network',
      command: 'intranet.example',
    } as const
    expect(engine.verdict(check)).toBe('allow')
    expect(engine.isAllowedForSession(check)).toBe(false)
    engine.allowForSession('browser_check', 'intranet.example')
    expect(engine.isAllowedForSession(check)).toBe(true)
    expect(engine.isAllowedForSession({ ...check, command: 'other.example' })).toBe(false)
    expect(engine.isAllowedForSession({ ...check, toolName: 'web_fetch' })).toBe(false)
  })
})

describe('paid calls (M34, PLAN.md D30)', () => {
  it('ask in every mode, Bypass included, and Plan refuses them', () => {
    expect(APPROVAL_MODES.map((mode) => [mode, verdictFor(mode, 'paid')])).toEqual(
      APPROVAL_MODES.map((mode) => [mode, mode === 'denyUnmatched' ? 'deny' : 'ask']),
    )
  })

  it('are never answered by a session rule', () => {
    const engine = new PermissionEngine('allowAll')
    engine.allowForSession('generate_image')
    expect(engine.verdict({ toolName: 'generate_image', toolClass: 'paid' })).toBe('ask')
  })
})

// --- M78 (PLAN.md D49): command rules, the profile and the Auto reviewer's reach ---

/** A policy of the user's rules, with or without a profile on. */
function policyOf(profile = '') {
  return compilePolicy(
    {
      commandRules: [
        { pattern: ['git', 'status'], decision: 'allow', match: ['git status'] },
        { pattern: ['git', 'push'], decision: 'ask', match: ['git push'] },
        { pattern: ['rm', '-rf'], decision: 'forbid', match: ['rm -rf x'] },
      ],
      profiles: { locked: { denyRead: ['**/.env'] } },
      profile,
      repositoryRules: {},
    },
    'linux',
  )
}

function bash(command: string) {
  return { toolName: 'bash', toolClass: 'shell', command, dialect: 'bash' } as const
}

describe('PermissionEngine.judge: shell commands under the rules (M78)', () => {
  const policy = policyOf()

  it('refuses a forbidden command in every mode, Bypass included', () => {
    for (const mode of APPROVAL_MODES) {
      expect(new PermissionEngine(mode).judge(bash('rm -rf build'), policy)).toMatchObject({
        verdict: 'deny',
        settledBy: 'forbidRule',
        isReviewable: false,
      })
    }
  })

  it('runs a rule-allowed command in Auto and in Manual, and Plan still refuses it', () => {
    for (const mode of ['onRequest', 'promptUnmatched'] as const) {
      expect(new PermissionEngine(mode).judge(bash('git status'), policy)).toMatchObject({
        verdict: 'allow',
        settledBy: 'allowRule',
      })
    }
    expect(new PermissionEngine('denyUnmatched').judge(bash('git status'), policy).verdict).toBe(
      'deny',
    )
  })

  it('asks for an ask rule with no session choice, and the reviewer never answers it', () => {
    const engine = new PermissionEngine('onRequest')
    engine.allowForSession('bash', 'git push')
    expect(engine.judge(bash('git push'), policy)).toEqual({
      verdict: 'ask',
      settledBy: 'askRule',
      rule: policy.commandRules[1],
      isReviewable: false,
      hasSessionChoice: false,
    })
    // Bypass skips questions, never refusals.
    expect(new PermissionEngine('allowAll').judge(bash('git push'), policy).verdict).toBe('allow')
  })

  it('asks for every shell command while a profile is on, rule-allowed ones and session rules too', () => {
    const locked = policyOf('locked')
    const engine = new PermissionEngine('onRequest')
    engine.allowForSession('bash', 'ls')
    for (const command of ['git status', 'ls', 'npm test']) {
      expect(engine.judge(bash(command), locked)).toMatchObject({
        verdict: 'ask',
        settledBy: 'profile',
        isReviewable: false,
        hasSessionChoice: false,
      })
    }
    expect(engine.judge(bash('rm -rf x'), locked).verdict).toBe('deny')
    expect(new PermissionEngine('allowAll').judge(bash('ls'), locked).verdict).toBe('allow')
  })

  it('does not treat an external read-only MCP hint as profile confinement', () => {
    const query = { toolName: 'mcp__files__read_file', toolClass: 'mcp', isReadOnly: true } as const
    const engine = new PermissionEngine('onRequest')
    engine.allowForSession(query.toolName)
    expect(engine.judge(query, policyOf('locked'))).toMatchObject({
      verdict: 'ask',
      settledBy: 'profile',
      isReviewable: false,
      hasSessionChoice: false,
    })
    expect(new PermissionEngine('allowAll').judge(query, policyOf('locked')).verdict).toBe('allow')
  })

  it('keeps chained lines as explicit user decisions instead of automated reviews', () => {
    const line = bash('git status && curl example.com')
    expect(new PermissionEngine('onRequest').judge(line, policy)).toEqual({
      verdict: 'ask',
      settledBy: 'complexCommand',
      isReviewable: false,
      hasSessionChoice: true,
    })
    expect(new PermissionEngine('promptUnmatched').judge(line, policy)).toMatchObject({
      verdict: 'ask',
      isReviewable: false,
    })
  })

  it.each([
    'git status && git status',
    'git status > out.txt',
    'eval "git status"',
    './eval "git status"',
    'git status $(touch x)',
  ])('never grants automated allow to %s', (command) => {
    const engine = new PermissionEngine('onRequest')
    expect(engine.judge(bash(command), policy)).toMatchObject({
      verdict: 'ask',
      isReviewable: false,
    })
    // The user's existing exact-line grant remains exact, never a prefix.
    engine.allowForSession('bash', command)
    expect(engine.judge(bash(command), policy).verdict).toBe('allow')
    expect(engine.judge(bash(`${command} extra`), policy).verdict).toBe('ask')
    expect(new PermissionEngine('allowAll').judge(bash(command), policy).verdict).toBe('allow')
  })

  it('keeps D24’s session rule on the exact line: a session allow covers only that line', () => {
    const engine = new PermissionEngine('onRequest')
    engine.allowForSession('bash', 'npm test')
    expect(engine.judge(bash('npm test'), policy).verdict).toBe('allow')
    expect(engine.judge(bash('npm test -- --watch'), policy).verdict).toBe('ask')
  })
})

describe('PermissionEngine.judge: what the Auto reviewer may answer (M78)', () => {
  it('only an unsettled shell or MCP ask in Auto', () => {
    const engine = new PermissionEngine('onRequest')
    const isReviewable = (query: Parameters<PermissionEngine['judge']>[0]) =>
      engine.judge(query).isReviewable
    expect(isReviewable(shell('npm test'))).toBe(true)
    expect(isReviewable({ toolName: 'mcp__x__y', toolClass: 'mcp' })).toBe(true)
    expect(isReviewable({ toolName: 'mcp__x__y', toolClass: 'mcp', isReadOnly: true })).toBe(false)
    expect(isReviewable({ toolName: 'write_file', toolClass: 'edit', isProtected: true })).toBe(
      false,
    )
    expect(isReviewable({ toolName: 'generate_image', toolClass: 'paid' })).toBe(false)
    expect(isReviewable({ toolName: 'subagent_spawn', toolClass: 'spawn' })).toBe(false)
    expect(isReviewable({ toolName: 'write_file', toolClass: 'edit' })).toBe(false)
  })

  it('nothing in any other mode', () => {
    for (const mode of ['allowAll', 'promptUnmatched', 'denyUnmatched'] as const) {
      const engine = new PermissionEngine(mode)
      expect(engine.judge(shell('npm test')).isReviewable).toBe(false)
      expect(engine.judge({ toolName: 'mcp__x__y', toolClass: 'mcp' }).isReviewable).toBe(false)
    }
  })

  it('offers the session choice for a protected write as before, which never answers it', () => {
    const engine = new PermissionEngine('onRequest')
    const write = { toolName: 'write_file', toolClass: 'edit', isProtected: true } as const
    engine.allowForSession('write_file')
    expect(engine.judge(write)).toEqual({
      verdict: 'ask',
      isReviewable: false,
      hasSessionChoice: true,
    })
  })
})

describe('choicesFor: no session choice where no session rule could answer (M78)', () => {
  it('leaves out "Always allow in this session"', () => {
    expect(choicesFor('bash', 'git push', false).map((choice) => choice.choiceId)).toEqual([
      APPROVAL_CHOICE_IDS.allowOnce,
      APPROVAL_CHOICE_IDS.abort,
    ])
  })
})
