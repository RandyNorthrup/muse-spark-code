// Verification is loaded only on the first diagnostics/formatting request.
import { UI_TEXT, VERIFY_EDITOR_BUNDLE_FILE } from '../../shared/constants'
import { redactSecrets } from '../../core/redact'
import { uiLocale } from '../../shared/l10n/text'
import { lazyBundleLoader } from '../lazyBundle'
import type {
  VerifyEditor,
  VerifyEditorDeps,
  createVerifyEditor,
} from '../vscode/editor/verifyEditor'

interface VerifyEditorBundle {
  readonly createVerifyEditor: typeof createVerifyEditor
}

/** Same-build packaged factory signatures are trusted (PLAN.md §8). */
function isBundle(value: unknown): value is VerifyEditorBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createVerifyEditor' in value &&
    typeof value.createVerifyEditor === 'function'
  )
}

export function createDeferredVerifyEditor(
  deps: Omit<VerifyEditorDeps, 'redact'>,
  bundleDirectory: string,
  loadBundle?: (file: string) => unknown,
): VerifyEditor {
  const load = lazyBundleLoader({
    bundlePath: `${bundleDirectory}/${VERIFY_EDITOR_BUNDLE_FILE}`,
    log: deps.log,
    loadBundle,
    isBundle,
    label: 'editor verification bundle',
    unavailable: () => UI_TEXT.jsonVerificationUnavailable,
  })
  let editor: VerifyEditor | undefined
  let isDisposed = false
  const get = () => {
    if (isDisposed) throw new Error(UI_TEXT.jsonVerificationUnavailable)
    editor ??= load().createVerifyEditor({ ...deps, redact: redactSecrets }, UI_TEXT, uiLocale())
    return editor
  }
  return {
    diagnosticsAfterEdit: async (files, signal, canReadFile) =>
      await get().diagnosticsAfterEdit(files, signal, canReadFile),
    settleFile: async (absolute, signal) => await get().settleFile(absolute, signal),
    formatAfterEdit: async (absolute, text) => await get().formatAfterEdit(absolute, text),
    dispose: () => {
      isDisposed = true
      editor?.dispose()
    },
  }
}
