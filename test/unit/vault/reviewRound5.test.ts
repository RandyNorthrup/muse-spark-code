import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import * as crypto from 'node:crypto'
import { type VaultAuditWriter } from '../../../src/core/vault/broker/ports'
import { isVaultBootTokenMatch } from '../../../src/core/vault/broker/broker'
import { brokerFixture } from './brokerFixture'
import { realAudit } from './auditFixture'

vi.mock('node:crypto', async (importOriginal) => {
  const original = await importOriginal<typeof crypto>()
  return { ...original, randomBytes: vi.fn(original.randomBytes) }
})

function keyOf(writer: object) {
  return z.instanceof(Buffer).parse(Reflect.get(writer, 'key'))
}
function cleared(writer: object, key: Buffer) {
  expect(key.every((byte) => byte === 0)).toBe(true)
  for (const field of ['key', 'writer', 'anchor']) expect(Reflect.get(writer, field)).toBeNull()
  expect(Reflect.get(writer, 'records')).toEqual([])
  expect(Reflect.get(writer, 'size')).toBe(0)
}

function throwFromFileClose(log: ReturnType<typeof realAudit>): void {
  const fileWriter = log.files.writer
  vi.spyOn(log.files, 'writer').mockImplementation((path) => {
    const file = fileWriter(path)
    file.close = () => {
      throw new Error('test descriptor close failed')
    }
    return file
  })
}

describe('RVM109B5 audit cleanup ownership', () => {
  it('P1 throwing unsubscribe cannot skip Dispose key erasure', async () => {
    const fixture = await brokerFixture(),
      unsubscribers: unknown = Reflect.get(fixture.broker, 'unsubscribers')
    if (!Array.isArray(unsubscribers)) throw new Error('expected owned unsubscribe array')
    unsubscribers.unshift(() => {
      throw new Error('test unsubscribe failed')
    })
    try {
      await fixture.broker.dispose()
      expect(fixture.heldKeys.every((key) => key.every((byte) => byte === 0))).toBe(true)
      expect(fixture.deps.onAuditFailure).toHaveBeenCalled()
    } finally {
      await fixture.broker.dispose()
    }
  })
  it('P1 generated broker nonce byte buffers are erased after encoding', async () => {
    const fixture = await brokerFixture(),
      random = vi.mocked(crypto.randomBytes)
    random.mockClear()
    try {
      await fixture.broker.status()
      const bytes = random.mock.results.map((result) => z.instanceof(Buffer).parse(result.value))
      random.mockClear()
      expect(bytes.length).toBeGreaterThan(0)
      expect(bytes.every((value) => value.every((byte) => byte === 0))).toBe(true)
    } finally {
      random.mockClear()
      await fixture.broker.dispose()
    }
  })
  it('P1 Lock reports an installed store close failure after erasing its key', async () => {
    const fixture = await brokerFixture(),
      open = fixture.deps.repository.open
    await fixture.broker.lock()
    fixture.deps.repository.open = async (key) => {
      const store = await open(key)
      store.lock = () => {
        throw new Error('test store close failed')
      }
      return store
    }
    await fixture.broker.unlock()
    try {
      await expect(fixture.broker.lock()).rejects.toThrow('test store close failed')
      expect(fixture.heldKeys.every((key) => key.every((byte) => byte === 0))).toBe(true)
    } finally {
      await fixture.broker.dispose()
    }
  })
  it.each(['lock', 'dispose'] as const)(
    'P1 %s rejects a real writer close failure after unconditional key erasure',
    async (action) => {
      const log = realAudit(),
        open = log.audit.openWriter.bind(log.audit),
        writers: VaultAuditWriter[] = []
      vi.spyOn(log.audit, 'openWriter').mockImplementation(async (key) => {
        const writer = await open(key)
        writers.push(writer)
        return writer
      })
      throwFromFileClose(log)
      const fixture = await brokerFixture({ audit: log.audit }),
        writer = writers[0]!,
        key = keyOf(writer)
      expect(key.some((byte) => byte !== 0)).toBe(true)
      fixture.deps.onAuditFailure = vi.fn(() => {
        throw new Error('test notice failed')
      })
      fixture.broker.subscribeInvalidation(() => undefined)
      try {
        await expect(fixture.broker[action]()).rejects.toThrow('test descriptor close failed')
        cleared(writer, key)
        const status = await fixture.broker.status()
        expect(status.state).toBe('locked')
        expect(fixture.deps.onAuditFailure).toHaveBeenCalled()
        expect(fixture.deps.onLocked).toHaveBeenCalled()
        expect(Reflect.get(fixture.broker, 'waiters')).toEqual(new Map())
        if (action === 'dispose')
          expect(Reflect.get(fixture.broker, 'invalidations')).toEqual(new Set())
        expect(() => {
          writer.close()
        }).not.toThrow()
      } finally {
        await fixture.broker.dispose()
      }
    },
  )
  it('P1 boot token comparison wipes both owned decoded tokens', () => {
    const from = vi.spyOn(Buffer, 'from')
    try {
      const isMatches = isVaultBootTokenMatch('a'.repeat(32), 'a'.repeat(32)),
        isDiffers = isVaultBootTokenMatch('a'.repeat(32), 'b'.repeat(32))
      const decoded = from.mock.results.map((result) => z.instanceof(Buffer).parse(result.value))
      from.mockRestore()
      expect(isMatches).toBe(true)
      expect(isDiffers).toBe(false)
      expect(decoded).toHaveLength(4)
      expect(decoded.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true)
    } finally {
      from.mockRestore()
    }
  })
  it('P1 facade clears its session reference even when descriptor close throws', async () => {
    const log = realAudit()
    const fixture = await brokerFixture({ audit: log.audit })
    throwFromFileClose(log)
    await log.audit.open(fixture.heldKeys[0]!)
    const writer: unknown = Reflect.get(log.audit, 'current')
    if (typeof writer !== 'object' || writer === null) throw new Error('expected current session')
    const key = keyOf(writer)
    try {
      expect(() => {
        log.audit.close()
      }).toThrow('test descriptor close failed')
      cleared(writer, key)
      expect(Reflect.get(log.audit, 'current')).toBeNull()
    } finally {
      await fixture.broker.dispose()
    }
  })
})
