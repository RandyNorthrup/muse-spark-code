// Node 20 emulation for exact-money reads (M121 P2-1): Node 20's
// two-argument JSON reviver carries no source text. Dropping every reviver
// argument from `JSON.parse` emulates it; a reader that still refuses an
// unrepresentable literal does not depend on the reviver.
import { vi } from 'vitest'

export function withholdReviverSource(): () => void {
  const realParse = JSON.parse.bind(JSON)
  const spy = vi
    .spyOn(JSON, 'parse')
    .mockImplementation(
      ((text: string): unknown => realParse(text) as unknown) as typeof JSON.parse,
    )
  return () => {
    spy.mockRestore()
  }
}
