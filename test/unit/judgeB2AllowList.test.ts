// M125 lane F2: the B2 system-call allow-list stays the captured
// set — the design's 188 plus the capture's 5, with the 26 names the
// installed asm-generic table lacks deriving arm64's 167.
import { describe, expect, it } from 'vitest'
import {
  JUDGE_FAST_B2_SYSCALLS_ARM64_ABSENT,
  JUDGE_FAST_B2_SYSCALLS_X86_64,
} from '../../src/shared/constants'

describe('B2 allow-list', () => {
  it('holds the design set plus the capture additions', () => {
    expect(JUDGE_FAST_B2_SYSCALLS_X86_64).toHaveLength(193)
    expect(new Set(JUDGE_FAST_B2_SYSCALLS_X86_64).size).toBe(193)
    for (const call of ['clone3', 'io_uring_setup', 'io_uring_enter', 'socket', 'bind']) {
      expect(JUDGE_FAST_B2_SYSCALLS_X86_64).toContain(call)
    }
    for (const call of ['openat', 'clone', 'epoll_pwait', 'statx', 'futex']) {
      expect(JUDGE_FAST_B2_SYSCALLS_X86_64).toContain(call)
    }
    expect(JUDGE_FAST_B2_SYSCALLS_X86_64).not.toContain('io_uring_register')
    expect(JUDGE_FAST_B2_SYSCALLS_X86_64).not.toContain('connect')
  })

  it('derives arm64 by removing the names without numbers there', () => {
    expect(JUDGE_FAST_B2_SYSCALLS_ARM64_ABSENT).toHaveLength(26)
    const x86 = new Set(JUDGE_FAST_B2_SYSCALLS_X86_64)
    for (const call of JUDGE_FAST_B2_SYSCALLS_ARM64_ABSENT) {
      expect(x86.has(call)).toBe(true)
    }
    expect(x86.size - JUDGE_FAST_B2_SYSCALLS_ARM64_ABSENT.length).toBe(167)
  })
})
