import type {
  ReportKind,
  ReportDocument,
  ReportOptions,
  ReportSourceRecord,
} from '../../../../src/shared/reportSchema'
import type {
  SourceSnapshot,
  SourceResult,
  ReportSourceKind,
  ReportSourcePort,
  ReportSourcePayloads,
  UsageFacts,
  ReportQuestion,
  CheckRunRecord,
} from '../../../../src/core/reporting/sources/types'

export const REPORT_FIXTURE_AS_OF = '2026-10-06T12:00:00+00:00'
export const REPORT_FIXTURE_HASH = 'a'.repeat(64)

export function unavailableSource(
  id: string,
  reason = 'Fixture source was not supplied',
): SourceResult<never> {
  return {
    record: {
      id,
      status: 'unavailable',
      reason,
      observedAt: null,
      freshness: { state: 'unknown', ageMs: null },
    },
    data: null,
  }
}
export function availableSource<T>(id: string, data: T): SourceResult<T> {
  return {
    record: {
      id,
      status: 'ok',
      reason: null,
      observedAt: REPORT_FIXTURE_AS_OF,
      freshness: { state: 'fresh', ageMs: 0 },
    },
    data,
  }
}
export function buildSourceSnapshot(
  sources: Partial<SourceSnapshot['sources']> = {},
): SourceSnapshot {
  return {
    asOf: REPORT_FIXTURE_AS_OF,
    workspaceKey: 'fixture-workspace',
    generatorVersion: '0.14.2',
    rendererVersion: '1',
    icuVersion: '77.1',
    locale: 'en',
    sources: {
      plan: unavailableSource('plan'),
      package: unavailableSource('package'),
      git: unavailableSource('git'),
      changelog: unavailableSource('changelog'),
      certification: unavailableSource('certification'),
      session: unavailableSource('session'),
      questions: unavailableSource('questions'),
      usage: unavailableSource('usage'),
      agentUsage: unavailableSource('agentUsage'),
      checkRuns: unavailableSource('checkRuns'),
      github: unavailableSource('github'),
      stores: unavailableSource('stores'),
      fleet: unavailableSource('fleet'),
      security: unavailableSource('security'),
      accounts: unavailableSource('accounts'),
      estimate: unavailableSource('estimate'),
      playbook: unavailableSource('playbook'),
      issues: unavailableSource('issues'),
      schedules: unavailableSource('schedules'),
      keybindings: unavailableSource('keybindings'),
      ...sources,
    },
  }
}
// Contract fixtures deliberately distinguish declarations from executions,
// actual turns from messages, and each CI ref from an aggregate conclusion.
export function reportFactSnapshot(): SourceSnapshot {
  const usage: UsageFacts = {
    period: 'session',
    inputTokens: 10,
    outputTokens: 2,
    cachedTokens: null,
    costUsd: null,
    certainty: 'unknown',
    breakdown: [],
    limits: [],
  }
  return buildSourceSnapshot({
    plan: availableSource('plan', {
      format: 'plan-format-v1',
      milestones: [
        {
          id: 'M12',
          title: 'Fixture contracts',
          status: 'planned',
          date: '2026-10-05',
          goal: 'A stable contract',
          dependencies: [],
          lanes: [],
          checklist: [{ text: 'A certified renderer', done: false }],
          requiredGates: ['quality', 'check:reference'],
        },
      ],
      questions: [],
      risks: [],
      residuals: [],
      releases: [],
      deliveryOrder: [],
      drift: [],
    }),
    package: availableSource('package', {
      qualityScripts: [
        { name: 'quality', command: 'npm run quality:gates && npm run test:a11y' },
        { name: 'quality:gates', command: 'npm run typecheck && npm run check:reference' },
        { name: 'check:reference', command: 'node scripts/gen-reference.mjs --check' },
      ],
    }),
    session: availableSource('session', {
      export: {
        format: 'muse-spark-session-export',
        version: 1,
        exportedAt: '2026-10-06T12:00:00Z',
        sourceBackend: 'modelApi',
        redacted: true,
        modelId: 'fixture-model',
        transcript: [
          { itemId: 'one', kind: 'userMessage', status: 'completed', text: 'Start' },
          {
            itemId: 'two',
            kind: 'userMessage',
            status: 'completed',
            text: 'Steering within the same turn',
          },
        ],
      },
      activity: {
        turns: { status: 'available', count: 1 },
        approvals: { status: 'available', approved: 1, denied: 2, auto: 0, expired: 1 },
      },
      backend: 'modelApi',
      usage,
      checkRuns: [],
    }),
    checkRuns: availableSource('checkRuns', []),
    github: availableSource('github', {
      pullRequests: [],
      runs: [
        {
          ref: { kind: 'head', name: 'm12/0' },
          sha: 'a'.repeat(40),
          workflow: 'Quality',
          conclusion: 'success',
          url: 'https://example.invalid/actions/runs/1',
        },
        {
          ref: { kind: 'default-branch', name: 'main' },
          sha: 'b'.repeat(40),
          workflow: 'Quality',
          conclusion: 'failure',
          url: 'https://example.invalid/actions/runs/2',
        },
        {
          ref: { kind: 'release-tag', name: 'v0.14.2' },
          sha: 'c'.repeat(40),
          workflow: 'Release',
          conclusion: null,
          url: 'https://example.invalid/actions/runs/3',
        },
      ],
      releases: [],
    }),
  })
}
export function reportOptions(
  kind: ReportKind = 'project',
  options: Partial<ReportOptions> = {},
): ReportOptions {
  return {
    kind,
    asOf: REPORT_FIXTURE_AS_OF,
    scope: 'fixture-workspace',
    full: false,
    network: false,
    failOn: [],
    ...options,
  }
}
export function reportDocument(
  kind: ReportKind = 'project',
  sources: ReportSourceRecord[] = [unavailableSource('plan').record],
): ReportDocument {
  return {
    format: 'report-v1',
    moneyVersion: 2,
    header: {
      kind,
      scope: 'fixture-workspace',
      asOf: REPORT_FIXTURE_AS_OF,
      generatorVersion: '0.14.2',
      contentHash: REPORT_FIXTURE_HASH,
    },
    needsYou: {
      id: 'needsYou',
      label: 'needsYou',
      sortKey: 'key',
      columns: [{ key: 'detail', label: 'questions' }],
      rows: [],
      omittedRows: 0,
    },
    sections: [
      {
        id: 'status',
        label: 'status',
        sortKey: 'key',
        columns: [{ key: 'state', label: 'status' }],
        rows: [
          {
            key: 'M12',
            cells: { state: { type: 'label', value: 'planned' } },
            sourceIds: [sources[0]!.id],
          },
        ],
        omittedRows: 0,
      },
    ],
    sources,
    footer: { rendererVersion: '1', icuVersion: '77.1', locale: 'en' },
  }
}
export function fakeSourcePort<K extends ReportSourceKind>(
  kind: K,
  result: SourceResult<ReportSourcePayloads[K]>,
): ReportSourcePort<K> & { calls: string[] } {
  const calls: string[] = []
  return {
    kind,
    id: result.record.id,
    calls,
    read(context) {
      calls.push(context.asOf)
      return Promise.resolve(result)
    },
  }
}
export function fakeClock(at = REPORT_FIXTURE_AS_OF): { now(): string; set(at: string): void } {
  let current = at
  return {
    now: () => current,
    set(value) {
      current = value
    },
  }
}
export function fakeJournal(records: readonly CheckRunRecord[] = []): {
  append(record: CheckRunRecord): void
  read(): readonly CheckRunRecord[]
} {
  const entries = structuredClone([...records])
  return {
    append(record) {
      entries.push(structuredClone(record))
    },
    read: () => structuredClone(entries),
  }
}
export function fakeRegistry(questions: readonly ReportQuestion[] = []): {
  read(): readonly ReportQuestion[]
  replace(questions: readonly ReportQuestion[]): void
} {
  let entries = structuredClone([...questions])
  return {
    read: () => structuredClone(entries),
    replace(value) {
      entries = structuredClone([...value])
    },
  }
}
export function fakeUsageJournal(
  usage: UsageFacts,
): ReportSourcePort<'usage'> & { calls: string[] } {
  return fakeSourcePort('usage', availableSource('usage', structuredClone(usage)))
}
