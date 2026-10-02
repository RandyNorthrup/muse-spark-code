// Step 9 of the Action (M80, SPEC §6.6): one bot-owned sticky review comment,
// only for a valid completed result. The comment is exec's already-redacted
// final message with the token redacted again, every @ defused with a
// zero-width separator, and the cap applied only after redaction. A footer
// names the model, requests, settled and uncertain cost, images and the run.
// A failure goes to the step summary only.

import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import {
  ACTION_COMMENT_MAX_CHARS,
  ACTION_POST_MS,
  ACTION_RESULT_MAX_BYTES,
  createLauncherOwner,
  isEntry,
  redactLiterals,
} from './lifecycle.mjs'
import { isExecResult } from './result.mjs'
import { actionPaths, githubJson, httpsBase, invocationFromEnv } from './tools.mjs'

export const STICKY_MARKER = '<!-- muse-spark-code-action:review -->'
// An @ followed by U+200B ZERO WIDTH SPACE.
const DEFUSED_AT = String.fromCodePoint(0x40, 0x20_0b)
const CUT_NOTICE = '\n\n(The message was cut to fit a comment.)'
const COMMENT_PAGES_MAX = 30
const PER_PAGE = 100
const WITHHELD = Object.freeze({
  binary:
    'the change includes a binary file (a generated image included), so the whole patch is withheld',
  secret: 'the secret scan found a credential-shaped value in the patch',
  scan_failed: 'the secret scan did not finish',
  no_result: 'the run left no valid result',
  cancelled: 'the run was cancelled before publication',
  limit: 'an output bound stopped the run',
  not_completed: 'the run did not complete',
})

/** Every @ followed by a zero-width space, so no mention or team ping fires. */
export function defuseMentions(text) {
  return text.replaceAll('@', () => DEFUSED_AT)
}

/** At most `max` UTF-16 units, never ending inside a surrogate pair. */
function cut(text, max) {
  if (text.length <= max) return text
  const end = /[\uD800-\uDBFF]/.test(text.charAt(max - 1)) ? max - 1 : max
  return text.slice(0, Math.max(0, end))
}

function usd(value) {
  return `$${value.toFixed(6)}`
}

function footerFor(result, runUrl) {
  const cost = result.usage.costUsd
  const paid = result.usage.paid
  const costText =
    cost === null
      ? 'cost n/a'
      : `${usd(cost.settled)} settled, ${usd(cost.uncertain + cost.reserved)} uncertain${cost.isUpperBound ? ' (total is an upper bound)' : ''}`
  return [
    `Model ${result.model ?? 'n/a'}`,
    `${String(result.usage.requests ?? 'n/a')} requests`,
    costText,
    `images: ${String(paid.imagesReturned)} returned, ${String(paid.imagesUncertain)} uncertain`,
    `[run](${runUrl})`,
  ].join(' · ')
}

function fixNotice({ result, artifactName, patchWithheld, patchPublished }) {
  if (patchPublished) {
    const files = result.filesChanged.length === 0 ? 'none listed' : result.filesChanged.join(', ')
    return `Proposed patch: artifact \`${artifactName}\`; files: ${files}. A maintainer reads it before approving the push.`
  }
  return patchWithheld === ''
    ? 'No file changed, so there is no patch.'
    : `No patch was published: ${WITHHELD[patchWithheld] ?? patchWithheld}.`
}

/**
 * The comment body: marker, the redacted and defused final message cut to
 * fit, the fix notice (fix mode) and the footer, ACTION_COMMENT_MAX_CHARS in all.
 */
export function commentBody({
  result,
  runUrl,
  artifactName,
  mode,
  patchWithheld,
  patchPublished,
  literals,
}) {
  const head = `${STICKY_MARKER}\n`
  const notice =
    mode === 'fix'
      ? `${defuseMentions(fixNotice({ result, artifactName, patchWithheld, patchPublished }))}\n\n`
      : ''
  const tail = `\n\n${notice}---\n${defuseMentions(footerFor(result, runUrl))}\n`
  const message = defuseMentions(redactLiterals(result.finalMessage, literals))
  const room = ACTION_COMMENT_MAX_CHARS - head.length - tail.length
  const fitted =
    message.length <= room ? message : `${cut(message, room - CUT_NOTICE.length)}${CUT_NOTICE}`
  return `${head}${fitted}${tail}`
}

/** The existing bot-owned sticky comment's id, or null. */
async function findSticky({ fetch, apiUrl, repository, prNumber, token, signal }) {
  for (let page = 1; page <= COMMENT_PAGES_MAX; page += 1) {
    const comments = await githubJson({
      fetch,
      url: `${apiUrl}/repos/${repository}/issues/${String(prNumber)}/comments?per_page=${String(PER_PAGE)}&page=${String(page)}`,
      token,
      signal,
      maxBytes: ACTION_RESULT_MAX_BYTES,
    })
    if (!Array.isArray(comments)) throw new Error('the comment list is malformed')
    const sticky = comments.find(
      (comment) =>
        comment?.user?.type === 'Bot' &&
        typeof comment.body === 'string' &&
        comment.body.startsWith(STICKY_MARKER) &&
        Number.isSafeInteger(comment.id),
    )
    if (sticky !== undefined) return sticky.id
    if (comments.length < PER_PAGE) return null
  }
  return null
}

/** PATCHes the sticky comment, or POSTs one. */
export async function postSticky({ fetch, apiUrl, repository, prNumber, token, body, signal }) {
  const id = await findSticky({ fetch, apiUrl, repository, prNumber, token, signal })
  const target =
    id === null
      ? { url: `${apiUrl}/repos/${repository}/issues/${String(prNumber)}/comments`, method: 'POST' }
      : { url: `${apiUrl}/repos/${repository}/issues/comments/${String(id)}`, method: 'PATCH' }
  await githubJson({
    fetch,
    ...target,
    token,
    body: { body },
    signal,
    maxBytes: ACTION_RESULT_MAX_BYTES,
  })
  return id === null ? 'created' : 'updated'
}

/** The published result, only when valid and completed with exit code 0. */
export async function completedResult(file) {
  const result = JSON.parse(await readFile(file, 'utf8'))
  return isExecResult(result) && result.status === 'completed' && result.exitCode === 0
    ? result
    : null
}

async function main() {
  const env = process.env
  let token = env.MUSE_GITHUB_TOKEN ?? ''
  const owner = createLauncherOwner({
    paths: {},
    dropSecrets: () => {
      token = ''
    },
    totalMs: ACTION_POST_MS,
  })
  try {
    const paths = actionPaths(invocationFromEnv(env), '')
    const result = env.MUSE_RUN_STATUS === 'completed' ? await completedResult(paths.result) : null
    if (result === null) {
      process.stdout.write('No completed result, so no comment was posted.\n')
      return
    }
    const repository = env.GITHUB_REPOSITORY ?? ''
    const server = httpsBase(env.GITHUB_SERVER_URL, 'https://github.com', 'GITHUB_SERVER_URL')
    const body = commentBody({
      result,
      runUrl: `${server}/${repository}/actions/runs/${env.GITHUB_RUN_ID ?? ''}`,
      artifactName: env.MUSE_ARTIFACT_NAME ?? '',
      mode: env.MUSE_INPUT_MODE === 'fix' ? 'fix' : 'review',
      patchWithheld: env.MUSE_PATCH_WITHHELD ?? '',
      patchPublished: (env.MUSE_PATCH_PATH ?? '') !== '',
      literals: [token],
    })
    const outcome = await owner.phase('post', ACTION_POST_MS, (signal) =>
      postSticky({
        fetch,
        apiUrl: httpsBase(env.GITHUB_API_URL, 'https://api.github.com', 'GITHUB_API_URL'),
        repository,
        prNumber: Number(env.MUSE_PR_NUMBER),
        token,
        body,
        signal,
      }),
    )
    process.stdout.write(`The review comment was ${outcome}.\n`)
  } catch {
    if (env.GITHUB_STEP_SUMMARY) {
      await writeFile(env.GITHUB_STEP_SUMMARY, '- The review comment could not be posted.\n', {
        flag: 'a',
      })
    }
  } finally {
    await owner.cleanup()
  }
}

if (isEntry(import.meta.url)) await main()
