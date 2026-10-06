// Model calls shared by the suites that script `then_run` against
// `ModelApiHost` (the golden requests and the kept shell directory).

import type { ScriptedCall } from './fakeModelApi'

/** The model's `edit_file` call `e1`: `one` to `two` in owned.ts, then `echo then`. */
export function editThenRunCall(): ScriptedCall {
  return {
    name: 'edit_file',
    arguments: JSON.stringify({
      path: 'owned.ts',
      find: 'one',
      replace: 'two',
      then_run: 'echo then',
    }),
    callId: 'e1',
  }
}
