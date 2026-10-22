import { describe, expect, it } from 'vitest'
import { recordCalls } from './helpers/recordCalls'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import type { NodeMethodPort } from '../../src/shared/hostApi/nodeMethods'
import { createNodePasskeyAuth, nodeAuthMethods } from '../../src/runtime/node/auth/entry'
import { NodeListenerError } from '../../src/runtime/node/listenerGuard'
import {
  dispatchNodeMethod,
  nodeActionDigest,
  type NodeListenerMethodFactory,
} from '../../src/runtime/node/listenerMethods'
import {
  authFixture,
  enrolledFixture,
  assertionProof,
  registrationProof,
} from './helpers/node/authService'

function downstream(): NodeMethodPort {
  return { request: () => Promise.reject(new Error('unbound')) }
}

describe('A1 listener bindings', () => {
  it('constructs auth failures in the caller realm and preserves delegated errors', async () => {
    const f = authFixture()
    const foreignCalls = recordCalls<[string]>()
    const foreign = (code: string): Error => {
      foreignCalls.fn(code)
      return new Error('caller transport failure')
    }
    const next: NodeMethodPort = { request: () => Promise.reject(new Error('downstream failure')) }
    const port = nodeAuthMethods(f.auth, '127.0.0.1', null, next, foreign)
    const signal = new AbortController().signal
    await expect(port.request('node/auth/begin', { purpose: 'signin' }, signal)).rejects.toThrow(
      'caller transport failure',
    )
    expect(foreignCalls.calls).toContainEqual(['unauthenticated'])
    await expect(port.request('node/stop', {}, signal)).rejects.toThrow('downstream failure')
    expect(foreignCalls.calls).toHaveLength(1)
    const cancelled = AbortSignal.abort()
    await expect(
      port.request('node/auth/begin', { purpose: 'signin' }, cancelled),
    ).rejects.toThrow()
    expect(foreignCalls.calls).toHaveLength(1)
  })
  it('H09 dispatches the actual source into the auth factory', async () => {
    const f = authFixture()
    const methodCalls = recordCalls<Parameters<NodeListenerMethodFactory>>()
    const methods: NodeListenerMethodFactory = (...args) => {
      methodCalls.fn(...args)
      return downstream()
    }
    await expect(
      dispatchNodeMethod(
        'node/stop',
        {},
        null,
        {
          source: 'fd42::25',
          methods,
          verifier: f.auth.sessions,
          now: f.clock.now,
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow()
    // A privileged route cannot test source propagation without a verified session.
    const session = f.auth.sessions.create()
    await expect(
      dispatchNodeMethod(
        'node/stop',
        {},
        session.session,
        {
          source: 'fd42::25',
          methods,
          verifier: f.auth.sessions,
          now: f.clock.now,
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('unbound')
    expect(methodCalls.calls).toContainEqual([session.session, 'fd42::25'])
    f.auth.endAll()
  })
  it('installs the caller language and parses enrollment and signout through the catalog', async () => {
    const f = authFixture()
    const translated = { ...EN, nodeLabels: { ...EN.nodeLabels, setupCode: 'Code local' } }
    const auth = createNodePasskeyAuth(f.options, translated, 'fr')
    try {
      await auth.consoleSetup()
      const printed = f.console.calls.findLast(([line]) => line.startsWith('Code local: '))?.[0]
      const code = printed?.slice('Code local: '.length) ?? ''
      const publicPort = nodeAuthMethods(
        auth,
        '127.0.0.1',
        null,
        downstream(),
        (code) => new NodeListenerError(code),
      )
      const signal = new AbortController().signal
      await expect(
        publicPort.request('node/auth/begin', { purpose: 'signin' }, signal),
      ).rejects.toMatchObject({ code: 'unauthenticated' })
      f.advance(30_000)
      const challenge = await publicPort.request(
        'node/auth/begin',
        { purpose: 'enroll', setupCode: code },
        signal,
      )
      const result = await publicPort.request(
        'node/auth/enroll',
        { challengeId: challenge.id, credential: registrationProof },
        signal,
      )
      const bound = nodeAuthMethods(
        auth,
        '127.0.0.1',
        result.session,
        downstream(),
        (code) => new NodeListenerError(code),
      )
      expect(await bound.request('node/auth/end', {}, signal)).toEqual({ done: true })
      await expect(auth.sessions.verifyBearer(result.bearer, signal)).rejects.toThrow()
      await expect(
        publicPort.request(
          'node/auth/stepUp/begin',
          { action: 'maker.action', actionDigest: 'a'.repeat(64) },
          signal,
        ),
      ).rejects.toThrow()
    } finally {
      auth.endAll()
      setUiText(EN, 'en')
    }
  })

  it('dispatches Stop without UV and dispatches exactly one payload-bound maker action', async () => {
    const f = await enrolledFixture()
    const sink = recordCalls<[string]>()
    const next: NodeMethodPort = {
      request: (method) => {
        sink.fn(method)
        return Promise.reject(new Error('sink-dispatched'))
      },
    }
    const binding = {
      source: '127.0.0.1',
      methods: () =>
        nodeAuthMethods(
          f.auth,
          '127.0.0.1',
          f.session.session,
          next,
          (code) => new NodeListenerError(code),
        ),
      verifier: f.auth.sessions,
      now: f.clock.now,
    }
    const signal = new AbortController().signal
    await expect(
      dispatchNodeMethod('node/stop', {}, f.session.session, binding, signal),
    ).rejects.toThrow('sink-dispatched')
    expect(f.verifier.assert.calls).toHaveLength(0)
    const params = {
      deviceId: 'printer',
      operation: 'start',
      payload: 'temperature=180',
      stepUpId: 'pending',
      actionDigest: 'a'.repeat(64),
    }
    const digest = nodeActionDigest('node/maker/action', params)
    const port = f.auth.forSource('127.0.0.1', f.session.session.id)
    const challenge = await port.beginStepUp(f.session.session.id, 'maker.action', digest)
    const proof = await port.stepUp(challenge.id, assertionProof)
    const exact = { ...params, stepUpId: proof.id, actionDigest: digest }
    await expect(
      dispatchNodeMethod(
        'node/maker/action',
        { ...exact, payload: 'temperature=250' },
        f.session.session,
        binding,
        signal,
      ),
    ).rejects.toThrow()
    expect(sink.calls).toHaveLength(1)
    await expect(
      dispatchNodeMethod('node/maker/action', exact, f.session.session, binding, signal),
    ).rejects.toThrow('sink-dispatched')
    await expect(
      dispatchNodeMethod('node/maker/action', exact, f.session.session, binding, signal),
    ).rejects.toThrow()
    expect(sink.calls.map(([method]) => method)).toEqual(['node/stop', 'node/maker/action'])
    f.auth.endAll()
  })
})
