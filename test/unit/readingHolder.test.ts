// M116 (D219): the sync cells behind the playbook's sync ports. A failed
// refresh clears to unknown rather than keeping a stale reading, and the
// hosts' admission pauses local checks only at the paused level: unknown
// never pauses work.
import { describe, expect, it } from 'vitest'
import {
  createCapacityAdmission,
  createReadingHolder,
} from '../../src/core/orchestration/playbook/readingHolder'
import {
  resourceStatusSchema,
  type ResourceLevel,
  type ResourceStatus,
} from '../../src/shared/resources'

const status = (level: ResourceLevel): ResourceStatus =>
  resourceStatusSchema.parse({
    level,
    sample: null,
    settings: {},
    queued: [],
    overrideUntilMs: null,
  })

describe('createReadingHolder', () => {
  it('serves unknown until the first reading lands', () => {
    const holder = createReadingHolder<ResourceStatus>()
    expect(holder.get()).toBeUndefined()
    holder.set(status('normal'))
    expect(holder.get()?.level).toBe('normal')
  })

  it('takes the read value on refresh, or unknown when the read finds nothing', async () => {
    const holder = createReadingHolder<ResourceStatus>()
    await expect(holder.refresh(() => Promise.resolve(status('throttle')))).resolves.toEqual({
      ok: true,
    })
    expect(holder.get()?.level).toBe('throttle')
    await expect(holder.refresh(() => Promise.resolve(undefined))).resolves.toEqual({ ok: true })
    expect(holder.get()).toBeUndefined()
  })

  it('takes a sync read too, and clears when it throws', async () => {
    const holder = createReadingHolder<ResourceStatus>()
    await expect(holder.refresh(() => status('normal'))).resolves.toEqual({ ok: true })
    expect(holder.get()?.level).toBe('normal')
    const failure = new Error('stale port')
    const result = await holder.refresh(() => {
      throw failure
    })
    expect(result).toEqual({ ok: false, cause: failure })
    expect(holder.get()).toBeUndefined()
  })

  it('clears to unknown on a failed refresh and carries the cause home', async () => {
    const holder = createReadingHolder<ResourceStatus>()
    holder.set(status('pause'))
    const failure = new Error('governor unreachable')
    const result = await holder.refresh(() => Promise.reject(failure))
    expect(result).toEqual({ ok: false, cause: failure })
    expect(holder.get()).toBeUndefined()
  })
})

describe('createCapacityAdmission', () => {
  const check = { id: 'quality', heavy: false, fullGate: false }
  const local = { kind: 'local' } as const
  const worker = { kind: 'worker', id: 'entry-1' } as const
  const ci = { kind: 'ci' } as const

  it.each(['normal', 'throttle', 'relocate'] as const)('admits local checks at %s', (level) => {
    const holder = createReadingHolder<ResourceStatus>()
    holder.set(status(level))
    expect(createCapacityAdmission(holder).admit(check, local)).toBe(true)
  })

  it('refuses local checks only at the paused level', () => {
    const holder = createReadingHolder<ResourceStatus>()
    holder.set(status('pause'))
    expect(createCapacityAdmission(holder).admit(check, local)).toBe(false)
  })

  it('never pauses work for an unknown reading', () => {
    const holder = createReadingHolder<ResourceStatus>()
    expect(createCapacityAdmission(holder).admit(check, local)).toBe(true)
  })

  it('admits worker and CI targets at any reading: their own side governs them', () => {
    const holder = createReadingHolder<ResourceStatus>()
    holder.set(status('pause'))
    const admission = createCapacityAdmission(holder)
    expect(admission.admit(check, worker)).toBe(true)
    expect(admission.admit(check, ci)).toBe(true)
  })
})
