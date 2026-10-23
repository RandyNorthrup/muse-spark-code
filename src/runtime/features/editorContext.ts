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
  } catch {
    return
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
