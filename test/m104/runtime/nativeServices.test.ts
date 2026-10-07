import { expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { verifiedPaidQuestion } from '../../../src/shared/portablePaid'
import { createNativeGitHub, createNativeKeySignIn } from '../../../src/runtime/panel/nativeGitHub'
import { MHP_METHODS } from '../../../src/shared/hostApi/methods'
import { CAPTURED_USER } from '../../unit/helpers/githubCapture'
import { fakeServices } from '../ui/services'

it('names the verified provider, complete price and shared budget, refusing unknown or replaced quotes', () => {
  const request = {
    feature: 'bestOfN',
    modelId: 'actual',
    prompt: 'Task',
    attempts: 2,
    requestCeilingPerAttempt: 1,
  } as const
  const state = { current: true }
  const quote = {
    providerId: 'captured-provider',
    providerName: 'Provider',
    modelId: 'actual',
    maximumUsd: 0.25,
    isCurrent: () => state.current,
  }
  const question = verifiedPaidQuestion(request, quote, 1)
  expect(question?.detail).toContain('Provider')
  expect(question?.detail).toContain('$0.25')
  expect(question?.detail).toContain('$1.00')
  expect(verifiedPaidQuestion(request, undefined, 1)).toBeUndefined()
  expect(verifiedPaidQuestion(request, { ...quote, modelId: 'replaced' }, 1)).toBeUndefined()
  expect(verifiedPaidQuestion(request, quote, 0)).toBeUndefined()
  expect(verifiedPaidQuestion(request, { ...quote, maximumUsd: NaN }, 1)).toBeUndefined()
  state.current = false
  expect(question?.isCurrent()).toBe(false)
  expect(verifiedPaidQuestion(request, quote, 1)).toBeUndefined()
})

it('uses only a native owner-bound lease with the existing captured GitHub parser and retires it on release', async () => {
  const f = fakeServices()
  const leaseId = randomUUID()
  const ownerId = randomUUID()
  const ending = new AbortController()
  f.responses.set('auth/githubLease', () => Promise.resolve({ leaseId }))
  f.responses.set('github/request', () =>
    Promise.resolve({ status: 200, body: JSON.stringify(CAPTURED_USER) }),
  )
  const native = createNativeGitHub({
    ...f,
    workspaceUri: 'file:///workspace',
    ownerId,
    userAgent: 'muse-spark-code/test',
    assertCurrent: () => undefined,
    signal: ending.signal,
  })
  const lease = await native.githubToken('ask')
  if (lease === undefined) throw new Error('Missing fake lease')
  await expect(native.github.currentUser(lease)).resolves.toMatchObject({
    login: CAPTURED_USER.login,
    id: CAPTURED_USER.id,
  })
  expect(f.requests.at(-1)).toEqual({
    method: 'github/request',
    params: { leaseId, ownerId, url: 'https://api.github.com/user', method: 'GET' },
  })
  expect(JSON.stringify(f.requests)).not.toContain('Authorization')
  ending.abort()
  await expect(native.githubToken('ask')).rejects.toThrow()
  expect(f.requests).toHaveLength(2)
})

it('rejects unprotected GitHub origins, malformed URLs and impossible response statuses', () => {
  const params = { leaseId: randomUUID(), ownerId: randomUUID(), method: 'GET' }
  for (const url of [
    'invalid',
    'https://evil.test/user',
    'https://user:pass@api.github.com/user',
    'https://api.github.com/user#secret',
  ])
    expect(MHP_METHODS['github/request'].params.safeParse({ ...params, url }).success).toBe(false)
  for (const status of [0, 99, 600])
    expect(MHP_METHODS['github/request'].result.safeParse({ status, body: '{}' }).success).toBe(
      false,
    )
})

it('asks the native trusted key terminal with owner IDs only and suppresses cancelled completion', async () => {
  const f = fakeServices()
  const completion = Promise.withResolvers<unknown>()
  f.responses.set('auth/keySignIn', () => completion.promise)
  const ending = new AbortController()
  const beforeRun = vi.fn()
  const keySignIn = createNativeKeySignIn({
    host: f.host,
    workspaceUri: 'file:///workspace',
    ownerId: randomUUID(),
    signal: ending.signal,
    assertCurrent: () => undefined,
  })
  const result = expect(keySignIn(new AbortController().signal, beforeRun)).rejects.toThrow()
  expect(beforeRun).toHaveBeenCalledOnce()
  expect(f.requests.at(-1)).toMatchObject({
    method: 'auth/keySignIn',
    params: { workspaceUri: 'file:///workspace' },
  })
  ending.abort()
  completion.resolve({ completed: true })
  await result
  const calls = f.requests.length
  await expect(keySignIn(new AbortController().signal, beforeRun)).rejects.toThrow()
  expect(f.requests).toHaveLength(calls)
})
