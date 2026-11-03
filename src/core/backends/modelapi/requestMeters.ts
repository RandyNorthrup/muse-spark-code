// Per-request prefix meters (4-H4): what the fixed part of a request
// costs before any work is done — tool-definition tokens and rules
// tokens, both estimated at the product's chars-per-token rule. The
// host logs them per request (counts only) and records them on the
// usage journal, so Account & usage shows what tool surface and rules
// files cost beside the provider's own cached-token count. Pure.

import type { ToolDefinition } from './schemas'
import { estimatePackTokens } from './toolResultBound'

/**
Estimated tokens of tool definitions as they ride a request: the JSON
bytes the request carries, at the product's chars-per-token rule
(`estimatePackTokens`).
*/
export function estimateDefinitionTokens(definitions: readonly object[]): number {
  return estimatePackTokens(JSON.stringify(definitions).length)
}

/** The estimated fixed-prefix costs of one request. */
export interface RequestMeters {
  /** Estimated tokens of every tool definition the request declares. */
  readonly definitionTokens: number
  /** Estimated tokens of the workspace rules text in the instructions. */
  readonly rulesTokens: number
}

/**
Meter one request's declarations. `tools` are the fitted definitions
exactly as the request body carries them; `rules` is the workspace
rules text folded into the instructions (undefined without rules).
*/
export function meterRequestPrefix(
  tools: readonly ToolDefinition[],
  rules: string | undefined,
): RequestMeters {
  return {
    definitionTokens: estimateDefinitionTokens(tools),
    rulesTokens: rules === undefined ? 0 : estimatePackTokens(rules.length),
  }
}
