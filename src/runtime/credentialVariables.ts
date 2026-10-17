// Credential variables and the processes the agent starts (AGENTS.md rule 8,
// PLAN.md D1, D61). The agent never reads the Model API key from its
// environment. The standalone runtime strips credentials at start and never
// restores them to Muse Code or its descendants (FIXM95X). Muse Code signs
// in through its own credential store; provider keys are read at use time.

import { isCredentialVariable, withoutCredentials } from '../core/credentialEnvironment'
import { vaultFenceEnvironment } from '../core/vault/exec/fence'
export { withoutCredentials } from '../core/credentialEnvironment'
import {
  EXEC_CHILD_ENV_DROP,
  MCP_STDIO_ENV_ALLOWLIST,
  PROXY_VARIABLE_SPELLINGS,
  NO_PROXY_SPELLINGS,
  type EnvironmentVariable,
} from '../shared/constants'

const MUSE_CODE_ENV_ALLOWLIST: ReadonlySet<string> = new Set(
  [
    ...MCP_STDIO_ENV_ALLOWLIST,
    ...PROXY_VARIABLE_SPELLINGS,
    ...NO_PROXY_SPELLINGS,
    'ALL_PROXY',
    'XDG_CONFIG_HOME',
    'XDG_DATA_HOME',
    'XDG_CACHE_HOME',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'LC_CTYPE',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
  ].map((name) => name.toUpperCase()),
)

/** Muse Code gets only named process/configuration routes, never credentials. */
export function museCodeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(withoutCredentials(env)).filter(([name]) =>
      MUSE_CODE_ENV_ALLOWLIST.has(name.toUpperCase()),
    ),
  )
}

/**
 * Provider credential variables no `*_API_KEY` rule catches (M95, PLAN.md
 * D74 headless; research §3.3 names all four as not stripped today). Lane S
 * owns the names in `constants.ts` at integration; this set is lane X's
 * seam so the agent strips them meanwhile.
 */
export const PROVIDER_CREDENTIAL_ENV_NAMES: ReadonlySet<string> = new Set([
  'AWS_BEARER_TOKEN_BEDROCK',
  'ANTHROPIC_AUTH_TOKEN',
  'HF_TOKEN',
  'GOOGLE_APPLICATION_CREDENTIALS',
])

/** A provider credential variable by its exact name (compared uppercased). */
export function isProviderCredentialVariable(name: string): boolean {
  return PROVIDER_CREDENTIAL_ENV_NAMES.has(name.toUpperCase())
}

/** The credential variables in `env`, by name and value. */
function credentialsIn(env: NodeJS.ProcessEnv): EnvironmentVariable[] {
  return Object.entries(env).flatMap(([name, value]) =>
    value !== undefined && (isCredentialVariable(name) || isProviderCredentialVariable(name))
      ? [{ name, value }]
      : [],
  )
}

/** Takes every credential variable out of `env` (the agent's own, at start) and returns them. */
export function takeCredentials(env: NodeJS.ProcessEnv): readonly EnvironmentVariable[] {
  const taken = credentialsIn(env)
  for (const { name } of taken) {
    Reflect.deleteProperty(env, name)
  }
  return taken
}

/** Headless tools cannot inherit credential-store sockets or CI token routes. */
export function withoutKeyringRoutes(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copy = { ...env }
  const names: readonly string[] = EXEC_CHILD_ENV_DROP
  for (const name of Object.keys(copy)) {
    if (names.includes(name.toUpperCase())) Reflect.deleteProperty(copy, name)
  }
  return vaultFenceEnvironment(copy)
}
