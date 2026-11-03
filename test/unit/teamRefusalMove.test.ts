// D261: who answers a refused team task next. Real code only: the
// selection function the host runs, over plain entries in role order, with
// the product's own same-model rule.
import { describe, expect, it } from 'vitest'
import { planRefusalMove, type RefusalMoveEntry } from '../../src/core/team/teamPool'
import { isSameTeamModel } from '../../src/core/team/sameModel'

const entry = (id: string, model: string, pays: 'key' | 'local' = 'local'): RefusalMoveEntry => ({
  id,
  agent: { model, pays },
})

function plan(
  entries: readonly RefusalMoveEntry[],
  options: {
    readonly tried?: readonly string[]
    readonly authors?: readonly string[]
    readonly full?: readonly string[]
    readonly consented?: readonly string[]
    readonly isUnattended?: boolean
  } = {},
) {
  return planRefusalMove({
    entries,
    tried: new Set(options.tried),
    authorModels: options.authors ?? [],
    hasHeadroom: (candidate) => !(options.full ?? []).includes(candidate.id),
    isSameModel: isSameTeamModel,
    isConsented: (candidate) => (options.consented ?? []).includes(candidate.id),
    isUnattended: options.isUnattended ?? false,
  })
}

describe('planRefusalMove (D261)', () => {
  it('takes the role order, skips tried, full and authoring entries, and runs out', () => {
    const role = [entry('a', 'model-a'), entry('b', 'model-b'), entry('c', 'model-c')]
    expect(plan(role, { tried: ['a'] })).toEqual({
      kind: 'move',
      entry: role[1],
      isAskNeeded: false,
    })
    // No loop: an entry that already refused this task never comes back.
    expect(plan(role, { tried: ['a', 'b', 'c'] })).toEqual({ kind: 'exhausted' })
    // Live headroom: a full entry is passed over for the next one.
    expect(plan(role, { tried: ['a'], full: ['b'] })).toEqual({
      kind: 'move',
      entry: role[2],
      isAskNeeded: false,
    })
    // D103: a review never goes to the model that wrote the work.
    expect(plan(role, { tried: ['a'], authors: ['model-b'] })).toEqual({
      kind: 'move',
      entry: role[2],
      isAskNeeded: false,
    })
    expect(plan(role, { tried: ['a'], authors: ['model-b', 'model-c'] })).toEqual({
      kind: 'exhausted',
    })
  })

  it('asks D48 before an unconsented paid entry, and an unattended run stops there', () => {
    const role = [entry('a', 'model-a'), entry('paid', 'model-paid', 'key')]
    expect(plan(role, { tried: ['a'] })).toEqual({
      kind: 'move',
      entry: role[1],
      isAskNeeded: true,
    })
    expect(plan(role, { tried: ['a'], isUnattended: true })).toEqual({
      kind: 'cannotAsk',
      entry: role[1],
    })
    // Consent the task already holds is not asked again, attended or not.
    expect(plan(role, { tried: ['a'], consented: ['paid'], isUnattended: true })).toEqual({
      kind: 'move',
      entry: role[1],
      isAskNeeded: false,
    })
  })
})
