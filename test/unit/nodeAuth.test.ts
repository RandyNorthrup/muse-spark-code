import { describe, expect, it, vi } from 'vitest'
import {
  NODE_CHALLENGE_TTL_MS,
  NODE_DNS_LABEL_CHARS,
  NODE_MAX_AUTH_BYTES,
  NODE_MAX_ID_CHARS,
  NODE_MAX_NAME_CHARS,
  NODE_MAX_RANDOM_TOKEN_CHARS,
  NODE_MIN_RANDOM_TOKEN_CHARS,
  NODE_SESSION_IDLE_MS,
  NODE_SESSION_MAX_MS,
  NODE_SIGNIN_MAX_FAILURES,
  NODE_STEP_UP_TTL_MS,
} from '../../src/shared/constants'
import {
  nodeAssertionSchema,
  nodeAuthChallengeSchema,
  nodeAuthenticationSchema,
  nodeDigestSchema,
  nodeDomainSchema,
  nodeIdentifierSchema,
  nodePasskeySchema,
  nodeRegistrationSchema,
  nodeSessionSchema,
  nodeStepUpActionSchema,
  nodeStepUpSchema,
  nodeTimeSchema,
  nodeTokenSchema,
  type NodeAuthPort,
} from '../../src/shared/nodeAuth'
import { FakeNodeClock } from './helpers/node/clock'
import { VirtualNodeAuthenticator } from './helpers/node/authenticator'
import {
  nodeAuthentication,
  nodeBearer,
  nodeChallenge,
  nodeHash,
  nodeSession,
  nodeStepUp,
} from './helpers/node/records'

const fields = { id: 'YQ', rawId: 'YQ', type: 'public-key', clientExtensionResults: {} }
const registration = { ...fields, response: { clientDataJSON: 'e30', attestationObject: 'YQ' } }
const assertion = {
  ...fields,
  response: { clientDataJSON: 'e30', authenticatorData: 'YQ', signature: 'YQ', userHandle: null },
}
const passkey = {
  id: 'YQ',
  ownerId: 'owner',
  publicKey: 'YQ',
  counter: 0,
  failures: 0,
  disabled: false,
}

describe('node auth boundaries', () => {
  it('separates sign-in bearer from public session and passkey records', () => {
    expect(nodeAuthenticationSchema.parse(nodeAuthentication()).bearer).toBe(nodeBearer)
    expect(nodeSessionSchema.safeParse({ ...nodeSession(), bearer: nodeBearer }).success).toBe(
      false,
    )
    expect(nodePasskeySchema.safeParse({ ...passkey, privateKey: nodeBearer }).success).toBe(false)
    expect(nodePasskeySchema.parse(passkey)).toEqual(passkey)
    expect(nodeRegistrationSchema.parse(registration)).toEqual(registration)
    expect(nodeAssertionSchema.parse(assertion)).toEqual(assertion)
  })
  it.each(['home.local', 'localhost', 'node.example.test', 'xn--bcher-kva.local'])(
    'accepts domain RP %s',
    (name) => {
      expect(nodeDomainSchema.safeParse(name).success).toBe(true)
    },
  )
  it.each([
    '127.0.0.1',
    '::1',
    '0x7f000001',
    '2130706433',
    '127.1',
    'https://home.local',
    'Home.local',
    '-home.local',
    'home-.local',
    'home..local',
    'home.local.',
    '*',
    '',
    'x'.repeat(NODE_DNS_LABEL_CHARS + 1),
    `${'a.'.repeat(NODE_MAX_NAME_CHARS)}local`,
  ])('H03 refuses non-domain or invalid RP %s', (name) => {
    expect(nodeDomainSchema.safeParse(name).success).toBe(false)
  })
  it.each([
    ['lifetime', { ...nodeChallenge(), expiresAt: NODE_CHALLENGE_TTL_MS + 1 }],
    ['order', { ...nodeChallenge(), expiresAt: 0 }],
    ['version', { ...nodeChallenge(), v: 2 }],
    ['origin host', { ...nodeChallenge(), origin: 'https://other.local:7443' }],
    ['origin scheme', { ...nodeChallenge(), origin: ['http:', '//home.local:7443'].join('') }],
    ['origin slash', { ...nodeChallenge(), origin: 'https://home.local:7443/' }],
    ['origin auth', { ...nodeChallenge(), origin: 'https://user@home.local:7443' }],
    ['origin malformed', { ...nodeChallenge(), origin: '://' }],
    ['missing step-up binding', { ...nodeChallenge(), purpose: 'stepUp' }],
    ['setup code leaked', { ...nodeChallenge(), setupCode: nodeBearer }],
  ])('H04/H05 challenge rejects %s without throwing', (_label, challenge) => {
    expect(() => nodeAuthChallengeSchema.safeParse(challenge)).not.toThrow()
    expect(nodeAuthChallengeSchema.safeParse(challenge).success).toBe(false)
  })
  it('accepts a step-up challenge only with its exact binding fields', () => {
    expect(
      nodeAuthChallengeSchema.parse({
        ...nodeChallenge(),
        purpose: 'stepUp',
        sessionId: 'session-1',
        action: 'terminal.open',
        actionDigest: nodeHash,
      }).purpose,
    ).toBe('stepUp')
    expect(nodeStepUpActionSchema.safeParse('bypass').success).toBe(false)
  })
  it.each([
    ['idle lifetime', { ...nodeSession(), idleExpiresAt: NODE_SESSION_IDLE_MS + 2 }],
    ['absolute lifetime', { ...nodeSession(), absoluteExpiresAt: NODE_SESSION_MAX_MS + 1 }],
    ['last seen order', { ...nodeSession(), lastSeenAt: -1 }],
    ['idle order', { ...nodeSession(), idleExpiresAt: 1 }],
    ['absolute order', { ...nodeSession(), absoluteExpiresAt: 1 }],
    ['idle past absolute', { ...nodeSession(), absoluteExpiresAt: 1000 }],
  ])('H08 session rejects %s', (_label, session) => {
    expect(nodeSessionSchema.safeParse(session).success).toBe(false)
  })
  it.each([
    ['lifetime', { ...nodeStepUp(), expiresAt: NODE_STEP_UP_TTL_MS + 1 }],
    ['order', { ...nodeStepUp(), expiresAt: 0 }],
    ['session missing', { ...nodeStepUp(), sessionId: '' }],
    ['digest missing', { ...nodeStepUp(), actionDigest: '' }],
    ['unbound wildcard', { ...nodeStepUp(), action: '*' }],
  ])('H08 step-up rejects %s', (_label, proof) => {
    expect(nodeStepUpSchema.safeParse(proof).success).toBe(false)
  })
  it.each([
    ['token entropy', nodeTokenSchema, 'x'.repeat(NODE_MIN_RANDOM_TOKEN_CHARS - 1)],
    ['token cap', nodeTokenSchema, 'x'.repeat(NODE_MAX_RANDOM_TOKEN_CHARS + 1)],
    ['token alphabet', nodeTokenSchema, 'x'.repeat(NODE_MIN_RANDOM_TOKEN_CHARS - 1) + '+'],
    ['empty ID', nodeIdentifierSchema, ''],
    ['ID cap', nodeIdentifierSchema, 'x'.repeat(NODE_MAX_ID_CHARS + 1)],
    ['ID alphabet', nodeIdentifierSchema, 'x/y'],
    ['digest', nodeDigestSchema, 'x'.repeat(64)],
    ['negative time', nodeTimeSchema, -1],
    ['unsafe time', nodeTimeSchema, Number.MAX_SAFE_INTEGER + 1],
  ] as const)('auth scalar rejects %s', (_label, schema, value) => {
    expect(schema.safeParse(value).success).toBe(false)
  })
  it.each([
    ['proof type', { ...assertion, type: 'password' }],
    [
      'proof cap',
      {
        ...assertion,
        response: { ...assertion.response, signature: 'x'.repeat(NODE_MAX_AUTH_BYTES + 1) },
      },
    ],
    ['proof alphabet', { ...assertion, response: { ...assertion.response, signature: '==bad==' } }],
    ['extension secret', { ...assertion, clientExtensionResults: { token: nodeBearer } }],
  ])('assertion rejects %s', (_label, proof) => {
    expect(nodeAssertionSchema.safeParse(proof).success).toBe(false)
  })
  it('H09 caps failures and requires lockout at the threshold', () => {
    expect(
      nodePasskeySchema.safeParse({ ...passkey, failures: NODE_SIGNIN_MAX_FAILURES }).success,
    ).toBe(false)
    expect(
      nodePasskeySchema.safeParse({
        ...passkey,
        failures: NODE_SIGNIN_MAX_FAILURES,
        disabled: true,
      }).success,
    ).toBe(true)
    expect(
      nodePasskeySchema.safeParse({
        ...passkey,
        failures: NODE_SIGNIN_MAX_FAILURES + 1,
        disabled: true,
      }).success,
    ).toBe(false)
  })
  it('fake clock keeps monotonic elapsed time across backward wall-clock changes', () => {
    const clock = new FakeNodeClock()
    const wall = clock.now()
    clock.advance(1000)
    clock.shiftWall(-60_000)
    expect(clock.monotonicMs()).toBe(1000)
    expect(clock.now()).toBe(wall - 59_000)
    expect(() => {
      clock.advance(-1)
    }).toThrow()
    expect(() => {
      clock.advance(0.5)
    }).toThrow()
    expect(() => {
      clock.shiftWall(NaN)
    }).toThrow()
  })
  it('virtual authenticator configures resident keys and UV without a TLS bypass', async () => {
    const send = vi.fn((method: string) =>
      Promise.resolve(
        method === 'WebAuthn.addVirtualAuthenticator'
          ? { authenticatorId: 'test-authenticator' }
          : {},
      ),
    )
    const authenticator = await VirtualNodeAuthenticator.create({ send })
    expect(send).toHaveBeenNthCalledWith(1, 'WebAuthn.enable', { enableUI: false })
    expect(send).toHaveBeenNthCalledWith(2, 'WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    })
    await authenticator.setVerified(false)
    await authenticator.close()
    expect(send).toHaveBeenNthCalledWith(3, 'WebAuthn.setUserVerified', {
      authenticatorId: 'test-authenticator',
      isUserVerified: false,
    })
    expect(send).toHaveBeenNthCalledWith(4, 'WebAuthn.removeVirtualAuthenticator', {
      authenticatorId: 'test-authenticator',
    })
  })
  it('virtual authenticator refuses a malformed CDP response', async () => {
    await expect(
      VirtualNodeAuthenticator.create({ send: () => Promise.resolve({}) }),
    ).rejects.toThrow()
  })
  it('exposes an injected auth seam without choosing a verifier or enrollment policy', async () => {
    const port: NodeAuthPort = {
      begin: vi.fn(() => Promise.resolve(nodeChallenge())),
      beginStepUp: vi.fn(() =>
        Promise.resolve(
          nodeAuthChallengeSchema.parse({
            ...nodeChallenge(),
            purpose: 'stepUp',
            sessionId: 'session-1',
            action: 'terminal.open',
            actionDigest: nodeHash,
          }),
        ),
      ),
      enroll: vi.fn(() => Promise.resolve(nodeAuthentication())),
      signIn: vi.fn(() => Promise.resolve(nodeAuthentication())),
      stepUp: vi.fn(() => Promise.resolve(nodeStepUp())),
      end: vi.fn(() => Promise.resolve()),
    }
    expect(await port.begin('signin')).toEqual(nodeChallenge())
    const stepChallenge = await port.beginStepUp('session-1', 'terminal.open', nodeHash)
    expect(stepChallenge.purpose).toBe('stepUp')
    expect(await port.enroll('challenge-1', nodeRegistrationSchema.parse(registration))).toEqual(
      nodeAuthentication(),
    )
    expect(await port.signIn('challenge-1', nodeAssertionSchema.parse(assertion))).toEqual(
      nodeAuthentication(),
    )
    expect(await port.stepUp('challenge-1', nodeAssertionSchema.parse(assertion))).toEqual(
      nodeStepUp(),
    )
    await port.end('session-1')
    expect(port.end).toHaveBeenCalledWith('session-1')
  })
})
