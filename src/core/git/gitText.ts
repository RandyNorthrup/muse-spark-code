// The text M71 asks the model for, and reads back (PLAN.md D49): a commit
// message, and a pull request's title and description. Each is generated
// only when the user asks, inside their own turn in the conversation (the
// user's message is the card they see; this adds what the model needs to
// answer it), so nothing is billed beyond that turn and nothing is written
// on the model's behalf. What comes back is only a draft in the form: the
// user edits it, and credential-shaped strings are masked before it is
// shown.
//
// The host reads changes; an injected port continues the user's held draft turn.

import * as z from 'zod/mini'
import {
  COMMIT_SUBJECT_MAX_CHARS,
  GIT_PROMPT_COMMITS_MAX,
  GIT_PROMPT_DIFF_MAX_CHARS,
  GIT_PROMPT_FILES_MAX,
  GIT_MODEL_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { redactSecrets } from '../redact'
import { commitDraftSchema, pullRequestDraftSchema } from '../../shared/sideCallSchemas'
import {
  sideCallContract,
  structuredSideCall,
  type SideCallAttempt,
  type SideCallFormats,
} from '../backends/modelapi/structuredOutput'
import type { TurnPart, TurnSubmission } from '../agent/agentBackend'
import type { GitDraftKind } from '../../shared/git'

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

/** M95/host binding: submit owns the prepared user's turn; request continues
 * that same held turn with its live admission, consent and budget guards. */
export interface GitDraftOutputPort {
  readonly submit?: (parts: readonly TurnPart[], displayText?: string) => Promise<TurnSubmission>
  readonly formats: () => SideCallFormats | undefined
  readonly prepare: (kind: GitDraftKind, attempt: SideCallAttempt, signal: AbortSignal) => void
  readonly request: (
    kind: GitDraftKind,
    attempt: SideCallAttempt,
    signal: AbortSignal,
  ) => Promise<string>
}

export function gitDraftContract(
  kind: GitDraftKind,
  formats: SideCallFormats | undefined,
): SideCallAttempt {
  return kind === 'commitMessage'
    ? sideCallContract(formats, 'commit_draft', commitDraftSchema)
    : sideCallContract(formats, 'pull_request_draft', pullRequestDraftSchema)
}

/** Read the first held reply, repair once, then request the existing text format. */
export async function structuredGitDraft(
  kind: GitDraftKind,
  reply: string,
  formats: SideCallFormats | undefined,
  port: GitDraftOutputPort,
  signal: AbortSignal,
  notice: (text: string) => void,
): Promise<string | PullRequestText | undefined> {
  let isFirst = true
  const request = async (attempt: SideCallAttempt): Promise<string> => {
    if (isFirst) {
      isFirst = false
      return reply
    }
    return await port.request(kind, attempt, signal)
  }
  const common = { formats, request, signal, notice }
  if (kind === 'commitMessage') {
    return await structuredSideCall<string | undefined>({
      ...common,
      name: 'commit_draft',
      schema: z.pipe(
        commitDraftSchema,
        z.transform((answer) => redactSecrets(answer.message)),
      ),
      fallback: commitMessageFrom,
    })
  }
  return await structuredSideCall<PullRequestText | undefined>({
    ...common,
    name: 'pull_request_draft',
    schema: z.pipe(
      pullRequestDraftSchema,
      z.transform((answer) => ({
        title: redactSecrets(answer.title),
        body: redactSecrets(answer.body),
      })),
    ),
    fallback: pullRequestTextFrom,
  })
}

const BACKTICK_RUN = /`+/g
const MIN_FENCE = 3
const LINE_BREAK = /\r?\n/
const TRAILING_BREAK = /\r?\n$/
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
    : `${text.slice(0, max)}\n${fill(GIT_MODEL_TEXT.gitPromptTruncated, { count: String(text.length - max) })}`
}

function listed(items: readonly string[], max: number): string {
  const shown = items.slice(0, max).map((item) => `- ${item}`)
  const rest = items.length - shown.length
  return rest > 0
    ? [...shown, fill(GIT_MODEL_TEXT.gitPromptMore, { count: String(rest) })].join('\n')
    : shown.join('\n')
}

/**
 * A new file as `git diff` shows one, for the commit prompt: `bytes` are
 * its start, `size` its length, and a file cut short or binary says so.
 */
export function newFileDiff(label: string, bytes: Uint8Array, size: number): string {
  const header = `diff --git a/${label} b/${label}\nnew file\n--- /dev/null\n+++ b/${label}`
  if (bytes.includes(0)) {
    return `${header}\nBinary file`
  }
  const lines = new TextDecoder().decode(bytes).replace(TRAILING_BREAK, '').split(LINE_BREAK)
  const cut =
    bytes.length < size
      ? [fill(GIT_MODEL_TEXT.gitPromptTruncated, { count: String(size - bytes.length) })]
      : []
  return [header, ...lines.map((line) => `+${line}`), ...cut].join('\n')
}

/** What the model gets beside the user's own "write a commit message" message. */
export function commitMessagePrompt(facts: CommitPromptFacts): string {
  return [
    fill(GIT_MODEL_TEXT.gitCommitInstructions, { max: String(COMMIT_SUBJECT_MAX_CHARS) }),
    GIT_MODEL_TEXT.gitUntrustedData,
    `${GIT_MODEL_TEXT.gitBranchLabel} ${facts.branch ?? GIT_MODEL_TEXT.gitDetachedHead}`,
    `${facts.scope === 'staged' ? GIT_MODEL_TEXT.gitStagedFilesLabel : GIT_MODEL_TEXT.gitChangedFilesLabel}\n${listed(facts.files, GIT_PROMPT_FILES_MAX)}`,
    fenced(bounded(facts.diff, GIT_PROMPT_DIFF_MAX_CHARS), 'diff'),
  ].join('\n\n')
}

/** What the model gets beside the user's own "write the pull request" message. */
export function pullRequestPrompt(facts: PullRequestPromptFacts): string {
  const commits =
    facts.commits === undefined
      ? `${GIT_MODEL_TEXT.gitCommitsUnavailable} ${facts.commitsUnavailable ?? ''}`.trim()
      : `${GIT_MODEL_TEXT.gitCommitsLabel}\n${fenced(listed(facts.commits, GIT_PROMPT_COMMITS_MAX))}`
  const files =
    facts.files === undefined
      ? []
      : [`${GIT_MODEL_TEXT.gitChangedFilesLabel}\n${listed(facts.files, GIT_PROMPT_FILES_MAX)}`]
  return [
    fill(GIT_MODEL_TEXT.gitPullRequestInstructions, { max: String(COMMIT_SUBJECT_MAX_CHARS) }),
    GIT_MODEL_TEXT.gitUntrustedData,
    `${GIT_MODEL_TEXT.gitBranchLabel} ${facts.head} → ${facts.base}`,
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
