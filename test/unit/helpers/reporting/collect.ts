import { createHash } from 'node:crypto'
import { createReportCollector, type ReportDraft } from '../../../../src/core/reporting/collect'
import type {
  PlanFacts,
  SourceSnapshot,
  UsageFacts,
} from '../../../../src/core/reporting/sources/types'
import type {
  ReportDocument,
  ReportLabelKey,
  ReportOptions,
  ReportSection,
} from '../../../../src/shared/reportSchema'
import {
  availableSource,
  buildSourceSnapshot,
  reportFactSnapshot,
  reportOptions,
  unavailableSource,
} from './snapshot'

// Test-only seal: safe fabricated facts, no claim to implement R's scrub.
export function fixtureFinalize(draft: ReportDraft): ReportDocument {
  const { asOf: _asOf, ...header } = draft.header
  const contentHash = createHash('sha256')
    .update(JSON.stringify({ ...draft, header }))
    .digest('hex')
  return { ...draft, header: { ...draft.header, contentHash } }
}

export const fixtureCollector = createReportCollector({
  finalize: fixtureFinalize,
  nextStepLimit: 3,
  selections: {
    changes: (snapshot) =>
      snapshot.sources.git.data === null
        ? unavailableSource('changesRange', 'No range evidence')
        : availableSource('changesRange', snapshot.sources.git.data.commits),
    changeBranches: (snapshot) =>
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
    costUsd: 0.25,
    certainty: 'reported',
    breakdown: [
      {
        key: 'fixture-model',
        inputTokens: 100,
        outputTokens: 20,
        costUsd: 0.25,
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
      security: availableSource('security', [facet('security', 'vault')]),
      accounts: availableSource('accounts', [facet('accounts', 'accounts')]),
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

export function getSection(document: ReportDocument, id: string): ReportSection {
  const section = document.sections.find((entry) => entry.id === id)
  if (section === undefined) throw new Error(`Missing fixture section ${id}`)
  return section
}

export function noSources(): SourceSnapshot {
  return buildSourceSnapshot()
}
