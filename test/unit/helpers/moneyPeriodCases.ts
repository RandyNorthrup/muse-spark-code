// Exact monetary period changes, including amounts outside double range and
// a whole-percent rounding boundary that a double cannot distinguish.
export const MONEY_PERIOD_CASES = [
  ['0.0000000001', '0.00000000001', 900],
  ['0.00000000001', '0.0000000001', -90],
  ['1e-400', '1e-401', 900],
  ['1e400', '1e399', 900],
  ['1.004999999999999999999', '1', 0],
  ['1.004', '1', 0],
  ['0.996', '1', 0],
  ['0.99501', '1', 0],
  ['0.995000000000000000001', '1', 0],
  ['1.005', '1', 1],
  ['0.995', '1', -1],
] as const
