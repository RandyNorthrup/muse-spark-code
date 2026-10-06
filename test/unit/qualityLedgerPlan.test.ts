import { describe, expect, it } from 'vitest'
import { readPlan } from '../../src/core/reporting/plan/reader'
import { QUALITY_LEDGER_FIXTURE } from './helpers/reporting/plans'

const fixture = readPlan(QUALITY_LEDGER_FIXTURE).ledger!
function fenced(value: unknown): string {
  return `# Project\n\n\`\`\`quality-ledger\n${JSON.stringify(value)}\n\`\`\`\n`
}

describe('quality-ledger v1 plan', () => {
  it('retains work, requirements, acceptance, tasks and inert check evidence', () => {
    const parsed = readPlan(QUALITY_LEDGER_FIXTURE)
    expect(parsed.facts.format).toBe('quality-ledger-v1')
    expect(parsed.facts.drift).toEqual([])
    expect(parsed.ledger).toMatchObject({
      schema_version: 1,
      work: { id: 'M12', title: 'Contracts' },
      requirements: [{ id: 'R1', statement: 'Deterministic output' }],
      acceptance: [{ id: 'A1', checks: ['behavior', 'red'] }],
      tasks: [{ id: 'T1', status: 'planned' }],
    })
    expect(parsed.facts.milestones[0]).toMatchObject({
      id: 'M12',
      status: 'planned',
      date: '',
      goal: 'R1: Deterministic output',
      checklist: [{ done: false }],
    })
  })

  it.each([
    ['version', { ...fixture, schema_version: 2 }],
    ['unknown-field', { ...fixture, guessed: true }],
    ['work-field', { ...fixture, work: { ...fixture.work, secret: 'unsupported' } }],
    [
      'requirement-type',
      { ...fixture, requirements: [{ ...fixture.requirements[0], statement: 7 }] },
    ],
    ['task-status', { ...fixture, tasks: [{ ...fixture.tasks[0], status: 'done-ish' }] }],
    ['missing-field', { ...fixture, acceptance: [{ id: 'A1' }] }],
    ['evidence-shape', { ...fixture, evidence: [{ id: 'E1' }] }],
  ])('rejects %s at the strict zod boundary', (_name, value) => {
    const parsed = readPlan(fenced(value))
    expect(parsed.ledger).toBeNull()
    expect(parsed.facts.milestones).toEqual([])
    expect(parsed.facts.drift).toContainEqual(
      expect.objectContaining({ code: 'ledger-schema', line: 3 }),
    )
  })

  it('reports malformed JSON and missing or duplicate fences with their line', () => {
    expect(readPlan('# Project\n```quality-ledger\n{broken}\n```').facts.drift).toEqual([
      { code: 'ledger-json', line: 2, detail: 'quality-ledger' },
    ])
    expect(readPlan('# Project\n```quality-ledger\n{}').facts.drift[0]).toMatchObject({
      code: 'ledger-fence',
      line: 2,
    })
    expect(
      readPlan(`${QUALITY_LEDGER_FIXTURE}\n${QUALITY_LEDGER_FIXTURE}`).facts.drift[0]?.code,
    ).toBe('ledger-fence')
  })

  it('refuses duplicate JSON keys even when a valid final value would hide them', () => {
    const json = JSON.stringify(fixture).replace(
      '"schema_version":1',
      '"schema_version":2,"schema_version":1',
    )
    expect(readPlan(`\`\`\`quality-ledger\n${json}\n\`\`\``).facts.drift[0]?.code).toBe(
      'ledger-json',
    )
    const escaped = JSON.stringify(fixture).replace(
      '"schema_version":1',
      String.raw`"schema_version":2,"schema_\u0076ersion":1`,
    )
    expect(readPlan(`\`\`\`quality-ledger\n${escaped}\n\`\`\``).facts.drift[0]?.code).toBe(
      'ledger-json',
    )
  })

  it('rejects duplicate ids and dangling references rather than inventing evidence', () => {
    expect(
      readPlan(fenced({ ...fixture, tasks: [...fixture.tasks, ...fixture.tasks] })).facts.drift[0]
        ?.code,
    ).toBe('ledger-duplicate')
    expect(
      readPlan(fenced({ ...fixture, tasks: [{ ...fixture.tasks[0], depends_on: ['missing'] }] }))
        .facts.drift[0]?.code,
    ).toBe('ledger-reference')
    expect(
      readPlan(
        fenced({ ...fixture, acceptance: [{ ...fixture.acceptance[0], requirement: 'missing' }] }),
      ).facts.drift[0]?.code,
    ).toBe('ledger-reference')
  })

  it.each([
    ['active', 'building'],
    ['blocked', 'waiting'],
    ['implemented', 'built'],
    ['verified', 'complete'],
    ['superseded', 'superseded'],
  ])('maps recorded task state %s to %s without Git claims', (status, expected) => {
    const parsed = readPlan(fenced({ ...fixture, tasks: [{ ...fixture.tasks[0], status }] }))
    expect(parsed.facts.drift).toEqual([])
    expect(parsed.facts.milestones[0]?.status).toBe(expected)
    expect(parsed.facts.milestones[0]?.lanes[0]?.branch).toBeNull()
  })

  it('requires every declared evidence kind before marking acceptance done', () => {
    const proof = {
      id: 'E1',
      acceptance: ['A1'],
      kind: 'behavior',
      status: 'pass',
      command: ['check', 'inert'],
      method: 'fixture',
      environment: fixture.work.environment,
      exit_code: 0,
      artifact: null,
      inputs: [],
      scope_sha256: null,
      red: null,
      reason: null,
    }
    const one = readPlan(fenced({ ...fixture, evidence: [proof] }))
    expect(one.facts.milestones[0]?.checklist[0]?.done).toBe(false)
    const both = readPlan(
      fenced({ ...fixture, evidence: [proof, { ...proof, id: 'E2', kind: 'red' }] }),
    )
    expect(both.facts.drift).toEqual([])
    expect(both.facts.milestones[0]?.checklist[0]?.done).toBe(true)
    expect(both.ledger?.evidence[0]?.command).toEqual(['check', 'inert'])
    expect(
      readPlan(
        fenced({
          ...fixture,
          evidence: [proof, { ...proof, id: 'E2', kind: 'red', status: 'fail' }],
        }),
      ).facts.milestones[0]?.checklist[0]?.done,
    ).toBe(false)
  })
})
