// M96 lane 0: the team schemas, protocol region and translated recovery
// strings. Every test here can fail: each guards a value or shape another
// lane builds on, with its red drill recorded in docs/certification/m96-0.md.

import { Usd } from '../../src/shared/usd'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { TEAM_BRIEF_MAX_CHARS, TEAM_INTENSITY_LEVELS } from '../../src/shared/constants'
import { tableProblems } from '../../src/shared/l10n/check'
import { EN } from '../../src/shared/l10n/en'
import { TABLE_LOCALES, tableFileName } from '../../src/shared/l10n/locales'
import {
  installTeamProtocolSchemas,
  parseHostToWebviewMessage,
  parseWebviewToHostMessage,
} from '../../src/shared/protocol'
import {
  teamAgentKinds,
  teamAgentKindSchema,
  teamAgentPays,
  teamAgentPaysSchema,
  teamAgentRefSchema,
  teamAgentSwitchSchema,
  teamAgentsUpdateSchema,
  teamBuiltInRoleSchema,
  teamCapMeasureSchema,
  teamCapMeasures,
  teamCapSchema,
  teamCapWindowSchema,
  teamCapWindows,
  teamIntensityLevels,
  teamIntensitySchema,
  teamLedgerOutcomeSchema,
  teamLedgerOutcomes,
  teamLedgerResetRowSchema,
  teamLedgerTaskRowSchema,
  teamLedgerTotalsRowSchema,
  teamModelSettingsSchema,
  teamPoolEntrySchema,
  teamReportSchema,
  teamReportShapeSchema,
  teamReportShapes,
  teamReportStatusSchema,
  teamReportStatuses,
  teamRoleConfigSchema,
  teamRolesSaveSchema,
  teamRolesUpdateSchema,
  teamRubricReasonSchema,
  teamSnapshotSchema,
  teamSwitchReasonSchema,
  teamSwitchReasons,
  teamTaskSchema,
  teamTaskStateSchema,
  teamTaskStates,
  teamToolGroupSchema,
  teamTreeActionSchema,
  teamTreeActions,
  teamTreeEntrySchema,
  teamTreeRoleSchema,
  teamTreeSchema,
  teamTreeUpdateSchema,
  teamTreeWorkerSchema,
  teamWorkspaceModeSchema,
  teamWorkspaceModes,
  type TeamAgentKind,
  type TeamAgentPays,
  type TeamAgentRef,
  type TeamAgentSwitch,
  type TeamAgentsUpdate,
  type TeamBuiltInRole,
  type TeamCap,
  type TeamCapMeasure,
  type TeamCapWindow,
  type TeamIntensity,
  type TeamLedgerOutcome,
  type TeamLedgerResetRow,
  type TeamLedgerTaskRow,
  type TeamLedgerTotalsRow,
  type TeamModelSettings,
  type TeamPoolEntry,
  type TeamReport,
  type TeamReportShape,
  type TeamReportStatus,
  type TeamRoleConfig,
  type TeamRolesSave,
  type TeamRolesUpdate,
  type TeamRubricReason as TeamReason,
  type TeamSnapshot,
  type TeamSwitchReason,
  type TeamTask,
  type TeamTaskState,
  type TeamTree,
  type TeamTreeAction,
  type TeamTreeEntry,
  type TeamTreeRole,
  type TeamTreeUpdate,
  type TeamTreeWorker,
  type TeamUsage,
  type TeamWorkspaceMode,
  teamUsageSchema,
} from '../../src/shared/team'

function refuses(
  schema: { safeParse: (input: unknown) => { success: boolean } },
  input: unknown,
): void {
  expect(schema.safeParse(input).success).toBe(false)
}

describe('team schemas', () => {
  it('names the agent kinds, pay kinds, measures and windows', () => {
    const kinds: readonly TeamAgentKind[] = teamAgentKinds
    expect(kinds).toEqual(['engine', 'museCode', 'external'])
    const pays: readonly TeamAgentPays[] = teamAgentPays
    expect(pays).toEqual(['key', 'subscription', 'local'])
    const measures: readonly TeamCapMeasure[] = teamCapMeasures
    expect(measures).toEqual(['tokens', 'inputTokens', 'outputTokens', 'spendUsd', 'tasks'])
    const windows: readonly TeamCapWindow[] = teamCapWindows
    expect(windows).toEqual(['task', 'day', 'lifetime'])
    expect(teamAgentKindSchema.safeParse('engine').success).toBe(true)
    expect(teamAgentPaysSchema.safeParse('local').success).toBe(true)
    refuses(teamAgentKindSchema, 'sidekick')
    refuses(teamCapMeasureSchema, 'dollars')
    refuses(teamCapWindowSchema, 'forever')
  })

  it('parses caps and refuses unknown measures, windows and negative amounts', () => {
    const cap: TeamCap = { measure: 'spendUsd', window: 'lifetime', amount: 20 }
    expect(teamCapSchema.safeParse(cap).success).toBe(true)
    refuses(teamCapSchema, { measure: 'tokens', window: 'day', amount: -1 })
    refuses(teamCapSchema, { measure: 'tokens', amount: 1 })
  })

  it('takes Default as an entry without an agent', () => {
    const entry: TeamPoolEntry = { id: 'default', concurrent: 4, caps: [] }
    expect(teamPoolEntrySchema.safeParse(entry).success).toBe(true)
    const agent: TeamAgentRef = {
      kind: 'museCode',
      agentId: 'muse-subscription',
      model: 'muse-spark-1.3',
      pays: 'subscription',
    }
    const staffed: TeamPoolEntry = {
      id: 'entry-1',
      agent,
      concurrent: 2,
      caps: [{ measure: 'tokens', window: 'day', amount: 2_000_000 }],
    }
    const parsed = teamPoolEntrySchema.safeParse(staffed)
    expect(parsed.success).toBe(true)
    refuses(teamPoolEntrySchema, { id: '', concurrent: 1, caps: [] })
    refuses(teamPoolEntrySchema, { id: 'entry-1', concurrent: 0, caps: [] })
    refuses(teamAgentRefSchema, { ...agent, kind: 'sidekick' })
  })

  it('round-trips pool-entry model settings and refuses malformed settings', () => {
    const entry = {
      id: 'default',
      concurrent: 1,
      caps: [],
      settings: { outputCap: 100, effort: 'high', parallelToolCalls: false },
    }
    expect(teamPoolEntrySchema.parse(entry)).toEqual(entry)
    const snapshot = { roles: [{ role: 'engineering', pool: [entry] }], intensity: 'balanced' }
    const savedSnapshot = JSON.stringify(snapshot)
    expect(teamSnapshotSchema.parse(JSON.parse(savedSnapshot))).toEqual(snapshot)
    refuses(teamPoolEntrySchema, { ...entry, settings: { outputCap: 0 } })
    refuses(teamPoolEntrySchema, { ...entry, settings: 'high' })
  })

  it('parses a role with an empty pool and refuses widening keys', () => {
    const role: TeamRoleConfig = { role: 'engineering', pool: [] }
    expect(teamRoleConfigSchema.safeParse(role).success).toBe(true)
    const full: TeamRoleConfig = {
      role: 'research',
      workspace: 'read-only',
      tools: ['read', 'codeIntel', 'report'],
      exhausted: 'queue',
      continueOnNext: false,
      tasksPerTurn: 6,
      minutesPerTask: 30,
      pool: [{ id: 'default', concurrent: 1, caps: [] }],
    }
    expect(teamRoleConfigSchema.safeParse(full).success).toBe(true)
    refuses(teamRoleConfigSchema, { role: '', pool: [] })
    refuses(teamRoleConfigSchema, { role: 'research', exhausted: 'wait', pool: [] })
    refuses(teamRoleConfigSchema, { role: 'research', tools: ['merge'], pool: [] })
    expect(teamToolGroupSchema.safeParse('report').success).toBe(true)
    refuses(teamToolGroupSchema, 'merge')
  })

  it('fixes model settings per entry and the intensity levels', () => {
    const settings: TeamModelSettings = { effort: 'high', thinking: true, outputCap: 4096 }
    expect(teamModelSettingsSchema.safeParse(settings).success).toBe(true)
    expect(teamModelSettingsSchema.safeParse({}).success).toBe(true)
    refuses(teamModelSettingsSchema, { thinkingBudget: 0 })
    const intensity: TeamIntensity = 'balanced'
    expect(teamIntensitySchema.safeParse(intensity).success).toBe(true)
    refuses(teamIntensitySchema, 'ultra')
    expect(teamIntensityLevels).toEqual(Object.keys(TEAM_INTENSITY_LEVELS))
  })

  it('requires a rubric code on every task and report', () => {
    const reason: TeamReason = 'parallel'
    expect(teamRubricReasonSchema.safeParse(reason).success).toBe(true)
    const shape: TeamReportShape = 'summary'
    const status: TeamReportStatus = 'done'
    const task: TeamTask = {
      id: 'task-1',
      role: 'engineering',
      entryId: 'entry-1',
      brief: 'Build the widget.',
      reason,
      state: 'queued',
      branch: 'agents/engineering/task-1',
    }
    expect(teamTaskSchema.safeParse(task).success).toBe(true)
    refuses(teamTaskSchema, { ...task, reason: 'vibes' })
    const report: TeamReport = { status, summary: 'Built it.' }
    expect(teamReportSchema.safeParse(report).success).toBe(true)
    expect(teamReportShapeSchema.safeParse(shape).success).toBe(true)
    refuses(teamReportSchema, { status: 'done', summary: '' })
    refuses(teamReportStatusSchema, 'mailed')
    expect(teamReportStatuses).toContain('unstructured')
  })

  it('records a switch with the cap it moved on', () => {
    const states: readonly TeamTaskState[] = teamTaskStates
    expect(states).toContain('waitingForYou')
    const outcomes: readonly TeamLedgerOutcome[] = teamLedgerOutcomes
    expect(outcomes).toContain('capped')
    refuses(teamTaskStateSchema, 'mailed')
    refuses(teamLedgerOutcomeSchema, 'queued')
    const reasons: readonly TeamSwitchReason[] = teamSwitchReasons
    expect(reasons).toEqual([
      'cap',
      'concurrency',
      'rateLimited',
      'usageLimit',
      'unavailable',
      'reset',
    ])
    const switched: TeamAgentSwitch = {
      roleId: 'research',
      fromEntryId: 'entry-1',
      toEntryId: 'entry-2',
      reason: 'cap',
      measure: 'tokens',
      window: 'day',
      amount: 2_000_000,
      used: 2_000_000,
      taskId: 'task-2',
    }
    expect(teamAgentSwitchSchema.safeParse(switched).success).toBe(true)
    refuses(teamSwitchReasonSchema, 'cheaper')
  })

  it('round-trips task ledger identity and keeps only the bounded brief', () => {
    const usage: TeamUsage = {
      input: 1000,
      cachedInput: 200,
      output: 500,
      reasoning: 0,
      modelCalls: 3,
      costUsd: Usd.from('0.02').toAmount(),
      estimated: false,
    }
    expect(teamUsageSchema.safeParse(usage).success).toBe(true)
    const row: TeamLedgerTaskRow = {
      kind: 'task',
      taskId: 'task-1',
      role: 'engineering',
      entryId: 'entry-1',
      model: 'muse-spark-1.3',
      workspaceMode: 'own-branch',
      branch: 'agents/engineering/task-1',
      brief: 'Build the widget.',
      reasonCode: 'parallel',
      startMs: 1_700_000_000_000,
      usage,
    }
    const savedRow = JSON.stringify(row)
    expect(teamLedgerTaskRowSchema.parse(JSON.parse(savedRow))).toEqual(row)
    const readOnly = {
      ...row,
      taskId: 'review-task',
      workspaceMode: 'read-only',
      branch: undefined,
    }
    expect(teamLedgerTaskRowSchema.parse(readOnly).taskId).toBe('review-task')
    expect(teamLedgerTaskRowSchema.parse({ ...readOnly, outcome: 'done' }).outcome).toBe('done')
    refuses(teamLedgerTaskRowSchema, { ...row, taskId: '' })
    refuses(teamLedgerTaskRowSchema, { ...row, taskId: undefined })
    refuses(teamLedgerTaskRowSchema, { ...row, taskId: 1 })
    refuses(teamLedgerTaskRowSchema, { ...row, brief: 'x'.repeat(TEAM_BRIEF_MAX_CHARS + 1) })
    refuses(teamLedgerTaskRowSchema, { ...row, outcome: 'mailed' })
    const totals: TeamLedgerTotalsRow = {
      kind: 'totals',
      entryId: 'entry-1',
      window: 'lifetime',
      usage,
      updatedMs: 1_700_000_000_001,
    }
    expect(teamLedgerTotalsRowSchema.safeParse(totals).success).toBe(true)
    const reset: TeamLedgerResetRow = { kind: 'reset', window: 'day', clearedAtMs: 1 }
    expect(teamLedgerResetRowSchema.safeParse(reset).success).toBe(true)
  })

  it('shows the tree with the orchestrator at the root', () => {
    const worker: TeamTreeWorker = {
      taskId: 'task-1',
      role: 'engineering',
      entryId: 'entry-1',
      brief: 'Build the widget.',
      state: 'running',
    }
    const entry: TeamTreeEntry = {
      entryId: 'entry-1',
      running: 1,
      concurrent: 4,
      state: 'ready',
      workers: [worker],
    }
    const mode: TeamWorkspaceMode = 'own-branch'
    const role: TeamTreeRole = { role: 'engineering', mode, tools: ['read'], entries: [entry] }
    expect(teamTreeRoleSchema.safeParse({ ...role, entries: [{ entryId: '' }] }).success).toBe(
      false,
    )
    const tree: TeamTree = {
      orchestrator: { model: 'muse-spark-1.3', backend: 'museCode', isDefault: true },
      roles: [role],
      queued: [],
      unmerged: [],
      interrupted: [],
    }
    expect(teamTreeSchema.safeParse(tree).success).toBe(true)
    expect(teamTreeWorkerSchema.safeParse({ ...worker, state: 'mailed' }).success).toBe(false)
    expect(teamTreeEntrySchema.safeParse({ ...entry, concurrent: 0 }).success).toBe(false)
    refuses(teamWorkspaceModeSchema, 'shared')
    expect(teamWorkspaceModes).toEqual(['read-only', 'own-branch', 'in-place'])
    expect(teamReportShapes).toEqual(['summary', 'review', 'qa'])
    expect(teamReportShapeSchema.safeParse('qa').success).toBe(true)
  })

  it('RVM96RB2 R10: round-trips the orchestrator agent identity and model settings', () => {
    const orchestrator = {
      agent: {
        kind: 'engine',
        agentId: 'meta-model-api',
        model: 'muse-spark-1.3',
        provider: 'meta',
        pays: 'key',
      },
      settings: { effort: 'xhigh', outputCap: 100, parallelToolCalls: false },
    }
    const snapshot = {
      roles: [],
      intensity: 'balanced',
      orchestratorModel: orchestrator.agent.model,
      orchestrator,
    }
    const save = { type: 'teamRolesSave', requestId: 'orchestrator-settings', snapshot }
    refuses(teamRolesSaveSchema, {
      ...save,
      snapshot: { ...snapshot, orchestratorModel: 'different-model' },
    })
    expect(teamRolesSaveSchema.safeParse(save)).toMatchObject({ success: true, data: save })
    expect(teamRolesUpdateSchema.safeParse({ type: 'teamRolesUpdate', snapshot })).toMatchObject({
      success: true,
      data: { snapshot },
    })
    refuses(teamRolesSaveSchema, {
      ...save,
      snapshot: { ...snapshot, orchestrator: { ...orchestrator, settings: { outputCap: 0 } } },
    })
    refuses(teamRolesSaveSchema, {
      ...save,
      snapshot: {
        ...snapshot,
        orchestrator: { ...orchestrator, agent: { ...orchestrator.agent, model: '' } },
      },
    })
  })

  it('carries the workspace team and the panel messages', () => {
    const snapshot: TeamSnapshot = {
      roles: [{ role: 'engineering', pool: [] }],
      intensity: 'balanced',
    }
    expect(teamSnapshotSchema.safeParse(snapshot).success).toBe(true)
    const update: TeamRolesUpdate = { type: 'teamRolesUpdate', snapshot }
    expect(teamRolesUpdateSchema.safeParse(update).success).toBe(true)
    const save: TeamRolesSave = { type: 'teamRolesSave', requestId: 'req-1', snapshot }
    expect(teamRolesSaveSchema.safeParse(save).success).toBe(true)
    refuses(teamRolesSaveSchema, { type: 'teamRolesSave', requestId: '', snapshot })
    const agents: TeamAgentsUpdate = {
      type: 'teamAgentsUpdate',
      tree: {
        orchestrator: { model: 'm', backend: 'b', isDefault: true },
        roles: [],
        queued: [],
        unmerged: [],
        interrupted: [],
      },
    }
    expect(teamAgentsUpdateSchema.safeParse(agents).success).toBe(true)
    const builtIn: TeamBuiltInRole = 'qa'
    expect(teamBuiltInRoleSchema.safeParse(builtIn).success).toBe(true)
    refuses(teamBuiltInRoleSchema, 'sales')
  })

  it('sends one tree action per click, never worker text', () => {
    expect(teamTreeActions).toContain('merge')
    expect(teamTreeActions).not.toContain('delegate')
    const action: TeamTreeAction = { type: 'teamTreeAction', action: 'stop', taskId: 'task-1' }
    expect(teamTreeActionSchema.safeParse(action).success).toBe(true)
    refuses(teamTreeActionSchema, { type: 'teamTreeAction', action: 'launch' })
    refuses(teamTreeActionSchema, { type: 'teamTreeAction', action: 'stop', taskId: 7 })
  })
})

describe('team protocol region', () => {
  beforeAll(() => {
    installTeamProtocolSchemas({ action: teamTreeActionSchema, update: teamTreeUpdateSchema })
  })
  it('takes the tree action from the panel', () => {
    const parsed = parseWebviewToHostMessage({
      type: 'teamTreeAction',
      action: 'merge',
      taskId: 't',
    })
    expect(parsed.ok).toBe(true)
    expect(parseWebviewToHostMessage({ type: 'teamTreeAction', action: 'launch' }).ok).toBe(false)
  })

  it('pushes the tree to the panel', () => {
    const update: TeamTreeUpdate = {
      type: 'teamTree',
      tree: {
        orchestrator: { model: 'm', backend: 'b', slot: 'override' },
        roles: [],
      },
    }
    expect(teamTreeUpdateSchema.safeParse(update).success).toBe(true)
    expect(parseHostToWebviewMessage(update).ok).toBe(true)
    expect(parseHostToWebviewMessage({ type: 'teamTree', tree: { roles: [] } }).ok).toBe(false)
  })
})

describe('team recovery and landing strings (lane M96-0b)', () => {
  const recoveryKeys = [
    'teamRestartTeamHost',
    'teamRestartTeamHostDetail',
    'teamContinueAnyway',
    'teamContinueAnywayWarning',
    'teamReleaseAnyway',
    'teamReleaseAnywayWarning',
    'teamTakeOver',
    'teamTakeOverWarning',
    'teamContinueHereAsNewTask',
    'teamContinueHereAsNewTaskDetail',
    'teamIncludeUncommittedEdits',
    'teamIncludeUncommittedEditsDetail',
    'teamLandingApply',
    'teamChangedDuringLanding',
    'teamCheckModelsOnOpen',
    'teamCheckModelsOnOpenDetail',
    'teamDuplicateJournal',
  ] as const

  it('carries every recovery and landing string in all 14 tables with its slots', () => {
    for (const locale of TABLE_LOCALES) {
      const file = new URL(`../../l10n/${tableFileName(locale)}`, import.meta.url)
      const table = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      for (const key of recoveryKeys) {
        const english: Record<string, unknown> = { [key]: EN[key] }
        expect(tableProblems(english, { [key]: table[key] }, { locale, isStrict: true })).toEqual(
          [],
        )
      }
    }
  })
})

it('refuses Meta output caps below sixteen in team pool and orchestrator settings', () => {
  const agent = {
    kind: 'engine',
    agentId: 'meta-model-api',
    model: 'muse-spark-1.3',
    provider: 'meta',
    pays: 'key',
  }
  for (const cap of [0, 1, 15]) {
    const entry = { id: 'meta', agent, concurrent: 1, caps: [], settings: { outputCap: cap } }
    for (const parsed of [
      teamPoolEntrySchema.safeParse(entry),
      teamSnapshotSchema.safeParse({
        roles: [],
        intensity: 'balanced',
        orchestrator: { agent, settings: { outputCap: cap } },
      }),
    ]) {
      expect(parsed.success).toBe(false)
      if (!parsed.success)
        expect(parsed.error.message).toContain('Output cap must be at least 16 tokens.')
    }
  }
  expect(
    teamPoolEntrySchema.safeParse({
      id: 'meta',
      agent,
      concurrent: 1,
      caps: [],
      settings: { outputCap: 16 },
    }).success,
  ).toBe(true)
  expect(
    teamPoolEntrySchema.safeParse({
      id: 'other',
      agent: { ...agent, provider: 'custom', model: 'native' },
      concurrent: 1,
      caps: [],
      settings: { outputCap: 1 },
    }).success,
  ).toBe(true)
})

it('validates inherited Meta output caps for default team entries and orchestrator settings', () => {
  for (const snapshot of [
    {
      roles: [],
      intensity: 'balanced',
      orchestratorModel: 'muse-spark-1.3',
      orchestrator: { settings: { outputCap: 15 } },
    },
    {
      roles: [
        {
          role: 'engineering',
          pool: [{ id: 'default', concurrent: 1, caps: [], settings: { outputCap: 15 } }],
        },
      ],
      intensity: 'balanced',
      orchestratorModel: 'meta/muse-spark-1.3',
    },
  ]) {
    const parsed = teamSnapshotSchema.safeParse(snapshot)
    expect(parsed.success).toBe(false)
    if (!parsed.success)
      expect(parsed.error.message).toContain('Output cap must be at least 16 tokens.')
  }
})
