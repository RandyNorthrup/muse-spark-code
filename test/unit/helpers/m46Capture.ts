// Frames Muse Code 1.3.0 sent in the M46 live capture (2026-09-25, contributor
// model, C:\muse-live-m46 with the sandbox on and C:\muse-live-m46b with it off;
// docs/certification/m46.md). The tests build on these shapes, not on guesses
// (AGENTS.md rule 13). Cursors and source ranges are left out, as nothing reads
// them, and the frames of both runs carry the second run's session id.

const SESSION = '01a0d9fc-f493-7391-b417-abfe8b9be1b4'
const TURN = '01a0d9fd-102e-7000-878a-22111fd746d7'

/** The session every frame below belongs to. */
export const CAPTURED_SESSION_ID = SESSION

/** `session/userShell` for `Write-Output 'hello-m46'`: started, then completed. */
export const USER_SHELL_STARTED = {
  sessionId: SESSION,
  item: {
    itemId: '61f15604-a1b2-4ba3-8f88-82f69276fd60',
    kind: 'userShell',
    turnId: null,
    revision: 1,
    status: 'inProgress',
    recordedAt: '2026-09-25T19:13:49.136845Z',
    commandId: '01a0d9fc-f64e-7000-a639-027a17288c24',
    commandText: "Write-Output 'hello-m46'",
  },
}

export const USER_SHELL_COMPLETED = {
  sessionId: SESSION,
  item: {
    ...USER_SHELL_STARTED.item,
    revision: 2,
    status: 'completed',
    recordedAt: '2026-09-25T19:13:49.712383Z',
    visibleOutput: 'hello-m46\r\n',
    exitCode: 0,
    durationMs: 563,
  },
}

/** `Write-Output 'failing-m46'; exit 3`: failed, with its exit code. */
export const USER_SHELL_FAILED = {
  sessionId: SESSION,
  item: {
    itemId: '65dde9d9-2037-48e4-8926-0c870d3498b0',
    kind: 'userShell',
    turnId: null,
    revision: 2,
    status: 'failed',
    recordedAt: '2026-09-25T19:13:50.354709Z',
    commandId: '01a0d9fc-f89a-7000-895f-215fcfd14003',
    visibleOutput: 'tool failed: exit code: 3\nstdout:\nfailing-m46\r\n',
    commandText: "Write-Output 'failing-m46'; exit 3",
    exitCode: 3,
    durationMs: 617,
  },
}

/** The same command with the Windows sandbox on and not set up (the first capture). */
export const USER_SHELL_SANDBOX_FAILED = {
  sessionId: SESSION,
  item: {
    itemId: '0eb1fa9c-6202-40e4-b750-535510b49f05',
    kind: 'userShell',
    turnId: null,
    revision: 2,
    status: 'failed',
    recordedAt: '2026-09-25T19:08:31.571503Z',
    commandId: '01a0d9f8-1d90-7000-beaa-411fc517fba2',
    visibleOutput:
      'tool failed: environment failure: managed shell sandbox is unavailable\nThe execution environment is broken: the command was never started and every later command will fail the same way. Do not retry and do not fabricate command output; report this environment failure.',
    commandText: "Write-Output 'hello-m46'",
    durationMs: 50,
  },
}

const SHELL_ITEM = {
  itemId: '01a0d9fd-1e6e-7e91-b1a5-a7686bb2ae48',
  kind: 'toolCall',
  turnId: TURN,
  tool: 'powershell',
  callId: 'call_01a0d9fd293176638d1afd9d0ae77f28',
  args: '{"command":"Start-Sleep -Seconds 40; Write-Output done-m46","description":"Run delayed output command"}',
}

/** The model's foreground shell call, running. */
export const SHELL_CALL_STARTED = {
  sessionId: SESSION,
  item: { ...SHELL_ITEM, revision: 1, status: 'inProgress' },
}

/** `task/background` on it: this update arrived before the command's ack. */
export const SHELL_CALL_BACKGROUNDED = {
  sessionId: SESSION,
  item: {
    ...SHELL_ITEM,
    revision: 2,
    status: 'inProgress',
    background: true,
    backgroundInitiator: 'user',
  },
}

/** `task/stop` on it: cancelled, its result the background envelope. */
export const SHELL_CALL_STOPPED = {
  sessionId: SESSION,
  item: {
    ...SHELL_ITEM,
    revision: 3,
    status: 'cancelled',
    failureReason: 'cancelled by runtime client',
    visibleOutput:
      '{\n  "chunk_id": "exec-1-1",\n  "command": "Start-Sleep -Seconds 40; Write-Output done-m46",\n  "execution_state": "background_running",\n  "session_id": 1,\n  "work_id": "work.v1.managed_bash.sha256.c2adc75ef58ea2095e0abb7cc858d4044e86476e164cf60e45e0f9d0108b0e4f",\n  "output": "",\n  "truncated": false\n}',
    background: true,
    backgroundInitiator: 'user',
  },
}

/** The acks of the task commands: echoing the task. */
export function taskAck(params: Record<string, unknown>): Record<string, unknown> {
  return { commandId: params['commandId'], status: 'accepted', taskId: params['taskId'] }
}

/** A task command naming no running task: refused, reason `invalid_target`. */
export const INVALID_TARGET = {
  kind: 'commandRejected',
  code: -32_030,
  data: { reason: 'invalid_target', retryable: false },
}

/** `userInput/clarify` settled the colour question (the first capture). */
export const QUESTION_CLARIFIED = {
  sessionId: SESSION,
  userInputId: '01a0d9fb-1be2-7630-a631-07a25d232d7a',
  outcome: 'clarified',
  answers: [],
  clarification: { format: 'text', content: 'Neither: I prefer green, please use green.' },
  reason: null,
  decidedByCommandId: '01a0d9fb-1ff6-7000-a650-dba7f558d740',
}
