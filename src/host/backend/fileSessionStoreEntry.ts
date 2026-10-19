// The Model API backend's session store (PLAN.md D14) as a bundle of its own
// (D6): esbuild builds this file into dist/modelApiSessions.js, which the
// activation bundle requires the first time the Model API host is built, so
// the store and the stored-session schemas stay out of
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

// Pure stored-session readers share this owner without loading a second parser.
export * from '../../core/backends/modelapi/sessionStore'
// The uploaded-files binding ships in this bundle (ACTBUD017): the account
// ledger is the sessions bundle's family, and activation keeps only the
// loader below and the types.
export {
  createUploadedFilesBinding,
  runDeleteUploadedFilesCommand,
  type DeleteUploadedFilesCommandDeps,
  type DeleteUploadedFilesDialogs,
  type DeleteUploadedFilesPick,
  type StampedUploadedFilesPort,
  type UploadedFilesBinding,
  type UploadedFilesBindingDeps,
  type UploadedFilesReadStamp,
  type UploadedFilesStamp,
} from './uploadedFilesBinding'
