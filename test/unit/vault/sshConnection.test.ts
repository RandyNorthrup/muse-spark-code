import { afterEach, describe, it, expect, vi } from 'vitest'
import { Socket, connect } from 'node:net'
import { connectUserSshAgent } from '../../../src/core/vault/ssh/externalAgent'
import { SSH, sshFrame, uint32 } from '../../../src/core/vault/ssh/wire'
import { VAULT_APPROVAL_TTL_MS } from '../../../src/shared/constants'

vi.mock('node:net', async (load) => ({
  ...(await load<Record<string, unknown>>()),
  connect: vi.fn(),
}))
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
function socketFixture() {
  const socket = new Socket()
  vi.spyOn(socket, 'write').mockReturnValue(true)
  vi.mocked(connect).mockReturnValue(socket)
  return socket
}
describe('SSH external agent connection ownership', () => {
  it('authenticates the selected server, serializes replies and preserves the owned reply across framing wipe', async () => {
    const socket = socketFixture(),
      controller = new AbortController(),
      verify = vi.fn(() => Promise.resolve())
    const opening = connectUserSshAgent('/owned-test-agent.sock', verify, controller.signal)
    socket.emit('connect')
    const connection = await opening
    try {
      expect(verify).toHaveBeenCalledWith(socket)
      const response = connection.request(sshFrame(SSH.identities))
      await expect(connection.request(sshFrame(SSH.identities))).rejects.toThrow()
      const frame = sshFrame(SSH.identitiesAnswer, uint32(0))
      socket.emit('data', frame.subarray(0, 2))
      socket.emit('data', frame.subarray(2))
      expect(await response).toEqual(frame.subarray(4))
    } finally {
      connection.close()
    }
    expect(socket.destroyed).toBe(true)
    await expect(connection.request(sshFrame(SSH.identities))).rejects.toThrow()
  })
  it('rejects an unsolicited reply and rejects a pending request when aborted', async () => {
    for (const isUnsolicited of [false, true]) {
      const socket = socketFixture(),
        controller = new AbortController()
      const opening = connectUserSshAgent(
        '/owned-test-agent.sock',
        () => Promise.resolve(),
        controller.signal,
      )
      socket.emit('connect')
      const connection = await opening
      if (isUnsolicited) {
        socket.emit('data', sshFrame(SSH.success))
      } else {
        const response = connection.request(sshFrame(SSH.identities)),
          assertion = expect(response).rejects.toThrow()
        controller.abort()
        await assertion
      }
      expect(socket.destroyed).toBe(true)
      connection.close()
    }
  })
  it('refuses an already aborted dial, a rejected or late server proof and an interrupted connection', async () => {
    const aborted = new AbortController()
    aborted.abort()
    await expect(
      connectUserSshAgent('/owned-test-agent.sock', () => Promise.resolve(), aborted.signal),
    ).rejects.toThrow()
    for (const phase of ['proof', 'late', 'connect']) {
      const socket = socketFixture(),
        controller = new AbortController(),
        ready = Promise.withResolvers<undefined>(),
        entered = Promise.withResolvers<undefined>()
      const opening = connectUserSshAgent(
          '/owned-test-agent.sock',
          () => {
            entered.resolve(undefined)
            return phase === 'proof' ? Promise.reject(new Error('foreign server')) : ready.promise
          },
          controller.signal,
        ),
        assertion = expect(opening).rejects.toThrow()
      if (phase === 'connect') socket.destroy()
      else {
        socket.emit('connect')
        await entered.promise
        if (phase === 'late') {
          controller.abort()
          ready.resolve(undefined)
        }
      }
      await assertion
      expect(socket.destroyed).toBe(true)
    }
  })
  it('bounds a silent upstream request by the approval lifetime', async () => {
    vi.useFakeTimers()
    const socket = socketFixture(),
      controller = new AbortController()
    const opening = connectUserSshAgent(
      '/owned-test-agent.sock',
      () => Promise.resolve(),
      controller.signal,
    )
    socket.emit('connect')
    const connection = await opening,
      response = connection.request(sshFrame(SSH.identities)),
      assertion = expect(response).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(VAULT_APPROVAL_TTL_MS)
    await assertion
    expect(socket.destroyed).toBe(true)
    connection.close()
  })
})
