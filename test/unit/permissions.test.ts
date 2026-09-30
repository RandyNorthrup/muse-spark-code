import { describe, expect, it } from 'vitest'
import {
  APPROVAL_CHOICE_IDS,
  choicesFor,
  isKnownChoice,
  PermissionEngine,
  type ToolClass,
  verdictFor,
} from '../../src/core/backends/modelapi/permissions'
import { isProtectedPath } from '../../src/core/protectedPaths'
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
