import { spawn } from 'node:child_process'
import type { InspectExecOptions } from '../../../src/core/judge/fast/inspectExec'

/** Fake-only tests exercise the same pipe/stop contract as the governed launcher. */
export const inspectStart: InspectExecOptions['start'] = (file, args, options) => {
  const child = spawn(file, [...args], {
    ...options,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  })
  // Like the governed launcher, own errors before its asynchronous port is delivered.
  // An abort can land before the consumer has attached its pipe/close listeners.
  child.on('error', () => {
    child.kill('SIGKILL')
  })
  return Promise.resolve({
    child,
    pid: () => Promise.resolve(child.pid),
    outcome: () => Promise.resolve(undefined),
    stop: () => {
      child.kill('SIGKILL')
      return Promise.resolve()
    },
  })
}
