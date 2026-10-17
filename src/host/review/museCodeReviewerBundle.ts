// The Auto reviewer on Muse Code as the window sees it (M90, PLAN.md D6,
// D69): dist/museCodeReviewer.js, built from museCodeReviewerEntry.ts and
// required on the first review. Only types come from the reviewer's side
// here: a value imported from there would carry it, and M78's reviewer core
// (which otherwise loads only with the Model API backend), back into
// dist/extension.js, which the bundle-split gate refuses.

import { failureForLog } from '../../core/backends/musecode/logText'
import { UI_TEXT } from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type { MuseCodeReviewer } from './museCodeReviewer'
import type * as ReviewerEntry from './museCodeReviewerEntry'

/** The bundle's one export. */
export interface MuseCodeReviewerBundle {
  readonly createMuseCodeReviewer: typeof ReviewerEntry.createMuseCodeReviewer
}

/** Whether a required module exports the reviewer's factory. */
export function isMuseCodeReviewerBundle(value: unknown): value is MuseCodeReviewerBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createMuseCodeReviewer' in value &&
    typeof value.createMuseCodeReviewer === 'function'
  )
}

/** What a conversation asks of the window's reviewer. */
export interface MuseCodeReviewerPort {
  /** `museSpark.museCodeAutoReviewer`, read for each approval. */
  readonly isOn: () => boolean
  /**
   * The window's reviewer, its bundle required on the first call; throws
   * when the bundle cannot be loaded (the log has why).
   */
  readonly reviewer: () => MuseCodeReviewer
  /** Whether a session is one of the reviewer's side sessions: no History lists it. */
  readonly isSideSession: (sessionId: string) => boolean
  readonly dispose: () => void
}

export interface MuseCodeReviewerPortDeps {
  /** dist/museCodeReviewer.js beside the running bundle. */
  readonly bundlePath: string
  /** The empty folder the side session runs in (MUSE_CODE_REVIEWER_DIR). */
  readonly root: string
  readonly isOn: () => boolean
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

/** The window's reviewer port: the bundle and the reviewer, made on first use. */
export function museCodeReviewerPort(deps: MuseCodeReviewerPortDeps): MuseCodeReviewerPort {
  const load = lazyBundleLoader({
    bundlePath: deps.bundlePath,
    log: deps.log,
    loadBundle: deps.loadBundle,
    isBundle: isMuseCodeReviewerBundle,
    label: 'Auto reviewer bundle',
    unavailable: () => UI_TEXT.autoReviewerFailed,
  })
  const sideSessionIds = new Set<string>()
  let reviewer: MuseCodeReviewer | undefined
  return {
    isOn: deps.isOn,
    reviewer: () => {
      reviewer ??= load().createMuseCodeReviewer(
        {
          root: deps.root,
          log: deps.log,
          onSideSession: (sessionId) => {
            sideSessionIds.add(sessionId)
          },
          describeFailure: failureForLog,
        },
        UI_TEXT,
        uiLocale(),
      )
      return reviewer
    },
    isSideSession: (sessionId) => sideSessionIds.has(sessionId),
    dispose: () => {
      reviewer?.dispose()
    },
  }
}
