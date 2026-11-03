// D261: who answers a refused team task or solo chat turn next. Real code
// only: the selection functions the host runs, over plain entries in role
// order, with the product's own same-model rule.
import { describe, expect, it } from 'vitest'
import {
  chatRefusalRole,
  planRefusalMove,
  refusalAccountOf,
  type RefusalAccount,
  type RefusalMoveEntry,
} from '../../src/core/team/teamPool'
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
    readonly refused?: RefusalAccount
    readonly accounts?: Readonly<Record<string, RefusalAccount>>
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
    refusedAccount: options.refused,
    accountOf: (candidate) => options.accounts?.[candidate.id],
  })
}

describe('planRefusalMove (D261)', () => {
  it('takes the role order, skips tried, full and authoring entries, and runs out', () => {
    const role = [entry('a', 'model-a'), entry('b', 'model-b'), entry('c', 'model-c')]
    const tried = { entryId: 'a', reason: 'tried' }
    expect(plan(role, { tried: ['a'] })).toEqual({
      kind: 'move',
      entry: role[1],
      isAskNeeded: false,
      skipped: [tried],
    })
    // No loop: an entry that already refused this task never comes back.
    expect(plan(role, { tried: ['a', 'b', 'c'] })).toMatchObject({ kind: 'exhausted' })
    // Live headroom: a full entry is passed over for the next one.
    expect(plan(role, { tried: ['a'], full: ['b'] })).toEqual({
      kind: 'move',
      entry: role[2],
      isAskNeeded: false,
      skipped: [tried, { entryId: 'b', reason: 'noHeadroom' }],
    })
    // D103: a review never goes to the model that wrote the work.
    expect(plan(role, { tried: ['a'], authors: ['model-b'] })).toEqual({
      kind: 'move',
      entry: role[2],
      isAskNeeded: false,
      skipped: [tried, { entryId: 'b', reason: 'author' }],
    })
    expect(plan(role, { tried: ['a'], authors: ['model-b', 'model-c'] })).toMatchObject({
      kind: 'exhausted',
    })
  })

  it('asks D48 before an unconsented paid entry, and an unattended run stops there', () => {
    const role = [entry('a', 'model-a'), entry('paid', 'model-paid', 'key')]
    expect(plan(role, { tried: ['a'] })).toMatchObject({
      kind: 'move',
      entry: role[1],
      isAskNeeded: true,
    })
    expect(plan(role, { tried: ['a'], isUnattended: true })).toMatchObject({
      kind: 'cannotAsk',
      entry: role[1],
    })
    // Consent the task already holds is not asked again, attended or not.
    expect(plan(role, { tried: ['a'], consented: ['paid'], isUnattended: true })).toMatchObject({
      kind: 'move',
      entry: role[1],
      isAskNeeded: false,
    })
  })

  it('never moves to another account of the refusing provider, and names the skip', () => {
    const role = [
      entry('a', 'model-a'),
      entry('twin', 'model-a'),
      entry('sibling', 'model-s'),
      entry('elsewhere', 'model-e'),
    ]
    const refused = { provider: 'p', account: 'one' }
    const accounts = {
      a: refused,
      twin: { provider: 'p', account: 'two' },
      sibling: { provider: 'p', account: 'one' },
      elsewhere: { provider: 'q', account: 'one' },
    }
    // Another model on the same account may take it; another account may not.
    expect(plan(role, { tried: ['a'], refused, accounts })).toEqual({
      kind: 'move',
      entry: role[2],
      isAskNeeded: false,
      skipped: [
        { entryId: 'a', reason: 'tried' },
        { entryId: 'twin', reason: 'otherAccount' },
      ],
    })
    // Another provider may take it, whatever its account.
    expect(plan(role, { tried: ['a', 'sibling'], refused, accounts })).toMatchObject({
      kind: 'move',
      entry: role[3],
    })
    expect(plan(role, { tried: ['a', 'sibling', 'elsewhere'], refused, accounts })).toEqual({
      kind: 'exhausted',
      skipped: [
        { entryId: 'a', reason: 'tried' },
        { entryId: 'twin', reason: 'otherAccount' },
        { entryId: 'sibling', reason: 'tried' },
        { entryId: 'elsewhere', reason: 'tried' },
      ],
    })
  })
})

describe('refusalAccountOf (D261)', () => {
  const services: Record<string, string> = { work: 'acme', home: 'acme' }
  const serviceOf = (record: string) => services[record]
  it('reads the record from the model reference, and its provider from the record', () => {
    const engine = (model: string, provider?: string) =>
      refusalAccountOf({ kind: 'engine', agentId: 'x', model, provider }, serviceOf)
    expect(engine('work/model-a')).toEqual({ provider: 'acme', account: 'work' })
    expect(engine('home/model-a')).toEqual({ provider: 'acme', account: 'home' })
    // A record nobody maps is its own provider; a bare model is the built-in one.
    expect(engine('solo/model-a')).toEqual({ provider: 'solo', account: 'solo' })
    expect(engine('model-a')).toEqual({ provider: 'meta', account: 'meta' })
    expect(engine('model-a', 'work')).toEqual({ provider: 'acme', account: 'work' })
    // A subscription or an agent CLI runs under its own sign-in.
    expect(
      refusalAccountOf({ kind: 'museCode', agentId: 'museCode', model: 'm' }, serviceOf),
    ).toEqual({ provider: 'museCode', account: 'museCode' })
  })
})

/** The chat runs `chat-model`; an `isDefault` entry runs whatever the chat runs. */
function chat(
  roles: readonly { role: string; entries: (RefusalMoveEntry & { isDefault?: boolean })[] }[],
  assignments: Readonly<Record<string, string>> = {},
) {
  return chatRefusalRole({
    roles,
    mainRoleOf: (id) => assignments[id],
    isRefuser: (candidate) => {
      if (candidate.isDefault === true) return { isDefault: true }
      return candidate.agent.model === 'chat-model' ? { isDefault: false } : undefined
    },
  })
}

describe('chatRefusalRole (D261, D212)', () => {
  const mine = entry('mine', 'chat-model')
  const other = entry('other', 'model-o')
  const slot = { ...entry('slot', 'chat-model'), isDefault: true }

  it('finds the role that holds the agent, or its assigned main role, and tries every copy of it', () => {
    const review = { role: 'review', entries: [slot, other] }
    const coding = { role: 'coding', entries: [mine, slot, other] }
    // An entry naming the agent outright is chosen before Default.
    const found = chat([review, coding])
    expect(found?.role.role).toBe('coding')
    expect(found?.refuser).toBe(mine)
    expect([...(found?.tried ?? [])]).toEqual(['mine', 'slot'])
    // The assignment's main role wins over where the list holds it.
    expect(chat([review, coding], { mine: 'review' })?.role.role).toBe('review')
    // Default alone still places the chat in its role.
    expect(chat([review])?.refuser).toBe(slot)
    // No role holds the agent: the refusal stands.
    expect(chat([{ role: 'review', entries: [other] }])).toBeUndefined()
  })
})
