// Fixtures for the M113 report-kind collect suites (accounts, playbook,
// schedules, security and the shared row-identity/row-sources suites).
// Written for the merged tree after main's test overhaul removed the older
// reporting helpers: only what these suites use, built directly against the
// current collect and source types. Fixture facts are synthetic and make no
// claim about production scrubbing or inference.
import { Usd as PortUsd } from '../../../../src/shared/usd'
import { createHash } from 'node:crypto'
import { createReportCollector, type ReportDraft } from '../../../../src/core/reporting/collect'
import type {
  PlanFacts,
  SourceReadContext,
  SourceSnapshot,
  UsageFacts,
} from '../../../../src/core/reporting/sources/types'
import { EN } from '../../../../src/shared/l10n/en'
import type {
  ReportDocument,
  ReportKind,
  ReportLabelKey,
  ReportOptions,
  ReportSection,
  ReportSourceRecord,
} from '../../../../src/shared/reportSchema'

const KIND_FIXTURE_AS_OF = '2026-10-06T12:00:00+00:00'

export const REPORT_FIXTURE_AS_OF = KIND_FIXTURE_AS_OF
export const REPORT_FIXTURE_HASH = 'a'.repeat(64)

export function unavailableSource(id: string, reason = 'Fixture source was not supplied') {
  return {
    record: {
      id,
      status: 'unavailable',
      reason,
      observedAt: null,
      freshness: { state: 'unknown', ageMs: null },
    },
    data: null,
  } as const
}

export function availableSource<T>(id: string, data: T) {
  return {
    record: {
      id,
      status: 'ok',
      reason: null,
      observedAt: KIND_FIXTURE_AS_OF,
      freshness: { state: 'fresh', ageMs: 0 },
    },
    data,
  } as const
}

export function buildSourceSnapshot(
  sources: Partial<SourceSnapshot['sources']> = {},
): SourceSnapshot {
  return {
    asOf: KIND_FIXTURE_AS_OF,
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
    asOf: KIND_FIXTURE_AS_OF,
    scope: 'fixture-workspace',
    full: false,
    network: false,
    failOn: [],
    ...options,
  }
}

/** The read context the kind suites feed a source: the English table on the
 * fixture clock, in the fixture workspace. */
export function contextFor(kind: ReportKind): SourceReadContext {
  return {
    reportText: EN,
    locale: 'en',
    asOf: REPORT_FIXTURE_AS_OF,
    workspaceKey: 'workspace',
    options: reportOptions(kind),
    signal: new AbortController().signal,
  }
}

// Test-only seal: safe fabricated facts, no claim to implement R's scrub.
export function fixtureFinalize(draft: ReportDraft): ReportDocument {
  const { asOf: _asOf, ...header } = draft.header
  const contentHash = createHash('sha256')
    .update(JSON.stringify({ ...draft, header }))
    .digest('hex')
  return { ...draft, header: { ...draft.header, contentHash } }
}

export function changeSelections() {
  return {
    changes: (snapshot: SourceSnapshot) =>
      snapshot.sources.git.data === null
        ? unavailableSource('changesRange', 'No range evidence')
        : availableSource('changesRange', snapshot.sources.git.data.commits),
    changeBranches: (snapshot: SourceSnapshot) =>
      snapshot.sources.git.data === null
        ? unavailableSource('changeBranches', 'No branch ancestry evidence')
        : availableSource(
            'changeBranches',
            snapshot.sources.git.data.commits.map((commit) => ({
              commit: commit.sha,
              // Synthetic fixture membership, not an ancestry inference from tips.
              branches: commit.sha === 'head' ? ['m12/k'] : [],
            })),
          ),
  }
}

export const fixtureCollector = createReportCollector({
  finalize: fixtureFinalize,
  nextStepLimit: 3,
  selections: {
    ...changeSelections(),
    risksSinceRelease: (snapshot) =>
      snapshot.sources.plan.data === null
        ? unavailableSource('risksSinceRelease', 'No revision evidence')
        : availableSource('risksSinceRelease', {
            risks: snapshot.sources.plan.data.risks,
            residuals: snapshot.sources.plan.data.residuals,
          }),
  },
})

export function facet(source: string, heading: ReportLabelKey, size = 2): ReportSection {
  return {
    id: `${source}/${heading}`,
    label: heading,
    sortKey: 'key',
    columns: [{ key: 'detail', label: 'name' }],
    rows: Array.from({ length: size }, (_, index) => ({
      key: `${source}/${String(index).padStart(4, '0')}`,
      cells: { detail: { type: 'text', value: `${heading}/${String(index)}` } },
      sourceIds: [source],
    })),
    omittedRows: 0,
  }
}

export function fullSnapshot(): SourceSnapshot {
  const base = reportFactSnapshot()
  const plan: PlanFacts = {
    ...base.sources.plan.data!,
    milestones: [
      {
        ...base.sources.plan.data!.milestones[0]!,
        dependencies: ['M1'],
        lanes: [
          {
            id: 'K',
            scope: 'Collectors',
            branch: 'm12/k',
            state: 'inProgress',
            pullRequest: 2,
            certification: String.raw`docs\certification\m12-k.md`,
            hours: 22,
          },
        ],
        checklist: [
          { text: 'A captured fixture', done: true },
          { text: 'A certified renderer', done: false },
        ],
      },
      {
        id: 'M1',
        title: 'Base',
        status: 'merged',
        date: '2026-10-01',
        goal: 'Freeze',
        dependencies: [],
        lanes: [],
        checklist: [],
        requiredGates: [],
      },
      ...['M14', 'M110a0', 'M91b', 'M15'].map(
        (id) =>
          ({
            id,
            title: id,
            status: 'planned',
            date: '2026-10-05',
            goal: 'Fixture',
            dependencies: ['M1'],
            lanes: [],
            checklist: [],
            requiredGates: [],
          }) satisfies PlanFacts['milestones'][number],
      ),
    ],
    questions: [
      { id: 'Q-M12', text: 'Choose the target', milestoneIds: ['M12'], state: 'open' },
      { id: 'Q-answered', text: 'Settled', milestoneIds: ['M1'], state: 'answered' },
    ],
    risks: [
      { id: 'risk-M12', text: 'Revision evidence supplied by fixture port', milestoneIds: ['M12'] },
    ],
    residuals: [{ id: 'R1', text: 'Known residual' }],
    releases: [{ version: '0.14.2', date: '2026-10-05', text: 'Release record' }],
    deliveryOrder: [
      { id: 'M12', needs: ['M1'], reason: 'Contracts first' },
      { id: 'M15', needs: ['M12'], reason: 'Waits for unmerged work' },
      { id: 'M14', needs: ['M1'], reason: 'Next' },
      { id: 'M110a0', needs: ['M1'], reason: 'Third' },
      { id: 'M91b', needs: ['M1'], reason: 'Fourth' },
    ],
  }
  const usage: UsageFacts = {
    period: '7d',
    inputTokens: 100,
    outputTokens: 20,
    cachedTokens: 10,
    costUsd: PortUsd.from(0.25).toAmount(),
    certainty: 'reported',
    breakdown: [
      {
        key: 'fixture-model',
        inputTokens: 100,
        outputTokens: 20,
        costUsd: PortUsd.from(0.25).toAmount(),
        certainty: 'reported',
      },
    ],
    limits: [{ key: 'daily-budget', used: 0.25, limit: 5, resetsAt: null }],
  }
  return {
    ...base,
    sources: {
      ...base.sources,
      plan: availableSource('plan', plan),
      git: availableSource('git', {
        head: 'head',
        defaultBranch: 'main',
        commits: [
          {
            sha: 'head',
            at: '2026-10-06T00:00:00Z',
            subject: 'M12 collectors',
            files: [
              String.raw`src\core\reporting\collect.ts`,
              'src/core/reporting/collect.ts',
              'docs/certification/m12-k.md',
            ],
          },
          {
            sha: 'older',
            at: '2026-10-05T00:00:00Z',
            subject: 'M14 docs',
            files: ['README.md', 'src/shared/constants.ts'],
          },
        ],
        tags: [
          { name: 'v0.14.2', commit: 'tagged', at: '2026-10-05T00:00:00Z' },
          { name: 'v0.14.1', commit: 'oldtag', at: '2026-10-01T00:00:00Z' },
        ],
        branches: [{ name: 'm12/k', commit: 'head', merged: false }],
        worktrees: [],
      }),
      changelog: availableSource('changelog', {
        sections: [
          { version: 'Unreleased', date: null, lines: ['Added collectors'] },
          { version: '0.14.2', date: '2026-10-05', lines: ['A released feature'] },
          { version: '0.14.1', date: '2026-10-01', lines: ['Earlier'] },
        ],
      }),
      certification: availableSource('certification', {
        records: [
          {
            path: String.raw`docs\certification\m12-k.md`,
            milestoneId: 'M12',
            checklist: [{ text: 'A drill', done: true }],
          },
        ],
      }),
      session: availableSource('session', {
        ...base.sources.session.data!,
        usage,
        export: {
          ...base.sources.session.data!.export,
          transcript: [
            ...base.sources.session.data!.export.transcript,
            {
              itemId: 'edit1',
              kind: 'toolCall',
              status: 'completed',
              tool: 'edit_file',
              args: String.raw`{"path":"src\\app.ts"}`,
              patchSummary: { files: 1, added: 3, removed: 2 },
            },
            {
              itemId: 'edit2',
              kind: 'toolCall',
              status: 'failed',
              tool: 'edit_file',
              args: '{"path":"src/app.ts"}',
              patchSummary: { files: 1, added: 1, removed: 0 },
            },
            {
              itemId: 'paid',
              kind: 'toolCall',
              status: 'completed',
              tool: 'generate_image',
              paid: 'imageGeneration',
            },
          ],
        },
        checkRuns: [
          {
            check: 'quality',
            outcome: 'passed',
            durationMs: 42,
            commit: 'head',
            at: '2026-10-06T00:00:00Z',
          },
        ],
      }),
      questions: availableSource('questions', [
        { id: 'q-current', text: 'Pick a file', milestoneIds: [], state: 'open' },
        { id: 'q-done', text: 'Already answered', milestoneIds: [], state: 'answered' },
      ]),
      usage: availableSource('usage', usage),
      agentUsage: availableSource('agentUsage', [
        { agent: 'Codex', file: '~/.codex/usage.jsonl', usage },
      ]),
      checkRuns: availableSource('checkRuns', [
        {
          check: 'quality',
          outcome: 'failed',
          durationMs: 1,
          commit: 'older',
          at: '2026-10-05T00:00:00Z',
        },
        {
          check: 'quality',
          outcome: 'passed',
          durationMs: 42,
          commit: 'head',
          at: '2026-10-06T00:00:00Z',
        },
      ]),
      github: availableSource('github', {
        ...base.sources.github.data!,
        releases: [
          {
            version: 'v0.14.2',
            commit: 'tagged',
            at: '2026-10-05T00:00:00Z',
            assets: ['extension.vsix', 'agent.tgz'],
          },
        ],
        pullRequests: [
          {
            number: 2,
            url: 'https://example.invalid/pull/2',
            state: 'open',
            title: 'Collectors',
            isDraft: true,
            isMerged: false,
            author: { login: 'fixture', id: 1 },
            headRef: 'm12/k',
            headSha: 'head',
            headRepository: 'fixture/repo',
            baseRef: 'main',
            baseRepository: 'fixture/repo',
          },
        ],
      }),
      stores: availableSource('stores', [
        {
          channel: 'npm',
          version: '0.14.1',
          url: 'https://example.invalid/package',
          status: 'lagging',
          reason: 'Waiting for publication',
        },
      ]),
      fleet: availableSource('fleet', [facet('fleet', 'agents'), facet('fleet', 'devices')]),
      security: availableSource('security', {
        vault: {
          state: 'unlocked',
          tier: 'osStore',
          itemCount: 2,
          itemsByKind: [
            { kind: 'apiKey', count: 1 },
            { kind: 'password', count: 1 },
          ],
          grants: [{ scope: 'named/named', count: 1 }],
        },
        audit: [
          { kind: 'environment', decision: 'allow', authority: 'grant', outcome: 'succeeded' },
          { kind: 'environment', decision: 'deny', authority: 'user', outcome: 'denied' },
          { kind: 'ssh', decision: 'allow', authority: 'mode', outcome: 'locked' },
        ],
        developerAudit: [
          { action: 'unlock', source: 'palette' },
          { action: 'enable', source: 'page' },
        ],
      }),
      accounts: availableSource('accounts', {
        providers: [
          {
            provider: 'meta',
            product: 'muse',
            auth: 'oauth',
            accounts: [
              {
                id: 'primary',
                label: 'Primary',
                order: 0,
                limitGroup: null,
                thresholds: {
                  spendUsd: [{ period: 'day', value: PortUsd.from(5).toAmount() }],
                  counts: [{ metric: 'requests', period: 'day', value: 100 }],
                  percents: [{ name: 'plan', value: 80 }],
                },
              },
            ],
          },
        ],
        usage: [
          {
            provider: 'meta',
            account: 'primary',
            label: 'Primary',
            period: 'month',
            inputTokens: 100,
            outputTokens: 20,
            costUsd: PortUsd.from(0.25).toAmount(),
            certainty: 'reported',
          },
        ],
        events: [
          {
            type: 'swap',
            provider: 'meta',
            account: 'backup',
            time: '2026-10-06T10:00:00+00:00',
            trigger: 'userCap/spendUsd/day',
            previousAccount: 'primary',
          },
          {
            type: 'stop',
            provider: 'meta',
            account: 'primary',
            time: '2026-10-06T11:00:00+00:00',
            trigger: 'vendorLimit/quota',
            previousAccount: null,
          },
        ],
        confirmations: [
          {
            provider: 'meta',
            product: 'muse',
            choice: 'confirm',
            answeredAt: '2026-10-06T09:00:00+00:00',
          },
        ],
      }),
      estimate: availableSource('estimate', [facet('estimate', 'criticalPath')]),
      playbook: availableSource('playbook', [facet('playbook', 'decisions')]),
      issues: availableSource('issues', [facet('issues', 'issues')]),
      schedules: availableSource('schedules', [facet('schedules', 'timeline')]),
      keybindings: availableSource('keybindings', [
        facet('keybindings', 'keybindings'),
        facet('keybindings', 'conflicts'),
      ]),
    },
  }
}

export function collectFixture(
  kind: ReportOptions['kind'],
  options: Partial<ReportOptions> = {},
  snapshot = fullSnapshot(),
): ReportDocument {
  const scopes: Partial<Record<ReportOptions['kind'], string>> = {
    milestone: 'M12',
    release: 'latest',
  }
  return fixtureCollector(
    snapshot,
    reportOptions(kind, {
      scope: scopes[kind] ?? 'fixture-workspace',
      ...options,
    }),
  )
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
      asOf: KIND_FIXTURE_AS_OF,
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

export function getSection(document: ReportDocument, id: string): ReportSection {
  const section = document.sections.find((entry) => entry.id === id)
  if (section === undefined) throw new Error(`Missing fixture section ${id}`)
  return section
}

export function noSources(): SourceSnapshot {
  return buildSourceSnapshot()
}
