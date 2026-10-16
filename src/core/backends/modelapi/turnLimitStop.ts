// A person-set turn limit whose summary request fails (lane LIMITSFIX, F5,
// D113): the turn still ends cleanly as the limit, so the replay must leave
// exactly as valid as it was before the summary was asked. The summary
// instruction leaves it, and any call a half-finished reply left without an
// output gets one, so the next message replays without a provider 400.

import type { InputItem } from './schemas'

interface ReplayEntry {
  readonly item: InputItem
}

export function repairAfterFailedSummary<T extends ReplayEntry>(
  replay: readonly T[],
  instruction: T,
  answerCall: (callId: string) => T,
): T[] {
  const start = replay.indexOf(instruction)
  if (start === -1) return [...replay]
  const after = replay.slice(start + 1)
  const answered = new Set(
    after.flatMap((entry) =>
      entry.item.type === 'function_call_output' ? [entry.item.call_id] : [],
    ),
  )
  const unanswered = after.flatMap((entry) =>
    entry.item.type === 'function_call' && !answered.has(entry.item.call_id)
      ? [answerCall(entry.item.call_id)]
      : [],
  )
  return [...replay.slice(0, start), ...after, ...unanswered]
}
