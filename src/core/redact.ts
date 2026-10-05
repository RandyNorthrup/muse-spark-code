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
