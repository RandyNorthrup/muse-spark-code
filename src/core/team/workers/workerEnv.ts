// Leaf policy shared by the ref fence and every engine/ACP worker.

export interface ScrubWorkerEnvInput {
  readonly platform: NodeJS.Platform
  readonly baseEnv: NodeJS.ProcessEnv
  /** Profile names may pass through only when the mandatory fence permits them. */
  readonly passthrough?: readonly string[] | undefined
}

export function scrubWorkerEnv(input: ScrubWorkerEnvInput): NodeJS.ProcessEnv {
  return workerEnvironment(input.baseEnv, input.platform, input.passthrough)
}

const WORKER_ENV_ALLOWLIST = new Set([
  'PATH',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
])
const WORKER_ENV_BLOCKED = /^(?:GIT_|SSH_|LD_|DYLD_|NODE_|BASH_ENV$|ENV$|.*ASKPASS$)/i

/**
 * The environment a worker process starts with: no git credentials (no
 * helper, no prompt, no askpass, no agent socket, an `ssh` that refuses, no
 * user or system configuration that could name credentials), and no
 * credential variable except the names the agent's profile passes through.
 * Returns a fresh object; the input is never mutated.
 */
export function workerEnvironment(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  passthrough: readonly string[] = [],
): NodeJS.ProcessEnv {
  const nullDevice = platform === 'win32' ? 'NUL' : '/dev/null'
  const kept = new Set(passthrough.map((name) => name.toUpperCase()))
  const out: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(env)) {
    const upper = name.toUpperCase()
    if (
      value !== undefined &&
      !WORKER_ENV_BLOCKED.test(upper) &&
      (WORKER_ENV_ALLOWLIST.has(upper) || kept.has(upper))
    ) {
      out[name] = value
    }
  }
  out['GIT_TERMINAL_PROMPT'] = '0'
  out['GIT_SSH_COMMAND'] = 'false'
  out['GIT_CONFIG_COUNT'] = '2'
  out['GIT_CONFIG_KEY_0'] = 'credential.helper'
  out['GIT_CONFIG_VALUE_0'] = ''
  out['GIT_CONFIG_KEY_1'] = 'core.askpass'
  out['GIT_CONFIG_VALUE_1'] = ''
  out['GIT_CONFIG_NOSYSTEM'] = '1'
  out['GIT_CONFIG_GLOBAL'] = nullDevice
  out['GIT_CONFIG_SYSTEM'] = nullDevice
  return out
}
