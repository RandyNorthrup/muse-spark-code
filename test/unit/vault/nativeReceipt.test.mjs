import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createWarningBudget, expectedReceiptWarning } from '../helpers/vault/receiptWarnings.mjs'

const stack = 'at ResourceLaunchHost.sampleTree (/installed/resourceGovernor.js:3:51102)'
function work(change = {}) {
  return {
    // The sampler stamps this fixed cause; the classifier requires it.
    samplerCause: 'unproven-membership',
    known: false,
    ticket: undefined,
    ended: true,
    process: { pid: 42, group: true, profile: 'contained' },
    binding: { root: { pid: 42 } },
    ...change,
  }
}
describe('installed vault receipt sampler warnings', () => {
  it('names only the finished native helper registration race with a kernel-gone group', () => {
    expect(expectedReceiptWarning('warn', stack, work(), () => true)).toBe(
      'finished-native-helper-membership-race',
    )
    expect(
      expectedReceiptWarning(
        'warn',
        stack,
        work({ process: { pid: 42, group: true, profile: 'probe' } }),
        () => true,
      ),
    ).toBe('finished-native-helper-membership-race')
    expect(
      expectedReceiptWarning(
        'warn',
        'at async ResourceLaunchHost.sampleTree (/installed/resourceGovernor.js:3:51102)',
        work(),
        () => true,
      ),
    ).toBe('finished-native-helper-membership-race')
  })
  it('never whitelists without the exact sampler cause, even beside the known race', () => {
    const fatal = { samplerCause: 'sampler-error' }
    // RVCM109JD P2-2 drill: an unrelated fatal line beside the known one fails.
    expect(expectedReceiptWarning('warn', stack, work(fatal), () => true)).toBeNull()
    expect(
      expectedReceiptWarning('warn', stack, work({ samplerCause: undefined }), () => true),
    ).toBeNull()
    expect(expectedReceiptWarning('warn', stack, work({}), () => true)).not.toBeNull()
    expect(expectedReceiptWarning('warn', stack, undefined, () => true)).toBeNull()
  })
  it('matches the sampler location whole and anchored, never as a substring', () => {
    expect(
      expectedReceiptWarning('warn', 'at settings.read(); x.sampleTree (y)', work(), () => true),
    ).toBeNull()
    expect(
      expectedReceiptWarning(
        'warn',
        'ResourceLaunchHost.sampleTree (no frame)',
        work(),
        () => true,
      ),
    ).toBeNull()
    expect(
      expectedReceiptWarning(
        'warn',
        'at ResourceLaunchHost.sampleTree (/installed/resourceGovernor.js)',
        work(),
        () => true,
      ),
    ).toBeNull()
  })
  it.each([
    { ended: false },
    { known: true },
    { ticket: {} },
    { process: { pid: 42, group: true, profile: 'handoff' } },
    { process: { pid: 42, group: false, profile: 'contained' } },
    { process: { pid: 0, group: true, profile: 'contained' }, binding: { root: { pid: 0 } } },
    { process: { pid: 42.5, group: true, profile: 'contained' }, binding: { root: { pid: 42.5 } } },
    { binding: { root: { pid: 43 } } },
    { binding: { root: null } },
  ])('refuses a live, registered or unproved tree: %j', (change) => {
    expect(expectedReceiptWarning('warn', stack, work(change), () => true)).toBeNull()
  })
  it.skipIf(process.platform === 'win32')(
    'uses the kernel to refuse a live process group and recognize its exact exit',
    async () => {
      const child = spawn(
        process.execPath,
        ['-e', "process.stdout.write('ready'); process.stdin.resume()"],
        { env: {}, detached: true, stdio: ['pipe', 'pipe', 'ignore'] },
      )
      const exited = once(child, 'exit')
      try {
        await once(child.stdout, 'data')
        const current = work({
          process: { pid: child.pid, group: true, profile: 'probe' },
          binding: { root: { pid: child.pid } },
        })
        expect(expectedReceiptWarning('warn', stack, current)).toBeNull()
        process.kill(-child.pid, 'SIGKILL')
        await exited
        expect(expectedReceiptWarning('warn', stack, current)).toBe(
          'finished-native-helper-membership-race',
        )
      } finally {
        if (child.exitCode === null && child.signalCode === null)
          process.kill(-child.pid, 'SIGKILL')
        await exited
      }
    },
  )
  it('keeps live groups, unknown work and unrelated resource errors fatal', () => {
    expect(expectedReceiptWarning('warn', stack, work(), () => false)).toBeNull()
    expect(expectedReceiptWarning('warn', stack, {}, () => true)).toBeNull()
    expect(expectedReceiptWarning('warn', stack, undefined, () => true)).toBeNull()
    expect(expectedReceiptWarning('runtime', stack, work(), () => true)).toBeNull()
    expect(expectedReceiptWarning('warn', 'at settings.read()', work(), () => true)).toBeNull()
  })
  it('counts each ignored warning against its allowance; storms and strangers fail', () => {
    const budget = createWarningBudget({ 'finished-native-helper-membership-race': 2 })
    expect(budget.admit('finished-native-helper-membership-race')).toBe(true)
    expect(budget.admit('finished-native-helper-membership-race')).toBe(true)
    expect(budget.admit('finished-native-helper-membership-race')).toBe(false)
    expect(createWarningBudget({}).admit('finished-native-helper-membership-race')).toBe(false)
    expect(budget.admit('another-warning')).toBe(false)
  })
})
