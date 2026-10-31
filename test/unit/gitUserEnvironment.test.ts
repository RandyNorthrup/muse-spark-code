// D104's named exception in the standalone runtime (M123): the agent's entry
// takes credential variables out of its own environment at start and keeps
// the Git routes among them; the confirmed push and the pull request fetch
// get those routes back, and no other credential.
import { describe, expect, it } from 'vitest'
import {
  keepGitCredentialRoutes,
  runtimeGitUserEnvironment,
} from '../../src/runtime/gitUserEnvironment'

describe('the runtime Git environment', () => {
  it('returns the environment unchanged before the entry keeps any route', () => {
    expect(runtimeGitUserEnvironment({ PATH: '/bin', GH_TOKEN: 'stale' })).toEqual({
      PATH: '/bin',
      GH_TOKEN: 'stale',
    })
  })

  it('puts back only the Git routes the entry kept, dropping every other credential', () => {
    keepGitCredentialRoutes([
      { name: 'GH_TOKEN', value: 'route-one' },
      { name: 'SOME_API_KEY', value: 'never-back' },
      { name: 'GITHUB_TOKEN', value: 'route-two' },
    ])
    expect(runtimeGitUserEnvironment({ PATH: '/bin' })).toEqual({
      PATH: '/bin',
      GH_TOKEN: 'route-one',
      GITHUB_TOKEN: 'route-two',
    })
    // A later keep replaces the earlier one: nothing lingers.
    keepGitCredentialRoutes([])
    expect(runtimeGitUserEnvironment({ PATH: '/bin' })).toEqual({ PATH: '/bin' })
  })
})
