import { createDefaultFactories, type RuntimeFactoryOptions } from './defaultFactories'
import { createRuntimeEngines } from '../features/engines'
import { createRuntimeAuth } from '../features/auth'
import { createRuntimeGit } from '../features/git'
import { createRuntimeReview } from '../features/review'
import { createRuntimeEditReview } from '../features/editReview'
import { createRuntimeTransferFiles } from '../features/transfer'
import { createRuntimeWorktrees } from '../features/worktrees'
import { createRuntimeUsageInsights } from '../features/usageInsights'
import { createRuntimeVoice } from '../features/voice'
import { createRuntimeJudge } from '../features/judge'
import type {
  RuntimeFeatureContext,
  RuntimeFeatureFactories,
  RuntimeEngineContribution,
} from './runtimeFeatures'
import { setUiText } from '../../shared/l10n/text'

export { RuntimePresentationViews } from './presentationViews'
export { runtimeEditorContext } from '../features/editorContext'

/** Native owners supply these exact guarded engine dependencies; absent adapters remain unavailable. */
export interface RuntimeEngineOptions {
  readonly runBestOfNGit?: RuntimeEngineContribution['features']['runBestOfNGit']
  readonly keyPresence?: () => boolean
  readonly plans?: RuntimeEngineContribution['features']['plans']
  readonly auth?: Parameters<typeof createRuntimeAuth>[0]
  readonly git?: Parameters<typeof createRuntimeGit>[0]
  readonly review?: Parameters<typeof createRuntimeReview>[0]
  readonly editReview?: Parameters<typeof createRuntimeEditReview>[0]
  readonly transfer?: Parameters<typeof createRuntimeTransferFiles>[0]
  readonly worktrees?: Parameters<typeof createRuntimeWorktrees>[0]
  readonly usageInsights?: Parameters<typeof createRuntimeUsageInsights>[0]
  readonly voice?: Parameters<typeof createRuntimeVoice>[0]
  readonly judge?: Parameters<typeof createRuntimeJudge>[0]
}

/** Composition owns conversation resources immediately; backend resources remain shared per workspace. */
export function createRuntimeEngineFactory(
  configure: (
    context: RuntimeFeatureContext,
  ) => RuntimeEngineOptions | Promise<RuntimeEngineOptions>,
): NonNullable<RuntimeFeatureFactories['engines']> {
  return async (context, table, locale) => {
    setUiText(table, locale)
    const options = await configure(context)
    const base =
      context.ports.runtime.checkpointsFor === undefined
        ? { features: {} }
        : await createRuntimeEngines(context, table, locale)
    const features: {
      -readonly [
        K in keyof RuntimeEngineContribution['features']
      ]: RuntimeEngineContribution['features'][K]
    } = { ...base.features }
    const actions: NonNullable<RuntimeEngineContribution['actions']> = {}
    features.runBestOfNGit =
      options.runBestOfNGit ??
      (() => Promise.reject(new Error('MHP_NATIVE_PROCESS_ADMISSION_UNAVAILABLE')))
    if (options.plans !== undefined) features.plans = options.plans
    let keyPresence: RuntimeEngineContribution['isKeyStored'] = options.keyPresence
    if (options.auth !== undefined) {
      const owner = createRuntimeAuth(options.auth, table, locale)
      context.own(owner.dispose)
      Object.assign(features, owner.features)
      keyPresence = owner.isKeyStored
    }
    if (options.git !== undefined) {
      const deps = options.git
      features.createGit = (surface) => {
        const owner = createRuntimeGit(deps, surface, table, locale)
        context.own(owner.dispose)
        return owner.git
      }
    }
    if (options.review !== undefined) {
      const owner = createRuntimeReview(options.review, table, locale)
      context.own(owner.dispose)
      features.review = owner.review
    }
    if (options.editReview !== undefined) {
      const owner = createRuntimeEditReview(options.editReview, table, locale)
      context.own(owner.dispose)
      features.editReview = owner.review
    }
    if (options.transfer !== undefined) {
      const owner = createRuntimeTransferFiles(options.transfer, table, locale)
      context.own(owner.dispose)
      features.transferFiles = owner.files
    }
    if (options.worktrees !== undefined) {
      const owner = createRuntimeWorktrees(options.worktrees, table, locale)
      context.own(owner.dispose)
      actions.newWorktree = owner.create
      actions.removeWorktree = owner.remove
    }
    if (options.usageInsights !== undefined) {
      const owner = createRuntimeUsageInsights(options.usageInsights)
      context.own(owner.dispose)
      features.usageInsights = owner.read
    }
    if (options.voice !== undefined) {
      const owner = createRuntimeVoice(options.voice, table, locale)
      context.own(owner.dispose)
      features.dictation = owner.dictation
    }
    if (options.judge !== undefined) {
      const owner = createRuntimeJudge(options.judge, table, locale)
      context.own(owner.dispose)
      features.judge = owner.judge
    }
    return {
      ...base,
      features,
      actions,
      ...(keyPresence !== undefined && { isKeyStored: keyPresence }),
    }
  }
}

export function createRuntimeFactories(options: RuntimeFactoryOptions): RuntimeFeatureFactories {
  return createDefaultFactories(options, createRuntimeEngineFactory)
}
