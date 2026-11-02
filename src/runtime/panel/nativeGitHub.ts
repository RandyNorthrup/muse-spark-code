// The editor's GitHub lease for the native panel (M123 source (a),
// ported from lane A's panel assembly): leases are opaque UUIDs bound
// to this connection and owner, never an OAuth token. GitHub reads go
// out through the host's `github/request` proxy.
import { GitHubClient } from '../../core/git/github'
import type { Logger } from '../../host/logger'
import { GITHUB_API_BASE_URL } from '../../shared/constants'
import { jsonValueSchema } from '../../shared/hostApi/data'
import { MHP_METHODS, type HostServices } from '../../shared/hostApi/methods'

export function createNativeGitHub(deps: {
  readonly host: HostServices
  readonly workspaceUri: string
  readonly ownerId: string
  readonly userAgent: string
  readonly signal: AbortSignal
  readonly log: Logger
}) {
  const leases = new Set<string>()
  const check = () => {
    deps.signal.throwIfAborted()
  }
  const proxyFetch: (input: URL | RequestInfo, init?: RequestInit) => Promise<Response> = async (
    input,
    init,
  ) => {
    check()
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.origin !== GITHUB_API_BASE_URL) throw new Error('MHP_GITHUB_ENDPOINT_REFUSED')
    const authorization = request.headers.get('Authorization')
    const lease =
      authorization?.startsWith('Bearer ') === true
        ? authorization.slice('Bearer '.length)
        : undefined
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
  }
  const github = new GitHubClient({
    userAgent: deps.userAgent,
    log: deps.log,
    fetch: proxyFetch,
  })
  return {
    github,
    proxyFetch,
    githubToken: async (mode: 'ask' | 'silent'): Promise<string | undefined> => {
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
