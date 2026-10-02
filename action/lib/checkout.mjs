// Step 5 of the Action and the apply sub-action's checkout (M80, SPEC §6.1,
// §6.3): a fresh repository in the gated directory, the exact API-validated
// head (and base, for the review diff) fetched through safeGit with the read
// token in a one-command header, nothing persisted, and the head checked out
// detached with every configured program suppressed. No checkout action's
// unsanitized Git children are used.

import { mkdir, readdir } from 'node:fs/promises'
import process from 'node:process'
import { gitText, requireGit, safeGit } from './git.mjs'
import { ACTION_CHECKOUT_MS, childEnvironment, createLauncherOwner, isEntry } from './lifecycle.mjs'
import {
  actionPaths,
  httpsBase,
  InputError,
  invocationFromEnv,
  networkInputs,
  readActionInputs,
} from './tools.mjs'

const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/
const PRIVATE_DIR = 0o700

/** The only remote a checkout or push uses: https on the runner's server, from validated names. */
export function remoteFor(serverUrl, repository) {
  if (!REPOSITORY.test(repository)) throw new InputError('the repository name is malformed')
  return `${httpsBase(serverUrl, 'https://github.com', 'GITHUB_SERVER_URL')}/${repository}.git`
}

async function emptyDirectory(directory) {
  try {
    const entries = await readdir(directory)
    if (entries.length > 0) throw new InputError('the checkout path must be empty')
  } catch (error) {
    if (error instanceof InputError) throw error
    await mkdir(directory, { recursive: true, mode: PRIVATE_DIR })
  }
}

/**
 * Fetches the exact commits and checks out `headSha` detached in the empty
 * `directory`. `token` travels only in the fetch's one-shot header. Returns
 * the verified HEAD.
 */
export async function checkoutHead({ owner, git, paths, baseEnv, directory, remote, shas, token }) {
  if (shas.some((sha) => !SHA.test(sha))) throw new InputError('a commit id is malformed')
  await emptyDirectory(directory)
  const run = (args, extra = {}) =>
    safeGit({ owner, git, cwd: directory, args, paths, baseEnv, readOnly: false, ...extra })
  requireGit(await run(['init', '--quiet', `--template=${paths.emptyHooks}`]), 'init')
  requireGit(
    await run(
      [
        'fetch',
        '--quiet',
        '--no-tags',
        '--no-write-fetch-head',
        '--no-recurse-submodules',
        remote,
        ...shas.map((sha) => `+${sha}:refs/muse-spark/${sha}`),
      ],
      token === '' ? {} : { auth: { kind: 'checkout', token } },
    ),
    'fetch',
  )
  requireGit(await run(['checkout', '--quiet', '--detach', shas[0]]), 'checkout')
  const head = gitText(
    requireGit(
      await safeGit({
        owner,
        git,
        cwd: directory,
        args: ['rev-parse', '--verify', 'HEAD^{commit}'],
        paths,
        baseEnv,
        readOnly: true,
      }),
      'rev-parse',
    ),
  )
  if (head !== shas[0]) throw new Error('the checked out head is not the validated head')
  return head
}

async function main() {
  const env = process.env
  let token = env.MUSE_GITHUB_TOKEN ?? ''
  const owner = createLauncherOwner({
    paths: {},
    dropSecrets: () => {
      token = ''
    },
    totalMs: ACTION_CHECKOUT_MS,
  })
  try {
    const paths = actionPaths(invocationFromEnv(env), env.MUSE_CHECKOUT ?? '')
    const inputs = await readActionInputs(paths)
    const baseEnv = childEnvironment({
      platform: process.platform,
      parentEnv: env,
      paths,
      nodePath: env.MUSE_NODE ?? '',
      network: networkInputs(inputs, env.GITHUB_WORKSPACE ?? ''),
    })
    await owner.phase('checkout', ACTION_CHECKOUT_MS, () =>
      checkoutHead({
        owner,
        git: env.MUSE_GIT ?? '',
        paths,
        baseEnv,
        directory: paths.checkout,
        remote: remoteFor(env.GITHUB_SERVER_URL, env.GITHUB_REPOSITORY ?? ''),
        shas: [env.MUSE_HEAD_SHA ?? '', env.MUSE_BASE_SHA ?? ''],
        token,
      }),
    )
    process.stdout.write('Checked out the validated pull request head.\n')
  } catch (error) {
    const message = error instanceof InputError ? error.message : 'the checkout failed'
    process.stderr.write(`::error::${message}\n`)
    process.exitCode = 1
  } finally {
    await owner.cleanup()
  }
}

if (isEntry(import.meta.url)) await main()
