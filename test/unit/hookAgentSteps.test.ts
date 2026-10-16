// D121 (NOLIMITS1 A13): the hook agent loops over its read-only tools until
// the model stops calling them — the removed 5-step ceiling was invented and
// no provider documents one. This pins the removal contract over the real
// source (inventory-test style): a reintroduced step ceiling fails here.
// A live multi-step run cannot be a unit test: it would need a stand-in
// for the model client, which the repo forbids.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('hook agent steps (D121 A13)', () => {
  it('has no step ceiling in the agent loop or the constants', () => {
    for (const file of [
      'src/core/backends/modelapi/hookModelEntry.ts',
      'src/shared/constants.ts',
    ]) {
      expect(readFileSync(file, 'utf8')).not.toContain('HOOK_AGENT_MAX_STEPS')
    }
  })
  it('still refuses tool calls from a prompt handler, which has no tools', () => {
    expect(readFileSync('src/core/backends/modelapi/hookModelEntry.ts', 'utf8')).toContain(
      'the hook model exceeded its tool allowance',
    )
  })
})
