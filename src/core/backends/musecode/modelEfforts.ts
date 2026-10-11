import * as z from 'zod/mini'
import type { MuseCodeEffortInfo, MuseCodeFeaturePorts } from './MuseCodeHost'

// Native reader for the Muse Code `model/list` effort extras, written from
// the captured 1.4.4 catalogue frames
// (test/fixtures/m106/msp-1.4.4-host-feedback.json, id 2): every row carries
// `variants` in catalogue order, `reasoningEffortVariants` tier descriptions
// and `defaultReasoningEffort`. Tiers are preserved verbatim, including
// future strings the slider shows as they arrive; the explicit `unknown`
// catalogue keeps the legacy family table. Rows without extras read as
// before; malformed extras throw, and the host isolates that throw to the
// row instead of failing the whole catalogue.

const effortVariantSchema = z.looseObject({
  tier: z.string(),
  description: z.optional(z.nullable(z.string())),
})

const effortExtrasSchema = z.looseObject({
  variants: z.optional(z.union([z.literal('unknown'), z.array(z.string())])),
  reasoningEffortVariants: z.optional(z.array(effortVariantSchema)),
  defaultReasoningEffort: z.optional(z.string()),
})

/** Validate one captured catalogue row's effort extras; throw on malformed extras. */
export function parseModelEffortExtras(row: unknown): MuseCodeEffortInfo {
  const extras = effortExtrasSchema.parse(row)
  const described = extras.reasoningEffortVariants?.map((variant) => ({
    tier: variant.tier,
    ...(variant.description != null && { description: variant.description }),
  }))
  return {
    ...(extras.variants !== undefined && { variants: extras.variants }),
    ...(described !== undefined && { reasoningEffortVariants: described }),
    ...(extras.defaultReasoningEffort !== undefined && {
      defaultReasoningEffort: extras.defaultReasoningEffort,
    }),
  }
}

/** The captured-frame effort reader to bind at the host constructions. */
export const NATIVE_MODEL_EFFORTS: NonNullable<MuseCodeFeaturePorts['modelEfforts']> = {
  parseModel: parseModelEffortExtras,
}
