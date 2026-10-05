// Compatibility entry for core/host consumers. The browser uses this same
// pure detection table through src/shared/redact.ts (M92e, PLAN.md D71).
export {
  countSecretMatches,
  MAY_HOLD_SECRET,
  redactableSlices,
  redactSecrets,
  SECRET_RULES,
  type SecretRule,
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
