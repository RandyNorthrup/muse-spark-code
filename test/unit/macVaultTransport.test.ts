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
