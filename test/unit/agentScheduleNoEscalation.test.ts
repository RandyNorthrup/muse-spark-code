import { Usd } from '../../src/shared/usd'
import { describe, expect, it } from 'vitest'
import { AgentScheduleNoEscalation } from '../../src/core/schedules/noEscalation'
import type { ScheduleGrant, ScheduleGrantRule } from '../../src/shared/scheduleV2'

const rules: ScheduleGrantRule[] = [
  { id: 'read', kind: 'path', glob: 'src/**', access: 'read' },
  { id: 'edit', kind: 'path', glob: 'src/**', access: 'edit' },
  { id: 'other', kind: 'path', glob: 'test/**', access: 'edit' },
  { id: 'git', kind: 'command', prefix: 'git status' },
  { id: 'tool', kind: 'tool', name: 'read_file' },
]
const subsets = Array.from({ length: 2 ** rules.length }, (_, mask) =>
  rules.filter((_, index) => (mask & (1 << index)) !== 0),
)
const grant = (rules: ScheduleGrantRule[], paidCapUsd = 1): ScheduleGrant => ({
  rules,
  destinationIds: rules.map((rule) => rule.id),
  paidCapUsd: Usd.from(paidCapUsd).toAmount(),
})
const intersection = new AgentScheduleNoEscalation()

describe('agent schedule grant intersection', () => {
  it('is bounded by both permission sets for every subset pair', () => {
    for (const requested of subsets) {
      for (const held of subsets) {
        const wanted = grant(requested)
        const creator = grant(held)
        const before = structuredClone([wanted, creator])
        const result = intersection.bounded(wanted, creator)
        const expected = requested.filter((rule) =>
          held.some((parent) => {
            if (parent.kind !== rule.kind) return false
            if (rule.kind === 'tool') return parent.kind === 'tool' && parent.name === rule.name
            return rule.kind === 'command'
              ? parent.kind === 'command' && parent.prefix === rule.prefix
              : parent.kind === 'path' &&
                  parent.glob === rule.glob &&
                  !(rule.access === 'edit' && parent.access === 'read')
          }),
        )
        expect(result.rules).toEqual(expected)
        expect(result.destinationIds).toEqual(
          wanted.destinationIds.filter((id) => creator.destinationIds.includes(id)),
        )
        expect([wanted, creator]).toEqual(before)
      }
    }
  })

  it('never widens read to edit or guesses a command or glob subset', () => {
    const creator = grant([rules[0], rules[3], rules[4]].filter((rule) => rule !== undefined))
    const requested = grant([
      { id: 'edit', kind: 'path', glob: 'src/**', access: 'edit' },
      { id: 'broad', kind: 'path', glob: '**', access: 'read' },
      { id: 'shell', kind: 'command', prefix: 'git status; echo surprise' },
      { id: 'tool', kind: 'tool', name: 'write_file' },
    ])
    expect(intersection.bounded(requested, creator).rules).toEqual([])
    expect(
      intersection.bounded(
        grant([rules[0]].filter((rule) => rule !== undefined)),
        grant([rules[1]].filter((rule) => rule !== undefined)),
      ).rules,
    ).toHaveLength(1)
  })

  it('takes the smaller finite paid cap and refuses malformed authority', () => {
    for (const requested of [0, 1, 2])
      for (const held of [0, 1, 2])
        expect(intersection.bounded(grant([], requested), grant([], held)).paidCapUsd).toBe(
          Usd.from(Math.min(requested, held)).toAmount(),
        )
    for (const paidCapUsd of [-1, NaN, Infinity]) {
      expect(() => intersection.bounded(grant([], paidCapUsd), grant([]))).toThrow()
      expect(() => intersection.bounded(grant([]), grant([], paidCapUsd))).toThrow()
    }
  })
})
