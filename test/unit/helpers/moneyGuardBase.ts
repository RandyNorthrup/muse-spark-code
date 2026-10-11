import * as z from 'zod/mini'

// Fixture base for the money-guard re-export drill: a plain numeric schema,
// as if it lived in another module of the production tree.
export const externalNumeric = z.number().check(z.nonnegative())
