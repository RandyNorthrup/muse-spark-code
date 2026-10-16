// M71's bundle (PLAN.md D6): the conversations' Git adapter and the window's
// git and pull request features, each constructed synchronously with its
// installed language. Everything that throws or checks a Git or GitHub error
// lives here, so the adapter recognises its own window's errors.
//
// A VS Code-family host without the `vscode.git` extension (Arduino IDE 2,
// some forks) gets M123's native adapter in-process instead (PLAN.md D104),
// from its own bundle (dist/nativeGit.js, nativeGitBundle.ts): status, the
// commit form, commit, push after its modal, the remote pick, pull requests
// and their drafts through the user's own git on PATH and the window's
// GitHub sign-in.
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import type { ConversationGitPort, GitSurface } from '../conversation/conversationController'
import { ConversationGit, type ConversationGitErrorTypes, type GitWindow } from './conversationGit'
import { GitUnavailableError, isGitExtensionInstalled } from './gitExtension'
import { loadNativeGitBundle } from './nativeGitBundle'
import {
  createGitFeatures as gitFeaturesFrom,
  type GitFeaturesDeps,
  type GitWindowFeatures,
} from './gitWindow'

/** `errorTypes` only for a test's window from another module copy; the bundle's own otherwise. */
export function createConversationGit(
  window: GitWindow,
  surface: GitSurface,
  table: UiText,
  locale: string,
  errorTypes?: ConversationGitErrorTypes,
): ConversationGitPort {
  setUiText(table, locale)
  const native = isGitExtensionInstalled() ? undefined : window.nativeGit?.()
  if (native === undefined) {
    return new ConversationGit(window, surface, errorTypes)
  }
  let bundle: ReturnType<typeof loadNativeGitBundle>
  try {
    bundle = loadNativeGitBundle(native.bundlePath)
  } catch (error: unknown) {
    window.log.warn(
      `The native Git bundle could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
    )
    throw new GitUnavailableError(table.gitUnavailable)
  }
  return bundle.createNativeGit(surface, native.deps, table, locale)
}

export function createGitFeatures(
  deps: GitFeaturesDeps,
  table: UiText,
  locale: string,
): GitWindowFeatures {
  setUiText(table, locale)
  return gitFeaturesFrom(deps)
}
