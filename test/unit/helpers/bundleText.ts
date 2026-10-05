// What a lazily loaded bundle's shipped text carries (PLAN.md D6): the
// shared English fallback is required, not copied; and of the model text,
// only the block it reads. One object is carried whole, so a bundle that
// reads any key of MODEL_TEXT, even one activation reads too, carries every
// key and value of it. esbuild keeps property names, and a value is found by
// its longest run that the bundle writes as it stands.

import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { MODEL_TEXT, UI_TEXT } from '../../../src/shared/constants'
import type { BuiltBundle } from './lazyBundles'

// A shorter run of plain text could occur in a bundle by chance.
const MIN_PLAIN_RUN = 12

/**
 * The longest run of `value` that a bundle writes as it stands: no quote,
 * backslash, `$`, line break or non-ASCII character, which esbuild may
 * escape or wrap differently.
 */
function plainRun(value: string): string {
  let longest = ''
  for (const run of value.split(/[^ -~]|["'`\\$]/u)) {
    if (run.length > longest.length) {
      longest = run
    }
  }
  return longest
}

/**
 * The cases every such bundle meets; `ownText` is a value of the block it
 * reads, found the same way as a control.
 */
export function shippedTextCases(built: BuiltBundle, ownText: string): void {
  it('loads the shared English fallback without copying it', () => {
    const text = readFileSync(built.file, 'utf8')
    expect(text).toContain('require("./uiText.js")')
    expect(text).not.toContain(UI_TEXT.crashTitle)
  })

  it('carries its own model text and no key and none of the words of MODEL_TEXT', () => {
    const text = readFileSync(built.file, 'utf8')
    expect(text).toContain(plainRun(ownText))
    for (const [key, value] of Object.entries(MODEL_TEXT)) {
      expect(text, key).not.toMatch(new RegExp(String.raw`(?:^|[\s{,])${key}:`, 'mu'))
      const run = plainRun(value)
      if (run.length >= MIN_PLAIN_RUN) {
        expect(text, key).not.toContain(run)
      }
    }
  })
}
