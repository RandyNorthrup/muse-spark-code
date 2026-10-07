import type { RuntimeAuthDeps } from '../features/auth'
import { GitHubClient } from '../../core/git/github'
import type { HostServices } from '../../shared/hostApi/methods'
import { MHP_METHODS } from '../../shared/hostApi/methods'
import { jsonValueSchema } from '../../shared/hostApi/data'
import { GITHUB_API_BASE_URL } from '../../shared/constants'
import type { CoreLogger } from '../../core/logging'

/** Leases are opaque UUIDs bound to this native parent and owner, never an OAuth token. */
export function createNativeGitHub(deps: {
  readonly host: HostServices
  readonly workspaceUri: string
  readonly ownerId: string
  readonly userAgent: string
  readonly assertCurrent: () => void
  readonly signal: AbortSignal
  readonly log: CoreLogger
}) {
  const leases = new Set<string>()
  const check = () => {
    deps.signal.throwIfAborted()
    deps.assertCurrent()
  }
  const github = new GitHubClient({
    userAgent: deps.userAgent,
    log: deps.log,
    fetch: async (input, init) => {
      check()
      const request = new Request(input, init)
      const url = new URL(request.url)
      if (url.origin !== GITHUB_API_BASE_URL) throw new Error('MHP_GITHUB_ENDPOINT_REFUSED')
      const lease = request.headers.get('Authorization')?.replace(/^Bearer /u, '')
      if (lease === undefined || !leases.has(lease)) throw new Error('MHP_GITHUB_LEASE_REFUSED')
      const text = await request.text()
      check()
      const params = MHP_METHODS['github/request'].params.parse({
        leaseId: lease,
        ownerId: deps.ownerId,
        url: request.url,
        method: request.method,
        ...(text !== '' && { body: jsonValueSchema.parse(JSON.parse(text)) }),
      })
      const signal =
        init?.signal === undefined || init.signal === null
          ? deps.signal
          : AbortSignal.any([deps.signal, init.signal])
      const response = MHP_METHODS['github/request'].result.parse(
        await deps.host.request('github/request', params, signal),
      )
      check()
      return new Response(response.body, {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  })
  return {
    github,
    githubToken: async (mode: 'ask' | 'silent') => {
      check()
      const result = MHP_METHODS['auth/githubLease'].result.parse(
        await deps.host.request(
          'auth/githubLease',
          {
            workspaceUri: deps.workspaceUri,
            ownerId: deps.ownerId,
            mode,
          },
          deps.signal,
        ),
      )
      check()
      if (result.leaseId === null) return
      leases.add(result.leaseId)
      return result.leaseId
    },
  }
}

/** The native parent launches its installed auth set terminal; this adapter sees only completion. */
export function createNativeKeySignIn(deps: {
  readonly host: HostServices
  readonly workspaceUri: string
  readonly ownerId: string
  readonly signal: AbortSignal
  readonly assertCurrent: () => void
}): RuntimeAuthDeps['runKeySignIn'] {
  return async (requestSignal, beforeRun) => {
    const signal = AbortSignal.any([requestSignal, deps.signal])
    signal.throwIfAborted()
    deps.assertCurrent()
    beforeRun()
    signal.throwIfAborted()
    const result = MHP_METHODS['auth/keySignIn'].result.parse(
      await deps.host.request(
        'auth/keySignIn',
        { workspaceUri: deps.workspaceUri, ownerId: deps.ownerId },
        signal,
      ),
    )
    signal.throwIfAborted()
    deps.assertCurrent()
    return result.completed
  }
}
