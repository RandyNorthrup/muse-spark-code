// Shared diff-hunks scenario pieces (RLF-M104GL): the stored patch document
// and the review's io-independent deps, driven by the VS Code conformance
// suite and the native headless driver alike.
import { readFile } from 'node:fs/promises'
import type { ToolIo } from '../../../src/core/backends/modelapi/tools'
import { canonicalPath } from '../../../src/host/canonicalPath'
import type { EditReviewDeps } from '../../../src/host/editor/editReview'

// The stored tool_patch document for the scenario's forward edit, as the
// edit tools leave it (src/shared/patchDocument.ts): two hunks, one per
// changed line. The review parses it before anything is settled.
export function scenarioDiffPatchJson(): string {
  return JSON.stringify({
    files: [
      {
        path: 'lines.txt',
        hunks: [
          { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-l1', '+l1c'] },
          { oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, lines: ['-l2', '+l2c'] },
        ],
      },
    ],
  })
}

type ReviewDriverBase = Pick<
  EditReviewDeps,
  'platform' | 'workspaceRoot' | 'readFile' | 'realPath' | 'hasUnsavedChanges' | 'withAdmission'
>

export function reviewDriverBase(
  toolIo: Pick<ToolIo, 'hasUnsavedChanges'>,
  workspaceRoot: string,
): ReviewDriverBase {
  return {
    platform: process.platform,
    workspaceRoot,
    readFile: async (fsPath) => {
      try {
        return await readFile(fsPath, 'utf8')
      } catch {
        return undefined
      }
    },
    realPath: canonicalPath,
    hasUnsavedChanges: (fsPath) => toolIo.hasUnsavedChanges(fsPath),
    // The single-threaded driver runs no concurrent restore to hold out.
    withAdmission: (work) => work(() => undefined),
  }
}
