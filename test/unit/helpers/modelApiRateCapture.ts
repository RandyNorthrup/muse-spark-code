import { readFileSync } from 'node:fs'
import * as z from 'zod/mini'

/** U12's scrubbed captured headers, validated before either pacing suite uses them. */
export function readRateCaptures() {
  const captured = readFileSync(
    new URL('../../fixtures/m106/u12-rate-headers.json', import.meta.url),
    'utf8',
  )
  return z
    .array(z.object({ headers: z.record(z.string(), z.string()) }))
    .parse(JSON.parse(captured))
}
