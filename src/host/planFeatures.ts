// The VS Code side of plans as files (M79, PLAN.md D49): the plan store over
// the file system, and the Plans… picks. The flow lives in
// commands/planCommands.ts, the files in core/plans/planStore.ts, and what a
// plan does in the conversation in conversation/conversationController.ts.

import { lstat, rm } from 'node:fs/promises'
import path from 'node:path'
import type { PlanMarkdown } from '../core/plans/planDocument'
import { isSamePath } from '../core/paths'
import {
  type PlanDirectoryEntry,
  type PlanIo,
  PlanStore,
  type PlanStoreDeps,
} from '../core/plans/planStore'
import {
  ATOMIC_TEMPORARY_SUFFIX,
  PLAN_FILE_MODE,
  PLAN_STAGE_STALE_MS,
  UI_TEXT,
} from '../shared/constants'
import { entriesByKind } from './backend/memoryIo'
import { readPickedFile } from './backend/toolIo'
import { canonicalPath } from './canonicalPath'
import { choosePlan } from './commands/planCommands'
import type { PickOne } from './commands/pickItem'
import type { PlanFiles } from './conversation/conversationController'
import { createFileExclusively, isNameTaken, isOwnedFile } from './fsAtomic'
import type { Logger } from './logger'

// A save's hidden stage: `.<name>.<uuid><suffix>` (createFileExclusively).
const STAGE_NAME = new RegExp(
  String.raw`^\..+\.[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}${ATOMIC_TEMPORARY_SUFFIX.replaceAll('.', String.raw`\.`)}$`,
  'u',
)
const MISSING = 'ENOENT'

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}

/**
 * A folder's entries by kind, a link or junction reported as neither file
 * nor folder; none when the folder does not exist. Anything else (a file
 * where the folder should be) rejects, so it is not taken for "no plans".
 */
async function listPlanEntries(absolutePath: string): Promise<readonly PlanDirectoryEntry[]> {
  try {
    return await entriesByKind(absolutePath)
  } catch (error: unknown) {
    if (errorCode(error) === MISSING) {
      return []
    }
    throw error
  }
}

export interface PlanIoOptions {
  readonly log: Logger
  readonly now: () => number
  /** Replace the hard-link call in a deterministic publication test. */
  readonly publish?: (stage: string, target: string) => Promise<void>
}

/** The plan store's file access: no-clobber creation, bounded checked reads, entries by kind. */
export function createPlanIo(options: PlanIoOptions): PlanIo {
  const { log } = options
  return {
    realPath: canonicalPath,
    async createFile(absolutePath, content) {
      try {
        await createFileExclusively(absolutePath, content, {
          mode: PLAN_FILE_MODE,
          // The path is the checked canonical target: its folder is the checked folder.
          expectedDirectory: path.dirname(absolutePath),
          // The stage's name holds the plan's, which is the user's words: not logged (M39).
          warn: (_stage, isPublished, error) => {
            const when = isPublished ? 'after the plan was published' : 'after the save failed'
            log.warn(
              `A plan's hidden stage could not be removed ${when} (${String(errorCode(error))})`,
            )
          },
          ...(options.publish !== undefined && { publish: options.publish }),
        })
        return true
      } catch (error: unknown) {
        if (isNameTaken(error)) {
          return false
        }
        throw error
      }
    },
    // A plan is text: a file that starts like a PDF gets no larger limit.
    readFile: (absolutePath, maxBytes, expectedCanonicalPath) =>
      readPickedFile(absolutePath, maxBytes, expectedCanonicalPath, maxBytes),
    listEntries: listPlanEntries,
    async removeStaleStages(absolutePath) {
      const entries = await listPlanEntries(absolutePath)
      let removed = 0
      for (const entry of entries) {
        if (entry.kind !== 'file' || !STAGE_NAME.test(entry.name)) {
          continue
        }
        const stage = path.join(absolutePath, entry.name)
        try {
          const stats = await lstat(stage)
          if (stats.isFile() && options.now() - stats.mtimeMs > PLAN_STAGE_STALE_MS) {
            if (
              !isSamePath(await canonicalPath(stage), stage, process.platform) ||
              !(await isOwnedFile(stage, stats))
            ) {
              continue
            }
            await rm(stage, { force: true })
            removed += 1
          }
        } catch (error: unknown) {
          log.warn(`A stale plan stage could not be removed (${String(errorCode(error))})`)
        }
      }
      if (removed > 0) {
        log.info(`Removed ${String(removed)} stale plan stage(s)`)
      }
    },
  }
}

export interface PlanFeatureDeps {
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  /** `createPlanIo` over the file system. */
  readonly io: PlanIo
  readonly pick: PickOne
  /** A modal; true when the user chose `action`. */
  readonly confirm: (message: string, detail: string, action: string) => Promise<boolean>
  /** The plan reader, dist/planMarkdown.js on first use (`planMarkdownLoader`). */
  readonly markdown: () => PlanMarkdown
  readonly beginEdit?: PlanStoreDeps['beginEdit']
  readonly captureOwner?: PlanFiles['captureOwner']
}

export function createPlanFiles(deps: PlanFeatureDeps): PlanFiles {
  const store = new PlanStore({
    workspaceRoot: deps.workspaceRoot,
    platform: deps.platform,
    io: deps.io,
    markdown: deps.markdown,
    ...(deps.beginEdit !== undefined && { beginEdit: deps.beginEdit }),
  })
  return {
    ...(deps.captureOwner !== undefined && { captureOwner: deps.captureOwner }),
    markdown: deps.markdown,
    find: (content) => store.find(content),
    save: (content, ownerRecorder) => store.save(content, ownerRecorder),
    has: (fileName) => store.has(fileName),
    read: (fileName) => store.read(fileName),
    list: () => store.list(),
    confirmSave: () =>
      deps.confirm(UI_TEXT.planSaveConfirm, UI_TEXT.planSaveConfirmDetail, UI_TEXT.savePlan),
    choose: (plans) => choosePlan(plans, deps.pick),
  }
}
