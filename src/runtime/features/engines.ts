import type { RuntimeFeatureFactories, RuntimeFeatureContext } from '../panel/runtimeFeatures'
import { setUiText } from '../../shared/l10n/text'

/** Publishes the same checkpoint port that the backend's real turn recorder uses. */
export const createRuntimeEngines: NonNullable<RuntimeFeatureFactories['engines']> = async (
  context: RuntimeFeatureContext,
  table,
  locale,
) => {
  setUiText(table, locale)
  const services = await context.ports.runtime.checkpointsFor?.(context.ports.workspaceRoot)
  if (services === undefined) throw new Error('MHP_CHECKPOINT_NAMESPACE_UNAVAILABLE')
  const hooks = context.ports.runtime.hooksFor?.(context.ports.workspaceRoot)
  const paid = context.ports.runtime.paidFor?.(
    context.ports.workspaceRoot,
    context.ports.surface.id,
  )
  const modelApi = await context.ports.runtime.modelApiFor?.(context.ports.workspaceRoot)
  const reviewer = context.ports.runtime.autoReviewerFor?.(context.ports.workspaceRoot)
  // The backend owns this shared workspace resource, beyond any one conversation.
  return {
    ...(paid !== undefined && { paid }),
    ...(modelApi !== undefined && { modelApi }),
    features: {
      ...(reviewer !== undefined && { museCodeReviewer: reviewer.reviewer }),
      checkpoints: services.port,
      ...(hooks !== undefined && {
        runManualHook: (name: string) => hooks.runManual(name),
        rewriteMessage: (text: string) => hooks.rewriteMessage(text),
      }),
    },
  }
}
