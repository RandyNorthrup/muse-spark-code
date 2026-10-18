// Muse Spark Code (Unofficial) on GitLab CI, Azure Pipelines, Jenkins and
// Bitbucket Pipelines (lane CM80CI-R2, PLAN.md M80/D65). This is the GitHub
// Action's own launcher run as one process: the same input grammar
// (tools.mjs), the same digest-pinned installer with lifecycle scripts off
// and the identity check (install.mjs), the same sanitized Git (git.mjs),
// the same owner with its signal forwarding, bounds and drained pipes
// (lifecycle.mjs), the same review diff, prompt file, exec, result
// extraction, patch and scanner (inputs.mjs, run-exec.mjs, result.mjs). Only
// the event and trust facts differ; ci-adapters.mjs reads them.
//
// The bootstrap never reads the key. Its download subshell removes the
// generated key-name list and declared aliases; the parent runs Node with
// the original environment (plain invocation, not exec). Node takes the vendor value/file first, strips
// names and value copies, and sends the key only over trusted private stdin.

import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { mkdir as mkdirAsync, writeFile as writeFileAsync } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { readCiKey } from './ci-key.mjs'
import { boundedFiles, fileOperation } from './ci-files.mjs'
import { CI_SYSTEMS, azureBoolean, ciFacts, decideCi } from './ci-adapters.mjs'
import { gitText, requireGit, safeGit } from './git.mjs'
import { truncateUtf8 } from './inputs.mjs'
import { installAgent, ProvenanceError } from './install.mjs'
import {
  ACTION_CHECKOUT_MS,
  ACTION_CLEANUP_MS,
  ACTION_EXEC_OVERHEAD_MS,
  ACTION_EXTRACT_MS,
  ACTION_GIT_MS,
  ACTION_INPUT_MS,
  ACTION_INSTALL_MS,
  ACTION_KILL_AFTER_MS,
  ACTION_META_MAX_BYTES,
  ACTION_PUBLISH_MS,
  ACTION_REAP_MS,
  ACTION_SCAN_MS,
  ActionStopError,
  BoundError,
  redactLiterals,
  childEnvironment,
  createLauncherOwner,
  isEntry,
} from './lifecycle.mjs'
import {
  exitCodeFor,
  INVALID_KEY_MESSAGE,
  isValidModelApiKey,
  outputsFor,
  revokeIfStopped,
  runProposal,
  summaryFor,
} from './run-exec.mjs'
import {
  allocateInvocation,
  canonicalOutside,
  InputError,
  invocationId,
  networkInputs,
  parseActionInputs,
  rawInputs,
  resolveTools,
} from './tools.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const CI_TEMPLATES_DIR = path.join(HERE, '..', 'prompts', 'ci')
// The package (or repository) root whose package.json names the agent version.
export const LAUNCHER_ROOT = path.resolve(HERE, '..', '..')
// The name each template gives the system's secret (a value), and the
// File-type variable GitLab uses instead (its value is a path: source
// preparation and artifact upload see only the path, never the key).
export {
  CI_SECRET_VARIABLE,
  CI_KEY_FILE_VARIABLE,
  CI_KEY_VARIABLES,
  CI_KEY_ALIASES_VARIABLE,
  CI_BOOTSTRAP_UNSET,
} from './ci-key.mjs'
export const CI_OUT_DIR = 'muse-spark-out'
// Every file the publisher ever writes into the output directory: the run
// outputs plus outputs.json, the publisher's manifest of what it published.
// The templates archive only these names, never a glob over the directory.
export const CI_PUBLISHED_FILES = Object.freeze([
  'outputs.json',
  'result.json',
  'events.jsonl',
  'fix.patch',
  'manifest.json',
])
// The bootstrap's own start (milliseconds since the epoch), recorded by the
// template before its download, digest check and unpacking.
export const CI_BOOTSTRAP_START_VARIABLE = 'MUSE_CI_BOOTSTRAP_START_MS'
// A vendor-measured job start where one reaches the launcher as a plain
// number (Jenkins: currentBuild.startTimeInMillis, set by the template).
export const CI_JOB_START_VARIABLE = 'MUSE_CI_JOB_START_MS'
// The template's download bound (curl --max-time 120). Admission measures
// all bootstrap elapsed time, including digest verification and unpacking.
export const CI_BOOTSTRAP_MS = 120_000
// Azure has no vendor date expression: reserve the qualified runner's
// worst-case initialization, full-history checkout and UseNode before bootstrap.
// docs/ci-other-systems.md records this required bound, not a vendor guarantee.
export const CI_AZURE_SETUP_MS = 600_000
const MILLISECONDS_PER_MINUTE = 60_000
const SECONDS_PER_MINUTE = 60
const PRIVATE_DIR = 0o700
const PRIVATE_FILE = 0o600
const GROUP_OTHER_BITS = 0o077
const JOB_MINUTES = /^[1-9][0-9]{0,5}$/
const JOB_SECONDS = /^[1-9][0-9]{0,8}$/
// Git's peel to the commit a name points at.
const COMMIT_PEEL = '^{commit}'
// Action inputs that only mean something on GitHub: set, they are refused.
const GITHUB_ONLY_INPUTS = [
  'MUSE_INPUT_TRIGGER_PHRASE',
  'MUSE_INPUT_PR_NUMBER',
  'MUSE_INPUT_PATH',
  'MUSE_INPUT_POST_COMMENT',
  'MUSE_INPUT_UPLOAD_ARTIFACTS',
]
const BOOLEAN_INPUTS = [
  'MUSE_INPUT_IMAGE_GENERATION',
  'MUSE_INPUT_ALLOW_CONTRIBUTOR_MODELS',
  'MUSE_INPUT_TRUST_PULL_REQUESTS',
]
const CI_TASK = {
  review: 'Review this change.',
  fix: 'Make the change these commits need.',
}

/**
 * The key, taken out of `env` at once: the run variable (validated as the
 * Action validates it), the system's secret name, and every other variable
 * whose value carries the key are deleted before any child can start.
 */
export function takeCiKey(env) {
  const raw = readCiKey(env)
  return isValidModelApiKey(raw) ? raw : undefined
}

function exactBoolean(raw, name, fallback) {
  const value = raw[name] ?? ''
  if (value === '') return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new InputError(`${name} must be true or false`)
}

/**
 * The Action's inputs (MUSE_INPUT_*) with the Action's own grammar, plus
 * trust-pull-requests. GitHub-only inputs are refused when set; Azure's
 * True/False booleans are read without case; the digest-pinned package the
 * template verified is required.
 */
export function parseCiInputs(env, system) {
  const raw = rawInputs(env)
  for (const name of GITHUB_ONLY_INPUTS) {
    if ((raw[name] ?? '') !== '') {
      throw new InputError(`${name} is a GitHub Action input; the CI templates do not take it`)
    }
  }
  if (system === 'azure') {
    for (const name of BOOLEAN_INPUTS) {
      const value = azureBoolean(raw[name], name)
      if (value !== undefined) raw[name] = String(value)
    }
  }
  const inputs = parseActionInputs(raw)
  if (inputs.agentPackage === '') {
    throw new InputError('agent-package and agent-package-sha256 are required')
  }
  return {
    ...inputs,
    trustPullRequests: exactBoolean(raw, 'MUSE_INPUT_TRUST_PULL_REQUESTS', false),
  }
}

/** The launcher owner's total: install, checkout, input, exec and every later phase. */
export function ownerTotalMs(inputs) {
  return (
    ACTION_INSTALL_MS +
    ACTION_CHECKOUT_MS +
    ACTION_INPUT_MS +
    inputs.timeoutMinutes * MILLISECONDS_PER_MINUTE +
    ACTION_EXEC_OVERHEAD_MS +
    ACTION_EXTRACT_MS +
    ACTION_GIT_MS +
    ACTION_SCAN_MS +
    ACTION_PUBLISH_MS
  )
}

/** Bootstrap and launcher bounds in minutes; admission also deducts Azure's pre-bootstrap reserve. */
export function requiredJobMinutes(inputs) {
  const total =
    CI_BOOTSTRAP_MS +
    ownerTotalMs(inputs) +
    ACTION_KILL_AFTER_MS +
    ACTION_REAP_MS +
    ACTION_CLEANUP_MS +
    ACTION_PUBLISH_MS
  return Math.ceil(total / MILLISECONDS_PER_MINUTE)
}

/** The job's own deadline in minutes: GitLab's CI_JOB_TIMEOUT, else the template's declared value. */
export function jobMinutes(env, system) {
  const seconds = env.CI_JOB_TIMEOUT ?? ''
  if (system === 'gitlab' && seconds !== '') {
    if (!JOB_SECONDS.test(seconds)) throw new InputError('CI_JOB_TIMEOUT is malformed')
    return Number(seconds) / SECONDS_PER_MINUTE
  }
  const minutes = env.MUSE_CI_JOB_TIMEOUT_MINUTES ?? ''
  if (!JOB_MINUTES.test(minutes)) {
    throw new InputError('MUSE_CI_JOB_TIMEOUT_MINUTES must name the job timeout in minutes')
  }
  return Number(minutes)
}

/**
 * Milliseconds since the epoch when the template's bootstrap started. The
 * templates always set it; without it the launcher cannot measure what the
 * job already spent, so it refuses instead of admitting blind.
 */
export function bootstrapStartMs(env) {
  const raw = env[CI_BOOTSTRAP_START_VARIABLE] ?? ''
  if (!/^[1-9][0-9]{9,}$/.test(raw)) {
    throw new InputError(`${CI_BOOTSTRAP_START_VARIABLE} is missing or malformed`)
  }
  return Number(raw)
}

/**
 * Milliseconds since the epoch when the job started: the vendor's own start
 * time the vendor exposes, otherwise the bootstrap timestamp. Azure reserves
 * its documented pre-bootstrap setup bound; no vendor date expression is read.
 */
export function jobStartMs(env, system, nowMs = Date.now()) {
  const starts = []
  if (system === 'gitlab') starts.push(Date.parse(env.CI_JOB_STARTED_AT ?? ''))
  else if (system === 'azure') {
    const measured = bootstrapStartMs(env)
    if (measured <= nowMs) starts.push(measured - CI_AZURE_SETUP_MS)
  }
  const raw = env[CI_JOB_START_VARIABLE] ?? ''
  if (/^[1-9][0-9]{9,}$/.test(raw)) starts.push(Number(raw))
  if (env[CI_BOOTSTRAP_START_VARIABLE] !== undefined) starts.push(bootstrapStartMs(env))
  const valid = starts.filter((started) => Number.isFinite(started) && started <= nowMs)
  if (valid.length === 0) throw new InputError('a measured job or bootstrap start is required')
  return Math.min(...valid)
}

/** The run's own tail after admission: stop grace, reaping, cleanup and the final writes. */
export function requiredRunMs(inputs) {
  return (
    ownerTotalMs(inputs) +
    ACTION_KILL_AFTER_MS +
    ACTION_REAP_MS +
    ACTION_CLEANUP_MS +
    ACTION_PUBLISH_MS
  )
}

/**
 * Admits a run only on the time REMAINING: the job timeout minus what the
 * job already spent, measured from the vendor start or bootstrap. Azure also
 * reserves its required worst-case setup allowance before bootstrap. Coverage
 * on Azure is conditional on the qualified runner meeting that setup bound.
 */
export function checkJobDeadline(env, system, inputs, nowMs = Date.now()) {
  const need = requiredRunMs(inputs)
  const remain =
    jobMinutes(env, system) * MILLISECONDS_PER_MINUTE - (nowMs - jobStartMs(env, system, nowMs))
  if (remain < need) {
    throw new InputError(
      `timeout-minutes ${String(inputs.timeoutMinutes)} needs a job timeout of at least ${String(Math.ceil(need / MILLISECONDS_PER_MINUTE))} minutes, only ${String(Math.max(0, Math.floor(remain / MILLISECONDS_PER_MINUTE)))} of ${String(jobMinutes(env, system))} remain`,
    )
  }
}

/** The template's private directory: absolute, outside the workspace, a real directory, ours alone on POSIX. */
export function privateTemp(value, workspace, platform) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new InputError('MUSE_CI_TEMP must be an absolute private directory')
  }
  const real = realpathSync.native(value)
  let clone
  try {
    clone = realpathSync.native(workspace)
  } catch {
    clone = path.resolve(workspace)
  }
  const intoClone = path.relative(clone, real)
  if (
    intoClone === '' ||
    (intoClone !== '..' && !intoClone.startsWith(`..${path.sep}`) && !path.isAbsolute(intoClone))
  ) {
    throw new InputError('MUSE_CI_TEMP must be outside the workspace')
  }
  const relative = path.relative(real, clone)
  if (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  ) {
    throw new InputError('MUSE_CI_TEMP must not contain the workspace')
  }
  const stat = lstatSync(value)
  if (!stat.isDirectory()) throw new InputError('MUSE_CI_TEMP must be a directory, not a link')
  if (
    platform !== 'win32' &&
    ((stat.mode & GROUP_OTHER_BITS) !== 0 || stat.uid !== process.getuid?.())
  ) {
    throw new InputError('MUSE_CI_TEMP must belong to this user alone')
  }
  return real
}

async function resolveCommit(run, revision, refusal) {
  let outcome
  try {
    outcome = requireGit(
      await run(['rev-parse', '--verify', '--quiet', `${revision}${COMMIT_PEEL}`], true),
      'rev-parse',
    )
  } catch (error) {
    if (error instanceof ActionStopError) throw error
    throw new InputError(refusal)
  }
  return gitText(outcome)
}

/**
 * The run's own repository, made from the system's clone without running
 * anything of it: a fresh `git init` in the private invocation, the clone's
 * HEAD (and, for a pull request, its target branch) fetched over the local
 * file transport through safeGit, the head the system names verified and
 * checked out detached. The base is the system's named commit, the target
 * branch's tip, or the head's first parent.
 */
export async function checkoutClone({ owner, git, paths, baseEnv, clone, facts }) {
  await mkdirAsync(paths.checkout, { mode: PRIVATE_DIR })
  const run = (args, isReadOnly = false) =>
    safeGit({
      owner,
      git,
      cwd: paths.checkout,
      args,
      paths,
      baseEnv,
      readOnly: isReadOnly,
      protocol: 'file',
    })
  requireGit(await run(['init', '--quiet', `--template=${paths.emptyHooks}`]), 'init')
  const refspecs = ['+HEAD:refs/muse-spark/checkout']
  if ('ref' in facts.base) refspecs.push(`+${facts.base.ref}:refs/muse-spark/base`)
  requireGit(
    await run([
      'fetch',
      '--quiet',
      '--no-tags',
      '--no-write-fetch-head',
      '--no-recurse-submodules',
      clone,
      ...refspecs,
    ]),
    'fetch',
  )
  const headSha = await resolveCommit(
    run,
    facts.headSha,
    'the head commit is not in the system checkout',
  )
  if (headSha !== facts.headSha) throw new InputError('the head commit is not the one named')
  const missingBase = 'the base commit is not in the system checkout; fetch its full history'
  let baseSha
  if ('sha' in facts.base) baseSha = await resolveCommit(run, facts.base.sha, missingBase)
  else if ('ref' in facts.base)
    baseSha = await resolveCommit(run, 'refs/muse-spark/base', missingBase)
  else {
    if (facts.base.mergeParent) {
      await resolveCommit(run, `${headSha}^2`, 'the pull request checkout is not its merge commit')
    }
    baseSha = await resolveCommit(run, `${headSha}^1`, missingBase)
  }
  requireGit(await run(['checkout', '--quiet', '--detach', headSha]), 'checkout')
  const checkedOut = await resolveCommit(run, 'HEAD', 'the checkout failed')
  if (checkedOut !== headSha) throw new Error('the checked out head is not the verified head')
  return { headSha, baseSha }
}

/** The untrusted change resource (pr.md): which change, head, base, then any title and description. */
export function changeResource(facts, shas) {
  const resource = (titleText, bodyText, truncated) =>
    [
      `Change: ${facts.label} (${facts.system})`,
      `Head: ${shas.headSha}`,
      `Base: ${shas.baseSha}`,
      truncated ? 'metadata truncated: the title and description were cut to fit' : '',
      '',
      `Title: ${titleText}`,
      '',
      bodyText,
      '',
    ].join('\n')
  const room = ACTION_META_MAX_BYTES - Buffer.byteLength(resource('', '', true))
  const title = truncateUtf8(facts.title, room)
  const body = truncateUtf8(facts.body, room - Buffer.byteLength(title.text))
  const truncated = title.truncated || body.truncated
  return { text: resource(title.text, body.text, truncated), truncated }
}

/** pr.md and the staged trusted inputs the run reads, both private. */
export async function stageCiInputs({ paths, inputs, facts, shas }) {
  const metadata = changeResource(facts, shas)
  await writeFileAsync(paths.meta, metadata.text, { flag: 'wx', mode: PRIVATE_FILE })
  await writeFileAsync(
    paths.inputs,
    JSON.stringify({
      mode: inputs.mode,
      task: CI_TASK[inputs.mode],
      extraInstructions: inputs.extraInstructions,
      prNumber: facts.number,
      headSha: shas.headSha,
      baseSha: shas.baseSha,
      metadataTruncated: metadata.truncated,
      maxDiffBytes: inputs.maxDiffBytes,
    }),
    { flag: 'wx', mode: PRIVATE_FILE },
  )
}

/** An existing job-temp output is removed within a bound, then refused before spending. */
export async function refuseExistingOutput(
  target,
  execute = fileOperation,
  cleanupMs = ACTION_CLEANUP_MS,
) {
  try {
    lstatSync(target)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw new InputError('the output destination cannot be inspected')
  }
  await boundedFiles({ kind: 'remove', target }, cleanupMs, 'removing stale outputs', execute)
  throw new InputError(
    'the output destination already exists; it was removed and the run is refused',
  )
}

/** Only launcher files are copied, in a killable filesystem worker outside the clone. */
export async function publishToWorkspace(
  target,
  paths,
  outputs,
  execute = fileOperation,
  publishMs = ACTION_PUBLISH_MS,
) {
  const published = { ...outputs, 'out-dir': target }
  const files = []
  for (const [output, file] of [
    ['result-path', paths.result],
    ['events-path', paths.events],
    ['patch-path', paths.patch],
    ['', paths.manifest],
  ]) {
    if (!existsSync(file) || !CI_PUBLISHED_FILES.includes(path.basename(file))) continue
    files.push(file)
    if (output !== '' && published[output] !== '')
      published[output] = path.join(target, path.basename(file))
  }
  await boundedFiles(
    { kind: 'publish', target, files, outputs: published },
    publishMs,
    'publishing the run outputs',
    execute,
  )
  return published
}

function failedReport() {
  return {
    execCode: null,
    result: null,
    wrapperFailed: false,
    patchWithheld: '',
    patchPublished: false,
    diffTruncated: false,
  }
}

function messageOf(error, fallback) {
  return error instanceof InputError || error instanceof ProvenanceError ? error.message : fallback
}

/**
 * One run on `system`: the workspace and private temp first, then the
 * output-destination refusal (before any model call), the inputs, the gate
 * and the remaining-time deadline (nothing installed, no key used), then
 * under one owner the verified install, the checkout, the staged inputs and
 * the Action's run. Returns the exit code; refusals and malformed facts
 * throw an InputError. The bootstrap's temp directory is removed on every
 * path out (its trap owns the pre-exec paths); final publication and that
 * cleanup each keep their own bound like the GitHub Action's final writes
 * (RVCM80CI2 findings 6-7).
 */
export async function runCi(input) {
  const { system, env, held, log } = input
  const execute = input.fileOperation ?? fileOperation
  const finalBounds = {
    publishMs: ACTION_PUBLISH_MS,
    cleanupMs: ACTION_CLEANUP_MS,
    ...input.finalBounds,
  }
  const platform = input.platform ?? process.platform
  // Establish ownership before parsing facts, resolving the workspace or inputs.
  const clone =
    env.CI_PROJECT_DIR ?? env.BUILD_SOURCESDIRECTORY ?? env.WORKSPACE ?? env.BITBUCKET_CLONE_DIR
  const temp = privateTemp(env.MUSE_CI_TEMP, path.resolve(clone ?? '.'), platform)
  try {
    const facts = ciFacts(system, env)
    const workspace = realpathSync.native(facts.workspace)
    privateTemp(temp, workspace, platform)
    const outputCandidate =
      env.MUSE_CI_OUTPUT_ROOT ??
      path.join(
        path.dirname(temp),
        `muse-spark-output-${facts.runId}-${facts.attempt}-${randomBytes(8).toString('hex')}`,
      )
    if (!path.isAbsolute(outputCandidate)) throw new InputError('output root must be absolute')
    canonicalOutside(path.dirname(outputCandidate), workspace, 'output parent')
    if (!existsSync(outputCandidate)) {
      await boundedFiles(
        { kind: 'mkdir', target: outputCandidate },
        finalBounds.publishMs,
        'creating output root',
        execute,
      )
    }
    const outputRoot = privateTemp(outputCandidate, workspace, platform)
    const outputRelative = path.relative(temp, outputRoot)
    if (
      outputRelative === '' ||
      (outputRelative !== '..' &&
        !outputRelative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(outputRelative))
    )
      throw new InputError('output must survive private run cleanup')
    const target = path.join(outputRoot, CI_OUT_DIR)
    await refuseExistingOutput(target, execute, finalBounds.cleanupMs)
    const inputs = parseCiInputs(env, system)
    const decision = decideCi(facts, inputs)
    if (!decision.allowed) throw new InputError(`the gate refused this run: ${decision.reason}`)
    checkJobDeadline(env, system, inputs)
    if (!isValidModelApiKey(held.key)) throw new InputError(INVALID_KEY_MESSAGE)
    return await runCiAdmitted({
      input,
      execute,
      target,
      finalBounds,
      platform,
      facts,
      inputs,
      workspace,
      temp,
    })
  } finally {
    held.key = undefined
    try {
      await boundedFiles(
        { kind: 'remove', target: temp },
        finalBounds.cleanupMs,
        'cleaning the run directory',
        execute,
      )
    } catch {
      log('muse-spark: the run directory could not be cleaned')
    }
  }
}

async function runCiAdmitted({
  input,
  execute,
  target,
  finalBounds,
  platform,
  facts,
  inputs,
  workspace,
  temp,
}) {
  const { system, env, held, log } = input
  const tools = resolveTools({
    env,
    platform,
    execPath: input.execPath ?? process.execPath,
    workspace,
  })
  const id = invocationId({
    runId: facts.runId,
    attempt: facts.attempt,
    job: system,
    random: randomBytes(8).toString('hex'),
  })
  const invocation = path.join(temp, 'muse-spark', `run-${id}`)
  const paths = allocateInvocation({
    runnerTemp: temp,
    role: 'run',
    id,
    checkout: path.join(invocation, 'checkout'),
  })
  const root = input.launcherRoot ?? LAUNCHER_ROOT
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const baseEnv = childEnvironment({
    platform,
    parentEnv: env,
    paths,
    nodePath: tools.node,
    network: networkInputs(inputs, workspace),
  })
  const owner = createLauncherOwner({
    paths,
    dropSecrets: () => {
      held.key = undefined
    },
    totalMs: ownerTotalMs(inputs),
    temporaryFiles: [paths.resultTmp, paths.manifestTmp, paths.eventsTmp, paths.diffFull],
    ...input.ownerOptions,
  })
  let report = failedReport()
  try {
    const installed = await installAgent({
      owner,
      paths,
      node: tools.node,
      npmCli: tools.npmCli,
      npxCli: tools.npxCli,
      version,
      workspace,
      packagePath: inputs.agentPackage,
      packageSha256: inputs.agentPackageSha256,
      fetch,
      baseEnv,
    })
    const shas = await owner.phase('checkout', ACTION_CHECKOUT_MS, () =>
      checkoutClone({ owner, git: tools.git, paths, baseEnv, clone: workspace, facts }),
    )
    await owner.phase('input', ACTION_INPUT_MS, () => stageCiInputs({ paths, inputs, facts, shas }))
    report = await runProposal({
      owner,
      paths,
      inputs,
      key: held.key ?? '',
      node: tools.node,
      git: tools.git,
      agentJs: installed.agentJs,
      baseEnv,
      templatesDir: CI_TEMPLATES_DIR,
      identity: { runId: facts.runId, attempt: facts.attempt, invocation: id },
      log,
    })
  } catch (error) {
    if (!(error instanceof ActionStopError)) {
      report.wrapperFailed = true
      log(`muse-spark: ${messageOf(error, 'the run could not start')}`)
    }
    if (inputs.mode === 'fix') report.patchWithheld = 'no_result'
  } finally {
    await owner.cleanup()
  }
  revokeIfStopped(report, owner, paths)
  const outputs = outputsFor(report, owner, paths)
  let code = exitCodeFor(report, owner)
  try {
    const published = await publishToWorkspace(
      target,
      paths,
      outputs,
      execute,
      finalBounds.publishMs,
    )
    input.write(summaryFor(report, published))
    if (system === 'azure')
      input.write('##vso[task.setvariable variable=MUSE_CI_OUTPUT_READY]true\n')
  } catch {
    await boundedFiles(
      { kind: 'remove', target },
      finalBounds.cleanupMs,
      'removing partial outputs',
      execute,
    )
    log(`muse-spark: the outputs could not be published into ${CI_OUT_DIR}`)
    if (code === 0) code = 1
  }
  return code
}

export async function main(held) {
  const intake = held ?? { key: takeCiKey(process.env) }
  const system = process.argv[2] ?? ''
  try {
    if (!CI_SYSTEMS.includes(system)) {
      throw new InputError(`name the CI system: ${CI_SYSTEMS.join(', ')}`)
    }
    process.exitCode = await runCi({
      system,
      env: process.env,
      held: intake,
      write: (text) => process.stdout.write(redactLiterals(text, [intake.key])),
      log: (text) => {
        if (text === '') return
        const safe = redactLiterals(text, [intake.key])
        process.stderr.write(safe.endsWith('\n') ? safe : `${safe}\n`)
      },
    })
  } catch (error) {
    process.stderr.write(`muse-spark: ${messageOf(error, 'the run failed')}\n`)
    process.exitCode = 1
    if (error instanceof BoundError) process.exit(1)
  } finally {
    intake.key = undefined
  }
}

if (isEntry(import.meta.url)) await main()
