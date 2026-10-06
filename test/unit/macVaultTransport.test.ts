import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VAULT_APPROVAL_TTL_MS, VAULT_LIMITS } from '../../src/shared/constants'
import { invokeMacVault } from '../../src/runtime/vault/slots/macVaultProtocol'
import { macVaultTransport } from '../../src/runtime/vault/slots/macVaultTransport'

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))

function response(metadata: unknown, key: Uint8Array = new Uint8Array()): Buffer {
  const json = Buffer.from(JSON.stringify(metadata))
  const bytes = Buffer.alloc(4 + json.length + key.length)
  bytes.writeUInt32BE(json.length)
  bytes.set(json, 4)
  bytes.set(key, 4 + json.length)
  return bytes
}

function wasKilled(): boolean {
  return true
}

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly input: Buffer[] = []
  readonly kill = vi.fn(wasKilled)
  readonly stdin = new Writable({
    write: (chunk: Buffer, _encoding, done) => {
      this.input.push(chunk)
      done()
    },
  })
}

describe('private Mac helper process', () => {
  let child: FakeChild
  beforeEach(() => {
    child = new FakeChild()
    mocks.spawn.mockReset().mockReturnValue(child)
  })
  afterEach(() => {
    for (const chunk of child.input) chunk.fill(0)
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('spawns one absolute trusted helper with empty argv/environment and binary pipes', async () => {
    const transport = macVaultTransport('/test/muse-vault')
    const header = Buffer.from(JSON.stringify({ v: 1, operation: 'probe' }))
    const key = randomBytes(32)
    const pending = transport.exchange(header, key)
    expect(mocks.spawn).toHaveBeenCalledWith('/test/muse-vault', [], {
      env: {},
      stdio: 'pipe',
      shell: false,
    })
    expect(child.input[0]?.readUInt32BE()).toBe(header.length)
    expect(child.input[1]).toEqual(header)
    expect(child.input[2]).toBe(key)
    const first = randomBytes(8)
    const second = randomBytes(8)
    child.stdout.write(first)
    child.stdout.write(second)
    child.emit('close', 0)
    const output = await pending
    expect(output).toHaveLength(16)
    expect(output.some((byte) => byte !== 0)).toBe(true)
    expect(first.every((byte) => byte === 0)).toBe(true)
    expect(second.every((byte) => byte === 0)).toBe(true)
    output.fill(0)
  })

  it('validates a complete helper response and never exposes stderr', async () => {
    const pending = invokeMacVault(macVaultTransport('/test/muse-vault'), {
      v: 1,
      operation: 'probe',
    })
    const stderr = Buffer.from('private account/path')
    child.stderr.write(stderr)
    child.stdout.write(response({ v: 1, status: 'ok', secureEnclave: true, certified: false }))
    child.emit('close', 0)
    const result = await pending
    expect(result.probe?.secureEnclave).toBe(true)
    expect(stderr.every((byte) => byte === 0)).toBe(true)
  })

  it.each([
    ['cancelled', 'MacVaultCancelledError', 'requestAgain'],
    ['unavailable', 'MacVaultUnavailableError', 'usePassphrase'],
    ['keychainLocked', 'MacVaultKeychainLockedError', 'unlockKeychain'],
    ['itemMissing', 'MacVaultItemMissingError', 'restoreSlot'],
    ['authentication', 'MacVaultAuthenticationError', 'restoreBackup'],
    ['invalidRequest', 'MacVaultInvalidRequestError', 'repairRequest'],
  ])(
    'preserves native %s and its recovery action through exit 1',
    async (code, name, recoveryAction) => {
      const pending = invokeMacVault(
        macVaultTransport('/test/muse-vault'),
        {
          v: 1,
          operation: 'wrap',
          identity: { slotId: 'a'.repeat(32), vaultId: 'b'.repeat(32), tier: 'osStore' },
        },
        randomBytes(32),
      )
      const failed = expect(pending).rejects.toMatchObject({ name, code, recoveryAction })
      const output = response({ v: 1, status: 'error', code })
      child.stdout.write(output.subarray(0, 2))
      child.stdout.write(output.subarray(2))
      child.emit('close', 1)
      await failed
      expect(output.every((byte) => byte === 0)).toBe(true)
      expect(child.input[2]?.every((byte) => byte === 0)).toBe(true)
    },
  )

  it('erases the reconstructed native failure frame before rejecting', async () => {
    const pending = invokeMacVault(macVaultTransport('/test/muse-vault'), {
      v: 1,
      operation: 'probe',
    })
    const failed = expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    child.stdout.write(response({ v: 1, status: 'error', code: 'cancelled' }))
    const allocated: Buffer[] = []
    const allocate = Buffer.alloc
    vi.spyOn(Buffer, 'alloc').mockImplementation((size, fill, encoding) => {
      const bytes = allocate(size, fill, encoding)
      allocated.push(bytes)
      return bytes
    })
    child.emit('close', 1)
    await failed
    expect(allocated).toHaveLength(1)
    expect(allocated[0]?.every((byte) => byte === 0)).toBe(true)
  })

  it('does not trust a native error frame after an unexpected exit code', async () => {
    const pending = invokeMacVault(macVaultTransport('/test/muse-vault'), {
      v: 1,
      operation: 'probe',
    })
    const failed = expect(pending).rejects.toMatchObject({ name: 'Error', message: 'No access' })
    child.stdout.write(response({ v: 1, status: 'error', code: 'cancelled' }))
    child.emit('close', 2)
    await failed
  })

  it.each([
    response({ v: 1, status: 'error', code: 'cancelled', detail: 'private account/path' }),
    response({ v: 1, status: 'error', code: 'foreign' }),
    response({ v: 1, status: 'error', code: 'keychain' }),
    response({ v: 1, status: 'error', code: 'cancelled' }, randomBytes(1)),
    response({ v: 1, status: 'ok', secureEnclave: true, certified: true }),
    Buffer.from([0, 0, 0, 1, 123]),
  ])('scrubs invalid error frames on exit 1 without trusting diagnostics %s', async (frame) => {
    const pending = invokeMacVault(macVaultTransport('/test/muse-vault'), {
      v: 1,
      operation: 'probe',
    })
    const failed = expect(pending).rejects.toMatchObject({ name: 'Error', message: 'No access' })
    const output = Buffer.from(frame)
    child.stdout.write(output)
    child.emit('close', 1)
    await failed
    expect(output.every((byte) => byte === 0)).toBe(true)
  })

  it('rejects relative executable paths without spawning', () => {
    expect(() => macVaultTransport('muse-vault')).toThrow()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it.each(['error', 'stdin-error', 'nonzero', 'signal', 'oversized'])(
    'kills and scrubs on %s',
    async (kind) => {
      const pending = macVaultTransport('/test/muse-vault').exchange(
        Buffer.alloc(0),
        Buffer.alloc(0),
      )
      const failed = expect(pending).rejects.toThrow('No access')
      const partial = randomBytes(32)
      child.stdout.write(partial)
      switch (kind) {
        case 'error': {
          child.emit('error', new Error('private account/path'))
          break
        }
        case 'stdin-error': {
          child.stdin.emit('error', new Error('private pipe failure'))
          break
        }
        case 'nonzero': {
          child.emit('close', 1)
          break
        }
        case 'signal': {
          child.emit('close', null)
          break
        }
        case 'oversized': {
          child.stdout.write(Buffer.alloc(VAULT_LIMITS.text + 33))
          break
        }
      }
      expect(child.kill).toHaveBeenCalledWith('SIGKILL')
      await failed
      expect(partial.every((byte) => byte === 0)).toBe(true)
      const late = randomBytes(32)
      child.stdout.write(late)
      expect(late.every((byte) => byte === 0)).toBe(true)
    },
  )

  it('ends a helper at the presence deadline and removes its abort listener', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const pending = macVaultTransport('/test/muse-vault', controller.signal).exchange(
      Buffer.alloc(0),
      Buffer.alloc(0),
    )
    const failed = expect(pending).rejects.toThrow('No access')
    await vi.advanceTimersByTimeAsync(VAULT_APPROVAL_TTL_MS)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    await failed
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels on broker lock and refuses an already-aborted request before spawn', async () => {
    const controller = new AbortController()
    const transport = macVaultTransport('/test/muse-vault', controller.signal)
    const pending = transport.exchange(Buffer.alloc(0), Buffer.alloc(0))
    const failed = expect(pending).rejects.toThrow()
    controller.abort()
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    await failed
    mocks.spawn.mockClear()
    await expect(transport.exchange(Buffer.alloc(0), Buffer.alloc(0))).rejects.toThrow()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
})
