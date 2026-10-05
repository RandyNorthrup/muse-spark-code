// M71's implementation loads at its existing construction points (PLAN.md
// D6): a conversation's Git adapter when the conversation is made, and the
// window's git and pull request features with the first of those or the
// first "Open a pull request in a conversation…". The activation bundle
// retains this checked loader and type-only ports: a value imported from the
// bundle's side would carry the GitHub client, the checkout and VS Code's
// git extension adapter back into dist/extension.js, which the bundle-split
// gate refuses.
import { UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { uiLocale } from '../../shared/l10n/text'
import type { ConversationGitPort, GitSurface } from '../conversation/conversationController'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type { ConversationGitErrorTypes, GitWindow } from './conversationGit'
import type { GitFeaturesDeps, GitWindowFeatures } from './gitWindow'

interface ConversationGitBundle {
  readonly createConversationGit: (
    window: GitWindow,
    surface: GitSurface,
    table: UiText,
    locale: string,
    errorTypes?: ConversationGitErrorTypes,
  ) => ConversationGitPort
  readonly createGitFeatures: (
    deps: GitFeaturesDeps,
    table: UiText,
    locale: string,
  ) => GitWindowFeatures
}

/** Signatures are trusted only for our same-build packaged factory (PLAN.md section 8). */
export function isConversationGitBundle(value: unknown): value is ConversationGitBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createConversationGit' in value &&
    typeof value.createConversationGit === 'function' &&
    'createGitFeatures' in value &&
    typeof value.createGitFeatures === 'function'
  )
}

/** Missing or malformed bundles refuse construction; a later call retries. */
export function conversationGitLoader(deps: {
  readonly bundlePath: string
  readonly log: Logger
  readonly loadBundle?: ((file: string) => unknown) | undefined
}): () => ConversationGitBundle {
  return lazyBundleLoader({
    ...deps,
    isBundle: isConversationGitBundle,
    label: 'conversation Git bundle',
    unavailable: () => UI_TEXT.gitUnavailable,
  })
}

/**
 * The window's git features, made in the bundle the first time they are
 * asked for and kept from then on (one window, one pull request checkout
 * at a time). A bundle that cannot load throws `gitUnavailable`, and the
 * next call tries again.
 */
export function gitFeaturesLoader(
  bundle: () => ConversationGitBundle,
  deps: GitFeaturesDeps,
): () => GitWindowFeatures {
  let features: GitWindowFeatures | undefined
  return () => {
    features ??= bundle().createGitFeatures(deps, UI_TEXT, uiLocale())
    return features
  }
}

/** A conversation's Git adapter over the window's features, in the installed language. */
export function conversationGitFactory(
  bundle: () => ConversationGitBundle,
  features: () => GitWindowFeatures,
): (surface: GitSurface) => ConversationGitPort {
  return (surface) =>
    bundle().createConversationGit(features().window, surface, UI_TEXT, uiLocale())
}

/**
 * "Open a pull request in a conversation…": when the bundle cannot load,
 * the command is refused with Git's unavailable error (the log has the
 * cause), as a repository Git cannot reach is, and the next press tries again.
 */
export async function openPullRequestInConversation(
  features: () => GitWindowFeatures,
  showError: (message: string) => void,
): Promise<void> {
  let loaded: GitWindowFeatures
  try {
    loaded = features()
  } catch (error: unknown) {
    showError(error instanceof Error ? error.message : UI_TEXT.gitUnavailable)
    return
  }
  await loaded.openPullRequestInConversation()
}
