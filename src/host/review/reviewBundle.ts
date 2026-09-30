// The review as the activation bundle sees it (M70, PLAN.md D6):
// dist/review.js, built from reviewEntry.ts and required the first time a
// review starts. Only types come from core/review/** and reviewCollector here:
// a value imported from there would carry the review back into
// dist/extension.js, which the bundle-split gate (scripts/check-bundle-split.mjs)
// refuses.
//
// There is no fallback without it: a review that cannot load its bundle is
// refused with the reason, the log has the cause, and the next review tries
// again.

import type { PlanModeHold, PlanModeHoldDeps } from '../../core/review/planModeHold'
import type { ReviewTurnInput } from '../../core/review/reviewPrompt'
import { UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { uiLocale } from '../../shared/l10n/text'
import type { EditReviewActions, EditReviewDeps } from '../editor/editReview'
import { forgetFile, requireFile } from '../lazyBundle'
import type { Logger } from '../logger'
import type { GitReviewRequest, ReviewCollection, ReviewCollectorDeps } from './reviewCollector'

/** What a `/review` uses of the bundle: git's material, the turn's text, the mode hold. */
export interface ReviewFeatures {
  /** The request's material from git; asks for a base or a commit the request leaves out. */
  readonly collect: (
    request: GitReviewRequest,
    isStillAllowed: () => boolean,
  ) => Promise<ReviewCollection>
  /** The review turn's text, the material between markers that call it untrusted. */
  readonly turnText: (input: ReviewTurnInput) => string
  /** Fresh random text for those markers. */
  readonly newMarker: () => string
  /** The hold that keeps a Muse Code review in Plan mode and puts the user's mode back. */
  readonly createHold: (deps: PlanModeHoldDeps) => PlanModeHold
  /**
   * Edit review (M5) and the review pane's hunks (M70): they share one read,
   * rebuild and write lane per file, so one instance serves both.
   */
  readonly editReview: EditReviewActions & {
    /** The original text of a `muse-edit:` document; undefined before any diff was opened. */
    readonly provide: (uriPath: string) => string | undefined
  }
}

/** What the conversation uses of the review turn itself: everything but edit review. */
export type ReviewTurnFeatures = Omit<ReviewFeatures, 'editReview'>

/**
 * What the bundle builds its parts from: values and functions of the
 * activation bundle, nothing compared by identity across the two (M57's audit).
 */
export interface ReviewBundleDeps {
  /** The installed table and its language (PLAN.md D33); the bundle has no English of its own. */
  readonly uiText: UiText
  readonly uiLocale: string
  readonly collector: ReviewCollectorDeps
  readonly editReview: EditReviewDeps
}

/** The bundle's one export. */
interface ReviewBundle {
  readonly createReviewFeatures: (deps: ReviewBundleDeps) => ReviewFeatures
}

/**
 * Whether a required module is the bundle: its factory is a function. The
 * factory's signature is taken on trust (PLAN.md §8): both bundles come from
 * one source tree, one `npm run build` and one package.
 */
export function isReviewBundle(value: unknown): value is ReviewBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createReviewFeatures' in value &&
    typeof value.createReviewFeatures === 'function'
  )
}

export interface LazyReviewDeps {
  /** dist/review.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** Undefined without a folder: there is no repository to read. */
  readonly workspaceRoot: string | undefined
  readonly runGit: ReviewCollectorDeps['runGit']
  readonly pickOne: ReviewCollectorDeps['pickOne']
  /** Edit review's ports: the file reads, the checkpointed writes and the diff editor. */
  readonly editReview: EditReviewDeps
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The review's parts, the bundle required the first time any is used and
 * kept from then on. A missing or corrupt bundle throws `reviewUnavailable`
 * and is tried again on the next use.
 */
export function lazyReview(deps: LazyReviewDeps): ReviewFeatures {
  let features: ReviewFeatures | undefined
  const loaded = (): ReviewFeatures => {
    if (features !== undefined) {
      return features
    }
    const { bundlePath, workspaceRoot, loadBundle = requireFile } = deps
    let bundle: unknown
    try {
      bundle = loadBundle(bundlePath)
    } catch (error: unknown) {
      deps.log.error(`The review ${bundlePath} could not be loaded: ${describe(error)}`)
      throw new Error(UI_TEXT.reviewUnavailable, { cause: error })
    }
    if (!isReviewBundle(bundle)) {
      deps.log.error(`${bundlePath} does not export the review`)
      if (deps.loadBundle === undefined) {
        forgetFile(bundlePath)
      }
      throw new Error(UI_TEXT.reviewUnavailable)
    }
    features = bundle.createReviewFeatures({
      uiText: UI_TEXT,
      uiLocale: uiLocale(),
      collector: { workspaceRoot: workspaceRoot ?? '', runGit: deps.runGit, pickOne: deps.pickOne },
      editReview: deps.editReview,
    })
    return features
  }
  return {
    // Without a folder there is no repository; the controller refuses
    // before it asks (no workspace), so this only answers honestly.
    collect: async (request, isStillAllowed) =>
      deps.workspaceRoot === undefined
        ? { kind: 'refused', refusal: 'notRepository' }
        : await loaded().collect(request, isStillAllowed),
    turnText: (input) => loaded().turnText(input),
    newMarker: () => loaded().newMarker(),
    createHold: (holdDeps) => loaded().createHold(holdDeps),
    editReview: {
      openDiff: async (itemId, patchJson) => await loaded().editReview.openDiff(itemId, patchJson),
      revert: async (itemId, patchJson) => await loaded().editReview.revert(itemId, patchJson),
      describe: async (patchJson) => await loaded().editReview.describe(patchJson),
      revertHunk: async (itemId, patchJson, fileIndex, hunkIndex) =>
        await loaded().editReview.revertHunk(itemId, patchJson, fileIndex, hunkIndex),
      // Nothing to serve before the first diff opened the bundle.
      provide: (uriPath) => features?.editReview.provide(uriPath),
    },
  }
}
