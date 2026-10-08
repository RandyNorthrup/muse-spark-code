// Muse Code's file-write approvals judged by the extension's protected list
// (D24, 2026-10-04). Muse Code flags only its own list: it wrote
// `.claude/settings.json` with no approval in the capture, so a `fileAccess`
// write it asks about but does not flag is protected by its path here, from
// the captured frame's shape (helpers/protectedWriteCapture.ts).

import { describe, expect, it } from 'vitest'
import { editAutomaticallyChoice, isReviewableApproval } from '../../src/core/agent/approvalRules'
import { mapNotification } from '../../src/core/backends/musecode/mapNotification'
import { isProtectedFileAccess } from '../../src/core/protectedPaths'
import type { AgentEvent, ApprovalChoice } from '../../src/shared/agentEvents'
import {
  CAPTURED_TURN_ID,
  CAPTURED_WORKSPACE,
  capturedWriteRequested,
} from './helpers/protectedWriteCapture'

type ApprovalRequest = Extract<AgentEvent, { type: 'approvalRequested' }>
type ApprovalUpdate = Extract<AgentEvent, { type: 'approvalUpdated' }>

const SESSION_ID = 'session-1'
// Ordinary DOS controls: device-prefixed subjects require a manual decision on Windows.
const ORDINARY_WORKSPACE = String.raw`C:\Users\dev\protect-live\ws2`
// "Always allow in this workspace", as Muse Code 1.4.2 offers one
// (helpers/stageRaceCapture.ts, 2026-10-02); the captured file write offered
// none, being one Muse Code protects itself.
const ALWAYS: ApprovalChoice = {
  choiceId: 'allow_local_prefix',
  label: 'Always allow in this workspace: write_file ...',
  decision: 'approvedPolicyAmendment',
  scope: 'localPersistent',
  rulePreview: 'Always allow in this workspace: write_file ...',
}
const CHOICES_WITHOUT_RULE = ['allow_once', 'abort']
const CHOICES_WITH_RULE = ['allow_once', 'allow_local_prefix', 'abort']

const PROTECTED_CASES = [
  ['absolute, as Muse Code names it', String.raw`${CAPTURED_WORKSPACE}\.claude\settings.json`],
  ['absolute, forward slashes', 'C:/Users/dev/protect-live/ws2/.claude/settings.json'],
  ['absolute on macOS and Linux', '/home/dev/ws2/.claude/settings.json'],
  ['relative, forward slashes', '.claude/settings.json'],
  ['relative, backslashes', String.raw`.claude\settings.json`],
  ['in any case', String.raw`${CAPTURED_WORKSPACE}\.Claude\Settings.JSON`],
  ['outside the workspace, from the home folder', '~/.claude/settings.json'],
  ['outside the workspace, absolute', String.raw`\\?\C:\Users\dev\.claude\settings.json`],
  ['an agent file, nested', String.raw`${CAPTURED_WORKSPACE}\packages\app\.mcp.json`],
] as const

const LOOK_ALIKES = [
  String.raw`${ORDINARY_WORKSPACE}\.claude-backup.txt`,
  String.raw`${ORDINARY_WORKSPACE}\notclaude\.claudex\file`,
  '/home/dev/ws2/claude/settings.json',
  String.raw`${ORDINARY_WORKSPACE}\docs\.mcp.json.bak`,
] as const

/** The captured frame for `path`, with an "Always allow" choice beside its own. */
function requestFor(path: string, isFlagged: boolean): ApprovalRequest {
  const params = capturedWriteRequested(SESSION_ID, path, isFlagged)
  const [once, abort] = params['availableChoices'] as readonly ApprovalChoice[]
  const mapped = mapNotification({
    method: 'approval/requested',
    params: { ...params, availableChoices: [once, ALWAYS, abort] },
  })
  if (
    typeof mapped === 'string' ||
    !('event' in mapped) ||
    mapped.event.type !== 'approvalRequested'
  ) {
    throw new Error('the captured request did not map')
  }
  return mapped.event
}

/** An `approval/updated` for the captured approval, now about `path`. */
function updateFor(path: string): ApprovalUpdate {
  const captured = capturedWriteRequested(SESSION_ID, path, false)
  const [once, abort] = captured['availableChoices'] as readonly ApprovalChoice[]
  const mapped = mapNotification({
    method: 'approval/updated',
    params: {
      sessionId: SESSION_ID,
      approvalId: captured['approvalId'],
      currentRequirementId: captured['currentRequirementId'],
      subject: captured['subject'],
      availableChoices: [once, ALWAYS, abort],
    },
  })
  if (
    typeof mapped === 'string' ||
    !('event' in mapped) ||
    mapped.event.type !== 'approvalUpdated'
  ) {
    throw new Error('the update did not map')
  }
  return mapped.event
}

function choiceIds(event: { readonly availableChoices: readonly ApprovalChoice[] }): string[] {
  return event.availableChoices.map((choice) => choice.choiceId)
}

describe('Muse Code file-write approvals and the extension’s protected list', () => {
  it('maps the captured frame as Muse Code flagged it, and answers nothing', () => {
    const mapped = mapNotification({
      method: 'approval/requested',
      params: capturedWriteRequested(SESSION_ID),
    })
    expect(mapped).toMatchObject({
      sessionId: SESSION_ID,
      event: {
        type: 'approvalRequested',
        toolName: 'write_file',
        subject: {
          kind: 'fileAccess',
          toolName: 'write_file',
          path: String.raw`${CAPTURED_WORKSPACE}\.muse\hooks.json`,
          access: 'write',
        },
        isProtectedWrite: true,
        turnId: CAPTURED_TURN_ID,
      },
    })
    const request = requestFor(String.raw`${CAPTURED_WORKSPACE}\.muse\hooks.json`, true)
    expect(editAutomaticallyChoice(request, 'acceptEdits')).toBeUndefined()
    expect(isReviewableApproval(request, 'auto', CAPTURED_TURN_ID)).toBe(false)
  })

  it.each(PROTECTED_CASES)('protects a write Muse Code does not flag: %s', (_case, path) => {
    const request = requestFor(path, false)
    expect(request.isProtectedWrite).toBe(true)
    expect(choiceIds(request)).toEqual(CHOICES_WITHOUT_RULE)
    expect(editAutomaticallyChoice(request, 'acceptEdits')).toBeUndefined()
    expect(isReviewableApproval(request, 'auto', CAPTURED_TURN_ID)).toBe(false)
  })

  it.each(PROTECTED_CASES)(
    'refuses to answer it by its path alone, with no flag on the event: %s',
    (_case, path) => {
      const ordinary = requestFor(String.raw`${ORDINARY_WORKSPACE}\notes.txt`, false)
      const event: ApprovalRequest = { ...ordinary, subject: { ...ordinary.subject, path } }
      expect(event.isProtectedWrite).toBe(false)
      expect(editAutomaticallyChoice(event, 'acceptEdits')).toBeUndefined()
      expect(isReviewableApproval(event, 'auto', CAPTURED_TURN_ID)).toBe(false)
    },
  )

  it.each(LOOK_ALIKES)('leaves a look-alike as Muse Code asked it: %s', (path) => {
    const request = requestFor(path, false)
    expect(request.isProtectedWrite).toBe(false)
    expect(choiceIds(request)).toEqual(CHOICES_WITH_RULE)
    expect(editAutomaticallyChoice(request, 'acceptEdits')?.choiceId).toBe('allow_once')
    expect(isReviewableApproval(request, 'auto', CAPTURED_TURN_ID)).toBe(true)
  })

  it('treats a read as a read, and an access it does not name as a write', () => {
    const path = String.raw`${CAPTURED_WORKSPACE}\.claude\settings.json`
    expect(isProtectedFileAccess({ kind: 'fileAccess', path, access: 'read' })).toBe(false)
    expect(isProtectedFileAccess({ kind: 'fileAccess', path, access: 'readWrite' })).toBe(true)
    expect(isProtectedFileAccess({ kind: 'fileAccess', path })).toBe(true)
    expect(isProtectedFileAccess({ kind: 'fileAccess', access: 'write' })).toBe(false)
    // The Model API's own subjects carry its host's verdict instead (D41's notes).
    expect(isProtectedFileAccess({ kind: 'fileWrite', path: '.agents/memory/MEMORY.md' })).toBe(
      false,
    )
  })

  it('offers no standing rule when the approval is updated either', () => {
    expect(choiceIds(updateFor('~/.claude/settings.json'))).toEqual(CHOICES_WITHOUT_RULE)
    expect(choiceIds(updateFor(String.raw`${ORDINARY_WORKSPACE}\notes.txt`))).toEqual(
      CHOICES_WITH_RULE,
    )
  })
})
