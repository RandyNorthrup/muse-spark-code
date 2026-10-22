import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { setInterval } from 'node:timers'
import { fileURLToPath } from 'node:url'

const marker = process.env.MUSE_SPARK_TEST_RESULT_PATH
if (typeof marker !== 'string') throw new TypeError('MISSING_TEST_MARKER')
if (process.argv.includes('--child')) {
  writeFileSync(`${marker}.pid`, String(process.pid))
} else {
  if (
    Object.keys(process.env).some(
      (key) =>
        key.endsWith('_API_KEY') ||
        ['OPENAI_KEY', 'GH_TOKEN', 'MUSE_SPARK_MCP_JOB_CONFIG'].includes(key),
    )
  ) {
    throw new Error('CREDENTIAL_ENVIRONMENT_REACHED_FAKE')
  }
  spawn(process.execPath, [fileURLToPath(import.meta.url), '--child'], { stdio: 'ignore' })
  let next = 1
  const send = (method, params) => {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: next++, method, params })}\n`)
  }
  const lines = createInterface({ input: process.stdin })
  lines.on('line', (line) => {
    const reply = JSON.parse(line)
    if (reply.method === 'initialize') {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: reply.id, result: { protocolVersion: 'mhp/1.5.0', capabilities: ['lifecycle'] } })}\n`,
      )
      send('documents/list', {})
    } else if (reply.id === 1) writeFileSync(marker, JSON.stringify(reply))
  })
  lines.on('close', () => process.exit(0))
  process.stderr.write('fixture-private-account-and-path\n')
}
// A fake-only runtime stays alive until the tested owner closes the job.
setInterval(() => {
  process.exitCode = 0
}, 1000)
