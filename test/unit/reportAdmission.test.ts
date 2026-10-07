import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import { type ReportNetworkTransport } from '../../src/core/reporting/sources/cache'
import { networkContext, networkRig } from './helpers/reportNetwork'
import {
  reportAdmissionStep,
  type ReportAdmissionState,
  type ReportAdmissionEvent,
  type ReportAdmissionEffect,
} from '../../src/core/reporting/sources/admission'

function admissionModel() {
  let state: ReportAdmissionState<symbol> = { current: null, waiting: [], limitedUntil: null }
  const effects: ReportAdmissionEffect<symbol>[] = []
  const published: symbol[] = []
  const cancelled: Response[] = []
  const released: symbol[] = []
  let cursor = 0
  const send = (event: ReportAdmissionEvent<symbol>) => {
    const result = reportAdmissionStep(state, event)
    state = result.state
    effects.push(...result.effects)
    return result.effects
  }
  const settle = () => {
    while (cursor < effects.length) {
      const effect = effects[cursor++]!
      if (effect.type === 'cancelBody') cancelled.push(effect.response)
      if (effect.type !== 'release') {
        continue
      }

      released.push(effect.generation)
      send({ type: 'released', generation: effect.generation })
    }
  }
  const acknowledge = (generation: symbol, limitedUntil: number | null = null) => {
    const output = send({ type: 'dispatched', generation, limitedUntil })
    if (output.some((effect) => effect.type === 'release')) published.push(generation)
  }
  const admit = (generation: symbol) =>
    send({
      type: 'admitted',
      generation,
      observedAt: networkContext().asOf,
      refusal: null,
    })
  return {
    send,
    settle,
    acknowledge,
    admit,
    effects,
    published,
    cancelled,
    released,
    state: () => state,
  }
}

const boundaries = [
  'before admission',
  'during transport',
  'after transport',
  'during dispatch',
  'after dispatch before release',
  'after release',
] as const
const interleavings = boundaries.flatMap((boundary) =>
  (['aborted', 'timedOut'] as const).flatMap((stop) =>
    (['response', 'failure'] as const).flatMap((late) =>
      (
        [
          'before successor admission',
          'during successor transport',
          'after successor release',
        ] as const
      ).map((successor) => ({ boundary, stop, late, successor })),
    ),
  ),
)

describe('report admission reducer interleaving model', () => {
  it('ignores duplicate requests and out-of-phase acknowledgements', () => {
    const model = admissionModel()
    const generation = Symbol('request')
    const waiter = Symbol('waiter')
    model.send({ type: 'requested', generation })
    model.send({ type: 'requested', generation })
    model.send({ type: 'requested', generation: waiter })
    model.send({ type: 'requested', generation: waiter })
    expect(model.state().waiting).toEqual([waiter])
    const pending = model.state()
    model.acknowledge(generation)
    model.send({ type: 'released', generation })
    const early = new Response('early')
    model.send({ type: 'transportReturned', generation, response: early })
    expect(model.state()).toBe(pending)
    model.admit(generation)
    const admitted = model.state()
    model.admit(generation)
    model.acknowledge(generation)
    expect(model.state()).toBe(admitted)
    model.send({ type: 'transportReturned', generation, response: new Response('accepted') })
    const returned = model.state()
    model.admit(generation)
    const duplicate = new Response('duplicate')
    model.send({ type: 'transportReturned', generation, response: duplicate })
    expect(model.state()).toBe(returned)
    model.acknowledge(generation)
    const dispatching = model.state()
    for (const type of ['aborted', 'timedOut', 'transportFailed'] as const)
      model.send({ type, generation })
    model.acknowledge(generation)
    expect(model.state()).toBe(dispatching)
    model.settle()
    expect(model.cancelled).toEqual([early, duplicate])
    expect(model.published).toEqual([generation])
    expect(model.released).toEqual([generation])
    expect(model.state().current?.generation).toBe(waiter)
    model.send({ type: 'aborted', generation: waiter })
    model.settle()
  })

  it.each(interleavings)(
    '$stop $boundary × late $late $successor',
    ({ boundary, stop, late, successor }) => {
      const model = admissionModel()
      const old = Symbol('old')
      const next = Symbol('next')
      const response = new Response('original')
      const lateResponse = new Response('late')
      model.send({ type: 'requested', generation: old })
      model.send({ type: 'requested', generation: next })
      if (boundary !== 'before admission') {
        model.admit(old)
        if (boundary !== 'during transport')
          model.send({ type: 'transportReturned', generation: old, response })
      }
      if (boundary === 'during dispatch') {
        // Headers are computed before acknowledgement: computation publishes nothing.
        expect(model.state().limitedUntil).toBeNull()
        expect(model.published).toEqual([])
      } else if (boundary === 'after dispatch before release' || boundary === 'after release') {
        model.acknowledge(old)
        if (boundary === 'after release') model.settle()
      }
      model.send({ type: stop, generation: old })
      model.settle()
      expect(model.released.filter((generation) => generation === old)).toHaveLength(1)
      expect(model.state().current?.generation).toBe(next)
      if (successor !== 'before successor admission') model.admit(next)
      if (successor === 'after successor release') {
        model.send({
          type: 'transportReturned',
          generation: next,
          response: new Response('current'),
        })
        model.acknowledge(next)
        model.settle()
      }
      const beforeLate = model.state()
      const beforePublication = [...model.published]
      model.send(
        late === 'response'
          ? { type: 'transportReturned', generation: old, response: lateResponse }
          : { type: 'transportFailed', generation: old },
      )
      // Replay every obsolete completion/acknowledgement against the successor.
      model.admit(old)
      model.acknowledge(old, Date.parse(networkContext().asOf) + 60_000)
      model.send({ type: 'released', generation: old })
      model.send({ type: stop, generation: old })
      model.settle()
      expect(model.state()).toEqual(beforeLate)
      expect(model.published).toEqual(beforePublication)
      expect(model.cancelled.filter((body) => body === lateResponse)).toHaveLength(
        late === 'response' ? 1 : 0,
      )
      const didDispatch =
        boundary === 'after dispatch before release' || boundary === 'after release'
      expect(model.published.filter((generation) => generation === old)).toHaveLength(
        didDispatch ? 1 : 0,
      )
      expect(model.cancelled.filter((body) => body === response)).toHaveLength(
        boundary === 'after transport' || boundary === 'during dispatch' ? 1 : 0,
      )
      expect(
        model.effects.filter((effect) => effect.type === 'dispatch' && effect.generation === old)
          .length,
      ).toBeLessThanOrEqual(1)
      if (successor !== 'after successor release') {
        model.send({ type: 'aborted', generation: next })
        model.settle()
      }
      expect(model.released.filter((generation) => generation === next)).toHaveLength(1)
      expect(model.state().current).toBeNull()
      expect(model.state().waiting).toEqual([])
    },
  )

  it.each(['aborted', 'timedOut'] as const)(
    'removes a queued %s request without releasing the owner',
    (type) => {
      const model = admissionModel()
      const owner = Symbol('owner')
      const waiter = Symbol('waiter')
      model.send({ type: 'requested', generation: owner })
      model.send({ type: 'requested', generation: waiter })
      model.send({ type, generation: waiter })
      model.settle()
      expect(model.state().current?.generation).toBe(owner)
      expect(model.state().waiting).toEqual([])
      expect(model.released).toEqual([])
      expect(model.effects).toContainEqual({
        type: 'refuse',
        generation: waiter,
        reason: 'source-deadline',
      })
    },
  )
})

describe('report response ownership across async continuations', () => {
  it.each(Array.from({ length: 12 }, (_, index) => index + 1))(
    'cancels a returned body when abort arrives after %i microtasks',
    async (depth) => {
      const controller = new AbortController()
      const cancel = vi.fn()
      const response = new Response(new ReadableStream<Uint8Array>({ cancel }))
      const transport = vi
        .fn<ReportNetworkTransport>()
        .mockImplementationOnce(() => {
          const tick = (remaining: number): void => {
            if (remaining === 0) controller.abort()
            else
              queueMicrotask(() => {
                tick(remaining - 1)
              })
          }
          tick(depth)
          return Promise.resolve(response)
        })
        .mockImplementation(() => Promise.resolve(Response.json({ value: 'recovered' })))
      const rig = networkRig({ transport })
      const schema = z.strictObject({ value: z.string() })
      const read = (signal: AbortSignal) =>
        rig.reader.read({ ...networkContext(), signal }, 'network', schema, async (query) => ({
          data: await query({ url: 'https://api.github.com/repos/fixture/repo' }, schema),
          reason: null,
        }))
      const aborted = await read(controller.signal)
      expect(aborted.record.status).toBe('unavailable')
      expect(cancel).toHaveBeenCalledOnce()
      expect(rig.storage.write).not.toHaveBeenCalled()
      const recovered = await read(new AbortController().signal)
      expect(recovered.record.status).toBe('ok')
    },
  )
})
