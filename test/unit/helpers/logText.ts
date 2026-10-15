// Everything a fake log channel was told, one line per call, for tests that
// check what reached the log (M50).

import type { FakeLogOutputChannel } from './fakes'

export function logLines(log: FakeLogOutputChannel): readonly string[] {
  return [log.trace, log.info, log.warn, log.error].flatMap((level) =>
    level.mock.calls.map((call) => call.map(String).join(' ')),
  )
}
