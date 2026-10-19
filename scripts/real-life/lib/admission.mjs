// The hard budget a matrix gives a terminal run, and how a Meta turn is
// read back before it is sent.
//
// `exec` holds a request's worst case against `--max-budget-usd` before it
// sends: the model's whole output limit at the model's price. It has no
// option that lowers it, it does not say how much it needs, and a budget
// below it is turned away with nothing sent. That refusal is not free in the
// product's own books: the run's reservation stays in the product's daily
// ledger for the rest of the day (measured on 0.18.2: two refusals of a dear
// model fill the default $5.00 day, and every later run is stopped unsent).
//
// So a matrix does not feel for a model's budget with refusals. It gives
// every turn the most `exec` accepts, which the product never turns away,
// and it sets the product's own daily budget in its new home to the
// product's maximum (lib/home.mjs), as a person asking hundreds of models
// in one day would. What a run spends is bounded by its request cap and by
// the run's own stops.
export const MATRIX_ADMIT_USD = '20.00'
// The most the product lets a day's budget be.
export const MATRIX_DAILY_BUDGET_USD = 500

// One refusal is still asked for, before every turn on a route to Meta's own
// models: a budget of one millionth of a dollar, under which nothing can be
// sent, shows which model the product would run. The turn itself is sent
// only when that is the route's model.
export const READ_BACK_USD = '0.000001'

/** Whether the product turned a run away for its budget before it sent anything. */
export const isTurnedAwayUnsent = (turn) =>
  turn.result?.status === 'budget_exceeded' &&
  turn.result.usage?.requests === 0 &&
  (turn.result.ledger?.lastResponse ?? null) === null

/**
The model the product says it runs, in what it printed before any request:
its `start` line, or the session's model as it was last announced.
@param {readonly object[]} events the lines `exec --output jsonl` printed
@returns {string | undefined}
*/
export function modelNamed(events) {
  const started = events.findLast((event) => event.type === 'start')?.model
  return typeof started === 'string'
    ? started
    : events
        .toReversed()
        .map((event) => (event.update?.configOptions ?? []).find((one) => one.id === 'model'))
        .map((option) => option?.currentValue)
        .find((value) => typeof value === 'string')
}
