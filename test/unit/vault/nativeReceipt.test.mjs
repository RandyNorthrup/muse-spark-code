import { afterAll, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
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
// RVCM109JE P2-2: the classifier is fed real stacks, never hand-indented
// fixtures. This holder has the production sampler's shape, so a stack
// captured inside it carries Node's genuine frame formatting.
class ResourceLaunchHost {
  sampleTree() {
    return new Error('resource receipt diagnostic').stack
  }
}
const minified = { directory: '' }
afterAll(async () => {
  if (minified.directory) await rm(minified.directory, { recursive: true, force: true })
})
async function minifiedSamplerStack() {
  if (!minified.file) {
    minified.directory = await mkdtemp(path.join(os.tmpdir(), 'vr-min-'))
    minified.file = path.join(minified.directory, 'sampler.cjs')
    await build({
      stdin: {
        contents:
          'class ResourceLaunchHost { sampleTree() { return new Error("resource receipt diagnostic").stack } }' +
          'module.exports = { make: () => new ResourceLaunchHost() }',
        resolveDir: process.cwd(),
        loader: 'js',
      },
      bundle: true,
      minify: true,
      platform: 'node',
      format: 'cjs',
      outfile: minified.file,
    })
  }
  return createRequire(import.meta.url)(minified.file)
    .make()
    .sampleTree()
}
describe('installed vault receipt sampler warnings', () => {
  it('names the race in a real Error stack with Node frame indentation', () => {
    const stack = new ResourceLaunchHost().sampleTree()
    // Genuine V8 formatting, not a fixture: every frame is indented.
    expect(stack).toMatch(/\n {4}at ResourceLaunchHost\.sampleTree \(/u)
    expect(expectedReceiptWarning('warn', stack, work(), () => true)).toBe(
      'finished-native-helper-membership-race',
    )
  })
  it('names the race in a real minified-bundle stack with shortened names', async () => {
    const stack = await minifiedSamplerStack()
    const frame = stack.split('\n').find((line) => line.includes('.sampleTree ('))
    expect(frame).toBeDefined()
    // The installed bundle minifies the holder away; the method name stands.
    expect(frame).not.toContain('ResourceLaunchHost')
    expect(frame).toMatch(/^\s*at (?:async )?[A-Za-z_$][\w$]*\.sampleTree \(.+:[0-9]+:[0-9]+\)$/u)
    expect(expectedReceiptWarning('warn', stack, work(), () => true)).toBe(
      'finished-native-helper-membership-race',
    )
  })
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
