import { readFileSync } from 'node:fs'
import * as z from 'zod/mini'
import type { TabHookEvent } from '../../../src/core/tab/tabHooks'

const fixtures = z
  .array(
    z.object({
      event: z.string(),
      direction: z.string(),
      json: z.optional(z.unknown()),
    }),
  )
  .parse(JSON.parse(readFileSync('test/fixtures/hookFormats/docs/cursor.json', 'utf8')))

/** The existing M91 saved-page examples, with no invented wire fields. */
export function cursorTabExample(event: TabHookEvent): Record<string, unknown> {
  const fixture = fixtures.find((entry) => entry.event === event && entry.direction === 'stdin')
  return z.record(z.string(), z.unknown()).parse(fixture?.json)
}
