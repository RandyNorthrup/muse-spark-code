/** The reducer owns slots and returned bodies until dispatch transfers ownership. */
export interface ReportAdmissionState<G> {
  readonly current: {
    readonly generation: G
    readonly phase: 'admission' | 'transport' | 'dispatch' | 'releasing'
    readonly observedAt: string | null
    readonly response: Response | null
  } | null
  readonly waiting: readonly G[]
  readonly limitedUntil: number | null
}
export type ReportAdmissionEvent<G> =
  | {
      readonly type: 'requested' | 'transportFailed' | 'aborted' | 'timedOut' | 'released'
      readonly generation: G
    }
  | {
      readonly type: 'admitted'
      readonly generation: G
      readonly observedAt: string
      readonly refusal: string | null
    }
  | { readonly type: 'transportReturned'; readonly generation: G; readonly response: Response }
  | {
      readonly type: 'dispatched'
      readonly generation: G
      readonly limitedUntil: number | null
    }
export type ReportAdmissionEffect<G> =
  | { readonly type: 'startTransport' | 'release'; readonly generation: G }
  | {
      readonly type: 'cancelBody' | 'dispatch'
      readonly generation: G
      readonly response: Response
    }
  | { readonly type: 'refuse'; readonly generation: G; readonly reason: string | number }

export function reportAdmissionStep<G>(
  state: ReportAdmissionState<G>,
  event: ReportAdmissionEvent<G>,
): { state: ReportAdmissionState<G>; effects: readonly ReportAdmissionEffect<G>[] } {
  const generation = event.generation
  const current = state.current
  const effects: ReportAdmissionEffect<G>[] = []
  if (event.type === 'requested') {
    if (current?.generation === generation || state.waiting.includes(generation))
      return { state, effects }
    if (current === null)
      return {
        state: {
          ...state,
          current: { generation, phase: 'admission', observedAt: null, response: null },
        },
        effects: [{ type: 'startTransport', generation }],
      }
    return { state: { ...state, waiting: [...state.waiting, generation] }, effects }
  }
  if (current?.generation !== generation) {
    if (event.type === 'transportReturned')
      effects.push({ type: 'cancelBody', generation, response: event.response })
    if (
      (event.type === 'aborted' || event.type === 'timedOut') &&
      state.waiting.includes(generation)
    ) {
      effects.push({ type: 'refuse', generation, reason: 'source-deadline' })
      return {
        state: { ...state, waiting: state.waiting.filter((item) => item !== generation) },
        effects,
      }
    }
    return { state, effects }
  }
  const retire = (reason: string | number) => ({
    state: { ...state, current: { ...current, phase: 'releasing' as const, response: null } },
    effects: [
      ...(current.response === null
        ? []
        : [
            {
              type: 'cancelBody',
              generation,
              response: current.response,
            } satisfies ReportAdmissionEffect<G>,
          ]),
      { type: 'refuse', generation, reason },
      { type: 'release', generation },
    ] satisfies ReportAdmissionEffect<G>[],
  })
  switch (event.type) {
    case 'admitted': {
      if (current.phase !== 'admission') break
      if (event.refusal !== null) return retire(event.refusal)
      if (state.limitedUntil !== null && state.limitedUntil > Date.parse(event.observedAt))
        return retire(state.limitedUntil)
      return {
        state: {
          ...state,
          current: { ...current, phase: 'transport', observedAt: event.observedAt },
        },
        effects,
      }
    }
    case 'transportReturned': {
      if (current.phase !== 'transport') {
        effects.push({ type: 'cancelBody', generation, response: event.response })
        break
      }
      return {
        state: { ...state, current: { ...current, phase: 'dispatch', response: event.response } },
        effects: [{ type: 'dispatch', generation, response: event.response }],
      }
    }
    case 'dispatched': {
      if (current.phase !== 'dispatch') break
      return {
        state: {
          ...state,
          limitedUntil: event.limitedUntil ?? state.limitedUntil,
          current: { ...current, phase: 'releasing', response: null },
        },
        effects: [{ type: 'release', generation }],
      }
    }
    case 'aborted':
    case 'timedOut':
    case 'transportFailed': {
      if (current.phase !== 'releasing')
        return retire(event.type === 'transportFailed' ? 'source-failed' : 'source-deadline')
      break
    }
    case 'released': {
      if (current.phase !== 'releasing') break
      const [next, ...waiting] = state.waiting
      return {
        state: {
          ...state,
          waiting,
          current:
            next === undefined
              ? null
              : { generation: next, phase: 'admission', observedAt: null, response: null },
        },
        effects: next === undefined ? [] : [{ type: 'startTransport', generation: next }],
      }
    }
  }
  return { state, effects }
}
