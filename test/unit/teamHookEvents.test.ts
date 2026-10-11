// M96 lane H: the team hook events (PLAN.md D75, acceptance 27). The wire
// contract for `TeamAgentSwitch` (once per switch, D75's payload, refusal
// only) and D75's fields on `SubagentStart`/`SubagentStop` and
// `TeammateIdle`. Lane X fires them; a hook's refusal exhausts the role and
// never picks another entry. Drills are recorded in
// docs/certification/m96-h.md.

import { describe, expect, it } from 'vitest'
import { teamAgentSwitchFields } from '../../src/core/backends/modelapi/extensionHooks'
import {
  switchHookPayload,
  teamSubagentStartFields,
  teamSubagentStopFields,
  type TeamAgentProfile,
  type TeamSubagentHookFields,
  type TeamSwitch,
} from '../../src/core/team/teamPool'

const fromAgent: TeamAgentProfile = {
  key: 'opus-anthropic',
  kind: 'engine',
  billing: 'key',
  modelId: 'anthropic/opus-5.5',
  label: 'Opus 5.5 (Anthropic key)',
}
const toAgent: TeamAgentProfile = {
  key: 'opus-openrouter',
  kind: 'engine',
  billing: 'key',
  modelId: 'openrouter/opus-5.5',
  label: 'Opus 5.5 (OpenRouter)',
}
const change: TeamSwitch = {
  roleId: 'engineering',
  fromEntryId: 'eng-1',
  toEntryId: 'eng-2',
  reason: 'cap',
  measure: 'tokens',
  window: 'day',
  amount: 2_000_000,
  used: 2_000_000,
  taskId: 'task-2',
}

const subagent: TeamSubagentHookFields = {
  subagentId: 'task-2',
  childSessionId: 'worker-session-9',
  roleId: 'engineering',
  entryId: 'eng-2',
  agentProfileId: 'opus-openrouter',
  provider: 'openrouter',
  taskId: 'task-2',
  parentSessionId: 'session-7',
  workspaceMode: 'own-branch',
  branch: 'agents/engineering/task-2',
  workingCopyPath: 'agents/engineering/task-2',
  pipelineId: undefined,
  depth: 1,
  model: 'openrouter/opus-5.5',
  modelProvider: 'openrouter',
}

const expectedSwitchWire = {
  role_id: 'engineering',
  from_entry_id: 'eng-1',
  to_entry_id: 'eng-2',
  from_agent_profile: 'opus-anthropic',
  to_agent_profile: 'opus-openrouter',
  from_model: 'anthropic/opus-5.5',
  to_model: 'openrouter/opus-5.5',
  reason: 'cap',
  measure: 'tokens',
  window: 'day',
  amount: 2_000_000,
  used: 2_000_000,
  task_id: 'task-2',
  parent_session_id: 'session-7',
} as const

describe('teamHookEvents: TeamAgentSwitch carries D75 payload', () => {
  it('switchHookPayload names both profiles and models with the cap and links', () => {
    expect(switchHookPayload(change, fromAgent, toAgent, 'session-7')).toEqual(expectedSwitchWire)
  })

  it('teamAgentSwitchFields sends the wire names and drops an absent cap', () => {
    expect(
      teamAgentSwitchFields(switchHookPayload(change, fromAgent, toAgent, 'session-7')),
    ).toEqual(expectedSwitchWire)
    const reset: TeamSwitch = {
      roleId: 'research',
      fromEntryId: 'res-2',
      toEntryId: 'res-1',
      reason: 'reset',
      taskId: 'task-11',
    }
    expect(teamAgentSwitchFields(switchHookPayload(reset, toAgent, fromAgent, undefined))).toEqual({
      role_id: 'research',
      from_entry_id: 'res-2',
      to_entry_id: 'res-1',
      from_agent_profile: 'opus-openrouter',
      to_agent_profile: 'opus-anthropic',
      from_model: 'openrouter/opus-5.5',
      to_model: 'anthropic/opus-5.5',
      reason: 'reset',
      task_id: 'task-11',
    })
  })
})

describe('teamHookEvents: SubagentStart and SubagentStop carry D75 fields', () => {
  const expected = {
    subagent_id: 'task-2',
    child_session_id: 'worker-session-9',
    agent_id: 'task-2',
    agent_type: 'engineering',
    role_id: 'engineering',
    entry_id: 'eng-2',
    agent_profile_id: 'opus-openrouter',
    provider: 'openrouter',
    task_id: 'task-2',
    parent_session_id: 'session-7',
    workspace_mode: 'own-branch',
    branch: 'agents/engineering/task-2',
    working_copy_path: 'agents/engineering/task-2',
    depth: 1,
    model: 'openrouter/opus-5.5',
    model_provider: 'openrouter',
  }
  it('SubagentStart keeps M51 ids and adds the team links', () => {
    expect(teamSubagentStartFields(subagent)).toEqual(expected)
  })
  it('SubagentStop carries the same D75 fields', () => {
    expect(teamSubagentStopFields(subagent)).toEqual(expected)
  })
  it('sends working_copy_path with slashes when the lane passes a Windows path', () => {
    const windows: TeamSubagentHookFields = {
      ...subagent,
      workingCopyPath: String.raw`agents\engineering\task-2`,
    }
    expect(teamSubagentStartFields(windows)).toMatchObject({
      working_copy_path: 'agents/engineering/task-2',
    })
    expect(teamSubagentStopFields(windows)).toMatchObject({
      working_copy_path: 'agents/engineering/task-2',
    })
  })
  it('omits only the fields the task has none of', () => {
    const minimal: TeamSubagentHookFields = {
      ...subagent,
      provider: undefined,
      branch: undefined,
      workingCopyPath: undefined,
    }
    const fields = teamSubagentStartFields(minimal)
    expect(fields).not.toHaveProperty('provider')
    expect(fields).not.toHaveProperty('branch')
    expect(fields).not.toHaveProperty('working_copy_path')
    expect(fields).not.toHaveProperty('pipeline_id')
    expect(fields).toMatchObject({
      agent_id: 'task-2',
      agent_type: 'engineering',
      role_id: 'engineering',
      depth: 1,
    })
  })
})
