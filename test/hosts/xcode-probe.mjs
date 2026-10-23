// mcpbridge health probe for test/hosts/xcode.sh (M66): speaks one MCP
// initialize to `xcrun mcpbridge` and reports what happened. Exit 0 always;
// the verdict is on stdout (HEALTHY, BROKEN or ABSENT) with the evidence
// after it. Apple's binary health is a fact, never this check's failure.
import { spawn } from 'node:child_process'
import { clearTimeout, setTimeout } from 'node:timers'

const ANSWER_WAIT_MS = 15_000

const state = {
  lines: [],
  stdout: '',
  stderr: '',
  hasAnswered: false,
}

function finish() {
  for (const line of state.lines) console.log(line)
  process.exit(0)
}

const child = spawn('/usr/bin/xcrun', ['mcpbridge'], { stdio: ['pipe', 'pipe', 'pipe'] })
const timer = setTimeout(() => {
  if (state.hasAnswered) return
  state.lines.push('BROKEN xcrun mcpbridge stayed silent past 15 s (no MCP answer, still running)')
  child.kill('SIGKILL')
  finish()
}, ANSWER_WAIT_MS)

child.on('error', (error) => {
  clearTimeout(timer)
  state.lines.push(`ABSENT xcrun mcpbridge would not start: ${error.message}`)
  finish()
})
child.stdout.on('data', (chunk) => {
  if (state.hasAnswered) return
  state.stdout += chunk.toString()
  const line = state.stdout.split('\n').find((candidate) => candidate.trim() !== '')
  if (line === undefined) return
  state.hasAnswered = true
  clearTimeout(timer)
  try {
    const answer = JSON.parse(line)
    const version = answer?.result?.protocolVersion ?? answer?.error?.message ?? line
    state.lines.push(
      `HEALTHY xcrun mcpbridge answered MCP initialize: ${JSON.stringify(version).slice(0, 160)}`,
    )
  } catch {
    state.lines.push(`BROKEN xcrun mcpbridge answered non-JSON: ${line.slice(0, 160)}`)
  }
  child.kill('SIGKILL')
  finish()
})
child.stderr.on('data', (chunk) => {
  state.stderr += chunk.toString()
})
child.on('exit', (code = '?', signal = 'none') => {
  if (state.hasAnswered) return
  clearTimeout(timer)
  const errLines = state.stderr.trim().split('\n')
  const complaint = errLines.length > 0 ? errLines.at(-1) : ''
  const suffix = complaint === '' ? '' : `: ${complaint.slice(0, 200)}`
  state.lines.push(
    `BROKEN xcrun mcpbridge exited before answering (code ${code}, signal ${signal})${suffix}`,
  )
  finish()
})
child.stdin.write(
  `${JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'xcode-probe', version: '0' },
    },
  })}\n`,
)
