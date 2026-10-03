// Step 6 of the Action (M80, SPEC §6.1, §4.3): stage the gate's metadata,
// task and template privately, without running repository code. The PR's
// title, body and diff are untrusted resources; only the collaborator's task
// and the workflow's extra instructions enter the trusted prompt. The diff
// itself is generated inside run-exec's owner (generateDiff, exported here).

import { Buffer } from 'node:buffer'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { TextDecoder } from 'node:util'
import { requireGit, safeGit } from './git.mjs'
import { ACTION_META_MAX_BYTES, ACTION_TASK_MAX_CHARS, isEntry } from './lifecycle.mjs'
import { actionPaths, InputError, invocationFromEnv, readActionInputs } from './tools.mjs'

const PRIVATE_FILE = 0o600
// The exec prompt file's byte cap (EXEC_PROMPT_MAX_BYTES).
export const ACTION_PROMPT_MAX_BYTES = 262_144
const PLACEHOLDER =
  /\{\{(task|extraInstructions|prNumber|headSha|baseSha|diffNotice|metadataNotice)\}\}/g
const DEFAULT_TASK = {
  review: 'Review this pull request.',
  fix: 'Make the change this pull request needs.',
}

/** The longest prefix of `text` within `maxBytes` UTF-8 bytes, cut only between code points. */
export function truncateUtf8(text, maxBytes) {
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.length <= maxBytes) return { text, truncated: false, bytes: bytes.length }
  let end = maxBytes
  // A continuation byte (10xxxxxx) cannot start a code point: back up to one that can.
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1
  return { text: bytes.subarray(0, end).toString('utf8'), truncated: true, bytes: bytes.length }
}

/**
 * The PR metadata resource (pr.md): head, base and truncation notices, then
 * the untrusted title and body; the whole file at most ACTION_META_MAX_BYTES.
 */
export function metadataResource(gate) {
  const resource = (titleText, bodyText, truncated) =>
    [
      `Pull request #${String(gate.prNumber)}`,
      `Head: ${gate.headSha}`,
      `Base: ${gate.baseSha}`,
      truncated ? 'metadata truncated: the title and description were cut to fit' : '',
      '',
      `Title: ${titleText}`,
      '',
      bodyText,
      '',
    ].join('\n')
  // The fixed envelope, its truncation notice included, is reserved first.
  const room = ACTION_META_MAX_BYTES - Buffer.byteLength(resource('', '', true))
  const title = truncateUtf8(gate.title, room)
  const body = truncateUtf8(gate.body, room - Buffer.byteLength(title.text))
  const truncated = title.truncated || body.truncated
  return { text: resource(title.text, body.text, truncated), truncated }
}

/** Reads the gate's private decision and validates what the prompt uses. */
export async function readGate(file) {
  const gate = JSON.parse(await readFile(file, 'utf8'))
  if (
    !Number.isSafeInteger(gate?.prNumber) ||
    typeof gate.headSha !== 'string' ||
    typeof gate.baseSha !== 'string' ||
    typeof gate.task !== 'string' ||
    typeof gate.title !== 'string' ||
    typeof gate.body !== 'string'
  ) {
    throw new InputError('the gate decision is malformed')
  }
  if (gate.task.length > ACTION_TASK_MAX_CHARS) throw new InputError('the task is too long')
  return gate
}

/** Step 6: pr.md and the trusted prompt inputs, both private. */
export async function stageInputs({ paths, inputs }) {
  const gate = await readGate(paths.gate)
  const metadata = metadataResource(gate)
  await writeFile(paths.meta, metadata.text, { flag: 'wx', mode: PRIVATE_FILE })
  await writeFile(
    paths.inputs,
    JSON.stringify({
      mode: inputs.mode,
      task: gate.task === '' ? DEFAULT_TASK[inputs.mode] : gate.task,
      extraInstructions: inputs.extraInstructions,
      prNumber: gate.prNumber,
      headSha: gate.headSha,
      baseSha: gate.baseSha,
      metadataTruncated: metadata.truncated,
      maxDiffBytes: inputs.maxDiffBytes,
    }),
    { flag: 'wx', mode: PRIVATE_FILE },
  )
}

/**
 * The review diff (merge base to head) through safeGit into a private file,
 * then cut to `maxDiffBytes` at a code point boundary. Returns whether it
 * was cut and its full size.
 */
export async function generateDiff({ owner, git, paths, baseEnv, staged }) {
  requireGit(
    await safeGit({
      owner,
      git,
      cwd: paths.checkout,
      args: [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--no-color',
        `${staged.baseSha}...${staged.headSha}`,
      ],
      paths,
      baseEnv,
      readOnly: true,
      stdoutPath: paths.diffFull,
    }),
    'diff',
  )
  const full = new TextDecoder('utf-8').decode(await readFile(paths.diffFull))
  await rm(paths.diffFull, { force: true })
  const cut = truncateUtf8(full, staged.maxDiffBytes)
  await writeFile(paths.diff, cut.text, { flag: 'wx', mode: PRIVATE_FILE })
  return { truncated: cut.truncated, bytes: cut.bytes }
}

/** Fills each known placeholder once, in a single pass, so inserted text is never expanded. */
export function fillTemplate(template, values) {
  return template.replaceAll(PLACEHOLDER, (_match, name) => values[name])
}

/** The trusted prompt from the mode's template, refused past the exec prompt cap. */
export async function renderPrompt({ paths, staged, diff, templatesDir }) {
  const template = await readFile(path.join(templatesDir, `${staged.mode}.md`), 'utf8')
  const prompt = fillTemplate(template, {
    task: staged.task,
    extraInstructions: staged.extraInstructions === '' ? 'None.' : staged.extraInstructions,
    prNumber: String(staged.prNumber),
    headSha: staged.headSha,
    baseSha: staged.baseSha,
    diffNotice: diff.truncated
      ? `diff truncated: the attached diff holds the first ${String(staged.maxDiffBytes)} of ${String(diff.bytes)} bytes.`
      : 'The attached diff is complete.',
    metadataNotice: staged.metadataTruncated
      ? 'metadata truncated: the attached title and description were cut to fit.'
      : 'The attached title and description are complete.',
  })
  if (Buffer.byteLength(prompt) > ACTION_PROMPT_MAX_BYTES) {
    throw new InputError('the prompt is larger than exec accepts')
  }
  await writeFile(paths.prompt, prompt, { flag: 'wx', mode: PRIVATE_FILE })
}

/** The staged trusted inputs from step 6. */
export async function readStaged(paths) {
  return JSON.parse(await readFile(paths.inputs, 'utf8'))
}

async function main() {
  try {
    const paths = actionPaths(invocationFromEnv(process.env), process.env.MUSE_CHECKOUT ?? '')
    await stageInputs({ paths, inputs: await readActionInputs(paths) })
  } catch (error) {
    const message = error instanceof InputError ? error.message : 'the inputs could not be staged'
    process.stderr.write(`::error::${message}\n`)
    process.exitCode = 1
  }
}

if (isEntry(import.meta.url)) await main()
