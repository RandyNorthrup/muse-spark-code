// M96b contracts (C-M96b-0, PLAN.md D75): the frozen ACP team mapping.
import type { PermissionOption } from '@agentclientprotocol/sdk'
import { describe, expect, it } from 'vitest'
import {
  TEAM_PLAN_PRIORITY,
  TEAM_TASK_TOOL_KIND,
  TEAM_TOOL_CALL_PREFIX,
  formatTeamPermissionTitle,
  isTeamToolCallId,
  normalizeTeamPath,
  parseTeamPermissionTitle,
  teamDiff,
  teamDiffSchema,
  teamExecAdmission,
  teamMergeCompletedCall,
  teamMergeRequest,
  teamMergeRequestSchema,
  teamMergeToolCallId,
  teamPlanEntries,
  teamPlanEntrySchema,
  teamReportContent,
  teamTaskDiffUpdate,
  teamTaskReportUpdate,
  teamTaskToolCall,
  teamTaskToolCallId,
  teamTaskUpdateSchema,
  teamToolContentSchema,
} from '../../src/acp/teamContracts'
import { UI_TEXT } from '../../src/shared/constants'

const DIFF = teamDiff({ path: '/repo/a.ts', oldText: 'a', newText: 'b' })
const OPTIONS: PermissionOption[] = [{ optionId: 'yes', name: 'Yes', kind: 'allow_once' }]

describe('M96b team tool call ids', () => {
  it('namespaces tasks and merges under team/', () => {
    expect(teamTaskToolCallId('t1')).toBe('team/task/t1')
    expect(teamMergeToolCallId('m1')).toBe('team/merge/m1')
    expect(isTeamToolCallId('team/task/t1')).toBe(true)
    expect(isTeamToolCallId('team/merge/m1')).toBe(true)
    expect(isTeamToolCallId('other/t1')).toBe(false)
    expect(TEAM_TOOL_CALL_PREFIX).toBe('team/')
  })
  it('refuses ids that would fake a hierarchy', () => {
    for (const bad of ['', 'a/b']) {
      expect(() => teamTaskToolCallId(bad)).toThrow()
      expect(() => teamMergeToolCallId(bad)).toThrow()
    }
  })
})

describe('M96b permission titles', () => {
  it('starts with the role and the agent', () => {
    const title = formatTeamPermissionTitle({
      role: 'researcher',
      agent: 'zed',
      detail: 'Read src',
    })
    expect(title).toBe('researcher · zed: Read src')
    expect(parseTeamPermissionTitle(title)).toEqual({
      role: 'researcher',
      agent: 'zed',
      detail: 'Read src',
    })
  })
  it('round-trips a detail holding colons', () => {
    const title = formatTeamPermissionTitle({ role: 'r', agent: 'a', detail: 'a: b: c' })
    expect(parseTeamPermissionTitle(title)?.detail).toBe('a: b: c')
  })
  it('rejects what it did not build', () => {
    expect(parseTeamPermissionTitle('hello')).toBe(undefined)
    expect(parseTeamPermissionTitle('researcher · zed')).toBe(undefined)
    expect(parseTeamPermissionTitle('a · b · c: d')).toBe(undefined)
    expect(() => formatTeamPermissionTitle({ role: '', agent: 'a', detail: 'd' })).toThrow()
    expect(() => formatTeamPermissionTitle({ role: 'a · b', agent: 'a', detail: 'd' })).toThrow()
    expect(() => formatTeamPermissionTitle({ role: 'a', agent: 'a', detail: '' })).toThrow()
  })
})

describe('M96b task tool calls', () => {
  it('announces a running task without content', () => {
    const call = teamTaskToolCall({ taskId: 't1', role: 'coder', agent: 'zed', detail: 'Write x' })
    expect(call).toMatchObject({
      toolCallId: 'team/task/t1',
      title: 'coder · zed: Write x',
      kind: TEAM_TASK_TOOL_KIND,
      status: 'in_progress',
    })
    expect(teamTaskUpdateSchema.safeParse(call).success).toBe(true)
  })
  it('carries the report as text content on completion', () => {
    const update = teamTaskReportUpdate({ taskId: 't1', report: 'done' })
    expect(update).toMatchObject({ toolCallId: 'team/task/t1', status: 'completed' })
    expect(teamToolContentSchema.safeParse(teamReportContent('done')).success).toBe(true)
    expect(teamTaskUpdateSchema.safeParse(update).success).toBe(true)
  })
  it('carries diffs as diff content while running', () => {
    const update = teamTaskDiffUpdate({ taskId: 't1', diffs: [DIFF] })
    expect(update).toMatchObject({ toolCallId: 'team/task/t1', status: 'in_progress' })
    expect(teamTaskUpdateSchema.safeParse(update).success).toBe(true)
    expect(() => teamTaskDiffUpdate({ taskId: 't1', diffs: [] })).toThrow()
  })
  it('normalises Windows separators before comparing paths', () => {
    expect(normalizeTeamPath(String.raw`C:\repo\a.ts`)).toBe('C:/repo/a.ts')
    expect(normalizeTeamPath('/repo/a.ts')).toBe('/repo/a.ts')
    expect(teamDiff({ path: String.raw`C:\repo\a.ts`, oldText: null, newText: 'b' })).toMatchObject(
      {
        type: 'diff',
        path: 'C:/repo/a.ts',
        oldText: null,
      },
    )
    expect(() => teamDiff({ path: '', oldText: null, newText: 'b' })).toThrow()
  })
  it('validates the frozen diff shape and rejects the rest', () => {
    expect(
      teamDiffSchema.safeParse({ type: 'diff', path: '/a', oldText: null, newText: 'b' }).success,
    ).toBe(true)
    expect(teamDiffSchema.safeParse({ type: 'diff', path: '/a', newText: 'b' }).success).toBe(true)
    expect(teamDiffSchema.safeParse({ type: 'diff', path: '/a' }).success).toBe(false)
    expect(teamDiffSchema.safeParse({ type: 'content', content: 'x' }).success).toBe(false)
  })
})

describe('M96b agent-map plan', () => {
  it('sends one entry per running task, traced by its id', () => {
    const entries = teamPlanEntries([
      { taskId: 't1', title: 'First' },
      { taskId: 't2', title: 'Second' },
    ])
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      content: 'First',
      priority: TEAM_PLAN_PRIORITY,
      status: 'in_progress',
    })
    expect(entries.map((entry) => entry._meta)).toEqual([{ teamTask: 't1' }, { teamTask: 't2' }])
    for (const entry of entries) expect(teamPlanEntrySchema.safeParse(entry).success).toBe(true)
    expect(teamPlanEntries([])).toEqual([])
    expect(teamPlanEntrySchema.safeParse({ content: '', priority: 'medium' }).success).toBe(false)
  })
})

describe('M96b merge permission request', () => {
  const input = {
    sessionId: 's1',
    mergeId: 'm1',
    role: 'merger',
    agent: 'zed',
    detail: 'Land t1',
    diffs: [DIFF],
    options: OPTIONS,
  }
  it('freezes the request shape the editor is asked', () => {
    expect(teamMergeRequest(input)).toEqual({
      sessionId: 's1',
      toolCall: {
        toolCallId: 'team/merge/m1',
        title: 'merger · zed: Land t1',
        kind: TEAM_TASK_TOOL_KIND,
        status: 'pending',
        content: [DIFF],
      },
      options: OPTIONS,
    })
    expect(teamMergeRequestSchema.safeParse(teamMergeRequest(input)).success).toBe(true)
  })
  it('refuses a merge with no diff, no options or no session', () => {
    expect(() => teamMergeRequest({ ...input, diffs: [] })).toThrow()
    expect(() => teamMergeRequest({ ...input, options: [] })).toThrow()
    expect(() => teamMergeRequest({ ...input, sessionId: '' })).toThrow()
    expect(
      teamMergeRequestSchema.safeParse({ sessionId: 's', toolCall: {}, options: [] }).success,
    ).toBe(false)
  })
  it('shows the merge as one completed call where asking is off', () => {
    const call = teamMergeCompletedCall({ ...input })
    expect(call).toMatchObject({
      toolCallId: 'team/merge/m1',
      title: 'merger · zed: Land t1',
      status: 'completed',
    })
    expect(teamTaskUpdateSchema.safeParse(call).success).toBe(true)
  })
})

describe('M96b exec --team admission', () => {
  it('needs the Model API backend, acceptEdits and the runner lane', () => {
    expect(teamExecAdmission({ mode: 'acceptEdits', backend: 'museCode' })).toEqual({
      ok: false,
      reason: UI_TEXT.execModelApiOnly,
    })
    expect(teamExecAdmission({ mode: 'plan', backend: 'modelApi' })).toEqual({
      ok: false,
      reason: UI_TEXT.execTeamNeedsEdits,
    })
    expect(teamExecAdmission({ mode: 'acceptEdits', backend: 'modelApi' })).toEqual({
      ok: false,
      reason: UI_TEXT.execTeamNotReady,
    })
  })
})
