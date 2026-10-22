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
  send('initialize', {
    host: { id: 'visual-studio', version: '17.14' },
    protocolRange: { minimum: 'mhp/1.5.0', maximumExclusive: 'mhp/1.6.0' },
    capabilities: ['lifecycle', 'documents'],
    locale: 'en',
    theme: { kind: 'dark', tokens: {} },
    folders: [],
    trusted: false,
  })
  const lines = createInterface({ input: process.stdin })
  let binding
  let panelSequence = 1
  let toHostSequence = 1
  const lifecycle = []
  lines.on('line', (line) => {
    const reply = JSON.parse(line)
    if (reply.method === 'initialize') {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: reply.id, result: { protocolVersion: 'mhp/1.5.0', capabilities: ['lifecycle'] } })}\n`,
      )
    } else if (reply.kind === 'surface') {
      if (reply.event === 'opened')
        binding = {
          surface: reply.surface,
          sessionId: reply.sessionId,
          surfaceKind: reply.surfaceKind,
        }
      if (!binding || reply.surface !== binding.surface || reply.sessionId !== binding.sessionId)
        throw new Error('FAKE_BINDING_MISMATCH')
      lifecycle.push(reply)
      if (reply.event === 'ready')
        process.stdout.write(
          `${JSON.stringify({ mhp: '1.5', kind: 'panel', surface: binding.surface, direction: 'toPanel', seq: panelSequence++, payload: { type: 'focusInput' } })}\n`,
        )
      else if (reply.event === 'closed')
        writeFileSync(`${marker}.closed`, JSON.stringify(lifecycle))
    } else if (reply.kind === 'panel') {
      if (
        reply.direction !== 'toHost' ||
        reply.surface !== binding?.surface ||
        reply.seq !== toHostSequence++
      )
        throw new Error('FAKE_PANEL_ORDER_MISMATCH')
      writeFileSync(`${marker}.panel`, JSON.stringify(reply))
    } else if (reply.id === 1) {
      if (reply.result?.protocolVersion !== 'mhp/1.5.0')
        throw new Error('FAKE_PANEL_VERSION_NOT_SELECTED')
      send('documents/list', {})
    } else if (reply.id === 2) writeFileSync(marker, JSON.stringify(reply))
  })
  lines.on('close', () => process.exit(0))
  process.stderr.write('fixture-private-account-and-path\n')
}
// A fake-only runtime stays alive until the tested owner closes the job.
setInterval(() => {
  process.exitCode = 0
}, 1000)
