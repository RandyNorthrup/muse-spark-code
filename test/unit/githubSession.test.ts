import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as vscode from 'vscode'
import { githubTokenReader } from '../../src/host/git/githubSession'
import { FAKE_GITHUB_TOKEN } from './helpers/fakeGitHub'
import { FakeLogOutputChannel } from './helpers/fakes'

const auth = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('vscode', async (importOriginal) => ({
  ...(await importOriginal<typeof vscode>()),
  authentication: auth,
}))

beforeEach(() => {
  auth.getSession.mockReset()
})

class AccountNamedError extends Error {
  public override readonly name = 'private@example.invalid'
}

describe('GitHub authentication token reader (M71)', () => {
  it('asks only when the user acts and returns only the token', async () => {
    const log = new FakeLogOutputChannel()
    auth.getSession.mockResolvedValue({
      accessToken: FAKE_GITHUB_TOKEN,
      account: { label: 'private@example.invalid' },
    })
    const read = githubTokenReader(log)
    await expect(read('silent')).resolves.toBe(FAKE_GITHUB_TOKEN)
    await expect(read('ask')).resolves.toBe(FAKE_GITHUB_TOKEN)
    expect(auth.getSession.mock.calls).toEqual([
      ['github', ['repo'], { silent: true }],
      ['github', ['repo'], { createIfNone: true }],
    ])
    expect(log.info).not.toHaveBeenCalled()
  })

  it('logs fixed words when provider errors name an account or token', async () => {
    const log = new FakeLogOutputChannel()
    const error = new AccountNamedError(`declined ${FAKE_GITHUB_TOKEN}`)
    auth.getSession.mockRejectedValue(error)
    await expect(githubTokenReader(log)('ask')).resolves.toBeUndefined()
    expect(log.info.mock.calls).toEqual([['GitHub sign-in not given']])
  })
})
