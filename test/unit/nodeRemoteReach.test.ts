// M110d lanes X, F3 and G: route choice follows the person's order, a
// sealed node opens only for a paired approver's signature, a brokered
// secret use refuses stale epochs and strangers, and a remote ACP session
// never touches the node's files. All real code, no network but the
// handshake's own bytes.
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { admitBrokeredUse } from '../../src/core/devices/brokeredUse'
import { generateIdentityKeyPair } from '../../src/core/devices/identity'
import {
  isNodeLocalAddress,
  isOverlayAddress,
  selectNodeRoute,
} from '../../src/core/devices/routes/select'
import {
  authorizeUnseal,
  sealNode,
  unsealNode,
  unwrapDataKey,
  wrapDataKey,
} from '../../src/runtime/node/seal'
import {
  answerAttachChallenge,
  createAttachChallenge,
  isAttachAnswerValid,
} from '../../src/runtime/node/attach/handshake'
import { filterRemoteMethod } from '../../src/runtime/node/attach/policy'

describe('route choice', () => {
  it('follows the person order and says what it tried', () => {
    expect(isOverlayAddress('100.64.0.1')).toBe(true)
    expect(isOverlayAddress('100.127.255.255')).toBe(true)
    expect(isOverlayAddress('100.128.0.1')).toBe(false)
    expect(isOverlayAddress('192.168.1.2')).toBe(false)
    expect(
      ['127.0.0.1', '10.9.9.9', '172.16.0.1', '172.31.255.255', '192.168.1.2', '169.254.9.9'].map(
        (address) => isNodeLocalAddress(address),
      ),
    ).toEqual([true, true, true, true, true, true])
    expect(
      ['172.15.0.1', '172.32.0.1', '203.0.113.9', '8.8.8.8', '100.96.0.3'].map((address) =>
        isNodeLocalAddress(address),
      ),
    ).toEqual([false, false, false, false, false])
    expect(isNodeLocalAddress('::1')).toBe(true)
    expect(isNodeLocalAddress('fe80::1')).toBe(true)
    expect(isNodeLocalAddress('fc00::9')).toBe(true)
    expect(isNodeLocalAddress('2001:db8::1')).toBe(false)
    const direct = selectNodeRoute({
      addresses: ['192.168.1.2'],
      preference: ['direct', 'relay'],
      relay: 'relay.example',
      ssh: undefined,
    })
    expect(direct).toEqual({ reachable: true, attempt: { kind: 'direct', address: '192.168.1.2' } })
    const overlay = selectNodeRoute({
      addresses: ['100.96.0.3', '192.168.1.2'],
      preference: ['overlay', 'direct'],
      relay: undefined,
      ssh: undefined,
    })
    expect(overlay).toEqual({
      reachable: true,
      attempt: { kind: 'overlay', address: '100.96.0.3' },
    })
    const lost = selectNodeRoute({
      addresses: ['203.0.113.9'],
      preference: ['direct', 'relay'],
      relay: undefined,
      ssh: undefined,
    })
    expect(lost.reachable).toBe(false)
    if (!lost.reachable) expect(lost.reason).toContain('direct, relay')
  })
})

describe('sealed at boot', () => {
  it('opens only for a paired approver and keeps the data key wrapped', () => {
    const approver = generateIdentityKeyPair()
    const stranger = generateIdentityKeyPair()
    const sealed = sealNode({ state: 'open', nodeId: 'node-a' })
    expect(sealed).toEqual({ state: 'sealed' })
    const grant = authorizeUnseal('node-a', Buffer.from(approver.privateKey, 'base64'))
    expect(unsealNode('node-a', sealed, grant, [approver.publicKey])).toEqual({
      state: 'open',
      nodeId: 'node-a',
    })
    expect(() => unsealNode('node-a', sealed, grant, [stranger.publicKey])).toThrow(
      'this approver is not paired',
    )
    expect(() => unsealNode('node-b', sealed, grant, [approver.publicKey])).toThrow(
      'this unseal names another node',
    )
    const secondApprover = authorizeUnseal('node-a', Buffer.from(stranger.privateKey, 'base64'))
    expect(unsealNode('node-a', sealed, secondApprover, [stranger.publicKey])).toEqual({
      state: 'open',
      nodeId: 'node-a',
    })
    expect(() =>
      unsealNode('node-b', sealed, { ...grant, nodeId: 'node-b' }, [approver.publicKey]),
    ).toThrow('this unseal signature is wrong')

    const dataKey = randomBytes(32)
    const kek = randomBytes(32)
    const wrapped = wrapDataKey(dataKey, kek)
    expect(Buffer.from(unwrapDataKey(wrapped, kek) ?? [])).toEqual(Buffer.from(dataKey))
    expect(unwrapDataKey(wrapped, randomBytes(32))).toBeUndefined()
    expect(unwrapDataKey(`${wrapped}tampered`, kek)).toBeUndefined()
  })
})

describe('brokered secret uses', () => {
  it('admits a live paired use and refuses the rest by name', () => {
    const request = {
      keyId: 'deploy-token',
      mode: 'askOncePerSession',
      purpose: 'sign the release',
      epoch: 3,
      nonce: 'nonce-1',
    } as const
    expect(
      admitBrokeredUse(request, { leaseEpoch: 3, pairTrust: 'my-node', keyRevoked: false }),
    ).toEqual({ admitted: true })
    expect(
      admitBrokeredUse(request, { leaseEpoch: 4, pairTrust: 'my-node', keyRevoked: false }),
    ).toEqual({ admitted: false, reason: 'this use carries a stale epoch' })
    expect(
      admitBrokeredUse(request, { leaseEpoch: 3, pairTrust: 'other', keyRevoked: false }),
    ).toEqual({ admitted: false, reason: 'only a paired node may use this secret' })
    expect(
      admitBrokeredUse(request, { leaseEpoch: 3, pairTrust: 'my-node', keyRevoked: true }),
    ).toEqual({ admitted: false, reason: 'this key is revoked' })
    expect(
      admitBrokeredUse(
        { ...request, mode: 'never' },
        { leaseEpoch: 3, pairTrust: 'my-node', keyRevoked: false },
      ),
    ).toEqual({ admitted: false, reason: 'this secret is never usable remotely' })
  })
})

describe('remote sessions', () => {
  it('proves the node by signature and keeps its files home', () => {
    const node = generateIdentityKeyPair()
    const stranger = generateIdentityKeyPair()
    const challenge = createAttachChallenge()
    const answer = answerAttachChallenge(node.privateKey, challenge)
    expect(isAttachAnswerValid(node.publicKey, challenge, answer)).toBe(true)
    expect(isAttachAnswerValid(stranger.publicKey, challenge, answer)).toBe(false)
    expect(isAttachAnswerValid(node.publicKey, createAttachChallenge(), answer)).toBe(false)
    expect(filterRemoteMethod('acp', 'fs/read_text_file')).toEqual({
      allowed: false,
      reason: 'a remote ACP session never reads the node files',
    })
    expect(filterRemoteMethod('acp', 'session/prompt')).toEqual({ allowed: true })
    expect(filterRemoteMethod('exec', 'run')).toEqual({ allowed: true })
    expect(filterRemoteMethod('tui', 'open')).toEqual({
      allowed: false,
      reason: 'remote TUI sessions wait on lane T',
    })
    expect(filterRemoteMethod('lsp', 'textDocument/hover')).toEqual({
      allowed: false,
      reason: 'remote LSP sessions wait on M104e',
    })
  })
})
