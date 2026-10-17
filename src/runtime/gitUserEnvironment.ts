// D104's named exception in the standalone runtime (M123): the confirmed
// push and the pull request fetch run with the user's own Git environment,
// as a terminal would. The runtime takes every credential variable out of
// its own environment at start (FIXM95X), before any child starts, so the
// Git routes among them are kept here, captured at that moment, for those
// two commands only (`RuntimeGitDeps.userEnvironment`). No other child,
// tool, hook of another command or model process gets them back.
//
// The routes are an allow-list (RVM123G2 R3): GIT_PUSH_CREDENTIAL_VARIABLES,
// the GitHub token variables `gh`'s credential helper reads. Every other
// credential taken at start (a model or provider key under any name) stays
// out; the Git runner applies the same list again to the child.

import { GIT_PUSH_CREDENTIAL_VARIABLES, type EnvironmentVariable } from '../shared/constants'

const GIT_ROUTES: ReadonlySet<string> = new Set(GIT_PUSH_CREDENTIAL_VARIABLES)

/** What the runtime's entry kept at start: this process's only copy for Git. */
const kept: { routes: readonly EnvironmentVariable[] } = { routes: [] }

/** Whether a removed credential variable is one of the Git routes, by name (any case on Windows). */
function isGitCredentialRoute(name: string): boolean {
  return GIT_ROUTES.has(process.platform === 'win32' ? name.toUpperCase() : name)
}

/** Keeps the Git routes among the credentials taken at start; called once, by the runtime's entry. */
export function keepGitCredentialRoutes(taken: readonly EnvironmentVariable[]): void {
  kept.routes = taken.filter(({ name }) => isGitCredentialRoute(name))
}

/**
 * The user's Git environment for the confirmed push and the pull request
 * fetch: the runtime's current environment with the Git routes it took at
 * start put back. Never for any other process.
 * @unwired M71 confirmed-push and PR-fetch environment
 */
export function runtimeGitUserEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, ...Object.fromEntries(kept.routes.map(({ name, value }) => [name, value])) }
}
