import { describe, expect, it } from 'vitest'
import { childPermissionMode, editAutomaticallyChoice } from '../../src/core/agent/approvalRules'
import { APPROVAL_CHOICE_IDS, choicesFor } from '../../src/core/backends/modelapi/permissions'
import { narrowApprovalMode } from '../../src/core/context/customAgents'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { PERMISSION_MODES, type PermissionMode } from '../../src/shared/constants'
import { mspApprovalMode } from '../../src/shared/permissionModes'

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
