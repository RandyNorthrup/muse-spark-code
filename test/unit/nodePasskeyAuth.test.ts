import { describe, expect, it } from 'vitest'
import {
  NODE_CHALLENGE_TTL_MS,
  NODE_LISTENER_MAX_SOURCES,
  NODE_SETUP_TTL_MS,
  NODE_SIGNIN_BACKOFF_MAX_MS,
  NODE_SIGNIN_MAX_FAILURES,
  UI_TEXT,
} from '../../src/shared/constants'
import { NodePasskeyAuth } from '../../src/runtime/node/auth/service'
import { nodeStepUpSchema } from '../../src/shared/nodeAuth'
import {
  authFixture,
  enrolledFixture,
  registrationProof,
  assertionProof,
} from './helpers/node/authService'

describe('H04 console enrollment', () => {
  it('does not print a setup code that expired during persistence', async () => {
    const f = authFixture()
    const update = f.store.update
    f.store.update = async (generation, change) => {
      const result = await update(generation, change)
      f.advance(NODE_SETUP_TTL_MS)
      return result
    }
    await expect(f.auth.consoleSetup()).rejects.toThrow('expired')
    expect(f.console.calls).toHaveLength(0)
  })
  it('does not extend the setup window by a slow persistence write', async () => {
    const f = authFixture()
    const update = f.store.update
    f.store.update = async (generation, change) => {
      const result = await update(generation, change)
      f.advance(NODE_SETUP_TTL_MS - 1)
      return result
    }
    await f.auth.consoleSetup()
    const port = f.auth.forSource('127.0.0.1')
    const challenge = await port.begin('enroll', f.code())
    f.advance(1)
    await expect(port.enroll(challenge.id, registrationProof)).rejects.toThrow()
    expect(f.verifier.enroll.calls).toHaveLength(0)
  })
  it('refuses a wrong console code before allocating a challenge', async () => {
    const f = authFixture()
    await f.auth.consoleSetup()
    await expect(f.auth.forSource('127.0.0.1').begin('enroll', 'b'.repeat(43))).rejects.toThrow()
    expect(f.verifier.enroll.calls).toHaveLength(0)
    expect(
      f.console.calls.filter(([line]) => line === UI_TEXT.nodeMessages.unexpectedFailure),
    ).toEqual([])
  })
  it('stores only a code hash, enrolls once and refuses replay', async () => {
    const f = authFixture()
    await f.auth.consoleSetup()
    const code = f.code()
    expect(code).toHaveLength(43)
    expect(JSON.stringify(f.store.read())).not.toContain(code)
    const port = f.auth.forSource('127.0.0.1')
    const challenge = await port.begin('enroll', code)
    const authenticated = await port.enroll(challenge.id, registrationProof)
    expect(f.store.read().setup).toBeNull()
    expect(f.store.read().passkeys).toHaveLength(1)
    expect(JSON.stringify(f.audit)).not.toContain(authenticated.bearer)
    await expect(port.enroll(challenge.id, registrationProof)).rejects.toThrow()
    f.auth.endAll()
  })
  it('allows exactly one completion in an enrollment race', async () => {
    const f = authFixture()
    await f.auth.consoleSetup()
    const port = f.auth.forSource('127.0.0.1')
    const first = await port.begin('enroll', f.code())
    const second = await port.begin('enroll', f.code())
    const settled = await Promise.allSettled([
      port.enroll(first.id, registrationProof),
      port.enroll(second.id, registrationProof),
    ])
    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(f.store.read().passkeys).toHaveLength(1)
    f.auth.endAll()
  })
  it('expires setup and challenges exactly, even with wall rollback', async () => {
    const f = authFixture()
    await f.auth.consoleSetup()
    const port = f.auth.forSource('127.0.0.1')
    const challenge = await port.begin('enroll', f.code())
    f.advance(NODE_CHALLENGE_TTL_MS)
    await expect(port.enroll(challenge.id, registrationProof)).rejects.toThrow()
    f.advance(NODE_SETUP_TTL_MS)
    f.wall(-NODE_SETUP_TTL_MS)
    await expect(port.begin('enroll', f.code())).rejects.toThrow()
    expect(f.verifier.enroll.calls).toHaveLength(0)
  })
  it('rotates the console code and invalidates outstanding enrollments', async () => {
    const f = authFixture()
    await f.auth.consoleSetup()
    const code = f.code()
    const port = f.auth.forSource('127.0.0.1')
    const pending = await port.begin('enroll', code)
    await f.auth.consoleSetup()
    await expect(port.begin('enroll', code)).rejects.toThrow()
    f.advance(NODE_SIGNIN_BACKOFF_MAX_MS)
    await expect(port.enroll(pending.id, registrationProof)).rejects.toThrow()
    expect(f.verifier.enroll.calls).toHaveLength(0)
  })
  it('refuses healthy-owner recovery and a restored setup window after wall rollback', async () => {
    const enrolled = await enrolledFixture()
    await expect(enrolled.auth.consoleSetup()).rejects.toThrow()
    expect(enrolled.store.read().passkeys).toHaveLength(1)
    enrolled.auth.endAll()
    const f = authFixture()
    await f.auth.consoleSetup()
    f.wall(-1)
    const restarted = new NodePasskeyAuth(f.options)
    await expect(restarted.forSource('127.0.0.1').begin('enroll', f.code())).rejects.toThrow()
    restarted.endAll()
  })
  it('H08/H20 refused console recovery preserves sessions, proofs and pending challenges', async () => {
    const f = await enrolledFixture()
    const bound = f.auth.forSource('127.0.0.1', f.session.session.id)
    const step = await bound.beginStepUp(f.session.session.id, 'maker.action', 'a'.repeat(64))
    const proof = await bound.stepUp(step.id, assertionProof)
    const pending = await f.port.begin('signin')
    const signal = f.auth.sessions.sessionSignal(f.session.session.id)
    const before = f.store.read()
    await expect(f.auth.consoleSetup()).rejects.toThrow()
    expect(f.store.read()).toEqual(before)
    expect(signal.aborted).toBe(false)
    expect(f.lifecycle.ended.calls).toHaveLength(0)
    await expect(
      f.auth.sessions.verifyBearer(f.session.bearer, new AbortController().signal),
    ).resolves.toMatchObject({ id: f.session.session.id })
    await expect(
      f.auth.sessions.consumeStepUp(proof, new AbortController().signal),
    ).resolves.toEqual(proof)
    await expect(f.port.signIn(pending.id, assertionProof)).resolves.toHaveProperty('bearer')
    f.auth.endAll()
  })
  it('refuses an enrollment that expires during crypto verification', async () => {
    const f = authFixture()
    await f.auth.consoleSetup()
    const port = f.auth.forSource('127.0.0.1')
    const challenge = await port.begin('enroll', f.code())
    const key = await f.verifier.enroll()
    f.verifier.enroll.once(() => {
      f.advance(NODE_CHALLENGE_TTL_MS)
      return Promise.resolve(key)
    })
    await expect(port.enroll(challenge.id, registrationProof)).rejects.toThrow()
    expect(f.store.read().passkeys).toEqual([])
    expect(f.lifecycle.attached.calls).toHaveLength(0)
  })
  it('mints no session when enrollment audit outlasts the challenge', async () => {
    const f = authFixture()
    await f.auth.consoleSetup()
    const port = f.auth.forSource('127.0.0.1')
    const challenge = await port.begin('enroll', f.code())
    const append = f.store.append
    f.store.append = async (details) => {
      const result = await append(details)
      f.advance(NODE_CHALLENGE_TTL_MS)
      return result
    }
    await expect(port.enroll(challenge.id, registrationProof)).rejects.toThrow()
    expect(f.lifecycle.attached.calls).toHaveLength(0)
    expect(f.audit).not.toContainEqual(expect.objectContaining({ outcome: 'allowed' }))
    expect(f.audit).toContainEqual(
      expect.objectContaining({ action: 'enroll', outcome: 'verified' }),
    )
    expect(f.audit).toContainEqual(expect.objectContaining({ action: 'enroll', outcome: 'denied' }))
    f.auth.endAll()
  })
})

describe('H05/H08/H09/H19/H20 sign-in controls', () => {
  it('H09/H20 the 25-address rotation flood cannot deny owner sign-in or console recovery', async () => {
    const f = await enrolledFixture()
    // Exactly the reviewer's old permitted rate: 50 live rows from 25
    // addresses, then replace each expiring row every six seconds.
    for (let index = 0; index < 100; index++) {
      await f.auth.forSource(`fd42::${String(index % 25)}`).begin('signin')
      if (index < 99) f.advance(6000)
    }
    const challenge = await f.port.begin('signin')
    await expect(f.port.signIn(challenge.id, assertionProof)).resolves.toHaveProperty('bearer')
    expect(f.store.read().passkeys[0]).toMatchObject({ failures: 0, disabled: false })
    const state = f.store.read()
    await f.store.update(state.generation, (value) => ({
      ...value,
      passkeys: value.passkeys.map((key) => ({
        ...key,
        disabled: true,
        failures: NODE_SIGNIN_MAX_FAILURES,
      })),
    }))
    await f.auth.consoleSetup()
    const recovery = f.auth.forSource('console-owner')
    const enroll = await recovery.begin('enroll', f.code())
    await expect(recovery.enroll(enroll.id, registrationProof)).resolves.toHaveProperty('bearer')
    expect(f.store.read().passkeys[0]).toMatchObject({ failures: 0, disabled: false })
    f.auth.endAll()
  })
  it('H09 abandoned and failed issues cannot consume an owner challenge', async () => {
    const f = await enrolledFixture()
    const first = await f.port.begin('signin')
    for (let index = 0; index < NODE_LISTENER_MAX_SOURCES + 1; index++)
      await f.auth.forSource(`rotated-${String(index)}`).begin('signin')
    await expect(f.port.signIn(first.id, assertionProof)).resolves.toHaveProperty('bearer')
    f.auth.endAll()
  })
  it('H05 refuses replay after a successful proof and retains nothing after a failed proof', async () => {
    const f = await enrolledFixture()
    const challenge = await f.port.begin('signin')
    f.verifier.assert.once(() => Promise.reject(new Error('invalid')))
    await expect(f.port.signIn(challenge.id, assertionProof)).rejects.toThrow()
    // Attempt failures convert to unauthenticated before the journal sees them.
    expect(
      f.console.calls.filter(([line]) => line === UI_TEXT.nodeMessages.unexpectedFailure),
    ).toEqual([])
    f.advance(NODE_SIGNIN_BACKOFF_MAX_MS)
    await expect(f.port.signIn(challenge.id, assertionProof)).resolves.toHaveProperty('bearer')
    await expect(f.auth.forSource('replay').signIn(challenge.id, assertionProof)).rejects.toThrow()
    expect(f.verifier.assert.calls).toHaveLength(2)
    f.auth.endAll()
  })
  it('reports a broken audit write to the console without printing its text', async () => {
    const f = await enrolledFixture()
    f.store.append = () => Promise.reject(new Error('test disk failure with private text'))
    const challenge = await f.port.begin('signin')
    await expect(f.port.signIn(challenge.id, assertionProof)).rejects.toThrow('test disk failure')
    expect(f.console.calls.at(-1)).toEqual([UI_TEXT.nodeMessages.unexpectedFailure])
    expect(JSON.stringify(f.console.calls)).not.toContain('private text')
    f.auth.endAll()
  })
  it('refuses another session at begin/end and does not treat an unknown credential as the owner', async () => {
    const f = await enrolledFixture()
    const bound = f.auth.forSource('127.0.0.1', f.session.session.id)
    const other = f.auth.sessions.create()
    expect(() => bound.beginStepUp(other.session.id, 'maker.action', 'a'.repeat(64))).toThrow()
    await expect(bound.end(other.session.id)).rejects.toThrow()
    const challenge = await f.port.begin('signin')
    await expect(
      f.port.signIn(challenge.id, { ...assertionProof, id: 'dW5rbm93bg', rawId: 'dW5rbm93bg' }),
    ).rejects.toThrow()
    expect(f.verifier.assert.calls).toHaveLength(0)
    expect(
      f.console.calls.filter(([line]) => line === UI_TEXT.nodeMessages.unexpectedFailure),
    ).toEqual([])
    f.auth.endAll()
  })
  it('persists counters, keeps sessions transient and binds step-up to its session', async () => {
    const f = await enrolledFixture()
    const bound = f.auth.forSource('127.0.0.1', f.session.session.id)
    const challenge = await bound.beginStepUp(f.session.session.id, 'maker.action', 'a'.repeat(64))
    const proof = await bound.stepUp(challenge.id, assertionProof)
    expect(proof.sessionId).toBe(f.session.session.id)
    expect(f.store.read().passkeys[0]?.counter).toBe(1)
    expect(JSON.stringify(f.store.read())).not.toContain(f.session.bearer)
    expect(JSON.stringify(f.audit)).not.toContain(challenge.challenge)
    f.auth.endAll()
  })
  it('refuses cross-session completion before the verifier and UV-less proofs', async () => {
    const f = await enrolledFixture()
    const bound = f.auth.forSource('127.0.0.1', f.session.session.id)
    const challenge = await bound.beginStepUp(f.session.session.id, 'maker.action', 'a'.repeat(64))
    await expect(f.port.stepUp(challenge.id, assertionProof)).rejects.toThrow()
    expect(f.verifier.assert.calls).toHaveLength(0)
    f.advance(NODE_SIGNIN_BACKOFF_MAX_MS)
    const signin = await f.port.begin('signin')
    f.verifier.assert.once(() => Promise.reject(new Error('UV absent with sensitive bytes')))
    await expect(f.port.signIn(signin.id, assertionProof)).rejects.toThrow('Sign in')
    expect(f.store.read().passkeys[0]?.failures).toBe(2)
    expect(JSON.stringify(f.audit)).not.toContain('sensitive')
    f.auth.endAll()
  })
  it('H09 proof backoff for one source never blocks another source', async () => {
    const f = await enrolledFixture()
    const attacker = f.auth.forSource('attacker')
    const challenge = await attacker.begin('signin')
    f.verifier.assert.once(() => Promise.reject(new Error('invalid')))
    await expect(attacker.signIn(challenge.id, assertionProof)).rejects.toThrow()
    const retry = await attacker.begin('signin')
    await expect(attacker.signIn(retry.id, assertionProof)).rejects.toThrow('Too many')
    const owner = await f.port.begin('signin')
    await expect(f.port.signIn(owner.id, assertionProof)).resolves.toHaveProperty('bearer')
    expect(f.verifier.assert.calls).toHaveLength(2)
    f.advance(NODE_SIGNIN_BACKOFF_MAX_MS)
    await expect(attacker.signIn(retry.id, assertionProof)).resolves.toHaveProperty('bearer')
    f.auth.endAll()
  })
  it('locks at 100, survives restart, and recovers only with a fresh console code', async () => {
    const f = await enrolledFixture()
    f.verifier.assert.use(() => Promise.reject(new Error('invalid')))
    for (let index = 0; index < NODE_SIGNIN_MAX_FAILURES; index++) {
      f.advance(NODE_SIGNIN_BACKOFF_MAX_MS)
      const challenge = await f.port.begin('signin')
      await expect(f.port.signIn(challenge.id, assertionProof)).rejects.toThrow()
    }
    expect(f.store.read().passkeys[0]).toMatchObject({ disabled: true, failures: 100 })
    expect(f.console.calls).toContainEqual([expect.stringContaining('console')])
    const restarted = new NodePasskeyAuth(f.options)
    await expect(restarted.forSource('new-source').begin('signin')).rejects.toThrow()
    await restarted.consoleSetup()
    f.advance(NODE_SIGNIN_BACKOFF_MAX_MS)
    const port = restarted.forSource('new-source')
    const enrollment = await port.begin('enroll', f.code())
    await port.enroll(enrollment.id, registrationProof)
    expect(f.store.read().passkeys[0]).toMatchObject({ disabled: false, failures: 0 })
    f.advance(NODE_SIGNIN_BACKOFF_MAX_MS)
    await expect(port.enroll(enrollment.id, registrationProof)).rejects.toThrow()
    restarted.endAll()
    f.auth.endAll()
  })
  it('keeps UV freshness anchored before a slow audit write', async () => {
    const f = await enrolledFixture()
    const bound = f.auth.forSource('127.0.0.1', f.session.session.id)
    const challenge = await bound.beginStepUp(f.session.session.id, 'maker.action', 'a'.repeat(64))
    const append = f.store.append
    f.store.append = async (details) => {
      const result = await append(details)
      if (details.kind === 'stepUp') f.advance(NODE_CHALLENGE_TTL_MS)
      return result
    }
    await expect(bound.stepUp(challenge.id, assertionProof)).rejects.toThrow()
    expect(f.audit).not.toContainEqual(
      expect.objectContaining({ kind: 'stepUp', outcome: 'allowed' }),
    )
    expect(f.audit).toContainEqual(expect.objectContaining({ kind: 'stepUp', outcome: 'verified' }))
    expect(f.audit).toContainEqual(expect.objectContaining({ kind: 'stepUp', outcome: 'denied' }))
    expect(f.audit).toContainEqual(expect.objectContaining({ outcome: 'denied' }))
    f.auth.endAll()
  })
  it('H15 access audit failure revokes a minted session and burns a minted step-up proof', async () => {
    const f = await enrolledFixture()
    const append = f.store.append
    f.store.append = (details) =>
      details.outcome === 'allowed'
        ? Promise.reject(new Error('access audit unavailable'))
        : append(details)
    const signin = await f.port.begin('signin')
    await expect(f.port.signIn(signin.id, assertionProof)).rejects.toThrow()
    expect(f.lifecycle.ended.calls).toHaveLength(1)
    f.advance(NODE_SIGNIN_BACKOFF_MAX_MS)
    const bound = f.auth.forSource('127.0.0.1', f.session.session.id)
    const step = await bound.beginStepUp(f.session.session.id, 'maker.action', 'a'.repeat(64))
    const inner = f.auth.sessions.issueProof.bind(f.auth.sessions)
    const issued: unknown[] = []
    f.auth.sessions.issueProof = (...args) => {
      const value = inner(...args)
      issued.push(value)
      return value
    }
    await expect(bound.stepUp(step.id, assertionProof)).rejects.toThrow()
    const proof = nodeStepUpSchema.parse(issued[0])
    await expect(
      f.auth.sessions.consumeStepUp(proof, new AbortController().signal),
    ).rejects.toThrow()
    f.auth.endAll()
  })
  it('mints no sign-in session when audit outlasts the challenge', async () => {
    const f = await enrolledFixture()
    const challenge = await f.port.begin('signin')
    const append = f.store.append
    f.store.append = async (details) => {
      const result = await append(details)
      f.advance(NODE_CHALLENGE_TTL_MS)
      return result
    }
    await expect(f.port.signIn(challenge.id, assertionProof)).rejects.toThrow()
    expect(f.lifecycle.attached.calls).toHaveLength(1)
    expect(f.audit).not.toContainEqual(
      expect.objectContaining({ action: 'signin', outcome: 'allowed' }),
    )
    expect(f.audit).toContainEqual(
      expect.objectContaining({ action: 'signin', outcome: 'verified' }),
    )
    expect(f.audit).toContainEqual(expect.objectContaining({ action: 'signin', outcome: 'denied' }))
    f.auth.endAll()
  })
  it('shows durable lockout on the console even when the audit store is unavailable', async () => {
    const f = await enrolledFixture()
    const state = f.store.read()
    await f.store.update(state.generation, (value) => ({
      ...value,
      passkeys: value.passkeys.map((key) => ({ ...key, failures: NODE_SIGNIN_MAX_FAILURES - 1 })),
    }))
    const challenge = await f.port.begin('signin')
    f.verifier.assert.once(() => Promise.reject(new Error('invalid')))
    f.store.append = () => Promise.reject(new Error('audit unavailable'))
    await expect(f.port.signIn(challenge.id, assertionProof)).rejects.toThrow()
    expect(f.store.read().passkeys[0]?.disabled).toBe(true)
    expect(f.console.calls).toContainEqual([expect.stringContaining('console')])
    expect(f.lifecycle.ended.calls).toHaveLength(1)
  })
  it('does not resurrect an in-flight sign-in after lock', async () => {
    const f = await enrolledFixture()
    const challenge = await f.port.begin('signin')
    f.verifier.assert.once(() => {
      f.auth.endAll()
      return Promise.resolve(1)
    })
    await expect(f.port.signIn(challenge.id, assertionProof)).rejects.toThrow()
    await expect(
      f.auth.sessions.verifyBearer(f.session.bearer, new AbortController().signal),
    ).rejects.toThrow()
    expect(f.lifecycle.attached.calls).toHaveLength(1)
  })
  it('refuses bare IP, unconfigured names and HTTP origins', () => {
    const f = authFixture()
    for (const changes of [
      { rpId: '127.0.0.1' },
      { rpId: 'evil.local' },
      { rpId: 'evil.local', origin: 'https://evil.local:7443' },
      { origin: ['http:', '//home.local'].join('') },
      { origin: 'https://home.local:7443/path' },
    ])
      expect(() => new NodePasskeyAuth({ ...f.options, ...changes })).toThrow()
  })
  it('refuses a different RP even when both names are configured', async () => {
    const f = authFixture()
    const state = f.store.read()
    await f.store.update(state.generation, (value) => ({
      ...value,
      config: { ...value.config, browserNames: ['home.local', 'localhost'] },
    }))
    expect(() => new NodePasskeyAuth({ ...f.options, rpId: 'localhost' })).toThrow()
  })
})
