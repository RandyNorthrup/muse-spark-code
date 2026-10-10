// M123 lane 0 (PLAN.md D104): the GitHub token-source contract. The order
// of the sources, the lease's time limit and its MHP result, the scopes,
// the OAuth client id that refuses until Q-M123 is answered, and the
// setting that only the user can turn on.

import { describe, expect, it } from 'vitest'
import {
  GITHUB_LEASE_TTL_MS,
  GITHUB_OAUTH_CLIENT_ID,
  GITHUB_TOKEN_SOURCE_ORDER,
} from '../../src/shared/constants'
import {
  assertPermittedScopes,
  githubLeaseResultSchema,
  GitHubTokenSourceError,
  isGhLoginEnabled,
  leaseExpiresAt,
  missingScopes,
  orderedSources,
  requireOAuthClientId,
  resolveGitHubCredential,
} from '../../src/core/git/tokenSource'
import { fakeTokenSource } from './helpers/github/fakes'

const LEASE_ID = '5f0c6a8e-3b2d-4c1f-9a7e-2d4b6c8e0f11'
const NOW = 1_000_000

function request(mode: 'ask' | 'silent', extra: { askWith?: 'deviceFlow' | 'ghLogin' } = {}) {
  return { mode, signal: new AbortController().signal, now: () => NOW, ...extra }
}

function refusal(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error: unknown) {
    return error instanceof GitHubTokenSourceError ? error.reason : 'other'
  }
  return undefined
}

describe('the token sources (D104)', () => {
  it('are tried in the decision’s order: the editor’s lease, the device flow, gh', () => {
    expect(GITHUB_TOKEN_SOURCE_ORDER).toEqual(['editorLease', 'deviceFlow', 'ghLogin'])
    const sources = [
      fakeTokenSource('ghLogin', { bearer: 'c', isSignedIn: true }),
      fakeTokenSource('editorLease', { bearer: 'a', isSignedIn: true }),
      fakeTokenSource('deviceFlow', { bearer: 'b', isSignedIn: true }),
    ]
    expect(orderedSources(sources).map((source) => source.kind)).toEqual(GITHUB_TOKEN_SOURCE_ORDER)
  })

  it('refuses a source kind given twice', () => {
    const twice = [
      fakeTokenSource('deviceFlow', { bearer: 'b', isSignedIn: true }),
      fakeTokenSource('deviceFlow', { bearer: 'b2', isSignedIn: true }),
    ]
    expect(refusal(() => orderedSources(twice))).toBe('sourceOrder')
  })

  it('gives the first source that already has a credential, asking nobody', async () => {
    const lease = fakeTokenSource('editorLease', { bearer: LEASE_ID, isSignedIn: false })
    const device = fakeTokenSource('deviceFlow', { bearer: 'device', isSignedIn: true })
    const gh = fakeTokenSource('ghLogin', { bearer: 'gh', isSignedIn: true })
    const credential = await resolveGitHubCredential([gh, device, lease], request('ask'))
    expect(credential?.source).toBe('deviceFlow')
    expect([...lease.asked, ...device.asked]).toEqual(['silent', 'silent'])
    expect(gh.asked).toEqual([])
  })

  it('asks only one source, the first or the user’s pick, when none has a credential', async () => {
    const first = [
      fakeTokenSource('editorLease', { bearer: LEASE_ID, isSignedIn: false }),
      fakeTokenSource('deviceFlow', { bearer: 'device', isSignedIn: false }),
    ]
    const asked = await resolveGitHubCredential(first, request('ask'))
    expect(asked?.source).toBe('editorLease')
    expect(first[1]?.asked).toEqual(['silent'])

    const picked = [
      fakeTokenSource('editorLease', { bearer: LEASE_ID, isSignedIn: false }),
      fakeTokenSource('deviceFlow', { bearer: 'device', isSignedIn: false }),
    ]
    const credential = await resolveGitHubCredential(
      picked,
      request('ask', { askWith: 'deviceFlow' }),
    )
    expect(credential?.source).toBe('deviceFlow')
    expect(picked[0]?.asked).toEqual(['silent'])
  })

  it('never asks on a silent call', async () => {
    const lease = fakeTokenSource('editorLease', { bearer: LEASE_ID, isSignedIn: false })
    expect(await resolveGitHubCredential([lease], request('silent'))).toBeUndefined()
    expect(lease.asked).toEqual(['silent'])
  })

  it('passes over an expired credential to the next source (the lease-expiry guard)', async () => {
    const lease = fakeTokenSource('editorLease', {
      bearer: LEASE_ID,
      isSignedIn: true,
      expiresAt: NOW,
    })
    const device = fakeTokenSource('deviceFlow', { bearer: 'device', isSignedIn: true })
    const next = await resolveGitHubCredential([lease, device], request('silent'))
    expect(next?.source).toBe('deviceFlow')
    const live = fakeTokenSource('editorLease', {
      bearer: LEASE_ID,
      isSignedIn: true,
      expiresAt: NOW + 1,
    })
    const current = await resolveGitHubCredential([live, device], request('silent'))
    expect(current?.source).toBe('editorLease')
  })

  it('stops before the next source once the caller aborts', async () => {
    const controller = new AbortController()
    controller.abort()
    const lease = fakeTokenSource('editorLease', { bearer: LEASE_ID, isSignedIn: true })
    await expect(
      resolveGitHubCredential([lease], { ...request('ask'), signal: controller.signal }),
    ).rejects.toThrow()
    expect(lease.asked).toEqual([])
  })
})

describe('the editor’s lease (MHP auth/githubLease, additive expiresAt)', () => {
  it('round-trips with and without expiresAt, and with no lease', () => {
    for (const result of [
      { leaseId: LEASE_ID },
      { leaseId: LEASE_ID, expiresAt: NOW },
      { leaseId: null },
    ]) {
      const wire = JSON.stringify(result)
      expect(githubLeaseResultSchema.parse(JSON.parse(wire))).toEqual(result)
    }
  })

  it('rejects a lease that is not a UUID, a bad time, and any extra field such as a token', () => {
    for (const bad of [
      { leaseId: 'gho_notalease' },
      { leaseId: LEASE_ID, expiresAt: 0 },
      { leaseId: LEASE_ID, expiresAt: 1.5 },
      { leaseId: LEASE_ID, expiresAt: '2026-10-08T12:00:00Z' },
      { leaseId: LEASE_ID, token: 'canary' },
      { leaseId: LEASE_ID, accessToken: 'canary' },
      {},
    ]) {
      expect(githubLeaseResultSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it('lives at most GITHUB_LEASE_TTL_MS (15 minutes), whatever the editor says', () => {
    expect(GITHUB_LEASE_TTL_MS).toBeLessThanOrEqual(15 * 60_000)
    expect(leaseExpiresAt(NOW, undefined)).toBe(NOW + GITHUB_LEASE_TTL_MS)
    expect(leaseExpiresAt(NOW, NOW + GITHUB_LEASE_TTL_MS * 4)).toBe(NOW + GITHUB_LEASE_TTL_MS)
    expect(leaseExpiresAt(NOW, NOW + 1000)).toBe(NOW + 1000)
  })
})

describe('scopes', () => {
  it('asks for repo, and read:org only, never anything else', () => {
    expect(
      refusal(() => {
        assertPermittedScopes(['repo', 'read:org'])
      }),
    ).toBeUndefined()
    for (const scope of ['workflow', 'admin:org', 'delete_repo', 'gist', 'user', '']) {
      expect(
        refusal(() => {
          assertPermittedScopes(['repo', scope])
        }),
        scope,
      ).toBe('scopeRefused')
    }
  })

  it('names a missing repo scope from X-OAuth-Scopes, and guesses nothing without it', () => {
    expect(missingScopes('repo, read:org', ['repo'])).toEqual([])
    expect(missingScopes('read:org,gist', ['repo'])).toEqual(['repo'])
    expect(missingScopes('', ['repo'])).toEqual(['repo'])
    expect(missingScopes('public_repo', ['repo'])).toEqual(['repo'])
    expect(missingScopes(null, ['repo'])).toBeUndefined()
  })
})

describe('the OAuth App (Q-M123)', () => {
  it('refuses the device flow while the client id is unset', () => {
    // The owner registers the app (PLAN.md Q-M123); until then this is empty.
    expect(GITHUB_OAUTH_CLIENT_ID).toBe('')
    expect(refusal(() => requireOAuthClientId())).toBe('clientIdUnset')
    expect(refusal(() => requireOAuthClientId(' '.repeat(3)))).toBe('clientIdUnset')
    expect(requireOAuthClientId('Iv1.fakeclientid0000')).toBe('Iv1.fakeclientid0000')
  })
})

// The setting itself is not contributed until M123 is complete
// (m123Unreleased.test.ts); its reading rule is fixed now.
describe('museSpark.github.useGhLogin', () => {
  it('counts only the user’s own true (the workspace-scope refusal)', () => {
    expect(isGhLoginEnabled(undefined)).toBe(false)
    expect(isGhLoginEnabled({ globalValue: true })).toBe(true)
    expect(isGhLoginEnabled({ globalValue: 'true' })).toBe(false)
    expect(isGhLoginEnabled({ workspaceValue: true })).toBe(false)
    expect(isGhLoginEnabled({ workspaceFolderValue: true })).toBe(false)
    expect(isGhLoginEnabled({ globalValue: false, workspaceValue: true })).toBe(false)
  })
})
