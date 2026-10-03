// The text M71 asks the model for, and reads back (PLAN.md D49): a commit
// message, and a pull request's title and description. Each is generated
// only when the user asks, inside their own turn in the conversation (the
// user's message is the card they see; this adds what the model needs to
// answer it), so nothing is billed beyond that turn and nothing is written
// on the model's behalf. What comes back is only a draft in the form: the
// user edits it, and credential-shaped strings are masked before it is
// shown.
//
// Pure: the host reads the changes through VS Code's git extension.

import {
  COMMIT_SUBJECT_MAX_CHARS,
  GIT_PROMPT_COMMITS_MAX,
  GIT_PROMPT_DIFF_MAX_CHARS,
  GIT_PROMPT_FILES_MAX,
  MODEL_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { redactSecrets } from '../redact'

export interface CommitPromptFacts {
  readonly branch: string | undefined
  /** Whether the diff is the staged changes or the whole working tree. */
  readonly scope: 'staged' | 'all'
  readonly files: readonly string[]
  readonly diff: string
}

export interface PullRequestPromptFacts {
  readonly head: string
  readonly base: string
  /** Commit subjects on the branch, newest first; undefined when they could not be read. */
  readonly commits: readonly string[] | undefined
  readonly files: readonly string[] | undefined
  /** Why the commits could not be listed, said to the model instead. */
  readonly commitsUnavailable?: string
}

export interface PullRequestText {
  readonly title: string
  readonly body: string
}

const BACKTICK_RUN = /`+/g
const MIN_FENCE = 3
const LINE_BREAK = /\r?\n/
// A reply the model wrapped whole in a fence: ```lang\n…\n```.
const WHOLE_FENCE = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\1\s*$/
// "# Title", "Title: …" or "**Title**" in front of a pull request's title.
const TITLE_MARKUP = /^(?:#+\s*|title:\s*|\*\*)|\*\*$/gi

/** A fence longer than any run of backticks in `text`, so the text cannot close it. */
function fenceFor(text: string): string {
  const longest = Math.max(
    0,
    ...Array.from(text.matchAll(BACKTICK_RUN), (match) => match[0].length),
  )
  return '`'.repeat(Math.max(MIN_FENCE, longest + 1))
}

function fenced(text: string, language = ''): string {
  const fence = fenceFor(text)
  return `${fence}${language}\n${text}\n${fence}`
}

/** At most `max` characters, and a line saying so when cut. */
function bounded(text: string, max: number): string {
  return text.length <= max
    ? text
    : `${text.slice(0, max)}\n${fill(MODEL_TEXT.gitPromptTruncated, { count: String(text.length - max) })}`
}

function listed(items: readonly string[], max: number): string {
  const shown = items.slice(0, max).map((item) => `- ${item}`)
  const rest = items.length - shown.length
  return rest > 0
    ? [...shown, fill(MODEL_TEXT.gitPromptMore, { count: String(rest) })].join('\n')
    : shown.join('\n')
}

/** What the model gets beside the user's own "write a commit message" message. */
export function commitMessagePrompt(facts: CommitPromptFacts): string {
  return [
    fill(MODEL_TEXT.gitCommitInstructions, { max: String(COMMIT_SUBJECT_MAX_CHARS) }),
    MODEL_TEXT.gitUntrustedData,
    `${MODEL_TEXT.gitBranchLabel} ${facts.branch ?? MODEL_TEXT.gitDetachedHead}`,
    `${facts.scope === 'staged' ? MODEL_TEXT.gitStagedFilesLabel : MODEL_TEXT.gitChangedFilesLabel}\n${listed(facts.files, GIT_PROMPT_FILES_MAX)}`,
    fenced(bounded(facts.diff, GIT_PROMPT_DIFF_MAX_CHARS), 'diff'),
  ].join('\n\n')
}

/** What the model gets beside the user's own "write the pull request" message. */
export function pullRequestPrompt(facts: PullRequestPromptFacts): string {
  const commits =
    facts.commits === undefined
      ? `${MODEL_TEXT.gitCommitsUnavailable} ${facts.commitsUnavailable ?? ''}`.trim()
      : `${MODEL_TEXT.gitCommitsLabel}\n${fenced(listed(facts.commits, GIT_PROMPT_COMMITS_MAX))}`
  const files =
    facts.files === undefined
      ? []
      : [`${MODEL_TEXT.gitChangedFilesLabel}\n${listed(facts.files, GIT_PROMPT_FILES_MAX)}`]
  return [
    fill(MODEL_TEXT.gitPullRequestInstructions, { max: String(COMMIT_SUBJECT_MAX_CHARS) }),
    MODEL_TEXT.gitUntrustedData,
    `${MODEL_TEXT.gitBranchLabel} ${facts.head} → ${facts.base}`,
    commits,
    ...files,
  ].join('\n\n')
}

/** The reply without a fence the model put around all of it. */
function unfenced(reply: string): string {
  const trimmed = reply.trim()
  const match = WHOLE_FENCE.exec(trimmed)
  return (match?.[2] ?? trimmed).trim()
}

/** A draft commit message from the model's reply, masked; undefined when there is none. */
export function commitMessageFrom(reply: string): string | undefined {
  const message = redactSecrets(unfenced(reply))
  return message === '' ? undefined : message
}

/** A draft title and description from the model's reply, masked; undefined without a title. */
export function pullRequestTextFrom(reply: string): PullRequestText | undefined {
  const lines = unfenced(reply).split(LINE_BREAK)
  const titleIndex = lines.findIndex((line) => line.trim() !== '')
  const titleLine = titleIndex === -1 ? undefined : lines[titleIndex]
  if (titleLine === undefined) {
    return undefined
  }
  const title = redactSecrets(titleLine.trim().replaceAll(TITLE_MARKUP, '').trim())
  if (title === '') {
    return undefined
  }
  return {
    title,
    body: redactSecrets(
      lines
        .slice(titleIndex + 1)
        .join('\n')
        .trim(),
    ),
  }
}

/** Whether `text` holds a credential-shaped string the masking would change. */
export function hasCredentialShapes(text: string): boolean {
  return redactSecrets(text) !== text
}
