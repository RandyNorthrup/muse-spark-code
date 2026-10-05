// The credential-free worker environment (M96 lane W, PLAN.md D75's ref
// fence and acceptance 24): a worker process holds no credential variable
// except the names its profile passes through, and its git cannot reach a
// credential helper, a prompt, an askpass program, an agent socket, or a
// working ssh.
//
// Lane I's `refFence.ts` owns the canonical version of this contract; this
// module is lane W's use of it for the engine worker's shell and the ACP
// agent's process, kept in one place so integration picks one.

import { EXEC_CHILD_ENV_DROP, HOOK_FORBIDDEN_ENV_NAMES } from '../../../shared/constants'

/** The git askpass names a worker never inherits. */
const WORKER_GIT_PROMPT_NAMES = ['GIT_ASKPASS', 'SSH_ASKPASS', 'SSH_AUTH_SOCK'] as const

/**
 * A name that plausibly holds a credential: the exact names hooks never
 * get, the exec child's drop list, and any `*_API_KEY`-shaped name. The
 * suffix match is deliberate: a new `FOO_API_KEY` tomorrow is still a
 * credential, so an enumeration gap cannot leak it.
 */
function isCredentialName(name: string): boolean {
  const upper = name.toUpperCase()
  return (
    HOOK_FORBIDDEN_ENV_NAMES.has(name) ||
    HOOK_FORBIDDEN_ENV_NAMES.has(upper) ||
    (EXEC_CHILD_ENV_DROP as readonly string[]).includes(name) ||
    (EXEC_CHILD_ENV_DROP as readonly string[]).includes(upper) ||
    /_(API_KEY|APIKEY|SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|ACCESS_KEY|CREDENTIALS?)$/.test(
      upper,
    )
  )
}

function isSameEnvName(platform: NodeJS.Platform, left: string, right: string): boolean {
  return platform === 'win32' ? left.toUpperCase() === right.toUpperCase() : left === right
}

function deleteName(
  env: NodeJS.ProcessEnv,
  names: readonly string[],
  platform: NodeJS.Platform,
  name: string,
): void {
  for (const key of names) {
    if (isSameEnvName(platform, key, name)) {
      Reflect.deleteProperty(env, key)
    }
  }
}

export interface ScrubWorkerEnvInput {
  readonly platform: NodeJS.Platform
  readonly baseEnv: NodeJS.ProcessEnv
  /**
   * Profile-declared names the agent may receive (D75: "except the names
   * the profile passes through"), read from the unscrubbed base.
   */
  readonly passthrough?: readonly string[]
}

/**
 * Copies `baseEnv`, drops every credential variable, removes git's
 * credential paths, and pins git to no prompt and a refusing ssh. Names in
 * `passthrough` are restored from the base afterwards, so a declared name
 * is the only way a credential reaches a worker.
 */
export function scrubWorkerEnv(input: ScrubWorkerEnvInput): NodeJS.ProcessEnv {
  const { platform } = input
  const env: NodeJS.ProcessEnv = { ...input.baseEnv }
  const names = Object.keys(env)
  for (const key of names) {
    if (isCredentialName(key)) {
      Reflect.deleteProperty(env, key)
    }
  }
  for (const name of WORKER_GIT_PROMPT_NAMES) {
    deleteName(env, names, platform, name)
  }
  // No credential helper: an empty `credential.helper` clears every
  // configured one, and nothing else in the environment may set git config.
  deleteName(env, names, platform, 'GIT_CONFIG_COUNT')
  for (const key of names) {
    if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/i.test(key)) {
      Reflect.deleteProperty(env, key)
    }
  }
  env['GIT_TERMINAL_PROMPT'] = '0'
  env['GIT_CONFIG_COUNT'] = '1'
  env['GIT_CONFIG_KEY_0'] = 'credential.helper'
  env['GIT_CONFIG_VALUE_0'] = ''
  env['GIT_SSH_COMMAND'] = platform === 'win32' ? 'cmd /c exit 1' : 'false'
  const passthrough = input.passthrough ?? []
  for (const name of passthrough) {
    const found = names.find((key) => isSameEnvName(platform, key, name))
    if (found !== undefined) {
      env[name] = input.baseEnv[found]
    }
  }
  return env
}
