// The run's own fixed numbers and words.

// The hard cap each `exec` is given outside a matrix. The product holds a
// request's worst case (the model's whole output limit at the model's
// price) against it before it sends, so a cap near what a small turn really
// costs refuses every turn. A matrix gives the most `exec` accepts
// (lib/admission.mjs).
export const EXEC_ADMIT_USD = '3.00'
// One scenario on one route by one surface ends within this, or fails.
export const CELL_TIMEOUT_MS = 300_000
// Where a scenario runs when it does not say (lower runs earlier).
export const DEFAULT_ORDER = 50
// The scenario whose failure on a route ends that route's paid scenarios.
export const FIRST_TURN = 'plain-turn'
// What a matrix asks of every model, in this order, by the terminal agent.
export const MATRIX_SCENARIOS = Object.freeze([FIRST_TURN, 'tool-write'])
export const MATRIX_SURFACE = 'exec'
// A provider whose first models all fail with no usage reported has an
// account or a key that does not work: its other models are not asked.
export const BARREN_MODELS = 3
// A matrix whose plain turns send nothing this many times in a row has met
// a stop of the product's own: nothing more is started.
export const UNSENT_IN_A_ROW = 3
export const EXIT_FAILED = 1
export const EXIT_USAGE = 2
