// The apply sub-action (M80, SPEC §6.6): runs in its own job, never with the
// model key, and runs no proposal script, npm, repository code, hook,
// filter, fsmonitor or signer.
// - prepare (contents: read, no secrets): validate the downloaded artifact's
//   manifest and exact patch digest against this run, check out the
//   manifest's head through safeGit and `git apply --index` the exact
//   patch; the caller's own tests run next.
// - push (environment muse-apply, contents: write): validate again, ask the
//   API for the pull request anew (open, same repository, the exact head),
//   check out, apply, commit with hooks and signing suppressed, and push
//   HEAD to the validated head ref with a lease on the exact head, the
//   write token in that one command's header only.
// Any refusal throws and the step exits nonzero; ready is never false with success.

import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { checkoutHead, remoteFor } from '../../lib/checkout.mjs'
import { gitText, remoteProtocol, requireGit, safeGit } from '../../lib/git.mjs'
import {
  ACTION_APPLY_MS,
  ACTION_DOWNLOAD_MS,
  ACTION_EVENTS_MAX_BYTES,
  ACTION_META_MAX_BYTES,
  ACTION_PATCH_MAX_BYTES,
  ACTION_PUSH_MS,
  ACTION_RESULT_MAX_BYTES,
  childEnvironment,
  createLauncherOwner,
  isEntry,
} from '../../lib/lifecycle.mjs'
import {
  actionPaths,
  githubJson,
  httpsBase,
  InputError,
  invocationFromEnv,
  writeOutputs,
} from '../../lib/tools.mjs'

const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const SHA256_HEX = /^[0-9a-f]{64}$/
const DIGITS = /^[0-9]{1,20}$/
const INVOCATION = /^\d{1,20}-\d{1,10}-[A-Za-z0-9_-]{1,100}-[0-9a-f]{16}$/
const REF = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[A-Za-z0-9._/-]{1,255}(?<![./])$/
const ARTIFACT_PREFIX = 'muse-spark-'
const MANIFEST_KEYS = [
  'headSha',
  'baseSha',
  'prNumber',
  'patchSha256',
  'runId',
  'attempt',
  'invocation',
]
const COMMITTER = Object.freeze([
  '-c',
  'user.name=github-actions[bot]',
  '-c',
  'user.email=41898282+github-actions[bot]@users.noreply.github.com',
])

// The files a proposal artifact may hold (the run's out/) and each one's bound.
const ARTIFACT_FILES = new Map([
  ['manifest.json', ACTION_META_MAX_BYTES],
  ['fix.patch', ACTION_PATCH_MAX_BYTES],
  ['result.json', ACTION_RESULT_MAX_BYTES],
  ['events.jsonl', ACTION_EVENTS_MAX_BYTES],
])

/** A refused proposal; the message names the failed check only. */
export class ApplyRefusal extends Error {
  constructor(message) {
    super(message)
    this.name = 'ApplyRefusal'
  }
}

/**
 * The downloaded proposal: exactly a manifest bound to this run and artifact,
 * and a nonempty patch whose SHA-256 is the manifest's.
 */
export async function validateProposal({ directory, artifactName, runId, signal }) {
  // Only what out/ can hold, each a regular file within its bound, checked
  // before anything is read (RVM80CD P2-4): an unrelated or oversized
  // artifact is refused without being loaded.
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const limit = ARTIFACT_FILES.get(entry.name)
    if (limit === undefined || !entry.isFile()) {
      throw new ApplyRefusal('the artifact holds an unexpected entry')
    }
    const { size } = await stat(path.join(directory, entry.name))
    if (size > limit) throw new ApplyRefusal('an artifact file is larger than its bound')
  }
  const names = new Set(entries.map((entry) => entry.name))
  if (!names.has('manifest.json') || !names.has('fix.patch')) {
    throw new ApplyRefusal('the artifact has no patch and manifest')
  }
  const manifest = JSON.parse(
    await readFile(path.join(directory, 'manifest.json'), { encoding: 'utf8', signal }),
  )
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    Object.keys(manifest).length !== MANIFEST_KEYS.length ||
    MANIFEST_KEYS.some((key) => !Object.hasOwn(manifest, key)) ||
    !SHA.test(manifest.headSha) ||
    !SHA.test(manifest.baseSha) ||
    !Number.isSafeInteger(manifest.prNumber) ||
    manifest.prNumber < 1 ||
    !SHA256_HEX.test(manifest.patchSha256) ||
    !DIGITS.test(manifest.runId) ||
    !DIGITS.test(manifest.attempt) ||
    !INVOCATION.test(manifest.invocation)
  ) {
    throw new ApplyRefusal('the manifest is malformed')
  }
  if (manifest.runId !== runId || artifactName !== `${ARTIFACT_PREFIX}${manifest.invocation}`) {
    throw new ApplyRefusal('the artifact does not belong to this run')
  }
  const patch = await readFile(path.join(directory, 'fix.patch'), { signal })
  if (patch.length === 0 || patch.length > ACTION_PATCH_MAX_BYTES) {
    throw new ApplyRefusal('the patch is empty or too large')
  }
  if (createHash('sha256').update(patch).digest('hex') !== manifest.patchSha256) {
    throw new ApplyRefusal('the patch digest does not match the manifest')
  }
  return { manifest, patchFile: path.join(directory, 'fix.patch') }
}

/** The pull request, anew: open, from this repository, at exactly the manifest's head. */
export function checkPullForPush(pull, repository, headSha) {
  const head = pull?.head
  if (head?.repo?.full_name !== repository || pull?.state !== 'open') {
    throw new ApplyRefusal('the pull request is not open in this repository')
  }
  if (head.sha !== headSha) throw new ApplyRefusal('the pull request head changed')
  if (typeof head.ref !== 'string' || !REF.test(head.ref)) {
    throw new ApplyRefusal('the pull request head ref is malformed')
  }
  return head.ref
}

/**
 * prepare or push, under the apply owner (SPEC §6.6). `remote` is the https
 * remote from validated names (a local path only in tests).
 */
export async function applyProposal(input) {
  const { owner, paths, git, mode, baseEnv, remote } = input
  const { manifest, patchFile } = await owner.phase('validate', ACTION_DOWNLOAD_MS, (signal) =>
    validateProposal({
      directory: paths.download,
      artifactName: input.artifactName,
      runId: input.runId,
      signal,
    }),
  )
  let headRef
  if (mode === 'push') {
    const pull = await owner.phase('pull', ACTION_DOWNLOAD_MS, (signal) =>
      githubJson({
        fetch: input.fetch,
        url: `${input.apiUrl}/repos/${input.repository}/pulls/${String(manifest.prNumber)}`,
        token: input.githubToken,
        signal,
        maxBytes: ACTION_RESULT_MAX_BYTES,
      }),
    )
    headRef = checkPullForPush(pull, input.repository, manifest.headSha)
  }
  const run = (args, extra = {}) =>
    safeGit({ owner, git, cwd: paths.checkout, args, paths, baseEnv, readOnly: false, ...extra })
  await checkoutHead({
    owner,
    git,
    paths,
    baseEnv,
    directory: paths.checkout,
    remote,
    shas: [manifest.headSha],
    token: input.githubToken,
  })
  requireGit(await run(['apply', '--index', '--whitespace=nowarn', patchFile]), 'apply')
  if (mode === 'prepare') return { ready: true, commitSha: null }
  requireGit(
    await run([
      ...COMMITTER,
      'commit',
      '--quiet',
      '-m',
      `Apply Muse Spark proposal ${manifest.invocation}`,
    ]),
    'commit',
  )
  const commitSha = gitText(
    requireGit(
      await safeGit({
        owner,
        git,
        cwd: paths.checkout,
        args: ['rev-parse', '--verify', 'HEAD^{commit}'],
        paths,
        baseEnv,
        readOnly: true,
      }),
      'rev-parse',
    ),
  )
  requireGit(
    await run(
      [
        'push',
        '--quiet',
        remote,
        `HEAD:refs/heads/${headRef}`,
        `--force-with-lease=refs/heads/${headRef}:${manifest.headSha}`,
      ],
      {
        auth: { kind: 'push', token: input.githubToken },
        protocol: remoteProtocol(remote),
        withinMs: ACTION_PUSH_MS,
      },
    ),
    'push',
  )
  return { ready: true, commitSha }
}

async function main() {
  const env = process.env
  let token = env.MUSE_GITHUB_TOKEN ?? ''
  const owner = createLauncherOwner({
    paths: {},
    dropSecrets: () => {
      token = ''
    },
    totalMs: ACTION_APPLY_MS,
  })
  try {
    const mode = env.MUSE_INPUT_MODE
    if (mode !== 'prepare' && mode !== 'push') throw new InputError('mode must be prepare or push')
    const paths = actionPaths(invocationFromEnv(env), env.MUSE_CHECKOUT ?? '')
    const repository = env.GITHUB_REPOSITORY ?? ''
    const node = env.MUSE_NODE ?? ''
    const result = await applyProposal({
      owner,
      paths,
      git: env.MUSE_GIT ?? '',
      mode,
      artifactName: env.MUSE_ARTIFACT_NAME ?? '',
      runId: env.GITHUB_RUN_ID ?? '',
      repository,
      githubToken: token,
      fetch,
      apiUrl: httpsBase(env.GITHUB_API_URL, 'https://api.github.com', 'GITHUB_API_URL'),
      remote: remoteFor(env.GITHUB_SERVER_URL, repository),
      baseEnv: childEnvironment({
        platform: process.platform,
        parentEnv: env,
        paths,
        nodePath: node,
      }),
    })
    await writeOutputs(env.GITHUB_OUTPUT, {
      ready: String(result.ready),
      'commit-sha': result.commitSha ?? '',
    })
  } catch (error) {
    const message =
      error instanceof ApplyRefusal || error instanceof InputError
        ? error.message
        : 'the proposal could not be applied'
    process.stderr.write(`::error::${message}\n`)
    process.exitCode = 1
  } finally {
    await owner.cleanup()
  }
}

if (isEntry(import.meta.url)) await main()
