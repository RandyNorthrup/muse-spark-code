// The live capture of Muse Code's derived session titles
// (test/fixtures/session-titles/msp-1.4.11-echo-titles.json): Muse Code
// 1.4.11 on Windows, `serve --provider echo`, zero model calls, 2026-10-20.
// Ten first turns went through the product's own MuseCodeHost.sendTurn with
// parts from the product's own builders; the fixture keeps those turns, the
// titled session/listChanged notifications and the session/list, session/read
// and session/resume answers, with the run's paths scrubbed.
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { captureFrameRow } from './wireCapture'

export const titleCapture = z
  .object({
    provenance: z.object({
      cli: z.string(),
      modelAttempts: z.literal(0),
      sessions: z.array(z.object({ label: z.string(), sessionId: z.string() })),
    }),
    frames: z.array(captureFrameRow),
  })
  .parse(
    JSON.parse(
      readFileSync(
        new URL('../../fixtures/session-titles/msp-1.4.11-echo-titles.json', import.meta.url),
        'utf8',
      ),
    ),
  )

/** The recorded answer to the first request of this method. */
export function recordedAnswer(method: string): Record<string, unknown> {
  const sent = titleCapture.frames.find(
    (row) => row.direction === 'sent' && row.frame.method === method,
  )
  const answer = titleCapture.frames.find(
    (row) => row.direction === 'received' && row.frame.id === sent?.frame.id,
  )?.frame.result
  if (answer === undefined) throw new Error(`the capture holds no answer to ${method}`)
  return answer
}
