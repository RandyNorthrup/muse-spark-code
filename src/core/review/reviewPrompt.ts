// The text of a review turn (M70, PLAN.md D49), the same on both backends:
// what to review, the security preset's focus, the findings block to end
// with, and the material from git between random markers that call it
// untrusted data. Muse Code has no Reviewer prompt, so its review turn opens
// with the role and the method (the Model API's Reviewer carries them in its
// own instructions). Model text: English whatever the display language.

import {
  REVIEW_MODEL_TEXT,
  REVIEW_FILES_LISTED_MAX,
  REVIEW_FINDINGS_EMPTY,
  REVIEW_FINDINGS_EXAMPLE,
  REVIEW_FINDINGS_LANGUAGE,
  REVIEW_MARKER_ATTEMPTS,
  REVIEW_SEVERITIES,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { ReviewRequest } from '../../shared/reviewCommand'
import type { ReviewMaterial, ReviewSubject } from './reviewMaterial'

const PARAGRAPH = '\n\n'
const LINE = '\n'
const LIST_SEPARATOR = ', '
const LIST_ITEM = '- '

/** A list of files, cut at REVIEW_FILES_LISTED_MAX with the count left. */
function listed(lead: string, files: readonly string[]): string | undefined {
  if (files.length === 0) {
    return undefined
  }
  const shown = files.slice(0, REVIEW_FILES_LISTED_MAX).map((file) => `${LIST_ITEM}${file}`)
  const rest = files.length - shown.length
  return [
    lead,
    ...shown,
    ...(rest > 0 ? [fill(REVIEW_MODEL_TEXT.reviewListCut, { count: String(rest) })] : []),
  ].join(LINE)
}

function scopeText(subject: ReviewSubject): string {
  switch (subject.kind) {
    case 'uncommitted': {
      return subject.hasCommits
        ? REVIEW_MODEL_TEXT.reviewScopeUncommitted
        : REVIEW_MODEL_TEXT.reviewScopeUnborn
    }
    case 'branch': {
      // The branch's own name is the repository's words: it goes with the material.
      return fill(REVIEW_MODEL_TEXT.reviewScopeBranch, {
        base: subject.base,
        mergeBase: subject.mergeBase,
      })
    }
    case 'commit': {
      return fill(REVIEW_MODEL_TEXT.reviewScopeCommit, { commit: subject.commit })
    }
  }
}

/** Everything git said, as it goes between the markers. */
function materialBody(material: ReviewMaterial): string {
  const { subject } = material
  const sections = [
    subject.kind === 'branch'
      ? fill(REVIEW_MODEL_TEXT.reviewBranchName, { branch: subject.branch })
      : undefined,
    listed(REVIEW_MODEL_TEXT.reviewChangedFiles, material.changedFiles),
    subject.kind === 'commit'
      ? `${REVIEW_MODEL_TEXT.reviewCommitMessage}${LINE}${subject.message}`
      : undefined,
    material.fullLength === undefined
      ? undefined
      : fill(REVIEW_MODEL_TEXT.reviewTruncated, { chars: String(material.diff.length) }),
    material.diff === '' ? undefined : `${REVIEW_MODEL_TEXT.reviewDiff}${LINE}${material.diff}`,
    listed(REVIEW_MODEL_TEXT.reviewUntracked, material.untracked),
    listed(REVIEW_MODEL_TEXT.reviewPrivateLeftOut, material.privateFiles),
  ]
  return sections.filter((section) => section !== undefined).join(PARAGRAPH)
}

/**
 * The material between a fresh pair of markers that nothing in it contains,
 * so it cannot end its own untrusted block. `newMarker` is random; a marker
 * already in the material means it is not, and the review is refused.
 */
function fenced(material: ReviewMaterial, newMarker: () => string): string {
  const body = materialBody(material)
  for (let attempt = 0; attempt < REVIEW_MARKER_ATTEMPTS; attempt += 1) {
    const marker = newMarker()
    const open = fill(REVIEW_MODEL_TEXT.reviewMaterialOpen, { marker })
    const close = fill(REVIEW_MODEL_TEXT.reviewMaterialClose, { marker })
    if (!body.includes(marker)) {
      return [fill(REVIEW_MODEL_TEXT.reviewUntrusted, { open, close }), open, body, close].join(
        LINE,
      )
    }
  }
  throw new Error('the review material holds every marker tried for it')
}

export interface ReviewTurnInput {
  readonly request: ReviewRequest
  /** What git said; undefined for custom instructions, which read no git. */
  readonly material: ReviewMaterial | undefined
  /** The role and the method in the text: the backend has no Reviewer prompt (Muse Code). */
  readonly isRoleIncluded: boolean
  readonly newMarker: () => string
}

/** What the review looks at: the user's words, or what git's material covers. */
function scopeOf(request: ReviewRequest, material: ReviewMaterial | undefined): string | undefined {
  if (request.scope === 'custom') {
    return `${REVIEW_MODEL_TEXT.reviewScopeCustom}${LINE}${request.instructions}`
  }
  return material === undefined ? undefined : scopeText(material.subject)
}

/** The review turn's text. */
export function reviewTurnText(input: ReviewTurnInput): string {
  const { request, material } = input
  const scope = scopeOf(request, material)
  const sections = [
    ...(input.isRoleIncluded
      ? [REVIEW_MODEL_TEXT.reviewMuseCodeRole, REVIEW_MODEL_TEXT.reviewMethod]
      : []),
    scope,
    request.focus === 'security' ? REVIEW_MODEL_TEXT.reviewSecurityFocus : undefined,
    fill(REVIEW_MODEL_TEXT.reviewAnswer, {
      language: REVIEW_FINDINGS_LANGUAGE,
      example: REVIEW_FINDINGS_EXAMPLE,
      severities: REVIEW_SEVERITIES.join(LIST_SEPARATOR),
      empty: REVIEW_FINDINGS_EMPTY,
    }),
    material === undefined ? undefined : fenced(material, input.newMarker),
  ]
  return sections.filter((section) => section !== undefined).join(PARAGRAPH)
}
