// M123's native Git route as the conversation Git bundle sees it (PLAN.md
// D6): dist/nativeGit.js, built from src/runtime/panel/git/nativeGitEntry.ts
// and required the first time a conversation opens in a host without
// `vscode.git`. Only types come from the entry's side here: a value imported
// from there would carry the route back into dist/conversationGit.js, which
// the bundle-split gate refuses.
//
// A missing or damaged bundle refuses the conversation's Git with Git's
// unavailable error (the log has the cause), as a missing conversation Git
// bundle does, and the next conversation tries again.
import { UI_TEXT } from '../../shared/constants'
import type * as Entry from '../../runtime/panel/git/nativeGitEntry'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'

export interface NativeGitBundle {
  readonly createNativeGit: typeof Entry.createNativeGit
}

/** Signatures are trusted only for our same-build packaged entry (PLAN.md section 8). */
export function isNativeGitBundle(value: unknown): value is NativeGitBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createNativeGit' in value &&
    typeof value.createNativeGit === 'function'
  )
}

/** The bundle, loaded once; a load failure or a wrong-shaped module refuses with Git's unavailable error. */
export function nativeGitLoader(deps: {
  readonly bundlePath: string
  readonly log: Logger
  readonly loadBundle?: ((file: string) => unknown) | undefined
}): () => NativeGitBundle {
  return lazyBundleLoader({
    ...deps,
    isBundle: isNativeGitBundle,
    label: 'native Git bundle',
    unavailable: () => UI_TEXT.gitUnavailable,
  })
}

/** The runtime panel's side of the same bundle: the connection's Git, made once its editor has answered. */
export interface PanelGitBundle {
  readonly openPanelGit: typeof Entry.openPanelGit
}

export function isPanelGitBundle(value: unknown): value is PanelGitBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'openPanelGit' in value &&
    typeof value.openPanelGit === 'function'
  )
}

/** The bundle for the runtime panel, loaded once; a failure leaves the panel with no Git (the log has the cause). */
export function panelGitLoader(deps: {
  readonly bundlePath: string
  readonly log: Logger
  readonly loadBundle?: ((file: string) => unknown) | undefined
}): () => PanelGitBundle {
  return lazyBundleLoader({
    ...deps,
    isBundle: isPanelGitBundle,
    label: 'native Git bundle',
    unavailable: () => UI_TEXT.gitUnavailable,
  })
}
