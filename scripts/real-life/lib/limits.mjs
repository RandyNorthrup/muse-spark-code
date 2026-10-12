// The run's own fixed numbers and words.

// The hard cap each `exec` is given. The product holds a request's worst
// case (a full context window at the model's price) against it before it
// sends, so a cap near what a small turn really costs refuses every turn.
export const EXEC_ADMIT_USD = '3.00'
// One scenario on one route by one surface ends within this, or fails.
export const CELL_TIMEOUT_MS = 300_000
// Where a scenario runs when it does not say (lower runs earlier).
export const DEFAULT_ORDER = 50
// The scenario whose failure on a route ends that route's paid scenarios.
export const FIRST_TURN = 'plain-turn'
export const EXIT_FAILED = 1
export const EXIT_USAGE = 2
