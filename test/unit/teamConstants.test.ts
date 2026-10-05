// M96 lane 0: the team constants, charter templates, schemas and protocol
// region. Every test here can fail: each guards a value or shape another
// lane builds on, with its red drill recorded in docs/certification/m96-0.md.

import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  TEAM_BRANCH_PREFIX,
  TEAM_BRIEF_FILES_MAX_BYTES,
  TEAM_BRIEF_MAX_CHARS,
  TEAM_COLLECT_PAGE_CHARS,
  TEAM_CONTINUE_ON_NEXT_DEFAULT,
  TEAM_DAILY_BUDGET_TOKENS,
  TEAM_DAILY_BUDGET_USD,
  TEAM_DELEGATE_MAX,
  TEAM_ENGINE_HARD_CEILING,
  TEAM_EXHAUSTED_DEFAULT,
  TEAM_EXHAUSTED_POLICIES,
  TEAM_EXTERNAL_AGENT_CEILING,
  TEAM_EXTERNAL_AGENT_DEFAULT,
  TEAM_HINT_FRESH_MS,
  TEAM_HINT_WRITE_MS,
  TEAM_INTENSITY_DEFAULT,
  TEAM_INTENSITY_LEVELS,
  TEAM_KILL_GRACE_MS,
  TEAM_LANDING_LOCK_WAIT_MS,
  TEAM_LEASE_IDLE_MS,
  TEAM_LEASE_WAIT_MS,
  TEAM_LEDGER_FLUSH_MS,
  TEAM_LOAD_CPU_HIGH,
  TEAM_LOAD_FREE_MEMORY_MIN,
  TEAM_LOAD_SAMPLE_MS,
  TEAM_LOAD_WINDOW_MS,
  TEAM_MAX_CONCURRENT_COMMANDS,
  TEAM_MAX_DEPTH,
  TEAM_MAX_PROCESS_WORKERS,
  TEAM_META_CONTRIBUTOR_RPM,
  TEAM_META_CONTRIBUTOR_TPM,
  TEAM_META_STANDARD_RPM,
  TEAM_META_STANDARD_TPM,
  TEAM_MIN_REQUEST_TOKENS,
  TEAM_MODEL_TEXT,
  TEAM_MUSE_CODE_HOST_CEILING,
  TEAM_ORCHESTRATOR_HEADROOM,
  TEAM_PROCESS_WORKERS_CPU_HEADROOM,
  TEAM_PROCESS_WORKERS_MEM_PER_WORKER_BYTES,
  TEAM_PROCESS_WORKERS_MEM_RESERVE_BYTES,
  TEAM_PROMPT_CACHE_KEY_PREFIX,
  TEAM_QUEUE_MAX,
  TEAM_QUEUE_MAX_WAIT_MS,
  TEAM_READ_ONLY_COMMANDS,
  TEAM_READ_ONLY_REFUSED_OPTIONS,
  TEAM_REPORT_FENCE,
  TEAM_ROLE_BASE_EFFORT,
  TEAM_ROLE_IDS,
  TEAM_ROLE_MIN_CONTEXT_TOKENS,
  TEAM_ROLE_RECOMMENDED_CONTEXT_TOKENS,
  TEAM_ROLE_REPORT_SHAPES,
  TEAM_ROLE_TEXT_MAX_CHARS,
  TEAM_ROLE_TOOLSETS,
  TEAM_ROLE_TYPICAL_TASK_TOKENS,
  TEAM_ROLE_WRITE_PATHS,
  TEAM_RUBRIC_REASON_CODES,
  TEAM_TASK_MAX_REQUESTS_DEFAULT,
  TEAM_TASK_MAX_REQUESTS_WRITER,
  TEAM_TASK_MAX_REQUESTS_WRITER_ROLES,
  TEAM_TASK_MINUTES_DEFAULT,
  TEAM_TASKS_PER_TURN_DEFAULT,
  TEAM_THROTTLE_HEADROOM_LOW,
  TEAM_THROTTLE_RECOVER_MS,
  TEAM_TOOL_GROUPS,
  TEAM_UNMERGED_NOTICE_DAYS,
  TEAM_USAGE_LIMIT_COOLDOWN_MS,
  TEAM_WORKER_RPM_ESTIMATE,
  TEAM_WORKER_TPM_ESTIMATE,
  type TeamExhaustedPolicy,
  type TeamIntensityLevel,
  type TeamRoleId,
  type TeamRubricReason,
  type TeamToolGroup,
} from '../../src/shared/constants'
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

describe('team caps, intensity and machine values', () => {
  it('starts autofill from D75 typical tokens per role', () => {
    expect(TEAM_ROLE_TYPICAL_TASK_TOKENS).toEqual({
      research: 150_000,
      design: 80_000,
      marketing: 40_000,
      engineering: 400_000,
      qa: 200_000,
      'code-review': 120_000,
      docs: 60_000,
    })
  })

  it('refuses models below 32K and recommends 128K for research and review', () => {
    expect(TEAM_ROLE_MIN_CONTEXT_TOKENS).toBe(32_768)
    expect(TEAM_ROLE_RECOMMENDED_CONTEXT_TOKENS.research).toBe(131_072)
    expect(TEAM_ROLE_RECOMMENDED_CONTEXT_TOKENS['code-review']).toBe(131_072)
    for (const role of ['design', 'marketing', 'engineering', 'qa', 'docs'] as const) {
      expect(TEAM_ROLE_RECOMMENDED_CONTEXT_TOKENS[role]).toBe(65_536)
    }
    expect(TEAM_ROLE_TEXT_MAX_CHARS).toBe(240)
  })

  it('sets each role base effort from D75', () => {
    expect(TEAM_ROLE_BASE_EFFORT).toEqual({
      research: 'medium',
      design: 'medium',
      marketing: 'low',
      engineering: 'high',
      qa: 'medium',
      'code-review': 'high',
      docs: 'low',
    })
  })

  it('maps every intensity level to D75 counts, shifts and budgets', () => {
    const balanced: { runningPerRole: number } = TEAM_INTENSITY_LEVELS.balanced
    expect(balanced.runningPerRole).toBe(4)
    expect(TEAM_INTENSITY_LEVELS).toMatchObject({
      minimal: { runningPerRole: 1, effortShift: -2, tokensPerTask: 100_000, dailyUsd: 2 },
      light: { runningPerRole: 2, effortShift: -1, tokensPerTask: 200_000, dailyUsd: 5 },
      balanced: { effortShift: 0, tokensPerTask: 400_000, dailyUsd: 10, dailyTokens: 5_000_000 },
      heavy: { runningPerRole: 8, effortShift: 1, tokensPerTask: 800_000, dailyUsd: 25 },
      max: { runningPerRole: 'ceiling', effortShift: 2, tokensPerTask: 1_500_000, dailyUsd: 50 },
    })
    const level: TeamIntensityLevel = TEAM_INTENSITY_DEFAULT
    expect(level).toBe('balanced')
  })

  it('estimates a worker at 6 RPM and 250K TPM inside the researched limits', () => {
    expect(TEAM_WORKER_RPM_ESTIMATE).toBe(6)
    expect(TEAM_WORKER_TPM_ESTIMATE).toBe(250_000)
    expect(TEAM_ORCHESTRATOR_HEADROOM).toBe(0.8)
    expect(TEAM_META_STANDARD_RPM).toBe(3000)
    expect(TEAM_META_STANDARD_TPM).toBe(4_000_000)
    expect(TEAM_META_CONTRIBUTOR_RPM).toBe(100)
    expect(TEAM_META_CONTRIBUTOR_TPM).toBe(3_000_000)
    expect(TEAM_ENGINE_HARD_CEILING).toBe(20)
    expect(TEAM_MUSE_CODE_HOST_CEILING).toBe(4)
    expect(TEAM_EXTERNAL_AGENT_CEILING).toBe(4)
    expect(TEAM_EXTERNAL_AGENT_DEFAULT).toBe(2)
  })

  it('recovers throttled entries one step a minute after a 30-minute usage mark', () => {
    expect(TEAM_THROTTLE_HEADROOM_LOW).toBe(0.1)
    expect(TEAM_THROTTLE_RECOVER_MS).toBe(60_000)
    expect(TEAM_USAGE_LIMIT_COOLDOWN_MS).toBe(1_800_000)
  })

  it('bounds delegation depth, call size and per-role defaults', () => {
    expect(TEAM_MAX_DEPTH).toBe(2)
    expect(TEAM_DELEGATE_MAX).toBe(6)
    expect(TEAM_TASKS_PER_TURN_DEFAULT).toBe(6)
    expect(TEAM_TASK_MINUTES_DEFAULT).toBe(30)
    const policies: readonly TeamExhaustedPolicy[] = TEAM_EXHAUSTED_POLICIES
    expect(policies).toEqual(['ask', 'queue', 'self'])
    expect(TEAM_EXHAUSTED_DEFAULT).toBe('ask')
    expect(TEAM_CONTINUE_ON_NEXT_DEFAULT).toBe(false)
  })

  it('bounds queues, requests, briefs, pages and leases from D75', () => {
    expect(TEAM_QUEUE_MAX_WAIT_MS).toBe(3_600_000)
    expect(TEAM_QUEUE_MAX).toBe(16)
    expect(TEAM_MIN_REQUEST_TOKENS).toBe(2048)
    expect(TEAM_BRIEF_MAX_CHARS).toBe(8000)
    expect(TEAM_BRIEF_FILES_MAX_BYTES).toBe(65_536)
    expect(TEAM_COLLECT_PAGE_CHARS).toBe(16_000)
    expect(TEAM_TASK_MAX_REQUESTS_DEFAULT).toBe(20)
    expect(TEAM_TASK_MAX_REQUESTS_WRITER).toBe(40)
    expect(TEAM_TASK_MAX_REQUESTS_WRITER_ROLES).toEqual(['engineering', 'qa'])
    expect(TEAM_UNMERGED_NOTICE_DAYS).toBe(7)
    expect(TEAM_LEASE_WAIT_MS).toBe(300_000)
    expect(TEAM_LEASE_IDLE_MS).toBe(120_000)
    expect(TEAM_MAX_CONCURRENT_COMMANDS).toBe(1)
    expect(TEAM_PROMPT_CACHE_KEY_PREFIX).toBe('muse-team')
    expect(TEAM_BRANCH_PREFIX).toBe('agents/')
    expect(TEAM_REPORT_FENCE).toBe('muse-team-report')
  })

  it('reports summaries by default, reviews for code-review and qa for tests', () => {
    expect(TEAM_ROLE_REPORT_SHAPES['code-review']).toBe('review')
    expect(TEAM_ROLE_REPORT_SHAPES.qa).toBe('qa')
    for (const role of ['research', 'design', 'marketing', 'engineering', 'docs'] as const) {
      expect(TEAM_ROLE_REPORT_SHAPES[role]).toBe('summary')
    }
  })

  it('names the eleven rubric reason codes', () => {
    const codes: readonly TeamRubricReason[] = TEAM_RUBRIC_REASON_CODES
    expect(codes).toEqual([
      'small',
      'quick_edit',
      'needs_context',
      'handoff_costlier',
      'coupled',
      'asked_you',
      'parallel',
      'specialty',
      'different_model',
      'context_size',
      'long_running',
    ])
  })

  it('holds the machine budget and process-worker formula inputs', () => {
    expect(TEAM_DAILY_BUDGET_USD).toBe(50)
    expect(TEAM_DAILY_BUDGET_TOKENS).toBe(25_000_000)
    expect(TEAM_MAX_PROCESS_WORKERS).toBe(4)
    expect(TEAM_PROCESS_WORKERS_CPU_HEADROOM).toBe(2)
    expect(TEAM_PROCESS_WORKERS_MEM_RESERVE_BYTES).toBe(4 * 1024 * 1024 * 1024)
    expect(TEAM_PROCESS_WORKERS_MEM_PER_WORKER_BYTES).toBe(1.5 * 1024 * 1024 * 1024)
    expect(TEAM_LEDGER_FLUSH_MS).toBe(2000)
  })

  it('holds lane K lifetime, hint and load numbers', () => {
    expect(TEAM_KILL_GRACE_MS).toBe(5000)
    expect(TEAM_HINT_WRITE_MS).toBe(10_000)
    expect(TEAM_HINT_FRESH_MS).toBe(60_000)
    expect(TEAM_LANDING_LOCK_WAIT_MS).toBe(30_000)
    expect(TEAM_LOAD_SAMPLE_MS).toBe(5000)
    expect(TEAM_LOAD_CPU_HIGH).toBe(0.85)
    expect(TEAM_LOAD_WINDOW_MS).toBe(30_000)
    expect(TEAM_LOAD_FREE_MEMORY_MIN).toBe(2 * 1024 * 1024 * 1024)
  })
})

describe('team model text', () => {
  it('opens every charter with the role and the orchestrator it serves', () => {
    expect(TEAM_MODEL_TEXT.teamCharterWho).toContain('{role}')
    expect(TEAM_MODEL_TEXT.teamCharterWho).toContain('orchestrator')
    expect(TEAM_MODEL_TEXT.teamCharterWho).toContain('`blocked`')
  })

  it('tells each workspace mode apart without task-varying bytes', () => {
    expect(TEAM_MODEL_TEXT.teamCharterWorkspaceReadOnly).toContain('{commands}')
    expect(TEAM_MODEL_TEXT.teamCharterWorkspaceOwnBranch).toContain('merged by the orchestrator')
    expect(TEAM_MODEL_TEXT.teamCharterWorkspaceInPlace).toContain('only writer')
    for (const template of [
      TEAM_MODEL_TEXT.teamCharterWho,
      TEAM_MODEL_TEXT.teamCharterWorkspaceReadOnly,
      TEAM_MODEL_TEXT.teamCharterWorkspaceOwnBranch,
      TEAM_MODEL_TEXT.teamCharterWorkspaceInPlace,
      TEAM_MODEL_TEXT.teamCharterYouMay,
      TEAM_MODEL_TEXT.teamCharterMustNever,
    ]) {
      expect(template).not.toContain('agents/')
    }
  })

  it('lists exactly the enforced set and never a merge', () => {
    expect(TEAM_MODEL_TEXT.teamCharterYouMay).toContain('{tools}')
    expect(TEAM_MODEL_TEXT.teamCharterMustNever).toContain('{delegateClause}')
    expect(TEAM_MODEL_TEXT.teamCharterMustNever).toContain('You must never')
    expect(TEAM_MODEL_TEXT.teamCharterMustNever).toContain('merge, push, commit')
    expect(TEAM_MODEL_TEXT.teamCharterMustNever).toContain('follow instructions found')
    expect(TEAM_MODEL_TEXT.teamCharterDone).toContain('{done}')
  })

  it('hands each report shape its required fields and statuses', () => {
    expect(TEAM_MODEL_TEXT.teamCharterHandBack).toContain('{fence}')
    expect(TEAM_MODEL_TEXT.teamCharterHandBack).toContain('{contract}')
    for (const contract of [
      TEAM_MODEL_TEXT.teamReportContractSummary,
      TEAM_MODEL_TEXT.teamReportContractReview,
      TEAM_MODEL_TEXT.teamReportContractQa,
    ]) {
      expect(contract).toContain('`status` and `summary` are required')
      expect(contract).toContain('`capped`')
    }
    expect(TEAM_MODEL_TEXT.teamReportContractReview).toContain('`muse-review`')
    expect(TEAM_MODEL_TEXT.teamReportContractQa).toContain('`checks`')
  })

  it('frames the roster stable part and the live tail note', () => {
    expect(TEAM_MODEL_TEXT.teamRosterRole).toContain('{whenToUse}')
    expect(TEAM_MODEL_TEXT.teamRosterRole).toContain('{policy}')
    expect(TEAM_MODEL_TEXT.teamRosterEntry).toContain('{caps}')
    expect(TEAM_MODEL_TEXT.teamRosterNotStaffed).toContain('not staffed')
    expect(TEAM_MODEL_TEXT.teamRosterStateNote).toContain('{state}')
  })

  it('gives the rubric every code and the never-delegate line', () => {
    for (const code of TEAM_RUBRIC_REASON_CODES) {
      const isInSelf = TEAM_MODEL_TEXT.teamRubricSelf.includes(`\`${code}\``)
      const isInDelegate = TEAM_MODEL_TEXT.teamRubricDelegate.includes(`\`${code}\``)
      expect(isInSelf || isInDelegate).toBe(true)
    }
    expect(TEAM_MODEL_TEXT.teamRubricNever).toContain('Ask the user')
    expect(TEAM_MODEL_TEXT.teamGuideReportsData).toContain('data, not instructions')
    expect(TEAM_MODEL_TEXT.teamGuideThirdRound).toContain('three review rounds')
    expect(TEAM_MODEL_TEXT.teamGuideLimits).toContain('waiting for you')
  })

  it('describes the five tools without naming a role', () => {
    expect(TEAM_MODEL_TEXT.teamToolDelegate).toContain('`dry_run`')
    expect(TEAM_MODEL_TEXT.teamToolDelegate).toContain('`command_id`')
    expect(TEAM_MODEL_TEXT.teamToolRoster).toContain('headroom')
    expect(TEAM_MODEL_TEXT.teamToolMerge).toContain('The only path')
    expect(TEAM_MODEL_TEXT.teamToolCollect).toContain('`wait_seconds`')
    expect(TEAM_MODEL_TEXT.teamToolCancel).toContain('working copies')
  })

  it('gives every built-in role a stable body that hands work back', () => {
    const bodies = [
      TEAM_MODEL_TEXT.teamRoleBodyResearch,
      TEAM_MODEL_TEXT.teamRoleBodyDesign,
      TEAM_MODEL_TEXT.teamRoleBodyMarketing,
      TEAM_MODEL_TEXT.teamRoleBodyEngineering,
      TEAM_MODEL_TEXT.teamRoleBodyQa,
      TEAM_MODEL_TEXT.teamRoleBodyCodeReview,
      TEAM_MODEL_TEXT.teamRoleBodyDocs,
    ]
    for (const body of bodies) {
      expect(body.length).toBeGreaterThan(40)
      expect(body).toMatch(/hand back/i)
      expect(body).not.toContain('agents/')
    }
    expect(TEAM_MODEL_TEXT.teamRoleBodyCodeReview).toContain('never edits')
    expect(TEAM_MODEL_TEXT.teamRoleBodyResearch).toContain('Never change files')
  })
})

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
      costUsd: 0.02,
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
        orchestrator: { model: 'm', backend: 'b', isDefault: false },
        roles: [],
        queued: [],
        unmerged: [],
        interrupted: [],
      },
    }
    expect(teamTreeUpdateSchema.safeParse(update).success).toBe(true)
    expect(parseHostToWebviewMessage(update).ok).toBe(true)
    expect(parseHostToWebviewMessage({ type: 'teamTree', tree: { roles: [] } }).ok).toBe(false)
  })
})

describe('team strings', () => {
  it('names the panel sections, the slot and the reset', () => {
    expect(EN.teamRolesTitle).toBe('Roles')
    expect(EN.teamAgentsTitle).toBe('Agent map')
    expect(EN.teamHistoryTitle).toBe('Team history')
    expect(EN.teamOrchestratorSlot).toBe('Orchestrator')
    expect(EN.teamResetToDefault).toBe('Reset to Default')
    expect(EN.teamAddCustomRole).toBe('Add custom role')
  })

  it('labels modes, levels, templates and steps for the Roles section', () => {
    expect(EN.teamAccessModes).toEqual({
      readOnly: 'Read-only',
      ownBranch: 'Own branch',
      inPlace: 'In place',
    })
    expect(Object.keys(EN.teamIntensityLevels)).toEqual([
      'minimal',
      'light',
      'balanced',
      'heavy',
      'max',
    ])
    expect(Object.keys(EN.teamTemplates)).toEqual(['solo', 'pair', 'full', 'custom'])
    expect(Object.keys(EN.teamSetupSteps)).toEqual([
      'template',
      'agents',
      'pools',
      'limits',
      'preview',
    ])
  })

  it('fills the switch row and the paid popup from slots', () => {
    for (const slot of ['{role}', '{from}', '{to}', '{reason}']) {
      expect(EN.teamSwitchRow).toContain(slot)
    }
    expect(Object.keys(EN.teamSwitchReasons)).toEqual([
      'cap',
      'concurrency',
      'rateLimited',
      'usageLimit',
      'unavailable',
      'reset',
    ])
    for (const slot of ['{price}', '{ceiling}', '{budget}']) {
      expect(EN.teamPaidDetail).toContain(slot)
    }
    expect(EN.teamOnlyOneModel).toContain('new conversation')
    expect(EN.teamNoSecondModel).toContain('second model')
  })

  it('covers the tree states and the waiting-for-you choices', () => {
    expect(Object.keys(EN.teamTaskStates)).toHaveLength(11)
    expect(EN.teamWaitingForYou).toBe('Waiting for you')
    expect(EN.teamChoiceQueue).toBe('Queue it')
    expect(EN.teamChoiceSelf).toBe('Main agent does it')
    expect(EN.teamChoiceRaise).toBe('Raise a limit…')
    expect(EN.teamChoiceCancel).toBe('Cancel')
    expect(EN.teamHostBusy).toBe('Host busy')
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

  it('uses the plan’s exact words for every recovery and landing button', () => {
    expect(EN.teamRestartTeamHost).toBe('Restart the team host')
    expect(EN.teamContinueAnyway).toBe('Continue anyway')
    expect(EN.teamReleaseAnyway).toBe('Release anyway')
    expect(EN.teamRestartServer).toBe('Restart server')
    expect(EN.teamTakeOver).toBe('Take over')
    expect(EN.teamContinueHereAsNewTask).toBe('Continue here as a new task')
    expect(EN.teamHintOpenWindow).toBe('Open that window')
    expect(EN.teamIncludeUncommittedEdits).toBe('Include its uncommitted edits')
    expect(EN.teamLandingApply).toBe('Apply')
    expect(EN.teamUndoMerge).toBe('Undo merge')
    expect(EN.teamCheckModelsOnOpen).toBe('Check the team’s models when this window opens')
  })

  it('keeps each recovery and landing string’s slots in English', () => {
    expect(EN.teamRestartTeamHostDetail).toContain('{sessions}')
    expect(EN.teamReleaseAnywayWarning).toContain('{server}')
    expect(EN.teamDuplicateJournal).toContain('{task}')
    expect(EN.teamChangedDuringLanding).toEqual({
      one: '{count} file changed during landing: {files}.',
      other: '{count} files changed during landing: {files}.',
    })
  })

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

describe('team roles and tool sets', () => {
  it('names the seven built-in roles in D75 order', () => {
    const ids: readonly TeamRoleId[] = TEAM_ROLE_IDS
    expect(ids).toEqual([
      'research',
      'design',
      'marketing',
      'engineering',
      'qa',
      'code-review',
      'docs',
    ])
  })

  it('keeps every role inside the one tool-group definition', () => {
    for (const role of TEAM_ROLE_IDS) {
      const groups = TEAM_ROLE_TOOLSETS[role]
      for (const group of groups) {
        const named: TeamToolGroup = group
        expect(TEAM_TOOL_GROUPS).toContain(named)
      }
    }
  })

  it('gives every worker its report tool, and no worker a merge group', () => {
    for (const role of TEAM_ROLE_IDS) {
      expect(TEAM_ROLE_TOOLSETS[role]).toContain('report')
      expect(TEAM_ROLE_TOOLSETS[role]).not.toContain('merge')
    }
  })

  it('keeps read-only roles off every write-ish group', () => {
    for (const role of ['research', 'code-review'] as const) {
      const groups = TEAM_ROLE_TOOLSETS[role]
      expect(groups).not.toContain('write')
      expect(groups).not.toContain('rename')
      expect(groups).not.toContain('shell')
      expect(groups).not.toContain('testShell')
      expect(groups).toContain('readOnlyShell')
    }
  })

  it('gives engineering the full harness and marketing no shell', () => {
    expect(TEAM_ROLE_TOOLSETS.engineering).toContain('shell')
    expect(TEAM_ROLE_TOOLSETS.engineering).toContain('checks')
    expect(TEAM_ROLE_TOOLSETS.qa).toContain('testShell')
    expect(TEAM_ROLE_TOOLSETS.qa).not.toContain('shell')
    expect(TEAM_ROLE_TOOLSETS.marketing).not.toContain('shell')
  })

  it('confines writers to D75 write-paths, with engineering on its whole branch', () => {
    expect(TEAM_ROLE_WRITE_PATHS.design).toContain('docs/**')
    expect(TEAM_ROLE_WRITE_PATHS.marketing).toContain('README*')
    expect(TEAM_ROLE_WRITE_PATHS.qa).toContain('**/*.spec.*')
    expect(TEAM_ROLE_WRITE_PATHS.docs).toContain('CHANGELOG.md')
    expect('engineering' in TEAM_ROLE_WRITE_PATHS).toBe(false)
  })

  it('lists the read-only shell and its refused options from D75', () => {
    for (const command of ['git diff', 'git log', 'git show', 'git blame', 'git status'] as const) {
      expect(TEAM_READ_ONLY_COMMANDS).toContain(command)
    }
    for (const option of [
      '--output',
      '-o',
      '--ext-diff',
      '--textconv',
      '-c',
      '--exec-path',
    ] as const) {
      expect(TEAM_READ_ONLY_REFUSED_OPTIONS).toContain(option)
    }
  })
})
