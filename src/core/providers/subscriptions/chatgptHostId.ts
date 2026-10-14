// The ChatGPT host id OpenAI accepts, and the sign-in failure codes. This
// module stays free of the sign-in core's schemas and token logic (and of
// every other provider module) so hosts that only persist the id can reach
// it through the externalized subscriptions bundle without duplicating
// anything into their own.
import { randomUUID } from 'node:crypto'
import { CHATGPT_HOST_ID_URN_PREFIX } from '../../../shared/constants'

/** Technical failure codes; hosts translate these without exposing wire text. */
export class ChatGptSignInError extends Error {
  public constructor(
    public readonly code:
      | 'invalid-discovery'
      | 'invalid-callback'
      | 'authorize-refused'
      | 'invalid-state'
      | 'invalid-token'
      | 'invalid-id-token'
      | 'missing-plan-scope'
      | 'origin-mismatch'
      | 'sign-in-required'
      | 'expired'
      | 'store-unavailable'
      | 'lock-unavailable'
      | 'request-failed',
    /**
     * The operating system's own code for a `lock-unavailable` failure
     * (for example `EACCES`), or OpenAI's own error code for an
     * `authorize-refused` failure (for example `access_denied`); hosts
     * show it beside the sentence. Undefined for every other code.
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
