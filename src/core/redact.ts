// Compatibility entry for core/host consumers. The browser uses this same
// pure detection table through src/shared/redact.ts (M92e, PLAN.md D71).
export {
  countSecretMatches,
  isSecretFieldName,
  redactableSlices,
  redactSecrets,
  registerSecretValue,
} from '../shared/redact'

import type { AgentEvent } from '../shared/agentEvents'
import { redactSecrets } from '../shared/redact'

/** Diagnostic text only: ordinary conversation and tool content stays intact. */
export function redactDiagnosticEvent(event: AgentEvent): AgentEvent {
  switch (event.type) {
    case 'turnCompleted': {
      return {
        ...event,
        ...(event.reason !== undefined && { reason: redactSecrets(event.reason) }),
        ...(event.errorKind !== undefined && { errorKind: redactSecrets(event.errorKind) }),
      }
    }
    case 'turnRetry':
    case 'turnWithdrawn': {
      return { ...event, reason: redactSecrets(event.reason) }
    }
    case 'backendNotice': {
      return { ...event, text: redactSecrets(event.text) }
    }
    default: {
      return event
    }
  }
}

/**
A provider's sentence with the pieces that identify the person's account
removed (round 2, finding 5): a masked-key remnant (OpenAI repeats the
key's first 8 and last 4 characters, DeepSeek its last 4), a team id (xAI
names it) or a user id (OpenRouter sends one). Request ids are provider
support's handle and are kept. The person still reads their own provider's
full sentence on screen; the stored form (report bundles, and any later
sink beyond the screen) carries this instead.
*/
export function scrubRefusalLeak(text: string): string {
  return text
    .replaceAll(/[^\s]*\*{2,}[^\s]*/g, '[key]')
    .replaceAll(/\bteam\s+[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi, 'team [account]')
    .replaceAll(/\buser_id["']?\s*[:=]\s*["']?[A-Za-z0-9_-]+/g, 'user_id [account]')
}
