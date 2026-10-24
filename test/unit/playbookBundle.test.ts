// The lazy playbook bundle's loader accepts the real entry and rejects a
// module missing any export, so a half-written dist file never loads. The
// key list pins every export: a new one fails here until the predicate
// checks it too.
import { describe, expect, it } from 'vitest'
import { isPlaybookBundle } from '../../src/runtime/playbook/playbookBundle'
import * as entry from '../../src/runtime/playbook/playbookEntry'

const EXPORTS = [
  'parsePlaybookCommand',
  'createPlaybookSurface',
  'runPlaybookCommand',
  'runPlaybookCli',
  'runPlaybookCheckCli',
] as const

describe('isPlaybookBundle', () => {
  it('accepts the entry and rejects a module missing any export', () => {
    expect(isPlaybookBundle(entry)).toBe(true)
    expect(new Set(Object.keys(entry))).toEqual(new Set<string>(EXPORTS))
    for (const missing of EXPORTS) {
      const { [missing]: _dropped, ...partial } = { ...entry }
      expect(_dropped).toBeTypeOf('function')
      expect(isPlaybookBundle(partial), missing).toBe(false)
    }
    expect(isPlaybookBundle({ ...entry, runPlaybookCheckCli: 'a function' })).toBe(false)
    expect(isPlaybookBundle(null)).toBe(false)
  })
})
