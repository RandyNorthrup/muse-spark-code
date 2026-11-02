// Process helpers for the desktop harness: captured runs with a deadline,
// and whole-group stops so a harness run leaves nothing behind it.

import { spawn } from 'node:child_process'
import { clearTimeout, setTimeout } from 'node:timers'

/** Pauses for `ms` milliseconds. */
export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
Runs one command to completion, capturing its output. Resolves with
`{ code, stdout, stderr, timedOut }` (code null when the process could not
start, with the start error in stderr); a nonzero exit is a result, never
a rejection, so callers decide what it means.
*/
export function runCapture(command, args, { env, cwd, timeoutMs = 30_000, input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let isTimedOut = false
    const timer = setTimeout(() => {
      isTimedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      resolve({ code: null, stdout, stderr: `${stderr}${error.message}`, timedOut: isTimedOut })
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut: isTimedOut })
    })
    if (input !== undefined) child.stdin.write(input)
    child.stdin.end()
  })
}

/** Polls `check` until it returns a truthy value, or throws after the deadline. */
export async function waitFor(check, { timeoutMs, intervalMs = 100, description }) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() >= deadline) {
      throw new Error(`timed out after ${String(timeoutMs)} ms waiting for ${description}`)
    }
    await sleep(intervalMs)
  }
}

/**
Stops a child and its whole process group (the child must have been
spawned `detached: true`): SIGTERM, a grace period, then SIGKILL.
Resolves once the child has exited either way.
*/
export async function stopProcessGroup(child, { graceMs = 3000 } = {}) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((resolve) => {
    child.once('close', () => resolve(true))
  })
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch (error) {
    if (error instanceof Error && error.code !== 'ESRCH') throw error
    return
  }
  const grace = new Promise((resolve) => {
    setTimeout(() => resolve(false), graceMs)
  })
  const isExited = await Promise.race([exited, grace])
  if (isExited) return
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch (error) {
    if (error instanceof Error && error.code !== 'ESRCH') throw error
    return
  }
  await exited
}
