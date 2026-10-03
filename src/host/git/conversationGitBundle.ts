// M71's implementation loads at its existing construction point (PLAN.md D6).
// The activation bundle retains this checked loader and type-only ports.
import { UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import type { ConversationGitPort, GitSurface } from '../conversation/conversationController'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type { ConversationGitErrorTypes, GitWindow } from './conversationGit'

interface ConversationGitBundle {
  readonly createConversationGit: (
    window: GitWindow,
    surface: GitSurface,
    table: UiText,
    locale: string,
    errorTypes: ConversationGitErrorTypes,
  ) => ConversationGitPort
}

/** Signatures are trusted only for our same-build packaged factory (PLAN.md section 8). */
export function isConversationGitBundle(value: unknown): value is ConversationGitBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createConversationGit' in value &&
    typeof value.createConversationGit === 'function'
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
