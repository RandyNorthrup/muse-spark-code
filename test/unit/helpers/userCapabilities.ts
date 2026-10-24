// The capability suites' person-stated record (M95): one custom chat
// identity whose fields come only from the person's own evidence, so a
// field is affirmed exactly when the case states it.
import {
  resolveModelCapabilities,
  type CapabilityOverrides,
} from '../../../src/core/providers/capabilityRecord'

export const identity = { provider: 'custom-id', nativeModel: 'native', format: 'chat' as const }
export const source = { kind: 'user' as const }

/** A field the person affirms with this value. */
export const yes = <T>(value: T) => ({ state: 'yes' as const, value, source })

/** The custom identity's record over the person's fields alone. */
export const record = (fields: CapabilityOverrides = {}) =>
  resolveModelCapabilities(identity, [{ source, fields }])
