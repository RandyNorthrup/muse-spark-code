// The Model API backend's session store as the activation bundle sees it
// (PLAN.md D6, D14): dist/modelApiSessions.js, built from
// fileSessionStoreEntry.ts and required the first time the Model API host is
// built. Only types come from the store's side here: a value imported from
// there would carry the store back into dist/extension.js, which the
// bundle-split gate (scripts/check-bundle-split.mjs) refuses.
//
// A missing or damaged bundle refuses the host's build with the Model API
// backend's own sentence (the log has the cause), and the next build tries
// again.
import type { SessionStore } from '../../core/backends/modelapi/sessionStore'
import { UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { uiLocale } from '../../shared/l10n/text'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type { FileSessionStoreDeps } from './fileSessionStore'

interface FileSessionStoreBundle {
  readonly createFileSessionStore: (
    deps: FileSessionStoreDeps,
    table: UiText,
    locale: string,
  ) => SessionStore
}

/** Signatures are trusted only for our same-build packaged factory (PLAN.md section 8). */
export function isFileSessionStoreBundle(value: unknown): value is FileSessionStoreBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createFileSessionStore' in value &&
    typeof value.createFileSessionStore === 'function'
  )
}

/**
 * The window's one session store, made in the bundle the first time it is
 * asked for and kept from then on.
 */
export function lazyFileSessionStore(deps: {
  readonly bundlePath: string
  readonly log: Logger
  readonly loadBundle?: ((file: string) => unknown) | undefined
  readonly store: FileSessionStoreDeps
}): () => SessionStore {
  const bundle = lazyBundleLoader({
    bundlePath: deps.bundlePath,
    log: deps.log,
    loadBundle: deps.loadBundle,
    isBundle: isFileSessionStoreBundle,
    label: 'Model API session store bundle',
    unavailable: () => UI_TEXT.modelApiBundleUnavailable,
  })
  let store: SessionStore | undefined
  return () => {
    store ??= bundle().createFileSessionStore(deps.store, UI_TEXT, uiLocale())
    return store
  }
}
