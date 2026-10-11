// The provider file and team import share these non-secret option shapes
// (M95, PLAN.md D74). Keep it outside provider core so panel imports stay lazy.
import * as z from 'zod/mini'
import { UI_TEXT } from './l10n/text'

export const openRouterRoutingSchema = z.object({
  privacy: z.enum(['zdr', 'no-training', 'any']),
  order: z.optional(z.array(z.string())),
  allowFallbacks: z.optional(z.boolean()),
})

/**
 * Compatibility overrides for a custom server (M101 BYO 14): the wire
 * shape its format's defaults misdescribe. Strict: an unknown key is a
 * typo that would send the wrong shape, so it refuses the entry instead
 * of stripping it.
 */
export const customCompatSchema = z.strictObject({
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
})

/** User-supplied custom-server limits; both are finite positive token counts. */
export const modelLimitsSchema = z
  .object({
    contextTokens: z.int().check(z.positive()),
    outputTokens: z.int().check(z.positive()),
  })
  .check(
    z.refine((limits) => limits.outputTokens <= limits.contextTokens, {
      error: () => UI_TEXT.providerText.schema.outputCap,
    }),
  )

/**
 * Limits exist only for ticked models (C-M95-4 R5): keep an entry's
 * `modelLimits` for models in its list and drop the rest, so a stale
 * window an untick left behind can never win over a later scan. Listed
 * custom models' required limits are intact. Structural on purpose: both
 * the file schema's entry and the host's entry satisfy it, and panel
 * bundles import this shared module without pulling provider core.
 */
export function pruneModelLimits(
  models: readonly string[],
  modelLimits:
    | Readonly<Record<string, { readonly contextTokens: number; readonly outputTokens: number }>>
    | undefined,
): Record<string, { contextTokens: number; outputTokens: number }> | undefined {
  return modelLimits === undefined
    ? undefined
    : Object.fromEntries(Object.entries(modelLimits).filter(([id]) => models.includes(id)))
}
