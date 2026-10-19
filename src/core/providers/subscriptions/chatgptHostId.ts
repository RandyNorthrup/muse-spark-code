// The ChatGPT host id OpenAI accepts, and the sign-in failure codes. This
// module stays free of the sign-in core's schemas and token logic (and of
// every other provider module) so hosts that only persist the id can reach
// it through the externalized subscriptions bundle without duplicating
// anything into their own.
import { randomUUID } from 'node:crypto'
import { CHATGPT_HOST_ID_URN_PREFIX } from '../../../shared/constants'

/**
 * Technical failure codes, one per cause; hosts translate each into its own
 * sentence without exposing wire text.
 */
export class ChatGptSignInError extends Error {
  public constructor(
    public readonly code:
      | 'invalid-discovery'
      | 'invalid-callback'
      | 'callback-timeout'
      | 'authorize-refused'
      | 'invalid-state'
      | 'invalid-token'
      | 'invalid-id-token'
      | 'missing-plan-scope'
      | 'origin-mismatch'
      | 'not-signed-in'
      | 'still-signed-in'
      | 'sign-in-required'
      | 'expired'
      | 'grant-unreadable'
      | 'registration-unreadable'
      | 'host-id-unreadable'
      | 'store-unavailable'
      | 'lock-unavailable'
      | 'lock-busy'
      | 'cancelled'
      | 'browser-unavailable'
      | 'local-failed'
      | 'providers-file-unreadable'
      | 'providers-file-unwritable'
      | 'already-added'
      | 'account-mismatch'
      | 'client-refused'
      | 'catalogue-refused'
      | 'catalogue-unreadable'
      | 'catalogue-empty'
      | 'added-models-unlisted'
      | 'model-not-added'
      | 'request-failed',
    /**
     * A short technical word hosts show beside the sentence, never free
     * provider text: the operating system's code (`lock-unavailable`,
     * `local-failed`, `EACCES`); OpenAI's own error code (`authorize-refused`
     * `access_denied`, `sign-in-required` `invalid_grant`); the HTTP status and
     * code of a refused answer (`catalogue-refused`, `request-failed`); Node's
     * network codes (`request-failed`); where an unreadable host id is kept
     * (`host-id-unreadable`); the model asked for (`model-not-added`); or this
     * app's own word for why the providers file failed (`unparseable`,
     * `invalid`, `io-error`).
     */
    public readonly reason?: string,
  ) {
    super(`chatgpt.${code}`)
    this.name = 'ChatGptSignInError'
  }
}

/**
 * The documented host id: `urn:uuid:` plus one generated UUIDv4, persisted
 * per host. Our host has no key pair, so the JWK-thumbprint form (an
 * identifier only, unverified by OpenAI) would add key management for
 * nothing; the UUID form is the documented supported alternative.
 */
const HOST_ID_PATTERN = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

/** Whether the value is a documented `ext_agent_host_id`, never a bare random string. */
export function isChatGptHostId(value: string): boolean {
  return HOST_ID_PATTERN.test(value)
}

/** One host's stable `ext_agent_host_id`, generated once and persisted by the caller. */
export function createChatGptHostId(): string {
  return `${CHATGPT_HOST_ID_URN_PREFIX}${randomUUID()}`
}
