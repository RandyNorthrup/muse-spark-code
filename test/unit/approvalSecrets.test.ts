// The approval-card secret scrub (M92e, PLAN.md D71): shell commands holding
// a detected secret reach the panel redacted, noted and with no standing
// approve choice, on both backends. Secrets are built at runtime, so no
// secret-shaped literal sits in the repository.

import { describe, expect, it } from 'vitest'
import {
  hasApprovalSecret,
  scrubSecretApproval,
  scrubSecretChoices,
  scrubSecretSubject,
  shellSecretText,
} from '../../src/core/agent/approvalSecrets'
import { UI_TEXT } from '../../src/shared/constants'
import type { AgentEvent, ApprovalSubject } from '../../src/shared/agentEvents'

type ApprovalRequest = Extract<AgentEvent, { type: 'approvalRequested' }>

/** A detected secret, built at runtime. */
function secretValue(): string {
  return `sk-${'k'.repeat(24)}`
}

function shellSubject(command: string): ApprovalSubject {
  return { kind: 'shell', command }
}

function shellRequest(command: string): ApprovalRequest {
  return {
    type: 'approvalRequested',
    approvalId: 'approval-1',
    itemId: 'item-1',
    toolName: 'bash',
    rawArgs: JSON.stringify({ command }),
    requirementId: { approvalId: 'approval-1', sourceIndex: 0 },
    subject: shellSubject(command),
    availableChoices: [
      { choiceId: 'allow_once', label: 'Allow once', decision: 'approved', scope: 'once' },
      {
        choiceId: 'allow_session',
        label: `Always allow in this session: ${command}`,
        decision: 'approvedPolicyAmendment',
        scope: 'session',
        rulePreview: `Always allow in this session: ${command}`,
      },
      { choiceId: 'abort', label: 'Reject', decision: 'abort', scope: 'once' },
    ],
    isJudgeEscalated: false,
    isProtectedWrite: false,
  }
}

describe('shellSecretText', () => {
  it('reads a shell command and every stage line, and nothing else', () => {
    expect(shellSecretText(shellSubject('git status'))).toBe('git status')
    expect(
      shellSecretText({
        kind: 'shell',
        stages: [
          {
            requirementId: { approvalId: 'a', sourceIndex: 0 },
            position: 1,
            totalStages: 2,
            argv: ['npm', 'test'],
          },
          {
            requirementId: { approvalId: 'a', sourceIndex: 1 },
            position: 2,
            totalStages: 2,
            argv: ['npm', 'run', 'lint'],
          },
        ],
      }),
    ).toBe('npm test npm run lint')
    expect(shellSecretText({ kind: 'fileWrite', path: 'a.txt' })).toBeUndefined()
    expect(shellSecretText({ kind: 'shell' })).toBeUndefined()
  })
})

describe('hasApprovalSecret', () => {
  it('finds a detected secret in a shell command or a stage, and nowhere else', () => {
    expect(hasApprovalSecret(shellSubject(`deploy --token ${secretValue()}`))).toBe(true)
    expect(
      hasApprovalSecret({
        kind: 'shell',
        stages: [
          {
            requirementId: { approvalId: 'a', sourceIndex: 0 },
            position: 1,
            totalStages: 1,
            argv: ['deploy', '--token', secretValue()],
          },
        ],
      }),
    ).toBe(true)
    expect(hasApprovalSecret(shellSubject('git status'))).toBe(false)
    expect(hasApprovalSecret({ kind: 'fileWrite', path: 'a.txt' })).toBe(false)
  })
})

describe('scrubSecretSubject', () => {
  it('redacts a secret command and leaves a clean one alone', () => {
    const secret = secretValue()
    expect(scrubSecretSubject(shellSubject(`deploy --token ${secret}`))).toEqual(
      shellSubject('deploy --token [redacted]'),
    )
    const clean = shellSubject('git status')
    expect(scrubSecretSubject(clean)).toBe(clean)
    const write = { kind: 'fileWrite', path: 'a.txt' } as const
    expect(scrubSecretSubject(write)).toBe(write)
  })
})

describe('scrubSecretChoices', () => {
  it('drops a standing approve and redacts the command out of the rest', () => {
    const secret = secretValue()
    const scrubbed = scrubSecretChoices(shellRequest(`deploy --token ${secret}`).availableChoices)
    expect(scrubbed.map((choice) => choice.choiceId)).toEqual(['allow_once', 'abort'])
    expect(scrubbed.map((choice) => choice.label)).toEqual(['Allow once', 'Reject'])
  })
})

describe('scrubSecretApproval', () => {
  it('redacts the card, notes the secret and keeps the decision ids', () => {
    const secret = secretValue()
    const command = `deploy --token ${secret}`
    const scrubbed = scrubSecretApproval(shellRequest(command))
    expect(scrubbed.subject.command).toBe('deploy --token [redacted]')
    expect(scrubbed.rawArgs).toBe(JSON.stringify({ command: 'deploy --token [redacted]' }))
    expect(scrubbed.note).toBe(UI_TEXT.approvalSecretNote)
    expect(scrubbed.availableChoices.map((choice) => choice.choiceId)).toEqual([
      'allow_once',
      'abort',
    ])
    expect(scrubbed.approvalId).toBe('approval-1')
    expect(scrubbed.requirementId).toEqual({ approvalId: 'approval-1', sourceIndex: 0 })
  })

  it('leaves a clean card exactly as it was', () => {
    const request = shellRequest('git status')
    expect(scrubSecretApproval(request)).toBe(request)
  })

  it('redacts stage lines and notes an updated card too', () => {
    const secret = secretValue()
    const updated: Extract<AgentEvent, { type: 'approvalUpdated' }> = {
      type: 'approvalUpdated',
      approvalId: 'approval-1',
      requirementId: { approvalId: 'approval-1', sourceIndex: 1 },
      subject: {
        kind: 'shell',
        stages: [
          {
            requirementId: { approvalId: 'approval-1', sourceIndex: 1 },
            position: 2,
            totalStages: 2,
            argv: ['deploy', '--token', secret],
          },
        ],
      },
      availableChoices: [
        { choiceId: 'allow_once', label: 'Allow once', decision: 'approved', scope: 'once' },
        { choiceId: 'abort', label: 'Reject', decision: 'abort', scope: 'once' },
      ],
    }
    const scrubbed = scrubSecretApproval(updated)
    expect(scrubbed.subject.stages?.map((stage) => stage.argv)).toEqual([
      ['deploy', '--token', '[redacted]'],
    ])
    expect(scrubbed.note).toBe(UI_TEXT.approvalSecretNote)
  })
})
