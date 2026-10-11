// RVCM1132D finding 4: the engine parses the plan once per report, not once
// per read plus once with lane evidence. Counting the real parser through a
// passthrough mock, so the generation below still exercises the true reader.
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type * as planReader from '../../src/core/reporting/plan/reader'
import { reportingServicesFor } from './helpers/reporting/runtime'

const parseCalls = vi.hoisted(() => [] as number[])

vi.mock('../../src/core/reporting/plan/reader', async (importOriginal) => {
  const mod = await importOriginal<typeof planReader>()
  return {
    ...mod,
    readPlan: (...args: Parameters<typeof mod.readPlan>) => {
      parseCalls.push(args[0].length)
      return mod.readPlan(...args)
    },
  }
})

async function fixtureWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(tmpdir(), 'single-plan-parse-'))
  await writeFile(
    path.join(workspace, 'PLAN.md'),
    [
      '# Fixture plan',
      '',
      '## 6. Milestones',
      '### M1 — Fixture',
      '**Status 2026-10-05: planned.**',
      '',
    ].join('\n'),
  )
  return workspace
}

describe('RVCM1132D single plan parse', () => {
  it('parses the plan once per generated report', async () => {
    const workspace = await fixtureWorkspace()
    const services = reportingServicesFor(workspace)
    const asOf = new Date().toISOString()
    parseCalls.length = 0
    const usage = await services.generate?.({
      kind: 'usage',
      scope: 'today',
      asOf,
      full: false,
      network: false,
      failOn: [],
    })
    expect(usage?.status).toBe('generated')
    expect(parseCalls).toHaveLength(1)
    const session = await services.generate?.({
      kind: 'session',
      scope: '',
      asOf,
      full: false,
      network: false,
      failOn: [],
    })
    expect(session?.status).toBe('generated')
    expect(parseCalls).toHaveLength(2)
  })
})
