// The provider file and team import share these non-secret option shapes
// (M95, PLAN.md D74). Keep it outside provider core so panel imports stay lazy.
import * as z from 'zod/mini'
import {
  MODEL_API_BASE_URL,
  MODEL_API_MIN_OUTPUT_TOKENS,
  MODEL_API_MODEL_PREFIX,
} from './constants'
import { UI_TEXT } from './l10n/text'
import { outputTokenMinimumMessage } from './outputTokenMinimum'

// The message has a leaf of its own for the browser's team settings; provider
// code keeps reading it from here.
export { outputTokenMinimumMessage } from './outputTokenMinimum'

// Pure factory: bundles that never read a provider file (panels, headless)
// drop the schema instead of carrying it.
export const openRouterRoutingSchema = /* @__PURE__ */ (() =>
  z.object({
    privacy: z.enum(['zdr', 'no-training', 'any']),
    order: z.optional(z.array(z.string())),
    allowFallbacks: z.optional(z.boolean()),
  }))()

/**
 * Compatibility overrides for a custom server (M101 BYO 14): the wire
 * shape its format's defaults misdescribe. Strict: an unknown key is a
 * typo that would send the wrong shape, so it refuses the entry instead
 * of stripping it.
 */
// Pure factory: same droppability as above for custom-server overrides.
export const customCompatSchema = /* @__PURE__ */ (() =>
  z.strictObject({
    outputCapParam: z.optional(
      z.enum([
        'max_output_tokens',
        'max_completion_tokens',
        'max_tokens',
        'maxOutputTokens',
        'num_predict',
      ]),
    ),
    toolChoice: z.optional(z.enum(['auto', 'omit', 'string-only'])),
    sendsParallelToolCalls: z.optional(z.boolean()),
    reasoningField: z.optional(
      z.enum([
        'encrypted',
        'reasoning',
        'reasoning_content',
        'reasoning_details',
        'thoughtSignature',
        'thinking',
        'content-list',
        'none',
      ]),
    ),
    reasoningReplay: z.optional(z.enum(['same-model', 'none'])),
    usageOnFinishChunk: z.optional(z.boolean()),
    usageNeedsOptIn: z.optional(z.boolean()),
    supportsStrictTools: z.optional(z.boolean()),
  }))()

/** User-supplied custom-server limits; both are finite positive token counts. */
export const modelLimitsSchema = /* @__PURE__ */ z
  .object({
    contextTokens: z.int().check(z.positive()),
    outputTokens: z.int().check(z.gte(1, { error: () => outputTokenMinimumMessage(1) })),
  })
  .check(
    z.refine((limits) => limits.outputTokens <= limits.contextTokens, {
      error: () => UI_TEXT.providerText.schema.outputCap,
    }),
  )

/** A custom entry at Meta's captured endpoint retains its provider minimum. */
export function providerOutputMinimum(
  address: string | undefined,
  model: string,
  minimum: number,
  format: string | undefined,
): number {
  if (format !== 'responses' || address === undefined || !model.startsWith(MODEL_API_MODEL_PREFIX))
    return minimum
  try {
    return new URL(address).origin === new URL(MODEL_API_BASE_URL).origin
      ? Math.max(minimum, MODEL_API_MIN_OUTPUT_TOKENS)
      : minimum
  } catch {
    // Endpoint validation reports malformed addresses; no minimum is inferred.
    return minimum
  }
}
