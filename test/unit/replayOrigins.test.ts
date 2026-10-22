import { describe, expect, it } from 'vitest'
import { replayOrigins, replayProducer } from '../../src/core/backends/modelapi/modelPolicy'
import type { StoredReplayItem } from '../../src/core/backends/modelapi/sessionStore'

function callEntry(turnId: string, callId: string, producer: string | undefined): StoredReplayItem {
  return {
    turnId,
    ...(producer !== undefined && { producer: replayProducer(producer) }),
    item: {
      type: 'function_call',
      id: `fc_${callId}`,
      call_id: callId,
      name: 'read_file',
      arguments: '{"path":"a"}',
    },
  }
}

describe('replayOrigins (M101-REPLAY-ORIGIN)', () => {
  it('names the producing model ref per replayed call id', () => {
    expect(
      replayOrigins([
        callEntry('t1', 'call_same', 'probe/model-a'),
        callEntry('t2', 'call_old', 'probe/model-b'),
        callEntry('t2', 'call_meta', 'muse-spark-1.3'),
      ]),
    ).toEqual({
      call_same: 'probe/model-a',
      call_old: 'probe/model-b',
      call_meta: 'muse-spark-1.3',
    })
  })

  it('leaves calls without a recorded producer to the request model default', () => {
    const entries: StoredReplayItem[] = [
      callEntry('t1', 'call_old', undefined),
      {
        turnId: 't1',
        producer: replayProducer('probe/model-a'),
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'go' }],
        },
      },
    ]
    expect(replayOrigins(entries)).toBeUndefined()
  })
})
