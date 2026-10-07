import { EXEC_CHILD_ENV_DROP, HOOK_FORBIDDEN_ENV_NAMES } from '../../../shared/constants'

/** Case independent: Windows can retain multiple spellings in a ProcessEnv object. */
export function isCredentialVariable(name: string): boolean {
  const upper = name.toUpperCase()
  return (
    /(?:_API_KEY|_TOKEN|_PASSWORD|_SECRET|_CREDENTIALS)$/u.test(upper) ||
    HOOK_FORBIDDEN_ENV_NAMES.has(upper) ||
    /^(?:TOKEN|PASSWORD|AUTHORIZATION|GOOGLE_APPLICATION_CREDENTIALS|AWS_SHARED_CREDENTIALS_FILE|NETRC)$/u.test(
      upper,
    )
  )
}

export interface VaultFenceOptions {
  /** Supplied only by the trusted launcher, never read from an agent frame. */
  readonly sshSocket?: string | undefined
  /** S pins the verified SSH client where Git for Windows cannot reach a pipe. */
  readonly sshCommand?: string | undefined
  readonly refusingHelper?: string | undefined
  /** Muse Code keeps its own credentials (D1); its tools still lose ambient SSH/git. */
  readonly museCode?: boolean
}

/** No ambient credentials, keyring routes, git helpers, askpass or agent socket. */
export function vaultFenceEnvironment(
  source: NodeJS.ProcessEnv,
  options: VaultFenceOptions = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  const routes: readonly string[] = EXEC_CHILD_ENV_DROP
  for (const [name, value] of Object.entries(source)) {
    const upper = name.toUpperCase()
    if (
      upper === 'SSH_AUTH_SOCK' ||
      upper === 'SSH_AGENT_PID' ||
      upper.startsWith('GIT_CONFIG_') ||
      [
        'GIT_ASKPASS',
        'SSH_ASKPASS',
        'SSH_ASKPASS_REQUIRE',
        'SUDO_ASKPASS',
        'GIT_TERMINAL_PROMPT',
        'GIT_SSH',
        'GIT_SSH_COMMAND',
        'GIT_SSH_VARIANT',
      ].includes(upper) ||
      (!options.museCode &&
        (/^(?:BASH_ENV|ENV|BASH_FUNC_.*|NODE_OPTIONS|NODE_PATH|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_.*|ELECTRON_.*)$/u.test(
          upper,
        ) ||
          isCredentialVariable(name) ||
          routes.includes(upper)))
    )
      continue
    env[name] = value
  }
  // An empty helper resets the configured chain, including credential managers.
  env['GIT_CONFIG_COUNT'] = '2'
  env['GIT_CONFIG_KEY_0'] = 'credential.helper'
  env['GIT_CONFIG_VALUE_0'] = ''
  env['GIT_CONFIG_KEY_1'] = 'credential.useHttpPath'
  env['GIT_CONFIG_VALUE_1'] = 'true'
  env['GIT_TERMINAL_PROMPT'] = '0'
  // Empty paths fail closed until W binds the installed refusing helper.
  for (const name of ['GIT_ASKPASS', 'SSH_ASKPASS', 'SUDO_ASKPASS'])
    env[name] = options.refusingHelper ?? ''
  if (options.sshSocket !== undefined) env['SSH_AUTH_SOCK'] = options.sshSocket
  if (options.sshCommand !== undefined) env['GIT_SSH_COMMAND'] = options.sshCommand
  return env
}
