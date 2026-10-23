// Workspaces come from git (M110b W2, D90.6 §6): clone and pull through
// M109's broker, workers never pushing or merging. The broker's
// provisions (its SSH env, its scoped ephemeral helper, its pinned
// known-hosts) arrive injected — the lease machinery that mints them
// is joint work with M109's owner — and this layer builds the only
// git invocation a workspace ever runs: a scrubbed base (the house
// worker scrubber) plus the broker's fragments, no submodules, no `-c`
// from the caller, pushes only with an exact orchestrator grant,
// merges never. Repository-named drivers (filters, diffs) stay inert:
// a driver runs only with a definition, and no definition can exist —
// clone never writes one, user and system config are nulled, and the
// config verb is refused. Pure builders below; the runner at the
// bottom is drill-proven against real git.
import { execFile } from 'node:child_process'
import { workerEnvironment } from '../../../core/team/workers/workerEnv'
import { settleExecFile } from './spawn'

/** What the broker provisions for one workspace's git use. */
export interface BrokerGitProvisions {
  /** The SSH endpoint's exact env fragment (socket address, pipe command). */
  readonly sshEnv?: Readonly<Record<string, string>>
  /** The scoped ephemeral helper: its path plus its rendezvous env. */
  readonly helper?: {
    readonly path: string
    readonly env: Readonly<Record<string, string>>
  }
  /** The broker-pinned known-hosts file SSH must use and nothing else. */
  readonly knownHostsPath?: string
}

/** What a remote is: SSH and HTTPS go brokered, local needs no credentials. */
export type WorkspaceRemoteKind = 'ssh' | 'https' | 'local' | 'refused'

const SCP_LIKE = /^(?:[^/:@\s]+@)?[^/:@\s]+:[^:\s].*$/
const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/

/**
Classify a remote. SSH is `ssh://` or scp-like; HTTPS only (plain HTTP
carries credentials and objects in the clear); local is `file://` or a
bare path. Anything else — `ext::`, helpers, flags posing as remotes —
is refused, never run.
*/
export function classifyRemote(remote: string, platform: NodeJS.Platform): WorkspaceRemoteKind {
  if (platform === 'win32' && WINDOWS_DRIVE_PATH.test(remote)) return 'local'
  if (remote.startsWith('-')) return 'refused'
  if (remote.startsWith('https://')) return 'https'
  if (remote.startsWith('http://')) return 'refused'
  if (remote.startsWith('ssh://')) return 'ssh'
  if (remote.startsWith('file://')) return 'local'
  if (remote.includes('://') || remote.includes('::')) return 'refused'
  if (SCP_LIKE.test(remote)) return 'ssh'
  return remote.includes(':') ? 'refused' : 'local'
}

/** An orchestrator grant to push one ref to one remote: exact strings only. */
export interface PushGrant {
  readonly remote: string
  readonly ref: string
}

const READ_LOCAL_VERBS = new Set([
  'clone',
  'pull',
  'fetch',
  'checkout',
  'status',
  'log',
  'diff',
  'show',
  'rev-parse',
  'commit',
  'add',
  'branch',
  'stash',
  'bundle',
  'ls-files',
  'clean',
  'tag',
  'reset',
  'cherry-pick',
  'apply',
])

/** Why a git invocation is refused: the audit reads the code, never the words. */
export type GitRefusal =
  | 'unknown-verb'
  | 'merge-family'
  | 'push-ungranted'
  | 'submodule'
  | 'config-override'
  | 'unsafe-flag'
  | 'remote-refused'
  | 'unpinned-ssh'
  | 'unbrokered-https'
  | 'credential-material'

function isPushGranted(rest: readonly string[], grants: readonly PushGrant[]): boolean {
  if (rest.length !== 2) return false
  const [remote, ref] = rest
  return (
    remote !== undefined &&
    ref !== undefined &&
    !remote.startsWith('-') &&
    !ref.startsWith('-') &&
    grants.some((grant) => grant.remote === remote && grant.ref === ref)
  )
}

/** Flags no workspace invocation may carry, wherever placed. */
function isGloballyDenied(arg: string): boolean {
  if (arg === 'submodule' || arg.startsWith('-c') || arg.startsWith('-C')) return true
  const longDenies = [
    '--config',
    '--config-env',
    '--exec-path',
    '--git-dir',
    '--help',
    '--receive-pack',
    '--recurse-submodules',
    '--rebase',
    '--separate-git-dir',
    '--upload-pack',
    '--work-tree',
  ]
  return longDenies.some((denied) => arg === denied || arg.startsWith(`${denied}=`))
}

function isSubmoduleArg(arg: string): boolean {
  return (
    arg === 'submodule' || arg === '--recurse-submodules' || arg.startsWith('--recurse-submodules=')
  )
}

/** Boolean flags a network verb may carry; anything else taking `-` is refused. */
const NETWORK_BOOLEAN_FLAGS = new Set([
  '--no-checkout',
  '-n',
  '--quiet',
  '-q',
  '--verbose',
  '-v',
  '--progress',
  '--no-progress',
  '--single-branch',
  '--dissociate',
  '--prune',
  '--tags',
  '-t',
  '--force',
  '-f',
  '--ff-only',
])

/** Value flags a network verb may carry; each consumes the next arg. */
const NETWORK_VALUE_FLAGS = new Set([
  '--depth',
  '--deepen',
  '--branch',
  '-b',
  '--origin',
  '-o',
  '--template',
])

/** Verbs whose rest is flag-walked for a remote (`push` adds its grant check). */
const NETWORK_VERBS: ReadonlySet<string> = new Set(['clone', 'fetch', 'pull'])

/**
Split a network verb's rest into its remote (first positional) and
safety: unknown flags, `-u` in any form (upload-pack for clone), and
the global denials refuse. Refspecs, branches and the target dir ride
positionally and are never classified as remotes.
*/
export function splitNetworkArgs(
  rest: readonly string[],
): { readonly ok: true; readonly remote?: string } | { readonly ok: false } {
  let remote: string | undefined
  let index = 0
  while (index < rest.length) {
    const arg = rest[index] ?? ''
    if (isGloballyDenied(arg)) return { ok: false }
    if (arg === '-u' || arg.startsWith('-u')) return { ok: false }
    if (arg.startsWith('-')) {
      if (NETWORK_VALUE_FLAGS.has(arg)) {
        index += 2
        continue
      }
      if (!NETWORK_BOOLEAN_FLAGS.has(arg)) return { ok: false }
      index += 1
      continue
    }
    remote ??= arg
    index += 1
  }
  return { ok: true, ...(remote !== undefined && { remote }) }
}

/**
Whether the verb may run. Push is exactly `push <remote> <ref>` with an
exact grant — any flag, however placed, breaks the match and refuses;
merge and rebase never run in a workspace; submodule would spend the
broker's agent signature on repository-chosen remotes; network verbs
take only their known flags (so `-u`, `--separate-git-dir` and friends
never smuggle runners past the gate); `clean` is exactly `-fd` plus
paths (ignored files are kept, never `-x`'d away).
*/
export function gateVerb(
  argv: readonly string[],
  grants: readonly PushGrant[],
): { readonly ok: true } | { readonly ok: false; readonly reason: GitRefusal } {
  const [verb, ...rest] = argv
  if (verb === undefined || !READ_LOCAL_VERBS.has(verb)) {
    if (verb === 'merge' || verb === 'rebase') return { ok: false, reason: 'merge-family' }
    if (verb === 'push') {
      return isPushGranted(rest, grants) ? { ok: true } : { ok: false, reason: 'push-ungranted' }
    }
    return { ok: false, reason: 'unknown-verb' }
  }
  if (rest.some((arg) => isSubmoduleArg(arg))) return { ok: false, reason: 'submodule' }
  if (NETWORK_VERBS.has(verb)) {
    return splitNetworkArgs(rest).ok ? { ok: true } : { ok: false, reason: 'unsafe-flag' }
  }
  if (verb === 'clean') {
    const isSafe = rest.every((arg) => arg === '-fd' || !arg.startsWith('-'))
    return isSafe ? { ok: true } : { ok: false, reason: 'unsafe-flag' }
  }
  if (rest.some((arg) => arg === '-c' || arg === '--config' || arg.startsWith('--config='))) {
    return { ok: false, reason: 'config-override' }
  }
  return rest.some((arg) => isGloballyDenied(arg))
    ? { ok: false, reason: 'unsafe-flag' }
    : { ok: true }
}

/** Credential shapes that must never ride a git environment's values. */
const CREDENTIAL_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /^(ghp_|github_pat_|gho_|ghu_|ghs_|ghr_)/,
  /^xox[bap]-/,
  /^sk-(live|test)-/,
  /^AKIA[0-9A-Z]{16}$/,
  /^glpat-/,
]

/**
The values a git environment carries must be paths and sockets, never
key material: a provision carrying a secret is a broker bug, and the
workspace refuses to run it. A tripwire, not a validator.
*/
export function hasNoCredentialMaterial(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return Object.values(env).every(
    (value) =>
      value === undefined || CREDENTIAL_VALUE_PATTERNS.every((pattern) => !pattern.test(value)),
  )
}

/**
The environment one workspace git invocation runs with: the scrubbed
worker base (no inherited git/ssh/credential state, no user or system
config that could name credentials), plus the broker's fragments for
the remote's kind. SSH without the broker's pinned known-hosts, or
HTTPS without its helper, is refused — an unbrokered credentialed
remote never runs. The helper rides `GIT_CONFIG_*` (exact values, so
broker paths with spaces survive).
*/
export function brokeredGitEnv(
  base: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  kind: WorkspaceRemoteKind,
  provisions: BrokerGitProvisions,
):
  | { readonly ok: true; readonly env: NodeJS.ProcessEnv }
  | { readonly ok: false; readonly reason: GitRefusal } {
  if (kind === 'refused') return { ok: false, reason: 'remote-refused' }
  const env = workerEnvironment(base, platform)
  env['GIT_PAGER'] = 'cat'
  env['PAGER'] = 'cat'
  env['GIT_EDITOR'] = 'true'
  if (kind === 'local') return { ok: true, env }
  if (kind === 'ssh') {
    if (provisions.sshEnv === undefined || provisions.knownHostsPath === undefined) {
      return { ok: false, reason: 'unpinned-ssh' }
    }
    const merged: Record<string, string | undefined> = { ...env, ...provisions.sshEnv }
    if (provisions.sshEnv['GIT_SSH_COMMAND'] === undefined) {
      merged['GIT_SSH_COMMAND'] =
        `ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${provisions.knownHostsPath}`
    }
    return hasNoCredentialMaterial(merged)
      ? { ok: true, env: merged }
      : { ok: false, reason: 'credential-material' }
  }
  if (provisions.helper === undefined) return { ok: false, reason: 'unbrokered-https' }
  const merged: Record<string, string | undefined> = {
    ...env,
    ...provisions.helper.env,
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'credential.helper',
    GIT_CONFIG_VALUE_0: provisions.helper.path,
    GIT_CONFIG_KEY_1: 'core.askpass',
    GIT_CONFIG_VALUE_1: '',
  }
  return hasNoCredentialMaterial(merged)
    ? { ok: true, env: merged }
    : { ok: false, reason: 'credential-material' }
}

/** A finished git run: exit code and both streams, as text. */
export interface GitResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/** The daemon's trimmed words in an error: codes, never full bodies. */
const GIT_ERROR_SNIPPET_CHARS = 200

export class GitRefusedError extends Error {
  public constructor(public readonly reason: GitRefusal) {
    super(`workspace git refused: ${reason}`)
  }
}

export class GitFailedError extends Error {
  public constructor(
    public readonly exitCode: number,
    message: string,
  ) {
    super(message)
  }
}

/**
Run one gated git invocation: the verb passes the gate, the effective
remote (the invocation's, else the workspace's own) passes
classification, the env is the brokered one, and pulls are
fast-forward only (a workspace never integrates). Without `maxBytes`
the platform's own stdio bound applies; the person's cap overrides it.
*/
export async function runWorkspaceGit(
  gitPath: string,
  argv: readonly string[],
  options: {
    readonly cwd: string
    readonly platform: NodeJS.Platform
    readonly baseEnv: NodeJS.ProcessEnv
    /** The workspace's own remote: the kind of argv without one. */
    readonly remote: string
    readonly provisions: BrokerGitProvisions
    readonly grants?: readonly PushGrant[]
    readonly maxBytes?: number
    /** Exit codes that succeed: `diff` answers 1 for differences. */
    readonly okCodes?: readonly number[]
  },
): Promise<GitResult> {
  const okCodes = options.okCodes ?? [0]
  const gated = gateVerb(argv, options.grants ?? [])
  if (!gated.ok) throw new GitRefusedError(gated.reason)
  const [verb, ...rest] = argv
  const isNetwork = verb === 'push' || (verb !== undefined && NETWORK_VERBS.has(verb))
  const split = isNetwork ? splitNetworkArgs(rest) : { ok: true as const, remote: undefined }
  if (!split.ok) throw new GitRefusedError('unsafe-flag')
  const kind = isNetwork
    ? classifyRemote(split.remote ?? options.remote, options.platform)
    : 'local'
  const environ = brokeredGitEnv(options.baseEnv, options.platform, kind, options.provisions)
  if (!environ.ok) throw new GitRefusedError(environ.reason)
  const effective = verb === 'pull' && !argv.includes('--ff-only') ? [...argv, '--ff-only'] : argv
  return await new Promise<GitResult>((resolve, reject) => {
    const child = execFile(
      gitPath,
      [...effective],
      {
        cwd: options.cwd,
        env: environ.env,
        ...(options.maxBytes !== undefined && { maxBuffer: options.maxBytes }),
      },
      (error, stdout, stderr) => {
        const settled = settleExecFile(error, stdout, stderr)
        if ('spawnFailed' in settled) {
          reject(
            new Error(`git ${verb ?? ''} failed to run: ${settled.spawnFailed.message}`, {
              cause: settled.spawnFailed,
            }),
          )
          return
        }
        const code = settled.exited.exitCode
        if (!okCodes.includes(code)) {
          reject(
            new GitFailedError(
              code,
              `git ${verb ?? ''} exited ${String(code)}: ${stderr.slice(0, GIT_ERROR_SNIPPET_CHARS)}`,
            ),
          )
          return
        }
        resolve({ exitCode: code, stdout, stderr })
      },
    )
    // The callback owns the outcome; this guard only stops a spawn
    // failure's `error` event from throwing unhandled beside it.
    child.on('error', () => {
      /* the callback above already typed it */
    })
  })
}
