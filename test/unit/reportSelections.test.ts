import { describe, expect, it, vi } from 'vitest'
import { readReportSelections } from '../../src/runtime/reporting/selections'
import {
  availableSource,
  buildSourceSnapshot,
  REPORT_FIXTURE_AS_OF,
} from './helpers/reporting/snapshot'
import type { GitFacts } from '../../src/core/reporting/sources/types'
import type { ReportGitIo } from '../../src/core/reporting/sources/git'

const head = 'a'.repeat(40)
const base = 'b'.repeat(40)
const fork = 'c'.repeat(40)
const outside = 'd'.repeat(40)
const git: GitFacts = {
  head,
  defaultBranch: 'main',
  commits: [
    {
      sha: head,
      at: '2026-01-01T00:00:00+00:00',
      subject: 'After tag in ancestry',
      files: ['src/main.ts'],
    },
    {
      sha: outside,
      at: REPORT_FIXTURE_AS_OF,
      subject: 'Later timestamp outside selected ancestry',
      files: ['README.md'],
    },
  ],
  tags: [{ name: 'v1', commit: base, at: '2026-06-01T00:00:00+00:00' }],
  branches: [
    { name: 'main', commit: base, merged: true },
    { name: 'lane', commit: head, merged: false },
  ],
  worktrees: [],
}
const options = {
  kind: 'changes' as const,
  asOf: REPORT_FIXTURE_AS_OF,
  scope: 'latest',
  full: false,
  network: false,
  failOn: [],
}
function graph(selected = head): ReportGitIo {
  return {
    run: vi.fn((args: readonly string[]) => {
      let stdout = selected
      if (args.includes('merge-base')) stdout = fork
      else if (args.includes(`^${fork}`)) stdout = args.includes(head) ? head : ''
      return Promise.resolve({ code: 0, stdout })
    }),
  }
}
describe('bound report Git selections', () => {
  it('uses ancestry rather than commit dates, and excludes the branch fork', async () => {
    const io = graph()
    const snapshot = buildSourceSnapshot({ git: availableSource('git', git) })
    const selection = await readReportSelections(
      snapshot,
      options,
      io,
      new AbortController().signal,
    )
    expect(selection.changes(snapshot, options).data?.map((commit) => commit.sha)).toEqual([head])
    expect(selection.changeBranches(snapshot, options).data).toEqual([
      { commit: head, branches: ['lane'] },
    ])
    expect(io.run).toHaveBeenCalledWith(
      expect.arrayContaining([`${base}..${head}`, '--']),
      expect.any(AbortSignal),
    )
    expect(io.run).toHaveBeenCalledWith(
      expect.arrayContaining([head, `^${fork}`, '--']),
      expect.any(AbortSignal),
    )
  })
  it('marks unknown bounded commit material partial instead of dropping it as complete', async () => {
    const snapshot = buildSourceSnapshot({ git: availableSource('git', git) })
    const selection = await readReportSelections(
      snapshot,
      options,
      graph(`${head}\n${'e'.repeat(40)}`),
      new AbortController().signal,
    )
    expect(selection.changes(snapshot, options).record.status).toBe('partial')
    expect(selection.changes(snapshot, options).data).toHaveLength(1)
  })
  it('reports absent scope evidence as unavailable and refuses a malformed historical plan', async () => {
    const snapshot = buildSourceSnapshot({
      git: availableSource('git', git),
      plan: availableSource('plan', {
        format: 'quality-ledger-v1',
        milestones: [],
        questions: [],
        risks: [],
        residuals: [],
        releases: [],
        deliveryOrder: [],
        drift: [],
      }),
    })
    const io: ReportGitIo = {
      run: vi.fn(() => Promise.resolve({ code: 0, stdout: '# Unstructured old notes' })),
    }
    const missing = await readReportSelections(
      snapshot,
      { ...options, scope: 'missing' },
      io,
      new AbortController().signal,
    )
    expect(missing.changes(snapshot, options).record.status).toBe('unavailable')
    const release = await readReportSelections(
      snapshot,
      { ...options, kind: 'release' },
      io,
      new AbortController().signal,
    )
    expect(release.risksSinceRelease(snapshot).record.status).toBe('unavailable')
  })
})
