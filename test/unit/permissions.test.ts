import { describe, expect, it } from 'vitest'
import {
  APPROVAL_CHOICE_IDS,
  choicesFor,
  PermissionEngine,
  type ToolClass,
  verdictFor,
} from '../../src/core/backends/modelapi/permissions'
import { APPROVAL_MODES, type ApprovalMode } from '../../src/shared/permissionModes'

const CLASSES: readonly ToolClass[] = ['read', 'edit', 'shell', 'interactive']

describe('verdictFor', () => {
  it('follows the mode truth table', () => {
    const table: Record<ApprovalMode, Record<ToolClass, string>> = {
      allowAll: { read: 'allow', edit: 'allow', shell: 'allow', interactive: 'allow' },
      onRequest: { read: 'allow', edit: 'allow', shell: 'ask', interactive: 'allow' },
      promptUnmatched: { read: 'allow', edit: 'ask', shell: 'ask', interactive: 'allow' },
      denyUnmatched: { read: 'allow', edit: 'deny', shell: 'deny', interactive: 'allow' },
    }
    for (const mode of APPROVAL_MODES) {
      for (const toolClass of CLASSES) {
        expect(verdictFor(mode, toolClass), `${mode}/${toolClass}`).toBe(table[mode][toolClass])
      }
    }
  })
})

describe('PermissionEngine', () => {
  it('applies session rules only where the mode would ask', () => {
    const engine = new PermissionEngine('promptUnmatched')
    expect(engine.verdict('powershell', 'shell')).toBe('ask')
    engine.allowForSession('powershell')
    expect(engine.verdict('powershell', 'shell')).toBe('allow')
    expect(engine.verdict('bash', 'shell')).toBe('ask')
    engine.setMode('denyUnmatched')
    expect(engine.currentMode).toBe('denyUnmatched')
    // A rule never overrides a refusal.
    expect(engine.verdict('powershell', 'shell')).toBe('deny')
  })
})

describe('choicesFor', () => {
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
})
