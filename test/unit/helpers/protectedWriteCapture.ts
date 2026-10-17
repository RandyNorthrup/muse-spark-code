// Muse Code 1.4.2-R4684.1's file-write approval, as captured live on
// 2026-10-04 (docs/certification/protect-agent-folders.md): `muse serve
// --disable-sandbox --trust-workspace` (the extension's arguments for a
// workspace under the user's profile) in a fresh empty workspace, Manual
// (`promptUnmatched`), `muse-spark-1.3-contributor`. Asked to write
// `.muse/hooks.json`, Muse Code raised this frame; `notes.txt`,
// `.claude/settings.json` and a file outside the workspace were written with
// no approval at all. Only the workspace's folder is replaced: the captured
// one was under the owner's profile.

const APPROVAL_ID = '01a1088f-3849-78c0-a0bb-b691f57c1f27'
export const CAPTURED_TURN_ID = '01a1088e-ca4a-7000-bebe-0697eb540868'
/** The workspace as Muse Code names it: verbatim prefix, Windows separators. */
export const CAPTURED_WORKSPACE = String.raw`\\?\C:\Users\dev\protect-live\ws2`
const HOOKS_PATH = String.raw`${CAPTURED_WORKSPACE}\.muse\hooks.json`

/** The `approval/requested` params, with `path` and Muse Code's own flag (`isFlagged`) replaceable. */
export function capturedWriteRequested(
  sessionId: string,
  path = HOOKS_PATH,
  isFlagged = true,
): Record<string, unknown> {
  return {
    sessionId,
    approvalId: APPROVAL_ID,
    turnId: CAPTURED_TURN_ID,
    taskId: APPROVAL_ID,
    itemId: APPROVAL_ID,
    toolCallId: 'call_01a1088f38e571a7a1a1c07a3774a9d6',
    toolName: 'write_file',
    rawArgs: '{"content":"{}","path":".muse/hooks.json"}',
    viewCursor: `v:${sessionId}:7`,
    sourceRange: {},
    subject: { kind: 'fileAccess', toolName: 'write_file', path, access: 'write' },
    currentRequirementId: { approvalId: APPROVAL_ID, sourceIndex: 0 },
    availableChoices: [
      { choiceId: 'allow_once', label: 'Allow once', decision: 'approved', scope: 'once' },
      {
        choiceId: 'abort',
        label: 'Reject',
        decision: 'abort',
        scope: 'once',
        acceptsFeedback: true,
      },
    ],
    protectedWrite: isFlagged,
    judgeEscalated: false,
  }
}
