// A host's admission refusal for one scheduled fire (M88 lane C, D67
// item 15): the dispatch settles as refused with the sentence, never
// failed with a generic reason. The brand is structural on purpose: the
// thrower runs in the activation bundle and the catcher in the lazy
// schedules bundle, so instanceof cannot cross (separate cjs builds).
// The sentence is always fixed UI text from the refusing host.
const SCHEDULE_DISPATCH_REFUSAL_CODE = 'scheduleDispatchRefusal'

export class ScheduleDispatchRefusal extends Error {
  public readonly refusalCode = SCHEDULE_DISPATCH_REFUSAL_CODE
  public readonly sentence: string

  constructor(sentence: string) {
    super(sentence)
    this.sentence = sentence
  }
}

export function scheduleDispatchRefusal(sentence: string): ScheduleDispatchRefusal {
  return new ScheduleDispatchRefusal(sentence)
}

export function isScheduleDispatchRefusal(error: unknown): error is ScheduleDispatchRefusal {
  return (
    error instanceof Error &&
    (error as { refusalCode?: unknown }).refusalCode === SCHEDULE_DISPATCH_REFUSAL_CODE &&
    typeof (error as { sentence?: unknown }).sentence === 'string'
  )
}
