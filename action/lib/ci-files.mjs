// Other-CI filesystem work needs a process boundary: fs.copyFile/rm do not
// accept AbortSignals. Killing this credential-free worker stops the actual
// work, including later writes, rather than only timing out the caller.
import { Buffer } from 'node:buffer'
import { clearTimeout, setTimeout } from 'node:timers'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { ACTION_REAP_MS, BoundError, isEntry } from './lifecycle.mjs'

export function fileOperation(operation, signal, spawnChild = spawn) {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawnChild(process.execPath, [fileURLToPath(import.meta.url)], {
      env: {},
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
      shell: false,
    })
    let reap
    const abort = () => {
      child.kill('SIGKILL')
      reap = setTimeout(() => reject(new BoundError('stopping filesystem work')), ACTION_REAP_MS)
    }
    signal.addEventListener('abort', abort, { once: true })
    child.stdin.on('error', () => {
      // Aborted workers may close stdin before consuming the trusted request.
    })
    child.once('error', reject)
    child.once('close', (code) => {
      clearTimeout(reap)
      signal.removeEventListener('abort', abort)
      if (signal.aborted) reject(signal.reason)
      else if (code === 0) resolve()
      else reject(new Error('filesystem operation failed'))
    })
    child.stdin.end(JSON.stringify(operation))
    if (signal.aborted) abort()
  })
}

// A bound aborts the filesystem worker and waits for its death before the
// caller can begin cleanup. An unreapable worker is a fatal launcher error.
export async function boundedFiles(operation, withinMs, what, execute = fileOperation) {
  const controller = new globalThis.AbortController()
  const timer = setTimeout(() => controller.abort(new BoundError(what)), withinMs)
  try {
    await execute(operation, controller.signal)
    controller.signal.throwIfAborted()
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  const chunks = []
  let length = 0
  for await (const chunk of process.stdin) {
    length += chunk.length
    if (length > 1_048_576) throw new Error('filesystem input too large')
    chunks.push(chunk)
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (input.kind === 'mkdir' && typeof input.target === 'string') {
    await mkdir(input.target, { mode: 0o700 })
  } else if (input.kind === 'remove' && typeof input.target === 'string') {
    await rm(input.target, { recursive: true, force: true })
  } else if (
    input.kind === 'publish' &&
    typeof input.target === 'string' &&
    Array.isArray(input.files) &&
    input.files.every((file) => typeof file === 'string') &&
    typeof input.outputs === 'object' &&
    input.outputs !== null
  ) {
    await mkdir(input.target, { mode: 0o700 })
    for (const file of input.files) {
      if (existsSync(file)) await copyFile(file, path.join(input.target, path.basename(file)), 1)
    }
    await writeFile(path.join(input.target, 'outputs.json'), `${JSON.stringify(input.outputs)}\n`, {
      flag: 'wx',
      mode: 0o600,
    })
  } else throw new Error('invalid filesystem operation')
}

if (isEntry(import.meta.url)) {
  try {
    await main()
  } catch {
    process.exitCode = 1
  }
}
