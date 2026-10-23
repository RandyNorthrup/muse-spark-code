import { fileURLToPath } from 'node:url'
import { decodeTransferBytes, readPickedFile } from '../../host/backend/toolIo'
import { canonicalPath } from '../../host/canonicalPath'
import type { SessionTransferFiles } from '../../host/conversation/sessionImport'
import { uriSchema } from '../../shared/hostApi/data'
import { UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { runtimeFeatureLifetime } from './lifetime'

export interface RuntimeTransferDeps {
  readonly platform: NodeJS.Platform
  /** A native file chooser's URI; never a model-selected path. */
  readonly pickFile: (title: string, signal: AbortSignal) => Promise<string | undefined>
  readonly confirm: (title: string, detail: string, signal: AbortSignal) => Promise<boolean>
  readonly assertCurrent: () => void
  readonly cancelPrompts: () => void
}

/** A picked local file reaches the real strict import parser, bounded and without live handles. */
export function createRuntimeTransferFiles(
  deps: RuntimeTransferDeps,
  table: UiText,
  locale: string,
) {
  setUiText(table, locale)
  const lifetime = runtimeFeatureLifetime(deps.assertCurrent, deps.cancelPrompts)
  const { check, track, signal } = lifetime
  const files: SessionTransferFiles = {
    pickTransferFile: (title) =>
      track(async () => {
        const picked = await deps.pickFile(title, signal)
        check()
        if (picked === undefined) return { kind: 'dismissed' }
        const uri = uriSchema.parse(picked)
        if (!uri.startsWith('file:')) throw new Error(UI_TEXT.transferLocalFileOnly)
        const target = fileURLToPath(uri, { windows: deps.platform === 'win32' })
        const expected = await canonicalPath(target)
        check()
        // A share file reads whole at any size (D121: the size ceiling was
        // invented), so every file written can be read back.
        const { bytes, isMissing } = await readPickedFile(target, Infinity, expected, Infinity)
        check()
        if (isMissing || bytes === undefined) throw new Error(UI_TEXT.transferFileMissing)
        return { kind: 'read', content: decodeTransferBytes(bytes) }
      }),
    confirmImport: (title, detail) => track(() => deps.confirm(title, detail, signal)),
  }
  return {
    files,
    dispose: lifetime.dispose,
  }
}
