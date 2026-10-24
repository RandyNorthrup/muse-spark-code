// Edit review and `/review` in the runtime panel (M104 lane B; M5, M70): int's
// own review bundle (dist/review.js: git's material, the review turn's text,
// the Plan-mode hold, and the patch engine behind Revert and the diff) with
// the runtime's ports. The editor shows the diff (MHP `diff/open`, the
// original text in a file of the data folder); a Revert publishes through the
// same guarded conditional writes the model's tools use, only while the file
// is still what the Revert read and no open editor holds unsaved text there;
// a file a Revert removes goes to the data folder's trash, since the runtime
// has no operating-system trash of its own.
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isSamePath } from '../../core/paths'
import type { ConversationDeps } from '../../host/conversation/conversationController'
import type { EditReviewActions } from '../../host/editor/editReview'
import { createRevertIo } from '../../host/editor/revertIo'
import { canonicalPath, isMissingPath } from '../../host/canonicalPath'
import { writeFileIfUnchanged } from '../../host/fsAtomic'
import type { Logger } from '../../host/logger'
import { lazyReview, type ReviewTurnFeatures } from '../../host/review/reviewBundle'
import { MUSE_EDIT_SCHEME, REVIEW_BUNDLE_FILE, UI_TEXT } from '../../shared/constants'
import type { HostServices } from '../../shared/hostApi/methods'
import { editorPick } from './pick'

export interface RuntimeReviewDeps {
  readonly host: HostServices
  readonly distDir: string
  readonly workspaceRoot: string
  /** The data folder: the original side of a diff and removed files are kept under it. */
  readonly dataFolder: string
  readonly platform: NodeJS.Platform
  readonly runGit: ConversationDeps['runGit']
  /** The documents the editor holds, with whether each has unsaved changes. */
  readonly documents: () => readonly { readonly uri: string; readonly dirty: boolean }[]
  readonly isTrusted: () => boolean
  /** Ends with the conversation. */
  readonly signal: AbortSignal
  readonly log: Logger
}

export interface RuntimeReview {
  readonly review: ReviewTurnFeatures
  readonly editReview: EditReviewActions
  /** Removes the files this review wrote for the editor. */
  dispose(): Promise<void>
}

/** The file's text, or undefined when it does not exist. */
async function readText(fsPath: string): Promise<string | undefined> {
  try {
    return await readFile(fsPath, 'utf8')
  } catch (error: unknown) {
    // NARROW: a file that does not exist is a file with no text; anything else is the caller's.
    if (isMissingPath(error)) return undefined
    throw error
  }
}

export function createRuntimeReview(deps: RuntimeReviewDeps): RuntimeReview {
  const { host, dataFolder, platform } = deps
  const diffFolder = path.join(dataFolder, 'panel-diffs', randomUUID())
  const trashFolder = path.join(dataFolder, 'trash')
  const check = (): void => {
    deps.signal.throwIfAborted()
    if (!deps.isTrusted()) throw new Error(UI_TEXT.reviewCancelled)
  }
  const hasUnsavedChanges = (fsPath: string): boolean =>
    deps.documents().some((document) => {
      if (!document.dirty) return false
      try {
        return isSamePath(fileURLToPath(document.uri), fsPath, platform)
      } catch (error: unknown) {
        // NARROW: an editor document that is not a file on this machine is not the file.
        if (error instanceof TypeError) return false
        throw error
      }
    })
  const pick = editorPick(host, deps.signal)
  const reviewing = lazyReview({
    bundlePath: path.join(deps.distDir, REVIEW_BUNDLE_FILE),
    log: deps.log,
    workspaceRoot: deps.workspaceRoot,
    runGit: deps.runGit,
    pickOne: async (items, title, placeholder) => {
      check()
      const picked = await pick(items, title, placeholder)
      check()
      return picked
    },
    editReview: {
      platform,
      workspaceRoot: deps.workspaceRoot,
      readFile: readText,
      realPath: canonicalPath,
      hasUnsavedChanges,
      withAdmission: async (work) => {
        check()
        return await work(check)
      },
      io: createRevertIo({
        io: {
          hasUnsavedChanges,
          writeFileIfUnchanged: async (absolutePath, expectedFingerprint, content, options) =>
            await writeFileIfUnchanged(absolutePath, expectedFingerprint, content, {
              sleep: delay,
              assertCanWrite: () => {
                options.assertCanWrite?.()
              },
              expectedCanonicalPath: options.expectedCanonicalPath,
              platform,
              isReplaceable: () => options.unsavedAt.every((open) => !hasUnsavedChanges(open)),
              ...(options.staged !== undefined && { staged: options.staged }),
            }),
        },
        platform,
        trash: async (absolutePath) => {
          const target = path.join(trashFolder, randomUUID(), path.basename(absolutePath))
          await mkdir(path.dirname(target), { recursive: true })
          try {
            await rename(absolutePath, target)
          } catch (error: unknown) {
            // NARROW: a move across volumes is a copy and a removal; anything else is the revert's to report.
            if (!(error instanceof Error) || !('code' in error) || error.code !== 'EXDEV')
              throw error
            await copyFile(absolutePath, target)
            await rm(absolutePath)
          }
        },
      }),
      openDiff: async (beforeUri, fsPath, title) => {
        check()
        const before = reviewing.editReview.provide(beforeUri.slice(`${MUSE_EDIT_SCHEME}:`.length))
        if (before === undefined) throw new Error(UI_TEXT.editReviewFailed)
        // The editor reads the original side as a file of the data folder.
        const original = path.join(diffFolder, randomUUID(), path.basename(fsPath))
        await mkdir(path.dirname(original), { recursive: true, mode: 0o700 })
        await writeFile(original, before, { mode: 0o600 })
        await host.request(
          'diff/open',
          { left: pathToFileURL(original).href, right: pathToFileURL(fsPath).href, title },
          deps.signal,
        )
      },
      log: deps.log,
    },
  })
  const { editReview, ...turn } = reviewing
  const isActive = (): boolean => !deps.signal.aborted && deps.isTrusted()
  const review: ReviewTurnFeatures = {
    ...turn,
    // A review of a conversation that was let go, or of a workspace no longer trusted, stops.
    collect: async (request, isStillAllowed) =>
      isActive()
        ? await turn.collect(request, () => isActive() && isStillAllowed())
        : { kind: 'cancelled' },
  }
  return {
    review,
    editReview,
    dispose: async () => {
      await rm(diffFolder, { recursive: true, force: true })
    },
  }
}
