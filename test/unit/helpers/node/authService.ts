import { randomBytes } from 'node:crypto'
import { NODE_CHALLENGE_KEY_BYTES, NODE_ZERO_DIGEST } from '../../../../src/shared/constants'
import { recordCalls, scripted } from '../recordCalls'
import { nodeStateSchema, type NodeAudit } from '../../../../src/shared/node'
import type { NodeStateStore } from '../../../../src/runtime/node/state'
import { NodePasskeyAuth } from '../../../../src/runtime/node/auth/service'
import { nodeAssertionSchema, nodeRegistrationSchema } from '../../../../src/shared/nodeAuth'
import { nodeState } from './records'

export function authFixture() {
  let now = 1000
  let elapsed = 0
  const clock = { now: () => now, monotonicMs: () => elapsed }
  let state = nodeStateSchema.parse({
    ...nodeState(),
    setup: null,
    auditHead: { seq: 0, hash: NODE_ZERO_DIGEST },
  })
  const audit: unknown[] = []
  const store: Pick<NodeStateStore, 'read' | 'update' | 'append'> = {
    read: () => structuredClone(state),
    update: (generation, change) => {
      if (generation !== state.generation) return Promise.reject(new Error('conflict'))
      state = nodeStateSchema.parse({
        ...change(structuredClone(state)),
        generation: generation + 1,
      })
      return Promise.resolve(structuredClone(state))
    },
    append: (details) => {
      audit.push(structuredClone(details))
      return Promise.resolve({
        ...details,
        v: 1,
        seq: audit.length,
        nodeId: state.nodeId,
        previousHash: NODE_ZERO_DIGEST,
        hash: NODE_ZERO_DIGEST,
      } satisfies NodeAudit)
    },
  }
  const key = {
    id: 'cHVibGljLWNyZWRlbnRpYWw',
    ownerId: 'owner',
    publicKey: 'cHVibGljLWtleQ',
    counter: 0,
    failures: 0,
    disabled: false,
  }
  const verifier = {
    enroll: scripted(() => Promise.resolve({ ...key })),
    assert: scripted(() => Promise.resolve(1)),
  }
  const printed = recordCalls<[string]>()
  const attached = recordCalls<[unknown]>()
  const ended = recordCalls<[unknown]>()
  const lifecycle = { attached: attached.fn, ended: ended.fn }
  const options = {
    state: store,
    clock,
    challengeKey: randomBytes(NODE_CHALLENGE_KEY_BYTES),
    rpId: 'home.local',
    origin: 'https://home.local:7443',
    verifier,
    console: printed.fn,
    lifecycle,
  }
  const auth = new NodePasskeyAuth(options)
  return {
    auth,
    options,
    store,
    audit,
    verifier,
    console: printed,
    lifecycle: { attached, ended },
    clock,
    advance: (ms: number) => {
      elapsed += ms
      now += ms
    },
    wall: (ms: number) => {
      now += ms
    },
    code: () =>
      printed.calls
        .findLast(([line]) => line.startsWith('One-time setup code: '))?.[0]
        .slice('One-time setup code: '.length) ?? '',
  }
}
export const registrationProof = nodeRegistrationSchema.parse({
  id: 'cHVibGljLWNyZWRlbnRpYWw',
  rawId: 'cHVibGljLWNyZWRlbnRpYWw',
  type: 'public-key',
  clientExtensionResults: {},
  response: { clientDataJSON: 'eA', attestationObject: 'eA' },
})
export const assertionProof = nodeAssertionSchema.parse({
  id: registrationProof.id,
  rawId: registrationProof.id,
  type: 'public-key',
  clientExtensionResults: {},
  response: { clientDataJSON: 'eA', authenticatorData: 'eA', signature: 'eA' },
})
export async function enrolledFixture() {
  const f = authFixture()
  await f.auth.consoleSetup()
  const port = f.auth.forSource('127.0.0.1')
  const challenge = await port.begin('enroll', f.code())
  const session = await port.enroll(challenge.id, registrationProof)
  return { ...f, port, session }
}
