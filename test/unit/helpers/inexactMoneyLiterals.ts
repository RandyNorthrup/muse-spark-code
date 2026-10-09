// Foreign/edited v1 dollars: none has the decimal spelling of its parsed
// finite, non-negative double. Shared by the parser and real-store probes.
export const INEXACT_MONEY_LITERALS = [
  '0.123456789012345678901',
  '-1e-324',
  '1e-999999999999999999999',
  '0e-999999999999999999999',
  '-0',
  '-0.0',
  '-0e1',
  '1e400',
  ...[324, 325, 400, 999].flatMap((exponent) => [
    `1e-${String(exponent)}`,
    `-1e-${String(exponent)}`,
    `1e${String(exponent)}`,
  ]),
  ...[20, 40, 80].map((places) => `0.1${'0'.repeat(places)}1`),
]
