import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import readline from 'node:readline'
import { clearTimeout, setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/runtime.py')

function initializeFrame(minimum) {
  return (
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'fixture-init',
      method: 'initialize',
      params: {
        protocolRange: { minimum, maximumExclusive: 'mhp/1.6.0' },
        capabilities: ['lifecycle'],
      },
    }) + '\n'
  )
}

async function negotiate(minimum) {
  const child = spawn('python3', [fixture], { stdio: ['pipe', 'pipe', 'ignore'] })
  const lines = readline.createInterface({ input: child.stdout })
  try {
    const reply = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('fixture produced no reply')), 10_000)
      timer.unref()
      child.once('error', reject)
      child.once('exit', (code) => reject(new Error(`fixture exited ${code} without replying`)))
      lines.once('line', (line) => {
        clearTimeout(timer)
        resolve(line)
      })
      child.stdin.write(initializeFrame(minimum))
    })
    return JSON.parse(reply)
  } finally {
    lines.close()
    child.kill()
    if (child.exitCode === null) await new Promise((resolve) => child.once('exit', resolve))
  }
}

test('native fixture negotiates the frozen MHP 1.5 contract', async () => {
  const reply = await negotiate('mhp/1.5.0')
  assert.equal(reply.result.protocolVersion, 'mhp/1.5.0')
})

test('native fixture refuses the superseded 1.2 range', async () => {
  await assert.rejects(negotiate('mhp/1.2.0'), /without replying/)
})
