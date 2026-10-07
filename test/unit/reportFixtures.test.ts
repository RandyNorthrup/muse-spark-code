import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildFixtureRepository } from './helpers/reporting/repository'
import {
  PLAN_FORMAT_FIXTURE,
  QUALITY_LEDGER_FIXTURE,
  NO_PLAN_FIXTURE,
  PACKAGE_FIXTURE,
} from './helpers/reporting/plans'
import {
  fakeClock,
  fakeJournal,
  fakeRegistry,
  fakeUsageJournal,
  buildSourceSnapshot,
  availableSource,
  reportOptions,
  REPORT_FIXTURE_AS_OF,
} from './helpers/reporting/snapshot'
import { reportingHttpFixtures } from './helpers/reporting/network'
import { removeFolder } from './helpers/temporaryFolders'

describe('deterministic reporting fakes', () => {
  it('names all absent sources, without pretending they returned empty success', () => {
    const snapshot = buildSourceSnapshot()
    expect(Object.keys(snapshot.sources)).toHaveLength(20)
    for (const [id, result] of Object.entries(snapshot.sources)) {
      expect(result.record).toMatchObject({
        id,
        status: 'unavailable',
        reason: expect.any(String),
        observedAt: null,
        freshness: { state: 'unknown', ageMs: null },
      })
      expect(result.data).toBeNull()
    }
    const available = buildSourceSnapshot({ questions: availableSource('questions', []) })
    expect(available.sources.questions.record.status).toBe('ok')
    expect(snapshot.sources.questions.record.status).toBe('unavailable')
  })
  it('supplies an injectable clock, journal and question registry isolated from mutations', async () => {
    const clock = fakeClock()
    expect(clock.now()).toBe(REPORT_FIXTURE_AS_OF)
    clock.set('2026-10-07T12:00:00+00:00')
    expect(clock.now()).toBe('2026-10-07T12:00:00+00:00')
    const check = {
      check: 'typecheck',
      outcome: 'passed',
      durationMs: 100,
      commit: 'abc',
      at: REPORT_FIXTURE_AS_OF,
    } satisfies Parameters<ReturnType<typeof fakeJournal>['append']>[0]
    const journal = fakeJournal()
    journal.append(check)
    check.check = 'mutated'
    expect(journal.read()[0]!.check).toBe('typecheck')
    const registry = fakeRegistry([
      { id: 'Q1', text: 'Choose a target', milestoneIds: ['M12'], state: 'open' },
    ])
    registry.replace([])
    expect(registry.read()).toEqual([])
    const port = fakeUsageJournal({
      period: '7d',
      inputTokens: 10,
      outputTokens: 2,
      cachedTokens: null,
      costUsd: null,
      certainty: 'unknown',
      breakdown: [],
      limits: [],
    })
    await port.read({
      asOf: REPORT_FIXTURE_AS_OF,
      workspaceKey: 'fixture',
      options: reportOptions('usage'),
      signal: new AbortController().signal,
    })
    expect(port.calls).toEqual([REPORT_FIXTURE_AS_OF])
  })
  it('has both accepted plan formats and an explicit no-plan fixture', () => {
    expect(PLAN_FORMAT_FIXTURE).toContain('### M110a0')
    expect(PLAN_FORMAT_FIXTURE).toContain('### M91b')
    expect(PLAN_FORMAT_FIXTURE).toContain('### CIFIX14C')
    expect(PLAN_FORMAT_FIXTURE).toContain('- **Gates.** quality, check:reference.')
    expect(QUALITY_LEDGER_FIXTURE).toContain('"schema_version":1')
    expect(NO_PLAN_FIXTURE).not.toContain('quality-ledger')
  })
  it('reuses recorded GitHub bodies and supplies separately identified rate/ETag faults', async () => {
    const fixtures = reportingHttpFixtures()
    expect(await fixtures.pulls.json()).toMatchObject([{ number: 56, state: 'open' }])
    expect(await fixtures.failingChecks.json()).toMatchObject({ total_count: 7 })
    expect(fixtures.rateFloor.headers.get('x-ratelimit-remaining')).toBe('10')
    expect(fixtures.rateFloor.headers.get('x-ratelimit-reset')).toBe('1791288000')
    expect(fixtures.retry.headers.get('retry-after')).toBe('60')
    expect(fixtures.notModified.status).toBe(304)
    expect(fixtures.notModified.headers.get('etag')).toBe('"fixture-v1"')
  })
})

describe('fixed Git fixture', () => {
  let root: string
  let left: Awaited<ReturnType<typeof buildFixtureRepository>>
  let right: Awaited<ReturnType<typeof buildFixtureRepository>>
  // Real Git setup is shared by these assertions, retaining Vitest's default timeout.
  beforeAll(async () => {
    await mkdir(path.resolve('temp'), { recursive: true })
    root = await mkdtemp(path.resolve('temp/reporting-'))
    left = await buildFixtureRepository(path.join(root, 'one'))
    right = await buildFixtureRepository(path.join(root, 'two'))
  })
  afterAll(async () => {
    if (root) await removeFolder(root)
  })
  it('produces identical commit objects in two directories with fixed identities and dates', () => {
    expect(left.first).toBe(right.first)
    expect(left.head).toBe(right.head)
    expect(left.git(['log', '--format=%aI|%cI']).replaceAll('Z', '+00:00')).toBe(
      '2026-10-06T11:00:00+00:00|2026-10-06T11:00:00+00:00\n2026-10-05T12:00:00+00:00|2026-10-05T12:00:00+00:00',
    )
  })
  it('gives sources a tag, merged lane, worktree, changelog and plan', async () => {
    expect(left.git(['rev-parse', 'v0.14.2'])).toBe(left.first)
    expect(left.git(['branch', '--merged', 'main'])).toContain('m12/0')
    expect(left.git(['worktree', 'list', '--porcelain']).replaceAll('\\', '/')).toContain(
      left.root.replaceAll('\\', '/'),
    )
    expect(await readFile(path.join(left.root, 'PLAN.md'), 'utf8')).toBe(PLAN_FORMAT_FIXTURE)
    expect(await readFile(path.join(left.root, 'package.json'), 'utf8')).toBe(PACKAGE_FIXTURE)
    expect(await readFile(path.join(left.root, 'CHANGELOG.md'), 'utf8')).toContain(
      '## [Unreleased]',
    )
  })
})
