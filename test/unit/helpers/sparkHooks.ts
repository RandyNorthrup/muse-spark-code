// One spark-hooks.json group, as lane I's importer writes it, parsed for the
// project the way the session loads it (M91 lane W).

import { expect } from 'vitest'
import { parseForeignHooks, type HookDefinition } from '../../../src/core/backends/modelapi/hooks'

/** The group's imported hooks; the parse must not warn. */
export function importedHooks(
  event: string,
  group: Record<string, unknown>,
): readonly HookDefinition[] {
  const parsed = parseForeignHooks(
    JSON.stringify({ hooks: { [event]: [group] } }),
    'project',
    'linux',
  )
  expect(parsed.warnings).toEqual([])
  return parsed.hooks
}
