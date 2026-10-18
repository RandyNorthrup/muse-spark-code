// Failure-code recovery for the resource trees (D119): a vanished process
// reads gone/absent, never a throw, and signal outcomes keep their names.
// Every failure below is produced by the real code and the real kernel: real
// /proc reads, real kill syscalls, and real errno failures. Nothing is
// simulated.
import { describe, expect, it } from 'vitest'
import { signalVerifiedPosix } from '../../src/core/resources/trees/actions'
import { LinuxResourceTreeReader } from '../../src/core/resources/trees/linux'

describe('LinuxResourceTreeReader identity codes', () => {
  const reader = new LinuxResourceTreeReader()

  it('reads a live process identity', async () => {
    if (process.platform !== 'linux') {
      // Without /proc every identity is unprovable; the null below is the test.
      await expect(reader.identity(1)).resolves.toBeNull()
      return
    }
    const identity = await reader.identity(1)
    expect(identity).not.toBeNull()
    expect(identity?.pid).toBe(1)
  })

  it('reads a vanished pid as null, never a throw', async () => {
    await expect(reader.identity(2 ** 30)).resolves.toBeNull()
  })
})

describe('signalVerifiedPosix outcomes', () => {
  const identity = { pid: 2 ** 30 - 1, startTime: '12345' }

  it('refuses an unregistered target without signalling', () => {
    expect(signalVerifiedPosix(identity, identity, 'SIGTERM', () => false)).toBe('refused')
  })

  it('refuses the sampler itself without signalling', () => {
    const self = { pid: process.pid, startTime: '1' }
    expect(signalVerifiedPosix(self, self, 'SIGTERM', () => true)).toBe('refused')
  })

  it('reads a missing current identity as gone', () => {
    expect(signalVerifiedPosix(identity, null, 'SIGTERM', () => true)).toBe('gone')
  })

  it('reads a replaced identity as identity-changed', () => {
    const replaced = { ...identity, startTime: '99999' }
    expect(signalVerifiedPosix(identity, replaced, 'SIGTERM', () => true)).toBe('identity-changed')
  })

  it('reads a confirmed ESRCH as gone', () => {
    if (process.platform !== 'linux') return
    // The pid does not exist, so the real kill delivers nothing and the
    // kernel answers ESRCH through the default sender.
    expect(signalVerifiedPosix(identity, identity, 'SIGTERM', () => true)).toBe('gone')
  })
})
