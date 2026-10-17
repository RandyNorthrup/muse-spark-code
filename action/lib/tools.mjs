// Step 2 of the Action and of its apply sub-action (M80, SPEC §6.1): resolve
// the trusted absolute Node and Git outside the workspace before any
// checkout, validate every input, allocate one exclusive private invocation
// directory under RUNNER_TEMP, and write the absolute paths later steps use.
// `tidy` (the last step) deletes only that invocation's work/.

import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { appendFile, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { ACTION_DEFAULT_MAX_DIFF_BYTES, ACTION_MAX_DIFF_BYTES, isEntry } from './lifecycle.mjs'

const INVOCATION_ROOT = 'muse-spark'
const RANDOM_BYTES = 8
const ROLES = new Set(['run', 'apply'])
const INVOCATION_NAME = /^(run|apply)-(\d{1,20})-(\d{1,10})-([A-Za-z0-9_-]{1,100})-([0-9a-f]{16})$/
const DECIMAL_BUDGET = /^[0-9]+(?:\.[0-9]{1,6})?$/
const INTEGER = /^[0-9]+$/
const SHA256_HEX = /^[0-9a-f]{64}$/
const MODEL = /^[A-Za-z0-9._-]{1,100}$/
const EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
const USD_UNITS = 1_000_000n
const MAX_BUDGET_UNITS = 20_000_000n
const MAX_REQUESTS = 500
const DEFAULT_MAX_REQUESTS = 30
const MAX_TIMEOUT_MINUTES = 360
const DEFAULT_TIMEOUT_MINUTES = 20
const TRIGGER_MAX_CHARS = 100
const DEFAULT_TRIGGER = '@muse-spark'
const NO_PROXY_MAX_CHARS = 4096
const PRIVATE_DIR = 0o700
const PRIVATE_FILE = 0o600

/** Refused input: the message names the input, never its value. */
export class InputError extends Error {
  constructor(message) {
    super(message)
    this.name = 'InputError'
  }
}

function isInside(child, parent) {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/** The canonical path of an existing file, refused when it lies inside the real workspace. */
export function canonicalOutside(candidate, workspace, label) {
  let real
  try {
    real = realpathSync.native(candidate)
  } catch {
    throw new InputError(`${label} does not exist`)
  }
  if (isInside(real, realpathSync.native(workspace))) {
    throw new InputError(`${label} must be outside the workspace`)
  }
  return real
}

/** A regular file's canonical path outside the workspace. */
export function regularFileOutside(candidate, workspace, label) {
  const real = canonicalOutside(candidate, workspace, label)
  if (!statSync(real).isFile()) throw new InputError(`${label} must be a regular file`)
  return real
}

/**
 * The gated checkout directory: `relative` inside the real workspace, no `..`
 * segment, no absolute path, and no existing component that is a link.
 */
export function checkoutPathFor(workspace, relative) {
  if (
    typeof relative !== 'string' ||
    relative === '' ||
    relative.includes('\u{0}') ||
    path.isAbsolute(relative) ||
    path.win32.isAbsolute(relative)
  ) {
    throw new InputError('path must be a relative path inside the workspace')
  }
  const parts = relative.split(/[\\/]/).filter((part) => part !== '' && part !== '.')
  if (parts.includes('..')) throw new InputError('path must not contain ..')
  let current = realpathSync.native(workspace)
  for (const part of parts) {
    current = path.join(current, part)
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new InputError('path must not pass through a link')
    }
  }
  return current
}

function pathEntries(env, platform) {
  const key = Object.keys(env).find(
    (name) => (platform === 'win32' ? name.toUpperCase() : name) === 'PATH',
  )
  const value = key === undefined ? '' : (env[key] ?? '')
  return value.split(platform === 'win32' ? ';' : ':').filter((entry) => path.isAbsolute(entry))
}

/** Git on the absolute PATH entries, canonical, a regular file outside the workspace. */
export function findGit({ env, platform, workspace }) {
  const name = platform === 'win32' ? 'git.exe' : 'git'
  for (const entry of pathEntries(env, platform)) {
    const candidate = path.join(entry, name)
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      try {
        return regularFileOutside(candidate, workspace, 'git')
      } catch {
        // A git inside the workspace is skipped, never run (PLAN.md D24).
      }
    }
  }
  throw new InputError('git was not found outside the workspace')
}

/** npm's CLI scripts beside the trusted Node (the layout setup-node installs). */
export function npmScripts(node, platform, workspace) {
  const root =
    platform === 'win32'
      ? path.join(path.dirname(node), 'node_modules', 'npm')
      : path.join(path.dirname(node), '..', 'lib', 'node_modules', 'npm')
  return {
    npmCli: regularFileOutside(path.join(root, 'bin', 'npm-cli.js'), workspace, 'npm'),
    npxCli: regularFileOutside(path.join(root, 'bin', 'npx-cli.js'), workspace, 'npx'),
  }
}

/** Every absolute path of one invocation (SPEC §6.1). */
export function actionPaths(invocation, checkout) {
  const work = path.join(invocation, 'work')
  const out = path.join(invocation, 'out')
  const home = path.join(work, 'home')
  return {
    invocation,
    work,
    out,
    checkout,
    action: path.join(work, 'action.json'),
    prompt: path.join(work, 'prompt.txt'),
    diff: path.join(work, 'pr.diff'),
    diffFull: path.join(work, 'pr.diff.full'),
    meta: path.join(work, 'pr.md'),
    gate: path.join(work, 'gate.json'),
    inputs: path.join(work, 'inputs.json'),
    staging: path.join(work, 'patch.staging'),
    eventsTmp: path.join(work, 'events.jsonl.tmp'),
    resultTmp: path.join(work, 'result.json.tmp'),
    manifestTmp: path.join(work, 'manifest.json.tmp'),
    events: path.join(out, 'events.jsonl'),
    result: path.join(out, 'result.json'),
    patch: path.join(out, 'fix.patch'),
    manifest: path.join(out, 'manifest.json'),
    emptyGitConfig: path.join(work, 'git', 'config'),
    emptyHooks: path.join(work, 'git', 'hooks'),
    home,
    tmp: path.join(work, 'tmp'),
    agent: path.join(work, 'agent'),
    npmCache: path.join(work, 'npm', 'cache'),
    npmUserConfig: path.join(work, 'npm', 'userconfig'),
    npmGlobalConfig: path.join(work, 'npm', 'globalconfig'),
    download: path.join(work, 'download'),
  }
}

/** The invocation id `<run>-<attempt>-<job>-<random>`, validated. */
export function invocationId({ runId, attempt, job, random }) {
  const id = `${String(runId)}-${String(attempt)}-${String(job)}-${random}`
  if (!INVOCATION_NAME.test(`run-${id}`)) throw new InputError('the run identity is invalid')
  return id
}

/**
 * One exclusive invocation directory: RUNNER_TEMP/muse-spark/<role>-<id> with
 * private work/ (empty Git configuration and hooks, home, temp, npm
 * configuration) and out/. An existing directory is refused, never reused.
 */
export function allocateInvocation({ runnerTemp, role, id, checkout }) {
  if (!ROLES.has(role)) throw new InputError('unknown role')
  const root = path.join(realpathSync.native(runnerTemp), INVOCATION_ROOT)
  mkdirSync(root, { recursive: true, mode: PRIVATE_DIR })
  const invocation = path.join(root, `${role}-${id}`)
  mkdirSync(invocation, { mode: PRIVATE_DIR })
  const paths = actionPaths(invocation, checkout)
  for (const directory of [
    paths.work,
    paths.out,
    path.dirname(paths.emptyGitConfig),
    paths.emptyHooks,
    paths.home,
    paths.tmp,
    paths.agent,
    paths.npmCache,
    paths.download,
  ]) {
    mkdirSync(directory, { recursive: true, mode: PRIVATE_DIR })
  }
  for (const file of [paths.emptyGitConfig, paths.npmUserConfig, paths.npmGlobalConfig]) {
    writeFileSync(file, '', { flag: 'wx', mode: PRIVATE_FILE })
  }
  return paths
}

/** A later step's invocation: directly under RUNNER_TEMP/muse-spark and named as allocated. */
export function invocationFromEnv(env) {
  const invocation = env.MUSE_INVOCATION ?? ''
  const runnerTemp = env.RUNNER_TEMP ?? ''
  if (!path.isAbsolute(invocation) || !path.isAbsolute(runnerTemp)) {
    throw new InputError('the invocation directory is missing')
  }
  const root = path.join(realpathSync.native(runnerTemp), INVOCATION_ROOT)
  const real = realpathSync.native(invocation)
  if (path.dirname(real) !== root || !INVOCATION_NAME.test(path.basename(real))) {
    throw new InputError('the invocation directory is not one this Action allocated')
  }
  return real
}

function exactBoolean(env, name, fallback) {
  const value = env[name] ?? ''
  if (value === '') return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new InputError(`${name} must be true or false`)
}

function boundedInteger(env, name, fallback, min, max) {
  const value = env[name] ?? ''
  if (value === '') return fallback
  if (!INTEGER.test(value)) throw new InputError(`${name} must be an integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new InputError(`${name} must be between ${String(min)} and ${String(max)}`)
  }
  return parsed
}

/** The budget's exact decimal string: [0-9]+(.[0-9]{1,6})?, $0.000001 to $20 (lead ruling F1). */
export function budgetString(value) {
  if (typeof value !== 'string' || !DECIMAL_BUDGET.test(value)) {
    throw new InputError('max-budget-usd must be a plain decimal number of USD')
  }
  const [whole = '', fraction = ''] = value.split('.', 2)
  const units = BigInt(whole) * USD_UNITS + BigInt(fraction.padEnd(6, '0'))
  if (units < 1n || units > MAX_BUDGET_UNITS) {
    throw new InputError('max-budget-usd must be more than 0 and at most 20')
  }
  return value
}

function optionalUrl(env, name) {
  const value = env[name] ?? ''
  if (value === '') return ''
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new InputError(`${name} must be a URL`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InputError(`${name} must be an http or https URL`)
  }
  return value
}

function singleLine(env, name, maxChars) {
  const value = env[name] ?? ''
  if (/[\r\n]/.test(value) || value.includes('\u{0}') || value.length > maxChars) {
    throw new InputError(`${name} must be one short line`)
  }
  return value
}

/** Every Action input from the step environment (MUSE_INPUT_*), validated (SPEC §6.1). */
export function parseActionInputs(env) {
  const mode = env.MUSE_INPUT_MODE || 'review'
  if (mode !== 'review' && mode !== 'fix') throw new InputError('mode must be review or fix')
  const effort = env.MUSE_INPUT_EFFORT ?? ''
  if (effort !== '' && !EFFORTS.has(effort)) throw new InputError('effort is not a known level')
  const model = env.MUSE_INPUT_MODEL ?? ''
  if (model !== '' && !MODEL.test(model)) throw new InputError('model is not a model id')
  const prNumber = env.MUSE_INPUT_PR_NUMBER ?? ''
  if (prNumber !== '' && !/^[1-9][0-9]{0,9}$/.test(prNumber)) {
    throw new InputError('pr-number must be a positive integer')
  }
  const triggerPhrase = singleLine(env, 'MUSE_INPUT_TRIGGER_PHRASE', TRIGGER_MAX_CHARS)
  const agentPackage = env.MUSE_INPUT_AGENT_PACKAGE ?? ''
  const agentPackageSha256 = env.MUSE_INPUT_AGENT_PACKAGE_SHA256 ?? ''
  if ((agentPackage === '') !== (agentPackageSha256 === '')) {
    throw new InputError('agent-package and agent-package-sha256 go together')
  }
  if (agentPackageSha256 !== '' && !SHA256_HEX.test(agentPackageSha256)) {
    throw new InputError('agent-package-sha256 must be 64 lowercase hex digits')
  }
  return {
    mode,
    maxBudgetUsd: budgetString(env.MUSE_INPUT_MAX_BUDGET_USD),
    imageGeneration: exactBoolean(env, 'MUSE_INPUT_IMAGE_GENERATION', false),
    maxRequests: boundedInteger(
      env,
      'MUSE_INPUT_MAX_REQUESTS',
      DEFAULT_MAX_REQUESTS,
      1,
      MAX_REQUESTS,
    ),
    timeoutMinutes: boundedInteger(
      env,
      'MUSE_INPUT_TIMEOUT_MINUTES',
      DEFAULT_TIMEOUT_MINUTES,
      1,
      MAX_TIMEOUT_MINUTES,
    ),
    model,
    effort,
    allowContributorModels: exactBoolean(env, 'MUSE_INPUT_ALLOW_CONTRIBUTOR_MODELS', false),
    maxDiffBytes: boundedInteger(
      env,
      'MUSE_INPUT_MAX_DIFF_BYTES',
      ACTION_DEFAULT_MAX_DIFF_BYTES,
      1,
      ACTION_MAX_DIFF_BYTES,
    ),
    triggerPhrase: triggerPhrase === '' ? DEFAULT_TRIGGER : triggerPhrase,
    prNumber: prNumber === '' ? null : Number(prNumber),
    extraInstructions: env.MUSE_INPUT_EXTRA_INSTRUCTIONS ?? '',
    path: env.MUSE_INPUT_PATH || '.',
    postComment: exactBoolean(env, 'MUSE_INPUT_POST_COMMENT', true),
    uploadArtifacts: exactBoolean(env, 'MUSE_INPUT_UPLOAD_ARTIFACTS', true),
    httpsProxy: optionalUrl(env, 'MUSE_INPUT_HTTPS_PROXY'),
    noProxy: singleLine(env, 'MUSE_INPUT_NO_PROXY', NO_PROXY_MAX_CHARS),
    extraCaCerts: env.MUSE_INPUT_EXTRA_CA_CERTS ?? '',
    agentPackage,
    agentPackageSha256,
  }
}

/** The raw MUSE_INPUT_* strings of a step environment (never the key or the token). */
export function rawInputs(env) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([name, value]) => name.startsWith('MUSE_INPUT_') && typeof value === 'string',
    ),
  )
}

/** The inputs step 2 validated and stored privately, validated again. */
export async function readActionInputs(paths) {
  return parseActionInputs(JSON.parse(await readFile(paths.action, 'utf8')))
}

/** An https base URL from the runner (GITHUB_API_URL, GITHUB_SERVER_URL), no credentials. */
export function httpsBase(value, fallback, label) {
  const raw = value === undefined || value === '' ? fallback : value
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new InputError(`${label} is not a URL`)
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new InputError(`${label} must be a plain https URL`)
  }
  return raw.replace(/\/+$/, '')
}

/** A response body as bytes, refused past `maxBytes` while it streams. */
export async function readBounded(response, maxBytes) {
  const reader = response.body?.getReader()
  if (reader === undefined) return new Uint8Array()
  const chunks = []
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.length
    if (bytes > maxBytes) {
      await reader.cancel()
      throw new Error('a response was larger than its bound')
    }
    chunks.push(value)
  }
  return new Uint8Array(Buffer.concat(chunks))
}

/** One GitHub REST call: JSON in and out, no redirects, bounded body. */
export async function githubJson({ fetch, url, token, method = 'GET', body, signal, maxBytes }) {
  const response = await fetch(url, {
    method,
    redirect: 'error',
    signal,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      ...(body !== undefined && { 'content-type': 'application/json' }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })
  const bytes = await readBounded(response, maxBytes)
  if (!response.ok) throw new Error(`GitHub answered ${String(response.status)}`)
  return JSON.parse(Buffer.from(bytes).toString('utf8'))
}

/** The caller's network inputs, the CA file canonical and outside the workspace. */
export function networkInputs(inputs, workspace) {
  return {
    httpsProxy: inputs.httpsProxy,
    noProxy: inputs.noProxy,
    extraCaCerts:
      inputs.extraCaCerts === ''
        ? ''
        : regularFileOutside(inputs.extraCaCerts, workspace, 'extra-ca-certs'),
  }
}

/** Step outputs, each in GitHub's delimited multi-line form so no value can add another. */
export async function writeOutputs(file, record) {
  if (typeof file !== 'string' || file === '') return
  const lines = Object.entries(record).map(([name, value]) => {
    const text = String(value)
    const delimiter = `MUSE_${randomBytes(RANDOM_BYTES).toString('hex')}`
    return `${name}<<${delimiter}\n${text}\n${delimiter}\n`
  })
  await appendFile(file, lines.join(''))
}

/** The trusted tools: canonical Node (this process) and Git, npm beside Node; none in the workspace. */
export function resolveTools({ env, platform, execPath, workspace }) {
  const node = regularFileOutside(execPath, workspace, 'node')
  return {
    node,
    git: findGit({ env, platform, workspace }),
    ...npmScripts(node, platform, workspace),
  }
}

async function prepare(env) {
  const role = env.MUSE_TOOLS_ROLE || 'run'
  if (!ROLES.has(role)) throw new InputError('unknown role')
  const workspace = env.GITHUB_WORKSPACE ?? ''
  if (!path.isAbsolute(workspace)) throw new InputError('GITHUB_WORKSPACE is missing')
  const tools = resolveTools({
    env,
    platform: process.platform,
    execPath: process.execPath,
    workspace,
  })
  const inputs = role === 'run' ? parseActionInputs(env) : { path: env.MUSE_INPUT_PATH || '.' }
  if (role === 'run') networkInputs(inputs, workspace)
  const checkout = checkoutPathFor(workspace, inputs.path)
  const id = invocationId({
    runId: env.GITHUB_RUN_ID,
    attempt: env.GITHUB_RUN_ATTEMPT,
    job: env.GITHUB_JOB,
    random: randomBytes(RANDOM_BYTES).toString('hex'),
  })
  const paths = allocateInvocation({ runnerTemp: env.RUNNER_TEMP ?? '', role, id, checkout })
  if (role === 'run') {
    await writeFile(paths.action, JSON.stringify(rawInputs(env)), {
      flag: 'wx',
      mode: PRIVATE_FILE,
    })
  }
  await writeOutputs(env.GITHUB_OUTPUT, {
    invocation: paths.invocation,
    work: paths.work,
    out: paths.out,
    download: paths.download,
    checkout,
    prompt: paths.prompt,
    diff: paths.diff,
    meta: paths.meta,
    staging: paths.staging,
    events: paths.events,
    result: paths.result,
    patch: paths.patch,
    manifest: paths.manifest,
    node: tools.node,
    git: tools.git,
    'npm-cli': tools.npmCli,
    'npx-cli': tools.npxCli,
    'artifact-name': `muse-spark-${id}`,
  })
}

/** Deletes only the allocated invocation's work/, keeping out/. */
export async function tidy(env) {
  const invocation = invocationFromEnv(env)
  await rm(path.join(invocation, 'work'), { recursive: true, force: true })
}

async function main() {
  try {
    if (process.argv[2] === 'tidy') await tidy(process.env)
    else await prepare(process.env)
  } catch (error) {
    const message = error instanceof InputError ? error.message : 'the Action could not prepare'
    process.stderr.write(`::error::${message}\n`)
    process.exitCode = 1
  }
}

if (isEntry(import.meta.url)) await main()
