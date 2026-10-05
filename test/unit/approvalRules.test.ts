import { describe, expect, it } from 'vitest'
import {
  allowOnceChoice,
  childPermissionMode,
  editAutomaticallyChoice,
  isReviewableApproval,
} from '../../src/core/agent/approvalRules'
import { APPROVAL_CHOICE_IDS, choicesFor } from '../../src/core/backends/modelapi/permissions'
import { mapNotification } from '../../src/core/backends/musecode/mapNotification'
import { narrowApprovalMode } from '../../src/core/context/customAgents'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { PERMISSION_MODES, type PermissionMode } from '../../src/shared/constants'
import { mspApprovalMode } from '../../src/shared/permissionModes'
import { raceRequested } from './helpers/stageRaceCapture'

type ApprovalRequest = Extract<AgentEvent, { type: 'approvalRequested' }>

/** A plain `write_file` card, as the Model API host raises it, from a child with `child` policy. */
function writeRequest(
  child: PermissionMode | undefined,
  overrides: Partial<ApprovalRequest> = {},
): ApprovalRequest {
  return {
    type: 'approvalRequested',
    approvalId: 'approval-1',
    itemId: 'item-1',
    toolName: 'write_file',
    rawArgs: '{"path":"a.txt","content":"x"}',
    requirementId: { approvalId: 'approval-1', sourceIndex: 0 },
    subject: { kind: 'fileWrite', path: 'a.txt', toolName: 'write_file' },
    availableChoices: [...choicesFor('write_file')],
    isJudgeEscalated: false,
    isProtectedWrite: false,
    ...(child !== undefined && { permissionMode: child }),
    ...overrides,
  }
}

const CHILD_MODES = [undefined, ...PERMISSION_MODES] as const

// The mode a child's approvals are answered under, written out pair by pair
// (M76 review, RV70x): rows are the parent's mode, columns the agent's
// `permission-mode` (none, then each mode). A Manual parent caps every
// child, a Manual child asks under any parent, and an Edit automatically
// child keeps its automation under Auto and Bypass, which permit it.
const EXPECTED: Readonly<
  Record<PermissionMode, Readonly<Record<PermissionMode | 'none', PermissionMode>>>
> = {
  plan: {
    none: 'plan',
    manual: 'plan',
    acceptEdits: 'plan',
    plan: 'plan',
    auto: 'plan',
    bypassPermissions: 'plan',
  },
  manual: {
    none: 'manual',
    manual: 'manual',
    acceptEdits: 'manual',
    plan: 'plan',
    auto: 'manual',
    bypassPermissions: 'manual',
  },
  acceptEdits: {
    none: 'acceptEdits',
    manual: 'manual',
    acceptEdits: 'acceptEdits',
    plan: 'plan',
    auto: 'acceptEdits',
    bypassPermissions: 'acceptEdits',
  },
  auto: {
    none: 'auto',
    manual: 'manual',
    acceptEdits: 'acceptEdits',
    plan: 'plan',
    auto: 'auto',
    bypassPermissions: 'auto',
  },
  bypassPermissions: {
    none: 'bypassPermissions',
    manual: 'manual',
    acceptEdits: 'acceptEdits',
    plan: 'plan',
    auto: 'auto',
    bypassPermissions: 'bypassPermissions',
  },
}

const PAIRS = PERMISSION_MODES.flatMap((parent) =>
  CHILD_MODES.map((child) => ({
    parent,
    child,
    expected: EXPECTED[parent][child ?? 'none'],
  })),
)

describe('child approval policy (M76 review, RV70x)', () => {
  it('covers every parent mode and every child permission-mode', () => {
    expect(PAIRS).toHaveLength(PERMISSION_MODES.length * (PERMISSION_MODES.length + 1))
  })

  it.each(PAIRS)(
    'parent $parent, child $child: answered under $expected',
    ({ parent, child, expected }) => {
      expect(childPermissionMode(parent, child)).toBe(expected)
      // The host narrows the child's approval mode on its own side; the two
      // must agree, or a card would be raised for a mode that runs it.
      expect(
        narrowApprovalMode(
          mspApprovalMode(parent),
          child === undefined ? undefined : mspApprovalMode(child),
        ),
      ).toBe(mspApprovalMode(expected))
      // An ordinary write is answered automatically exactly under Edit automatically.
      const automatic = editAutomaticallyChoice(writeRequest(child), parent)
      expect(automatic?.choiceId).toBe(
        expected === 'acceptEdits' ? APPROVAL_CHOICE_IDS.allowOnce : undefined,
      )
    },
  )

  it.each(PAIRS)(
    'parent $parent, child $child: a protected, replayed or escalated write always asks',
    ({ parent, child }) => {
      for (const overrides of [
        { isProtectedWrite: true },
        { isReplayed: true },
        { isJudgeEscalated: true },
        { subject: { kind: 'command', command: 'npm test', toolName: 'bash' } },
      ]) {
        expect(editAutomaticallyChoice(writeRequest(child, overrides), parent)).toBeUndefined()
      }
    },
  )
})

/** The captured eight-stage PowerShell line (stageRaceCapture), asked by turn `t1`. */
function shellRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  const mapped = mapNotification({
    method: 'approval/requested',
    params: { ...raceRequested('s1'), turnId: 't1' },
  })
  if (
    typeof mapped === 'string' ||
    !('event' in mapped) ||
    mapped.event.type !== 'approvalRequested'
  ) {
    throw new Error('the captured request did not map')
  }
  return { ...mapped.event, ...overrides }
}

describe('the Auto reviewer on Muse Code: what it may answer (M90, PLAN.md D69)', () => {
  it('takes a request of the running parent turn in Auto, with its allow-once choice', () => {
    expect(isReviewableApproval(shellRequest(), 'auto', 't1')).toBe(true)
    for (const kind of ['fileAccess', 'network', 'unixSocket', 'process', 'tool']) {
      expect(
        isReviewableApproval(shellRequest({ subject: { kind, path: 'x' } }), 'auto', 't1'),
      ).toBe(true)
    }
  })

  it.each(PERMISSION_MODES.filter((mode) => mode !== 'auto'))(
    'never in %s, whatever a custom child’s own mode says',
    (mode) => {
      expect(isReviewableApproval(shellRequest(), mode, 't1')).toBe(false)
      // A Bypass parent's child set to Auto answers under Auto; the panel's
      // mode is still not Auto, so no reviewer.
      expect(isReviewableApproval(shellRequest({ permissionMode: 'auto' }), mode, 't1')).toBe(false)
    },
  )

  it.each([
    ['a request replayed to a later surface', { isReplayed: true }],
    ['a protected write', { isProtectedWrite: true }],
    ['one the CLI’s judge escalated', { isJudgeEscalated: true }],
    ['a child’s (another turn)', { turnId: 'child-session-1' }],
    ['one that names no turn', { turnId: undefined }],
    ['a subject kind MSP does not name', { subject: { kind: 'somethingNew', command: 'x' } }],
    [
      'a child task',
      { toolName: 'subagent_spawn', subject: { kind: 'tool', toolName: 'subagent_spawn' } },
    ],
    ['a paid image call', { toolName: 'mcp__ide__generateImage', subject: { kind: 'tool' } }],
    [
      'a paid call named on its subject',
      { subject: { kind: 'tool', toolName: 'mcp__ide__editImage' } },
    ],
    [
      'a request with no allow-once choice',
      {
        availableChoices: [
          { choiceId: 'abort', label: 'Reject', decision: 'abort', scope: 'once' },
        ],
      },
    ],
    ['a custom child that asks', { permissionMode: 'manual' as const }],
    // M92e (PLAN.md D71): the secret is built at runtime, never as a literal.
    [
      'a shell command holding a detected secret',
      { subject: { kind: 'shell', command: `deploy --token sk-${'k'.repeat(24)}` } },
    ],
  ])('never %s', (_case, overrides: Partial<ApprovalRequest>) => {
    expect(isReviewableApproval(shellRequest(overrides), 'auto', 't1')).toBe(false)
  })

  it('takes the allow-once choice, never an "always" one', () => {
    const request = shellRequest()
    expect(request.availableChoices.map((choice) => choice.choiceId)).toEqual([
      'allow_once',
      'allow_local_prefix',
      'abort',
    ])
    expect(allowOnceChoice(request)?.choiceId).toBe('allow_once')
    expect(
      allowOnceChoice({
        availableChoices: request.availableChoices.filter(
          (choice) => choice.choiceId !== 'allow_once',
        ),
      }),
    ).toBeUndefined()
  })
})
