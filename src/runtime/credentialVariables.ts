// Credential variables and the processes the agent starts (AGENTS.md rule 8,
// PLAN.md D1, D61). The agent never reads the Model API key from its
// environment. What a user sets there for Muse Code itself (`META_API_KEY`,
// which the CLI prefers over its sign-in, as Meta documents) reaches Muse
// Code as it does from the extension, whose `muse serve` inherits the user's
// environment (D1's amendment), and counts as its credential. Nothing else
// the agent starts (a shell command, a hook, git, the Windows job helpers)
// sees it or any other credential variable: at start the agent takes them
// out of its own environment and hands them back only to Muse Code's
// processes (`muse serve`, its account hosts, `muse login`), the way the
// extension adds `museSpark.environmentVariables` to them.

import { isCredentialVariable } from '../host/backend/toolIo'
import type { EnvironmentVariable } from '../shared/constants'

/** The credential variables in `env`, by name and value. */
function credentialsIn(env: NodeJS.ProcessEnv): EnvironmentVariable[] {
  return Object.entries(env).flatMap(([name, value]) =>
    value !== undefined && isCredentialVariable(name) ? [{ name, value }] : [],
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

/** `env` without any credential variable: what a tool process gets. */
export function withoutCredentials(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copy = { ...env }
  takeCredentials(copy)
  return copy
}
