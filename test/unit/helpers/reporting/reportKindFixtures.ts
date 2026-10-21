// Shared playbook and schedules report fixtures (M113 lane C-M113-4):
// one copy of the journal records, store rows and section lookup, so the
// source, collect, reader and live-CLI suites read the same shapes.
import type { PlaybookView } from '../../../../src/core/reporting/collect/playbook'
import type { SchedulesView } from '../../../../src/core/reporting/collect/schedules'
import type { ReportSection } from '../../../../src/shared/reportSchema'
import { scheduleFireRecordSchema, scheduleV2Schema } from '../../../../src/shared/scheduleV2'

export const FIXTURE_WORKSPACE_KEY = 'fixture-workspace'

export function playbookModuleFixture(): Record<string, unknown> {
  return { id: 'm1', key: 'src/alpha', files: ['src/alpha/index.ts'], source: 'lane' }
}

/** Valid journal lines: a module, one build round, a decision, a drill,
// a settings row with one rule off, and a route-around refusal. The
// decision carries a canary so the sources prove their scrub. */
export function playbookJournalFixture(): readonly unknown[] {
  const module = playbookModuleFixture()
  return [
    { kind: 'module', value: { module, at: 1000 } },
    {
      kind: 'round',
      value: {
        module,
        implementerId: 'dev',
        reviewerId: 'rev',
        implementerSessionId: 's1',
        reviewerSessionId: 's2',
        round: 1,
        phase: 'build',
        findings: [{ id: 'f1', file: 'src/alpha/index.ts', severity: 'P1', class: 'validation' }],
        answers: [{ findingId: 'f1', status: 'fixed' }],
        at: 2000,
      },
    },
    {
      kind: 'design',
      value: {
        id: 'd1',
        module,
        failureClass: 'Checks raced private-canary',
        whyPatchesFailed: 'Patches raced',
        structuralChange: 'One atomic claim',
        planLocation: 'PLAN.md',
        redesignLane: 'C-M113-4',
        outcome: 'remains',
        at: 4000,
      },
    },
    {
      kind: 'verification',
      value: {
        workId: 'w1',
        moduleId: 'm1',
        commit: 'abc123',
        hookDigest: 'h1',
        scope: 'commit',
        result: 'pass',
        at: 5000,
      },
    },
    {
      kind: 'settings',
      value: {
        teamId: 't1',
        rules: {
          threeStrikes: { enabled: true },
          onePassReview: { enabled: true },
          contractsFirst: { enabled: true },
          smallFirst: { enabled: true },
          offload: { enabled: true },
          continuousIntegration: { enabled: true },
          breakOnPurpose: { enabled: true },
          loudFailures: { enabled: false, reason: 'Too noisy', actor: 'lead', at: 6000 },
        },
        patchRoundsMax: 2,
      },
    },
    {
      kind: 'note',
      value: {
        rule: 'neverAround',
        code: 'lineageRequired',
        module: 'src/alpha',
        laneId: 'C-M113-4',
        at: 8000,
        needsUser: true,
      },
    },
  ]
}

export function scheduleFixture(
  workspaceKey: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 2,
    revision: 0,
    id: 'sched-1',
    name: 'Morning build',
    workspaceKey,
    action: { kind: 'prompt', prompt: 'Run the gates' },
    trigger: { kind: 'interval', everyMs: 3_600_000, anchorMs: 1000 },
    target: { kind: 'newConversation', backend: 'modelApi' },
    delivery: 'newConversation',
    whenClosed: 'open',
    catchUp: 'runOnce',
    mode: 'manual',
    grant: { rules: [], destinationIds: [], paidCapUsd: '0' },
    paidCapUsd: '0',
    parallel: false,
    creator: { kind: 'user' },
    depth: 0,
    allowAgentReschedule: false,
    pinned: false,
    zone: 'UTC',
    paused: false,
    createdAtMs: 1000,
    updatedAtMs: 1000,
    nextFireAtMs: 2000,
    fireCount: 0,
    consecutiveFailures: 0,
    ...overrides,
  }
}

export function fireFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: 'sched-1:1',
    scheduleId: 'sched-1',
    workspaceKey: FIXTURE_WORKSPACE_KEY,
    occurrenceMs: 1500,
    observedAtMs: 1600,
    target: { kind: 'newConversation', backend: 'modelApi' },
    delivery: 'newConversation',
    outcome: 'refused',
    reason: 'Grant required',
    refusedActions: [{ actionClass: 'shell', tool: 'exec', reason: 'No grant rule' }],
    cost: { usd: '1.25', certainty: 'estimated', retainedLiabilityUsd: '0' },
    ...overrides,
  }
}

export function sectionById(data: readonly ReportSection[] | null, id: string): ReportSection {
  if (data === null) throw new Error('Expected report sections')
  const section = data.find((entry) => entry.id === id)
  if (section === undefined) throw new Error(`Missing section ${id}`)
  return section
}

/** All trigger alternatives in the store schema, shared by the lifecycle
and overlapping-language matrices. Each suite checks its own behavior. */
export function scheduleTriggerFixtures(atMs = 2000) {
  const event = { kind: 'event', source: 'github', event: 'pullRequestOpened', conditions: [] }
  return [
    { kind: 'once', atMs },
    { kind: 'interval', everyMs: 3_600_000, anchorMs: 1000 },
    { kind: 'daily', everyDays: 1, times: [{ hour: 12, minute: 0 }], anchorDate: '1970-01-01' },
    { kind: 'weekdays', times: [{ hour: 12, minute: 0 }] },
    { kind: 'weekly', days: [{ weekday: 1, times: [{ hour: 12, minute: 0 }] }] },
    { kind: 'cron', expression: '0 12 * * *' },
    event,
    { kind: 'afterEvent', event, time: { kind: 'once', atMs } },
  ]
}

/** A playbook view with one row in every section, for suites that must run
the real section builders (duplicate-source coverage). */
export function playbookProbeView(): PlaybookView {
  return {
    modules: [
      {
        id: 'm1',
        key: 'src/alpha',
        strikes: 1,
        rounds: [
          { class: null, round: 2 },
          { class: 'validation', round: 1 },
        ],
      },
    ],
    designs: [
      {
        id: 'd1',
        moduleKey: 'src/alpha',
        redesignLane: 'C-M113-4',
        failureClass: 'Checks raced',
        outcome: 'remains',
        at: 4000,
        dateIso: '1970-01-01T00:00:04.000Z',
      },
    ],
    drills: [
      {
        commit: 'abc123',
        moduleId: 'm1',
        scope: 'commit',
        result: 'pass',
        at: 5000,
        dateIso: '1970-01-01T00:00:05.000Z',
      },
    ],
    disabledRules: [
      {
        rule: 'loudFailures',
        actor: 'lead',
        reason: 'Too noisy',
        at: 6000,
        dateIso: '1970-01-01T00:00:06.000Z',
      },
    ],
    refusals: [
      {
        code: 'lineageRequired',
        module: 'src/alpha',
        actor: 'rev',
        reason: 'Around the gate',
        at: 8000,
        dateIso: '1970-01-01T00:00:08.000Z',
      },
    ],
  }
}

function probeSchedule(overrides: Record<string, unknown> = {}) {
  return scheduleV2Schema.parse(scheduleFixture(FIXTURE_WORKSPACE_KEY, overrides))
}

function probeFire(overrides: Record<string, unknown> = {}) {
  return scheduleFireRecordSchema.parse(fireFixture(overrides))
}

function probeEntry(
  overrides: Record<string, unknown> = {},
  iso = '1970-01-01T00:00:02.000Z',
): SchedulesView['schedules'][number] {
  return {
    schedule: probeSchedule(overrides),
    triggerText: 'every 3600000 ms',
    targetText: 'New conversation each fire: modelApi',
    deliveryText: 'New conversation',
    creatorText: undefined,
    grantText: '0 rules, 0 destinations, cap 0',
    nextFireIso: iso,
  }
}

/** A schedules view with running, paused and fired rows, for suites that
must run the real section builders (duplicate-source coverage). */
export function schedulesProbeView(): SchedulesView {
  return {
    schedules: [
      probeEntry(),
      probeEntry({ id: 'sched-2', name: 'Evening build', nextFireAtMs: 2000 }),
      {
        ...probeEntry(
          { id: 'sched-3', name: 'Paused job', paused: true, nextFireAtMs: 3000 },
          '1970-01-01T00:00:03.000Z',
        ),
      },
    ],
    fires: [
      {
        fire: probeFire(),
        outcomeText: 'Refused',
        scheduleName: 'Morning build',
        occurrenceIso: '1970-01-01T00:00:01.500Z',
      },
    ],
  }
}
