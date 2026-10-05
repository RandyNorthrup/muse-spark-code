// The credential-free worker environment (M96 lane W, PLAN.md D75's ref
// fence and acceptance 24): a worker process holds no credential variable
// except the names its profile passes through, and its git cannot reach a
// credential helper, a prompt, an askpass program, an agent socket, or a
// working ssh.
//
// Lane I's `refFence.ts` owns the canonical version of this contract; this
// module is lane W's use of it for the engine worker's shell and the ACP
// agent's process, kept in one place so integration picks one.

/** Only the process search path, user home and OS runtime directories are inherited. */
const WORKER_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'SystemRoot',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'TMP',
  'TEMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
] as const

/** Profile passthrough cannot restore Git configuration or credential transports. */
function isForbiddenPassthrough(name: string): boolean {
  const upper = name.toUpperCase()
  return upper.startsWith('GIT_') || upper.startsWith('SSH_') || upper.endsWith('ASKPASS')
}

function isSameEnvName(platform: NodeJS.Platform, left: string, right: string): boolean {
  return platform === 'win32' ? left.toUpperCase() === right.toUpperCase() : left === right
}

export interface ScrubWorkerEnvInput {
  readonly platform: NodeJS.Platform
  readonly baseEnv: NodeJS.ProcessEnv
  /**
   * Profile-declared names the agent may receive (D75: "except the names
   * the profile passes through"), read from the unscrubbed base.
   */
  readonly passthrough?: readonly string[] | undefined
}

/**
 * Starts empty, copies only the safe runtime names and explicit profile
 * passthrough, then pins Git isolation. A profile cannot override the fence.
 * Shared contract for lane I: integrate this helper as `scrubWorkerEnv`.
 */
export function scrubWorkerEnv(input: ScrubWorkerEnvInput): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  const names = Object.keys(input.baseEnv)
  for (const name of [...WORKER_ENV_ALLOWLIST, ...(input.passthrough ?? [])]) {
    if (isForbiddenPassthrough(name)) {
      continue
    }
    const found = names.find((key) => isSameEnvName(input.platform, key, name))
    if (found !== undefined && input.baseEnv[found] !== undefined) {
      env[found] = input.baseEnv[found]
    }
  }
  env['GIT_CONFIG_NOSYSTEM'] = '1'
  env['GIT_CONFIG_GLOBAL'] = input.platform === 'win32' ? 'NUL' : '/dev/null'
  env['GIT_TERMINAL_PROMPT'] = '0'
  env['GIT_CONFIG_COUNT'] = '2'
  env['GIT_CONFIG_KEY_0'] = 'credential.helper'
  env['GIT_CONFIG_VALUE_0'] = ''
  env['GIT_CONFIG_KEY_1'] = 'core.askPass'
  env['GIT_CONFIG_VALUE_1'] = ''
  env['GIT_SSH_COMMAND'] = 'false'
  return env
}
