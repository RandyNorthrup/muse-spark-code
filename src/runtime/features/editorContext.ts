// The active editor's excerpt as the chat's file chip shows it (M5), from the
// selection the host last reported (MHP `editor/didChangeSelection`).
import { fileURLToPath } from 'node:url'
import { isBelow } from '../../core/workspacePath'
import { pathModule } from '../../core/workspaceRoot'
import { isProtectedPath } from '../../core/protectedPaths'
import type { EditorContext } from '../../core/editorContext'
import { selectionSchema } from '../../shared/hostApi/data'

/** A validated editor excerpt is shared only for a trusted, indexed workspace file. */
export function runtimeEditorContext(
  value: unknown,
  workspaceRoot: string,
  platform: NodeJS.Platform,
  canShare: (relativePath: string) => boolean,
): EditorContext | undefined {
  const parsed = selectionSchema.safeParse(value)
  if (!parsed.success) return
  const { uri, range, excerpt } = parsed.data
  const { start, end } = range
  if (end.line < start.line || (end.line === start.line && end.character < start.character)) return
  const paths = pathModule(platform)
  let relative: string
  try {
    relative = paths.relative(workspaceRoot, fileURLToPath(uri, { windows: platform === 'win32' }))
  } catch (error: unknown) {
    // NARROW: a URI that is not a file path on this platform shares nothing.
    if (error instanceof TypeError) return
    throw error
  }
  if (!isBelow(relative, paths)) return
  relative = relative.replaceAll('\\', '/')
  const isEmpty = start.line === end.line && start.character === end.character
  return {
    relativePath: relative,
    startLine: start.line + 1,
    endLine: end.line + 1,
    isEmpty,
    selectedText:
      !isEmpty && !isProtectedPath(relative) && canShare(relative) ? excerpt : undefined,
  }
}
