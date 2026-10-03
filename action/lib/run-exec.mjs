// Step 7 of the Action (M80, SPEC §6.2, §6.5): the run step's body execs this
// script directly. It is the sanctioned initial holder of the Model API key:
// it deletes the variable before any child starts and keeps the key in
// memory only, sending it over private stdin to exactly two trusted
// installed agent commands (`exec --key-stdin`, then `scan-secrets
// --key-stdin` for the exact staged patch). One launcher owner spans the
// input diff, exec, extraction, the patch's Git children, the scanner and
// publication; finally it deletes staging and drops the key.

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { renameSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { TextDecoder } from 'node:util'
import { requireGit, safeGit } from './git.mjs'
import { generateDiff, readStaged, renderPrompt } from './inputs.mjs'
import {
  ACTION_EVENTS_MAX_BYTES,
  ACTION_EXEC_OVERHEAD_MS,
  ACTION_EXTRACT_MS,
  ACTION_GIT_MS,
  ACTION_INPUT_MS,
  ACTION_KEY_MAX_BYTES,
  ACTION_PATCH_MAX_BYTES,
  ACTION_PUBLISH_MS,
  ACTION_SCAN_MS,
  ACTION_SCAN_STDOUT_MAX_BYTES,
  ACTION_STDERR_MAX_BYTES,
  ActionStopError,
  BoundError,
  childEnvironment,
  createLauncherOwner,
  isEntry,
  outcomeCode,
  redactLiterals,
  signalExitCode,
  withinBound,
} from './lifecycle.mjs'
import { extractResult } from './result.mjs'
import {
  actionPaths,
  InputError,
  invocationFromEnv,
  networkInputs,
  readActionInputs,
  writeOutputs,
} from './tools.mjs'

// A projection of src/shared/constants.ts MODEL_API_KEY_PATTERN (parity-tested).
export const MODEL_API_KEY_PATTERN = /^(?:LLM_[\w-]{16,}|LLM\|\d+\|\S+)$/
export const KEY_VARIABLE = 'MUSE_SPARK_MODEL_API_KEY'
export const INVALID_KEY_MESSAGE = 'model-api-key is missing or not a Meta Model API key'
const SCAN_FOUND_EXIT = 10
const MILLISECONDS_PER_MINUTE = 60_000
const SECONDS_PER_MINUTE = 60
const PRIVATE_FILE = 0o600
// One number as Intl may format it: digits with group separators (spaces included).
const NUMBER_TOKEN = /\d(?:[\d.,']|\s(?=\d))*/g

/**
 * The key from the run step's environment, which is deleted at once. One
 * trailing LF is stripped; empty, multi-line, oversize or malformed keys
 * are refused (undefined) without echoing anything.
 */
export function takeModelApiKey(env) {
  const raw = env[KEY_VARIABLE]
  Reflect.deleteProperty(env, KEY_VARIABLE)
  if (typeof raw !== 'string') return
  const key = raw.endsWith('\n') ? raw.slice(0, -1) : raw
  const isValid =
    key !== '' &&
    !/[\r\n]/.test(key) &&
    Buffer.byteLength(key) <= ACTION_KEY_MAX_BYTES &&
    MODEL_API_KEY_PATTERN.test(key)
  return isValid ? key : undefined
}

/** The runner's mask command for one value: %, CR and LF escaped as workflow command data. */
export function maskCommand(value) {
  const data = value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
  return `::add-mask::${data}\n`
}

/** exec's arguments (SPEC §6.5): the run as one array, never a shell string. */
export function execArguments({ agentJs, paths, inputs }) {
  return [
    agentJs,
    'exec',
    '--key-stdin',
    '--backend',
    'modelApi',
    '--cwd',
    paths.checkout,
    '--permission-mode',
    inputs.mode === 'fix' ? 'acceptEdits' : 'plan',
    '--output',
    'jsonl',
    '--ephemeral',
    '--max-budget-usd',
    inputs.maxBudgetUsd,
    '--max-requests',
    String(inputs.maxRequests),
    '--timeout',
    String(inputs.timeoutMinutes * SECONDS_PER_MINUTE),
    '--prompt-file',
    paths.prompt,
    '--untrusted-file',
    paths.diff,
    '--untrusted-file',
    paths.meta,
    ...(inputs.model === '' ? [] : ['--model', inputs.model]),
    ...(inputs.effort === '' ? [] : ['--effort', inputs.effort]),
    ...(inputs.allowContributorModels ? ['--allow-contributor-models'] : []),
    ...(inputs.imageGeneration ? ['--image-generation'] : []),
  ]
}

/** A patch Git renders as binary (or that is not UTF-8) is withheld whole. */
export function isBinaryPatch(bytes) {
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return true
  }
  return /^GIT binary patch$/m.test(text) || /^Binary files .* differ$/m.test(text)
}

/** The scanner's counts-only line as its one count, or undefined when malformed. */
export function scanCount(stdout) {
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(stdout)
  } catch {
    return
  }
  const line = text.endsWith('\n') ? text.slice(0, -1) : text
  if (line === '' || line.includes('\n')) return
  const tokens = line.match(NUMBER_TOKEN) ?? []
  if (tokens.length !== 1) return
  const count = Number(tokens[0].replaceAll(/\D/g, ''))
  return Number.isSafeInteger(count) ? count : undefined
}

/** The withholding reason a latched stop implies. */
function stopReason(owner) {
  const kind = owner.cause?.kind
  if (kind === 'signal') return 'cancelled'
  return kind === 'output_limit' ? 'limit' : 'scan_failed'
}

async function scanPatch({ owner, node, agentJs, paths, baseEnv, key }) {
  let outcome
  try {
    outcome = await owner.child({
      file: node,
      args: [agentJs, 'scan-secrets', paths.staging, '--key-stdin'],
      cwd: paths.work,
      env: baseEnv,
      stdin: Buffer.from(`${key}\n`, 'utf8'),
      withinMs: ACTION_SCAN_MS,
      stdoutMaxBytes: ACTION_SCAN_STDOUT_MAX_BYTES,
      stderrMaxBytes: ACTION_STDERR_MAX_BYTES,
    })
  } catch {
    return owner.stopped ? stopReason(owner) : 'scan_failed'
  }
  if (owner.stopped) return stopReason(owner)
  const count = scanCount(outcome.stdout)
  if (count === 0 && outcome.code === 0) return 'clean'
  return count !== undefined && count > 0 && outcome.code === SCAN_FOUND_EXIT
    ? 'secret'
    : 'scan_failed'
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function stagePatch({ owner, git, paths, baseEnv, staged }) {
  return await owner.phase('patch', ACTION_GIT_MS, async () => {
    const run = (args, extra) =>
      safeGit({ owner, git, cwd: paths.checkout, args, paths, baseEnv, ...extra })
    requireGit(await run(['add', '--intent-to-add', '--all'], { readOnly: false }), 'add')
    requireGit(
      await run(
        ['diff', '--binary', '--no-ext-diff', '--no-textconv', '--no-color', staged.headSha],
        { readOnly: true, stdoutPath: paths.staging, stdoutMaxBytes: ACTION_PATCH_MAX_BYTES },
      ),
      'diff',
    )
    return new Uint8Array(await readFile(paths.staging))
  })
}

function refuseUnlessAllowed(owner) {
  if (!owner.publicationAllowed) throw new ActionStopError(owner.cause ?? { kind: 'failure' })
}

async function publishPatch({ owner, paths, staged, bytes, identity }) {
  const digest = sha256(bytes)
  await owner.phase('publish', ACTION_PUBLISH_MS, async () => {
    refuseUnlessAllowed(owner)
    if (sha256(await readFile(paths.staging)) !== digest)
      throw new Error('the staged patch changed')
    const manifest = {
      headSha: staged.headSha,
      baseSha: staged.baseSha,
      prNumber: staged.prNumber,
      patchSha256: digest,
      runId: identity.runId,
      attempt: identity.attempt,
      invocation: identity.invocation,
    }
    await writeFile(paths.manifestTmp, `${JSON.stringify(manifest)}\n`, {
      flag: 'wx',
      mode: PRIVATE_FILE,
    })
    // Checked, then both moved synchronously (RVM80CD P2-2): no move outlives
    // a stop, and neither file is published without the other.
    refuseUnlessAllowed(owner)
    try {
      renameSync(paths.staging, paths.patch)
      renameSync(paths.manifestTmp, paths.manifest)
    } catch (error) {
      revokePatch(paths)
      throw error
    }
  })
}

function revokePatch(paths) {
  rmSync(paths.patch, { force: true })
  rmSync(paths.manifest, { force: true })
}

/**
 * A stopped or failed wrapper publishes nothing (SPEC §6.1 step 8, RVM80CD
 * P2-2): whatever reached out/ before the stop is removed, synchronously, and
 * the report no longer offers a result. Ordinary exec failures keep theirs.
 */
function revokeIfStopped(report, owner, paths) {
  if (!owner.stopped && !report.wrapperFailed) return
  rmSync(paths.result, { force: true })
  rmSync(paths.events, { force: true })
  revokePatch(paths)
  report.result = null
  report.patchPublished = false
}

/** The withholding reason for a run that stopped before the patch was decided. */
function interruptedReason(report, owner) {
  if (report.result === null) return 'no_result'
  return stopReason(owner) === 'limit' ? 'limit' : 'cancelled'
}

/**
 * The fix patch (SPEC §6.5): only after a valid completed result with exec
 * code 0. Intent-to-add plus `git diff --binary` against the exact head into
 * private staging; a binary patch is withheld whole; the trusted scanner
 * reads the exact staged bytes; a clean patch and its manifest are moved
 * into out/ unchanged, or neither is. Returns the withholding reason ('' when
 * published or when there was no change) and whether a patch was published.
 */
async function proposePatch(input) {
  const { owner, result, execCode } = input
  if (result === null) return { withheld: 'no_result', published: false }
  if (execCode !== 0 || result.status !== 'completed') {
    return { withheld: 'not_completed', published: false }
  }
  const bytes = await stagePatch(input)
  if (bytes.length === 0) return { withheld: '', published: false }
  if (isBinaryPatch(bytes)) return { withheld: 'binary', published: false }
  const scan = await scanPatch(input)
  if (scan !== 'clean') return { withheld: scan, published: false }
  try {
    await publishPatch({ ...input, bytes })
  } catch (error) {
    if (owner.stopped || error instanceof ActionStopError) {
      return { withheld: stopReason(owner) === 'limit' ? 'limit' : 'cancelled', published: false }
    }
    throw error
  }
  return { withheld: '', published: true }
}

/**
 * The whole run under one owner. Returns the report the outputs and exit
 * code come from; never throws for an ordinary stop or failure.
 */
export async function runProposal(input) {
  const { owner, paths, inputs, key, log } = input
  const report = {
    execCode: null,
    result: null,
    wrapperFailed: false,
    patchWithheld: '',
    patchPublished: false,
    diffTruncated: false,
  }
  try {
    const staged = await readStaged(paths)
    const diff = await owner.phase('input', ACTION_INPUT_MS, async () => {
      const generated = await generateDiff({ ...input, staged })
      await renderPrompt({ paths, staged, diff: generated, templatesDir: input.templatesDir })
      return generated
    })
    report.diffTruncated = diff.truncated
    const outcome = await owner.child({
      file: input.node,
      args: execArguments(input),
      cwd: paths.work,
      env: input.baseEnv,
      stdin: Buffer.from(`${key}\n`, 'utf8'),
      stdoutPath: paths.eventsTmp,
      withinMs: inputs.timeoutMinutes * MILLISECONDS_PER_MINUTE + ACTION_EXEC_OVERHEAD_MS,
      stdoutMaxBytes: ACTION_EVENTS_MAX_BYTES,
      stderrMaxBytes: ACTION_STDERR_MAX_BYTES,
    })
    report.execCode = outcomeCode(outcome)
    log(redactLiterals(Buffer.from(outcome.stderr).toString('utf8'), [key]))
    report.result = await extractResult({ owner, paths, execCode: report.execCode })
    if (inputs.mode === 'fix') {
      const patch = await proposePatch({
        ...input,
        staged,
        result: report.result,
        execCode: report.execCode,
      })
      report.patchWithheld = patch.withheld
      report.patchPublished = patch.published
    }
  } catch (error) {
    if (!(error instanceof ActionStopError)) report.wrapperFailed = true
    if (inputs.mode === 'fix' && !report.patchPublished && report.patchWithheld === '') {
      report.patchWithheld = interruptedReason(report, owner)
    }
  }
  if (report.execCode === 0 && report.result === null) report.wrapperFailed = true
  revokeIfStopped(report, owner, paths)
  return report
}

/** The step's exit code: a signal's own, else exec's nonzero code, else 1 for any wrapper failure. */
export function exitCodeFor(report, owner) {
  const cause = owner.cause
  if (cause?.kind === 'signal') return signalExitCode(cause.signal)
  if (report.execCode !== null && report.execCode !== 0) return report.execCode
  return report.wrapperFailed || owner.stopped || report.result === null ? 1 : 0
}

/** The status output: only an unstopped, unfailed wrapper may repeat exec's status. */
export function statusFor(report, owner) {
  if (owner.cause?.kind === 'signal') return 'cancelled'
  return owner.stopped || report.wrapperFailed || report.result === null
    ? 'unknown'
    : report.result.status
}

/** Every step output (SPEC §6.1); unavailable paths are empty, never advertised. */
export function outputsFor(report, owner, paths) {
  const result = report.result
  const cost = result?.usage.costUsd ?? null
  const paid = result?.usage.paid
  const status = statusFor(report, owner)
  return {
    status,
    'exit-code': String(exitCodeFor(report, owner)),
    'out-dir': paths.out,
    'result-path': result === null ? '' : paths.result,
    'events-path': result === null ? '' : paths.events,
    'patch-path': status === 'completed' && report.patchPublished ? paths.patch : '',
    'patch-withheld': report.patchWithheld,
    requests: String(result?.usage.requests ?? ''),
    'cost-usd': cost === null ? '' : String(cost.total),
    'cost-is-upper-bound': cost === null ? '' : String(cost.isUpperBound),
    images: String(paid?.imagesReturned ?? ''),
    'image-attempts': String(paid?.imageAttempts ?? ''),
    'images-uncertain': String(paid?.imagesUncertain ?? ''),
    'paid-uncertain-usd': String(paid?.uncertainUsd ?? ''),
    'diff-truncated': String(report.diffTruncated),
  }
}

function summaryFor(report, outputs) {
  const upper = outputs['cost-is-upper-bound'] === 'true' ? ' (upper bound)' : ''
  return [
    '### Muse Spark Code run',
    '',
    `- status: ${outputs.status}`,
    `- exec exit code: ${report.execCode === null ? 'none' : String(report.execCode)}`,
    `- wrapper failure: ${String(report.wrapperFailed)}`,
    `- requests: ${outputs.requests || 'n/a'}`,
    `- cost (USD): ${outputs['cost-usd'] || 'n/a'}${upper}`,
    `- paid uncertain (USD): ${outputs['paid-uncertain-usd'] || 'n/a'}`,
    `- images returned / attempted / uncertain: ${outputs.images || '0'} / ${outputs['image-attempts'] || '0'} / ${outputs['images-uncertain'] || '0'}`,
    `- patch withheld: ${outputs['patch-withheld'] || 'no'}`,
    '',
  ].join('\n')
}

async function run(env, held) {
  const paths = actionPaths(invocationFromEnv(env), env.MUSE_CHECKOUT ?? '')
  // Read before the owner exists (its total depends on the inputs): bounded on its own.
  const inputs = await withinBound(readActionInputs(paths), ACTION_INPUT_MS, 'reading the inputs')
  const node = env.MUSE_NODE ?? ''
  const owner = createLauncherOwner({
    paths,
    dropSecrets: () => {
      held.key = undefined
    },
    totalMs:
      ACTION_INPUT_MS +
      inputs.timeoutMinutes * MILLISECONDS_PER_MINUTE +
      ACTION_EXEC_OVERHEAD_MS +
      ACTION_EXTRACT_MS +
      ACTION_GIT_MS +
      ACTION_SCAN_MS +
      ACTION_PUBLISH_MS,
    temporaryFiles: [paths.resultTmp, paths.manifestTmp, paths.eventsTmp, paths.diffFull],
  })
  let report
  try {
    report = await runProposal({
      owner,
      paths,
      inputs,
      key: held.key ?? '',
      node,
      git: env.MUSE_GIT ?? '',
      agentJs: env.MUSE_AGENT_JS ?? '',
      baseEnv: childEnvironment({
        platform: process.platform,
        parentEnv: env,
        paths,
        nodePath: node,
        network: networkInputs(inputs, env.GITHUB_WORKSPACE ?? ''),
      }),
      templatesDir: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prompts'),
      identity: {
        runId: env.GITHUB_RUN_ID ?? '',
        attempt: env.GITHUB_RUN_ATTEMPT ?? '',
        invocation: path.basename(paths.invocation).replace(/^run-/, ''),
      },
      log: (text) => {
        if (text !== '') process.stderr.write(text.endsWith('\n') ? text : `${text}\n`)
      },
    })
  } finally {
    await owner.cleanup()
  }
  // A stop that landed after runProposal returned still withholds everything.
  revokeIfStopped(report, owner, paths)
  const outputs = outputsFor(report, owner, paths)
  // The owner is gone; each final write keeps its own publication bound (RVM80CD P2-5).
  await withinBound(writeOutputs(env.GITHUB_OUTPUT, outputs), ACTION_PUBLISH_MS, 'the step outputs')
  if (env.GITHUB_STEP_SUMMARY) {
    await withinBound(
      writeFile(env.GITHUB_STEP_SUMMARY, summaryFor(report, outputs), { flag: 'a' }),
      ACTION_PUBLISH_MS,
      'the step summary',
    )
  }
  if (owner.cleanupFailed) {
    process.stderr.write(
      '::warning::cleanup did not finish; tidy removes the private work folder\n',
    )
  }
  return exitCodeFor(report, owner)
}

async function main() {
  const held = { key: takeModelApiKey(process.env) }
  if (held.key === undefined) {
    process.stderr.write(`::error::${INVALID_KEY_MESSAGE}\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(maskCommand(held.key))
  try {
    process.exitCode = await run(process.env, held)
  } catch (error) {
    const message =
      error instanceof InputError || error instanceof BoundError ? error.message : 'the run failed'
    process.stderr.write(`::error::${message}\n`)
    process.exitCode = 1
    if (error instanceof BoundError) {
      held.key = undefined
      // A stuck step file operation holds a libuv worker that process.exit
      // would wait for at teardown; the wrapper ends itself instead, as exec
      // does on Windows (PLAN.md M80Bw). The runner records a failed step.
      process.kill(process.pid, 'SIGKILL')
    }
  } finally {
    held.key = undefined
  }
}

if (isEntry(import.meta.url)) await main()
