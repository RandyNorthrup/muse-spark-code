// RLF-QUOTA (PLAN.md D229): the observed subscription-quota failure as a
// live wire frame. The message text and reset instant are byte for byte
// from the fixture (the lead's observed 0.19.0 ACP error line,
// 2026-10-30); the `quota` member follows the CLI 1.4.10 schema export
// (verified offline on this rig). `kind` is the recorded model-failure
// kind and `retryable` is covered both ways by the suites, since neither
// is known from the observation and the quota outcome never branches on
// either. Connection-local sequencing (viewCursor, sourceRange) is
// omitted: the mapping never reads it.
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import type { WireFrame } from './museReplay'

const fixtureSchema = z.object({
  providerFacts: z.object({
    message: z.string(),
    resetsAtMs: z.number(),
  }),
})

const fixture = fixtureSchema.parse(
  JSON.parse(
    readFileSync(
      new URL('../../fixtures/musecode-quota/observed-acp-error.json', import.meta.url),
      'utf8',
    ),
  ),
)

/** The CLI's quota-failure text, verbatim from the observed error line. */
export const QUOTA_MESSAGE: string = fixture.providerFacts.message

/** The observed reset instant, epoch milliseconds. */
export const QUOTA_RESETS_AT_MS: number = fixture.providerFacts.resetsAtMs

/**
The observed failure as the CLI's `turn/completed` params, addressed to
the live session and turn. Only the connection-local identities are the
caller's; terminal, reason, kind, message, quota and the given retryable
judgment are the frame's content.
*/
export function quotaTurnParams(options: {
  readonly sessionId: string
  readonly turnId: string
  readonly retryable: boolean
}): Record<string, unknown> {
  return {
    sessionId: options.sessionId,
    turnId: options.turnId,
    terminal: 'failed',
    reason: QUOTA_MESSAGE,
    error: {
      kind: 'modelError',
      message: QUOTA_MESSAGE,
      retryable: options.retryable,
      quota: { limitKind: 'tierLimit', resetsAtMs: QUOTA_RESETS_AT_MS },
    },
  }
}

/** The same params as a live wire frame, releasable into the replay wire. */
export function quotaTurnCompleted(options: {
  readonly sessionId: string
  readonly turnId: string
  readonly retryable: boolean
}): WireFrame {
  return {
    jsonrpc: '2.0',
    method: 'turn/completed',
    params: quotaTurnParams(options),
  }
}
