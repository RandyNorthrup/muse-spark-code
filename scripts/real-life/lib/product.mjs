// The product, used the two ways a person or an editor uses the terminal
// agent: a command run to its end (`exec`, `auth`, `providers`, `usage`),
// and the editor protocol spoken over its standard input and output (one
// JSON-RPC message per line, as an editor speaks it). Nothing of the
// product is imported, replaced or reached into: only its process.
import { spawn } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { clearTimeout, setTimeout } from 'node:timers'

const COMMAND_TIMEOUT_MS = 180_000
const REQUEST_TIMEOUT_MS = 180_000
const STOP_GRACE_MS = 5000

/** A pipe the product has closed: its end is read from its exit, not from here. */
function closedPipe() {
  // Nothing to do.
}

/**
 * @typedef {object} Product
 * @property {string} node the Node that runs it
 * @property {string} agent the installed agent script
 * @property {NodeJS.ProcessEnv} env its environment (the new home)
 */

/**
 * One command, run to its end.
 * @param {Product} product
 * @param {readonly string[]} args
 * @param {{ cwd: string, stdin?: string, timeoutMs?: number, interruptWhen?: (seen: { stdout: string, stderr: string }) => boolean }} options
 */
export function runCommand(product, args, options) {
  const started = performance.now()
  const child = spawn(product.node, [product.agent, ...args], {
    cwd: options.cwd,
    env: product.env,
    stdio: 'pipe',
    windowsHide: true,
  })
  const seen = { stdout: '', stderr: '' }
  let isTimedOut = false
  let isInterrupted = false
  const interrupt = () => {
    if (isInterrupted || options.interruptWhen?.(seen) !== true) return
    isInterrupted = true
    child.kill('SIGINT')
  }
  child.stdout.on('data', (chunk) => {
    seen.stdout += String(chunk)
    interrupt()
  })
  child.stderr.on('data', (chunk) => {
    seen.stderr += String(chunk)
    interrupt()
  })
  // The key, or the prompt: written once, then the pipe is closed.
  child.stdin.on('error', closedPipe)
  child.stdin.end(options.stdin ?? '')
  const timer = setTimeout(() => {
    isTimedOut = true
    child.kill()
  }, options.timeoutMs ?? COMMAND_TIMEOUT_MS)
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolve({
        code,
        signal,
        stdout: seen.stdout,
        stderr: seen.stderr,
        isTimedOut,
        isInterrupted,
        seconds: (performance.now() - started) / 1000,
      })
    })
  })
}

/** The lines of a JSONL output, each parsed; a line that is no JSON is kept as text. */
export function jsonLines(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return { unparsed: line }
      }
    })
}

/**
 * The agent started as an editor starts it, and a client that speaks to it.
 * The client answers what an editor answers: a permission request by the
 * choice the scenario makes, anything else it was not asked to offer by
 * "method not found".
 * @param {Product} product
 * @param {readonly string[]} args the agent's arguments (`--backend modelApi`, ...)
 * @param {{ cwd: string }} options
 */
export function startEditor(product, args, options) {
  const child = spawn(product.node, [product.agent, ...args], {
    cwd: options.cwd,
    env: product.env,
    stdio: 'pipe',
    windowsHide: true,
  })
  const waiting = new Map()
  const updates = []
  const permissions = []
  const watchers = new Set()
  const state = { nextId: 1, stderr: '', buffered: '', exit: undefined, choose: undefined }
  const closed = new Promise((resolve) => {
    child.on('close', (code, signal) => {
      state.exit = { code, signal }
      for (const { reject, timer } of waiting.values()) {
        clearTimeout(timer)
        reject(new Error(`the agent ended (exit ${String(code)}) before it answered`))
      }
      waiting.clear()
      resolve(state.exit)
    })
  })
  child.on('error', closedPipe)
  child.stdin.on('error', closedPipe)
  child.stderr.on('data', (chunk) => {
    state.stderr += String(chunk)
  })
  const send = (message) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
  }
  const answer = (message) => {
    if (message.method === 'session/request_permission') {
      permissions.push(message.params)
      const chosen = state.choose?.(message.params)
      const outcome =
        chosen === undefined ? { outcome: 'cancelled' } : { outcome: 'selected', optionId: chosen }
      send({ id: message.id, result: { outcome } })
      return
    }
    send({ id: message.id, error: { code: -32_601, message: 'Method not found' } })
  }
  const take = (message) => {
    if (message.method === undefined) {
      const asked = waiting.get(message.id)
      if (asked === undefined) return
      waiting.delete(message.id)
      clearTimeout(asked.timer)
      if (message.error === undefined) asked.resolve(message.result)
      else asked.reject(Object.assign(new Error(message.error.message), { rpc: message.error }))
      return
    }
    if (message.id !== undefined) {
      answer(message)
      return
    }
    if (message.method !== 'session/update') return
    updates.push(message.params)
    for (const watcher of watchers) watcher(message.params)
  }
  child.stdout.on('data', (chunk) => {
    state.buffered += String(chunk)
    const lines = state.buffered.split('\n')
    state.buffered = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim() === '') continue
      try {
        take(JSON.parse(line))
      } catch {
        // Not a protocol line: an editor ignores it, and the record shows it.
        state.stderr += `[stdout] ${line}\n`
      }
    }
  })
  return {
    updates,
    permissions,
    closed,
    get stderr() {
      return state.stderr
    },
    get exit() {
      return state.exit
    },
    /** How the next permission requests are answered: an option id, or nothing to cancel. */
    answerPermissions(choose) {
      state.choose = choose
    },
    request(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
      const id = state.nextId
      state.nextId += 1
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id)
          reject(new Error(`${method} was not answered in ${String(timeoutMs / 1000)} s`))
        }, timeoutMs)
        waiting.set(id, { resolve, reject, timer })
        send({ id, method, params })
      })
    },
    notify(method, params) {
      send({ method, params })
    },
    /** Resolves with the first update the test accepts, from now on. */
    nextUpdate(accepts, timeoutMs = REQUEST_TIMEOUT_MS) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          watchers.delete(watcher)
          reject(new Error(`no such update in ${String(timeoutMs / 1000)} s`))
        }, timeoutMs)
        const watcher = (update) => {
          if (!accepts(update)) return
          clearTimeout(timer)
          watchers.delete(watcher)
          resolve(update)
        }
        watchers.add(watcher)
      })
    },
    /** Ends the agent as an editor does when its window closes. */
    async stop() {
      if (state.exit !== undefined) return state.exit
      child.stdin.end()
      const timer = setTimeout(() => child.kill(), STOP_GRACE_MS)
      const exit = await closed
      clearTimeout(timer)
      return exit
    },
  }
}

/** The text the agent said in a list of updates. */
export function saidIn(updates) {
  return updates
    .map((entry) => entry.update)
    .filter((update) => update?.sessionUpdate === 'agent_message_chunk')
    .map((update) => (update.content?.type === 'text' ? update.content.text : ''))
    .join('')
}
