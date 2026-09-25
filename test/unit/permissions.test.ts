import { describe, expect, it } from 'vitest'
import {
  APPROVAL_CHOICE_IDS,
  choicesFor,
  isKnownChoice,
  isProtectedPath,
  paidChoices,
  PermissionEngine,
  type ToolClass,
  verdictFor,
} from '../../src/core/backends/modelapi/permissions'
import { APPROVAL_MODES, type ApprovalMode } from '../../src/shared/permissionModes'

const CLASSES: readonly ToolClass[] = ['read', 'edit', 'shell', 'interactive', 'paid']

/** One PowerShell call as the engine judges it. */
function shell(command: string) {
  return { toolName: 'powershell', toolClass: 'shell', command } as const
}

describe('verdictFor', () => {
  it('follows the mode truth table', () => {
    const table: Record<ApprovalMode, Record<ToolClass, string>> = {
      allowAll: { read: 'allow', edit: 'allow', shell: 'allow', interactive: 'allow', paid: 'ask' },
      onRequest: { read: 'allow', edit: 'allow', shell: 'ask', interactive: 'allow', paid: 'ask' },
      promptUnmatched: {
        read: 'allow',
        edit: 'ask',
        shell: 'ask',
        interactive: 'allow',
        paid: 'ask',
      },
      denyUnmatched: {
        read: 'allow',
        edit: 'deny',
        shell: 'deny',
        interactive: 'allow',
        paid: 'deny',
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

describe('paid calls (M34, PLAN.md D30)', () => {
  it('ask in every mode, Bypass included, and Plan refuses them', () => {
    expect(APPROVAL_MODES.map((mode) => [mode, verdictFor(mode, 'paid')])).toEqual(
      APPROVAL_MODES.map((mode) => [mode, mode === 'denyUnmatched' ? 'deny' : 'ask']),
    )
  })

  it('are never answered by a session rule, and offer no "always allow"', () => {
    const engine = new PermissionEngine('allowAll')
    engine.allowForSession('generate_image')
    expect(engine.verdict({ toolName: 'generate_image', toolClass: 'paid' })).toBe('ask')
    expect(paidChoices().map((choice) => choice.choiceId)).toEqual([
      APPROVAL_CHOICE_IDS.allowOnce,
      APPROVAL_CHOICE_IDS.abort,
    ])
  })
})
