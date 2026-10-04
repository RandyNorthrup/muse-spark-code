import type { TranscriptEntry } from './state/transcriptEntries'
import { describeTool } from './toolPresentation'

export interface DiffTallyCounts {
  readonly files: number
  readonly added: number
  readonly removed: number
}

/** Conversation edit totals: distinct paths, plus each pathless patch's file count. */
export function diffTally(entries: readonly TranscriptEntry[]): DiffTallyCounts | undefined {
  const paths = new Set<string>()
  let files = 0
  let added = 0
  let removed = 0
  let hasEdit = false

  for (const entry of entries) {
    if (entry.kind !== 'tool' || entry.patchSummary === undefined) {
      continue
    }
    const presentation = describeTool(entry.tool, entry.args)
    if (presentation.body !== 'edit') {
      continue
    }
    hasEdit = true
    if (presentation.summary === '') {
      files += entry.patchSummary.files
    } else {
      paths.add(presentation.summary)
    }
    added += entry.patchSummary.added
    removed += entry.patchSummary.removed
  }

  return hasEdit ? { files: files + paths.size, added, removed } : undefined
}
