// A best-of-N attempt that never ran (src/host/bestOfN/bestOfNManager.ts):
// whatever rejects the attempt's conversation reaches the log in closed
// kind words only — never the failure's own text — while the attempt's
// failed event keeps the redacted text, as the runner records its own
// failures and the dialog renders them. The rejections below are the real
// ones the runner sees: Restricted Mode's refusal and the operating
// system's own failures.
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { failureForLog } from '../../src/core/backends/musecode/logText'
import { WorktreeUntrustedError } from '../../src/core/bestOfN/worktreeConversationHost'
import { attemptFailureReason } from '../../src/host/bestOfN/bestOfNManager'

it('names the Restricted Mode refusal by its kind, never its text', () => {
  const words = failureForLog(new WorktreeUntrustedError())
  expect(words).toBe('WorktreeUntrustedError')
  expect(words).not.toContain('trusted workspace')
})

it('names the operating system failures by their kind, never their text', () => {
  let refusal: unknown
  try {
    readFileSync(path.join(tmpdir(), `no-attempt-file-${String(process.pid)}`), 'utf8')
  } catch (error: unknown) {
    refusal = error
  }
  expect(refusal).toBeInstanceOf(Error)
  const words = failureForLog(refusal)
  expect(words).toBe('Error')
  expect(words).not.toContain('no such file')
})

it('names a stop by its kind, never its text', () => {
  const controller = new AbortController()
  controller.abort()
  let refusal: unknown
  try {
    controller.signal.throwIfAborted()
  } catch (error: unknown) {
    refusal = error
  }
  expect(refusal).toBeDefined()
  // A stop carries its own kind, never its text.
  expect(failureForLog(refusal)).toBe('AbortError')
})

it('keeps the redacted text for the attempt while the log keeps the kind', () => {
  let refusal: unknown
  try {
    readFileSync(path.join(tmpdir(), `no-attempt-file-${String(process.pid)}`), 'utf8')
  } catch (error: unknown) {
    refusal = error
  }
  expect(refusal).toBeInstanceOf(Error)
  expect(attemptFailureReason(refusal)).toContain('no such file')
  expect(attemptFailureReason(refusal)).not.toBe('Error')
  expect(attemptFailureReason(new WorktreeUntrustedError())).toContain('trusted workspace')
})
