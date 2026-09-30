// `/review …` typed in the prompt (M70, PLAN.md D49), and the request it
// becomes on the wire to the host:
//
//   /review                        the uncommitted changes
//   /review branch [base]          the branch against its base (picked when absent)
//   /review commit [revision]      one commit (picked when absent)
//   /review <what to look at>      custom instructions; git is not needed
//   /review security …             any of the above, for security
//
// A keyword counts only where the grammar puts it and is followed by at most
// one revision word, so `/review branch naming in utils` is custom text.
// Pure; the webview posts the request instead of sending a message.

import * as z from 'zod/mini'
import {
  REVIEW_FOCUSES,
  REVIEW_INSTRUCTIONS_MAX_CHARS,
  REVIEW_KEYWORDS,
  REVIEW_REF_MAX_CHARS,
  REVIEW_SLASH_COMMAND,
} from './constants'

// A git revision word: no whitespace or control character, and never a
// leading dash, so it cannot be read as one of git's options.
const REVISION = /^[^\s\-\p{Cc}][^\s\p{Cc}]*$/u
const revisionSchema = z.string().check(z.maxLength(REVIEW_REF_MAX_CHARS), z.regex(REVISION))
const focusSchema = z.enum(REVIEW_FOCUSES)

export const reviewRequestSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('uncommitted'), focus: focusSchema }),
  z.object({ scope: z.literal('branch'), focus: focusSchema, base: z.optional(revisionSchema) }),
  z.object({ scope: z.literal('commit'), focus: focusSchema, commit: z.optional(revisionSchema) }),
  z.object({
    scope: z.literal('custom'),
    focus: focusSchema,
    instructions: z
      .string()
      .check(z.trim(), z.minLength(1), z.maxLength(REVIEW_INSTRUCTIONS_MAX_CHARS)),
  }),
])
export type ReviewRequest = z.infer<typeof reviewRequestSchema>

const PROMPT = new RegExp(String.raw`^\/${REVIEW_SLASH_COMMAND}(?:\s+([\s\S]*))?$`)
const WORDS = /\s+/

/** Whether `word` is the keyword, whatever its case. */
function isKeyword(word: string | undefined, keyword: string): boolean {
  return word?.toLowerCase() === keyword
}

/** The scope the words after the focus name; undefined when they are custom text. */
function gitScopeOf(
  words: readonly string[],
  focus: ReviewRequest['focus'],
): ReviewRequest | undefined {
  const [first, revision, ...rest] = words
  if (first === undefined) {
    return { scope: 'uncommitted', focus }
  }
  if (rest.length > 0 || (revision !== undefined && !REVISION.test(revision))) {
    return undefined
  }
  if (isKeyword(first, REVIEW_KEYWORDS.branch)) {
    return { scope: 'branch', focus, ...(revision !== undefined && { base: revision }) }
  }
  return isKeyword(first, REVIEW_KEYWORDS.commit)
    ? { scope: 'commit', focus, ...(revision !== undefined && { commit: revision }) }
    : undefined
}

/**
 * The review a prompt asks for, or undefined for any other text. Text too
 * long for custom instructions is still a review request; the host is never
 * sent more than the schema allows, so the caller checks it.
 */
export function parseReviewPrompt(text: string): ReviewRequest | undefined {
  const match = PROMPT.exec(text.trim())
  if (match === null) {
    return undefined
  }
  const rest = (match[1] ?? '').trim()
  const words = rest === '' ? [] : rest.split(WORDS)
  const isSecurity = isKeyword(words[0], REVIEW_KEYWORDS.security)
  const focus = isSecurity ? 'security' : 'general'
  const scoped = isSecurity ? words.slice(1) : words
  const gitScope = gitScopeOf(scoped, focus)
  if (gitScope !== undefined) {
    return gitScope
  }
  const instructions = isSecurity ? rest.slice(words[0]?.length ?? 0).trim() : rest
  return { scope: 'custom', focus, instructions }
}

/** The prompt that asks for `request`: what its card shows when a palette row started it. */
export function reviewCommandText(request: ReviewRequest): string {
  const words: string[] = [`/${REVIEW_SLASH_COMMAND}`]
  if (request.focus === 'security') {
    words.push(REVIEW_KEYWORDS.security)
  }
  switch (request.scope) {
    case 'uncommitted': {
      break
    }
    case 'branch': {
      words.push(REVIEW_KEYWORDS.branch, ...(request.base === undefined ? [] : [request.base]))
      break
    }
    case 'commit': {
      words.push(REVIEW_KEYWORDS.commit, ...(request.commit === undefined ? [] : [request.commit]))
      break
    }
    case 'custom': {
      words.push(request.instructions)
      break
    }
  }
  return words.join(' ')
}

/** Whether the review reads git's changes, which Restricted Mode does not run. */
export function isGitReview(request: ReviewRequest): boolean {
  return request.scope !== 'custom'
}
