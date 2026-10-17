// M91 lane X: the cline contract's documented shapes. The property suite
// proves the invariants over every row; these tests pin Cline v1's own
// examples from test/fixtures/hookFormats/docs/cline-hooks-901d1b5c97.md
// (DOC) and the platform/timeout rules from raw-copilot-cline.md.
// Fake-only: scripts are never executed here.
import { describe, expect, it } from 'vitest'
import { buildClineStdin, parseClineResult } from '../../src/core/backends/modelapi/hookFormats'
import { CLINE_CONTEXT_MODIFICATION_MAX_CHARS } from '../../src/shared/constants'

const ROOT = '/workspace'

function payload(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: 'task-1',
    cwd: ROOT,
    tool_name: 'write_file',
    tool_input: { path: 'src/a.js', content: 'x' },
    tool_response: 'wrote it',
    prompt: 'hello',
    ...extra,
  }
}

function stdinOf(
  event:
    | 'SessionStart'
    | 'PreToolUse'
    | 'PostToolUse'
    | 'UserPromptSubmit'
    | 'Stop'
    | 'SessionEnd'
    | 'PreCompact'
    | 'Notification',
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const result = buildClineStdin(event, payload(extra), { platform: 'linux' })
  if (result.outcome !== 'run') throw new Error(`${result.outcome}: ${result.reason}`)
  return JSON.parse(result.stdin) as Record<string, unknown>
}

describe('cline stdin carries the documented shape', () => {
  it('TaskStart sends hookName, taskId and workspaceRoots (DOC:203-250)', () => {
    expect(stdinOf('SessionStart')).toEqual({
      hookName: 'TaskStart',
      taskId: 'task-1',
      workspaceRoots: [ROOT],
    })
  })

  it('PreToolUse maps tool names to Cline names (DOC:28,336,374)', () => {
    const stdin = stdinOf('PreToolUse')
    expect(stdin['preToolUse']).toEqual({
      toolName: 'write_to_file',
      parameters: { path: 'src/a.js', content: 'x' },
    })
  })

  it('a shell call maps to execute_command (DOC:374)', () => {
    const stdin = stdinOf('PreToolUse', { tool_name: 'bash', tool_input: { command: 'npm test' } })
    expect(stdin['preToolUse']).toEqual({
      toolName: 'execute_command',
      parameters: { command: 'npm test' },
    })
  })

  it('PostToolUse carries the bounded result preview (DOC:370-379)', () => {
    const stdin = stdinOf('PostToolUse')
    expect(stdin['postToolUse']).toEqual({
      toolName: 'write_to_file',
      parameters: { path: 'src/a.js', content: 'x' },
      result: 'wrote it',
    })
  })

  it('UserPromptSubmit carries the prompt (DOC:248)', () => {
    const stdin = stdinOf('UserPromptSubmit')
    expect(stdin['userPromptSubmit']).toEqual({ prompt: 'hello' })
  })
})

describe('the documented .js guard blocks (DOC:343-360)', () => {
  it('cancel with an errorMessage blocks with that message', () => {
    const answer = parseClineResult(
      'PreToolUse',
      0,
      '{"cancel":true,"errorMessage":"Use .ts files instead of .js in this TypeScript project"}',
      '',
      { platform: 'linux' },
    )
    expect(answer).toEqual({
      status: 'blocked',
      reason: 'Use .ts files instead of .js in this TypeScript project',
    })
  })

  it('a veto survives an unsupported sibling field', () => {
    const answer = parseClineResult(
      'PreToolUse',
      0,
      '{"cancel":true,"errorMessage":"no","zz_unsupported":42}',
      '',
      { platform: 'linux' },
    )
    expect(answer.status).toBe('blocked')
  })
})

describe('fail-open exits (raw-copilot-cline.md:25)', () => {
  it.each([1, 2, 3, null])('exit %s without JSON does not block', (exitCode) => {
    const answer = parseClineResult('PreToolUse', exitCode, '', 'boom', {
      platform: 'linux',
    })
    expect(answer.status).toBe('failed')
  })

  it('invalid JSON fails open, never blocks', () => {
    const answer = parseClineResult('PreToolUse', 0, '{', '', { platform: 'linux' })
    expect(answer.status).toBe('failed')
  })

  it('empty output is a pass', () => {
    const answer = parseClineResult('PreToolUse', 0, '', '', { platform: 'linux' })
    expect(answer).toEqual({ status: 'completed' })
  })
})

describe('contextModification is capped context (raw-copilot-cline.md:25)', () => {
  it('long context is cut at the documented cap', () => {
    const answer = parseClineResult(
      'UserPromptSubmit',
      0,
      JSON.stringify({ cancel: false, contextModification: `x`.repeat(60_000) }),
      '',
      { platform: 'linux' },
    )
    expect(answer.status).toBe('completed')
    expect(answer.context?.length).toBe(CLINE_CONTEXT_MODIFICATION_MAX_CHARS)
  })
})

describe('observation rows never block', () => {
  it('TaskCancel ignores cancel (the task is already cancelled)', () => {
    const answer = parseClineResult('SessionEnd', 0, '{"cancel":true,"errorMessage":"late"}', '', {
      platform: 'linux',
    })
    expect(answer).toEqual({ status: 'completed' })
  })

  it('Notification keeps context and ignores cancel', () => {
    const answer = parseClineResult(
      'Notification',
      0,
      '{"cancel":true,"contextModification":"note"}',
      '',
      { platform: 'linux' },
    )
    expect(answer).toEqual({ status: 'completed', context: 'note' })
  })
})

describe('refusals', () => {
  it('the SDK file-hook contract has no row (a different contract)', () => {
    const result = buildClineStdin('PreToolUse', payload(), {
      platform: 'linux',
      sourceEvent: 'tool_call',
    })
    expect(result.outcome).toBe('refused')
  })

  it('SessionStart without a source event builds TaskStart', () => {
    const result = buildClineStdin('SessionStart', payload(), { platform: 'linux' })
    if (result.outcome !== 'run') throw new Error(result.reason)
    const stdin = JSON.parse(result.stdin) as Record<string, unknown>
    expect(stdin['hookName']).toBe('TaskStart')
  })

  it('TaskResume is explicit: chosen only when the import names it', () => {
    const result = buildClineStdin('SessionStart', payload(), {
      platform: 'linux',
      sourceEvent: 'TaskResume',
    })
    if (result.outcome !== 'run') throw new Error(result.reason)
    const stdin = JSON.parse(result.stdin) as Record<string, unknown>
    expect(stdin['hookName']).toBe('TaskResume')
  })
})
