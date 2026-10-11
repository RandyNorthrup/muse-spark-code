import { FILE_EDIT_TOOLS } from './constants'

export interface DiffTallyCounts {
  readonly files: number
  readonly added: number
  readonly removed: number
}

// Both portable history (toolCall) and the panel (tool) carry these captured
// fields. UI-only presentation and translated labels do not affect counting.
interface DiffTallyItem {
  readonly kind: string
  readonly tool?: string | undefined
  readonly args?: string | undefined
  readonly patchSummary?: DiffTallyCounts | undefined
}

/** Conversation edit totals: distinct paths, plus each pathless patch's file count. */
export function diffTally(entries: readonly DiffTallyItem[]): DiffTallyCounts | undefined {
  const paths = new Set<string>()
  let files = 0
  let added = 0
  let removed = 0
  let hasEdit = false

  for (const entry of entries) {
    if (
      (entry.kind !== 'tool' && entry.kind !== 'toolCall') ||
      entry.patchSummary === undefined ||
      entry.tool === undefined ||
      !FILE_EDIT_TOOLS.has(entry.tool)
    ) {
      continue
    }
    hasEdit = true
    let path = ''
    try {
      const args: unknown = JSON.parse(entry.args ?? '{}')
      if (
        typeof args === 'object' &&
        args !== null &&
        'path' in args &&
        typeof args.path === 'string'
      ) {
        path = args.path.replaceAll('\\', '/')
      }
    } catch {
      // A legacy history may lack valid arguments; retain its observed tally.
    }
    if (path === '') {
      files += entry.patchSummary.files
    } else {
      paths.add(path)
    }
    added += entry.patchSummary.added
    removed += entry.patchSummary.removed
  }

  return hasEdit ? { files: files + paths.size, added, removed } : undefined
}
