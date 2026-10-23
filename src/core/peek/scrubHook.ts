// Live peek's scrub hook (M110b K, PLAN.md D90.22): every event passes
// M109's scrub service before it leaves the process, and the redactor
// after it; no secret value, key or token is ever streamed. Only string
// values are scrubbed — keys, numbers and enums pass through untouched —
// and the scrubbed event is validated before it goes out, so the tap
// only ever emits its own schema. Without a scrub service there is no
// hook: it rejects with the vault's own words rather than deliver
// unscrubbed.
import { UI_TEXT } from '../../shared/constants'
import { agentEventSchema, type AgentEvent } from '../../shared/agentEvents'
import { scrubSecrets, type SecretScrubPort } from '../../shared/redact'

/** What the tap runs over every event a viewer receives. */
export type PeekScrubHook = (event: AgentEvent) => Promise<AgentEvent>

async function scrubValue(value: unknown, service: SecretScrubPort): Promise<unknown> {
  if (typeof value === 'string') return await scrubSecrets(value, service)
  if (Array.isArray(value)) {
    const scrubbed: unknown[] = []
    for (const entry of value) scrubbed.push(await scrubValue(entry, service))
    return scrubbed
  }
  if (typeof value === 'object' && value !== null) {
    const scrubbed: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value))
      scrubbed[key] = await scrubValue(entry, service)
    return scrubbed
  }
  return value
}

/** The default hook over the host's injected scrub service. */
export function createPeekScrubHook(service: SecretScrubPort | undefined): PeekScrubHook {
  return service === undefined
    ? () => Promise.reject(new Error(UI_TEXT.vaultScrubUnavailable))
    : async (event: AgentEvent) => agentEventSchema.parse(await scrubValue(event, service))
}
