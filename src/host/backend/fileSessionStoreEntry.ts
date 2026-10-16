// The Model API backend's session store (PLAN.md D14) as a bundle of its own
// (D6): esbuild builds this file into dist/modelApiSessions.js, which the
// activation bundle requires the first time the Model API host is built, so
// the store, its budget journal and the stored-session schemas stay out of
// dist/extension.js. The bundle keeps its own installed-language state, so
// the factory installs the caller's table before it builds the store.
import type { SessionStore } from '../../core/backends/modelapi/sessionStore'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import {
  createFileSessionStore as createStore,
  type FileSessionStoreDeps,
} from './fileSessionStore'

export function createFileSessionStore(
  deps: FileSessionStoreDeps,
  table: UiText,
  locale: string,
): SessionStore {
  setUiText(table, locale)
  return createStore(deps)
}
