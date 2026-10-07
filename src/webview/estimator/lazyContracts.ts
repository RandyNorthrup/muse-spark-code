import * as z from 'zod/mini'
import type * as EstimateContracts from '../../shared/estimate'
import { UI_TEXT } from '../../shared/l10n/text'

const state: { contracts?: typeof EstimateContracts; loading?: Promise<void> } = {}

/** Never parse an estimator payload using an incomplete contract. */
export function ensureEstimateContracts(): Promise<void> {
  if (state.contracts !== undefined) return Promise.resolve()
  state.loading ??= loadContracts()
  return state.loading
}

async function loadContracts(): Promise<void> {
  try {
    state.contracts = await import('../../shared/estimate')
  } catch (error: unknown) {
    delete state.loading
    throw error
  }
}

function deferredSchema<T>(
  read: (loaded: typeof EstimateContracts) => z.ZodMiniType<T>,
): z.ZodMiniType<T> {
  return z.transform((value, context) => {
    if (state.contracts === undefined) {
      context.issues.push({ code: 'custom', message: UI_TEXT.estimateUnavailable, input: value })
      return z.NEVER
    }
    const parsed = read(state.contracts).safeParse(value)
    if (!parsed.success) {
      context.issues.push({ code: 'custom', message: parsed.error.message, input: value })
      return z.NEVER
    }
    return parsed.data
  })
}

export const estimateRequestSchema = deferredSchema((loaded) => loaded.estimateRequestSchema)
export const estimateSectionSchema = deferredSchema((loaded) => loaded.estimateSectionSchema)
