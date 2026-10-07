import { MUSE_EDIT_SCHEME, UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { withCheckpointEdit, type CheckpointPort } from '../../host/checkpoints/checkpointHost'
import {
  EditReview,
  type EditReviewActions,
  type EditReviewDeps,
} from '../../host/editor/editReview'
import { createRevertIo, type RevertIoDeps } from '../../host/editor/revertIo'
import type { Logger } from '../../host/logger'

export interface RuntimeEditReviewDeps {
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly readFile: EditReviewDeps['readFile']
  readonly realPath: EditReviewDeps['realPath']
  readonly io: RevertIoDeps['io']
  readonly trash: RevertIoDeps['trash']
  readonly checkpoints: CheckpointPort
  /** Live trust, workspace identity and owning conversation generation. */
  readonly assertCurrent: () => void
  readonly beginEdit?: EditReviewDeps['beginEdit']
  /** C owns the native/React diff surface; no VS Code URI provider is needed. */
  readonly openDiff: (before: string, target: string, title: string) => Promise<void>
  readonly log: Logger
}

/** The existing patch engine, with portable presentation and awaited release. */
export function createRuntimeEditReview(
  deps: RuntimeEditReviewDeps,
  table: UiText,
  locale: string,
) {
  setUiText(table, locale)
  let isDisposed = false
  let closing: Promise<void> | undefined
  const pending = new Set<Promise<unknown>>()
  const check = () => {
    if (isDisposed) throw new Error('MHP_FEATURE_RELEASED')
    deps.assertCurrent()
  }
  const engine = new EditReview({
    workspaceRoot: deps.workspaceRoot,
    platform: deps.platform,
    readFile: async (file) => {
      check()
      const text = await deps.readFile(file)
      check()
      return text
    },
    realPath: async (file) => {
      check()
      const canonical = await deps.realPath(file)
      check()
      return canonical
    },
    hasUnsavedChanges: (file) => deps.io.hasUnsavedChanges(file),
    ...(deps.beginEdit !== undefined && { beginEdit: deps.beginEdit }),
    withAdmission: async (work) =>
      await withCheckpointEdit(deps.checkpoints, deps.log, check, async () => await work(check)),
    io: createRevertIo(deps),
    openDiff: async (uri, target, title) => {
      check()
      const before = engine.provide(uri.slice(`${MUSE_EDIT_SCHEME}:`.length))
      if (before === undefined) throw new Error(UI_TEXT.editReviewFailed)
      await deps.openDiff(before, target, title)
      check()
    },
    log: deps.log,
  })
  async function track<T>(work: () => Promise<T>): Promise<T> {
    check()
    const running = work()
    pending.add(running)
    try {
      return await running
    } finally {
      pending.delete(running)
    }
  }
  const review: EditReviewActions = {
    openDiff: (item, patch) => track(() => engine.openDiff(item, patch)),
    describe: (patch) => track(() => engine.describe(patch)),
    revert: (item, patch, assertConversation) =>
      track(() =>
        engine.revert(item, patch, () => {
          check()
          assertConversation?.()
        }),
      ),
    revertHunk: (item, patch, file, hunk) =>
      track(() => engine.revertHunk(item, patch, file, hunk)),
  }
  return {
    review,
    dispose: (): Promise<void> => {
      isDisposed = true
      closing ??= (async () => {
        await Promise.allSettled(pending)
        engine.dispose()
      })()
      return closing
    },
  }
}
