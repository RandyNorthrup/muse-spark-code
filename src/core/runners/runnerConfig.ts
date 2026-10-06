import path from 'node:path'
import {
  EXEC_CHILD_ENV_DROP,
  HOOK_CONFIG_MAX_BYTES,
  HOOK_FORBIDDEN_ENV_NAMES,
  UI_TEXT,
} from '../../shared/constants'
import { runnersSchema, type Runner } from '../../shared/team'

const forbidden: ReadonlySet<string> = new Set([
  ...HOOK_FORBIDDEN_ENV_NAMES,
  ...EXEC_CHILD_ENV_DROP,
])

/** No repository path is accepted: the caller supplies the user's config home. */
export async function readRunnerConfig(
  configHome: string,
  read: (file: string, maxBytes: number) => Promise<string | undefined>,
): Promise<Runner[]> {
  const text = await read(
    path.join(configHome, 'muse-spark-code', 'runners.json'),
    HOOK_CONFIG_MAX_BYTES,
  )
  if (text === undefined) return []
  if (Buffer.byteLength(text) > HOOK_CONFIG_MAX_BYTES)
    throw new Error(UI_TEXT.teamRunners.testFailed)
  const value: unknown = JSON.parse(text)
  return runnersSchema.parse(value)
}

/** Local tools get no credentials; only the host's SSH transport may keep its agent. */
export function runnerEnvironment(
  env: NodeJS.ProcessEnv,
  names?: readonly string[],
  isTransport = false,
): NodeJS.ProcessEnv {
  const allowed = names === undefined ? undefined : new Set(names)
  return Object.fromEntries(
    Object.entries(env).filter(([name, value]) => {
      const upper = name.toUpperCase()
      return (
        value !== undefined &&
        !upper.endsWith('_API_KEY') &&
        (!forbidden.has(upper) || (isTransport && upper === 'SSH_AUTH_SOCK')) &&
        !upper.startsWith('GIT_') &&
        !upper.startsWith('SSH_ASKPASS') &&
        (allowed === undefined || allowed.has(name))
      )
    }),
  )
}
