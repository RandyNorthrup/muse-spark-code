// D104's named exception in the standalone runtime (M123): the confirmed
// push and the pull request fetch run with the user's own Git environment,
// as a terminal would. The runtime takes every credential variable out of
// its own environment at start (FIXM95X), before any child starts, so the
// Git routes among them are kept here, captured at that moment, for those
// two commands only (`RuntimeGitDeps.userEnvironment`). No other child,
// tool, hook of another command or model process gets them back.
//
// A model or provider key (`*_API_KEY` and the named provider variables)
// is never a Git route, so it is not kept: Git's helpers read token
// variables such as `GH_TOKEN` and `GITHUB_TOKEN`, askpass programs and the
// SSH agent's socket, none of which is a model key.

import type { EnvironmentVariable } from '../shared/constants'
import { isProviderCredentialVariable } from './credentialVariables'

const API_KEY_SUFFIX = /_API_KEY$/i

/** What the runtime's entry kept at start: this process's only copy for Git. */
const kept: { routes: readonly EnvironmentVariable[] } = { routes: [] }

/** Whether a removed credential variable may serve the user's Git helpers. */
function isGitCredentialRoute(name: string): boolean {
  return !API_KEY_SUFFIX.test(name) && !isProviderCredentialVariable(name)
}

/** Keeps the Git routes among the credentials taken at start; called once, by the runtime's entry. */
export function keepGitCredentialRoutes(taken: readonly EnvironmentVariable[]): void {
  kept.routes = taken.filter(({ name }) => isGitCredentialRoute(name))
}

/**
 * The user's Git environment for the confirmed push and the pull request
 * fetch: the runtime's current environment with the Git routes it took at
 * start put back. Never for any other process.
 */
export function runtimeGitUserEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, ...Object.fromEntries(kept.routes.map(({ name, value }) => [name, value])) }
}
